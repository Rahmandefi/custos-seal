/**
 * Optional investigator-signed events on a SEPARATE contract.
 * Never writes ftcust15e434.testnet. Disabled when no contract id.
 */
import { signFunctionCall, ensureSelector } from "./wallet.js?v=__ASSET_V__";

export const EVENTS_LS = "custos-events-pending";
export const GAS = "30000000000000";
export const DEPOSIT = "20480000000000000000000"; // 0.02048 NEAR

export function eventsContractId(status) {
  return String(status?.wallet_events_contract || "").trim();
}

export function eventsEnabled(status) {
  const id = eventsContractId(status);
  if (!id) return false;
  if (id === "ftcust15e434.testnet") return false;
  return true;
}

function bytes32() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return a;
}

export function toHex(u8) {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toArr(u8) {
  return Array.from(u8);
}

export function loadPending() {
  try {
    return JSON.parse(sessionStorage.getItem(EVENTS_LS) || "null");
  } catch {
    return null;
  }
}

export function savePending(p) {
  if (!p) sessionStorage.removeItem(EVENTS_LS);
  else sessionStorage.setItem(EVENTS_LS, JSON.stringify(p));
}

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(buf));
}

export async function opaqueCaseCommitment(caseId) {
  const enc = new TextEncoder().encode(`custos-case:${caseId || "larkmoor-demo"}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc));
  return hash;
}

export async function resultReportHash({ receiptId, matched, expected, found }) {
  const body = JSON.stringify({
    v: 1,
    receipt_id: Number(receiptId),
    match: Boolean(matched),
    expected,
    found,
  });
  return sha256Hex(new TextEncoder().encode(body));
}

export function consentCopy(kind, { receiverId, methodName, commitment, nonce, receiptId, resultHash }) {
  return {
    title: kind === "start_case" ? "Start case on NEAR (optional)" : "Record my verification attestation",
    methodName,
    receiverId,
    gas: "30 TGas",
    deposit: "0.02048 NEAR",
    warning:
      "Public on-chain: account id, timestamps, operation ids, and hashes. No file bytes, names, or salts are sent. The contract does not re-check the file.",
    commitment,
    nonce,
    receiptId,
    resultHash,
  };
}

export async function prepareStartCase(caseId) {
  const nonce = bytes32();
  const commitment = await opaqueCaseCommitment(caseId);
  return {
    kind: "start_case",
    methodName: "start_case",
    caseId: caseId || "larkmoor-demo",
    nonce: toHex(nonce),
    nonceArr: toArr(nonce),
    commitment: toHex(commitment),
    commitmentArr: toArr(commitment),
  };
}

export async function prepareAttest({ caseId, receiptId, resultHash }) {
  const nonce = bytes32();
  return {
    kind: "attest_verification",
    methodName: "attest_verification",
    caseId: caseId || "larkmoor-demo",
    receiptId: Number(receiptId),
    resultHash,
    nonce: toHex(nonce),
    nonceArr: toArr(nonce),
    resultArr: toArr(hexToU8(resultHash)),
  };
}

export async function sendStartCase({ receiverId, prep }) {
  savePending({
    kind: "start_case",
    nonce: prep.nonce,
    commitment: prep.commitment,
    caseId: prep.caseId,
    receiverId,
    at: Date.now(),
  });
  const sent = await signFunctionCall({
    receiverId,
    methodName: "start_case",
    args: { case_commitment: prep.commitmentArr, nonce: prep.nonceArr },
    gas: GAS,
    deposit: DEPOSIT,
  });
  return { sent, nonce: prep.nonce, commitment: prep.commitment };
}

export async function sendAttest({ receiverId, prep }) {
  savePending({
    kind: "attest_verification",
    nonce: prep.nonce,
    resultHash: prep.resultHash,
    receiptId: prep.receiptId,
    receiverId,
    at: Date.now(),
  });
  const sent = await signFunctionCall({
    receiverId,
    methodName: "attest_verification",
    args: {
      receipt_id: prep.receiptId,
      result_hash: prep.resultArr,
      nonce: prep.nonceArr,
      case_id: prep.caseId,
    },
    gas: GAS,
    deposit: DEPOSIT,
  });
  return { sent, nonce: prep.nonce };
}

export function outcomeFinalSuccess(sent) {
  const st = sent?.status;
  if (!st) return false;
  if (st.SuccessValue !== undefined) return true;
  if (typeof st === "object" && "SuccessValue" in st) return true;
  return false;
}

export function logsOf(sent) {
  const out = [];
  const push = (logs) => {
    if (Array.isArray(logs)) out.push(...logs.map(String));
  };
  push(sent?.transaction_outcome?.outcome?.logs);
  for (const r of sent?.receipts_outcome || []) push(r?.outcome?.logs);
  return out;
}

export function matchingEvent(sent, kind) {
  const want = kind === "start_case" ? "case_started" : "verification_attested";
  return logsOf(sent).some((l) => l.toLowerCase().includes(want));
}

export async function liveSigner() {
  const { selector } = await ensureSelector();
  if (!selector.isSignedIn()) return null;
  const state = selector.store.getState();
  const acc = state.accounts?.[0]?.accountId || "";
  return { accountId: acc, network: "testnet" };
}

function hexToU8(hex) {
  const h = String(hex || "").replace(/^0x/i, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function txHashOf(sent) {
  return sent?.transaction?.hash || sent?.transaction_outcome?.id || sent?.hash || null;
}
