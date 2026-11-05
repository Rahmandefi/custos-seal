#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeEvidence } from "../src/pipeline.mjs";
import { loadEnv } from "../src/load-env.mjs";

await loadEnv();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || join(ROOT, "samples/larkmoor-listing.txt");

const evidenceBytes = await readFile(file);
const result = await analyzeEvidence({
  evidenceBytes,
  caseId: "larkmoor-demo",
  outDir: join(ROOT, "out"),
  root: ROOT,
  apiKey: process.env.NEAR_AI_API_KEY,
  writeOnChain: process.env.WRITE_CHAIN !== "0",
  runDcap: process.env.SKIP_DCAP !== "1",
});
console.log(
  JSON.stringify(
    {
      receipt_id: result.receiptId,
      tx: result.tx,
      salt: result.salt,
      storage_delta: result.storageDelta,
      storageBefore: result.storageBefore,
      storageAfter: result.storageAfter,
      finding_hash: result.receipt.finding_hash,
    },
    null,
    2
  )
);
