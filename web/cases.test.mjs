import { test } from "node:test";
import assert from "node:assert/strict";
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { newCaseId, loadCases, addCase, callerCaseIds, CASES_LS } = await import("./cases.js");

test("create case is 128-bit hex and survives reload", () => {
  const id = newCaseId();
  assert.match(id, /^[0-9a-f]{32}$/);
  const saved = addCase(loadCases(), { id, name: "A", desc: "x" });
  assert.equal(saved.list.length, 1);
  const reloaded = JSON.parse(store.get(CASES_LS));
  assert.equal(reloaded.list[0].id, id);
  assert.deepEqual(callerCaseIds(loadCases()), [id]);
});
