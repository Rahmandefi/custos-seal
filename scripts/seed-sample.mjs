#!/usr/bin/env node
/**
 * Seed FICTIONAL larkmoor-sample-v2 on testnet with persistence ON.
 * Writes real tx hashes into samples/tx-index.json and artifacts under samples/seed/.
 */
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEvidence } from "../src/pipeline.mjs";
import { callOwner, callWriter, receiptCount } from "../src/near.mjs";
import { evidenceCommitment, newSalt, bytesToHex } from "../src/commit.mjs";
import { rememberTx } from "../src/export.mjs";
import { SAMPLE_CASE_ID } from "../src/session-scope.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "samples", "seed");
const CASE = SAMPLE_CASE_ID;

async function saveFindingArtifacts(label, result, evidenceName) {
  const dir = join(SEED, label);
  await mkdir(dir, { recursive: true });
  const out = result._outDir;
  for (const f of [
    "receipt.json",
    "case-salt.hex",
    "case.json",
    "record_finding.json",
    "gateway-report.json",
    "model-report.json",
  ]) {
    try {
      await cp(join(out, f), join(dir, f));
    } catch {
      /* optional */
    }
  }
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        fictional: true,
        case_id: CASE,
        label,
        evidence: evidenceName,
        receipt_id: result.receiptId,
        tx: result.tx,
        policy: result.policy?.verdict,
        salt: result.salt,
      },
      null,
      2
    )
  );
  // Shipped finding quotes for verify
  const finding = result.policy?.findings?.[0] || result.receipt?.finding || {};
  const citations =
    result.policy?.citationRecords?.map((c) => ({
      quote: c.quote,
      evidence_id: c.evidence_id || "E1",
      line_start: c.line_start,
      line_end: c.line_end,
    })) || [];
  await writeFile(
    join(ROOT, "samples", "findings", `${result.receiptId}.json`),
    JSON.stringify(
      {
        receipt_id: result.receiptId,
        case_id: CASE,
        claim: finding.claim || finding.title || label,
        citations,
        actions: finding.recommended_actions || [],
        fictional: true,
      },
      null,
      2
    )
  );
}

async function runFinding({ label, evidencePath, forceVerdict, salt }) {
  const text = await readFile(evidencePath, "utf8");
  const outDir = join(SEED, `_tmp_${label}`);
  await mkdir(outDir, { recursive: true });
  console.log(`\n=== Finding ${label} (${forceVerdict || "policy"}) ===`);
  const result = await analyzeEvidence({
    evidenceText: text,
    caseId: CASE,
    outDir,
    root: ROOT,
    apiKey: process.env.NEAR_AI_API_KEY,
    writeOnChain: true,
    persistLocalArtifacts: true,
    runDcap: false,
    salt,
    forceVerdict,
  });
  result._outDir = outDir;
  console.log("receipt", result.receiptId, "tx", result.tx, "policy", result.policy?.verdict);
  await rememberTx(outDir, result.receiptId, result.tx);
  await saveFindingArtifacts(label, result, evidencePath.split("/").pop());
  return result;
}

async function main() {
  if (!process.env.NEAR_AI_API_KEY) throw new Error("NEAR_AI_API_KEY required");
  await rm(SEED, { recursive: true, force: true });
  await mkdir(join(SEED), { recursive: true });
  await mkdir(join(ROOT, "samples", "findings"), { recursive: true });

  const salt = newSalt();
  await writeFile(join(ROOT, "samples", "larkmoor-salt.hex"), bytesToHex(salt) + "\n");
  await writeFile(join(SEED, "salt.hex"), bytesToHex(salt) + "\n");

  const before = await receiptCount();
  console.log("receipt_count before", before, "case", CASE);

  const listing = join(ROOT, "samples", "larkmoor-listing.txt");
  const hold = join(ROOT, "samples", "larkmoor-hold.txt");

  const accept = await runFinding({
    label: "accept",
    evidencePath: listing,
    forceVerdict: "Accept",
    salt,
  });
  const flag = await runFinding({
    label: "flag",
    evidencePath: listing,
    forceVerdict: "Flag",
    salt,
  });
  const holdR = await runFinding({
    label: "hold",
    evidencePath: hold,
    forceVerdict: "Hold",
    salt,
  });

  // OpenDenied: owner not on allowlist
  console.log("\n=== OpenDenied ===");
  const denied = await callOwner(
    "request_open",
    { case_id: CASE, evidence_id: "E1", reason: "FICTIONAL stranger open" },
    { deposit: "0.01 NEAR", outDir: SEED }
  );
  let n = await receiptCount();
  let openDeniedId = n - 1;
  await rememberTx(SEED, openDeniedId, denied.tx);
  console.log("OpenDenied receipt", openDeniedId, denied.tx);

  // Grant + Open
  console.log("\n=== Grant + Open ===");
  const grant = await callOwner(
    "grant",
    { case_id: CASE, account: process.env.NEAR_OWNER || "ftowner15e434.testnet" },
    { outDir: SEED }
  );
  console.log("grant tx", grant.tx);
  const opened = await callOwner(
    "request_open",
    { case_id: CASE, evidence_id: "E1", reason: "FICTIONAL investigator open" },
    { deposit: "0.01 NEAR", outDir: SEED }
  );
  n = await receiptCount();
  let openId = n - 1;
  await rememberTx(SEED, openId, opened.tx);
  console.log("Open receipt", openId, opened.tx);

  // Rejection of HOLD
  console.log("\n=== Rejection ===");
  const rej = await callOwner(
    "approve_action",
    {
      case_id: CASE,
      receipt_id: holdR.receiptId,
      decision: false,
      reason: "FICTIONAL isolate host waits for investigator; reject pending review.",
    },
    { outDir: SEED }
  );
  n = await receiptCount();
  const rejId = n - 1;
  await rememberTx(SEED, rejId, rej.tx);
  console.log("Rejection receipt", rejId, rej.tx);

  // CustodyCheck Match on ACCEPT finding
  console.log("\n=== CustodyCheck ===");
  const fileBytes = await readFile(listing);
  const commit = evidenceCommitment(salt, fileBytes);
  const check = await callWriter(
    "record_custody_check",
    {
      case_id: CASE,
      evidence_commitment: Array.from(commit),
      expected_receipt_id: accept.receiptId,
      matched: true,
    },
    { outDir: SEED }
  );
  n = await receiptCount();
  const checkId = n - 1;
  await rememberTx(SEED, checkId, check.tx);
  console.log("CustodyCheck receipt", checkId, check.tx);

  const summary = {
    fictional: true,
    case_id: CASE,
    salt: bytesToHex(salt),
    receipts: {
      accept: { id: accept.receiptId, tx: accept.tx },
      flag: { id: flag.receiptId, tx: flag.tx },
      hold: { id: holdR.receiptId, tx: holdR.tx },
      open_denied: { id: openDeniedId, tx: denied.tx },
      open: { id: openId, tx: opened.tx },
      rejection: { id: rejId, tx: rej.tx },
      custody_check: { id: checkId, tx: check.tx },
    },
    receipt_count_after: n,
  };
  await writeFile(join(SEED, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nSEED COMPLETE", JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
