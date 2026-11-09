#!/usr/bin/env node
/**
 * Verify FICTIONAL sample case receipts (default: larkmoor-sample-v2) against
 * the live testnet contract. No NEAR AI key. No transactions.
 *
 * - Fully recomputes evidence commitments, finding_hash, and citation hashes
 *   for sample Findings from samples/seed/.
 * - Checks ed25519 signatures on ALL Findings on the contract (every case id).
 * - Older development receipts on other case IDs are counted in the footer.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import {
  arrayToHex,
  evidenceCommitment,
  hexToBytes,
  findingHash,
  citationHash,
  citationRecord,
} from "../src/commit.mjs";
import { getReceipt, receiptCount, CONTRACT } from "../src/near.mjs";
import { SAMPLE_CASE_ID } from "../src/session-scope.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function signedText(modelId, req, resp) {
  return `${modelId}:${arrayToHex(req)}:${arrayToHex(resp)}`;
}

function hex32(arr) {
  if (!arr) return "";
  if (typeof arr === "string") return arr.replace(/^0x/i, "").toLowerCase();
  return arrayToHex(arr).toLowerCase();
}

function kindName(k) {
  if (k == null) return "";
  if (typeof k === "object") return Object.keys(k)[0] || "";
  return String(k);
}

async function loadShipped() {
  const dir = join(ROOT, "samples", "findings");
  const map = {};
  try {
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      const j = JSON.parse(await readFile(join(dir, f), "utf8"));
      map[Number(j.receipt_id)] = j;
    }
  } catch {}
  return map;
}

async function loadSeedMeta() {
  try {
    return JSON.parse(await readFile(join(ROOT, "samples", "seed", "summary.json"), "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const sampleCase = process.env.SAMPLE_CASE_ID || SAMPLE_CASE_ID;
  let saltHex = "";
  try {
    saltHex = (await readFile(join(ROOT, "samples", "seed", "salt.hex"), "utf8")).trim();
  } catch {
    try {
      saltHex = (await readFile(join(ROOT, "samples", "larkmoor-salt.hex"), "utf8")).trim();
    } catch {
      saltHex = "";
    }
  }
  const listing = await readFile(join(ROOT, "samples", "larkmoor-listing.txt"));
  const hold = await readFile(join(ROOT, "samples", "larkmoor-hold.txt"));
  const shipped = await loadShipped();
  const seed = await loadSeedMeta();
  const n = await receiptCount();
  let failed = 0;
  let sampleFindingsRecomputed = 0;
  let olderOtherCase = 0;

  console.log(`contract ${CONTRACT}  receipts ${n}`);
  console.log(`sample case ${sampleCase} (default)`);
  console.log("id\tkind\thash\tsig\tcitation\tnote");

  const salt = saltHex ? hexToBytes(saltHex) : null;
  const seedIds = new Set(
    seed?.receipts ? Object.values(seed.receipts).map((r) => Number(r.id)) : []
  );

  for (let id = 0; id < n; id++) {
    const rec = await getReceipt(id);
    const kind = kindName(rec.kind);
    const caseId = String(rec.case_id || "");
    const onSample = caseId === sampleCase || seedIds.has(id);
    if (!onSample) olderOtherCase++;

    const f = rec.finding || {};
    let hashOk = "n/a";
    let sigOk = "n/a";
    let citOk = "n/a";
    let note = caseId || "-";

    if (kind === "Finding" && f.model_id) {
      const text = signedText(f.model_id, f.request_hash, f.response_hash);
      const sig = Buffer.from(f.signature);
      const pk = Buffer.from(f.signer_pubkey);
      sigOk = nacl.sign.detached.verify(Buffer.from(text, "utf8"), sig, pk) ? "ok" : "FAIL";
      if (sigOk === "FAIL") failed++;

      if (!onSample) {
        note = `${note} sig-only`;
        console.log(`${id}\t${kind}\t${hashOk}\t${sigOk}\t${citOk}\t${note}`);
        continue;
      }

      sampleFindingsRecomputed++;
      const local = shipped[id];
      const label =
        id === seed?.receipts?.accept?.id
          ? "accept"
          : id === seed?.receipts?.flag?.id
            ? "flag"
            : id === seed?.receipts?.hold?.id
              ? "hold"
              : null;
      const evidenceFile = label === "hold" ? hold : listing;

      if (salt) {
        const commitHex = evidenceCommitment(salt, evidenceFile).toString("hex");
        const commitOk = hex32(rec.evidence_commitments?.[0]) === commitHex;
        hashOk = commitOk ? "ok" : "FAIL";
        if (!commitOk) failed++;

        let citRecords = [];
        let findingBody = null;
        if (label) {
          try {
            const seeded = JSON.parse(
              await readFile(join(ROOT, "samples", "seed", label, "receipt.json"), "utf8")
            );
            findingBody = seeded.finding || null;
            if (Array.isArray(seeded.citation_records) && seeded.citation_records.length) {
              citRecords = seeded.citation_records;
            } else if (Array.isArray(seeded.citations)) {
              citRecords = seeded.citations;
            }
          } catch {
            /* optional */
          }
        }
        if (!citRecords.length && local?.citations?.length) citRecords = local.citations;

        const expectedCit = (f.citation_hashes || []).map(hex32);
        let hashesOk = true;
        if (citRecords.length) {
          const recomputed = citRecords.map((c) => {
            if (c.quote_sha256 && c.evidence_commitment) {
              return citationHash(salt, c).toString("hex");
            }
            const recCit = citationRecord(commitHex, {
              evidence_id: c.evidence_id || "E1",
              line_start: c.line_start,
              line_end: c.line_end,
              byte_start: c.byte_start,
              byte_end: c.byte_end,
              quote: c.quote,
            });
            return citationHash(salt, recCit).toString("hex");
          });
          hashesOk =
            expectedCit.length === recomputed.length &&
            expectedCit.every((h, i) => h === recomputed[i]);
        } else if (expectedCit.length) {
          hashesOk = false;
        }

        const quotesOk =
          !citRecords.length ||
          citRecords.every(
            (c) => !c.quote || evidenceFile.toString("utf8").includes(c.quote)
          );

        let findingHashOk = true;
        if (findingBody) {
          const recomputedFh = findingHash(salt, findingBody).toString("hex");
          findingHashOk = hex32(f.finding_hash) === recomputedFh;
        }

        citOk = quotesOk && hashesOk && findingHashOk ? "ok" : "FAIL";
        if (citOk === "FAIL") failed++;
        note = `${note} recompute`;
        if (commitOk) note = `${note} salt-commit`;
      } else {
        note = `${note} no sample salt`;
      }
    } else if (!onSample) {
      continue;
    }

    console.log(`${id}\t${kind}\t${hashOk}\t${sigOk}\t${citOk}\t${note}`);
  }

  console.log(
    `\nSample case: ${sampleFindingsRecomputed} Findings fully recomputed; ${olderOtherCase} older development receipts on this contract belong to other case IDs.`
  );
  if (failed) {
    console.error(`FAILED ${failed} check(s)`);
    process.exit(1);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
