# Private Forensic Triage Assistant

Investigator uploads sensitive evidence. A model analyzes it inside a confidential TEE on NEAR AI Cloud. Each finding is a signed, timestamped custody receipt on a NEAR contract, with citations checked byte-for-byte against the source.

Tracks: Privacy & Private AI (`privacy`) · AI Security & Defense (`security`). Built for NEAR HACKATHON (code since Oct 19, 2026).

## Verify without an API key (screeners start here)

```bash
# Prerequisites: Node 20+ (Node 24 fine). No NEAR AI key. No wallet.
npm ci
npm run verify
```

This replays the FICTIONAL `larkmoor-demo` sample against the live testnet contract
`ftcust15e434.testnet` (or the contract id in `samples/contract.json` after redeploy).
It checks evidence commitments, citation quotes, and ed25519 finding signatures.
It does **not** call NEAR AI Cloud and does **not** send transactions.

Receipt 0 on the current contract is a filler bootstrap (repeating hashes). The script
skips hash checks for that id. A fresh seed (no filler) is TBD before freeze.

Demo writes (`DEMO_MODE=1`) rate-limit per instance in memory and reset on cold start.

## Why NEAR (not just a signed log)

Custos Seal is a **public, operator-independent audit trail for AI decisions on
sensitive data**. Anyone can re-check evidence commitments, citation hashes, and
finding signatures against the receipt contract without trusting our servers.
A private append-only log can store the same bytes, but it cannot give a
third-party auditor that check without trusting the operator. The chain stores
**hashes and signatures**, not evidence plaintext. Enclave attestation is still
verified off-chain (see Limits); the chain anchors *what was accepted and by
which approved key* so later disputes have a single, public sequence.

## Who it is for

Incident-response firms, cyber insurers, and compliance auditors who already
review AI-assisted triage and need a receipt they can re-verify. It is **not**
a police evidence locker and not a court-certified forensic suite.

## Limits (read before the pitch)

- **Shared model signing key.** NEAR AI Cloud docs state that instances of the
  same model share one signing key, so a matching `provider_tee` signer does not
  prove which machine served the request.
  https://docs.near.ai/cloud/verification/cloud-api/response-signatures
- **Incomplete proof chain.** Preflight gateway/model evidence plus one response
  signature do not yet form a complete model→gateway→final-reply chain (same page).
- **Owner-approved keys.** The contract accepts signatures from model keys the
  contract owner approved. On-chain verification proves that an *approved* key
  signed the finding; re-checking the enclave report remains an off-chain step.
- **Metadata on a public chain.** Case ids, account ids, and timestamps are
  visible. Salting hides file contents; it does not hide that a case exists.
  Mitigation TBD: hashed case ids in public receipts.
- **Scale.** The demo uses a small text listing. Chunked hashing of multi-GB
  disk images is **roadmap**, not built.
- **Append-only.** The testnet contract account still holds a FullAccess deploy key, so the log is append-only only against the current WASM, not against a malicious redeploy. Mainnet hardening replaces this with a multisig/DAO upgrade path. The writer account still has a leftover FullAccess key `ed25519:7U5XSM…` on-chain in addition to the function-call key; delete it locally before freeze.

## Stolen writer key

The Security page shows the **blast radius of a leaked writer function-call
key**: it can call `record_finding` / `record_custody_check` on one contract and
is rejected by NEAR before transfer, cross-contract, disallowed method, or
deposit calls execute. The app does not move funds; the demo is about limiting
a triage key, not about stopping a chain robbery.

## Sustainability (proposal — not built)

Candidate model for later: a per-case or per-receipt fee paid in NEAR, plus
paid auditor seats that can verify without holding write keys. **No token and
no payment flow ship in this submission.**

## Problem

Hosted forensic AI is a black box: you cannot prove where analysis ran, which model produced it, or that the operator could not read the evidence. Chain of custody breaks at the AI step.

## What this repo does

1. **Enclave-sealed analysis** — Confidential TEE only (`z-ai/glm-5.3-flash`). Fresh nonce every request. Ed25519 + E2EE. TCB `UpToDate` only.
2. **Deterministic policy** — citations must match evidence byte-for-byte (R1). Schema, provenance, irreversible-action HOLD, injection markers, confidence floor.
3. **On-chain receipts** — full signed receipt stored at creation; contract rebuilds signed text and runs `env::ed25519_verify` (R3).
4. **Human in the loop** — isolate/block/delete/notify wait for an investigator-signed `approve_action`.
5. **Writer key** — backend holds a NEAR **function-call** key scoped to the receipt contract (`record_finding`, `record_custody_check` only). This is **not** the NEAR AI Cloud API key (R2).

