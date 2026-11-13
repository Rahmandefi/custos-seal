# Build log

## Status (2026-11-13)

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

Testnet (2026-11-08): accounts unchanged since 2026-11-05.

| Role | Account |
| --- | --- |
| Contract | `ftcust15e434.testnet` |
| Owner | `ftowner15e434.testnet` |
| Writer | `ftwriter15e434.testnet` |

- Deploy: https://explorer.testnet.near.org/transactions/6NcH52t5kLj2N1b8fRLohfLALV1htf7FhYEdLnPhtp89
- `add_signer`: https://explorer.testnet.near.org/transactions/EqPWta3mUqgU7AXi7jdjMR3ay4VW7Vzjy4DoqRfAZZHr
- Receipt **0:** superseded filler test (`kind=Finding`): https://explorer.testnet.near.org/transactions/BNR827Htm3yL1HdaF7AsotxVyPde2Vp74fePvaUX1Rjg
- Receipt **1:** first real Finding (live TEE, salted evidence commitment, `Accept`): https://explorer.testnet.near.org/transactions/D9xgsYHF9KC2nEHx19mNsJVjJNjG395bT7p5GmbotLgZ
- Receipts 2-5: Open, OpenDenied, CustodyCheck Accept, CustodyCheck Block (left unchanged)
- Receipt **6:** salted `finding_hash`/`citation_hashes` from `samples/larkmoor-listing.txt`: https://explorer.testnet.near.org/transactions/CNVdjDYftBUYGXUSL5WezHuGzSMLjfG3DjER4VEaPQAj (storage +609 bytes)
- Writer function-call keys on-chain (receiver `ftcust15e434.testnet`, methods `record_finding` + `record_custody_check`): `ed25519:2f4coffNJB6iV9t7DdnByZNEETr1UXvvYhLfAGe5bevv` and `ed25519:6Sq16qQU4WoiYoPjRxb1fjYbiv1ASJvEuUgzoKiDzcqS`
- The writer's **full-access** key is kept **offline** (`~/.near-credentials/offline/`), not deleted. A NEAR account with only a function-call key and no remaining full-access key cannot add keys, delete keys, or recover; deleting the last full-access key locks the account. The offline key is the recovery path if the 0.25 NEAR allowance needs a top-up or the method list needs a change.
- [x] UI (wallet connect, Verified panel from live `/analyze` checks, citation highlight, Recorded run, session isolation, demo cap)
- [ ] Demo video (recording next)
