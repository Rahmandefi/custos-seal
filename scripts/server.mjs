#!/usr/bin/env node
/**
 * POST /analyze — upload → TEE → provider_tee → dcap-qvl → policy → record_finding
 * POST /custody/open  { case_id, evidence_id, reason }
 * POST /custody/check { case_id, evidence_commitment, expected_receipt_id, matched }
 * POST /custody/hold  same as /analyze but records verdict Hold
 */
import { createServer } from "node:http";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/load-env.mjs";
import { analyzeEvidence, PipelineError } from "../src/pipeline.mjs";
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
} from "../src/near.mjs";
import { runAttack } from "../src/attacks.mjs";
import { evidenceCommitment, hexToBytes, newSalt } from "../src/commit.mjs";
import { buildExport, rememberTx } from "../src/export.mjs";
import { renderPdf } from "../src/render-pdf.mjs";


await loadEnv();

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

let statusCache = { at: 0, body: null };
function invalidateStatus() {
  statusCache = { at: 0, body: null };
}

function writeGate(req) {
  const token = process.env.CUSTOS_WRITE_TOKEN;
  if (!token) return { ok: false, code: 403, error: "Writes disabled on the public demo" };
  const raw = String(req.headers.authorization || "");
  const got = raw.replace(/^Bearer\s+/i, "").trim();
  if (got !== token) return { ok: false, code: 401, error: "unauthorized" };
  return { ok: true };
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

async function statusPayload() {
  if (statusCache.body && Date.now() - statusCache.at < 12000) return statusCache.body;
  const n = await receiptCount();
  const acct = await viewAccount(CONTRACT);
  const receipts = [];
  for (let i = 0; i < n; i++) receipts.push(summarizeReceipt(await getReceipt(i)));
  statusCache = {
    at: Date.now(),
    body: {
      contract: CONTRACT,
      writer: WRITER,
      owner: OWNER,
      receipt_count: n,
      storage_usage: acct.storage_usage,
      receipts,
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

async function handleAnalyze(req, forceHold) {
  const raw = await readBody(req);
  let evidenceBytes;
  const ct = req.headers["content-type"] || "";
  if (ct.includes("application/json")) {
    const j = JSON.parse(raw.toString("utf8"));
    evidenceBytes = Buffer.from(j.evidence || j.text || "", "utf8");
  } else {
    evidenceBytes = raw;
  }
  if (!evidenceBytes.length) {
    throw new PipelineError("EMPTY", "empty evidence");
  }
  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) throw new Error("NEAR_AI_API_KEY missing");
  return analyzeEvidence({
    evidenceBytes,
    caseId: req.headers["x-case-id"] || "larkmoor-demo",
    outDir: OUT,
    root: ROOT,
    apiKey,
    writeOnChain: true,
    runDcap: process.env.SKIP_DCAP !== "1",
    forceVerdict: forceHold ? "Hold" : undefined,
  });
}

export async function handleRequest(req, res) {
  try {
    await mkdir(OUT, { recursive: true });
    const pathOnly = (req.url || "/").split("?")[0];
    if (req.method === "POST" && WRITE_PATHS.has(pathOnly)) {
      const gate = writeGate(req);
      if (!gate.ok) {
        json(res, gate.code, { error: gate.error });
        return;
      }
    }
    if (req.method === "POST" && req.url === "/analyze") {
      const result = await handleAnalyze(req, false);
      invalidateStatus();
      json(res, 200, {
        receipt_id: result.receiptId,
        tx: result.tx,
        salt: result.salt,
        storage_delta: result.storageDelta,
        policy: result.policy.verdict,
        reasons: result.policy.reasons,
        actions: result.receipt?.finding?.recommended_actions || [],
      });
      return;
    }
    if (req.method === "POST" && req.url === "/custody/hold") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
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
          case_id: j.case_id || "larkmoor-demo",
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
      const commit = hexToBytesMaybeLocal(j.evidence_commitment);
      const sent = await callWriter(
        "record_custody_check",
        {
          case_id: j.case_id,
          evidence_commitment: commit,
          expected_receipt_id: Number(j.expected_receipt_id),
          matched: Boolean(j.matched),
        },
        { outDir: OUT }
      );
      invalidateStatus();
      json(res, 200, { tx: sent.tx, method: "record_custody_check" });
      return;
    }
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      json(res, 200, await statusPayload());
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/receipt/")) {
      const id = Number(req.url.split("/").pop());
      json(res, 200, await getReceipt(id));
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
      json(res, 200, {
        name,
        note: hold ? "FICTIONAL isolate_host HOLD sample" : "FICTIONAL MOVEit-style listing",
        fictional: true,
        text: buf.toString("utf8"),
      });
      return;
    }
    if (req.method === "GET" && req.url === "/api/export") {
      json(res, 200, await buildExport(OUT));
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
        const payload = await withTimeout(buildExport(OUT), 15000, "export_timeout");
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
      const salt = j.salt
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
        case_id: u.searchParams.get("case_id") || "larkmoor-demo",
        account: u.searchParams.get("account"),
      });
      json(res, 200, { granted: Boolean(ok) });
      return;
    }
    if (req.method === "POST" && req.url === "/api/verify") {
      const j = JSON.parse((await readBody(req)).toString("utf8"));
      const file = Buffer.from(j.file_b64, "base64");
      const salt = hexToBytes(j.salt);
      const chain = await getReceipt(Number(j.id));
      const commit = evidenceCommitment(salt, file);
      const expected = Buffer.from(chain.evidence_commitments[0]).toString("hex");
      json(res, 200, {
        id: Number(j.id),
        evidence_commitment: commit.toString("hex") === expected,
        expected,
        found: commit.toString("hex"),
      });
      return;
    }
    if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/web") || !req.url.startsWith("/api"))) {
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
        res.writeHead(200, headers);
        res.end(buf);
        return;
      } catch {
        if (req.url === "/" || !req.url.includes(".")) {
          const raw = await readFile(join(WEB, "index.html"), "utf8");
          const buf = Buffer.from(raw.replaceAll("__ASSET_V__", ASSET_V));
          res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
          res.end(buf);
          return;
        }
      }
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    const code = e instanceof PipelineError ? 400 : 500;
    json(res, code, {
      error: e.message,
      code: e.code || "ERROR",
      skip_chain: Boolean(e.skipChain),
    });
  }
}

if (!process.env.VERCEL) {
  const server = createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`listening http://127.0.0.1:${PORT}`);
  });
}