Honest limits (NEAR docs): a `provider_tee` signature does not prove *which* GPU instance served the request; gateway + model evidence are not a complete cryptographic chain per response. We use non-streaming Chat Completions with a canonical model ID and `x-no-aliasing`. TDX quotes are verified off-chain; only hashes go on-chain.

Plaintext evidence exists only in memory during a request. The backend keeps ciphertext, hashes, and attestation/signature evidence for audit. `clearResponseCache()` runs after verification.

## Setup from scratch

Node **≥ 24.22.1**. Writer function-call key lives outside the repo at `~/.near-credentials/testnet/ftwriter-fncall.json` (never git). NEAR AI key goes only in `.env`.

```bash
git clone <repo>
cd forensic-triage
source ~/.nvm/nvm.sh && nvm install 24.22.1 && nvm use 24.22.1
npm install

python3 -m venv .venv
.venv/bin/pip install -r requirements-verify.txt

cp .env.example .env
chmod 600 .env
# set NEAR_AI_API_KEY in .env (cloud.near.ai). Leave other names blank to use defaults.

npm run server
```

In another terminal:

```bash
cd forensic-triage
curl -sS --data-binary @samples/larkmoor-listing.txt \
  http://127.0.0.1:8787/analyze | tee /tmp/ft-analyze.json
```

See: JSON with `receipt_id` and `tx`. Salt is in the JSON and in `out/case-salt.hex` (gitignored).

```bash
SALT=$(python3 -c 'import json; print(json.load(open("/tmp/ft-analyze.json"))["salt"])')
RID=$(python3 -c 'import json; print(json.load(open("/tmp/ft-analyze.json"))["receipt_id"])')
node scripts/verify-from-chain.mjs --id "$RID" --file samples/larkmoor-listing.txt --salt "$SALT"
node scripts/verify-from-chain.mjs --id "$RID" --file samples/larkmoor-listing.txt --salt "$SALT" --tamper
```

See: first command `"pass": true`; tamper `"pass": false`.

Optional: `SKIP_DCAP=1` in `.env` skips `dcap-qvl` if you have not installed the venv.

### UI (evidence-room shell)

With the backend running, open:

http://127.0.0.1:8787/

Screens follow `docs/ui/SCREENS.md` and `docs/ui/DESIGN_NOTES.md`: dark icon rail, category tree, light work area, IBM Plex, case-blue `#1F4FD1`. Analyze, custody check, verify-from-chain, and stolen-key `send_tx` attacks call the live testnet APIs. Sample data is marked FICTIONAL.

## Do X → see Y

Requires Node **≥ 24.22.1**. This machine: `nvm install 24.22.1`.

```bash
git clone <repo>
cd forensic-triage
nvm use 24.22.1
npm install
```

### 1. Attestation preflight (no API key)

```bash
npm run verify-one -- --attest-only
```

See: `out/attestation.json` with gateway + model reports verified. Console prints `gateway verified: true` and `model reports: 1`.

### 2. One paid completion + `provider_tee` (needs API key)

Claim $10 credits via NEAR Builders, create a key at cloud.near.ai.

```bash
cp .env.example .env   # set NEAR_AI_API_KEY
set -a && source .env && set +a
npm run verify-one
```

See: console `verifyResponse: provider_tee` and `out/receipt.json` with signature, signedText, signer, report hashes.

