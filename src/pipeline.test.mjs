import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEvidence, PipelineError } from "./pipeline.mjs";
import { receiptCount } from "./near.mjs";
import { panelView, failRowForError } from "../web/verify-checks.js";

function assertOwnRowRed(err, expectedId) {
  assert.ok(err instanceof PipelineError);
  const id = expectedId || failRowForError(err.code, err.checks);
  assert.equal(id, expectedId || id);
  const view = panelView({
    done: true,
    error: err.message,
    checks: err.checks,
    code: err.code,
    skip_chain: err.skipChain,
  });
  const row = view.rows.find((r) => r.id === expectedId);
  assert.equal(row?.status, "fail", `${err.code} should turn ${expectedId} red`);
  const liveFail = view.rows.filter(
    (r) => r.status === "fail" && !["reportdata", "rtmr3", "mrconfigid", "nras"].includes(r.id)
  );
  assert.ok(
    liveFail.every((r) => r.id === expectedId),
    `${err.code} extra red rows: ${liveFail.map((r) => r.id).join(",")}`
  );
}

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
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...noChain,
      tee: teeStub({ gwTcb: "OutOfDate" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "TCB_NOT_UP_TO_DATE");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "gateway_tcb");
  });
  assert.equal(await receiptCount(), before);
});

test("signature not provider_tee never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...noChain,
      tee: teeStub({ signatureKind: "gateway_only" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NOT_PROVIDER_TEE");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "signature");
  });
  assert.equal(await receiptCount(), before);
});

test("citation mismatch never calls contract", async () => {
  const before = await receiptCount();
  const finding = goodFinding();
  finding.citations[0].quote = "this quote is not in the file";
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...noChain,
      tee: teeStub({ finding }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "CITATION_MISMATCH");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "citations");
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
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...noChain,
      tee: teeStub({ nonce: "cc".repeat(32) }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NONCE_REUSED");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "nonce");
  });
  assert.equal(await receiptCount(), before);
});

test("unverified writer allowance never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: false,
      runDcap: false,
      tee: teeStub(),
      allowanceFn: async () => ({
        publicKey: null,
        allowance: null,
        error: "missing writer credentials",
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "ALLOWANCE_UNVERIFIED");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "write");
  });
  assert.equal(await receiptCount(), before);
});

test("writer allowance exhausted never calls contract", async () => {
  const before = await receiptCount();
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: false,
      runDcap: false,
      tee: teeStub(),
      allowanceFn: async () => ({ allowance: "0" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "ALLOWANCE_EXHAUSTED");
    assert.equal(err.skipChain, true);
    assertOwnRowRed(err, "write");
  });
  assert.equal(await receiptCount(), before);
});
