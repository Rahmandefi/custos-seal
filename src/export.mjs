import { writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT, OWNER, WRITER, getReceipt, receiptCount } from "./near.mjs";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "..", "samples");

const LIMITS =
  "Triage tool, not court-certified. Attestation notes: citations are byte-for-byte (R1); receipts are written with a function-call writer key (R2); the signed finding is stored and ed25519-verified on-chain at write time (R3). TCB policy accepts UpToDate only. Sample items are FICTIONAL.";

function kindName(k) {
  if (!k) return null;
  if (typeof k === "object") return Object.keys(k)[0];
  return String(k);
}

function hexOf(v) {
  if (v == null) return null;
  if (typeof v === "string") return v.replace(/^0x/, "").toLowerCase();
  if (Array.isArray(v)) return Buffer.from(v).toString("hex");
  if (typeof v === "object" && v.type === "Buffer") return Buffer.from(v.data).toString("hex");
  return String(v);
}

export function normalizeReceipt(r, txIndex = {}) {
  const kind = kindName(r.kind);
  const verdict = kindName(r.policy_verdict);
  const f = r.finding || {};
  const id = Number(r.id);
  return {
    id,
    case_id: r.case_id,
    kind,
    actor: r.actor,
    policy_verdict: verdict,
    reason: r.reason || null,
    timestamp_ns: r.timestamp_ns,
    prev_hash: hexOf(r.prev_hash),
    evidence_commitments: (r.evidence_commitments || []).map(hexOf),
    finding: f.model_id
      ? {
          model_id: f.model_id,
          nonce: hexOf(f.nonce),
          finding_hash: hexOf(f.finding_hash),
          citation_hashes: (f.citation_hashes || []).map(hexOf),
          request_hash: hexOf(f.request_hash),
          response_hash: hexOf(f.response_hash),
          gateway_report_hash: hexOf(f.gateway_report_hash),
          model_report_hash: hexOf(f.model_report_hash),
          tcb_status: kindName(f.tcb_status),
        }
      : null,
    tx: txIndex[id] || null,
    explorer: txIndex[id]
      ? `https://explorer.testnet.near.org/transactions/${txIndex[id]}`
      : null,
    fictional: true,
  };
}

export async function loadTxIndex(outDir) {
  let shipped = {};
  let live = {};
  try {
    shipped = JSON.parse(await readFile(join(SAMPLES, "tx-index.json"), "utf8"));
  } catch {
    /* none */
  }
  try {
    live = JSON.parse(await readFile(join(outDir, "tx-index.json"), "utf8"));
  } catch {
    /* none */
  }
  return { ...shipped, ...live };
}

export async function rememberTx(outDir, receiptId, tx) {
  if (receiptId == null || !tx) return;
  const idx = await loadTxIndex(outDir);
  idx[String(receiptId)] = tx;
  idx[receiptId] = tx;
  await writeFile(join(outDir, "tx-index.json"), JSON.stringify(idx, null, 2));
  if (!process.env.VERCEL) {
    try {
      await writeFile(join(SAMPLES, "tx-index.json"), JSON.stringify(idx, null, 2));
    } catch {
      /* read-only */
    }
  }
}

export async function buildExport(outDir) {
  const n = await receiptCount();
  const txIndex = await loadTxIndex(outDir);
  const receipts = [];
  for (let i = 0; i < n; i++) {
    receipts.push(normalizeReceipt(await getReceipt(i), txIndex));
  }
  const findings = receipts.filter((r) => r.kind === "Finding");
  const approvals = receipts.filter((r) => r.kind === "Approval" || r.kind === "Rejection");
  const access = receipts.filter((r) => r.kind === "Open" || r.kind === "OpenDenied");
  const holds = findings.filter((r) => String(r.policy_verdict).toUpperCase() === "HOLD");
  const decided = new Set(
    approvals
      .map((a) => String(a.reason || "").match(/receipt=(\d+)/)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  const pending_holds = holds.filter((h) => !decided.has(h.id));

  let localFinding = null;
  try {
    localFinding = JSON.parse(await readFile(join(outDir, "receipt.json"), "utf8"));
  } catch {
    /* none */
  }
  const shipped = {};
  try {
    const { readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join: jn } = await import("node:path");
    const root = jn(dirname(fileURLToPath(import.meta.url)), "..");
    const dir = jn(root, "samples", "findings");
    for (const f of await readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      const item = JSON.parse(await readFile(jn(dir, f), "utf8"));
      shipped[Number(item.receipt_id)] = item;
    }
  } catch {
    /* none */
  }

  return {
    generated_at: new Date().toISOString(),
    fictional: true,
    limits: LIMITS,
    summary: {
      contract: CONTRACT,
      writer: WRITER,
      owner: OWNER,
      receipt_count: n,
      finding_count: findings.length,
      hold_count: holds.length,
      pending_hold_count: pending_holds.length,
      approval_count: approvals.filter((a) => a.kind === "Approval").length,
      rejection_count: approvals.filter((a) => a.kind === "Rejection").length,
      case_id: "larkmoor-demo",
      sample: "FICTIONAL",
    },
    timeline: receipts.map((r) => ({
      id: r.id,
      kind: r.kind,
      verdict: r.policy_verdict,
      actor: r.actor,
      case_id: r.case_id,
      reason: r.reason,
      prev_hash: r.prev_hash,
      tx: r.tx,
    })),
    findings: findings.map((r) => {
      const ship = shipped[r.id];
      return {
      receipt_id: r.id,
      verdict: r.policy_verdict,
      finding_hash: r.finding?.finding_hash || null,
      citation_hashes: r.finding?.citation_hashes || [],
      model_id: r.finding?.model_id || null,
      evidence_commitments: r.evidence_commitments,
      local_claim: ship?.claim || localFinding?.finding?.claim || null,
      local_citations: ship?.citations || localFinding?.citations || null,
      local_actions: ship?.actions || localFinding?.finding?.recommended_actions || null,
      fictional: true,
    };
    }),
    receipts,
    approvals,
    access_log: access,
    verification: {
      r1: "Citations checked byte-for-byte against evidence before record_finding.",
      r2: "Writer function-call key limited to record_finding and record_custody_check on the custody contract.",
      r3: "On-chain ed25519_verify of the signed finding at write time.",
      tcb: "acceptedTcbStatuses: UpToDate only.",
      signature_kind: "provider_tee required or no receipt is written.",
      last_local_receipt: localFinding
        ? {
            finding_hash: localFinding.finding_hash,
            citation_hashes: localFinding.citation_hashes,
            evidence_commitments: localFinding.evidence_commitments,
            policy_verdict: localFinding.policy_verdict,
            policy_reasons: localFinding.policy_reasons,
          }
        : null,
    },
    limits_statement: LIMITS,
  };
}
