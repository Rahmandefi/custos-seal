import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  InferenceClient,
  AttestationClient,
  getSdkError,
} from "@nearai/inference-sdk/node";
import { evaluate } from "./policy.mjs";
import { rememberTx } from "./export.mjs";
import {
  bytesToArray,
  bytesToHex,
  citationHash,
  citationRecord,
  evidenceCommitment,
  findingHash,
  hexToBytes,
  newSalt,
  nonceToBytes,
  sha256Hex,
} from "./commit.mjs";
import {
  CONTRACT,
  FNKEY,
  WRITER,
  callWriter,
  receiptCount,
  rpc,
  viewAccount,
  viewFunction,
} from "./near.mjs";

export class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.skipChain = true;
  }
}

const MODEL = process.env.NEAR_AI_MODEL || "z-ai/glm-5.3-flash";
const tcbPolicy = { acceptedTcbStatuses: ["UpToDate"] };

function isNbfSkew(err) {
  let e = err;
  for (let i = 0; i < 8 && e; i++) {
    const sdk = typeof getSdkError === "function" ? getSdkError(e) : e;
    const code = sdk?.failure?.code ?? e?.failure?.code;
    const reason = sdk?.failure?.details?.reason ?? e?.failure?.details?.reason;
    if (code === "gpu.jwt_verification_failed" && reason === "not_yet_valid") {
      return true;
    }
    if (e?.cause?.claim === "nbf") return true;
    e = e.cause;
  }
  return false;
}

async function withNbfRetry(label, fn) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isNbfSkew(err) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw err;
    }
  }
}

function mapVerdict(v) {
  if (v === "BLOCK" || v === "Block") return "Block";
  if (v === "HOLD" || v === "Hold") return "Hold";
  if (v === "FLAG" || v === "Flag") return "Flag";
  return "Accept";
}

function rawReport(p) {
  return p?.report ?? p ?? null;
}

function extractNonce(p) {
  const report = rawReport(p);
  return report?.nonce || p?.clientBinding?.nonce || p?.nonce || null;
}

function numberLines(text, evidenceId) {
  return text
    .split("\n")
    .map((line, i) => `${evidenceId}:${String(i + 1).padStart(4, "0")}| ${line}`)
    .join("\n");
}

function parseModelJson(content) {
  if (!content) return null;
  if (typeof content === "object") return content;
  const s = String(content).trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function completionText(completion) {
  const msg = completion?.choices?.[0]?.message;
  return msg?.content ?? msg?.parsed ?? "";
}

const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "triage_findings",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              claim: { type: "string" },
              citations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    evidence_id: { type: "string" },
                    line_start: { type: "integer" },
                    line_end: { type: "integer" },
                    quote: { type: "string" },
                  },
                  required: ["evidence_id", "line_start", "line_end", "quote"],
                },
              },
              iocs: { type: "array", items: { type: "string" } },
              recommended_actions: { type: "array", items: { type: "string" } },
              confidence: { type: "number" },
            },
            required: [
              "claim",
              "citations",
              "iocs",
              "recommended_actions",
              "confidence",
            ],
          },
        },
      },
      required: ["findings"],
    },
  },
};

async function defaultTee({ evidenceText, apiKey }) {
  const client = new InferenceClient({
    apiKey,
    signingAlgo: "ed25519",
    e2ee: true,
    attestationCacheTimeToLiveMs: 0,
    gatewayVerification: { policy: tcbPolicy },
    modelVerification: { policy: tcbPolicy },
  });
  const attested = await withNbfRetry("verify()", () => client.verify(MODEL));
  const numbered = numberLines(evidenceText, "E1");
  const messages = [
    {
      role: "system",
      content:
        "You are a forensic triage assistant. Reply with JSON only matching the schema. Citations must copy quotes byte-for-byte from the evidence lines. FICTIONAL SCENARIO. recommended_actions must use these exact strings when the evidence calls for them: isolate_host, block_ip, delete, notify_external, share_outside_case. If the evidence says isolate_host or Isolate host, include isolate_host.",
    },
    {
      role: "user",
      content: `Evidence file E1 (line-numbered):\n${numbered}\n\nCite the exact line text. If the evidence recommends isolate_host, put isolate_host in recommended_actions.`,
    },
  ];
  const completion = await withNbfRetry("structured create", () =>
    client.chat.completions.create(
      { model: MODEL, messages, stream: false, response_format: SCHEMA },
      { signal: AbortSignal.timeout(120_000) }
    )
  );
  const verified = await client.verifyResponse(completion.id);
  const attClient = new AttestationClient({ apiKey });
  const sig = await attClient.fetchCompletionSignature({
    completionId: completion.id,
    signingAlgo: "ed25519",
  });
  client.clearResponseCache();
  return { attested, completion, verified, sig };
}

