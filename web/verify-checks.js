/** Live Verified-panel checks. Only statuses the analysis request actually sets. */

export const OFFLINE_DETAIL = "Independent offline check: npm run verify";
export const README_HREF =
  "https://github.com/Rahmandefi/custos-seal/blob/master/README.md#verify-without-an-api-key-screeners-start-here";

export const LIVE_CHECKS = [
  { id: "gateway_tcb", label: "Gateway TCB" },
  { id: "model_tcb", label: "Model report verified" },
  { id: "nonce", label: "Nonce" },
  { id: "signature", label: "provider_tee signature" },
  { id: "citations", label: "Citations P2" },
  { id: "write", label: "On-chain write" },
];

/** Rows that must pass for "Required checks passed". Nonce binding is not included. */
export const REQUIRED_CHECKS = LIVE_CHECKS.map((r) => r.id);

export const FRESHNESS_DETAIL =
  "Freshness: SDK attestation cache disabled (TTL 0)";

export const E2EE_CONFIGURED = true;
export const E2EE_DETAIL =
  "configured e2ee=true; X-Model-Pub-Key vs signing key was not available for comparison in this request";

export const OFFLINE_CHECK = {
  id: "offline",
  label: "Independent offline check: npm run verify",
  href: README_HREF,
};

export const OFFLINE_CHECKS = [OFFLINE_CHECK];

export const CHECK_ORDER = [
  ...LIVE_CHECKS.map((r) => ({ id: r.id, title: r.label, source: r.label })),
  { id: OFFLINE_CHECK.id, title: OFFLINE_CHECK.label, source: OFFLINE_DETAIL },
];

const LIVE = new Set(LIVE_CHECKS.map((r) => r.id));

export const ERROR_TO_ROW = {
  NONCE_INVALID: "nonce",
  NONCE_REUSED: "nonce",
  NONCE_BINDING: "nonce",
  TCB_NOT_UP_TO_DATE: "gateway_tcb",
  NOT_PROVIDER_TEE: "signature",
  SIGNER_MISMATCH: "signature",
  CITATION_MISMATCH: "citations",
  RECORDING_BLOCKED: "write",
  RECORDING_FAILED: "write",
  RECORDING_UNCONFIRMED: "write",
  RECORDING_MISMATCH: "write",
  ALLOWANCE_UNVERIFIED: "write",
  ALLOWANCE_EXHAUSTED: "write",
  WRITER_KEY_UNSAFE: "write",
  WRITER_KEY_UNVERIFIED: "write",
};

function labelFor(id) {
  return LIVE_CHECKS.find((r) => r.id === id)?.label || OFFLINE_CHECK.label || id;
}

function mapCheckId(id) {
  if (id === "recording") return "write";
  if (
    id === "independent_dcap" ||
    id === "gpu_nras" ||
    id === "nras" ||
    id === "rtmr3" ||
    id === "mrconfigid" ||
    id === "reportdata"
  ) {
    return "offline";
  }
  return id;
}

function formatEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return null;
  const parts = [];
  if (evidence.tcb_status) parts.push(`tcb ${evidence.tcb_status}`);
  if (evidence.signer) parts.push(`signer ${evidence.signer}`);
  if (evidence.signature_kind) parts.push(evidence.signature_kind);
  if (evidence.tx) parts.push(`tx ${evidence.tx}`);
  if (evidence.nonce) parts.push(`nonce ${evidence.nonce}`);
  if (evidence.receipt_id != null) parts.push(`receipt ${evidence.receipt_id}`);
  if (evidence.citation_count != null) parts.push(`${evidence.citation_count} citations`);
  return parts.length ? parts.join(" · ") : null;
}

export function emptyChecks() {
  const checks = {};
  for (const row of LIVE_CHECKS) {
    checks[row.id] = {
      id: row.id,
      label: row.label,
      title: row.label,
      status: "not_run",
      reason: null,
      detail: null,
      evidence: null,
    };
  }
  checks.offline = {
    id: OFFLINE_CHECK.id,
    label: OFFLINE_CHECK.label,
    title: OFFLINE_CHECK.label,
    status: "not_in_request",
    reason: OFFLINE_DETAIL,
    detail: OFFLINE_DETAIL,
    href: README_HREF,
    evidence: null,
  };
  return checks;
}

