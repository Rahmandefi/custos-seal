#!/usr/bin/env node
/**
 * POST /analyze: upload → TEE → provider_tee → dcap-qvl → policy → record_finding
 * POST /custody/open  { case_id, evidence_id, reason }
 * POST /custody/check { case_id, evidence_commitment, expected_receipt_id, matched }
 * POST /custody/hold  same as /analyze but records verdict Hold
 */
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/load-env.mjs";
import { randomUUID } from "node:crypto";
import { analyzeEvidence, PipelineError } from "../src/pipeline.mjs";
import { logAnalyzeError } from "../src/analyze-log.mjs";
import {
  CONTRACT,
  WRITER,
  OWNER,
  callOwner,
  callWriter,
  getReceipt,
  receiptCount,
  viewAccount,
  viewFunction,
  writerAllowance,
} from "../src/near.mjs";
import { runAttack } from "../src/attacks.mjs";
import { evidenceCommitment, hexToBytes, newSalt } from "../src/commit.mjs";
import { buildExport, rememberTx, loadTxIndex } from "../src/export.mjs";
import { renderPdf } from "../src/render-pdf.mjs";
import {
  SAMPLE_CASE_ID,
  CASE_IDS_HEADER,
  parseCaseIdsHeader,
  isOperatorRequest,
  filterReceipts,
  sampleWriteBlocked,
  demoLimitReached,
  formatAllowanceNear,
  DEMO_HOURLY_MAX_DEFAULT,
  DEMO_ALLOWANCE_FLOOR_DEFAULT,
} from "../src/session-scope.mjs";
import { toWireChecks } from "../web/verify-checks.js";

export const testHooks = {
  getReceipt: null,
  buildExport: null,
};

function readReceipt(id) {
  return (testHooks.getReceipt || getReceipt)(id);
}


await loadEnv();

function walletEventsContractId() {
  const id = String(process.env.WALLET_EVENTS_CONTRACT_ID || "").trim();
  if (!id || id === "ftcust15e434.testnet") return null;
  return id;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT_DIR || (process.env.VERCEL ? "/tmp/custos-out" : join(ROOT, "out"));
const WEB = join(ROOT, "web");
const PORT = Number(process.env.PORT || 8787);
const ASSET_V = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.ASSET_V || "dev").slice(0, 8);
const WRITE_PATHS = new Set([
  "/analyze",
  "/custody/grant",
  "/custody/open",
  "/custody/check",
  "/custody/hold",
  "/api/security",
]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

let statusCache = { at: 0, key: "", body: null };
function invalidateStatus() {
  statusCache = { at: 0, key: "", body: null };
}

const demoHits = new Map();
function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.socket?.remoteAddress || "unknown";
}
function rateLimit(ip, rpm) {
  const now = Date.now();
  const slot = demoHits.get(ip);
  if (!slot || now > slot.reset) {
    demoHits.set(ip, { n: 1, reset: now + 60_000 });
    return true;
  }
  if (slot.n >= rpm) return false;
  slot.n += 1;
  return true;
}

function writeKind(pathOnly) {
  if (pathOnly === "/analyze") return "analyze";
  if (pathOnly === "/api/security") return "security";
  return "other";
}

