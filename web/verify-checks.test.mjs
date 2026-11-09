import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeEvidence } from "../src/pipeline.mjs";
import {
  panelView,
  fromAnalyzeHttp,
  fromAnalyzeTransportFailure,
  toWireChecks,
  LIVE_CHECKS,
  README_HREF,
  freshAnalyzeState,
  errorCopy,
  demoLimitFallbackAnalyze,
  DEMO_LIMIT_BANNER,
} from "./verify-checks.js";

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
  const verifiedSigner = overrides.verifiedSigner;
  const fetchedSigner = overrides.fetchedSigner ?? "44".repeat(32);
  const signerAddr = overrides.signerAddr ?? fetchedSigner;
  const signingPublicKey =
    overrides.signingPublicKey === undefined ? signerAddr : overrides.signingPublicKey;
  return async () => ({
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
          signer: { signingAlgo: "ed25519", signingAddress: signerAddr },
          ...(signingPublicKey != null ? { signingPublicKey } : {}),
        },
      ],
    },
    completion: {
      id: "test-completion",
      choices: [{ message: { content: JSON.stringify({ findings: [finding] }) } }],
    },
    verified: {
      signatureKind: overrides.signatureKind ?? "provider_tee",
      signature: verifiedSigner ? { signer: verifiedSigner } : undefined,
    },
    sig: {
      signedText: `z-ai/glm-5.3-flash:${"11".repeat(32)}:${"22".repeat(32)}`,
      signature: "33".repeat(64),
      signer: fetchedSigner,
    },
  });
}

const local = {
  writeOnChain: false,
  runDcap: false,
  allowanceFn: async () => ({ allowance: "100000000000000000000000" }),
};

async function withTmp(fn) {
  const outDir = await mkdtemp(join(tmpdir(), "ft-ui-"));
  try {
    return await fn(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

function renderPayload(payload) {
  const analyze = fromAnalyzeHttp({
    ok: false,
    status: 400,
    data: payload,
  });
  return { analyze, view: panelView(analyze) };
}

function asHttpPayload(err) {
  return {
    error: err.message,
    code: err.code,
    skip_chain: err.skipChain === true,
    checks: toWireChecks(err.checks),
    tx: err.tx || null,
    execution: err.execution || null,
  };
}

function assertCascade(view, failId, reasonRe) {
  const live = view.rows.filter((r) => r.id !== "offline" && r.id !== "e2ee");
  assert.deepEqual(
    live.map((r) => r.id),
    LIVE_CHECKS.map((r) => r.id)
  );
  const idx = live.findIndex((r) => r.id === failId);
  assert.ok(idx >= 0, `missing fail row ${failId}`);
  assert.equal(live[idx].status, "fail");
  assert.match(String(live[idx].detail || live[idx].reason), reasonRe);
  for (let i = 0; i < idx; i++) {
    assert.equal(live[i].status, "pass", `${live[i].id} should be green`);
    assert.ok(live[i].detail, `${live[i].id} needs a real value`);
  }
  for (let i = idx + 1; i < live.length; i++) {
    assert.equal(live[i].status, "not_run", `${live[i].id} should be not run`);
  }
  assert.equal(view.headline, "No receipt was written");
  const offline = view.rows.find((r) => r.id === "offline");
  assert.equal(offline.status, "not_in_request");
  assert.equal(offline.href, README_HREF);
  assert.match(offline.label, /Independent offline check: scripts\/verify_report\.py/);
  const e2ee = view.rows.find((r) => r.id === "e2ee");
  assert.equal(e2ee.label, "Prompt encryption check");
  assert.match(e2ee.detail, /configured e2ee=true/);
  assert.match(
    e2ee.detail,
    /X-Model-Pub-Key (matched the verified signing key|did not match the verified signing key|vs signing key was not available for comparison)/
  );
}

async function failAnalyze(outDir, opts) {
  return analyzeEvidence({
    evidenceText,
    outDir,
    ...local,
    ...opts,
  }).then(
    () => {
      throw new Error("expected pipeline failure");
    },
    (e) => e
  );
}

test("UI: gateway TCB failure paints only that row red", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, { tee: teeStub({ gwTcb: "OutOfDate" }) });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "gateway_tcb", /OutOfDate/);
  });
});

test("UI: model report failure paints only that row red", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, { tee: teeStub({ modelTcb: "Revoked" }) });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "model_tcb", /Revoked/);
    assert.match(view.rows.find((r) => r.id === "gateway_tcb").detail, /UpToDate/);
  });
});

test("UI: signature failure paints only that row red", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, { tee: teeStub({ signatureKind: "gateway_only" }) });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "signature", /gateway_only|signatureKind/);
  });
});

