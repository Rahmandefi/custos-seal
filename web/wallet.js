/** Investigator identity only. Receipt writes stay on the server writer key. */
export const WALLET_LS = "custos-wallet";
export const SELECTOR_VER = "8.10.2";

export function defaultWallet() {
  return { connected: false, accountId: "", error: "" };
}

export function loadWallet() {
  try {
    return { ...defaultWallet(), ...JSON.parse(localStorage.getItem(WALLET_LS) || "{}") };
  } catch {
    return defaultWallet();
  }
}

export function saveWallet(w) {
  const { error, ...rest } = w;
  localStorage.setItem(WALLET_LS, JSON.stringify(rest));
}

export function shortAccount(id) {
  const a = String(id || "");
  if (a.length < 18) return a;
  return `${a.slice(0, 8)}…${a.slice(-8)}`;
}

let selector = null;
let modal = null;

async function loadMods() {
  const [core, ui, my, meteor, here] = await Promise.all([
    import(`https://esm.sh/@near-wallet-selector/core@${SELECTOR_VER}`),
    import(`https://esm.sh/@near-wallet-selector/modal-ui@${SELECTOR_VER}`),
    import(`https://esm.sh/@near-wallet-selector/my-near-wallet@${SELECTOR_VER}`),
    import(`https://esm.sh/@near-wallet-selector/meteor-wallet@${SELECTOR_VER}`),
    import(`https://esm.sh/@near-wallet-selector/here-wallet@${SELECTOR_VER}`),
  ]);
  return { core, ui, my, meteor, here };
}

export async function ensureSelector() {
  if (selector) return { selector, modal };
  const { core, ui, my, meteor, here } = await loadMods();
  selector = await core.setupWalletSelector({
    network: "testnet",
    modules: [
      my.setupMyNearWallet({ walletUrl: "https://testnet.mynearwallet.com" }),
      meteor.setupMeteorWallet(),
      here.setupHereWallet(),
    ],
  });
  modal = ui.setupModal(selector, { contractId: "ftcust15e434.testnet" });
  return { selector, modal };
}

export async function syncFromSelector() {
  const w = loadWallet();
  try {
    const { selector: sel } = await ensureSelector();
    const state = sel.store.getState();
    const acc = state.accounts?.find((a) => a.active) || state.accounts?.[0];
    if (sel.isSignedIn() && acc?.accountId) {
      w.connected = true;
      w.accountId = acc.accountId;
      w.error = "";
    }
  } catch {
    /* keep stored wallet */
  }
  saveWallet(w);
  return w;
}

export async function openWalletPicker() {
  const { modal: m } = await ensureSelector();
  m.show();
}

export async function signOutWallet() {
  const { selector: sel } = await ensureSelector();
  const w = await sel.wallet();
  await w.signOut();
  const next = defaultWallet();
  saveWallet(next);
  return next;
}
