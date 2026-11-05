import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEvidence, PipelineError } from "./pipeline.mjs";
import { receiptCount } from "./near.mjs";

const evidenceText =
  "alpha\nwwwroot\\human2.aspx  created 2023-06-01 02:39\nomega\n";

function goodFinding() {
  return {
    claim: "webshell present",
    citations: [
      {
        evidence_id: "E1",
        line_start: 2,
        line_end: 2,
        quote: "wwwroot\\human2.aspx  created 2023-06-01 02:39",
      },
    ],
    iocs: ["human2.aspx"],
    recommended_actions: ["review"],
    confidence: 0.9,
  };
}

function teeStub(overrides = {}) {
  const finding = overrides.finding ?? goodFinding();
  return async () => ({
    attested: {
      tcbOk: overrides.tcbOk ?? true,
      gateway: { tcbStatus: overrides.gwTcb ?? "UpToDate", report: { nonce: "aa".repeat(32) } },
      models: [
        {
          tcbStatus: overrides.modelTcb ?? "UpToDate",
          report: { nonce: overrides.nonce ?? "bb".repeat(32) },
        },
      ],
    },
    completion: {
      id: "test-completion",
      choices: [{ message: { content: JSON.stringify({ findings: [finding] }) } }],
    },
    verified: { signatureKind: overrides.signatureKind ?? "provider_tee" },
    sig: {
      signedText: `z-ai/glm-5.3-flash:${"11".repeat(32)}:${"22".repeat(32)}`,
      signature: "33".repeat(64),
      signer: "44".repeat(32),
    },
  });
}

async function withTmp(fn) {
  const outDir = await mkdtemp(join(tmpdir(), "ft-"));
  try {
    return await fn(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

const noChain = {
  writeOnChain: false,
  runDcap: false,
  allowanceFn: async () => ({ allowance: "100000000000000000000000" }),
};

test("TCB not UpToDate never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          ...noChain,
          tee: teeStub({ gwTcb: "OutOfDate" }),
        }),
      (e) => e instanceof PipelineError && e.code === "TCB_NOT_UP_TO_DATE" && e.skipChain
    );
  });
  assert.equal(await receiptCount(), before);
});

test("signature not provider_tee never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          ...noChain,
          tee: teeStub({ signatureKind: "gateway_only" }),
        }),
      (e) => e instanceof PipelineError && e.code === "NOT_PROVIDER_TEE" && e.skipChain
    );
  });
  assert.equal(await receiptCount(), before);
});

test("citation mismatch never calls contract", async () => {
  const before = await receiptCount();
  const finding = goodFinding();
  finding.citations[0].quote = "this quote is not in the file";
  await withTmp(async (outDir) => {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          ...noChain,
          tee: teeStub({ finding }),
        }),
      (e) => e instanceof PipelineError && e.code === "CITATION_MISMATCH" && e.skipChain
    );
  });
  assert.equal(await receiptCount(), before);
});

test("reused nonce never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    await analyzeEvidence({
      evidenceText,
      outDir,
      ...noChain,
      tee: teeStub({ nonce: "cc".repeat(32) }),
    });
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          ...noChain,
          tee: teeStub({ nonce: "cc".repeat(32) }),
        }),
      (e) => e instanceof PipelineError && e.code === "NONCE_REUSED" && e.skipChain
    );
  });
  assert.equal(await receiptCount(), before);
});

test("writer allowance exhausted never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          writeOnChain: false,
          runDcap: false,
          tee: teeStub(),
          allowanceFn: async () => ({ allowance: "0" }),
        }),
      (e) => e instanceof PipelineError && e.code === "ALLOWANCE_EXHAUSTED" && e.skipChain
    );
  });
  assert.equal(await receiptCount(), before);
});