export function setCheck(checks, id, status, { reason = null, evidence = null, detail = null } = {}) {
  // Nonce binding is not a required app check: InferenceClient.verify() does not
  // return clientBinding.nonce, so the app cannot compare a caller-generated
  // nonce to report.request_nonce / REPORTDATA. Binding stays inside the SDK;
  // freshness is attested by attestationCacheTimeToLiveMs: 0.
  if (id === "nonce_binding") return checks;
  if (id === "independent_dcap") return checks;
  id = mapCheckId(id);
  const prev = checks[id] || {};
  const d = detail || reason || formatEvidence(evidence);
  checks[id] = {
    ...prev,
    id,
    label: prev.label || labelFor(id),
    title: prev.label || labelFor(id),
    status,
    reason: reason || d,
    detail: d,
    evidence,
  };
  return checks;
}

export function checksMap(checks) {
  if (!checks) return {};
  const o = Array.isArray(checks)
    ? Object.fromEntries(checks.map((c) => [c.id, c]))
    : { ...checks };
  if (o.write && !o.recording) o.recording = o.write;
  if (o.recording && !o.write) o.write = o.recording;
  return o;
}

export function toWireChecks(checks) {
  const m = checksMap(checks);
  const live = LIVE_CHECKS.map((meta) => {
    const c = m[meta.id] || {};
    return {
      id: meta.id,
      label: meta.label,
      status: c.status || "not_run",
      detail: c.detail || c.reason || formatEvidence(c.evidence) || null,
    };
  });
  const e2 = m.e2ee || {};
  live.push({
    id: "e2ee",
    label: "Prompt encryption check",
    status: e2.status || "not_run",
    detail: cE2eeDetail(e2) || E2EE_DETAIL,
  });
  live.push({
    id: OFFLINE_CHECK.id,
    label: OFFLINE_CHECK.label,
    status: "not_in_request",
    detail: OFFLINE_DETAIL,
    href: README_HREF,
  });
  return live;
}

function cE2eeDetail(row) {
  return row?.detail || row?.reason || null;
}

/** Compare quote-bound model pub key to the verified signing address (ed25519 / ECDSA). */
export function e2eePubKeyMatchesSigner(model) {
  const pub = model?.signingPublicKey;
  const addr =
    model?.signer?.signingAddress ??
    model?.signer?.signing_address ??
    (typeof model?.signer === "string" ? model.signer : null);
  if (!pub || !addr) return null;
  const p = fieldHex(pub);
  const a = fieldHex(addr);
  if (!p || !a) return null;
  if (p === a) return true;
  if (p.length === 130 && p.startsWith("04") && p.slice(2) === a) return true;
  return false;
}

export function e2eeCheckDetail({ configured = E2EE_CONFIGURED, matched = null } = {}) {
  const cfg = `configured e2ee=${configured ? "true" : "false"}`;
  if (matched === true) return `${cfg}; X-Model-Pub-Key matched the verified signing key`;
  if (matched === false) return `${cfg}; X-Model-Pub-Key did not match the verified signing key`;
  return `${cfg}; X-Model-Pub-Key vs signing key was not available for comparison in this request`;
}

export function failRowForError(code, checks) {
  const m = checksMap(checks);
  if (code === "TCB_NOT_UP_TO_DATE") {
    if (m.model_tcb?.status === "fail") return "model_tcb";
    if (m.gateway_tcb?.status === "fail") return "gateway_tcb";
    return "gateway_tcb";
  }
  return ERROR_TO_ROW[code] || null;
}

