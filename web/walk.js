/** Guided walkthrough. Progress in localStorage. Sample items stay FICTIONAL. */
export const LS = "custos-walk";

export const BAR = [
  { id: "connect", n: 1, label: "Connect" },
  { id: "case", n: 2, label: "Case" },
  { id: "evidence", n: 3, label: "Evidence" },
  { id: "analyze", n: 4, label: "Analyze" },
  { id: "review", n: 5, label: "Review" },
  { id: "custody", n: 6, label: "Custody" },
  { id: "security", n: 7, label: "Security" },
  { id: "report", n: 8, label: "Report" },
];

const ORDER = [
  "land",
  "connect",
  "case",
  "evidence",
  "analyze",
  "review",
  "approvals",
  "custody",
  "access",
  "security",
  "report",
];

export function defaultWalk() {
  return {
    step: "land",
    completed: false,
    skipped: false,
    connected: false,
    caseName: "",
    caseDesc: "",
    caseId: "",
    evidenceName: "",
    evidenceText: "",
    salt: "",
    commitment: "",
    receiptId: null,
    policy: null,
    analyzeError: null,
    grantAccount: "",
    denied: [],
  };
}

export function loadWalk() {
  try {
    return { ...defaultWalk(), ...JSON.parse(localStorage.getItem(LS) || "{}") };
  } catch {
    return defaultWalk();
  }
}

export function saveWalk(w) {
  localStorage.setItem(LS, JSON.stringify(w));
}

export function barIndex(step) {
  if (step === "approvals") return 4;
  if (step === "access") return 5;
  if (step === "land") return -1;
  const i = BAR.findIndex((b) => b.id === step);
  return i;
}

export function routeForStep(step) {
  const m = {
    connect: "setup",
    case: "cases",
    evidence: "workspace",
    analyze: "analyze",
    review: "finding",
    approvals: "approvals",
    custody: "custody",
    access: "access",
    security: "security",
    report: "reports",
  };
  return m[step] || "cases";
}

export function nextStep(w) {
  const i = ORDER.indexOf(w.step);
  let n = ORDER[Math.min(ORDER.length - 1, i + 1)];
  if (w.step === "review" && String(w.policy || "").toUpperCase() !== "HOLD") {
    n = "custody";
  }
  if (w.step === "analyze" && w.analyzeError) return "analyze";
  return n;
}

export function prevStep(w) {
  const i = ORDER.indexOf(w.step);
  let p = ORDER[Math.max(0, i - 1)];
  if (w.step === "custody" && String(w.policy || "").toUpperCase() !== "HOLD") {
    p = "review";
  }
  if (p === "land") p = "connect";
  return p;
}

export function nextEnabled(w) {
  if (w.step === "connect") return Boolean(w.connected);
  if (w.step === "case") return Boolean(w.caseName && w.caseDesc);
  if (w.step === "evidence") return Boolean(w.commitment);
  if (w.step === "analyze") return Boolean(w.receiptId) && !w.analyzeError;
  if (w.step === "review") return true;
  if (w.step === "approvals") return true;
  if (w.step === "custody") return true;
  if (w.step === "access") return true;
  if (w.step === "security") return true;
  if (w.step === "report") return true;
  return false;
}

export function nextLabel(w) {
  if (w.step === "evidence") return "Next: run the analysis";
  if (w.step === "analyze") {
    if (w.analyzeError) return "Retry";
    return w.receiptId ? "Next: review the finding" : "Next: run the analysis";
  }
  if (w.step === "review") {
    return String(w.policy || "").toUpperCase() === "HOLD"
      ? "Next: review approvals"
      : "Next: check custody";
  }
  if (w.step === "approvals") return "Next: check custody";
  if (w.step === "custody") return "Next: access";
  if (w.step === "access") return "Next: security";
  if (w.step === "security") return "Next: report";
  if (w.step === "report") return "Finish";
  if (w.step === "connect") return "Next";
  if (w.step === "case") return "Next";
  return "Next";
}

export function holdReceipts(status) {
  return (status?.receipts || []).filter((r) => {
    const v = r.policy_verdict;
    const name = v && typeof v === "object" ? Object.keys(v)[0] || "" : String(v || "");
    return name.toUpperCase() === "HOLD";
  });
}

function kindName(k) {
  return k && typeof k === "object" ? Object.keys(k)[0] || "" : String(k || "");
}

/** Map heldReceiptId -> { decision: "Approval"|"Rejection", by: decisionReceiptId } */
export function decidedHolds(status) {
  const m = new Map();
  for (const r of status?.receipts || []) {
    const k = kindName(r.kind);
    if (k !== "Approval" && k !== "Rejection") continue;
    const id = Number(String(r.reason || "").match(/receipt=(\d+)/)?.[1]);
    if (Number.isFinite(id)) m.set(id, { decision: k, by: Number(r.id) });
  }
  return m;
}

export function pendingHolds(status) {
  const d = decidedHolds(status);
  return holdReceipts(status).filter((r) => !d.has(Number(r.id)));
}

export async function fileToB64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
