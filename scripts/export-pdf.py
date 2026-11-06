#!/usr/bin/env python3
"""Render the case export JSON (stdin or argv path) to a PDF. Ids/hashes copied verbatim."""
import json
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)

INK = colors.HexColor("#0B1220")
MUTED = colors.HexColor("#475467")
LINE = colors.HexColor("#E4E7EC")
HOLD = colors.HexColor("#5B3FC4")
ACCENT = colors.HexColor("#1F4FD1")


def p(text, style):
    return Paragraph(str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), style)


def section(title, styles):
    return Paragraph(title, styles["secHead"])


def kv_table(rows, styles, col0=1.6 * inch, col1=5.4 * inch):
    data = [[p(f"<b>{a}</b>", styles["tiny"]), p(b if b not in (None, "") else "-", styles["mono"])] for a, b in rows]
    t = Table(data, colWidths=[col0, col1])
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, LINE),
            ]
        )
    )
    return t


def main():
    raw = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    docj = json.loads(raw)
    out_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/custos-seal-report.pdf"

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="h1c", parent=styles["Title"], fontName="Times-Bold", fontSize=18, textColor=INK, spaceAfter=6, leading=22))
    styles.add(ParagraphStyle(name="secHead", parent=styles["Heading2"], fontName="Times-Bold", fontSize=13, textColor=ACCENT, spaceBefore=14, spaceAfter=6))
    styles.add(ParagraphStyle(name="bodyCopy", parent=styles["Normal"], fontName="Times-Roman", fontSize=10, textColor=INK, leading=14, spaceAfter=6))
    styles.add(ParagraphStyle(name="tiny", parent=styles["Normal"], fontName="Times-Roman", fontSize=9, textColor=MUTED, leading=12))
    styles.add(ParagraphStyle(name="mono", parent=styles["Normal"], fontName="Courier", fontSize=8, textColor=INK, leading=11))
    styles.add(ParagraphStyle(name="warn", parent=styles["Normal"], fontName="Times-Bold", fontSize=10, textColor=HOLD, leading=13, spaceAfter=8))

    story = []
    story.append(Paragraph("Custos Seal · Case report", styles["h1c"]))
    story.append(Paragraph("FICTIONAL sample items. Private Forensic Triage Assistant.", styles["tiny"]))
    story.append(Paragraph(docj.get("limits_statement") or docj.get("limits") or "", styles["warn"]))

    s = docj.get("summary") or {}
    story.append(section("Summary", styles))
    story.append(
        kv_table(
            [
                ("Contract", s.get("contract")),
                ("Writer", s.get("writer")),
                ("Owner", s.get("owner")),
                ("Receipts", s.get("receipt_count")),
                ("Findings", s.get("finding_count")),
                ("HOLD", s.get("hold_count")),
                ("Pending HOLD", s.get("pending_hold_count")),
                ("Approvals", s.get("approval_count")),
                ("Rejections", s.get("rejection_count")),
                ("Case", s.get("case_id")),
                ("Sample", s.get("sample")),
                ("Generated", docj.get("generated_at")),
            ],
            styles,
        )
    )

    story.append(section("Timeline", styles))
    trows = [[p("<b>Id</b>", styles["tiny"]), p("<b>Kind</b>", styles["tiny"]), p("<b>Verdict</b>", styles["tiny"]), p("<b>prev_hash</b>", styles["tiny"])]]
    for r in docj.get("timeline") or []:
        trows.append(
            [
                p(r.get("id"), styles["mono"]),
                p(r.get("kind"), styles["tiny"]),
                p(r.get("verdict") or "-", styles["tiny"]),
                p(r.get("prev_hash") or "-", styles["mono"]),
            ]
        )
    tbl = Table(trows, colWidths=[0.5 * inch, 1.2 * inch, 1.0 * inch, 4.3 * inch], repeatRows=1)
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F4F5F7")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.3, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(tbl)

    story.append(section("Findings with citations", styles))
    for f in docj.get("findings") or []:
        block = [
            kv_table(
                [
                    ("Receipt id", f.get("receipt_id")),
                    ("Verdict", f.get("verdict")),
                    ("Finding hash", f.get("finding_hash")),
                    ("Citations", ", ".join(f.get("citation_hashes") or []) or "-"),
                    ("Evidence", ", ".join(f.get("evidence_commitments") or []) or "-"),
                    ("Claim", f.get("local_claim") or "on-chain hashes only"),
                    ("Actions", ", ".join(f.get("local_actions") or []) or "-"),
                    ("Label", "FICTIONAL"),
                ],
                styles,
            ),
            Spacer(1, 8),
        ]
        story.append(KeepTogether(block))

    story.append(section("Receipts", styles))
    for r in docj.get("receipts") or []:
        story.append(
            kv_table(
                [
                    ("Id", r.get("id")),
                    ("Kind", r.get("kind")),
                    ("Verdict", r.get("policy_verdict")),
                    ("Actor", r.get("actor")),
                    ("Reason", r.get("reason")),
                    ("Finding hash", (r.get("finding") or {}).get("finding_hash")),
                    ("Tx", r.get("tx") or "not stored on-chain"),
                    ("Explorer", r.get("explorer") or "-"),
                    ("Prev hash", r.get("prev_hash")),
                ],
                styles,
            )
        )
        story.append(Spacer(1, 6))

    story.append(section("Approvals", styles))
    apps = docj.get("approvals") or []
    if not apps:
        story.append(Paragraph("No Approval or Rejection receipts.", styles["bodyCopy"]))
    for a in apps:
        story.append(
            kv_table(
                [
                    ("Id", a.get("id")),
                    ("Kind", a.get("kind")),
                    ("Reason", a.get("reason")),
                    ("Actor", a.get("actor")),
                    ("Tx", a.get("tx")),
                    ("Prev hash", a.get("prev_hash")),
                ],
                styles,
            )
        )

    story.append(section("Access log", styles))
    acc = docj.get("access_log") or []
    if not acc:
        story.append(Paragraph("No Open / OpenDenied receipts.", styles["bodyCopy"]))
    for a in acc:
        story.append(
            kv_table(
                [
                    ("Id", a.get("id")),
                    ("Kind", a.get("kind")),
                    ("Actor", a.get("actor")),
                    ("Reason", a.get("reason")),
                    ("Prev hash", a.get("prev_hash")),
                ],
                styles,
            )
        )

    story.append(section("Verification results", styles))
    v = docj.get("verification") or {}
    loc = v.get("last_local_receipt") or {}
    story.append(
        kv_table(
            [
                ("R1", v.get("r1")),
                ("R2", v.get("r2")),
                ("R3", v.get("r3")),
                ("TCB", v.get("tcb")),
                ("Signature", v.get("signature_kind")),
                ("Local finding hash", loc.get("finding_hash")),
                ("Local citations", ", ".join(loc.get("citation_hashes") or [])),
                ("Local policy", loc.get("policy_verdict")),
                ("Local reasons", "; ".join(loc.get("policy_reasons") or [])),
            ],
            styles,
        )
    )
    story.append(Spacer(1, 12))
    story.append(Paragraph(docj.get("limits_statement") or "", styles["bodyCopy"]))
    story.append(Paragraph("FICTIONAL", styles["warn"]))

    SimpleDocTemplate(
        out_path,
        pagesize=letter,
        leftMargin=0.7 * inch,
        rightMargin=0.7 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        title="Custos Seal case report",
        author="Custos Seal",
    ).build(story)
    print(out_path)


if __name__ == "__main__":
    main()
