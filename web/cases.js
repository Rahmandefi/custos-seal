/** Visitor-owned cases. IDs are 128-bit hex in localStorage. */
export const CASES_LS = "custos-cases";
export const SAMPLE_CASE_ID = "larkmoor-sample-v2";

export function newCaseId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function defaultCases() {
  return { list: [], currentId: "" };
}

export function loadCases() {
  try {
    const raw = JSON.parse(localStorage.getItem(CASES_LS) || "{}");
    const list = Array.isArray(raw.list) ? raw.list : [];
    return {
      list: list.filter((c) => c && /^[0-9a-f]{32}$/i.test(c.id)),
      currentId: String(raw.currentId || ""),
    };
  } catch {
    return defaultCases();
  }
}

export function saveCases(c) {
  localStorage.setItem(CASES_LS, JSON.stringify({ list: c.list, currentId: c.currentId || "" }));
}

export function callerCaseIds(c = loadCases()) {
  return c.list.map((x) => String(x.id).toLowerCase());
}

export function addCase(c, { id, name, desc, fromSample }) {
  const next = {
    list: [...c.list, { id, name: name || "Untitled case", desc: desc || "", fromSample: !!fromSample }],
    currentId: id,
  };
  saveCases(next);
  return next;
}
