#!/usr/bin/env node
/** Recompute local hashes from samples + salt + receipt and compare to a chain dump. */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arrayToHex,
  citationHash,
  citationRecord,
  evidenceCommitment,
  findingHash,
  hexToBytes,
  sha256Hex,
} from "../src/commit.mjs";
import { evaluate } from "../src/policy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function hex32(h) {
  return String(h).replace(/^0x/, "").toLowerCase();
}

async function main() {
  const receipt = JSON.parse(await readFile(join(ROOT, "out/receipt.json"), "utf8"));
  const salt = hexToBytes((await readFile(join(ROOT, "out/case-salt.hex"), "utf8")).trim());
  const evidence = await readFile(join(ROOT, "samples/larkmoor-listing.txt"));
  const commit = evidenceCommitment(salt, evidence);
  const fHash = findingHash(salt, receipt.finding);
  const policy = evaluate(
    { findings: [receipt.finding] },
    { E1: evidence.toString("utf8") },
    { signatureKind: "provider_tee", tcbOk: true }
  );
  const commitHex = commit.toString("hex");
  const cit = (policy.citationRecords ?? []).map((c) =>
    citationHash(salt, citationRecord(commitHex, c)).toString("hex")
  );

  const gwBytes = await readFile(join(ROOT, "out/gateway-report.json"));
  const mdBytes = await readFile(join(ROOT, "out/model-report.json"));
  const gwH = sha256Hex(gwBytes);
  const mdH = sha256Hex(mdBytes);

  const checks = {
    evidence_commitment: hex32(receipt.evidence_commitments[0]) === commit.toString("hex"),
    finding_hash: hex32(receipt.finding_hash) === fHash.toString("hex"),
    citation_hashes: JSON.stringify(receipt.citation_hashes) === JSON.stringify(cit),
    gateway_report_hash: hex32(receipt.gateway_report_hash) === gwH,
    model_report_hash: hex32(receipt.model_report_hash) === mdH,
    nonce_len: hexToBytes(receipt.nonce).length === 32,
    policy: policy.verdict,
  };
  console.log(JSON.stringify(checks, null, 2));
  console.log("recomputed commitment", commit.toString("hex"));
  console.log("recomputed finding_hash", fHash.toString("hex"));
  console.log("recomputed citations", cit);

  const { getReceipt } = await import("../src/near.mjs");
  const id = Number(process.env.RECEIPT_ID || "6");
  try {
    const chain = await getReceipt(id);
    const finding = chain.finding || chain;
    const cmp = {
      nonce: arrayToHex(finding.nonce) === hex32(receipt.nonce),
      finding_hash: arrayToHex(finding.finding_hash) === hex32(receipt.finding_hash),
      evidence: arrayToHex(chain.evidence_commitments[0]) === commit.toString("hex"),
      citations: (finding.citation_hashes || []).map(arrayToHex).join(",") === cit.join(","),
    };
    console.log("vs chain", cmp);
    await writeFile(
      join(ROOT, "out/chain-receipt.json"),
      JSON.stringify(chain, null, 2)
    );
    if (Object.values(cmp).some((v) => v === false)) process.exit(1);
  } catch (e) {
    console.log("chain compare skipped", e.message);
  }

  if (!checks.evidence_commitment || !checks.finding_hash || !checks.citation_hashes) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
