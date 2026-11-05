import { readFile } from "node:fs/promises";
import {
  KeyPair,
  KeyPairSigner,
  createTransaction,
  actions,
  baseDecode,
  base64Encode,
} from "near-api-js";
import { CONTRACT, FNKEY, OWNER, RPC, WRITER } from "./near.mjs";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "atk", method, params }),
  });
  return res.json();
}

const KINDS = {
  transfer: () => ({
    receiver: WRITER,
    actions: [actions.transfer(1n)],
    expect: "RequiresFullAccess",
    label: "Transfer 1 yocto",
  }),
  receiver: () => ({
    receiver: OWNER,
    actions: [
      actions.functionCall("add_signer", { pubkey: Array(32).fill(0) }, 30_000_000_000_000n, 0n),
    ],
    expect: "ReceiverMismatch",
    label: "Call a different contract",
  }),
  method: () => ({
    receiver: CONTRACT,
    actions: [
      actions.functionCall("add_signer", { pubkey: Array(32).fill(0) }, 30_000_000_000_000n, 0n),
    ],
    expect: "MethodNameMismatch",
    label: "Call add_signer",
  }),
  deposit: () => ({
    receiver: CONTRACT,
    actions: [
      actions.functionCall("record_finding", { case_id: "probe" }, 30_000_000_000_000n, 1n),
    ],
    expect: "DepositWithFunctionCall",
    label: "Attach a deposit",
  }),
};

export async function runAttack(kind) {
  const specFn = KINDS[kind];
  if (!specFn) throw new Error(`unknown attack ${kind}`);
  const spec = specFn();
  const pk =
    process.env.NEAR_WRITER_PRIVATE_KEY ||
    (process.env.NEAR_WRITER_KEY_JSON &&
      JSON.parse(process.env.NEAR_WRITER_KEY_JSON).private_key) ||
    JSON.parse(await readFile(FNKEY, "utf8")).private_key;
  const keyPair = KeyPair.fromString(pk);
  const signer = new KeyPairSigner(keyPair);
  const publicKey = keyPair.getPublicKey();
  const ak = await rpc("query", {
    request_type: "view_access_key",
    account_id: WRITER,
    public_key: publicKey.toString(),
    finality: "final",
  });
  if (ak.error) throw new Error(JSON.stringify(ak.error));
  const nonce = Number(ak.result.nonce) + 1;
  const block = await rpc("block", { finality: "final" });
  const tx = createTransaction(
    WRITER,
    publicKey,
    spec.receiver,
    nonce,
    spec.actions,
    baseDecode(block.result.header.hash)
  );
  const { signedTransaction } = await signer.signTransaction(tx);
  const body = await rpc("send_tx", {
    signed_tx_base64: base64Encode(signedTransaction.encode()),
    wait_until: "INCLUDED",
  });
  const err = body.error || null;
  const data = err?.data || err;
  return {
    kind,
    label: spec.label,
    expect: spec.expect,
    rejected: Boolean(err),
    tx_hash: body.result?.transaction_outcome?.id || body.result?.transaction?.hash || null,
    error: err,
    variant: JSON.stringify(data),
  };
}
