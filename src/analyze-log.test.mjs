import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeAnalyzeErrorLog, logAnalyzeError } from "./analyze-log.mjs";
import { analyzeEvidence, PipelineError } from "./pipeline.mjs";

test("sanitizeAnalyzeErrorLog keeps attempt, stage, code, elapsed_ms only", () => {
  const out = sanitizeAnalyzeErrorLog({
    attempt: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    stage: "recording",
    code: "RECORDING_FAILED",
    elapsed_ms: 12.4,
    message: "wwwroot\\human2.aspx quote leaked",
    evidence: "secret-bytes",
    prompt: "system prompt",
    apiKey: "sk-live",
    token: "op-token",
    authorization: "Bearer abc",
    headers: { authorization: "Bearer abc" },
  });
  assert.deepEqual(Object.keys(out).sort(), [
    "attempt",
    "code",
    "elapsed_ms",
    "event",
    "stage",
  ]);
  assert.equal(out.event, "analyze_error");
  assert.equal(out.stage, "recording");
  assert.equal(out.code, "RECORDING_FAILED");
  assert.equal(out.elapsed_ms, 12);
  const blob = JSON.stringify(out);
  assert.doesNotMatch(blob, /human2|secret-bytes|system prompt|sk-live|op-token|Bearer/i);
});

test("sanitizeAnalyzeErrorLog drops unknown stages and unsafe codes", () => {
  const out = sanitizeAnalyzeErrorLog({
    attempt: "id;rm -rf",
    stage: "tee; cat /etc/passwd",
    code: "TCB_NOT_UP_TO_DATE; Authorization: Bearer xyz",
    elapsed_ms: -3,
  });
  assert.equal(out.stage, "unknown");
  assert.equal(out.code, "ERROR");
  assert.equal(out.elapsed_ms, 0);
  assert.doesNotMatch(JSON.stringify(out), /Bearer|passwd/i);
});

test("sanitizeAnalyzeErrorLog allowlists exact codes only", () => {
  assert.equal(
    sanitizeAnalyzeErrorLog({ code: "sk-live-token-like-string" }).code,
    "ERROR"
  );
  assert.equal(sanitizeAnalyzeErrorLog({ code: "RECORDING_FAILED extra" }).code, "ERROR");
  assert.equal(sanitizeAnalyzeErrorLog({ code: "RECORDING_FAILED" }).code, "RECORDING_FAILED");
});

test("logAnalyzeError writes one JSON line to the sink", () => {
  const lines = [];
  logAnalyzeError(
    { attempt: "att-1", stage: "nonce", code: "NONCE_INVALID", elapsed_ms: 5 },
    (s) => lines.push(s)
  );
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.attempt, "att-1");
  assert.equal(parsed.stage, "nonce");
  assert.equal(parsed.code, "NONCE_INVALID");
  assert.equal(parsed.elapsed_ms, 5);
});

const evidenceText =
  "alpha\nwwwroot\\human2.aspx  created 2023-06-01 02:39\nomega\n";

function teeStub(overrides = {}) {
  const nonce = overrides.nonce === undefined ? "bb".repeat(32) : overrides.nonce;
  return async () => ({
    attested: {
      tcbOk: true,
      gateway: { tcbStatus: "UpToDate", report: { nonce } },
      models: [{ tcbStatus: "UpToDate", report: { nonce } }],
    },
    completion: {
      id: "c1",
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [
                {
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
                },
              ],
            }),
          },
        },
      ],
    },
    verified: { signatureKind: overrides.signatureKind ?? "provider_tee" },
    sig: {
      signedText: `z-ai/glm-5.3-flash:${"11".repeat(32)}:${"22".repeat(32)}`,
      signature: "33".repeat(64),
      signer: "44".repeat(32),
    },
  });
}

test("pipeline stamps nonce stage on pre-write failure", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ft-alog-"));
  try {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: false,
      runDcap: false,
      tee: teeStub({ nonce: "deadbeef" }),
      allowanceFn: async () => ({ allowance: "1" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.ok(err instanceof PipelineError);
    assert.equal(err.code, "NONCE_INVALID");
    assert.equal(err.stage, "nonce");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("pipeline stamps recording stage on write failure", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ft-alog-"));
  try {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: true,
      runDcap: false,
      tee: teeStub(),
      allowanceFn: async () => ({ allowance: "100000000000000000000000" }),
      recordFindingFn: async () => ({ tx: "ok-tx" }),
      txStatusFn: async () => ({
        status: { Failure: { error_message: "boom" } },
        final_execution_status: "FINAL",
      }),
      getReceiptFn: async () => null,
      receiptCountFn: async () => 0,
      viewAccountFn: async () => ({ storage_usage: 1 }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_FAILED");
    assert.equal(err.stage, "recording");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
