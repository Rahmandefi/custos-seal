# Private Forensic Triage Assistant: Build Framework

**NEAR Hackathon entry · Tracks: Privacy & Private AI (`privacy`) · AI Security & Defense (`security`)**
Prepared Wed Nov 4, 2026 (Lagos, UTC+1). Submissions close **Nov 14, 2026, 23:59 UTC** (Nov 15, 00:59 Lagos). Judging Nov 16-18, 2026.

> **How to read this document.** Every technical claim was checked this session against NEAR documentation, GitHub source, npm/PyPI/crates.io package pages or live endpoints, opened on Nov 4, 2026. Each section ends with its sources. **[UNVERIFIED]** marks something we could not confirm. **[TBD]** marks a decision the team still has to make. "Live check" means we ran it ourselves against the production endpoint on Nov 4, 2026 between 22:40 and 23:20 Lagos time. **Required design fixes R1-R3** (citations on every finding, a writer key scoped to one contract, receipts stored on-chain at creation) were added at 23:20 Lagos and are summarized in §3.1.

---

## 1. Project overview

**One-line pitch:** An investigator uploads sensitive evidence. A model analyzes it inside a confidential TEE on NEAR AI Cloud. Each finding becomes a signed, timestamped custody receipt that references the attestation evidence, and the receipt is stored on a NEAR contract.

| Item | Decision |
| --- | --- |
| Inference | NEAR AI Cloud, **Confidential TEE** tier only: models served by NEAR on its own GPU fleet. We don't use the 3P Confidential TEE tier or the Incognito tier. |
| Model | **[TBD]** Pick one canonical model ID from the Confidential TEE chat models in §5.2. The suggested default is `z-ai/glm-5.3-flash`. |
| Verification | `@nearai/inference-sdk` 0.2.1 (Node entry point), configured to verify on every request, with Ed25519 signing and E2EE on. We also run an independent check of the same report with `dcap-qvl`. |
| Chain | NEAR **testnet**, with a Rust contract built on `near-sdk` 5.30.0 and deployed with `cargo-near` 0.22.0 and `near-cli-rs` 0.30.1. |
| Layers | (1) enclave-sealed analysis · (2) deterministic policy checks outside the model · (3) signed, timestamped receipts on NEAR · (4) a human decides every irreversible action |
| Required design fixes | **R1** every finding cites the exact evidence it came from, checked byte-for-byte by the policy engine · **R2** receipts are written with a NEAR function-call access key limited to the one receipt contract · **R3** the full signed receipt is stored on-chain at creation, and its Ed25519 signature is checked on-chain at write time (§3.1) |
| Hackathon scope | A working prototype with a reproducible README, a demo video, fictional sample data and a public repo. |
| Out of scope (roadmap) | NEAR Intents Agent API wallet policies, private or on-prem deployment, and multi-tenant agency features. |

## 2. Problem statement

- **Forensic AI is a black box.** When evidence goes through a hosted model, the investigator can't prove where the analysis ran, which model produced it, or whether the operator could read the evidence.
- **Chain of custody breaks at the AI step.** Custody depends on a tamper-evident record of who handled what and when. AI analysis today leaves no verifiable record that ties a finding to the exact input and the exact environment that produced it.
- **Sensitive material can't go to ordinary cloud AI.** Case files, personal data and privileged material can't be sent to a provider that can read prompts and outputs.
- **Access to evidence is rarely provable.** Investigators share files by link or password, and there is no tamper-evident log of who opened what, when and why.

## 3. Solution architecture (layered)

```
Investigator (browser, NEAR wallet)
   │ 1. upload: hash + encrypt at rest (storage key held by the investigator's app)
   ▼
App backend (Node ≥ 24.22.1)
   │ 2. preflight: fresh nonce → gateway + model attestation → verify (SDK + independent dcap-qvl)
   │ 3. E2EE chat completion (non-streaming, canonical model ID, x-no-aliasing)
   ▼
NEAR AI Cloud gateway (Intel TDX CVM) ──► model enclave (Intel TDX CVM + 8× NVIDIA H200, CC mode)
   │ 4. encrypted reply + provider_tee signature over "<model>:<sha256(req)>:<sha256(resp)>"
   ▼
App backend
   │ 5. verifyResponse(id) → provider_tee only
   │ 6. deterministic policy engine (incl. R1 citation checks) → ACCEPT / FLAG / BLOCK / HOLD
   │ 7. record_finding(full signed receipt), signed with a NEAR function-call key
   │    whose receiver is the receipt contract only (R2)
   ▼
NEAR testnet: receipt contract (Rust)
   full signed receipts stored at creation (R3) · per-case allowlist · approved signer keys · NEP-297 events
   env::ed25519_verify of the provider_tee signature at write time, against an approved key
```

| Layer | What it guarantees | What it does not guarantee |
| --- | --- | --- |
| **L1 Enclave-sealed analysis** | The prompt is encrypted to a model key bound to a verified Intel TDX quote (plus NVIDIA GPU evidence), and the reply is signed by that attested key. | It doesn't say the model's answer is correct. NEAR's own docs note that attestation "does not validate the quality of a model response". |
| **L2 Deterministic policy** | Rule-based checks that run outside the model, so the model can't talk its way past them. Every finding must cite evidence whose quoted span matches the source byte-for-byte (R1). | It can't catch errors the rules don't encode. A correct quote with a wrong interpretation still passes. |
| **L3 Signed receipts on NEAR** | An append-only, timestamped (`env::block_timestamp()`) record of findings, opens and approvals. Each finding's full signed receipt is stored at creation, and its Ed25519 signature is checked on-chain at write time (R3). | It doesn't verify the TDX quote on-chain. That happens off-chain, and only a hash reference is anchored. |
| **L4 Human-in-the-loop** | Irreversible actions (isolate host, notify, delete, block, share externally) wait for an investigator sign-off transaction. | - |

**Data-handling rule (from the track prompt):** the Privacy track's starter prompt asks for "Keep nothing server-side after a response returns." Our backend keeps only **ciphertext** evidence (Layer A), hashes, and the retained attestation/signature evidence needed for audit. Plaintext exists only in memory while a request is in flight, and we call `clearResponseCache()` after verification. The README must say this and point to the code that does it.

### 3.1 Required design fixes for the core product (R1-R3)

These three are **required**, not optional polish. Each one also appears in the contract (§5.5), access control (§6), policy engine (§7), demo (§9), plan (§10), risks (§11) and checklist (§12).

| Fix | What it requires | Why |
| --- | --- | --- |
| **R1 Citations on every finding** | Every finding cites the exact evidence it came from: the evidence ID (its salted commitment), a line range, the matching byte range and the quoted span. The policy engine checks each citation deterministically (§7, P2). The receipt stores salted citation hashes, never evidence text. | A model can produce a plausible but wrong finding. Rules catch contradictions with the data, but not a plausible lie. A citation makes each finding checkable against the source. |
| **R2 Writer key scoped to one contract** | Receipt writes are signed with a **NEAR function-call access key** on the backend's NEAR account, with `receiver_id` = the receipt contract and `method_names` = the writer methods only (§6). This is **not** the NEAR AI Cloud API key, which is a separate bearer token for inference and isn't a NEAR access key. | Security-track requirement. The NEAR protocol rejects any attempt to use this key for a transfer, a key change, another contract or another method (verified in nearcore source, §6). |
| **R3 Receipts stored on-chain at creation** | In the same request handler that verifies the reply, the full signed receipt is written on-chain: model ID, request and response hashes, Ed25519 signature, signing public key, attestation report hashes, nonce, citation hashes, policy verdict and block timestamp. The contract rebuilds the signed text and runs `env::ed25519_verify` before storing (§5.5). | Later verification reads a stored, already-checked record. It doesn't depend on the SDK's 60-minute response copy or on how long NEAR's server keeps `/v1/signature` available **[UNVERIFIED]**. |

*Sources:* docs.near.ai/cloud/private-inference · docs.near.ai/cloud/models · docs.near.ai/cloud/verification/reference/verification-policy · github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/03-privacy.md · github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md · github.com/nearai/inference-sdk/blob/main/js/docs/api-reference.md · docs.near.org/protocol/accounts-contracts/access-keys

## 4. Attestation flow, step by step

We verify **before** sending the prompt, for **every** analysis request. A report fetched after the completion can't stand in for preflight evidence.

1. **Generate a nonce.** The client generates 32 random bytes (64 hex characters) and keeps them until verification finishes.
2. **Fetch gateway and model evidence in one call:**
   `GET https://cloud-api.near.ai/v1/attestation/report?model=<CANONICAL_ID>&provider=near&signing_algo=ed25519&nonce=<hex>&include_tls_fingerprint=<bool>`
   with header `x-no-aliasing: true`. The response contains `gateway_attestation`, `model_attestations[]` (omitted when there is no candidate), and OHTTP key evidence. Reject a missing or empty `model_attestations[]`.
