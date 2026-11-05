#!/usr/bin/env node
/**
 * Four scoped-key attacks via raw JSON-RPC `send_tx` (signed locally).
 * Writes InvalidTxError bodies to out/key-scope-tests.txt. Never prints private keys.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KeyPair,
  KeyPairSigner,
  createTransaction,
  actions,
  baseDecode,
  base64Encode,
} from "near-api-js";
import { CONTRACT, FNKEY, OWNER, RPC as DEFAULT_RPC, WRITER } from "../src/near.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const rpcUrl = DEFAULT_RPC;

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "key-scope", method, params }),
  });
  return res.json();
}

async function main() {
  const cred = JSON.parse(await readFile(FNKEY, "utf8"));
  const keyPair = KeyPair.fromString(cred.private_key);
  const signer = new KeyPairSigner(keyPair);
  const publicKey = keyPair.getPublicKey();
  const pkStr = publicKey.toString();

  const ak = await rpc("query", {
    request_type: "view_access_key",
    account_id: WRITER,
    public_key: pkStr,
    finality: "final",
  });
  if (ak.error) throw new Error(JSON.stringify(ak.error));
  let nonce = Number(ak.result.nonce);

  const block = await rpc("block", { finality: "final" });
  const blockHash = baseDecode(block.result.header.hash);

  const gas = 30_000_000_000_000n;
  const oneYocto = 1n;

  const cases = [
    {
      name: "1. transfer (expect RequiresFullAccess)",
      receiver: WRITER,
      actions: [actions.transfer(oneYocto)],
    },
    {
      name: "2. other contract (expect ReceiverMismatch)",
      receiver: OWNER,
      actions: [actions.functionCall("add_signer", { pubkey: Array(32).fill(0) }, gas, 0n)],
    },
    {
      name: "3. disallowed method add_signer (expect MethodNameMismatch)",
      receiver: CONTRACT,
      actions: [actions.functionCall("add_signer", { pubkey: Array(32).fill(0) }, gas, 0n)],
    },
    {
      name: "4. attached deposit (expect DepositWithFunctionCall)",
      receiver: CONTRACT,
      actions: [
        actions.functionCall(
          "record_finding",
          { case_id: "probe" },
          gas,
          oneYocto
        ),
      ],
    },
  ];

  const lines = [];
  lines.push("# Function-call key scope tests (raw JSON-RPC send_tx)");
  lines.push("");
  lines.push(`Signer: ${WRITER} public key ${pkStr}`);
  lines.push(
    `Receiver allowed: ${CONTRACT} methods record_finding, record_custody_check`
  );
  lines.push("Method: send_tx  wait_until=INCLUDED");
  lines.push("No transaction is accepted; nonce is not consumed on InvalidTxError.");
  lines.push("");

  const variants = [];

  for (const c of cases) {
    nonce += 1;
    const tx = createTransaction(
      WRITER,
      publicKey,
      c.receiver,
      nonce,
      c.actions,
      blockHash
    );
    const { signedTransaction } = await signer.signTransaction(tx);
    const signed_tx_base64 = base64Encode(signedTransaction.encode());
    const body = await rpc("send_tx", {
      signed_tx_base64,
      wait_until: "INCLUDED",
    });
    const err = body.error || body.result;
    const dumped = JSON.stringify(err, null, 2);
    const names = collectEnumNames(err);
    lines.push(`## ${c.name}`);
    lines.push("");
    lines.push("```json");
    lines.push(dumped);
    lines.push("```");
    lines.push("");
    lines.push(`Parsed variant names: ${names.join(" / ") || "(none)"}`);
    lines.push("No successful tx hash.");
    lines.push("");
    variants.push({ name: c.name, names, error: err });
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "key-scope-tests.txt"), lines.join("\n"));
  console.log(JSON.stringify(variants.map((v) => ({ name: v.name, names: v.names })), null, 2));
  console.log("wrote out/key-scope-tests.txt");
}

function collectEnumNames(obj, acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  for (const [k, v] of Object.entries(obj)) {
    if (/^[A-Z][A-Za-z0-9]+$/.test(k)) acc.push(k);
    if (v && typeof v === "object") collectEnumNames(v, acc);
    if (typeof v === "string" && /^[A-Z][A-Za-z0-9]+$/.test(v)) acc.push(v);
  }
  return acc;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
