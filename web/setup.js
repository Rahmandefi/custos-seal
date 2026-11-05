/** Screen 1 first-run wizard. Existing features only. Progress in localStorage. */
export const SETUP_LS = "custos-setup";

export const SETUP_STEPS = [
  { id: "connect", n: 1, label: "Connect wallet" },
  { id: "source", n: 2, label: "Choose a source" },
  { id: "case", n: 3, label: "Create the case" },
  { id: "confirm", n: 4, label: "Confirm and go" },
];

export function defaultSetup() {
  return {
    step: "connect",
    completed: false,
    skipped: false,
    connected: false,
    source: null,
    evidenceName: "",
    salt: "",
    commitment: "",
    caseName: "",
    caseDesc: "",
    caseId: "larkmoor-demo",
    highlightAnalyze: false,
  };
}

export function loadSetup() {
  try {
    return { ...defaultSetup(), ...JSON.parse(localStorage.getItem(SETUP_LS) || "{}") };
  } catch {
    return defaultSetup();
  }
}

export function saveSetup(s) {
  localStorage.setItem(SETUP_LS, JSON.stringify(s));
}

export function setupIndex(step) {
  return SETUP_STEPS.findIndex((x) => x.id === step);
}

export function setupNext(step) {
  const i = setupIndex(step);
  return SETUP_STEPS[Math.min(SETUP_STEPS.length - 1, i + 1)].id;
}

export function setupPrev(step) {
  const i = setupIndex(step);
  return SETUP_STEPS[Math.max(0, i - 1)].id;
}

export function setupValid(s) {
  if (s.step === "connect") return Boolean(s.connected);
  if (s.step === "source") return Boolean(s.commitment && s.evidenceName);
  if (s.step === "case") return Boolean(s.caseName.trim() && s.caseDesc.trim());
  if (s.step === "confirm") return s.connected && s.commitment && s.caseName;
  return false;
}

export function shortAccount(id) {
  const a = String(id || "");
  if (a.length < 18) return a;
  return `${a.slice(0, 8)}…${a.slice(-8)}`;
}
