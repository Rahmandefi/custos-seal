#!/usr/bin/env node
/**
 * Verify a chain receipt against the original file + salts.
 * Usage:
 *   node scripts/verify-from-chain.mjs --id N --file PATH --salt HEX [--tamper]
 */
import { readFile } from "node:fs/promises";
import nacl from "tweetnacl";
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
import { getReceipt } from "../src/near.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0) return process.argv[i + 1];
  return fallback;
}

function signedText(modelId, req, resp) {
  return `${modelId}:${arrayToHex(req)}:${arrayToHex(resp)}`;
}

function hex32(arr) {
  return arrayToHex(arr).toLowerCase();
}

async function main() {
  const id = Number(arg("--id", "0"));
  const filePath = arg("--file");
  const saltHex = arg("--salt");
  const tamper = process.argv.includes("--tamper");
  const reportsDir = arg("--reports", "out");
  if (!filePath || !saltHex) {
    console.error("need --id --file --salt");
    process.exit(2);
  }

  let file = Buffer.from(await readFile(filePath));
  if (tamper) {
    file = Buffer.from(file);
    file[file.length - 1] = file[file.length - 1] ^ 0x01;
  }
  const salt = hexToBytes(saltHex.trim());
  const chain = await getReceipt(id);
  if (!chain) {
    console.error("no receipt", id);
    process.exit(1);
  }
  const finding = chain.finding;
  const checks = {};

  const text = signedText(finding.model_id, finding.request_hash, finding.response_hash);
  const sig = Buffer.from(finding.signature);
  const pk = Buffer.from(finding.signer_pubkey);
  checks.ed25519 = nacl.sign.detached.verify(
    Buffer.from(text, "utf8"),
    sig,
    pk
  );

  const commit = evidenceCommitment(salt, file);
  checks.evidence_commitment =
    hex32(chain.evidence_commitments[0]) === commit.toString("hex");

  const evidenceText = file.toString("utf8");
  let findingBody = null;
  try {
    const local = JSON.parse(await readFile(`${reportsDir}/receipt.json`, "utf8"));
    findingBody = local.finding;
  } catch {
    findingBody = null;
  }
  if (!findingBody) {
    checks.citations = false;
    checks.finding_hash = false;
  } else {
    const policy = evaluate(
      { findings: [findingBody] },
      { E1: evidenceText },
      { signatureKind: "provider_tee", tcbOk: true }
    );
    const recs = (policy.citationRecords || []).map((c) =>
      citationRecord(commit.toString("hex"), c)
    );
    const citHex = recs.map((r) => citationHash(salt, r).toString("hex"));
    const chainCit = (finding.citation_hashes || []).map(hex32);
    checks.citations_byte_for_byte = policy.verdict !== "BLOCK";
    checks.citation_hashes = JSON.stringify(citHex) === JSON.stringify(chainCit);
    checks.finding_hash =
      hex32(finding.finding_hash) === findingHash(salt, findingBody).toString("hex");
  }

  try {
    const gw = await readFile(`${reportsDir}/gateway-report.json`);
    const md = await readFile(`${reportsDir}/model-report.json`);
    checks.gateway_report_hash = hex32(finding.gateway_report_hash) === sha256Hex(gw);
    checks.model_report_hash = hex32(finding.model_report_hash) === sha256Hex(md);
  } catch {
    checks.gateway_report_hash = "missing local reports";
    checks.model_report_hash = "missing local reports";
  }

  const pass = Object.values(checks).every((v) => v === true);
  console.log(JSON.stringify({ id, tamper, pass, checks }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