test("UI: citations P2 failure paints only that row red", async () => {
  await withTmp(async (outDir) => {
    const finding = goodFinding();
    finding.citations[0].quote = "this quote is not in the file";
    const err = await failAnalyze(outDir, { tee: teeStub({ finding }) });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "citations", /P2|citation/i);
  });
});

test("UI: nonce reuse paints only that row red", async () => {
  await withTmp(async (outDir) => {
    await analyzeEvidence({
      evidenceText,
      outDir,
      ...local,
      tee: teeStub({ nonce: "cc".repeat(32) }),
    });
    const err = await failAnalyze(outDir, { tee: teeStub({ nonce: "cc".repeat(32) }) });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "nonce", /already used|nonce/i);
  });
});

test("UI: allowance failure paints write red after live TEE rows", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, {
      allowanceFn: async () => ({ allowance: "0" }),
      tee: teeStub(),
    });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "write", /allowance|0/);
  });
});

test("UI: contract rejection (signer not approved) paints write red", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, {
      writeOnChain: true,
      runDcap: false,
      allowanceFn: local.allowanceFn,
      tee: teeStub(),
      recordFindingFn: async () => {
        throw new Error("signer not approved");
      },
      viewAccountFn: async () => ({ storage_usage: 1 }),
    });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "write", /signer not approved/);
  });
});

test("UI: contract rejection (replayed response) paints write red", async () => {
  await withTmp(async (outDir) => {
    const err = await failAnalyze(outDir, {
      writeOnChain: true,
      runDcap: false,
      allowanceFn: local.allowanceFn,
      tee: teeStub(),
      recordFindingFn: async () => {
        throw new Error("replayed response");
      },
      viewAccountFn: async () => ({ storage_usage: 1 }),
    });
    const { view } = renderPayload(asHttpPayload(err));
    assertCascade(view, "write", /replayed response/);
  });
});

test("UI: in-flight analyze is a single pending state with no rows", () => {
  const view = panelView(freshAnalyzeState());
  assert.equal(view.pending, true);
  assert.equal(view.rows.length, 0);
  assert.equal(view.chip, "Analyzing");
  assert.equal(view.headline, "Takes about a minute");
  assert.equal(view.tone, "idle");
});

test("UI: header chip idle / required passed / warn only on required fail", () => {
  const idle = panelView(null);
  assert.equal(idle.chip, "No analysis yet");
  assert.equal(idle.tone, "idle");

  const passed = panelView({
    done: true,
    checks: Object.fromEntries(
      LIVE_CHECKS.map((r) => [r.id, { id: r.id, status: "pass", detail: "ok" }])
    ),
  });
  assert.equal(passed.chip, "Required checks passed");
  assert.equal(passed.tone, "ok");

  const warned = panelView({
    done: true,
    checks: {
      ...Object.fromEntries(LIVE_CHECKS.map((r) => [r.id, { id: r.id, status: "pass" }])),
      citations: { id: "citations", status: "not_run", detail: "skipped" },
    },
  });
  assert.equal(warned.chip, "Verification incomplete");
  assert.equal(warned.tone, "warn");

  const failed = panelView({
    done: true,
    checks: {
      ...Object.fromEntries(LIVE_CHECKS.map((r) => [r.id, { id: r.id, status: "pass" }])),
      nonce: { id: "nonce", status: "fail", detail: "bad" },
    },
  });
  assert.equal(failed.tone, "bad");
});

test("UI: DEMO_LIMIT opens recorded sample run with rate-limit banner", () => {
  const receipt = {
    finding: {
      signature: "aa",
      signer_pubkey: "bb",
      tcb_status: "UpToDate",
      citation_hashes: ["cc"],
    },
  };
  const analyze = demoLimitFallbackAnalyze(receipt);
  assert.equal(analyze.demoLimitFallback, true);
  assert.equal(analyze.recordedRun, true);
  assert.equal(analyze.banner, DEMO_LIMIT_BANNER);
  assert.match(analyze.banner, /Live analysis is rate-limited; showing a recorded real run/);
  const view = panelView(analyze);
  assert.equal(view.title, "Recorded run");
  assert.equal(view.chip, "Recorded run");
  assert.ok(view.rows.length >= 1);
});

test("UI: unknown failure reports whether a new receipt appeared for this case", () => {
  const analyze = fromAnalyzeTransportFailure({ kind: "timeout", error: new Error("aborted") });
  analyze.receipt_count_before = 13;
  analyze.receipt_count_after = 13;
  analyze.new_receipt_for_case = false;
  const copy = errorCopy(analyze);
  assert.match(copy.body, /receipt_count 13 → 13/);
  assert.match(copy.body, /no new receipt for this case/);
});