### 3. Independent quote check

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-verify.txt
NEAR_AI_DUMP_REPORTS=1 npm run verify-one -- --attest-only
.venv/bin/python scripts/verify_report.py
```

See: `gateway: tcb=UpToDate` and `model: tcb=UpToDate` (quote path must be present in the dump).

### 4. Policy engine (R1 citation fixtures)

```bash
npm run test:policy
```

See: exact match ACCEPT; whitespace / wrong line / missing / fabricated quote BLOCK; IOC-outside FLAG.

### 5. Receipt contract unit tests

```bash
cd contracts/custody && cargo test --lib
```

See: 6 tests pass — valid Ed25519 stores a Finding; flipped signature panics; replay panics; `request_open` from a stranger writes OpenDenied and returns false (no panic); grant/open/custody checks.

### 6. End-to-end POST (testnet)

```bash
set -a && source .env && set +a
npm run server   # http://127.0.0.1:8787
curl -sS --data-binary @samples/larkmoor-listing.txt http://127.0.0.1:8787/analyze
```

See: JSON with `receipt_id` and `tx`. Salts stay in `out/case.json` (gitignored).

### 7. Verify from chain

```bash
node scripts/verify-from-chain.mjs --id <N> --file samples/larkmoor-listing.txt --salt $(tr -d '\n' < out/case-salt.hex)
# then flip a byte:
node scripts/verify-from-chain.mjs --id <N> --file samples/larkmoor-listing.txt --salt $(tr -d '\n' < out/case-salt.hex) --tamper
```

See: first command `pass: true`; tamper `pass: false` (evidence commitment).

### 8. Fail-closed paths

```bash
npm run test:pipeline
```

See: TCB / not `provider_tee` / citation mismatch / reused nonce / allowance 0 all throw `PipelineError` with `skipChain`; `receipt_count` unchanged.

## Stack

| Piece | Version |
| --- | --- |
| `@nearai/inference-sdk` | 0.2.1 (Node entry) |
| `dcap-qvl` | 0.7.1 |
| `near-sdk` | 5.30.0 (planned) |
| Model | `z-ai/glm-5.3-flash` (canonical; not the GLM-5.1-FP8 alias) |

Third-party libraries so far: `@nearai/inference-sdk`, `dcap-qvl`.

## Samples

`samples/` is a **FICTIONAL SCENARIO** (City of Larkmoor Records Office). Not a real case.

## Status (2026-11-05)

Day 1 live check (Confidential TEE, Ed25519, TCB UpToDate):

- `verifyResponse` → `provider_tee`
- completion id `ce20a9e81ed5427a95707d9fd3563d40`
- signedText `z-ai/glm-5.3-flash:<request_hash>:<response_hash>`
- structured outputs + E2EE: **works** on `z-ai/glm-5.3-flash`

The API key is never in git. `.env` is gitignored, mode 600.

- [x] Repo skeleton, MIT LICENSE, README, samples, policy fixtures
- [x] Live `provider_tee` completion
- [x] Rust receipt contract unit tests (`ed25519_verify`, replay, OpenDenied)
- [x] Testnet deploy + live `provider_tee` Finding stored (`ed25519_verify` at write)
- [x] Real nonce / salted evidence commitments / finding_hash / citation_hashes (receipt id 1)
- [x] Independent dcap-qvl `UpToDate` on gateway+model quotes; hashes match receipt
- [x] Writer function-call key (receiver contract, `record_finding`+`record_custody_check`, 0.25 NEAR)
- [x] Four scoped-key attacks via raw `send_tx`: `RequiresFullAccess`, `ReceiverMismatch`, `MethodNameMismatch`, `DepositWithFunctionCall` (`out/key-scope-tests.txt`)
- [x] Open / OpenDenied / custody pass / custody tamper on testnet; contract tests 6/6
- [x] Measured full gas (tx + receipt outcomes) in `out/costs.md`
- [x] Salted `finding_hash` / `citation_hashes` (same construction as evidence commitments)
- [x] POST `/analyze` pipeline + custody open/check/HOLD
- [x] `scripts/verify-from-chain.mjs`
- [x] Fail-closed tests (no chain write)

Testnet (2026-11-05):

| Role | Account |
| --- | --- |
| Contract | `ftcust15e434.testnet` |
| Owner | `ftowner15e434.testnet` |
| Writer | `ftwriter15e434.testnet` |

- Deploy: https://explorer.testnet.near.org/transactions/6NcH52t5kLj2N1b8fRLohfLALV1htf7FhYEdLnPhtp89
- `add_signer`: https://explorer.testnet.near.org/transactions/EqPWta3mUqgU7AXi7jdjMR3ay4VW7Vzjy4DoqRfAZZHr
- Receipt **0** — superseded filler test (`kind=Finding`): https://explorer.testnet.near.org/transactions/BNR827Htm3yL1HdaF7AsotxVyPde2Vp74fePvaUX1Rjg
- Receipt **1** — first real Finding (live TEE, salted evidence commitment, `Accept`): https://explorer.testnet.near.org/transactions/D9xgsYHF9KC2nEHx19mNsJVjJNjG395bT7p5GmbotLgZ
- Receipts 2–5: Open, OpenDenied, CustodyCheck Accept, CustodyCheck Block (left unchanged)
- Receipt **6** — salted `finding_hash`/`citation_hashes` from `samples/larkmoor-listing.txt`: https://explorer.testnet.near.org/transactions/CNVdjDYftBUYGXUSL5WezHuGzSMLjfG3DjER4VEaPQAj (storage +609 bytes)
- Writer function-call key `ed25519:2f4coffNJB6iV9t7DdnByZNEETr1UXvvYhLfAGe5bevv` (receiver `ftcust15e434.testnet`, methods `record_finding` + `record_custody_check`)
- The writer's **full-access** key is kept **offline** (`~/.near-credentials/offline/`), not deleted. A NEAR account with only a function-call key and no remaining full-access key cannot add keys, delete keys, or recover; deleting the last full-access key locks the account. The offline key is the recovery path if the 0.25 NEAR allowance needs a top-up or the method list needs a change.
- [ ] UI (wallet, Verified panel, citation highlight)
- [ ] Demo video

## License

MIT. See LICENSE.
