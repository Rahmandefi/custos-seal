/**
 * Verified panel truthfulness regression
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEvidence, PipelineError, classifySdkError } from "./pipeline.mjs";
import {
  emptyChecks,
  panelView,
  overallVerification,
  freshAnalyzeState,
  txExecutionState,
  errorCopy,
  fromAnalyzeTransportFailure,
  fromAnalyzeHttp,
  checksMap,
  toWireChecks,
  OFFLINE_DETAIL,
} from "../web/verify-checks.js";

function C(x) {
  return checksMap(x?.checks ?? x);
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
  const nonce = overrides.nonce === undefined ? "bb".repeat(32) : overrides.nonce;
  return async () => ({
    ...(Object.prototype.hasOwnProperty.call(overrides, "requestNonce")
      ? { requestNonce: overrides.requestNonce }
      : {}),
    attested: {
      tcbOk: overrides.tcbOk ?? true,
      gateway: {
        tcbStatus: overrides.gwTcb === undefined ? "UpToDate" : overrides.gwTcb,
        report: { nonce: overrides.gwNonce ?? nonce },
      },
      models: [
        {
          tcbStatus: overrides.modelTcb === undefined ? "UpToDate" : overrides.modelTcb,
          report: { nonce },
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

function chainFns({ txStatus, getReceipt, receiptCount = 8 } = {}) {
  let stored = null;
  return {
    writeOnChain: true,
    runDcap: false,
    allowanceFn: local.allowanceFn,
    recordFindingFn: async (args) => {
      stored = args;
      return { tx: "ok-tx", receipt_id: 7 };
    },
    txStatusFn: async () =>
      txStatus ?? {
        status: { SuccessValue: "" },
        final_execution_status: "FINAL",
        receipt_id: 7,
      },
    getReceiptFn: async (id) => {
      if (getReceipt) return getReceipt(id, stored);
      return {
        id,
        case_id: stored.case_id,
        evidence_commitments: stored.evidence_commitments,
        finding: stored.finding,
      };
    },
    receiptCountFn: async () => receiptCount,
    viewAccountFn: async () => ({ storage_usage: 1 }),
    _stored: () => stored,
  };
}

async function withTmp(fn) {
  const outDir = await mkdtemp(join(tmpdir(), "ft-vp-"));
  try {
    return await fn(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

const local = {
  writeOnChain: false,
  runDcap: false,
  allowanceFn: async () => ({ allowance: "100000000000000000000000" }),
};

function asAnalyze(err) {
  return {
    done: true,
    error: err.message,
    checks: err.checks,
    skip_chain: err.skipChain,
    skipChain: err.skipChain,
    tx: err.tx,
    code: err.code,
    execution: err.execution,
  };
}

test("Verified panel truthfulness regression: valid evidence only executed checks can pass", async () => {
  await withTmp(async (outDir) => {
    const result = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub(),
    });
    const c = C(result);
    assert.equal(c.gateway_tcb.status, "pass");
    assert.match(c.gateway_tcb.detail, /UpToDate/);
    assert.equal(c.model_tcb.status, "pass");
    assert.equal(c.nonce.status, "pass");
    assert.equal(c.signature.status, "pass");
    assert.match(String(c.signature.detail), /provider_tee/);
    assert.equal(c.citations.status, "pass");
    assert.equal(c.write.status, "not_run");
    assert.equal(c.offline.status, "not_in_request");
    assert.equal(c.offline.detail, OFFLINE_DETAIL);
    assert.equal(overallVerification(result.checks), "incomplete");
    const view = panelView({ done: true, checks: result.checks });
    assert.equal(view.rows.filter((r) => r.id === "offline").length, 1);
    assert.equal(view.rows.find((r) => r.id === "offline").status, "not_in_request");
    assert.equal(view.rows.find((r) => r.id === "rtmr3"), undefined);
    assert.ok(
      view.rows.every(
        (r) =>
          r.status !== "pass" ||
          ["gateway_tcb", "model_tcb", "nonce", "signature", "citations"].includes(r.id)
      )
    );
  });
});

test("Verified panel truthfulness regression: malformed nonce fails, recording not called, later checks do not pass", async () => {
  await withTmp(async (outDir) => {
    let recorded = 0;
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          writeOnChain: true,
          runDcap: false,
          tee: teeStub({ nonce: "not-a-32-byte-nonce" }),
          allowanceFn: local.allowanceFn,
          recordFindingFn: async () => {
            recorded += 1;
            return { tx: "fake" };
          },
          receiptCountFn: async () => 0,
          viewAccountFn: async () => ({ storage_usage: 0 }),
        }),
      (e) => e instanceof PipelineError && e.code === "NONCE_INVALID" && e.checks.nonce.status === "fail"
    );
    assert.equal(recorded, 0);
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub({ nonce: "deadbeef" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NONCE_INVALID");
    assert.equal(err.checks.nonce.status, "fail");
    assert.equal(err.checks.signature.status, "not_run");
    assert.equal(err.checks.citations.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
    assert.ok(err.checks.signature.status !== "pass");
    assert.ok(err.checks.citations.status !== "pass");
    assert.ok(err.checks.write.status !== "pass");
    assert.equal(err.skipChain, true);
    assert.equal(err.tx, null);
    const view = panelView(asAnalyze(err));
    const copy = errorCopy(asAnalyze(err));
    assert.equal(view.chip, "Unable to verify");
    assert.equal(copy.headline, "No receipt was written");
    assert.equal(copy.body, "The contract was not called.");
    assert.equal(copy.skipChain, true);
  });
});

test("Verified panel truthfulness regression: valid nonce that differs from request nonce fails binding", async () => {
  await withTmp(async (outDir) => {
    let recorded = 0;
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: true,
      runDcap: false,
      tee: teeStub({ nonce: "cc".repeat(32), requestNonce: "aa".repeat(32) }),
      allowanceFn: local.allowanceFn,
      recordFindingFn: async () => {
        recorded += 1;
        return { tx: "fake" };
      },
      txStatusFn: async () => ({ status: { SuccessValue: "" }, finality: "final" }),
      getReceiptFn: async () => null,
      receiptCountFn: async () => 0,
      viewAccountFn: async () => ({ storage_usage: 0 }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NONCE_BINDING");
    assert.equal(err.checks.nonce.status, "fail");
    assert.equal(err.checks.signature.status, "not_run");
    assert.equal(err.checks.citations.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
    assert.equal(recorded, 0);
  });
});

test("Verified panel truthfulness regression: binding unavailable when SDK omits request nonce", async () => {
  await withTmp(async (outDir) => {
    const result = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub({ requestNonce: null }),
    });
    assert.equal(result.checks.nonce.status, "pass");
    assert.equal(result.checks.write.status, "not_run");
  });
});

test("Verified panel truthfulness regression: non-provider_tee signature fails, recording not called", async () => {
  await withTmp(async (outDir) => {
    let recorded = 0;
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      writeOnChain: true,
      runDcap: false,
      tee: teeStub({ signatureKind: "gateway_only" }),
      allowanceFn: local.allowanceFn,
      recordFindingFn: async () => {
        recorded += 1;
        return { tx: "fake" };
      },
      receiptCountFn: async () => 0,
      viewAccountFn: async () => ({ storage_usage: 0 }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NOT_PROVIDER_TEE");
    assert.equal(err.checks.signature.status, "fail");
    assert.equal(err.checks.nonce.status, "pass");
    assert.equal(err.checks.citations.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
    assert.equal(recorded, 0);
  });
});

test("Verified panel truthfulness regression: gateway TCB failure", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub({ gwTcb: "OutOfDate" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "TCB_NOT_UP_TO_DATE");
    assert.equal(err.checks.gateway_tcb.status, "fail");
    assert.equal(err.checks.gateway_tcb.evidence.tcb_status, "OutOfDate");
    assert.equal(err.checks.nonce.status, "not_run");
    assert.equal(err.checks.signature.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
  });
});

test("Verified panel truthfulness regression: model TCB failure", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub({ modelTcb: "Revoked" }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.checks.model_tcb.status, "fail");
    assert.equal(err.checks.model_tcb.evidence.tcb_status, "Revoked");
    assert.equal(err.checks.write.status, "not_run");
  });
});

test("Verified panel truthfulness regression: failed transaction does not pass Recording", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns({
        txStatus: { status: { Failure: { error_message: "boom" } }, final_execution_status: "FINAL" },
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_FAILED");
    assert.equal(err.checks.write.status, "fail");
    assert.notEqual(err.checks.write.status, "pass");
    assert.equal(err.skipChain, false);
    assert.equal(err.execution, "failure");
    assert.equal(err.tx, "ok-tx");
    const copy = errorCopy(asAnalyze(err));
    const view = panelView(asAnalyze(err));
    assert.equal(view.chip, "Unable to verify");
    assert.equal(copy.headline, "Transaction failed");
    assert.match(copy.body, /Do not automatically resubmit/);
    assert.match(copy.body, /ok-tx/);
    assert.ok(!/The contract was not called/.test(copy.body || ""));
    assert.ok(!/No verified finding was recorded/.test(copy.headline));
  });
});

test("Verified panel truthfulness regression: pending transaction remains unconfirmed", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns({
        txStatus: { status: { SuccessValue: "" }, final_execution_status: "EXECUTED_OPTIMISTIC" },
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_UNCONFIRMED");
    assert.equal(err.checks.write.status, "fail");
    assert.notEqual(err.checks.write.status, "pass");
    assert.equal(err.skipChain, false);
    assert.equal(err.execution, "pending");
    assert.equal(err.tx, "ok-tx");
    const copy = errorCopy(asAnalyze(err));
    const view = panelView(asAnalyze(err));
    assert.equal(view.chip, "Unable to verify");
    assert.equal(copy.headline, "Recording not confirmed; a receipt may exist");
    assert.match(copy.body, /ok-tx/);
    assert.ok(!/The contract was not called/.test(copy.body || ""));
    assert.ok(!/No verified finding was recorded/.test(copy.headline));
    assert.ok(!/Transaction failed/.test(copy.headline));
  });
});

test("Verified panel truthfulness regression: unrelated receipt increasing count does not pass Recording", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns({
        txStatus: { status: { SuccessValue: "" }, final_execution_status: "FINAL" },
        receiptCount: 12,
        getReceipt: () => ({
          id: 11,
          case_id: "unrelated-case",
          evidence_commitments: [new Array(32).fill(1)],
          finding: { finding_hash: new Array(32).fill(2), nonce: new Array(32).fill(3) },
        }),
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_MISMATCH");
    assert.equal(err.checks.write.status, "fail");
    assert.equal(err.skipChain, false);
    assert.equal(err.execution, "mismatch");
    assert.equal(err.tx, "ok-tx");
    const copy = errorCopy(asAnalyze(err));
    assert.equal(copy.headline, "On-chain receipt does not match the intended write");
    assert.match(copy.body, /ok-tx/);
    assert.ok(!/The contract was not called/.test(copy.body || ""));
  });
});

test("Verified panel truthfulness regression: receipt with mismatched fields does not pass Recording", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns({
        getReceipt: (_id, stored) => ({
          id: 7,
          case_id: stored.case_id,
          evidence_commitments: stored.evidence_commitments,
          finding: {
            ...stored.finding,
            nonce: new Array(32).fill(9),
          },
        }),
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_MISMATCH");
    assert.equal(err.checks.write.status, "fail");
    assert.equal(err.skipChain, false);
    assert.equal(err.tx, "ok-tx");
    const copy = errorCopy(asAnalyze(err));
    const view = panelView(asAnalyze(err));
    assert.equal(view.chip, "Unable to verify");
    assert.equal(copy.headline, "On-chain receipt does not match the intended write");
    assert.match(copy.body, /ok-tx/);
  });
});

test("Verified panel truthfulness regression: missing and offline-only evidence stay unverified or unsupported", () => {
  const checks = emptyChecks();
  assert.equal(checks.offline.status, "not_in_request");
  const view = panelView({ done: true, checks });
  assert.equal(view.overall, "unavailable");
  assert.ok(view.rows.every((r) => r.status === "not_run" || r.status === "not_in_request"));
  assert.equal(view.rows.filter((r) => r.id === "offline").length, 1);
  const none = panelView(null);
  assert.equal(none.chip, "Verification unavailable");
  assert.equal(none.rows.length, 0);
});

test("Verified panel truthfulness regression: new run and failed run cannot display stale green results", () => {
  const stale = emptyChecks();
  stale.gateway_tcb.status = "pass";
  stale.write.status = "pass";
  const fresh = freshAnalyzeState();
  assert.equal(fresh.running, true);
  assert.equal(fresh.checks, undefined);
  const failedView = panelView({
    done: true,
    checks: {
      ...emptyChecks(),
      gateway_tcb: { status: "pass", title: "Gateway TCB" },
      model_tcb: { status: "pass", title: "Model TCB" },
      nonce: { status: "fail", title: "Nonce", reason: "bad nonce" },
    },
  });
  assert.equal(failedView.rows.find((r) => r.id === "nonce").status, "fail");
  assert.equal(failedView.rows.find((r) => r.id === "write").status, "not_run");
  assert.ok(failedView.rows.find((r) => r.id === "write").status !== "pass");
  const next = panelView(freshAnalyzeState());
  assert.equal(next.pending, true);
  assert.equal(next.rows.length, 0);
});

test("Verified panel truthfulness regression: no timer advances verification status", () => {
  const view = panelView({ running: true, tick: 99 });
  assert.equal(view.pending, true);
  assert.equal(view.rows.length, 0);
  assert.equal(view.chip, "Analyzing");
  const withEmpty = panelView({ running: true, tick: 99, checks: emptyChecks() });
  assert.equal(withEmpty.pending, true);
  assert.equal(withEmpty.rows.length, 0);
});

test("Verified panel truthfulness regression: confirmed recording is required for Verified", async () => {
  await withTmp(async (outDir) => {
    const result = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns(),
    });
    assert.equal(result.checks.write.status, "pass");
    assert.equal(result.checks.write.evidence.receipt_id, 7);
    assert.equal(overallVerification(result.checks), "verified");
    const view = panelView({ done: true, checks: result.checks });
    assert.equal(view.chip, "Verified");
  });
});

function sdkErr(code, details = {}) {
  const e = new Error(code);
  e.failure = { code, details };
  return e;
}

function goodAttested() {
  return {
    tcbOk: true,
    gateway: { tcbStatus: "UpToDate", report: { nonce: "bb".repeat(32) } },
    models: [{ tcbStatus: "UpToDate", report: { nonce: "bb".repeat(32) } }],
  };
}

function goodCompletion() {
  return {
    id: "c1",
    choices: [{ message: { content: JSON.stringify({ findings: [goodFinding()] }) } }],
  };
}

test("Verified panel truthfulness regression: NEAR RPC FINAL success, failure, non-final, missing status", () => {
  assert.equal(
    txExecutionState({
      status: { SuccessValue: "" },
      final_execution_status: "FINAL",
    }),
    "final_success"
  );
  assert.equal(
    txExecutionState({
      status: { Failure: { error_message: "x" } },
      final_execution_status: "FINAL",
    }),
    "failure"
  );
  assert.equal(
    txExecutionState({
      status: { SuccessValue: "" },
      final_execution_status: "EXECUTED_OPTIMISTIC",
    }),
    "pending"
  );
  assert.equal(txExecutionState({ final_execution_status: "FINAL" }), "unknown");
  assert.equal(txExecutionState({ status: "success", final: true, state: "final_success" }), "unknown");
});

test("Verified panel truthfulness regression: client.verify nonce mismatch maps to binding row", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      sdk: {
        verify: async () => {
          throw sdkErr("binding.nonce_mismatch", { source: "attestation.nonce" });
        },
      },
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NONCE_BINDING");
    assert.equal(err.checks.nonce.status, "fail");
    assert.equal(err.checks.nonce.evidence.stage, "verify");
    assert.equal(err.checks.nonce.evidence.code, "binding.nonce_mismatch");
    assert.equal(err.checks.signature.status, "not_run");
    assert.equal(err.checks.citations.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
  });
});

test("Verified panel truthfulness regression: client.verifyResponse signature.kind_mismatch maps to signature row", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      sdk: {
        verify: async () => goodAttested(),
        createCompletion: async () => goodCompletion(),
        verifyResponse: async () => {
          throw sdkErr("signature.kind_mismatch", { expected: "provider_tee", actual: "gateway" });
        },
        fetchSignature: async () => null,
      },
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "NOT_PROVIDER_TEE");
    assert.equal(err.checks.gateway_tcb.status, "pass");
    assert.equal(err.checks.model_tcb.status, "pass");
    assert.equal(err.checks.signature.status, "fail");
    assert.equal(err.checks.signature.evidence.stage, "verifyResponse");
    assert.equal(err.checks.citations.status, "not_run");
    assert.equal(err.checks.write.status, "not_run");
  });
});

test("Verified panel truthfulness regression: identifiable gateway TCB SDK error", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      sdk: {
        verify: async () => {
          throw sdkErr("policy.tcb_status_not_allowed", { actual: "OutOfDate", resource: "gateway" });
        },
      },
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.checks.gateway_tcb.status, "fail");
    assert.equal(err.checks.model_tcb.status, "not_run");
    assert.equal(err.checks.nonce.status, "not_run");
  });
});

test("Verified panel truthfulness regression: ambiguous SDK error does not guess a row", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      sdk: {
        verify: async () => {
          throw sdkErr("api.transport_failed", { resource: "model_attestation", reason: "request" });
        },
      },
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "SDK_ERROR");
    assert.equal(
      classifySdkError(sdkErr("api.transport_failed", { resource: "model_attestation" }), "verify").row,
      null
    );
    assert.equal(err.checks.gateway_tcb.status, "not_run");
    assert.equal(err.checks.nonce.status, "not_run");
    assert.equal(err.checks.signature.status, "not_run");
    assert.equal(err.skipChain, true);
    const view = panelView(asAnalyze(err));
    const copy = errorCopy(asAnalyze(err));
    assert.equal(view.chip, "Unable to verify");
    assert.notEqual(view.chip, "Verification unavailable");
    assert.ok(view.rows.every((r) => r.status === "not_run" || r.status === "not_in_request"));
    assert.ok(!view.rows.some((r) => r.status === "fail"));
    assert.equal(copy.headline, "No receipt was written");
    assert.equal(copy.body, "The contract was not called.");
  });
});

test("sample mode panel is Recorded run with receipt-proved rows only", () => {
  const view = panelView({
    recordedRun: true,
    receipt: {
      finding: {
        signature: "aa",
        signer_pubkey: "bb",
        tcb_status: "UpToDate",
        citation_hashes: ["cc", "dd"],
      },
    },
  });
  assert.equal(view.title, "Recorded run");
  assert.equal(view.chip, "Recorded run");
  assert.deepEqual(
    view.rows.map((r) => r.id),
    ["signature", "gateway_tcb", "citations"]
  );
  assert.ok(view.rows.every((r) => r.status === "pass"));
});

test("Verified panel truthfulness regression: missing status never passes Recording", async () => {
  await withTmp(async (outDir) => {
    const err = await analyzeEvidence({
      evidenceText,
      outDir,
      tee: teeStub(),
      ...chainFns({
        txStatus: { final_execution_status: "FINAL" },
      }),
    }).then(
      () => null,
      (e) => e
    );
    assert.equal(err.code, "RECORDING_UNCONFIRMED");
    assert.notEqual(err.checks.write.status, "pass");
    assert.equal(err.skipChain, false);
    assert.equal(err.execution, "unknown");
    assert.equal(err.tx, "ok-tx");
    const copy = errorCopy(asAnalyze(err));
    assert.equal(copy.headline, "Recording not confirmed; a receipt may exist");
    assert.match(copy.body, /ok-tx/);
  });
});

function assertUnknownOutcome(analyze) {
  const copy = errorCopy(analyze);
  const view = panelView(analyze);
  assert.equal(analyze.skip_chain, false);
  assert.equal(analyze.skipChain, false);
  assert.equal(analyze.code, "ANALYSIS_OUTCOME_UNKNOWN");
  assert.equal(view.chip, "Unable to verify");
  assert.equal(copy.headline, "Analysis outcome unknown; a receipt may exist.");
  assert.match(copy.body, /Do not automatically resubmit/);
  assert.ok(!/The contract was not called/.test(copy.body || ""));
  assert.ok(!/The contract was not called/.test(copy.headline || ""));
  assert.ok(!view.rows.some((r) => r.status === "fail"));
}

test("Verified panel truthfulness regression: analyze network error is outcome unknown", () => {
  const analyze = fromAnalyzeTransportFailure({
    kind: "network",
    error: new TypeError("Failed to fetch"),
    checks: emptyChecks(),
  });
  assert.equal(analyze.client_outcome, "network");
  assertUnknownOutcome(analyze);
  assert.equal(analyze.tx, null);
});

test("Verified panel truthfulness regression: analyze timeout is outcome unknown", () => {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  const analyze = fromAnalyzeTransportFailure({
    kind: "timeout",
    error: err,
    tx: "known-tx",
    checks: emptyChecks(),
  });
  assert.equal(analyze.client_outcome, "timeout");
  assert.equal(analyze.tx, "known-tx");
  assertUnknownOutcome(analyze);
  assert.match(errorCopy(analyze).body, /known-tx/);
});

test("Verified panel truthfulness regression: analyze invalid JSON is outcome unknown", () => {
  const analyze = fromAnalyzeHttp({
    ok: true,
    status: 200,
    parseError: new SyntaxError("Unexpected token < in JSON"),
    tx: null,
    checks: emptyChecks(),
  });
  assert.equal(analyze.client_outcome, "invalid_json");
  assertUnknownOutcome(analyze);
});

test("Verified panel truthfulness regression: null analysis with saved error does not throw", () => {
  const a = null;
  const walkError = "saved walk error";
  const copy = errorCopy(a) || {};
  assert.doesNotThrow(() => {
    void (copy.headline || copy.body || a?.error || walkError);
  });
  assert.throws(() => {
    void (copy.headline || copy.body || a.error || walkError);
  }, TypeError);
  const text = copy.headline || copy.body || a?.error || walkError;
  assert.equal(text, "saved walk error");
  const view = panelView(a);
  assert.equal(view.chip, "Verification unavailable");
});

test("Verified panel truthfulness regression: HTTP error without skip_chain does not infer contract skipped", () => {
  const analyze = fromAnalyzeHttp({
    ok: false,
    status: 502,
    data: { error: "bad gateway" },
    checks: emptyChecks(),
  });
  assert.equal(analyze.skip_chain, false);
  const copy = errorCopy(analyze);
  assert.ok(!/The contract was not called/.test(copy.body || ""));
});


