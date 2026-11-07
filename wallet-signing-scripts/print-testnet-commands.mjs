#!/usr/bin/env node
/**
 * PRINTS commands only. Example names are not created.
 * Usage: node wallet-signing-scripts/print-testnet-commands.mjs CONTRACT.testnet INVESTIGATOR.testnet
 */
import { randomBytes } from "node:crypto";

const contract = process.argv[2] || "custos-events-illustration.testnet";
const investigator = process.argv[3] || "investigator-illustration.testnet";
if (contract === "ftcust15e434.testnet") {
  console.error("Refusing to print commands for ftcust15e434.testnet");
  process.exit(1);
}
const wasm = "contracts/events/target/wasm32-unknown-unknown/release/custos_events.wasm";
const toArr = (buf) => JSON.stringify([...buf]);
const commit = toArr(randomBytes(32));
const nonce1 = toArr(randomBytes(32));
const nonce2 = toArr(randomBytes(32));
const result = toArr(randomBytes(32));

console.log(`# Review then run on TESTNET only. Do not deploy onto ftcust15e434.testnet.
# Fixture data below is random and is NOT a real verification report.

near contract deploy ${contract} use-file ${wasm} without-init-call network-config testnet sign-with-keychain send

# start_case (30 TGas, 0.02048 NEAR) FICTIONAL commitment
near contract call-function as-transaction ${contract} start_case json-args '{"case_commitment":${commit},"nonce":${nonce1}}' prepaid-gas '30.0 Tgas' attached-deposit '0.02048 NEAR' sign-as ${investigator} network-config testnet sign-with-keychain send

# attest_verification FICTIONAL result_hash (not a real comparison)
near contract call-function as-transaction ${contract} attest_verification json-args '{"receipt_id":8,"result_hash":${result},"nonce":${nonce2},"case_id":"larkmoor-demo"}' prepaid-gas '30.0 Tgas' attached-deposit '0.02048 NEAR' sign-as ${investigator} network-config testnet sign-with-keychain send

near contract view-storage ${contract} all network-config testnet now
`);