function allowWrite(req, kind) {
  const token = process.env.CUSTOS_WRITE_TOKEN || process.env.WRITE_TOKEN;
  const raw = String(req.headers.authorization || "");
  const got = raw.replace(/^Bearer\s+/i, "").trim();
  if (token && got === token) return { ok: true, mode: "operator" };
  const demo = process.env.DEMO_MODE === "1";
  if (!demo) {
    if (!token) return { ok: false, status: 403, error: "Writes disabled on the public demo" };
    return { ok: false, status: 401, error: "unauthorized" };
  }
  if (kind !== "analyze" && kind !== "security") {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  const rpm = Number(process.env.DEMO_RPM || 6);
  if (!rateLimit(clientIp(req), rpm)) {
    return { ok: false, status: 429, error: "demo rate limit" };
  }
  return { ok: true, mode: "demo" };
}

function summarizeReceipt(r) {
  return {
    id: r.id,
    kind: r.kind,
    policy_verdict: r.policy_verdict,
    actor: r.actor,
    timestamp_ns: r.timestamp_ns,
    case_id: r.case_id,
    reason: r.reason,
  };
}

function callerScope(req) {
  const operator = isOperatorRequest(req);
  const ids = parseCaseIdsHeader(req.headers?.[CASE_IDS_HEADER] || req.headers?.["X-Custos-Case-Ids"]);
  return { operator, ids };
}

function rejectSampleWrite(res, caseId) {
  if (!sampleWriteBlocked(caseId)) return false;
  json(res, 403, { error: "sample case is read-only", code: "SAMPLE_READONLY" });
  return true;
}

async function scopedExport(req) {
  const raw = await (testHooks.buildExport || (() => buildExport(OUT)))();
  const scope = callerScope(req || {});
  const receipts = filterReceipts(raw.receipts || [], scope.ids, scope.operator);
  const ids = new Set(receipts.map((r) => Number(r.id)));
  return {
    ...raw,
    receipts,
    timeline: (raw.timeline || []).filter((r) => ids.has(Number(r.id))),
    findings: (raw.findings || []).filter((r) => ids.has(Number(r.receipt_id))),
    approvals: (raw.approvals || []).filter((r) => ids.has(Number(r.id))),
    access_log: (raw.access_log || []).filter((r) => ids.has(Number(r.id))),
    summary: {
      ...raw.summary,
      receipt_count: receipts.length,
      finding_count: receipts.filter((r) => r.kind === "Finding").length,
    },
  };
}

async function statusPayload(req) {
  const scope = callerScope(req || {});
  const cacheKey = scope.operator ? "op" : scope.ids.slice().sort().join(",") || "anon";
  if (statusCache.body && statusCache.key === cacheKey && Date.now() - statusCache.at < 12000) {
    return statusCache.body;
  }
  const n = await receiptCount();
  const acct = await viewAccount(CONTRACT);
  const all = [];
  for (let i = 0; i < n; i++) all.push(summarizeReceipt(await readReceipt(i)));
  const receipts = filterReceipts(all, scope.ids, scope.operator);
  const allow = await writerAllowance();
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const cap = demoLimitReached(all, allow.allowance, {
    nowNs,
    maxHourly: Number(process.env.DEMO_HOURLY_MAX || DEMO_HOURLY_MAX_DEFAULT),
    floorYocto: process.env.DEMO_ALLOWANCE_FLOOR || DEMO_ALLOWANCE_FLOOR_DEFAULT,
  });
  statusCache = {
    at: Date.now(),
    key: cacheKey,
    body: {
      contract: CONTRACT,
      writer: WRITER,
      owner: OWNER,
      receipt_count: receipts.length,
      chain_receipt_count: n,
      sample_case_id: SAMPLE_CASE_ID,
      storage_usage: acct.storage_usage,
      receipts,
      writer_allowance: allow.allowance ?? null,
      writer_allowance_near: formatAllowanceNear(allow.allowance),
      writer_public_key: allow.publicKey ?? null,
      demo_hourly_count: cap.hourly,
      demo_hourly_max: cap.max,
      wallet_events_contract: walletEventsContractId(),
    },
  };
  return statusCache.body;
}

function hexToBytesMaybeLocal(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const h = v.replace(/^0x/, "");
    const buf = Buffer.from(h, "hex");
    return Array.from(buf);
  }
  return v;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function sampleBytesMatch(evidenceBytes) {
  const listing = await readFile(join(ROOT, "samples", "larkmoor-listing.txt"));
  const hold = await readFile(join(ROOT, "samples", "larkmoor-hold.txt"));
  return evidenceBytes.equals(listing) || evidenceBytes.equals(hold);
}

async function publishedSampleSalt() {
  try {
    const hex = (await readFile(join(ROOT, "samples", "larkmoor-salt.hex"), "utf8")).trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
  } catch {}
  return null;
}

async function handleAnalyze(req, forceHold, ctx) {
  ctx.stage = "read_body";
  const raw = await readBody(req);
  let evidenceBytes;
  const ct = req.headers["content-type"] || "";
  ctx.stage = "parse";
  if (ct.includes("application/json")) {
    const j = JSON.parse(raw.toString("utf8"));
    evidenceBytes = Buffer.from(j.evidence || j.text || "", "utf8");
  } else {
    evidenceBytes = raw;
  }
  if (!evidenceBytes.length) {
    const err = new PipelineError("EMPTY", "empty evidence");
    err.stage = "parse";
    throw err;
  }
  const caseId = String(req.headers["x-case-id"] || "").trim();
  if (sampleWriteBlocked(caseId || SAMPLE_CASE_ID)) {
    const err = new Error("sample case is read-only");
    err.status = 403;
    err.code = "SAMPLE_READONLY";
    err.stage = "case";
    throw err;
  }
  if (!/^[0-9a-f]{32}$/i.test(caseId)) {
    const err = new Error("case id required");
    err.status = 400;
    err.stage = "case";
    throw err;
  }
  if (req.writeMode === "demo") {
    ctx.stage = "demo_sample";
    if (!(await sampleBytesMatch(evidenceBytes))) {
      const err = new Error("demo mode accepts the sample file only");
      err.status = 403;
      err.stage = "demo_sample";
      throw err;
    }
    ctx.stage = "demo_cap";
    const snap = testHooks.demoCap
      ? await testHooks.demoCap()
      : {
          receipts: (await (async () => {
            const n = await receiptCount();
            const list = [];
            for (let i = 0; i < n; i++) list.push(await readReceipt(i));
            return list;
          })()),
          allowance: (await writerAllowance()).allowance,
        };
    const cap = demoLimitReached(snap.receipts, snap.allowance, {
      nowNs: BigInt(Date.now()) * 1_000_000n,
      maxHourly: Number(process.env.DEMO_HOURLY_MAX || DEMO_HOURLY_MAX_DEFAULT),
      floorYocto: process.env.DEMO_ALLOWANCE_FLOOR || DEMO_ALLOWANCE_FLOOR_DEFAULT,
    });
    if (cap.blocked) {
      const err = new Error("demo limit reached; run npm run verify instead");
      err.status = 429;
      err.code = "DEMO_LIMIT";
      err.stage = "demo_cap";
      throw err;
    }
  }
  ctx.stage = "config";
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    const err = new Error("NEAR_AI_API_KEY missing");
    err.stage = "config";
    throw err;
  }
  return analyzeEvidence({
    evidenceBytes,
    caseId,
    outDir: OUT,
    root: ROOT,
    apiKey,
    writeOnChain: true,
    persistLocalArtifacts: req.writeMode !== "demo",
    runDcap: process.env.SKIP_DCAP !== "1",
    forceVerdict: forceHold ? "Hold" : undefined,
    onStage: (s) => {
      ctx.stage = s;
    },
  });
}

