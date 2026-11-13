# Custos Seal

**AI can analyze sensitive evidence, but nobody can prove where it ran, what it saw, or that the evidence wasn't altered later.**

Custos Seal is a Private Forensic Triage Assistant: investigators upload FICTIONAL/demo evidence, a confidential TEE model on NEAR AI Cloud analyzes it, and each finding becomes a signed, timestamped custody receipt on a NEAR testnet contract. Citations must match the evidence byte-for-byte. Only fingerprints and signatures go on-chain, never the file.

Tracks: Privacy & Private AI (`privacy`) · AI Security & Defense (`security`). Built for NEAR HACKATHON.

## Try it (no API key, no wallet)

```bash
git clone https://github.com/Rahmandefi/custos-seal.git
cd custos-seal
# View-only. Tested on Node 20.20.2 (also 22 and 24). No NEAR AI key. No wallet.
npm ci
npm run verify
```

This verifies the FICTIONAL `larkmoor-sample-v2` sample against live testnet contract `ftcust15e434.testnet`. It recomputes evidence commitments, finding_hash, and citation hashes from `samples/seed/` for the sample Findings, and checks ed25519 signatures on every Finding on the contract. It does **not** call NEAR AI Cloud and does **not** send transactions. The sample salt and `samples/seed/` are public by design (fictional data only).

Hosted demo (no install): https://custos-seal.vercel.app

## Hackathon disclosure

- **Code start date:** First git commit is `99866d4` dated **2026-11-05** (on or after the 2026-10-19 eligibility cutoff).
- **Libraries (from manifests):** `@nearai/inference-sdk` 0.2.1; `near-api-js` ^7.4.0; `pdf-lib` ^1.17.1; `tweetnacl` ^1.0.3; `near-sdk` 5.30.0; `dcap-qvl` 0.7.1. Runtime: Node 20.20.2 for `npm run verify`; Node ≥ 24.22.1 for server/`verify-one`.
- **AI-assisted code:** Yes — AI coding assistants were used for implementation and docs; humans reviewed and own the result.
- **Other projects:** None submitted alongside this entry.
- **Hosted demo:** https://custos-seal.vercel.app kept available through **2026-11-25**.
- **Funds / network:** Demo and scripts use **NEAR testnet only**. The app does not move funds on mainnet. The writer key is a function-call key limited to `record_finding` and `record_custody_check` on `ftcust15e434.testnet`.

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
a court-certified forensic suite.

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

## Optional wallet-signed events (disabled)

A **separate** testnet contract can record investigator-signed `start_case` and
`attest_verification` hashes. Comparison still happens in the app; the contract
stores opaque hashes only. Controls stay hidden until server env
`WALLET_EVENTS_CONTRACT_ID` is set to a **new** account. Never point it at
`ftcust15e434.testnet`. Print-only CLI helpers live in
`wallet-signing-scripts/`. This repo does not ship that WASM. Do not create,
fund, or deploy the events account from these notes.

## Sustainability (proposal: not built)

Candidate model for later: a per-case or per-receipt fee paid in NEAR, plus
paid auditor seats that can verify without holding write keys. **No token and
no payment flow ship in this submission.**

## Problem

Hosted forensic AI is a black box: you cannot prove where analysis ran, which model produced it, or that the operator could not read the evidence. Chain of custody breaks at the AI step.

## What this repo does

1. **Enclave-sealed analysis:** Confidential TEE only (`z-ai/glm-5.3-flash`). Attestation cache TTL 0 for freshness. REPORTDATA / quote checks (including nonce material in the quote) are done offline by `scripts/verify_report.py` (dcap-qvl), not live and not by `npm run verify`. Ed25519 + configured E2EE. TCB `UpToDate` only. The contract checks the enclave signature on-chain, not the attestation.
2. **Deterministic policy:** citations must match evidence byte-for-byte (R1). Schema, provenance, irreversible-action HOLD, injection markers, confidence floor.
3. **On-chain receipts:** full signed receipt stored at creation; contract rebuilds signed text and runs `env::ed25519_verify` (R3).
4. **Human in the loop:** isolate/block/delete/notify wait for an investigator-signed `approve_action`.
5. **Writer key:** backend holds a NEAR **function-call** key scoped to the receipt contract (`record_finding`, `record_custody_check` only). This is **not** the NEAR AI Cloud API key (R2).

