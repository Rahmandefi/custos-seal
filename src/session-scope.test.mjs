import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_CASE_ID,
  parseCaseIdsHeader,
  filterReceipts,
  isOperatorRequest,
  sampleWriteBlocked,
} from "./session-scope.mjs";

const sample = { id: 1, case_id: SAMPLE_CASE_ID, kind: "Finding" };
const a = { id: 11, case_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", kind: "Finding" };
const b = { id: 12, case_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", kind: "Finding" };

test("fresh visitor sees only sample receipts, not others", () => {
  const out = filterReceipts([sample, a, b], [], false);
  assert.deepEqual(out.map((r) => r.id), [1]);
});

test("window B IDs hide A's case", () => {
  const out = filterReceipts([sample, a, b], ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], false);
  assert.equal(out.some((r) => r.id === 11), false);
  assert.equal(out.some((r) => r.id === 12), true);
});

test("operator Bearer sees everything", () => {
  const req = { headers: { authorization: "Bearer secret" } };
  assert.equal(isOperatorRequest(req, "secret"), true);
  const out = filterReceipts([sample, a, b], [], true);
  assert.equal(out.length, 3);
});

test("sample writes are blocked", () => {
  assert.equal(sampleWriteBlocked("larkmoor-demo"), true);
  assert.equal(sampleWriteBlocked("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
});

test("parseCaseIdsHeader accepts 128-bit hex only", () => {
  assert.deepEqual(parseCaseIdsHeader("aa".repeat(16) + ",nope," + "bb".repeat(16)), [
    "a".repeat(32),
    "b".repeat(32),
  ]);
});
