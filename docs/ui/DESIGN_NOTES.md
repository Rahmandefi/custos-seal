# Design notes: UI mock-ups v2

Private Forensic Triage Assistant (NEAR hackathon entry). **All case data, accounts, balances and hashes in the mock-ups are FICTIONAL / illustrative.**
The v1 sketches (`*.html`, `preview-*.png`, `src/`) are kept unchanged. The v1 notes are preserved in `DESIGN_NOTES.v1.md`.

## Deliverables (each 3200×2000 PNG, rendered at 2x from 1600×1000 CSS px with headless Chrome)

| File | Screen (SCREENS.md) | One primary action |
|---|---|---|
| `mockup-a-triage-dashboard.png` | Triage dashboard | Review approval (shown focused) · New case in the header |
| `mockup-b-tamper-alert.png` | Custody check → hash mismatch | **Record custody break** |
| `mockup-c1-stolen-key-confirm.png` | Security → stolen-key simulation, confirm | **Cancel** (safe default, focused) |
| `mockup-c2-stolen-key-result.png` | Security → stolen-key result | Attempt the next misuse |
| `mockups-contact-sheet.png` | All four on one sheet | - |

Source: `src-v2/` (`base.css` design system, `lib.py` shell components, `a_dashboard.py`, `b_tamper.py`, `c_key.py`). To rebuild: `python3 a_dashboard.py`, `python3 b_tamper.py`, `python3 c_key.py confirm|result`, then
`google-chrome --headless=new --no-sandbox --hide-scrollbars --force-device-scale-factor=2 --window-size=1600,1000 --virtual-time-budget=1500 --screenshot=<png> file://<html>`.
No AI image generation was used. Every pixel of text is real HTML text.

## Direction
"Evidence room, not crypto app." Examiners already know Autopsy and Cellebrite, so the layout copies their *structure*. A dark navigation rail and a category tree with counts sit on the left, and a light, dense, information-first work area sits on the right. NEAR green and a dark theme were dropped. A neutral light canvas with one case-blue reads as an official tool, and it prints and projects well. Colour is reserved for meaning: verdicts and custody state.

## Palette (roles + WCAG 2.x contrast, computed with the W3C formula)

| Token | Hex | Role | Contrast |
|---|---|---|---|
| ink | `#0B1220` | Icon rail background | - |
| panel / panel-2 / panel-line | `#121B2C` / `#18233A` / `#24314A` | Category tree, selected row, dividers | - |
| side-text | `#C9D2E0` | Tree labels | 12.28 on ink · 11.06 on panel |
| side-muted | `#8E9AAE` | Tree group labels and counts | 6.58 on ink · 5.93 on panel |
| bg / surface / sunk | `#F4F5F7` / `#FFFFFF` / `#F8F9FB` | Canvas, cards, table headers | - |
| line / line-2 | `#E4E7EC` / `#D0D5DD` | Hairlines (decorative) | - |
| line-strong | `#7A8597` | Input and control borders | 3.73 on white (≥3:1 non-text) |
| text | `#0F172A` | Primary text | 17.85 on white |
| text-2 | `#475467` | Secondary text | 7.69 on white · 7.05 on bg |
| text-3 | `#667085` | Meta text, labels | 4.97 on white · 4.72 on sunk |
| primary | `#1F4FD1` | The single primary button, links, selection, focus ring | white on it 6.78 · on wash 5.93 |
| ok | `#0B6B45` on `#E7F5EE` | Accept / Verified / Intact / Rejected-by-NEAR | 5.84 on wash · 6.56 on white |
| flag | `#8A5A00` on `#FDF3D7` | Flagged, caution notes | 5.36 on wash · 5.93 on white |
| block | `#B42318` on `#FDECEA` | Block, custody break, danger outline | 5.75 on wash · 6.57 on white |
| hold | `#5B3FC4` on `#EFEBFD` | Held for human approval; concept tags | 6.09 on wash · 7.11 on white |

All text pairs meet AA (4.5:1). Verdicts are never colour alone. Each is **icon + uppercase label + tinted chip** (e.g. shield-x + "BLOCK"), and custody state uses icon + word ("Intact", "Break").