export function recordedRunChecks(receipt) {
  const f = receipt?.finding || {};
  const hashes = f.citation_hashes || [];
  const sigOk = Boolean(f.signature || f.signer_pubkey);
  const tcb = f.tcb_status || null;
  return [
    {
      id: "signature",
      label: "Signature checked on-chain at write time",
      status: sigOk ? "pass" : "not_run",
      detail: sigOk ? "ed25519_verify at record_finding" : "not stored on this receipt",
    },
    {
      id: "gateway_tcb",
      label: "TCB status stored",
      status: tcb ? "pass" : "not_run",
      detail: tcb || "not stored on this receipt",
    },
    {
      id: "citations",
      label: "Citation hashes stored",
      status: hashes.length ? "pass" : "not_run",
      detail: hashes.length ? `${hashes.length} citation hashes` : "not stored on this receipt",
    },
  ];
}

export function attestationNonceHex(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    const h = raw.replace(/^0x/i, "").toLowerCase();
    if (/^[0-9a-f]{64}$/.test(h)) return h;
    return null;
  }
  if (raw instanceof Uint8Array || Buffer.isBuffer?.(raw)) {
    const b = Buffer.from(raw);
    if (b.length === 32) return b.toString("hex");
    return null;
  }
  return null;
}

export function canRecord(checks) {
  const m = checksMap(checks);
  for (const id of ["gateway_tcb", "model_tcb", "nonce", "signature", "citations"]) {
    if (m[id]?.status !== "pass") return false;
  }
  return true;
}

export function requiredRows(checks) {
  const m = checksMap(checks);
  return REQUIRED_CHECKS.map((id) => m[id] || { id, status: "not_run" });
}

/** true when every required row has status pass. */
export function requiredChecksPassed(checks) {
  return requiredRows(checks).every((c) => c?.status === "pass");
}

/** true when a required row failed or still cannot run after analysis. */
export function requiredChecksWarned(checks) {
  return requiredRows(checks).some(
    (c) => c?.status === "fail" || c?.status === "not_run" || c?.status === "unsupported"
  );
}

export function shortHex(hex) {
  const h = String(hex || "");
  if (h.length < 16) return h || null;
  return h.slice(0, 8) + "…" + h.slice(-8);
}

export function fieldHex(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return Buffer.from(v).toString("hex").toLowerCase();
  if (typeof v === "string") return v.replace(/^0x/i, "").toLowerCase();
  if (v instanceof Uint8Array || Buffer.isBuffer?.(v)) return Buffer.from(v).toString("hex").toLowerCase();
  return "";
}

export function txExecutionState(outcome) {
  if (!outcome || typeof outcome !== "object") return "unknown";
  const st = outcome.status;
  if (st == null || typeof st !== "object") return "unknown";
  const failed = Object.prototype.hasOwnProperty.call(st, "Failure");
  const ok = Object.prototype.hasOwnProperty.call(st, "SuccessValue");
  const isFinal = outcome.final_execution_status === "FINAL";
  if (failed) return "failure";
  if (ok && isFinal) return "final_success";
  if (ok && !isFinal) return "pending";
  return "unknown";
}

export function receiptMatchesIntended(onchain, intended) {
  if (!onchain || !intended) return false;
  if (String(onchain.case_id || "") !== String(intended.case_id || "")) return false;
  const f = onchain.finding || {};
  if (fieldHex(f.finding_hash) !== fieldHex(intended.finding_hash)) return false;
  if (fieldHex(f.nonce) !== fieldHex(intended.nonce)) return false;
  const commit = onchain.evidence_commitments?.[0];
  if (fieldHex(commit) !== fieldHex(intended.evidence_commitment)) return false;
  return true;
}

export function limitationLabels(checks) {
  if (!checks) return [];
  const m = checksMap(checks);
  return LIVE_CHECKS.filter((r) => m[r.id]?.status === "unsupported").map((r) => r.label);
}

export function overallVerification(checks, analyze = {}) {
  if (analyze?.recordedRun) return "recorded";
  if (!checks) return analyze.error ? "failed" : "unavailable";
  const m = checksMap(checks);
  const live = LIVE_CHECKS.map((r) => m[r.id]);
  if (live.some((c) => c?.status === "fail")) return "failed";
  if (m.write?.status === "pass" && canRecord(checks)) {
    if (live.some((c) => c?.status === "not_run")) return "incomplete";
    return "verified";
  }
  if (live.every((c) => !c || c.status === "not_run" || c.status === "not_in_request" || c.status === "unsupported")) {
    return analyze.error ? "failed" : "unavailable";
  }
  return "incomplete";
}