3. **Verify the Intel TDX quote** (`intel_quote`) with a DCAP verifier (`dcap-qvl`), and apply the TCB policy. We plan to accept only `UpToDate`. Note that the SDK's default also accepts `OutOfDate`, so we override it. Reject the quote if TDX debug mode is on (bit 0 of `TD_ATTRIBUTES`).
4. **Check the nonce and signer binding from the verified quote, not from the HTTP fields.** For NEAR-operated reports, REPORTDATA is 64 bytes. The **last 32 bytes are the client nonce**. The **first 32 bytes** are the signing identity right-padded with zeros (ECDSA address = 20 bytes; Ed25519 public key = 32 bytes). With TLS binding, they are instead `SHA-256(identity ‖ tls_cert_fingerprint)`. `request_nonce` must also equal our nonce. Model reports **don't currently return `report_data`**, so read it from the verified quote.
5. **Replay `event_log` into RTMR3.** Decode the JSON string and use only events with `imr == 3`, in order. For each, compute `digest = SHA-384(le32(event_type) ‖ ":" ‖ event ‖ ":" ‖ hex_decode(event_payload))`, check it against any non-empty `digest`, then extend: `RTMR3 = SHA-384(RTMR3 ‖ digest)`, starting from 48 zero bytes. The result must equal RTMR3 in the quote.
6. **Check the configuration measurement.** Hash the raw `info.tcb_info.app_compose` string, without re-serializing it (`jq -j`, not `jq -r`). MRCONFIGID (48 bytes) must equal `0x01 ‖ SHA-256(app_compose) ‖ 15 zero bytes`.
7. **Check GPU evidence.** When `nvidia_payload` is present, check that its `nonce` equals ours, send it unchanged to NVIDIA NRAS (`POST https://nras.attestation.nvidia.com/v3/attest/gpu`), and require `x-nvidia-overall-att-result == true` in the returned JWT.
8. **Retain** every verified candidate: signer, algorithm, public key, TCB status and SHA-256 of the raw report. These hashes become the receipt's `gateway_report_hash` and `model_report_hash`. Also retain the **exact request and response body bytes**: the signature covers exact bytes, and the docs say not to parse and re-serialize them. They go into the encrypted case record so an authorized checker can recompute every hash later.
9. **Send the request.** Send an E2EE chat completion: non-streaming, canonical model ID, `x-no-aliasing: true`, encrypted to the verified `signing_public_key` (sent as `X-Model-Pub-Key`).
10. **Verify the response signature.** Call `GET /v1/signature/{chat_id}?signing_algo=ed25519` (through the SDK's `verifyResponse(id)`). Require `signature_kind == "provider_tee"` and `text == "<MODEL_ID>:<sha256(exact request bytes)>:<sha256(exact response bytes)>"`. The signer and algorithm must match **exactly one** retained, verified model report. With ECDSA the check is EIP-191 address recovery; with Ed25519 the signature is checked against the 32-byte public key.
11. **Check citations and write the receipt immediately.** Run the policy engine, including the R1 citation checks, then call `record_finding` with the full signed receipt (R3) in the same request handler. The contract re-checks the Ed25519 signature on-chain. After that, nothing depends on the SDK's 60-minute window.
12. **Fail closed.** If anything is missing, mismatched or unavailable after a short bounded retry, the finding is **UNVERIFIED** and no receipt is written.

**Pitfalls the docs call out:**
- The gateway re-signs a response (`signature_kind: "gateway"`) **on streamed completions by default, when it resolves a model alias, and on the Responses API**. A gateway signature doesn't prove model TEE execution. So: no streaming, no aliases, Chat Completions only. Live check: `zai-org/GLM-5.1-FP8` (the model ID in the current quickstart example) is now an **alias** of `z-ai/glm-5.3-flash`.
- Instances of the same model **share one signing key**, so a matching `provider_tee` signer doesn't prove that the attested instance and the serving instance are the same machine.
- Preflight gateway evidence plus one response signature "do not yet form a complete model-to-Gateway-to-final-response chain" (NEAR docs). The demo must state this limit honestly.
- `/v1/signature` defaults to `ecdsa`, while `/v1/attestation/report` defaults to `ed25519` for the gateway and `ecdsa` for models. Always pass `signing_algo` explicitly.

**Live check (Nov 4, 2026, ~22:55 Lagos):** We ran NEAR's published Python helper with `dcap-qvl` 0.7.1 against `z-ai/glm-5.3-flash` with `provider=near`, first with `signing_algo=ecdsa` and then again (~23:08 Lagos) with `signing_algo=ed25519`, the setting this build uses. In both runs, gateway and model quotes returned `UpToDate` with no advisories, and the REPORTDATA, MRCONFIGID and RTMR3 checks below passed. The quotes are TDX quote v4 (header version 4, attestation key type 2, TEE type 0x81), and both are 5,006 bytes. The debug bit was 0. REPORTDATA bound signer + nonce. MRCONFIGID matched `app_compose`. The RTMR3 replay matched (10 gateway events, 13 model events). In the first run, the model's `nvidia_payload` had `arch: HOPPER` and 8 GPU evidence entries, and NRAS returned overall `true`. Separately, `InferenceClient.verify('z-ai/glm-5.3-flash')` from `@nearai/inference-sdk` 0.2.1 on Node 24.22.1 returned gateway `UpToDate` and 1 verified model report. With `signing_algo=ed25519`, the model's `signing_address` equals its 32-byte `signing_public_key`. **[UNVERIFIED]** We haven't run a full paid completion plus `verifyResponse()` yet, because no API key was available in this session. That is Day 1's first task.

*Sources:* docs.near.ai/cloud/verification/cloud-api/gateway-attestation · docs.near.ai/cloud/verification/cloud-api/model-attestations · docs.near.ai/cloud/verification/reference/quote-nonce-signer · docs.near.ai/cloud/verification/cloud-api/response-signatures · docs.near.ai/cloud/verification/reference/verification-policy · live `GET https://cloud-api.near.ai/v1/attestation/report` · live `GET https://cloud-api.near.ai/v1/model/z-ai%2Fglm-5.3-flash`

## 5. Tech stack (verified details)

### 5.1 NEAR AI Cloud API

| Fact | Value |
| --- | --- |
| Base URL / auth | `https://cloud-api.near.ai/v1`, `Authorization: Bearer <key>`, OpenAI-compatible |
| Tiers | **Confidential TEE**: NEAR's own GPU fleet in TEEs, with attestation, signatures and verification. **3P Confidential TEE**: a third-party provider's TEE. The JS SDK verifies Chutes model attestation; the Python SDK verifies only the gateway. **Incognito**: only the gateway runs in a TEE, and the model runs on the provider's infrastructure. |
| Hardware | Per the docs, each Private LLM Node has 8× NVIDIA H200 GPUs and Intel TDX-enabled CPUs. The live GPU evidence showed `HOPPER` with 8 entries. |
| Attestation endpoint | `GET /v1/attestation/report`. The API reference says it "Requires an API key" and that retrieval is non-billable. Per the SDK docs, listed models can also be queried without credentials, and our live check worked without a key. We will still send the key. |
| Signature endpoint | `GET /v1/signature/{id}?signing_algo=…`. A 2xx response with `error_code` means unavailable. A 404 means not found yet, so retry briefly. |
| E2EE protocol (v2, Ed25519) | X25519 ECDH · HKDF-SHA256 (info `ed25519_encryption`) · XChaCha20-Poly1305, with an ephemeral key per request. Wire format: `ephemeral_pubkey(32) ‖ nonce(24) ‖ ciphertext+tag`. Headers: `X-Signing-Algo`, `X-Client-Pub-Key`, `X-Model-Pub-Key`, `X-Encryption-Version: 2`, and optionally `X-Encrypt-All-Fields: true`. |
| E2EE legacy (ECDSA) | secp256k1 ECDH · HKDF-SHA256 · AES-256-GCM, with no `X-Encryption-Version` header. The docs label it "Legacy". |
| E2EE scope | Requires a supported NEAR TEE model (a vLLM model with attestation). The raw protocol covers `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` and `/v1/images/generations`. **The SDK's field-level E2EE covers Chat Completions only.** Responses rejects field-level E2EE. Headers, query parameters and unlisted fields aren't encrypted. By default it covers `content`, `reasoning_content`, `reasoning` and `audio.data`. |
| OHTTP | Optional encapsulation to the attested gateway for Chat, Responses and Messages. Ed25519 only. It doesn't hide outer auth headers or the client IP. |
| Verification Center | `https://cloud.near.ai/verify?model=<url-encoded id>` re-fetches evidence in the browser each visit. An app can deep-link one reply with `#receipt=<base64url JSON>`, using the fields `completionId`, `model`, `signatureKind`, `signingAlgo`, `signingAddress`, `signedText`, `signature` and optionally `verifiedAt`. It doesn't compare measurements against an allowlist. |
| Credits | You can claim $10 by joining NEAR Builders (nearbuilders.org/join), per HACKATHON.md Q-000. The API key is created in the cloud.near.ai dashboard. |

### 5.2 Confidential TEE chat models available now (live `/v1/models` + `/v1/model/{id}`, Nov 4, 2026)

These have `providerType: vllm` and `attestationSupported: true`. Prices are USD per 1M tokens, input / output.

| Model ID (canonical) | Context | Price in / out | Notes |
| --- | --- | --- | --- |
| `z-ai/glm-5.3-flash` | 1,048,576 | 0.08 / 0.50 | Used in the SDK docs examples. Reasoning model with tools and structured outputs. Has many aliases, including `zai-org/GLM-5.1-FP8`. |
| `Qwen/Qwen3.6-35B-A3B-FP8` | 262,144 | 0.17 / 1.10 | tools, json_mode, structured_outputs; max output 8,192 |
| `Qwen/Qwen3.8-27B` | 262,144 | 0.04 / 1.35 | tools |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | 1,048,576 | 0.30 / 1.20 | tools |

Not eligible for our design: `chutes` and `tinfoil` models (3P), and every `external` (Incognito) model.

### 5.3 SDKs

| Package | Version (registry, Nov 4, 2026) | Runtime | Key API |
| --- | --- | --- | --- |
| `@nearai/inference-sdk` (npm) | **0.2.1** (published Oct 29, 2026; `next` = 0.2.1-rc.1) | Node **≥ 24.22.1** | `new InferenceClient({...})` from `@nearai/inference-sdk/node`; `client.verify(model)`; `client.chat.completions.create()`; `client.verifyResponse(id)` → `{ id, signatureKind }`; `client.clearResponseCache()` |
| `nearai-inference-sdk` (PyPI) | **0.2.1** | Python **≥ 3.12**, async | `async with InferenceClient(api_key, e2ee=True) as client`; `await client.verify(model)`; `await client.verify_response(completion.id)` → `.signature_kind` |
| `nearai-inference-sdk` (crates.io) / `github.com/nearai/inference-sdk/go` | 0.2.1 / - | Rust stable / Go ≥ 1.26.10 | Not used |
| `dcap-qvl` (PyPI, crates.io) / `@phala/dcap-qvl` (npm, pure JS) | 0.7.1 | - | `get_collateral_and_verify(quote)` / `getCollateralAndVerify(quote)`. Collateral comes from Phala PCCS (`https://pccs.phala.network`) by default, or from Intel PCS via `INTEL_PCS_URL`. The JS SDK pins `@phala/dcap-qvl` 0.7.0. |

**SDK behavior that changes our design:**
- **`signingAlgo` defaults to `'ed25519'`.** `'ecdsa'` selects the legacy secp256k1/AES-GCM E2EE. OHTTP requires Ed25519. *Decision: use Ed25519 everywhere*, which also allows on-chain `env::ed25519_verify` (§5.4).
- **`attestationCacheTimeToLiveMs` defaults to 3,600,000 (60 min).** By default the SDK reuses a verified session for an hour and does **not** fetch a fresh nonce per request. *Decision: set it to `0`* so every analysis request is preflighted with a fresh nonce.
- **The 60-minute "record expiry" is client-side.** `responseCacheTimeToLiveMs` defaults to 3,600,000 and starts at body completion. It's the SDK's in-memory copy of the exact request and response bytes needed by `verifyResponse()`. Expired or unknown IDs fail with `api.completion_not_found`. It's not a documented server-side retention period. How long `/v1/signature/{id}` keeps answering is not documented **[UNVERIFIED]**. *Decision: verify immediately, inside the same request handler.*
- `verifyResponse()` returns only `id` and `signatureKind`. For the receipt we also need `signedText`, `signature` and `signer`. We get these from the SDK's `fetchCompletionSignature()` (`CompletionSignature { kind, signedText, signature, signer }`) or from `GET /v1/signature/{id}` directly.
- Messages and Responses get **gateway** signatures only, and the Node entry point binds later requests to the verified gateway TLS identity (the browser entry point can't).
- By default the SDK **doesn't** check model measurements against an approved-deployment allowlist. A `deploymentPolicy` callback can add one **[TBD whether we pin measurements]**.

### 5.4 NEAR smart-contract side

| Fact | Value |
| --- | --- |
| Contract language | **Rust with `near-sdk` 5.30.0** (crates.io, Oct 27, 2026). The NEAR docs call near-sdk-rs "NEAR's only official smart-contract SDK". **`near-sdk-js` is archived and its README says "DEPRECATED · DO NOT USE"** (npm 2.0.0, last published Jun 2024). **`near-sdk-as` (AssemblyScript) is archived** (last push Aug 2023). |
| Tooling | `cargo-near` 0.22.0, `near-cli-rs` 0.30.1, and `near-workspaces` 0.24.0 for sandbox tests. Rust target `wasm32-unknown-unknown`. |
| Scaffold / build / deploy (testnet) | `cargo near new <name>` → `cargo near build non-reproducible-wasm` → `near create-account <acct>.testnet --useFaucet` → `near deploy <acct>.testnet ./target/near/<name>.wasm` → `near call <acct>.testnet <method> '<json>' --useAccount <acct>.testnet` · `near view <acct>.testnet <method> '{}'` |
| Faucet | The built-in faucet on docs.near.org (native testnet NEAR), `near-faucet.io` for many tokens, or `--useFaucet` in the CLI. |
| Storage staking | **1e19 yoctoNEAR per byte (1 NEAR per 100 kB)**. Live `EXPERIMENTAL_protocol_config` returns `storage_amount_per_byte = 10000000000000000000` on both testnet and mainnet. The protocol adds **40 bytes per key-value record**. An account gets 770 bytes free (paid by the fixed 0.007 NEAR account-creation charge). Deployment costs about 1 NEAR per 100 KB of Wasm. |
| Gas | Live `gas_price` is **100,000,000 yoctoNEAR/gas** on testnet and mainnet, which is the floor of **0.0001 NEAR per TGas**. Gas is bought at `max(gas_price, 0.001 NEAR/TGas)` and the difference is refunded. The limit is 1 PGas (1,000 TGas) per transaction. A function call costs at most 0.1 NEAR at the floor price. |
| Environment | `env::predecessor_account_id()` (use this for authorization), `env::signer_account_id()`, `env::block_timestamp()` (ns), `env::block_timestamp_ms()`, `env::sha256()`/`sha256_array()`, `env::keccak256()`, `env::log_str()` |
| Signature verification on-chain | `env::ed25519_verify(&[u8;64], message, &[u8;32]) -> bool` is **stable**. Live runtime cost: `ed25519_verify_base` = 210,000,000,000 gas (0.21 TGas) + `ed25519_verify_byte` = 9,000,000 gas. `env::ecrecover(hash, sig, v, malleability_flag)` exists, but in near-sdk 5.30.0 **only behind the `unstable` feature** (`ecrecover_base` = 278,821,988,457 gas). `env::p256_verify` also exists. |
| Collections | `near_sdk::store::{LookupMap, IterableMap, Vector, LookupSet, IterableSet}`. Lookup* types are O(1) with no iteration. Iterable* types support iteration, which costs O(n). |
| Events | NEP-297: `EVENT_JSON:{"standard":…,"version":…,"event":…,"data":…}`, via `#[near(event_json(standard = "..."))]` + `#[event_version("1.0.0")]` + `.emit()` |
| Failure semantics | If an action in a receipt fails, all actions in that receipt are rolled back. **A denied access attempt must therefore return normally (not panic) so that its "denied + flagged" record persists.** |
| Function-call keys | Limited to one `receiver_id`, optional `method_names`, and an optional gas `allowance`. They can't attach NEAR, and a transaction signed with one must contain exactly one function-call action. If the allowance runs out the key stops working, and an account that holds only function-call keys can lock itself out. Rejection errors: §6. |
| Wallet / front end | NEAR docs' web3 quickstart uses `@hot-labs/near-connect` (0.12.0) + `near-api-js` (7.4.0), or `npx create-near-app@latest`. NEP-413 `signMessage` is supported by the wallets listed in the docs for backend authentication. |

**Is on-chain ECDSA verification feasible? Our decision:** We'll verify the **Ed25519** `provider_tee` signature on-chain with `env::ed25519_verify`, against a signer public key the contract owner has registered after off-chain attestation. That costs about 0.21 TGas plus about 9 Ggas per 1,000 bytes of signed text, which is small next to the 1 PGas transaction limit. ECDSA (EIP-191 recovery) is possible with `keccak256` + `ecrecover`, but needs near-sdk's `unstable` feature, so we won't use it. **TDX quote verification stays off-chain.** We have not checked whether a full DCAP verification could run in a NEAR contract **[UNVERIFIED]**, and it's out of scope. **Quote: hash on-chain, full report off-chain (R3).** Each receipt stores `sha256` of the raw gateway report and of the raw model report (32 bytes each), not the quotes. Three reasons. First, each live quote was 5,006 bytes, so two quotes would add about 10 KB, or about 0.1 NEAR of storage per receipt, which is more than ten times the rest of the receipt. Second, the contract can't verify a TDX quote anyway, so storing one buys no on-chain check. Third, the raw reports are kept in the case record (and exported for the demo; they contain no evidence), so anyone can re-run `dcap-qvl` and match them to the stored hash. Re-verifying a quote later uses current Intel collateral, so its TCB status may differ from the `tcb_status` recorded at write time.

### 5.5 Proposed receipt contract (Rust, `near-sdk` 5.30.0)

```rust
// State (sketch). Prefixes are 1 byte to save storage. Hashes are raw 32-byte arrays.
pub struct CustodyContract {
    owner: AccountId,                       // investigator; full-access key kept by the human
    writer: AccountId,                      // backend account; backend holds only a fn-call key (R2)
    approved_signers: IterableSet<[u8; 32]>,         // Ed25519 model keys, approved after attestation
    allowlist: LookupMap<String, IterableSet<AccountId>>, // case_id -> grantees
    receipts: Vector<Receipt>,              // append-only; full record stored at creation (R3)
    seen_responses: LookupSet<[u8; 32]>,    // response hashes already recorded -> no replays
    case_index: LookupMap<String, Vector<u64>>,      // case_id -> receipt ids
}
pub struct Receipt {
    id: u64, case_id: String,
    kind: ReceiptKind,      // Finding | Open | OpenDenied | Approval | Rejection | CustodyCheck
    actor: AccountId,                       // predecessor_account_id()
    evidence_commitments: Vec<[u8; 32]>,    // sha256(salt || file) per file (salted; §6)
    finding: Option<SignedFinding>,         // present when kind = Finding
    policy_verdict: Option<Verdict>,        // ACCEPT | FLAG | BLOCK | HOLD
    reason: Option<String>,
    prev_hash: [u8; 32],                    // hash chain over receipts
    timestamp_ns: u64,                      // env::block_timestamp()
}
pub struct SignedFinding {                  // R3: everything a later check needs
    model_id: String,                       // canonical ID, e.g. "z-ai/glm-5.3-flash"
    request_hash: [u8; 32],                 // sha256(exact request body bytes)
    response_hash: [u8; 32],                // sha256(exact response body bytes)
    signature: [u8; 64],                    // provider_tee signature, Ed25519
    signer_pubkey: [u8; 32],                // = signing_address for ed25519
    gateway_report_hash: [u8; 32],          // sha256(raw gateway report JSON)
    model_report_hash: [u8; 32],            // sha256(raw model report JSON); quotes stay off-chain
    nonce: [u8; 32], tcb_status: TcbStatus,
    finding_hash: [u8; 32],                 // sha256(salt || finding JSON); no plaintext on-chain
    citation_hashes: Vec<[u8; 32]>,         // R1: sha256(salt || citation record), one per citation
}
// Methods
// owner:  add_signer / remove_signer, grant(case_id, account) / revoke(...)
// writer: record_finding(case_id, evidence_commitments, finding, verdict)
//           require predecessor == writer
//           require finding.signer_pubkey in approved_signers
//           require citation_hashes non-empty unless verdict == BLOCK
//           require response_hash not in seen_responses
//           text = "<model_id>:<hex(request_hash)>:<hex(response_hash)>"   (rebuilt on-chain)
//           require env::ed25519_verify(&signature, text.as_bytes(), &signer_pubkey)
//           (any failed require panics, so nothing is stored)
//           store the full receipt; emit finding_recorded
// writer: record_custody_check(case_id, evidence_commitment, expected_receipt_id, matched)
//           -> CustodyCheck receipt (backend-asserted, no model signature)
// anyone: request_open(case_id, evidence_id, reason)
//           allowlisted -> Open receipt + open_granted event
//           otherwise   -> OpenDenied receipt + open_denied event
//           (returns false, does NOT panic, so the record persists)
// owner:  approve_action(case_id, receipt_id, decision, reason) -> Approval/Rejection receipt
// views:  get_receipt(id), get_case_receipts(case_id, from, limit), is_grantee(case_id, account)
```

The contract rebuilds the signed text from the stored fields, so the stored fields and the verified signature can't disagree. NEAR's docs specify that an Ed25519 response signature is checked over the UTF-8 bytes of that text with `signing_address` as the public key, which is exactly what `env::ed25519_verify` does. **What the on-chain check covers:** an approved model key signed these request and response hashes. The contract can't see the response bytes, so `finding_hash` and `citation_hashes` are checked off-chain by recomputing them from the retained response bytes (the "Verify from chain" button, §9).

**Storage estimate per Finding receipt (calculated from the sketch, not yet measured):** With 2 evidence commitments and 3 citations, the Borsh-encoded receipt is about 580 bytes (hashes, signature and public key ≈ 450 bytes; IDs and strings ≈ 90; the rest is lengths, tags and the timestamp). Add about 5 bytes of key and the protocol's 40-byte record overhead. The `seen_responses` entry adds about 33 + 40 bytes, and the case-index entry about 75 bytes. **Total ≈ 770 bytes ≈ 0.0077 NEAR staked per Finding receipt** at 1e19 yoctoNEAR/byte. Each extra citation adds 32 bytes (0.00032 NEAR). Storing both full quotes instead would add about 10 KB (≈ 0.1 NEAR) per receipt. **Who pays:** a function-call key can't attach a deposit, so the contract account pays this storage from its own balance, and NEAR fails the transaction if that balance can't cover the new storage. The contract must be funded from measured costs, and the UI shows its balance. **Gas:** one `ed25519_verify` over a ~150-byte signed text costs about 0.21 TGas + 150 × 9 Mgas ≈ 0.211 TGas. The final bytes and gas per receipt are measured on Day 3 **[TBD]**. Adding a grantee costs about 100 bytes, or about 0.001 NEAR. Unbounded writes by strangers (`request_open` from non-grantees) are a **storage-cost attack** vector (docs.near.org/smart-contracts/security/storage). *Mitigation:* require a small attached deposit on `request_open` (marked `#[payable]`), or cap denied-attempt records per account per case **[TBD]**. We'll measure real gas and storage on Day 3 **[TBD]**.

*Sources:* docs.near.org/tools/sdk · github.com/near/near-sdk-js (archived; README) · github.com/near/near-sdk-as (archived) · crates.io near-sdk / cargo-near / near-cli-rs / near-workspaces · near-sdk 5.30.0 source `src/environment/env.rs` · docs.near.org/smart-contracts/quickstart · docs.near.org/smart-contracts/release/deploy · docs.near.org/getting-started/faucet · docs.near.org/protocol/storage/storage-staking · docs.near.org/protocol/transactions/gas · docs.near.org/smart-contracts/anatomy/environment · docs.near.org/smart-contracts/anatomy/collections · docs.near.org/smart-contracts/anatomy/events · docs.near.org/protocol/transactions/transaction-execution · docs.near.org/protocol/accounts-contracts/access-keys · docs.near.org/web3-apps/quickstart · docs.near.org/web3-apps/backend/backend · docs.near.org/smart-contracts/security/storage · live RPC `gas_price` / `EXPERIMENTAL_protocol_config` on rpc.testnet.near.org and rpc.mainnet.near.org · npm `@hot-labs/near-connect`, `near-api-js`

### 5.6 Intel TDX quote, in practice

| Part | Size / fields |
| --- | --- |
| Header (48 bytes) | `version` (u16, observed **4**) · `attestation_key_type` (u16, observed 2 = ECDSA-256) · `tee_type` (u32, **0x81 = TDX**) · `qe_svn` · `pce_svn` · `qe_vendor_id[16]` · `user_data[20]` |
| TD report body (TDReport10, 584 bytes) | `tee_tcb_svn[16]` · `mr_seam[48]` · `mr_signer_seam[48]` · `seam_attributes[8]` · `td_attributes[8]` · `xfam[8]` · **`mr_td[48]`** · **`mr_config_id[48]`** · `mr_owner[48]` · `mr_owner_config[48]` · **`rt_mr0..rt_mr3[48 each]`** · **`report_data[64]`** |
| Signature data | ECDSA quote signature plus the QE certification data chain, checked against Intel's root by the verifier |
| TCB statuses (dcap-qvl) | `UpToDate`, `SWHardeningNeeded`, `ConfigurationNeeded`, `ConfigurationAndSWHardeningNeeded`, `OutOfDate`, `OutOfDateConfigurationNeeded`, `Revoked`, `TDRelaunchAdvised`, `TDRelaunchAdvisedConfigurationNeeded`. The result also carries Intel `advisory_ids`. |
| Collateral | Certificates, CRLs and TCB info from a PCCS (Phala's by default) or Intel PCS, checked against the current time. Fully offline verification is possible with collateral you already hold. |
| What dstack adds | `info.tcb_info` exposes `mrtd`, `rtmr0-3`, `os_image_hash`, `compose_hash`, `app_compose` and `event_log`. RTMR3 is extended with app events such as `app-id` and `compose-hash`, which the replay authenticates. |

**Our TCB policy:** accept `UpToDate` only, and record `advisory_ids` in the receipt. If NEAR's fleet reports anything else during the demo window, show it as **Unverified (policy)** rather than silently accepting it **[TBD: fallback to also allow `SWHardeningNeeded`?]**.

*Sources:* github.com/Phala-Network/dcap-qvl (README, `src/quote.rs`, `src/tcb_info.rs`) · pypi.org/project/dcap-qvl · npmjs.com/package/@phala/dcap-qvl · docs.near.ai/cloud/verification/reference/quote-nonce-signer · live quote parse (Nov 4, 2026)

## 6. Access control design (our app + contract, not a NEAR AI Cloud feature)

NEAR AI Cloud provides private inference only. It doesn't store documents or manage permissions. Everything below is **ours to build**.

**Two encryption layers, kept separate:**

| | Layer A: storage at rest | Layer B: per-request transport to the enclave |
| --- | --- | --- |
| Key | Per-case data key (AES-256-GCM) held by the investigator's app and wrapped by an app master key **[TBD: KMS vs local keyfile]** | A fresh client key pair per request, encrypted to the enclave's **attested** model public key |
| Protects | Evidence files and finding JSON in our storage | Prompt and response content between our backend and the model TEE. The gateway relays only ciphertext for the covered fields. |
| Never | Sent to NEAR AI Cloud or written on-chain | Reused for storage, or persisted |

**Grant → open → record:**
1. **Grant.** The investigator, from their own NEAR account (the contract `owner`), calls `grant(case_id, grantee.testnet)`. This emits `grant_added`.
2. **Open request.** The grantee signs a `request_open(case_id, evidence_id, reason)` transaction **with their own NEAR account** through the wallet. The contract checks `env::predecessor_account_id()` against the case allowlist.
3. **Allowed.** The contract writes an `Open` receipt (who = predecessor, when = block timestamp, why = reason) and emits `open_granted`. The backend confirms the transaction's final status on-chain (signer = grantee, method, args, success) and that the browser session belongs to the same account (NEP-413 `signMessage` challenge). Only then does it decrypt and stream the file to that session.
4. **Not allowed.** The contract writes an `OpenDenied` receipt, emits `open_denied`, and **returns `false` without panicking**, so the record persists. The UI flags it to the investigator. The backend releases nothing.
5. **Revoke.** `revoke(case_id, account)`. Later opens are denied. Files already opened can't be "un-seen", and the README must say so.

**Honest limits:** The backend that holds the storage key is a trusted component. The contract proves **who asked and whether they were allowed**. It can't stop a compromised backend from releasing a key. Roadmap: run the key-release service in a TEE and attest it, or use threshold key release. Evidence hashes on a public chain could confirm possession of a *known* file, so on-chain we store a **salted commitment** `sha256(salt ‖ file)`, with the salt kept in the encrypted case record. No plaintext findings go on-chain, only `finding_hash`.

**R2: the receipt-writer key is scoped to one contract (Security-track requirement).**

**Which key.** A NEAR **function-call access key** on the backend's NEAR account (`writer`), added with `receiver_id` = the receipt contract and `method_names` = `["record_finding", "record_custody_check"]`. The backend never holds a full-access key. The human keeps the full-access key for `writer` offline, so the account can't lock itself out. This is **not** the NEAR AI Cloud API key: that one is a bearer token for inference, held in the backend's environment, and it isn't a NEAR access key.

**Allowance.** We set a finite gas `allowance` **[TBD amount, from Day 3 measurements]**, so a stolen key can only spend a bounded amount of gas. When it runs out, every transaction fails with `NotEnoughAllowance`. An existing key's allowance can't be changed, so the human adds a new key with the full-access key.

**What the NEAR protocol rejects.** These checks are in nearcore's `verify_function_call_permission` (`runtime/runtime/src/verifier.rs`, commit 863a2e2e64). The errors are variants of `InvalidAccessKeyError` (`core/primitives/src/errors.rs`):

| Attempt with the writer key | Rejected as |
| --- | --- |
| Transfer NEAR, add or delete a key, deploy code, or any transaction that isn't exactly one function-call action | `RequiresFullAccess` |
| Call any contract other than the receipt contract | `ReceiverMismatch` |
| Call a receipt-contract method not in `method_names` (for example `grant`) | `MethodNameMismatch` |
| Attach a NEAR deposit to a call | `DepositWithFunctionCall` |

These checks run when the transaction is validated (`InvalidTxError`), so a rejected transaction isn't executed and leaves nothing on-chain. The attack demo shows the error returned to the client, not an explorer link. The exact CLI output is captured on Day 3 **[TBD]**.

**What a stolen key can still do.** Call `record_finding` and `record_custody_check` until the allowance runs out. A forged finding still needs a valid Ed25519 signature from an approved model key over a response hash the contract hasn't seen, so an attacker can't invent findings or replay old ones. `record_custody_check` carries no model signature, so CustodyCheck receipts are labeled as backend-asserted. The number of writes, and so the storage they can lock, is bounded by the allowance. The README must state all of these limits.

*Sources:* docs.near.org/smart-contracts/anatomy/environment · docs.near.org/protocol/transactions/transaction-execution · docs.near.org/protocol/accounts-contracts/access-keys · docs.near.org/web3-apps/backend/backend · docs.near.ai/cloud/guides/e2ee-chat-completions · github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md · github.com/near/nearcore (commit 863a2e2e64) `runtime/runtime/src/verifier.rs`, `core/primitives/src/errors.rs`

### 6.1 How the keys work (quick reference for the team and AI agents)

A NEAR account can hold two kinds of access key:

| Key type | What it can sign | Who holds it in our design |
| --- | --- | --- |
| **Full-access key** | Any action for the account: transfer NEAR, add or delete keys, deploy code, call any contract. | The investigator's own wallet key (wallets normally hold a full-access key). The `writer` account's full-access key, kept offline or in a hardware wallet by a human, never on the backend. |
| **Function-call key** | Only function calls to one contract (`receiver_id`), optionally only the listed `method_names` (if the list is omitted, every method on that contract). It can't sign a Transfer or attach a deposit. An optional `allowance` is a **gas allowance (fee budget)** in NEAR for gas, not a spending limit on funds. | The app's `writer` key on the backend: receipt contract only, `record_finding` and `record_custody_check` only, finite gas allowance (R2). |

**Facts to keep straight:**
- **The one-contract key is the app's writer key, not the investigator's wallet key.** A stolen investigator wallet key is a full-access key and **can** transfer money. Nothing in our design prevents that; protecting it is up to the investigator's wallet.
- **A stolen writer key can't move funds.** If it tries a transfer, the NEAR protocol rejects the transaction when it's validated, before execution, with `RequiresFullAccess`. No funds move and nothing reaches the chain. Calling another contract fails with `ReceiverMismatch`, another method with `MethodNameMismatch`, and attaching a deposit with `DepositWithFunctionCall`. Once the gas allowance is used up, every transaction fails with `NotEnoughAllowance`.
- **The allowance limits gas fees only.** A function-call key could still move funds indirectly if a method it's allowed to call moves funds. Our two writer methods don't transfer tokens, and no method that pays out may ever be added to the writer key's list.
- **Limited blast radius.** Because the full-access key stays offline, a stolen writer key can only call the two writer methods until its allowance runs out (see "What a stolen key can still do" above). Recovery: delete the key and add a new one, using the offline full-access key.

*Sources:* docs.near.org/protocol/accounts-contracts/access-keys · github.com/near/nearcore (commit 863a2e2e64) `runtime/runtime/src/verifier.rs`

## 7. Deterministic policy engine (Layer 2) and human-in-the-loop (Layer 4)

The policy engine runs after signature verification and before a receipt is written. Same inputs give the same verdict. No model calls.

| Rule | Check | Verdict on failure |
| --- | --- | --- |
| P1 Schema | The output parses as our JSON schema: `findings[]`, each with `claim`, `citations[]` (`evidence_id`, `line_start`, `line_end`, `quote`), `iocs[]`, `recommended_actions[]`, `confidence` | BLOCK |
| P2 Citations (R1) | Every finding has at least one citation. `evidence_id` is a file sent in this request. The line range exists in that file. `quote` is non-empty, at most **[TBD]** bytes, and occurs **byte-for-byte** in the original file bytes within those lines, with no whitespace or case normalization. Every IP, hash, filename or path in the finding's `iocs` appears verbatim inside one of its cited spans. | Missing, out-of-range or non-matching citation: **BLOCK** (shown as "rejected: citation check failed", never as a result). IOC outside its cited spans: FLAG. |
| P3 Provenance | `signature_kind == provider_tee`, the signer is in the verified set, and TCB is within policy | BLOCK (no receipt) |
| P4 Irreversible action | Any action in {isolate_host, block_ip, delete, notify_external, share_outside_case} | **HOLD** until the investigator calls `approve_action` |
| P5 Injection markers | Evidence text containing instruction-like strings (e.g. "ignore previous instructions") is flagged. Evidence is always passed as quoted data, never as instructions. | FLAG |
| P6 Confidence floor | `confidence < threshold` **[TBD value]** | FLAG |

**How citations work (R1).** The backend sends each evidence file to the model with our own line numbers (`E1:0001| …`), and the prompt requires the citation format above. The checker maps line numbers back to exact byte ranges in the original file and records the matched byte offsets. Each passing citation becomes a record `{evidence_commitment, line_start, line_end, byte_start, byte_end, sha256(quote)}`. Its salted hash `sha256(case_salt ‖ record)` goes into the receipt; the salt stops anyone from guessing a short quote by brute force. A BLOCKed finding is still recorded, with verdict BLOCK, so the record shows that the model said it and the engine rejected it.

**Structured outputs.** The live metadata for `z-ai/glm-5.3-flash` lists `structured_outputs` and `json_mode` in `supportedFeatures` (`/v1/model/{id}`, Nov 4, 2026). We haven't yet run a JSON-schema `response_format` together with E2EE on this model **[UNVERIFIED]**, so Day 1 tests it. P1 validates the schema either way, so correctness never depends on it. Request fields other than the encrypted content fields aren't encrypted, so the schema must never contain evidence.

**What citations do and don't prove.** They prove that a finding points at real evidence. They don't prove that the interpretation is right, which is why FLAG, HOLD and human review stay.

**Human-in-the-loop:** HOLD items appear in an approval queue. Approve or reject is a NEAR transaction signed by the investigator's own account (`approve_action`), which creates an `Approval` or `Rejection` receipt. The app never carries out the action. It only records the decision.

**Roadmap only, NEAR Intents Agent API (not in hackathon scope).** If a later version needs the assistant to *spend* (for example, paying for an external forensic lookup), the Agent API provides the matching controls (docs.agentsonintents.com):
- **One owner-signed policy per agent** with these fields: `frozen`, `actions` (`swap`/`transfer`/`withdraw`), `assets`, per-asset `limits` (`per_transaction`/`hourly`/`daily`/`monthly`), `max_actions_per_hour`, `destinations` (`only`/`except`/`any`, up to 256 entries), USD `budget` (`daily_usd`/`weekly_usd`/`monthly_usd`), `timelock_ms` (0 to 30 days, with cancellation by `execution_cancel`), `schedule` (weekly windows in an IANA time zone), and `owner_approval`.
- **Emergency stop:** `agent_freeze` has no cooldown. `agent_unfreeze` has a 10-minute cooldown, and ordinary policy changes are limited to one per 10 minutes.
- **Owner approval:** with `owner_approval: true`, every money action waits for an owner vote over `${verdict}:${approval_id}:${wallet_pubkey}:${request_hash}` (NEAR owners sign it with NEP-413). The API re-checks the grant, the policy and the destination before releasing the action.
- **Proofs:** the API runs in an Intel TDX CVM on Phala dstack. Each execution has an offline-checkable transparency proof (`GET /v1/agents/{agent_id}/operations/{correlation_id}/proof`, `verifyOperationProof`), and audit events are kept for 90 days.
- **Mapping:** our HOLD → `owner_approval`, our "stop everything" → `agent_freeze`, our per-case spend cap → `budget` + `limits`, our allowed vendors → `destinations: only`.
- **Why it's deferred:** HACKATHON.md Q-007 says NEAR Intents has **no testnet**, so it would mean mainnet funds. The forensic flow also doesn't move money.

*Sources:* live `GET https://cloud-api.near.ai/v1/model/z-ai%2Fglm-5.3-flash` (`supportedFeatures`) · docs.near.ai/cloud/models · docs.near.ai/cloud/guides/e2ee-chat-completions · docs.agentsonintents.com/integration/agent-api/overview · …/policies-and-limits · …/owner-signing · …/tee · …/transparency · nearhackathon.com/HACKATHON.md (Q-007)

## 8. Simulated incident scenario: MOVEit-style breach

> **FICTIONAL SCENARIO: FOR DEMONSTRATION ONLY.** The organization, people, hosts, files, IP addresses, timestamps and findings below are invented. The tool has not been used on any real case.

**Public background (real, 2023):**
- In May-June 2023, the **Cl0p** ransomware group (also tracked as TA505) exploited **CVE-2023-34362**, a **SQL injection** zero-day in **Progress Software's MOVEit Transfer** managed file-transfer product.
- Compromised servers received a web shell (LEMURLOOT) that was first seen with the name **`human2.aspx`**, chosen to look like the legitimate `human.aspx`.
- CISA added the CVE to its Known Exploited Vulnerabilities catalog on June 2, 2023, and CISA/FBI published advisory AA23-158A on June 7, 2023.

**Fictional setup (FICTIONAL SCENARIO):**
- Organization: *City of Larkmoor Records Office* (fictional). Investigator: *Det. A. Example* (fictional). Grantee: *legal-review.testnet* (fictional). Host: `xfer-01.larkmoor.example`.
- Evidence: a synthetic IIS log excerpt and a synthetic directory listing, shipped in `samples/`. IPs come from the RFC 5737 documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

```text
# FICTIONAL SCENARIO: synthetic web-server log excerpt
2023-06-01 02:14:07 GET  /              200 203.0.113.10  Mozilla/5.0
2023-06-01 02:41:55 POST /human2.aspx   200 198.51.100.23 -
2023-06-01 02:42:31 GET  /human2.aspx   200 198.51.100.23 -
# FICTIONAL SCENARIO: synthetic directory listing
C:\MOVEitTransfer\wwwroot\human2.aspx  created 2023-06-01 02:39  (not in vendor baseline)
```

**Expected receipts (illustrative values):**

| Receipt | Kind | Policy | Content |
| --- | --- | --- | --- |
| R-001 | Finding | ACCEPT | `human2.aspx` present in wwwroot, not in baseline. Cites listing line 2, quote `wwwroot\human2.aspx  created 2023-06-01 02:39`, byte-for-byte match |
| R-002 | Finding | FLAG | POST/GET to `human2.aspx` from 198.51.100.23, referred for review. Cites log lines 3-4 |
| R-003 | Recommendation | HOLD | "Isolate xfer-01" is irreversible, so it waits for `approve_action` |
| R-004 | Open | - | `legal-review.testnet` opens the log excerpt, reason "privilege review" |
| R-005 | OpenDenied | - | `random-user.testnet` tries to open it, so the attempt is denied and flagged |
| R-006 | CustodyCheck | BLOCK | An edited copy of the log was re-submitted, and its commitment doesn't match R-002 |

Two demo beats produce **no receipt**, by design. Attempts to misuse the writer key (§6) are rejected by the protocol before execution. A **test fixture** with a fabricated quote (labeled as a fixture, not a live model output) shows the P2 citation check returning BLOCK.

*Sources:* cisa.gov/news-events/cybersecurity-advisories/aa23-158a

## 9. Two-minute demo script (judge walkthrough)

| Time | Action | What the judge sees |
| --- | --- | --- |
| 0:00-0:12 | State the problem in one line, then upload `samples/larkmoor-log.txt` (FICTIONAL) | File hashed in the browser. The commitment is shown and the stored file is labeled "encrypted at rest". |
| 0:12-0:35 | Click **Analyze** | A live **Verified panel** shows only checks this request ran: gateway TCB, model TCB, report nonce, `provider_tee`, citations, optional independent DCAP, then on-chain recording after `receipt_count` increases. RTMR3, MRCONFIGID, NRAS, and encryption stay unverified. |
| 0:35-0:52 | The finding appears **with citations (R1)** | Each finding shows its citations. Clicking one highlights the exact span in the evidence, with "citation check ✓ byte-for-byte". Then a labeled test fixture with a fabricated quote runs: **BLOCK, citation check failed**. |
| 0:52-1:10 | The receipt **stored on-chain at creation (R3)** | NEAR testnet transaction link; the stored receipt fields (hashes, signature, signer, report hashes, nonce, citation hashes, timestamp); "`ed25519_verify` passed at write time". **Verify from chain** recomputes the hashes from the retained bytes with no NEAR AI Cloud call. **Verify independently** opens `cloud.near.ai/verify?model=…#receipt=…` and shows **Reply verified**. |
| 1:10-1:22 | Access control | A grantee opens the file (Open receipt). A non-allowlisted account tries and gets an **OpenDenied** receipt, flagged in red. |
| 1:22-1:32 | HOLD approval | The investigator signs "Isolate xfer-01 → reject" (Rejection receipt). |
| 1:32-1:44 | **Tamper detection** | Re-upload an edited log copy, so the commitment ≠ the on-chain receipt: **CUSTODY BREAK**. Change one byte of a stored response, so its hash no longer matches the stored receipt and signature verification **fails**. |
| 1:44-2:00 | **Climax: a stolen key tries to move money (R2)** | An attacker has the app's writer key (a function-call key scoped to the receipt contract, §6.1) and tries a NEAR transfer → `RequiresFullAccess`; then a call to another contract → `ReceiverMismatch`. The NEAR protocol rejects both before execution, so **no funds move**. The app shows the error; there's no explorer link because nothing executes. Close on "NEAR enables: attested private inference + tamper-evident custody on-chain". |

**Fallback:** If NEAR AI Cloud evidence is unavailable during recording, the panel shows **Unable to verify** and no receipt is written. Record that path too, since it demonstrates fail-closed behavior.

*Sources:* docs.near.ai/cloud/verification/verification-center · tracks/03-privacy.md (the "Verified" panel requirement) · tracks/06-security.md (the attack demo requirement) · github.com/near/nearcore `runtime/runtime/src/verifier.rs` (rejection errors)

## 10. Ten-day build plan (Thu Nov 5 → Sat Nov 14, 2026)

Build order follows the risk: prove one verified call first, then the receipt contract, then the UI.

| Day | Date | Deliverable | Done when |
| --- | --- | --- | --- |
| 1 | Thu Nov 5 | Repo, LICENSE (MIT, **[TBD]** team confirms), README skeleton for AI judges, `.env.example`, `.gitignore`, Node 24.22.x. Get credits and an API key. `scripts/verify-one.mjs`: `InferenceClient({ signingAlgo:'ed25519', e2ee:true, attestationCacheTimeToLiveMs:0 })`, one non-streaming completion, `verifyResponse`, fetch the signature, keep the exact request/response bytes, write `out/receipt.json` with every R3 field. `scripts/verify_report.py`: an independent dcap-qvl check of the same report. Test a JSON-schema `response_format` with E2EE on the chosen model and record the result (R1). | The script prints `provider_tee` and all checks pass. Its output is pasted into the README. The structured-outputs result is written down. |
| 2 | Fri Nov 6 | Rust contract (`cargo near new`): the full `SignedFinding` receipt stored at creation (R3), signed text rebuilt on-chain + `ed25519_verify` in `record_finding`, replay set, citation-hash rule, approved signers, allowlist, NEP-297 events, non-panicking `request_open`. Unit tests. Testnet accounts via `--useFaucet`. Deploy. | `near view` returns a receipt written from Day 1's real signature with every R3 field. Tests reject a flipped signature byte and a replayed response hash. |
| 3 | Sat Nov 7 | Backend → contract integration with a NEAR **function-call key** (receiver = receipt contract, methods = writer methods, finite allowance) (R2). `scripts/attack-key`: transfer, other-contract call, disallowed method, attached deposit; capture each error. `near-workspaces` sandbox tests: grant, open, deny, approve, bad signature. Measure gas and storage per receipt. | Tests are green. All four attack attempts are rejected with the expected errors. The README cost table is filled in with measured numbers. |
| 4 | Sun Nov 8 | Front end: wallet connect (near-connect), upload, browser hashing, Layer A encryption, Verified panel, receipt viewer, citation highlighting (R1), "Verify from chain" (R3), Verification Center deep link | The full happy path works in the UI |
| 5 | Mon Nov 9 | Policy engine P1-P6 with unit tests, including the P2 citation checker (R1) with fixtures: exact match, whitespace-changed quote, wrong line range, missing citation, IOC outside its span. HOLD queue and `approve_action` signing. | Each rule has a passing and a failing fixture |
| 6 | Tue Nov 10 | Access control end to end: grant/revoke UI, `request_open` from the grantee's wallet, NEP-413 session check, gated key release, denied attempts flagged | The demo accounts behave as in §8 R-004/R-005 |
| 7 | Wed Nov 11 | FICTIONAL MOVEit samples. Tamper demos (file edit, response byte flip). Attack demo with the writer key (R2), run last as the demo climax. Fabricated-citation fixture (R1). Prompt-injection evidence sample. Fail-closed path (bad nonce, wrong model alias). | All §9 beats run from a clean start |
| 8 | Thu Nov 12 | Reproducibility pass from a **fresh clone on a clean machine or container**. README "do X → see Y" steps. Audit every README claim against the code. Secrets scan of git history. | A second person (or a fresh agent) follows the README with no help |
| 9 | Fri Nov 13 | Record the video (≤ 2 min) and screenshots. Draft the X post. Optional hosted demo, kept up through at least Nov 18. The human makes the repo public. | The video is final and the post is ready to publish |
| 10 | Sat Nov 14 | **Buffer.** Fix only what's broken. The human publishes the X post. Submit via the form or API **after the human confirms the payload**. Target time: ≤ 18:00 UTC (19:00 Lagos). | A 201 response, or a form confirmation |

**Deferred (not in this build):** NEAR Intents Agent API, private or on-prem deployment, multi-user agency roles, TLS-binding UI, image-provenance policy, mainnet deployment, on-chain quote verification, OHTTP.

**What the AI screeners check (Q-017, HACKATHON.md):** Claude Code and Codex do "reproducibility check, feature verification, structured report, preliminary score". **Humans decide**, and "a low AI score alone cannot reject." They read the README "for a machine reader": what the product is, the problem, and "do X, see Y" steps. "No marketing." So every feature claimed in the README must exist in code and be runnable. Mark TBD items before submitting, or delete them.

*Sources:* nearhackathon.com/HACKATHON.md · github.com/nearai/near-hackathon-prompt-examples (README, 00-setup.md, SUBMITTING.md, tracks/03, tracks/06)

## 11. Risks and limitations

| Risk / limitation | Impact | Mitigation |
| --- | --- | --- |
| Not yet run with a paid key: completion + `verifyResponse` **[UNVERIFIED]** | The core claim could fail on Day 1 | Day 1 is reserved for exactly this. Fallback: a different Confidential TEE model from §5.2. |
| Signature retrievability window at `/v1/signature` is undocumented **[UNVERIFIED]** | Late verification may fail | R3: the full signed receipt is stored and checked on-chain at creation, inside the request handler, so later checks never need `/v1/signature` or the SDK's 60-minute copy. |
| Shared signing key across model instances | `provider_tee` doesn't prove *which* instance served the request | State this in the README and the UI. It's NEAR's documented limitation. |
| No complete model→gateway→response chain | Gateway and model evidence aren't cryptographically chained per response | Document it. Use non-streaming requests without aliases so the reply carries `provider_tee`. |
| The SDK's default TCB policy also accepts `OutOfDate` | Weaker than we claim | Override with `acceptedTcbStatuses: ['UpToDate']` |
| Collateral comes from Phala PCCS by default | Trust in a third-party collateral cache | Optionally switch to Intel PCS (`INTEL_PCS_URL`) |
| No allowlist of approved measurements by default | "Verified" ≠ "approved deployment" | Record `compose_hash`/`mr_td` in the receipt. Pinning is **[TBD]**. |
| The backend holds the storage key | A compromised backend can leak evidence | Scope the claim honestly. Roadmap: key release in a TEE. |
| Public-chain metadata | Commitments and account IDs are public | Salted commitments, no plaintext on-chain, testnet only |
| Storage-cost griefing via `request_open` | The contract's balance gets locked | Attached deposit or a rate cap **[TBD]** |
| Model output quality | Wrong triage | R1 citations checked byte-for-byte (P2), plus HOLD for irreversible actions. "Triage, not a court-certified forensic product." |
| A plausible but false finding | A wrong conclusion that no rule contradicts | R1: no finding is shown without citations that match the evidence. Residual: a correct quote with a wrong interpretation still passes, so FLAG, HOLD and human review stay. |
| The model often returns missing or inexact citations | Many findings BLOCKed | Line-numbered input and a strict output format; structured outputs if they work with E2EE **[UNVERIFIED]**; quote length limit **[TBD]** |
| Stolen writer key | Bogus writes until the allowance runs out | R2 scope (no transfers, no key changes, no other contracts or methods, no deposits). Findings still need a valid model signature over an unseen response hash. Finite allowance **[TBD]**. |
| Contract balance runs out | Receipt writes fail | The function-call key can't attach a deposit, so the contract pays storage. Fund it from the measured per-receipt cost and show the balance in the UI. |
| The model's signing key changes | New signatures fail the approved-signer check | The owner approves the new key after attestation. How often NEAR rotates model keys **[UNVERIFIED]**. |
| The on-chain check covers the signature, not the content | `finding_hash` and `citation_hashes` are supplied by the writer | "Verify from chain" recomputes them from the retained response bytes. The README states this. |
| Rate limits and outages on NEAR AI Cloud **[UNVERIFIED]** | Demo failure | Pre-record the video. The fail-closed path is part of the demo. |
| Very large evidence files | Context and cost limits | Chunk to ≤ 100k tokens per request **[TBD]** (glm-5.3-flash's model metadata lists `base_max_context_tokens: 100000`, with long-context routing up to 1,048,576) |

**Honesty note: on-prem.** Private or on-prem deployment for agencies is **our roadmap goal, not a current NEAR offering**. NEAR has not published an on-prem version of NEAR AI Cloud. Intel TDX itself is standard hardware that can run on-prem or in a private cloud, so the plan is technically grounded, but this document doesn't claim it exists. Agencies named as target types (for example a metropolitan police department) are not partners or customers.

*Sources:* docs.near.ai/cloud/verification/cloud-api/response-signatures · docs.near.ai/cloud/verification/cloud-api/model-attestations · github.com/nearai/inference-sdk/blob/main/js/docs/verification-guide.md · live `/v1/model/z-ai%2Fglm-5.3-flash` · docs.near.org/smart-contracts/security/storage

## 12. Submission checklist

- [ ] Working prototype runs from a clean clone, following the README (Node ≥ 24.22.1, Rust + cargo-near, near-cli-rs)
- [ ] **Public** GitHub repo by **2026-11-14T23:59:00Z** (the human makes it public), with a LICENSE file and no secrets anywhere in its history
- [ ] README for AI judges: what it is, the problem, numbered "do X → see Y" steps, the "keep nothing server-side" statement, the function-call key limits, a list of third-party libraries, an "everything built since Oct 19, 2026" note (or a diff link to the baseline per Q-003), and disclosure of any other project per Q-015
- [ ] **R1 Citations:** every displayed finding has at least one citation that passed P2 byte-for-byte; the fixture suite shows a fabricated quote BLOCKed; receipts hold salted citation hashes, not evidence text
- [ ] **R2 Scoped key:** the backend holds only a NEAR function-call key (receiver = receipt contract, writer methods only, finite allowance); the README says it isn't the NEAR AI Cloud API key; the attack demo shows the transfer and other-contract attempts rejected
- [ ] **R3 On-chain receipts:** every finding receipt is stored on-chain at creation with all §5.5 fields and passed `env::ed25519_verify` at write time; "Verify from chain" works with no NEAR AI Cloud call
- [ ] Fictional sample documents in `samples/`, labeled FICTIONAL
- [ ] Demo video (≤ 2 min) plus screenshots. For a local-only demo, the video is required ("screenshots are not enough"). A hosted demo is a plus: keep it up until at least Nov 18, ideally Nov 25.
- [ ] Public X post **written and published by the human**: says it was built at NEAR HACKATHON, tags **@NEARProtocol** and **#NEARHackathon** (optionally @NearLegion and @NearBuilders), has the video or screenshots attached, leads with the user problem, and states NEAR's concrete role
- [ ] Application via **nearhackathon.com/#apply** or `POST https://nearhackathon.com/api/applications`, **only after the human confirms the exact payload**. Fields: requestId (UUID, reused on retry), projectName, leadName, email, size, tracks `["privacy","security"]`, **mainnet** payout `nearAddress` (the team creates it), projectUrl, demoUrl, idea (20-2,000 characters), consent. No extra fields (`website` is a spam trap).
- [ ] One submission per repo. Fix mistakes at nearhackathon.com/request-changes and never resubmit.

*Sources:* nearhackathon.com/HACKATHON.md · github.com/nearai/near-hackathon-prompt-examples/blob/main/SUBMITTING.md

## 13. Corrections to the earlier README and PDF

1. **The SDK default is Ed25519, not ECDSA.** The X25519/HKDF-SHA256/XChaCha20-Poly1305 E2EE belongs to the **Ed25519 (v2)** protocol. With `signing_algo=ecdsa` the E2EE is the legacy secp256k1 + AES-256-GCM scheme. The README paired an ECDSA attestation request with v2 E2EE, which is inconsistent.
2. **"Response records expire after 60 minutes" is an SDK client-side cache** (`responseCacheTimeToLiveMs`, configurable), not a documented NEAR AI Cloud server retention period.
3. **The SDK caches attestation for 60 minutes by default** (`attestationCacheTimeToLiveMs`). A fresh nonce per request requires setting it to `0`.
4. **Gateway signatures are also used for streamed completions and for alias-resolved model IDs**, not only for Responses and Messages. Use non-streaming requests with canonical IDs and `x-no-aliasing`.
5. **Model reports don't return `report_data`.** Read it from the verified quote. The layout is identity(32, zero-padded) ‖ nonce(32).
6. **E2EE scope:** the raw protocol also covers completions, embeddings and images on NEAR TEE models. The **SDK's** field-level E2EE is Chat Completions only.
7. **There are three tiers, not two:** Confidential TEE, 3P Confidential TEE and Incognito. The Python SDK verifies only the gateway for 3P models, while the JS SDK verifies Chutes model attestation.
8. **The JS SDK requires Node ≥ 24.22.1** and is imported as `InferenceClient` from `@nearai/inference-sdk/node`. Both SDKs are at version 0.2.1. Rust and Go SDKs also exist.
9. **The SDK's default TCB policy accepts `UpToDate` and `OutOfDate`.** We tighten it to `UpToDate`.
10. **Model choice:** the quickstart's `zai-org/GLM-5.1-FP8` is now an alias of `z-ai/glm-5.3-flash`, so use the canonical ID.
11. **Contracts: Rust only.** near-sdk-js is archived and deprecated ("DO NOT USE"), and near-sdk-as (AssemblyScript) is archived.
12. **On-chain verification is feasible for Ed25519** (`env::ed25519_verify`, stable). `ecrecover` needs the `unstable` feature.
13. **Hackathon dates:** the event officially starts Nov 1, 2026, and code written from the Oct 19 announcement counts. The **payout account must be a mainnet NEAR account.** A LICENSE file is required. Submission can go through the API as well as the form.
14. **Track-prompt requirements:** the Privacy prompt asks for a **Verified panel**, **nothing kept server-side**, and **fictional sample docs**. The Security prompt asks for a **function-call key scoped to one contract** and an **attack demo**. All are now in the plan.

## 14. Items marked [UNVERIFIED] / [TBD]

**[UNVERIFIED]**
- An end-to-end paid completion plus `verifyResponse()` → `provider_tee` (no API key this session)
- How long `/v1/signature/{id}` stays retrievable on the server
- NEAR AI Cloud rate limits
- Whether DCAP quote verification is feasible inside a NEAR contract (not attempted, out of scope)
- A JSON-schema `response_format` used together with E2EE on the chosen model (the live model metadata lists `structured_outputs`)
- How often NEAR rotates model signing keys

**[TBD]**
- Final model ID (default suggestion `z-ai/glm-5.3-flash`)
- Whether to pin approved measurements (`deploymentPolicy`)
- TCB fallback (allow `SWHardeningNeeded`?)
- Storage-key custody (KMS vs local keyfile)
- `request_open` anti-griefing (deposit vs cap)
- Policy confidence threshold
- Chunk size for large evidence
- Measured gas and storage per method and per receipt (Day 3; the calculated estimate is ≈ 770 bytes ≈ 0.0077 NEAR per Finding receipt)
- Citation limits (maximum quote length, maximum citations per finding)
- The writer key's gas allowance
- The exact CLI error output for the attack demo (captured on Day 3)
- Repo URL, LICENSE confirmation (MIT suggested), team size, lead name, contact email, **mainnet payout account** (all decided by the human)
- Hosted demo or local-only
- Post-hackathon roadmap priorities

## 15. Sources (all opened Nov 4, 2026)

**Hackathon:** https://nearhackathon.com/HACKATHON.md · https://github.com/nearai/near-hackathon-prompt-examples (README.md, 00-setup.md, SUBMITTING.md, tracks/03-privacy.md, tracks/06-security.md)

**NEAR AI Cloud docs:** https://docs.near.ai/llms.txt · /cloud/quickstart · /cloud/models · /cloud/private-inference · /cloud/verification · /cloud/verification/verification-center · /cloud/verification/cloud-api/gateway-attestation · /cloud/verification/cloud-api/model-attestations · /cloud/verification/cloud-api/response-signatures · /cloud/verification/reference/quote-nonce-signer · /cloud/verification/reference/response-signature-verification · /cloud/verification/reference/verification-policy · /cloud/inference-sdk · /cloud/inference-sdk/javascript · /cloud/inference-sdk/python · /cloud/guides/e2ee-chat-completions · /api-reference/attestation/get-attestation-report · /api-reference/attestation/get-completion-or-responses-api-signature

**Live endpoints:** https://cloud-api.near.ai/v1/models · https://cloud-api.near.ai/v1/model/{id} · https://cloud-api.near.ai/v1/attestation/report · https://nras.attestation.nvidia.com/v3/attest/gpu · https://rpc.testnet.near.org and https://rpc.mainnet.near.org (`gas_price`, `block`, `EXPERIMENTAL_protocol_config`)

**SDK source and registries:** https://github.com/nearai/inference-sdk (commit cd77f82, Nov 4, 2026: README, js/docs/api-reference.md, js/docs/verification-guide.md, py/docs/api-reference.md, py/docs/verification-guide.md, js/package.json, py/pyproject.toml) · https://www.npmjs.com/package/@nearai/inference-sdk · https://pypi.org/project/nearai-inference-sdk/ · https://crates.io/crates/nearai-inference-sdk

**TDX / DCAP:** https://github.com/Phala-Network/dcap-qvl (README, src/quote.rs, src/tcb_info.rs, src/lib.rs) · https://pypi.org/project/dcap-qvl/ · https://www.npmjs.com/package/@phala/dcap-qvl

**NEAR protocol and contracts:** https://docs.near.org/llms.txt · /tools/sdk · /smart-contracts/quickstart · /smart-contracts/release/deploy · /getting-started/faucet · /protocol/storage/storage-staking · /protocol/transactions/gas · /protocol/transactions/transaction-execution · /smart-contracts/anatomy/environment · /smart-contracts/anatomy/collections · /smart-contracts/anatomy/events · /smart-contracts/anatomy/crosscontract · /protocol/accounts-contracts/access-keys · /web3-apps/quickstart · /web3-apps/backend/backend · /smart-contracts/security/storage · https://github.com/near/near-sdk-js · https://github.com/near/near-sdk-as · https://github.com/near/agent-skills · crates.io: near-sdk, cargo-near, near-cli-rs, near-workspaces · near-sdk 5.30.0 crate source (src/environment/env.rs) · npm: near-api-js, @hot-labs/near-connect, near-sdk-js

**NEAR protocol source:** https://github.com/near/nearcore (commit 863a2e2e64, Nov 4, 2026: `runtime/runtime/src/verifier.rs` `verify_function_call_permission`, `core/primitives/src/errors.rs` `InvalidAccessKeyError`)

**NEAR Intents Agent API:** https://docs.agentsonintents.com/integration/agent-api/overview · /policies-and-limits · /owner-signing · /tee · /transparency · /sdk

**Incident background:** https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a