async function runDcapQvl(outDir) {
  const py = join(outDir, "..", ".venv", "bin", "python");
  const script = join(outDir, "..", "scripts", "verify_report.py");
  return new Promise((resolve, reject) => {
    const child = spawn(existsSync(py) ? py : "python3", [script], {
      cwd: join(outDir, ".."),
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new PipelineError("DCAP_QVL_FAILED", out.slice(-1500)));
        return;
      }
      resolve(out);
    });
  });
}

async function loadSeen(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return [];
  }
}

async function writerAllowance() {
  const key = JSON.parse(await readFile(FNKEY, "utf8"));
  const pk = key.public_key;
  try {
    const ak = await rpc("query", {
      request_type: "view_access_key",
      account_id: WRITER,
      public_key: pk,
      finality: "final",
    });
    const allowance = ak?.permission?.FunctionCall?.allowance;
    return { publicKey: pk, allowance, raw: ak };
  } catch (e) {
    return { publicKey: pk, allowance: null, error: String(e.message) };
  }
}

/**
 * Full pipeline. Throws PipelineError (skipChain) before any contract call on fail-closed paths.
 */
export async function analyzeEvidence({
  evidenceBytes,
  evidenceText,
  caseId = "larkmoor-demo",
  outDir,
  root,
  apiKey = process.env.NEAR_AI_API_KEY,
  writeOnChain = true,
  runDcap = true,
  tee,
  salt,
  allowanceFn = writerAllowance,
  forceVerdict,
}) {
  const text = evidenceText ?? Buffer.from(evidenceBytes).toString("utf8");
  const bytes = evidenceBytes ?? Buffer.from(text, "utf8");
  const envSalt = process.env.CASE_SALT || process.env.EVIDENCE_SALT;
  const caseSalt =
    salt ??
    (envSalt ? hexToBytes(envSalt.replace(/^0x/i, "")) : newSalt());
  const commitment = evidenceCommitment(caseSalt, bytes);

  const teeResult = tee
    ? await tee({ evidenceText: text, apiKey })
    : await defaultTee({ evidenceText: text, apiKey });

  const { attested, completion, verified, sig } = teeResult;

  const gwTcb = attested.gateway?.tcbStatus || attested.gateway?.tcb_status;
  const modelTcb =
    attested.models?.[0]?.tcbStatus || attested.models?.[0]?.tcb_status;
  if (gwTcb && gwTcb !== "UpToDate") {
    throw new PipelineError("TCB_NOT_UP_TO_DATE", `gateway tcb=${gwTcb}`);
  }
  if (modelTcb && modelTcb !== "UpToDate") {
    throw new PipelineError("TCB_NOT_UP_TO_DATE", `model tcb=${modelTcb}`);
  }
  if (attested.tcbOk === false) {
    throw new PipelineError("TCB_NOT_UP_TO_DATE", "tcbOk=false");
  }

  if (verified?.signatureKind !== "provider_tee") {
    throw new PipelineError(
      "NOT_PROVIDER_TEE",
      `signatureKind=${verified?.signatureKind}`
    );
  }

  const gwReport = rawReport(attested.gateway);
  const modelReport = rawReport(attested.models?.[0]);
  const gwText = JSON.stringify(gwReport, null, 2);
  const modelText = JSON.stringify(modelReport, null, 2);
  const gatewayHash = sha256Hex(Buffer.from(gwText));
  const modelHash = sha256Hex(Buffer.from(modelText));
  const modelNonce = extractNonce(attested.models?.[0]);
  const gatewayNonce = extractNonce(attested.gateway);
  const nonceBytes = nonceToBytes(modelNonce || gatewayNonce);
  const nonceHex = bytesToHex(nonceBytes);

  await mkdir(outDir, { recursive: true });
  const seenPath = join(outDir, "seen-nonces.json");
  const seen = await loadSeen(seenPath);
  if (seen.includes(nonceHex)) {
    throw new PipelineError("NONCE_REUSED", `nonce ${nonceHex} already used`);
  }

  const parsed = parseModelJson(completionText(completion));
  const policy = evaluate(
    parsed,
    { E1: text },
    { signatureKind: verified.signatureKind, tcbOk: true }
  );

  const p2 = (policy.reasons || []).some((r) => String(r).startsWith("P2"));
  if (policy.verdict === "BLOCK" && (p2 || !policy.citationRecords?.length)) {
    throw new PipelineError(
      "CITATION_MISMATCH",
      policy.reasons?.join("; ") || "citation check failed"
    );
  }

  const findingBody = parsed?.findings?.[0];
  if (!findingBody) {
    throw new PipelineError("CITATION_MISMATCH", "no findings");
  }

  const commitHex = bytesToHex(commitment);
  const citRecords = (policy.citationRecords || []).map((c) =>
    citationRecord(commitHex, c)
  );
  const citHashes = citRecords.map((rec) => citationHash(caseSalt, rec));
  const fHash = findingHash(caseSalt, findingBody);

  await writeFile(join(outDir, "gateway-report.json"), gwText);
  await writeFile(join(outDir, "model-report.json"), modelText);

  if (runDcap) {
    await runDcapQvl(outDir);
  }

  const signedText = sig.signedText ?? sig.text ?? "";
  const signature =
    typeof sig.signature === "string" ? sig.signature : String(sig.signature ?? "");
  const signerRaw = sig.signer ?? sig.signingAddress ?? sig.signing_address;
  const signer =
    typeof signerRaw === "string"
      ? signerRaw.replace(/^0x/, "")
      : signerRaw?.signingAddress || signerRaw?.publicKey;
  const [modelId, reqHex, respHex] = signedText.split(":");

  const allowance = await allowanceFn();
  if (
    allowance.allowance === "0" ||
    (typeof allowance.allowance === "string" && BigInt(allowance.allowance) === 0n)
  ) {
    throw new PipelineError("ALLOWANCE_EXHAUSTED", "writer gas allowance is 0");
  }

  const receipt = {
    model_id: modelId || MODEL,
    completion_id: completion.id,
    signature_kind: verified.signatureKind,
    signed_text: signedText,
    signature,
    signer_pubkey: signer,
    request_hash: reqHex,
    response_hash: respHex,
    nonce: nonceHex,
    gateway_nonce: gatewayNonce,
    model_nonce: modelNonce,
    gateway_report_hash: gatewayHash,
    model_report_hash: modelHash,
    evidence_id: "E1",
    evidence_commitments: [commitHex],
    finding_hash: bytesToHex(fHash),
    citation_hashes: citHashes.map(bytesToHex),
    citation_records: citRecords,
    policy_verdict: policy.verdict,
    policy_reasons: policy.reasons,
    citations: policy.citationRecords ?? [],
    finding: findingBody,
    case_id: caseId,
  };

  await writeFile(join(outDir, "receipt.json"), JSON.stringify(receipt, null, 2));
  await writeFile(join(outDir, "case-salt.hex"), bytesToHex(caseSalt) + "\n");
  await writeFile(
    join(outDir, "case.json"),
    JSON.stringify(
      {
        case_id: caseId,
        salt: bytesToHex(caseSalt),
        evidence_commitment: commitHex,
        nonce: nonceHex,
      },
      null,
      2
    )
  );

  const recordArgs = {
    case_id: caseId,
    evidence_commitments: [bytesToArray(commitment)],
    finding: {
      model_id: receipt.model_id,
      request_hash: bytesToArray(hexToBytes(reqHex)),
      response_hash: bytesToArray(hexToBytes(respHex)),
      signature: bytesToArray(hexToBytes(signature)),
      signer_pubkey: bytesToArray(hexToBytes(signer)),
      gateway_report_hash: bytesToArray(hexToBytes(gatewayHash)),
      model_report_hash: bytesToArray(hexToBytes(modelHash)),
      nonce: bytesToArray(nonceBytes),
      tcb_status: "UpToDate",
      finding_hash: bytesToArray(fHash),
      citation_hashes: citHashes.map(bytesToArray),
    },
    verdict: mapVerdict(forceVerdict || policy.verdict),
  };
  await writeFile(join(outDir, "record_finding.json"), JSON.stringify(recordArgs));

  let tx = null;
  let receiptId = null;
  let storageBefore = null;
  let storageAfter = null;
  if (writeOnChain) {
    storageBefore = (await viewAccount(CONTRACT)).storage_usage;
    const countBefore = await receiptCount();
    const sent = await callWriter("record_finding", recordArgs, { outDir });
    tx = sent.tx;
    const countAfter = await receiptCount();
    receiptId = countAfter - 1;
    storageAfter = (await viewAccount(CONTRACT)).storage_usage;
    if (countAfter !== countBefore + 1) {
      throw new Error(`expected receipt_count ${countBefore + 1}, got ${countAfter}`);
    }
    await rememberTx(outDir, receiptId, tx);
  }

  seen.push(nonceHex);
  await writeFile(seenPath, JSON.stringify(seen, null, 2));

  return {
    receipt,
    recordArgs,
    tx,
    receiptId,
    storageBefore,
    storageAfter,
    storageDelta: storageAfter != null ? storageAfter - storageBefore : null,
    salt: bytesToHex(caseSalt),
    policy,
  };
}

export { writerAllowance };