export function fromAnalyzeTransportFailure({ kind, error, tx = null, checks = null } = {}) {
  const msg = error?.message || String(error || kind || "transport failure");
  return {
    done: true,
    error: msg,
    skip_chain: false,
    skipChain: false,
    code: "ANALYSIS_OUTCOME_UNKNOWN",
    execution: "unknown",
    client_outcome: kind || "unknown",
    tx: tx || null,
    checks: checks || emptyChecks(),
  };
}

export function fromAnalyzeHttp({ ok, status, data, parseError, tx = null, checks = null } = {}) {
  if (parseError) {
    return fromAnalyzeTransportFailure({
      kind: "invalid_json",
      error: parseError,
      tx,
      checks,
    });
  }
  if (!ok) {
    const payload = data && typeof data === "object" ? data : {};
    return {
      done: true,
      error: payload.error || `HTTP ${status}`,
      skip_chain: payload.skip_chain === true,
      skipChain: payload.skip_chain === true,
      code: payload.code || "HTTP_ERROR",
      execution: payload.execution || null,
      tx: payload.tx || tx || null,
      checks: payload.checks || checks || emptyChecks(),
    };
  }
  return { done: true, ...data, skip_chain: data?.skip_chain === true, skipChain: data?.skip_chain === true };
}

export function errorCopy(analyze) {
  if (!analyze || (!analyze.error && analyze.overall !== "failed" && !analyze.code)) return null;
  const mapped = checksMap(analyze.checks);
  const tx = analyze.tx || mapped.write?.evidence?.tx || mapped.recording?.evidence?.tx || null;
  const execution = analyze.execution || null;
  const skipChain = analyze.skip_chain ?? analyze.skipChain ?? true;
  const code = analyze.code;
  if (code === "ANALYSIS_OUTCOME_UNKNOWN") {
    const before = analyze.receipt_count_before;
    const after = analyze.receipt_count_after;
    const appeared = analyze.new_receipt_for_case;
    let countNote = null;
    if (before != null && after != null) {
      countNote =
        appeared != null
          ? appeared
            ? `receipt_count ${before} → ${after}; a new receipt appeared for this case.`
            : `receipt_count ${before} → ${after}; no new receipt for this case.`
          : `receipt_count ${before} → ${after}.`;
    }
    return {
      chip: "Unable to verify",
      headline: "Analysis outcome unknown; a receipt may exist.",
      body: [tx ? `Transaction ${tx}.` : null, countNote, "Do not automatically resubmit."]
        .filter(Boolean)
        .join(" "),
      skipChain: false,
      tx,
    };
  }
  if (execution === "failure") {
    return {
      chip: "Unable to verify",
      headline: "Transaction failed",
      body: tx
        ? `Transaction ${tx}. Do not automatically resubmit.`
        : "The submitted transaction did not succeed. Do not automatically resubmit.",
      skipChain: false,
      tx,
    };
  }
  if (
    execution === "pending" ||
    execution === "unknown" ||
    code === "RECORDING_UNCONFIRMED"
  ) {
    return {
      chip: "Unable to verify",
      headline: "Recording not confirmed; a receipt may exist",
      body: tx ? `Transaction ${tx}.` : null,
      skipChain: false,
      tx,
    };
  }
  if (code === "RECORDING_MISMATCH" || execution === "mismatch") {
    return {
      chip: "Unable to verify",
      headline: "On-chain receipt does not match the intended write",
      body: tx ? `Transaction ${tx}.` : null,
      skipChain: false,
      tx,
    };
  }
  if (skipChain) {
    return {
      chip: "Unable to verify",
      headline: "No receipt was written",
      body: "The contract was not called.",
      skipChain: true,
      tx: null,
    };
  }
  if (code === "RECORDING_FAILED" || mapped.write?.status === "fail") {
    return {
      chip: "Unable to verify",
      headline: "No receipt was written",
      body: tx ? `Transaction ${tx}.` : "The contract rejected the write.",
      skipChain: false,
      tx,
    };
  }
  return {
    chip: "Unable to verify",
    headline: "Recording not confirmed; a receipt may exist",
    body: tx ? `Transaction ${tx}.` : null,
    skipChain: false,
    tx,
  };
}