## Typography, spacing, grid
- **IBM Plex Sans** for UI and **IBM Plex Mono** for hashes, offsets, timestamps, account IDs and method names. Both are open-licensed (SIL OFL). Plex has an engineered, documentary tone, and its mono has distinct 0/O and 1/l, which matters when people read hashes aloud to each other. Mono also gives tabular alignment for timestamps.
- Scale: 11.5 (meta) · 12.5–13.5 (dense tables) · 14 (body) · 20–26 (screen titles). Weight 600 for headings and only one 26px line per screen.
- 4px base grid. Card padding 16–20, gaps 8/12/16. Rows: tree 32px, dense table ~36px (Autopsy-like density), buttons 44px (touch- and glove-friendly target).
- Shell grid: 72px icon rail · 272px category tree · fluid work area. A 56px top bar (breadcrumb, search, state chips, account) and a 30px status bar (file size, sync time, network, FICTIONAL tag) frame every screen.

## Top UX decisions
1. **One primary action per screen, and it is the safe one.**
   - A: Review approval.
   - B: Record custody break.
   - C1: **Cancel**. It is focused by default with a visible 2px white + 3px blue ring, and Enter and Esc both cancel.
   - The risky "Attempt transfer" is a red *outline* button. It also requires a checked acknowledgement, and the consequence is restated: from, to, amount, signing key, expected outcome, and the risk if misconfigured.
2. **Plain words before data.**
   - The tamper screen leads with one sentence ("larkmoor-log.txt doesn't match its custody record").
   - A fixed three-part card follows: **What happened / What's still safe / What we don't know**.
   - Then "When you record it" says the entry is permanent and that you can add a note but not remove it.
   - The stolen-key result leads with "Rejected by NEAR before it ran", then the exact line "Rejected before execution, nothing was recorded, no funds moved.", then four facts: Funds moved 0 NEAR · Writer balance 10.00 → 10.00 · Recorded Nothing · Explorer link None.
3. **Forensic-tool familiarity with lighter cognitive load.**
   - It borrows the tree + table + details structure, counts in the tree, a timeline bar, and hex/mono density.
   - It adds glanceable KPI counts (Waiting for approval, Custody breaks, Flagged findings, Open cases) and dotted-underline terms with tooltips. One is shown open: "Commitment" in A.

Also applied:
- **Forgiving behaviour:** Esc and Cancel everywhere.
- **Visible focus:** focus states are always visible.
- **Wallet-key warning:** the "your wallet key is different" note sits on the key card (C2).
- **No shame-red full-screen alarms:** the tamper alert is a calm tinted banner, because breaks are evidence events, not system crashes.

## Borrowed from forensic tools (visual references only, no branding)
- **Autopsy:**
  - Tree Viewer / Result Viewer / Content Viewer split → category tree, case table, details panel.
  - Dense file table with timestamps → "Latest custody log entries" and the attempt log.
  - Hex Content Viewer → "Where the bytes differ" (offset column, hex, ASCII).
  - Timeline counts view → activity bar in A.
- **Cellebrite Physical Analyzer:**
  - Dark icon sidebar and project/category tree with counts → rail and tree with count badges (alert/hold/flag variants).
  - Timeline synced with the table → activity bar plus selection window.
  - Details pane → right details panel.
  - Image hash details → "Fingerprints compared" (expected vs found).
- **Magnet AXIOM:**
  - Case Dashboard as a starting funnel → KPI counts row.
  - Dark navigation with a light work area to reduce strain → mixed theme.
- **EnCase:**
  - Tree / Table / View panes and acquisition-hash verification → the custody-check flow.

## Motion (described, not rendered; all respect `prefers-reduced-motion: reduce` → instant state changes)
- **A:** a new custody-break marker on the timeline pulses twice (opacity 1→0.4, 600 ms), then stays still. The KPI count ticks up once.
- **B:** the banner slides down 8px and fades in over 200 ms. The changed byte gets a single 1.2 s highlight sweep in both hex rows. No shaking and no looping.
- **C1:** the scrim fades in over 150 ms and the dialog scales from 0.98 to 1 over 160 ms. Focus lands on Cancel, and focus is trapped and returned to the trigger on close.
- **C2:** the result panel fades up over 180 ms, the shield outline draws once (stroke-dashoffset, 400 ms), and the four facts appear together. There is no celebratory confetti; this is a security result. (This is annotated on the PNG.)

