/** One first-run wizard. Progress in localStorage. Wallet state lives in custos-wallet. */
export const SETUP_LS = "custos-setup";

export const SETUP_STEPS = [
  { id: "connect", n: 1, label: "Connect" },
  { id: "connected", n: 2, label: "Connected" },
  { id: "source", n: 3, label: "Source" },
  { id: "confirm", n: 4, label: "Confirm" },
];

export function defaultSetup() {
  return {
    step: "connect",
    completed: false,
    skipped: false,
    noWallet: false,
    source: null,
    evidenceName: "",
    salt: "",
    commitment: "",
    caseName: "Larkmoor Records Office",
    caseDesc: "File-transfer breach",
    caseId: "",
    highlightAnalyze: false,
  };
}

export const SETUP_SESS = "custos-setup-ephemeral";

export function loadSetup() {
  try {
    const durable = JSON.parse(localStorage.getItem(SETUP_LS) || "{}");
    delete durable.salt;
    let eph = {};
    try {
      eph = JSON.parse(sessionStorage.getItem(SETUP_SESS) || "{}");
    } catch {
      eph = {};
    }
    const s = { ...defaultSetup(), ...durable, salt: eph.salt || "" };
    if (s.step === "case") s.step = "confirm";
    if (!SETUP_STEPS.some((x) => x.id === s.step)) s.step = "connect";
    return s;
  } catch {
    return defaultSetup();
  }
}

export function saveSetup(s) {
  const { salt, ...durable } = s;
  localStorage.setItem(SETUP_LS, JSON.stringify(durable));
  sessionStorage.setItem(SETUP_SESS, JSON.stringify({ salt: salt || "" }));
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

export function setupValid(s, wallet) {
  if (s.step === "connect") return false;
  if (s.step === "connected") return Boolean(wallet?.connected && wallet.accountId);
  if (s.step === "source") return Boolean(s.commitment && s.evidenceName);
  if (s.step === "confirm") return Boolean(s.commitment);
  return false;
}
