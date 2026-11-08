import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { SAMPLE_CASE_ID } from "./session-scope.mjs";

process.env.VERCEL = process.env.VERCEL || "1";
process.env.DEMO_MODE = "1";

const { handleRequest, testHooks } = await import("../scripts/server.mjs");

function listen() {
  const server = createServer(handleRequest);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function call(port, path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _text: text };
  }
  return { status: res.status, json };
}

test("POST /analyze against larkmoor-demo is refused before chain write", async () => {
  const { server, port } = await listen();
  try {
    const out = await call(port, "/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-case-id": SAMPLE_CASE_ID,
      },
      body: "sample-bytes",
    });
    assert.equal(out.status, 403);
    assert.equal(out.json.code, "SAMPLE_READONLY");
  } finally {
    server.close();
  }
});

test("GET /api/status without case ids has no foreign hex cases", async () => {
  const { server, port } = await listen();
  try {
    const out = await call(port, "/api/status");
    assert.equal(out.status, 200);
    const foreign = (out.json.receipts || []).filter((r) => r.case_id && r.case_id !== SAMPLE_CASE_ID);
    assert.equal(foreign.length, 0);
  } finally {
    server.close();
  }
});

test("GET /api/status with B ids does not include A hex case", async () => {
  const { server, port } = await listen();
  try {
    const a = "a".repeat(32);
    const b = "b".repeat(32);
    const out = await call(port, "/api/status", { headers: { "x-custos-case-ids": b } });
    assert.equal(
      (out.json.receipts || []).some((r) => String(r.case_id).toLowerCase() === a),
      false
    );
  } finally {
    server.close();
  }
});

test("B cannot read A's real receipt id via /api/receipt or /api/export", async () => {
  const a = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const b = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const rec = {
    id: 11,
    case_id: a,
    kind: "Finding",
    policy_verdict: "Hold",
    actor: "ftwriter15e434.testnet",
  };
  testHooks.getReceipt = async (id) => (Number(id) === 11 ? rec : null);
  testHooks.buildExport = async () => ({
    receipts: [rec],
    timeline: [{ id: 11, case_id: a }],
    findings: [{ receipt_id: 11 }],
    approvals: [],
    access_log: [],
    summary: { receipt_count: 1, finding_count: 1 },
  });
  const { server, port } = await listen();
  try {
    const recRes = await call(port, "/api/receipt/11", {
      headers: { "x-custos-case-ids": b },
    });
    assert.equal(recRes.status, 404);
    const exp = await call(port, "/api/export", {
      headers: { "x-custos-case-ids": b },
    });
    assert.equal(exp.status, 200);
    const ids = (exp.json.receipts || []).map((r) => Number(r.id));
    assert.equal(ids.includes(11), false);
    assert.equal((exp.json.findings || []).some((f) => Number(f.receipt_id) === 11), false);
    assert.equal(exp.json.verification?.last_local_receipt, undefined);
  } finally {
    testHooks.getReceipt = null;
    testHooks.buildExport = null;
    server.close();
  }
});

test("POST /analyze in demo mode returns 429 when hourly cap is hit", async () => {
  const listing = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../samples/larkmoor-listing.txt", import.meta.url))
  );
  testHooks.demoCap = async () => ({
    receipts: Array.from({ length: 13 }, () => ({
      timestamp_ns: String(BigInt(Date.now()) * 1_000_000n),
    })),
    allowance: "100000000000000000000000",
  });
  const { server, port } = await listen();
  try {
    const out = await call(port, "/analyze", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-case-id": "c".repeat(32),
      },
      body: listing,
    });
    assert.equal(out.status, 429);
    assert.equal(out.json.code, "DEMO_LIMIT");
    assert.match(String(out.json.error || out.json.message || ""), /demo limit reached; run npm run verify instead/);
  } finally {
    testHooks.demoCap = null;
    server.close();
  }
});

test("GET /api/receipt for a missing id is 404", async () => {
  const { server, port } = await listen();
  try {
    const out = await call(port, "/api/receipt/999999", {
      headers: { "x-custos-case-ids": "b".repeat(32) },
    });
    assert.equal(out.status, 404);
  } finally {
    server.close();
  }
});