## Accuracy notes
- The stolen key is the **app's writer key**: a NEAR **function-call access key** restricted to the receipt contract and its two methods `record_finding` and `record_custody_check`. It is **not** the investigator's wallet key. A wallet full-access key, if stolen, *could* move funds (stated on C2).
- A Transfer signed with a function-call key is rejected by the protocol with **`RequiresFullAccess`** before execution. No funds move, nothing is recorded, and there is no explorer link to an executed transaction.
- The other expected errors are `ReceiverMismatch` (another contract), `MethodNameMismatch` (a method that isn't allowed) and `DepositWithFunctionCall` (an attached deposit). `NotEnoughAllowance` applies when the allowance runs out (not shown on screen).
  - These names were verified earlier this project in nearcore `verify_function_call_permission` (commit 863a2e2e64); see BUILD_FRAMEWORK.md §6.1.
- The gas allowance is labelled a **fee budget, not a spending limit**.
- These figures are **illustrative**, not live values: the 0.25 NEAR allowance, the 4.82 NEAR contract balance, the 10.00 NEAR writer balance and the 5 NEAR transfer amount.
- **[TBD] Hex diff in B:** it needs the stored original bytes. The framework's backend keeps an encrypted evidence copy, so a byte diff is plausible, but the flow (decrypt-to-compare, who may see it) is undecided. The screen marks it "Concept · needs the stored original [TBD]". The "What's still safe" copy claims only that the on-chain custody record is unchanged.
- Hashes on B are SHA-256 of a fictional log with a salt and are illustrative. The changed byte is real for that fictional file (offset 0x0000B5, line 3, 245 bytes).
- On-prem remains a roadmap goal. NEAR hasn't published an on-prem version. None of these screens imply otherwise.

## Sources
- https://www.near.org/ (live HTML and CSS: `#00ec97`, FKGrotesk, Mona Sans; reviewed for v1, not used in v2 palette)
- https://brandfetch.com/near.org
- https://styles.refero.design/style/a8c07777-ae41-4b69-9aa7-b05700ff7a14
- https://github.com/houseofstake/agora-near/blob/main/README.md
- https://the-brandidentity.com/project/fold7designs-limitless-identity-for-near-holds-a-mirror-to-the-blockchain-os-infinite-potential
- https://github.com/near/nearcore (`verify_function_call_permission`, commit 863a2e2e64: RequiresFullAccess, ReceiverMismatch, MethodNameMismatch, DepositWithFunctionCall, NotEnoughAllowance)
- https://sleuthkit.org/autopsy/docs/user-docs/4.23.0/uilayout_page.html · …/4.22.0/tree_viewer_page.html · …/4.21.0/timeline_page.html
- https://apprize.best/security/encase/6.html (EnCase Tree, Table and View panes) · http://www.c-jump.com/bcc/t256t/Week06encase/Week06encase.html (acquisition hash check)
- https://www.magnetforensics.com/blog/better-case-starting-points-with-magnet-axioms-new-case-dashboard/ · https://clarkiv.dev/posts/magnet-introduction-2/ · https://docs.magnetforensics.com/docs/axiom/html/Content/en-us/axiom/reviewing-evidence/explorers/customizing-examining.htm
- https://cellebrite.com/en/ask-the-expert/how-to-use-the-project-tree-and-analyzed-data-in-cellebrite-physical-analyzer-to-find-data-fast/ · https://www.forensicfocus.com/articles/how-to-use-ufed-physical-analyzer-7-3-3/ (timeline) · https://www.scribd.com/document/322537873/UFED-PA-v2-Userguide-pdf (Image Hash Details, from search summary only)
- IBM Plex (SIL OFL): https://github.com/IBM/plex [UNVERIFIED this session: link not reopened]
- WCAG 2.x contrast: https://www.w3.org/TR/WCAG21/#contrast-minimum
- Reference screenshots supplied by the owner (Autopsy, Cellebrite PA), used as visual reference only.
