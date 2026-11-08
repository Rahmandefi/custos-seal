import { spawn } from "node:child_process";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  KeyPair,
  KeyPairSigner,
  createTransaction,
  actions,
  baseDecode,
  base64Encode,
} from "near-api-js";

export const RPC = process.env.NEAR_RPC || "https://rpc.testnet.fastnear.com";
export const CONTRACT = process.env.NEAR_CONTRACT || "ftcust15e434.testnet";
export const WRITER = process.env.NEAR_WRITER || "ftwriter15e434.testnet";
export const OWNER = process.env.NEAR_OWNER || "ftowner15e434.testnet";
export const FNKEY =
  process.env.NEAR_WRITER_KEYFILE ||
  `${process.env.HOME || ""}/.near-credentials/testnet/ftwriter-fncall.json`;

export async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const body = await res.json();
  if (body.error) {
    const err = new Error(JSON.stringify(body.error));
    err.rpc = body.error;
    throw err;
  }
  return body.result;
}

export async function viewFunction(method, args = {}) {
  const result = await rpc("query", {
    request_type: "call_function",
    account_id: CONTRACT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    finality: "final",
  });
  const raw = Buffer.from(result.result);
  const text = raw.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function viewAccount(accountId = CONTRACT) {
  return rpc("query", {
    request_type: "view_account",
    account_id: accountId,
    finality: "final",
  });
}

export async function receiptCount() {
  const v = await viewFunction("receipt_count", {});
  return Number(v);
}

export async function getReceipt(id) {
  return viewFunction("get_receipt", { id });
}

async function privateKeyFromEnvOrFile(envKey, envJson, filePath) {
  if (process.env[envKey]) return process.env[envKey];
  if (process.env[envJson]) {
    const j = JSON.parse(process.env[envJson]);
    return j.private_key || j.secretKey;
  }
  if (filePath) {
    try {
      const j = JSON.parse(await readFile(filePath, "utf8"));
      return j.private_key || j.secretKey;
    } catch {
      return null;
    }
  }
  return null;
}

function parseGas(gas) {
  const s = String(gas);
  const n = parseFloat(s);
  if (/tgas/i.test(s)) return BigInt(Math.round(n * 1e12));
  return BigInt(s);
}

function parseDeposit(deposit) {
  const s = String(deposit);
  if (/near/i.test(s)) {
    const n = Number.parseFloat(s);
    return BigInt(Math.round(n * 1e24));
  }
  return BigInt(s || 0);
}

async function callWithKey(accountId, privateKey, method, args, { deposit = "0 NEAR", gas = "100 Tgas" } = {}) {
  const keyPair = KeyPair.fromString(privateKey);
  const signer = new KeyPairSigner(keyPair);
  const publicKey = keyPair.getPublicKey();
  const ak = await rpc("query", {
    request_type: "view_access_key",
    account_id: accountId,
    public_key: publicKey.toString(),
    finality: "final",
  });
  const nonce = Number(ak.nonce) + 1;
  const block = await rpc("block", { finality: "final" });
  const tx = createTransaction(
    accountId,
    publicKey,
    CONTRACT,
    nonce,
    [actions.functionCall(method, args, parseGas(gas), parseDeposit(deposit))],
    baseDecode(block.header.hash)
  );
  const { signedTransaction } = await signer.signTransaction(tx);
  const body = await rpc("send_tx", {
    signed_tx_base64: base64Encode(signedTransaction.encode()),
    wait_until: "EXECUTED_OPTIMISTIC",
  });
  const hash =
    body.transaction_outcome?.id ||
    body.transaction?.hash ||
    body.hash ||
    null;
  return { tx: hash, output: JSON.stringify(body).slice(0, 2000) };
}

function runNear(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("near", args, { env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const text = out + err;
      const tx = text.match(/Transaction ID:\s+(\S+)/)?.[1] || null;
      const gas = text.match(/Gas burned:\s+([0-9.]+)\s+Tgas/)?.[1] || null;
      if (code !== 0) {
        const e = new Error(text.slice(-2000) || `near exit ${code}`);
        e.code = code;
        e.output = text;
        e.tx = tx;
        reject(e);
        return;
      }
      resolve({ output: text, tx, gasCli: gas });
    });
  });
}