Honest limits (NEAR docs): a `provider_tee` signature does not prove *which* GPU instance served the request; gateway + model evidence are not a complete cryptographic chain per response. We use non-streaming Chat Completions with a canonical model ID and `x-no-aliasing`. TDX quotes are verified off-chain; only hashes go on-chain.

Evidence stays in this browser's sessionStorage. The server holds API and writer
secrets in env, ephemeral per-request files under `OUT` / `/tmp` (seen-nonces,
dumped attestation reports during analyze), and in-memory demo rate-limit
counters that reset on cold start. The server keeps no evidence or findings.
Receipts on chain are hashes, signed findings, and policy verdicts.
`clearResponseCache()` runs after verification. Scoping is view isolation; the
chain is public.

## Setup from scratch

Node per command (tested): `npm run verify` and `npm run test:policy` on **Node 20.20.2**. `npm run verify-one` and `npm run server` need **Node ≥ 24.22.1** (`@nearai/inference-sdk` 0.2.1 `engines.node`). App `package.json` engines remain `>=22` for the hosted app. Writer function-call key lives outside the repo at `~/.near-credentials/testnet/ftwriter-fncall.json` (never git). NEAR AI key goes only in `.env`.

```bash
git clone https://github.com/Rahmandefi/custos-seal.git
cd custos-seal
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
cd custos-seal
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

`SKIP_DCAP`: when the exact string `1`, `scripts/server.mjs` sets
`runDcap: false`, so the analyze path skips the independent
`scripts/verify_report.py` / dcap-qvl check of dumped Intel TDX quotes
(REPORTDATA / quote collateral). It does **not** skip the live SDK
gateway/model TCB checks. Production and Preview both define `SKIP_DCAP`
(secret); treat a value of `1` as that offline quote step omitted on analyze.

### UI (evidence-room shell)

With the backend running, open:

http://127.0.0.1:8787/

Screens follow `docs/ui/SCREENS.md` and `docs/ui/DESIGN_NOTES.md`: dark icon rail, category tree, light work area, IBM Plex, case-blue `#1F4FD1`. Analyze, custody check, verify-from-chain, and stolen-key `send_tx` attacks call the live testnet APIs. Sample data is marked FICTIONAL.

## Do X → see Y

Node per command: `npm run verify` / `npm run test:policy` on Node **20.20.2**. `npm run verify-one` / `npm run server` on Node **≥ 24.22.1**.

```bash
git clone https://github.com/Rahmandefi/custos-seal.git
cd custos-seal
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

See: 6 tests pass: valid Ed25519 stores a Finding; flipped signature panics; replay panics; `request_open` from a stranger writes OpenDenied and returns false (no panic); grant/open/custody checks.

### 6. Full analyze POST (testnet)

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

## Third-party libraries

Generated from `package.json`, `contracts/custody/Cargo.toml`, and `requirements-verify.txt`.

| Source | Package | Version |
| --- | --- | --- |
| `package.json` | `@nearai/inference-sdk` | 0.2.1 (`engines.node` `>=24.22.1`) |
| `package.json` | `near-api-js` | ^7.4.0 |
| `package.json` | `pdf-lib` | ^1.17.1 |
| `package.json` | `tweetnacl` | ^1.0.3 |
| `contracts/custody/Cargo.toml` | `near-sdk` | 5.30.0 |
| `contracts/custody/Cargo.toml` (dev) | `ed25519-dalek` | 2 |
| `requirements-verify.txt` | `dcap-qvl` | 0.7.1 |

Runtime (not a library): Node 20.20.2 for `npm run verify` / `npm run test:policy`; Node ≥ 24.22.1 for `verify-one` and `server`. Model id `z-ai/glm-5.3-flash`.

## Samples

`samples/` is a **FICTIONAL SCENARIO** (City of Larkmoor Records Office). Not a real case.

## Deployed (NEAR testnet)

| Role | Account |
| --- | --- |
| Contract | `ftcust15e434.testnet` |
| Owner | `ftowner15e434.testnet` |
| Writer (function-call key only) | `ftwriter15e434.testnet` |

- Deploy transaction: https://explorer.testnet.near.org/transactions/6NcH52t5kLj2N1b8fRLohfLALV1htf7FhYEdLnPhtp89
- The hosted app holds only a function-call key for the writer account (receiver: the contract; methods: `record_finding`, `record_custody_check`; finite gas allowance). The writer's full-access key is kept separately and is never deployed.
- The demo case is `larkmoor-sample-v2` (receipts 17–23, fictional data). Earlier receipts on this contract are development tests.


## License

MIT. See LICENSE.
