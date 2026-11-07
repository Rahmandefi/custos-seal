#!/usr/bin/env node
/**
 * Finalized RPC read only. No transactions.
 * Usage: node wallet-signing-scripts/verify-record.mjs CONTRACT.testnet OPERATION_ID_HEX
 */
const contract = process.argv[2];
const op = process.argv[3];
if (!contract || !op) {
  console.error("usage: node wallet-signing-scripts/verify-record.mjs CONTRACT.testnet OPERATION_ID_HEX");
  process.exit(1);
}
const rpc = process.env.NEAR_RPC || "https://rpc.testnet.fastnear.com";
const key = `e:${op}`;
const res = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "1",
    method: "query",
    params: {
      request_type: "view_state",
      finality: "final",
      account_id: contract,
      prefix_base64: Buffer.from(key).toString("base64"),
    },
  }),
});
const j = await res.json();
if (j.error) {
  console.error(j.error);
  process.exit(1);
}
console.log(JSON.stringify(j.result || j, null, 2));