export async function writerAllowance({ rpcFn = rpc, keyFile = FNKEY } = {}) {
  const pk = await privateKeyFromEnvOrFile(
    "NEAR_WRITER_PRIVATE_KEY",
    "NEAR_WRITER_KEY_JSON",
    keyFile
  );
  if (!pk) {
    return { publicKey: null, allowance: null, error: "missing writer credentials" };
  }
  let publicKey;
  try {
    publicKey = KeyPair.fromString(pk).getPublicKey().toString();
  } catch {
    return { publicKey: null, allowance: null, error: "invalid writer credentials" };
  }
  try {
    const ak = await rpcFn("query", {
      request_type: "view_access_key",
      account_id: WRITER,
      public_key: publicKey,
      finality: "final",
    });
    const allowance = ak?.permission?.FunctionCall?.allowance;
    if (allowance == null) {
      return { publicKey, allowance: null, error: "allowance not returned" };
    }
    return { publicKey, allowance, raw: ak };
  } catch {
    return { publicKey, allowance: null, error: "allowance lookup failed" };
  }
}

export async function callWriter(method, args, { deposit = "0 NEAR", gas = "100 Tgas", outDir } = {}) {
  const pk = await privateKeyFromEnvOrFile(
    "NEAR_WRITER_PRIVATE_KEY",
    "NEAR_WRITER_KEY_JSON",
    FNKEY
  );
  if (pk) return callWithKey(WRITER, pk, method, args, { deposit, gas });
  const argsPath = join(outDir || "/tmp", `near-args-${method}-${Date.now()}.json`);
  await mkdir(outDir || "/tmp", { recursive: true });
  await writeFile(argsPath, JSON.stringify(args));
  return runNear([
    "contract",
    "call-function",
    "as-transaction",
    CONTRACT,
    method,
    "file-args",
    argsPath,
    "prepaid-gas",
    gas,
    "attached-deposit",
    deposit,
    "sign-as",
    WRITER,
    "network-config",
    "testnet",
    "sign-with-access-key-file",
    FNKEY,
    "send",
  ]);
}

export async function callOwner(method, args, { deposit = "0 NEAR", gas = "50 Tgas", outDir } = {}) {
  const ownerFile = `${process.env.HOME || ""}/.near-credentials/testnet/${OWNER}.json`;
  const pk = await privateKeyFromEnvOrFile(
    "NEAR_OWNER_PRIVATE_KEY",
    "NEAR_OWNER_KEY_JSON",
    ownerFile
  );
  if (pk) return callWithKey(OWNER, pk, method, args, { deposit, gas });
  const argsPath = join(outDir || "/tmp", `near-args-owner-${method}-${Date.now()}.json`);
  await writeFile(argsPath, JSON.stringify(args));
  return runNear([
    "contract",
    "call-function",
    "as-transaction",
    CONTRACT,
    method,
    "file-args",
    argsPath,
    "prepaid-gas",
    gas,
    "attached-deposit",
    deposit,
    "sign-as",
    OWNER,
    "network-config",
    "testnet",
    "sign-with-legacy-keychain",
    "send",
  ]);
}

export async function txFullGas(txHash, sender) {
  const res = await rpc("EXPERIMENTAL_tx_status", {
    tx_hash: txHash,
    sender_account_id: sender,
  });
  const gasOf = (o) => Number((o?.outcome || o)?.gas_burnt || 0);
  const txg = gasOf(res.transaction_outcome);
  const recs = res.receipts_outcome || [];
  const recg = recs.reduce((s, x) => s + gasOf(x), 0);
  return { txOutcome: txg, receiptOutcomes: recg, nReceipts: recs.length, total: txg + recg };
}

export function parseCliErrors(output) {
  return output;
}

export function hexToBytesMaybe(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    const h = v.replace(/^0x/, "");
    return Array.from(Buffer.from(h, "hex"));
  }
  return v;
}