export async function handleRequest(req, res) {
  let analyzeCtx = null;
  try {
    await mkdir(OUT, { recursive: true });
    const pathOnly = (req.url || "/").split("?")[0];
    if (req.method === "POST" && pathOnly === "/analyze") {
      analyzeCtx = { attempt: randomUUID(), started: Date.now(), stage: "authorize" };
    }
    if (req.method === "POST" && WRITE_PATHS.has(pathOnly)) {
      const gate = allowWrite(req, writeKind(pathOnly));
      if (!gate.ok) {
        if (analyzeCtx) {
          logAnalyzeError({
            attempt: analyzeCtx.attempt,
            stage: "authorize",
            code: gate.error === "unauthorized" ? "UNAUTHORIZED" : "WRITE_DENIED",
            elapsed_ms: Date.now() - analyzeCtx.started,
          });
        }
        json(res, gate.status, { error: gate.error });
        return;
      }
      req.writeMode = gate.mode;
    }
    if (req.method === "POST" && req.url === "/analyze") {
      if (!analyzeCtx) {
        analyzeCtx = { attempt: randomUUID(), started: Date.now(), stage: "start" };
      }
      const result = await handleAnalyze(req, false, analyzeCtx);
      invalidateStatus();
      json(res, 200, {
        receipt_id: result.receiptId,
        tx: result.tx,
        salt: result.salt,
        storage_delta: result.storageDelta,
        policy: result.policy.verdict,
        reasons: result.policy.reasons,
        actions: result.receipt?.finding?.recommended_actions || [],
        checks: toWireChecks(result.checks),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/custody/hold") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      if (rejectSampleWrite(res, j.case_id || SAMPLE_CASE_ID)) return;
      const reason = String(j.reason || "").trim();
      if (!reason) {
        json(res, 400, { error: "reason required" });
        return;
      }
      const decision = j.decision === true || j.decision === "approve" || j.decision === "Approval";
      const before = await receiptCount();
      const sent = await callOwner(
        "approve_action",
        {
          case_id: j.case_id || SAMPLE_CASE_ID,
          receipt_id: Number(j.receipt_id),
          decision,
          reason,
        },
        { outDir: OUT }
      );
      const after = await receiptCount();
      const receipt_id = after - 1;
      await rememberTx(OUT, receipt_id, sent.tx);
      invalidateStatus();
      json(res, 200, {
        tx: sent.tx,
        method: "approve_action",
        kind: decision ? "Approval" : "Rejection",
        receipt_id,
        count_before: before,
        count_after: after,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/custody/open") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      if (rejectSampleWrite(res, j.case_id)) return;
      const sent = await callOwner(
        "request_open",
        {
          case_id: j.case_id,
          evidence_id: j.evidence_id || "E1",
          reason: j.reason || "investigator open",
        },
        { deposit: "0.01 NEAR", outDir: OUT }
      );
      invalidateStatus();
      json(res, 200, { tx: sent.tx, method: "request_open" });
      return;
    }
    if (req.method === "POST" && req.url === "/custody/check") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      if (rejectSampleWrite(res, j.case_id)) return;
      const expectedId = Number(j.expected_receipt_id);
      const chain = await getReceipt(expectedId);
      let commitBuf;
      if (j.file_b64 && j.salt) {
        commitBuf = evidenceCommitment(hexToBytes(j.salt), Buffer.from(j.file_b64, "base64"));
      } else {
        commitBuf = Buffer.from(hexToBytesMaybeLocal(j.evidence_commitment));
      }
      const expectedHex = Buffer.from(chain.evidence_commitments[0]).toString("hex");
      const matched = commitBuf.toString("hex") === expectedHex;
      const sent = await callWriter(
        "record_custody_check",
        {
          case_id: j.case_id,
          evidence_commitment: Array.from(commitBuf),
          expected_receipt_id: expectedId,
          matched,
        },
        { outDir: OUT }
      );
      invalidateStatus();
      json(res, 200, { tx: sent.tx, method: "record_custody_check", matched });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health") {
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return;
      }
      json(res, 200, { ok: true });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/api/status") {
      if (req.method === "HEAD") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end();
        return;
      }
      json(res, 200, await statusPayload(req));
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/receipt/")) {
      const id = Number(req.url.split("/").pop());
      const rec = await readReceipt(id);
      const scope = callerScope(req);
      if (!rec || typeof rec !== "object" || !filterReceipts([rec], scope.ids, scope.operator).length) {
        json(res, 404, { error: "not found" });
        return;
      }
      const idx = await loadTxIndex(OUT);
      rec.tx = idx[id] || idx[String(id)] || rec.tx || null;
      rec.explorer = rec.tx ? `https://testnet.nearblocks.io/txns/${rec.tx}` : null;
      json(res, 200, rec);
      return;
    }
    if (req.method === "POST" && req.url === "/api/security") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      json(res, 200, await runAttack(j.kind));
      invalidateStatus();
      return;
    }
    if (req.method === "GET" && (req.url === "/api/sample" || req.url?.startsWith("/api/sample?"))) {
      const u = new URL(req.url, "http://127.0.0.1");
      const hold = u.searchParams.get("kind") === "hold";
      const name = hold ? "larkmoor-hold.txt" : "larkmoor-listing.txt";
      const buf = await readFile(join(ROOT, "samples", name));
      const salt = await publishedSampleSalt();
      json(res, 200, {
        name,
        note: hold ? "FICTIONAL isolate_host HOLD sample" : "FICTIONAL MOVEit-style listing",
        fictional: true,
        text: buf.toString("utf8"),
        salt,
      });
      return;
    }
    if (req.method === "GET" && (pathOnly === "/api/sample/findings" || pathOnly.startsWith("/api/sample/findings/"))) {
      const { readdir } = await import("node:fs/promises");
      const dir = join(ROOT, "samples", "findings");
      try {
        const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
        const items = [];
        for (const f of files) {
          items.push(JSON.parse(await readFile(join(dir, f), "utf8")));
        }
        json(res, 200, { fictional: true, findings: items });
      } catch {
        json(res, 200, { fictional: true, findings: [] });
      }
      return;
    }
    if (req.method === "GET" && req.url === "/api/export") {
      json(res, 200, await scopedExport(req));
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && (pathOnly === "/api/export.pdf")) {
      const PDF_NAME = "custos-seal-larkmoor-demo-report.pdf";
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${PDF_NAME}"`,
        });
        res.end();
        return;
      }
      const withTimeout = (p, ms, code) =>
        Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(code)), ms))]);
      try {
        const payload = await withTimeout(scopedExport(req), 15000, "export_timeout");
        const buf = await withTimeout(renderPdf(payload), 15000, "pdf_timeout");
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${PDF_NAME}"`,
          "Content-Length": buf.length,
          "Cache-Control": "no-store",
        });
        res.end(buf);
      } catch (e) {
        console.error("export.pdf failed:", e);
        json(res, /timeout/.test(e.message) ? 504 : 500, { error: "pdf_failed", detail: String(e.message) });
      }
      return;
    }
    if (req.method === "POST" && req.url === "/api/commit") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      const file = Buffer.from(j.file_b64 || "", "base64");
      const envSalt = process.env.CASE_SALT || process.env.EVIDENCE_SALT;
      const published = await publishedSampleSalt();
      const sampleOk = published && j.salt && String(j.salt).toLowerCase() === published && (await sampleBytesMatch(file));
      if (j.salt && process.env.DEMO_MODE === "1" && !sampleOk) {
        json(res, 403, { error: "demo mode refuses arbitrary salts" });
        return;
      }
      const salt = sampleOk
        ? hexToBytes(published)
        : j.salt && process.env.DEMO_MODE !== "1"
          ? hexToBytes(j.salt)
          : envSalt
            ? hexToBytes(envSalt.replace(/^0x/i, ""))
            : newSalt();
      const commit = evidenceCommitment(salt, file);
      json(res, 200, {
        salt: salt.toString("hex"),
        commitment: commit.toString("hex"),
        encrypted_at_rest: true,
        fictional: true,
      });
      return;
    }
    if (req.method === "POST" && req.url === "/custody/grant") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      if (rejectSampleWrite(res, j.case_id)) return;
      const sent = await callOwner(
        "grant",
        { case_id: j.case_id, account: j.account },
        { outDir: OUT }
      );
      invalidateStatus();
      json(res, 200, { tx: sent.tx, method: "grant" });
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/grantee")) {
      const u = new URL(req.url, "http://127.0.0.1");
      const ok = await viewFunction("is_grantee", {
        case_id: u.searchParams.get("case_id") || SAMPLE_CASE_ID,
        account: u.searchParams.get("account"),
      });
      json(res, 200, { granted: Boolean(ok) });
      return;
    }
    if (req.method === "POST" && req.url === "/api/verify") {
      try {
        const j = JSON.parse((await readBody(req)).toString("utf8"));
        if (!j.file_b64 || !j.salt || j.id == null) {
          json(res, 400, { unable: true, error: "file, salt, and receipt id are required" });
          return;
        }
        const file = Buffer.from(j.file_b64, "base64");
        const salt = hexToBytes(j.salt);
        const chain = await getReceipt(Number(j.id));
        if (!chain?.evidence_commitments?.[0]) {
          json(res, 400, { unable: true, error: "receipt has no evidence commitment" });
          return;
        }
        const commit = evidenceCommitment(salt, file);
        const expected = Buffer.from(chain.evidence_commitments[0]).toString("hex");
        json(res, 200, {
          id: Number(j.id),
          evidence_commitment: commit.toString("hex") === expected,
          expected,
          found: commit.toString("hex"),
          unable: false,
        });
      } catch (e) {
        json(res, 500, { unable: true, error: e.message || "verify failed" });
      }
      return;
    }
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      (req.url === "/" || req.url?.startsWith("/web") || !req.url.startsWith("/api"))
    ) {
      const path = req.url === "/" ? "/index.html" : req.url;
      const file = join(WEB, path.replace(/^\/web/, "").replace(/\?.*$/, ""));
      if (!file.startsWith(WEB)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      try {
        const st = await stat(file);
        if (!st.isFile()) throw new Error("dir");
        let buf = await readFile(file);
        const ext = extname(file);
        const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
        if (ext === ".html" || ext === ".js") {
          buf = Buffer.from(buf.toString("utf8").replaceAll("__ASSET_V__", ASSET_V));
          headers["Cache-Control"] = ext === ".html" ? "no-store" : "public, max-age=31536000, immutable";
        } else if ([".css", ".svg", ".ico", ".png"].includes(ext)) {
          headers["Cache-Control"] = "public, max-age=31536000, immutable";
        }
        if (req.method === "HEAD") {
          headers["Content-Length"] = Buffer.byteLength(buf);
          res.writeHead(200, headers);
          res.end();
          return;
        }
        res.writeHead(200, headers);
        res.end(buf);
        return;
      } catch {
        if (req.url === "/" || !req.url.includes(".")) {
          const raw = await readFile(join(WEB, "index.html"), "utf8");
          const buf = Buffer.from(raw.replaceAll("__ASSET_V__", ASSET_V));
          const headers = { "Content-Type": MIME[".html"], "Cache-Control": "no-store" };
          if (req.method === "HEAD") {
            headers["Content-Length"] = Buffer.byteLength(buf);
            res.writeHead(200, headers);
            res.end();
            return;
          }
          res.writeHead(200, headers);
          res.end(buf);
          return;
        }
      }
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    if (analyzeCtx) {
      logAnalyzeError({
        attempt: analyzeCtx.attempt,
        stage: e.stage || analyzeCtx.stage || "unknown",
        code: e.code || (e.status === 403 ? "FORBIDDEN" : "ERROR"),
        elapsed_ms: Date.now() - analyzeCtx.started,
      });
    }
    const code = e.status || (e instanceof PipelineError ? 400 : 500);
    json(res, code, {
      error: e.message,
      code: e.code || "ERROR",
      skip_chain: Boolean(e.skipChain),
      checks: e.checks ? toWireChecks(e.checks) : null,
      tx: e.tx || null,
      execution: e.execution || null,
    });
  }
}

if (!process.env.VERCEL) {
  const server = createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`listening http://127.0.0.1:${PORT}`);
  });
}
