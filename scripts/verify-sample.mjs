#!/usr/bin/env node
/**
 * Replay FICTIONAL larkmoor-demo against the live testnet contract.
 * No NEAR AI key. No transactions.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nacl from "tweetnacl";
import {
  arrayToHex,
  evidenceCommitment,
  hexToBytes,
} from "../src/commit.mjs";
import { getReceipt, receiptCount, CONTRACT } from "../src/near.mjs";

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

function isFiller(rec) {
  if (kindName(rec.kind) !== "Finding") return false;
  const f = rec.finding || {};
  const nonce = hex32(f.nonce);
  const fh = hex32(f.finding_hash);
  return nonce.replace(/0/g, "") === "" || /^([0-9a-f]{2})\1+$/.test(fh);
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

async function main() {
  let saltHex = "";
  try {
    saltHex = (await readFile(join(ROOT, "samples", "larkmoor-salt.hex"), "utf8")).trim();
  } catch {
    saltHex = "";
  }
  const listing = await readFile(join(ROOT, "samples", "larkmoor-listing.txt"));
  const hold = await readFile(join(ROOT, "samples", "larkmoor-hold.txt"));
  const shipped = await loadShipped();
  const n = await receiptCount();
  const rows = [];
  let failed = 0;

  console.log(`contract ${CONTRACT}  receipts ${n}`);
  console.log("id\tkind\thash\tsig\tcitation\tnote");

  for (let id = 0; id < n; id++) {
    const rec = await getReceipt(id);
    const kind = kindName(rec.kind);
    const f = rec.finding || {};
    const filler = isFiller(rec);
    let hashOk = "n/a";
    let sigOk = "n/a";
    let citOk = "n/a";
    let note = filler ? "FILLER" : "";

    if (kind === "Finding" && f.model_id) {
      const text = signedText(f.model_id, f.request_hash, f.response_hash);
      const sig = Buffer.from(f.signature);
      const pk = Buffer.from(f.signer_pubkey);
      sigOk = nacl.sign.detached.verify(Buffer.from(text, "utf8"), sig, pk) ? "ok" : "FAIL";
      if (sigOk === "FAIL" && !filler) failed++;

      const local = shipped[id];
      if (saltHex) {
        const salt = hexToBytes(saltHex);
        const files = [hold, listing];
        const commitOk = files.some(
          (file) => hex32(rec.evidence_commitments?.[0]) === evidenceCommitment(salt, file).toString("hex")
        );
        hashOk = commitOk ? "ok" : "n/a";
        if (local) {
          const quotesOk = (local.citations || []).every((c) =>
            files.some((file) => file.toString("utf8").includes(c.quote || ""))
          );
          citOk = quotesOk ? "ok" : "FAIL";
          if (citOk === "FAIL") failed++;
        }
        if (commitOk) note = (note + " salt-commit").trim();
      } else if (!filler && kind === "Finding") {
        note = (note + " no sample salt").trim();
      }
    }

    if (filler) {
      hashOk = "skip";
      citOk = "skip";
    }

    rows.push({ id, kind, hashOk, sigOk, citOk, note });
    console.log(`${id}\t${kind}\t${hashOk}\t${sigOk}\t${citOk}\t${note}`);
  }

  if (failed) {
    console.error(`verify failed (${failed} checks)`);
    process.exit(1);
  }
  console.log("verify ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
