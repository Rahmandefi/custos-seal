/** Live Verified-panel checks. Only statuses the analysis request actually sets. */

export const CHECK_ORDER = [
  {
    id: "gateway_tcb",
    title: "Gateway TCB",
    source: "InferenceClient.verify() tcbStatus, acceptedTcbStatuses UpToDate only",
  },
  {
    id: "model_tcb",
    title: "Model TCB",
    source: "InferenceClient.verify() model tcbStatus, acceptedTcbStatuses UpToDate only",
  },
  {
    id: "nonce",
    title: "Nonce from attested reports",
    source: "32-byte nonce on gateway/model reports; reject reuse. Does not parse quote REPORTDATA",
  },
  {
    id: "signature",
    title: "Reply signature kind",
    source: "verifyResponse() signatureKind must be provider_tee",
  },
  {
    id: "citations",
    title: "Citations",
    source: "Policy P2: quote bytes must appear in the uploaded evidence",
  },
  {
    id: "independent_dcap",
    title: "Independent DCAP (verify_report.py)",
    source: "Optional offline dcap-qvl on dumped quotes. Not RTMR3, MRCONFIGID, or NRAS",
  },
  {
    id: "recording",
    title: "Recorded in the custody log",
    source: "record_finding plus receipt_count increment. A transaction hash alone is not success",
  },
  {
    id: "rtmr3",
    title: "RTMR3 replay",
    source: "Not executed in this request",
  },
  {
    id: "mrconfigid",
    title: "MRCONFIGID",
    source: "Not executed in this request",
  },
  {
    id: "gpu_nras",
    title: "GPU evidence (NRAS)",
    source: "Not executed in this request",
  },
  {
    id: "prompt_e2ee",
    title: "Prompt encryption check",
    source: "SDK e2ee may be on; this request does not independently validate encryption",
  },
];

const LIVE = new Set([
  "gateway_tcb",
  "model_tcb",
  "nonce",
  "signature",
  "citations",
  "independent_dcap",
  "recording",
]);

export function emptyChecks() {
  const checks = {};
  for (const row of CHECK_ORDER) {
    checks[row.id] = {
      id: row.id,
      title: row.title,
      status: LIVE.has(row.id) ? "not_run" : "unsupported",
      reason: LIVE.has(row.id) ? null : row.source,
      evidence: null,
      source: row.source,
    };
  }
  return checks;
}

export function setCheck(checks, id, status, { reason = null, evidence = null } = {}) {
  const prev = checks[id] || {};
  checks[id] = {
    ...prev,
    id,
    title: prev.title || CHECK_ORDER.find((r) => r.id === id)?.title || id,
    status,
    reason,
    evidence,
    source: prev.source || CHECK_ORDER.find((r) => r.id === id)?.source || "",
  };
  return checks;
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
  for (const id of ["gateway_tcb", "model_tcb", "nonce", "signature", "citations"]) {
    if (checks[id]?.status !== "pass") return false;
  }
  if (checks.independent_dcap?.status === "fail") return false;
  return true;
}

export function overallVerification(checks) {
  if (!checks) return "unavailable";
  const live = CHECK_ORDER.filter((r) => LIVE.has(r.id)).map((r) => checks[r.id]);
  if (live.some((c) => c.status === "fail")) return "failed";
  if (checks.recording?.status === "pass" && canRecord(checks)) return "verified";
  if (live.every((c) => c.status === "not_run" || c.status === "unsupported")) return "unavailable";
  return "incomplete";
}

/** UI mapping. Ignores timer ticks. Missing checks stay unverified. */
export function panelView(analyze) {
  const checks = analyze?.checks;
  if (!checks) {
    return {
      chip: analyze?.running ? "Analyzing" : "Verification unavailable",
      overall: "unavailable",
      rows: CHECK_ORDER.map((r) => ({
        id: r.id,
        title: r.title,
        status: "not_run",
        reason: analyze?.running ? "In progress" : "No per-check evidence for this run",
        evidence: null,
      })),
    };
  }
  const overall = overallVerification(checks);
  const chip =
    analyze?.running && overall === "unavailable"
      ? "Analyzing"
      : overall === "verified"
        ? "Verified"
        : overall === "failed"
          ? "Unable to verify"
          : overall === "incomplete"
            ? "Verification incomplete"
            : "Verification unavailable";
  return {
    chip,
    overall,
    rows: CHECK_ORDER.map((r) => {
      const c = checks[r.id] || { status: "not_run" };
      return {
        id: r.id,
        title: r.title,
        status: c.status || "not_run",
        reason: c.reason || null,
        evidence: c.evidence || null,
      };
    }),
  };
}

export function freshAnalyzeState() {
  return { running: true, checks: emptyChecks() };
}