/**
 * Header chip + tone.
 * - idle: "No analysis yet" (neutral)
 * - all required pass: "Required checks passed" (ok)
 * - warn/bad only when a required check fails or can't run
 */
export function headerChip(analyze) {
  if (!analyze || (!analyze.done && !analyze.running && !analyze.recordedRun && !analyze.error && !analyze.checks)) {
    return { chip: "No analysis yet", tone: "idle", overall: "idle" };
  }
  if (analyze?.running && !analyze?.done) {
    return { chip: "Analyzing", tone: "idle", overall: "pending" };
  }
  if (analyze?.recordedRun) {
    return { chip: "Recorded run", tone: "idle", overall: "recorded" };
  }
  const checks = analyze?.checks;
  if (!checks) {
    if (analyze?.error) return { chip: "Unable to verify", tone: "bad", overall: "failed" };
    return { chip: "No analysis yet", tone: "idle", overall: "unavailable" };
  }
  const overall = overallVerification(checks, analyze);
  if (requiredChecksPassed(checks)) {
    return { chip: "Required checks passed", tone: "ok", overall };
  }
  if (requiredChecksWarned(checks) || overall === "failed" || analyze?.error) {
    const tone = overall === "failed" || requiredRows(checks).some((c) => c?.status === "fail") ? "bad" : "warn";
    return {
      chip: overall === "failed" ? "Unable to verify" : "Verification incomplete",
      tone,
      overall,
    };
  }
  return { chip: "No analysis yet", tone: "idle", overall };
}

/** UI mapping. Ignores timer ticks. Missing checks stay unverified. */
export function panelView(analyze) {
  if (analyze?.running && !analyze?.done) {
    return {
      title: "Verified panel",
      chip: "Analyzing",
      tone: "idle",
      pending: true,
      overall: "pending",
      headline: "Takes about a minute",
      body: null,
      rows: [],
    };
  }
  if (analyze?.recordedRun) {
    const rows = recordedRunChecks(analyze.receipt);
    return {
      title: "Recorded run",
      chip: "Recorded run",
      tone: "idle",
      overall: "recorded",
      headline: null,
      body: null,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.label,
        label: r.label,
        status: r.status,
        reason: r.detail,
        detail: r.detail,
        evidence: null,
      })),
    };
  }
  const checks = analyze?.checks;
  const copy = errorCopy(analyze);
  if (!checks) {
    const failed = Boolean(analyze?.error);
    const head = headerChip(analyze);
    return {
      title: "Verified panel",
      chip: head.chip,
      tone: head.tone,
      overall: failed ? "failed" : head.overall,
      pending: false,
      headline: copy?.headline || null,
      body: copy?.body || null,
      rows: [],
    };
  }
  const overall = overallVerification(checks, analyze);
  const wire = toWireChecks(checks);
  const head = headerChip(analyze);
  const header =
    overall === "failed" && checksMap(checks).write?.status !== "pass"
      ? "No receipt was written"
      : copy?.headline || null;
  return {
    title: "Verified panel",
    chip: head.chip,
    tone: head.tone,
    overall,
    pending: false,
    headline: header,
    body: copy?.body || null,
    rows: wire.map((r) => {
      const m = checksMap(checks);
      return {
        id: r.id,
        title: r.label,
        label: r.label,
        status: r.status,
        reason: r.detail,
        detail: r.detail,
        href: r.href || m[r.id]?.href || null,
        evidence: m[r.id]?.evidence || null,
      };
    }),
  };
}

export function freshAnalyzeState() {
  return { running: true };
}
