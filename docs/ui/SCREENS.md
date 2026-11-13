# Custos Seal · Private Forensic Triage Assistant: Screen Structure

A screen-by-screen layout for the front end. Design principle: the case is the home, the timeline is the spine, and every claim sits next to its evidence. Blockchain terms stay out of the main UI: say "custody log", with a small "view transaction" link.

## Global layout

- **Top bar:** product name, current case name, wallet account (shortened), network badge ("Testnet"), and a status chip showing the verification state of the last analysis (green, amber, red).
- **Left sidebar:** Cases, Evidence, Findings, Approvals, Access, Custody Log, Reports.
- **Style:** neutral dark or light theme, one accent color, dense but readable, monospace for hashes with a copy button, never rely on color alone (add icons and labels).

## Screen 1: First-run setup (guided)

1. Connect wallet.
2. Create a case (name, short description).
3. Load the sample incident (fictional MOVEit-style breach) or upload your own evidence.
4. Run the first analysis.

This same flow doubles as the demo path and the README "do X, see Y" steps.

## Screen 2: Cases list

- Table of cases: name, created date, number of findings, open approvals, custody status (intact or break detected).
- Primary button: New case.
- Click a row to open the case workspace.

## Screen 3: Case workspace (the home screen)

Three columns.

- **Left: Evidence panel.** Files with name, size, salted commitment hash (short, with copy), "evidence stays in this browser session" label, and an Upload button.
- **Center: Timeline (the spine).** One chronological feed mixing uploads, analyses, findings, opens, denied opens, approvals, rejections, and custody checks. Each entry shows time, actor (account), action, and a verdict badge (ACCEPT, FLAG, BLOCK, HOLD). Filters across the top by type and verdict.
- **Right: Detail drawer.** Shows whatever is selected: a finding, a receipt, or a file.

Above the columns: a case summary strip with counts (findings, flagged, held, denied opens) and an Analyze button.

## Screen 4: Verified panel (shown when Analyze runs)

A checklist driven by this analysis request, not a timer. Rows the backend actually runs:

- Gateway TCB (SDK `tcbStatus`, UpToDate only)
- Model TCB (same)
- Nonce format (32-byte hex on reports; reject reuse)
- Nonce request binding only when this app generated a request nonce independently; otherwise unsupported (SDK may still bind internally)
- Reply signature kind (`provider_tee` from `verifyResponse`)
- Citations (quote bytes in the uploaded evidence)
- Independent DCAP via `verify_report.py` when that script ran; otherwise unsupported
- Recorded in the custody log only after successful FINAL execution of the submitted transaction and a matching on-chain receipt (case, finding hash, nonce, evidence commitment)

RTMR3, MRCONFIGID, NVIDIA NRAS, and prompt-encryption validation are shown as not established in this request.

Top chip is the verification state (Verified, Unable to verify, incomplete, or unavailable). Approval/HOLD decisions stay on Approvals. On failure the failing row is red, later rows stay unverified, and no verified finding is recorded.

## Screen 5: Finding detail

Split view.

- **Left: the finding.** Claim, confidence, extracted indicators (IPs, filenames, hashes), recommended actions, and the policy verdict with the rule that triggered it.
- **Right: the evidence viewer.** Line-numbered source text. Clicking a citation highlights the exact span, with a badge: "Citation check passed, byte-for-byte match".
- **Footer:** receipt summary and a "Verify from chain" button.

Blocked findings are shown deliberately, labeled "Rejected: citation check failed", never as results.

## Screen 6: Receipt viewer

- Plain summary at the top: who, when, what, verdict.
- Expandable fields: model ID, request and response hashes, signature, signer key, report hashes, nonce, citation hashes, timestamp.
- Buttons: Verify from chain (recomputes hashes from retained bytes, no NEAR AI Cloud call), Verify independently (opens the NEAR verification center), View transaction.
- Result states: Match, Mismatch (with which field), Unable to check.

## Screen 7: Approvals queue

- List of HOLD items, for example "Isolate host xfer-01".
- Each card states exactly what would happen and why it was held, with the citations behind it.
- Two buttons: Reject (visually default and safer) and Approve. Both open a confirmation step that restates the action, requires a reason, and then asks for the wallet signature.
- Result creates an Approval or Rejection entry on the timeline. The app never performs the action itself, and says so.

## Screen 8: Access

- Who can open this case: list of grantees with date granted and last opened.
- Grant access (account field plus reason) and Revoke buttons.
- A note that revoking cannot un-see files already opened.
- Denied attempts list, flagged in red, with account, time, and evidence targeted.

## Screen 9: Custody check and tamper demo

- Drop a file to compare against the stored commitment.
- Match: "Matches the custody record". Mismatch: a clear red CUSTODY BREAK banner showing expected versus found commitment.
- Same screen for the stored-response byte-flip check.

## Screen 10: Security panel (for the attack demo)

- Shows the writer key's limits in plain words: one contract, two methods, finite gas allowance.
- A "Simulate stolen key" panel with buttons: attempt transfer, call another contract, call a disallowed method, attach a deposit.
- Each result shows the protocol's rejection error and the line "Rejected before execution, nothing was recorded, no funds moved". No explorer link, because nothing executes.
- Also shows the contract balance, since it pays storage.

## Screen 11: Report export

- One click to produce a case report: summary, timeline, findings with citations, receipts, approvals, access log, and verification results.
- Include a plain statement of limits: triage tool, not court-certified, plus attestation notes.
- Formats: PDF and JSON.

## Cross-cutting UX rules

- **Failure states are first-class:** Unable to verify, Blocked, Denied, and Custody break each get a deliberate design and a plain explanation.
- **Irreversible actions get friction:** confirmation step, restated consequence, safe option as default.
- **Progressive detail:** one-line summary first, technical fields behind an expand.
- **Empty states teach:** each empty screen says what to do next.
- **Copy buttons on every hash, and short forms with the full value on hover.**
- **Keyboard navigation and screen-reader labels throughout.**
- **Labels:** every sample item marked FICTIONAL.

## Build priority if time is short

1. Case workspace with timeline
2. Verified panel
3. Finding detail with citation highlighting
4. Receipt viewer with Verify from chain
5. Security panel for the attack demo
6. Approvals queue and Access
7. Report export and the rest
