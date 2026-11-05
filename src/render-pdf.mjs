/** Buffer a case-export JSON into a PDF. Same sections as scripts/export-pdf.py. */
import { PDFDocument, rgb } from "pdf-lib";

const INK = rgb(0.043, 0.071, 0.125);
const MUTED = rgb(0.278, 0.329, 0.404);
const ACCENT = rgb(0.122, 0.31, 0.82);
const LINE = rgb(0.894, 0.906, 0.925);

function s(v) {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

export async function renderPdf(data) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont("Times-Roman");
  const bold = await doc.embedFont("Times-Bold");
  const mono = await doc.embedFont("Courier");
  const pageW = 612;
  const pageH = 792;
  const margin = 48;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  function newPage() {
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
  }
  function need(h) {
    if (y - h < margin) newPage();
  }
  function draw(text, { f = font, size = 10, color = INK, gap = 14 } = {}) {
    const lines = String(text ?? "").split("\n");
    for (const line of lines) {
      need(gap);
      page.drawText(line.slice(0, 110), { x: margin, y: y - size, size, font: f, color });
      y -= gap;
    }
  }
  function kv(rows) {
    for (const [k, v] of rows) {
      need(16);
      page.drawText(String(k), { x: margin, y: y - 9, size: 9, font: bold, color: MUTED });
      const val = s(v);
      const wrap = val.length > 78 ? val.slice(0, 78) + "…" : val;
      page.drawText(wrap, { x: margin + 120, y: y - 9, size: 8, font: mono, color: INK });
      y -= 14;
      page.drawLine({
        start: { x: margin, y },
        end: { x: pageW - margin, y },
        thickness: 0.3,
        color: LINE,
      });
      y -= 4;
    }
  }
  function section(title) {
    y -= 8;
    need(22);
    draw(title, { f: bold, size: 13, color: ACCENT, gap: 18 });
  }

  draw("Custos Seal · Case report", { f: bold, size: 18, gap: 22 });
  draw("FICTIONAL sample items. Private Forensic Triage Assistant.", { size: 9, color: MUTED, gap: 12 });
  draw(data.limits_statement || data.limits || "", { f: bold, size: 10, color: rgb(0.357, 0.247, 0.769), gap: 14 });

  const sm = data.summary || {};
  section("Summary");
  kv([
    ["Contract", sm.contract],
    ["Writer", sm.writer],
    ["Owner", sm.owner],
    ["Receipts", sm.receipt_count],
    ["Findings", sm.finding_count],
    ["HOLD", sm.hold_count],
    ["Pending HOLD", sm.pending_hold_count],
    ["Approvals", sm.approval_count],
    ["Rejections", sm.rejection_count],
    ["Case", sm.case_id],
    ["Sample", sm.sample],
    ["Generated", data.generated_at],
  ]);

  section("Timeline");
  for (const r of data.timeline || []) {
    kv([
      ["Id", r.id],
      ["Kind", r.kind],
      ["Verdict", r.verdict],
      ["prev_hash", r.prev_hash],
    ]);
  }

  section("Findings with citations");
  for (const f of data.findings || []) {
    kv([
      ["Receipt id", f.receipt_id],
      ["Verdict", f.verdict],
      ["Finding hash", f.finding_hash],
      ["Citations", f.citation_hashes],
      ["Evidence", f.evidence_commitments],
      ["Claim", f.local_claim || "on-chain hashes only"],
      ["Actions", f.local_actions],
      ["Label", "FICTIONAL"],
    ]);
  }

  section("Receipts");
  for (const r of data.receipts || []) {
    kv([
      ["Id", r.id],
      ["Kind", r.kind],
      ["Verdict", r.policy_verdict],
      ["Actor", r.actor],
      ["Reason", r.reason],
      ["Finding hash", r.finding?.finding_hash],
      ["Tx", r.tx || "not stored on-chain"],
      ["Explorer", r.explorer],
      ["Prev hash", r.prev_hash],
    ]);
  }

  section("Approvals");
  const apps = data.approvals || [];
  if (!apps.length) draw("No Approval or Rejection receipts.", { size: 10, gap: 14 });
  for (const a of apps) {
    kv([
      ["Id", a.id],
      ["Kind", a.kind],
      ["Reason", a.reason],
      ["Actor", a.actor],
      ["Tx", a.tx],
      ["Prev hash", a.prev_hash],
    ]);
  }

  section("Access log");
  const acc = data.access_log || [];
  if (!acc.length) draw("No Open / OpenDenied receipts.", { size: 10, gap: 14 });
  for (const a of acc) {
    kv([
      ["Id", a.id],
      ["Kind", a.kind],
      ["Actor", a.actor],
      ["Reason", a.reason],
      ["Prev hash", a.prev_hash],
    ]);
  }

  section("Verification results");
  const v = data.verification || {};
  const loc = v.last_local_receipt || {};
  kv([
    ["R1", v.r1],
    ["R2", v.r2],
    ["R3", v.r3],
    ["TCB", v.tcb],
    ["Signature", v.signature_kind],
    ["Local finding hash", loc.finding_hash],
    ["Local citations", loc.citation_hashes],
    ["Local policy", loc.policy_verdict],
    ["Local reasons", loc.policy_reasons],
  ]);
  draw(data.limits_statement || "", { size: 10, gap: 14 });
  draw("FICTIONAL", { f: bold, size: 10, color: rgb(0.357, 0.247, 0.769), gap: 14 });

  return Buffer.from(await doc.save());
}
