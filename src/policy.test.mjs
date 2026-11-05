import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "./policy.mjs";

const evidence = {
  E1: "alpha\nwwwroot\\human2.aspx  created 2023-06-01 02:39\nomega",
};

const goodFinding = {
  claim: "webshell present",
  citations: [
    {
      evidence_id: "E1",
      line_start: 2,
      line_end: 2,
      quote: "wwwroot\\human2.aspx  created 2023-06-01 02:39",
    },
  ],
  iocs: ["human2.aspx"],
  recommended_actions: ["review"],
  confidence: 0.9,
};

test("exact citation ACCEPT", () => {
  const r = evaluate({ findings: [goodFinding] }, evidence, {
    signatureKind: "provider_tee",
    tcbOk: true,
  });
  assert.equal(r.verdict, "ACCEPT");
  assert.equal(r.citationRecords.length, 1);
});

test("whitespace-changed quote BLOCK", () => {
  const f = structuredClone(goodFinding);
  f.citations[0].quote = "wwwroot\\human2.aspx created 2023-06-01 02:39";
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "BLOCK");
});

test("wrong line range BLOCK", () => {
  const f = structuredClone(goodFinding);
  f.citations[0].line_start = 1;
  f.citations[0].line_end = 1;
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "BLOCK");
});

test("missing citation BLOCK", () => {
  const f = structuredClone(goodFinding);
  f.citations = [];
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "BLOCK");
});

test("IOC outside span FLAG", () => {
  const f = structuredClone(goodFinding);
  f.iocs = ["198.51.100.23"];
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "FLAG");
});

test("irreversible HOLD", () => {
  const f = structuredClone(goodFinding);
  f.recommended_actions = ["isolate_host"];
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "HOLD");
});

test("fabricated quote BLOCK", () => {
  const f = structuredClone(goodFinding);
  f.citations[0].quote = "definitely a webshell we invented";
  const r = evaluate({ findings: [f] }, evidence);
  assert.equal(r.verdict, "BLOCK");
});
