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
  getReceipt,
  receiptCount,
  rpc,
  viewAccount,
  viewFunction,
} from "./near.mjs";
import {
  emptyChecks,
  setCheck,
  attestationNonceHex,
  canRecord,
  shortHex,
  txExecutionState,
  receiptMatchesIntended,
  fieldHex,
} from "../web/verify-checks.js";

export class PipelineError extends Error {
  constructor(code, message, checks = null) {
    super(message);
    this.code = code;
    this.skipChain = true;
    this.checks = checks;
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

export function classifySdkError(err, stage) {
  const sdk = typeof getSdkError === "function" ? getSdkError(err) : null;
  const code = sdk?.failure?.code || err?.failure?.code || null;
  const details = sdk?.failure?.details || err?.failure?.details || {};
  const safe = { stage, code: code || "unknown" };
  if (code === "binding.nonce_mismatch" || code === "api.nonce_mismatch") {
    return { ...safe, row: "nonce_binding", pipelineCode: "NONCE_BINDING" };
  }
  if (code === "signature.kind_mismatch") {
    return { ...safe, row: "signature", pipelineCode: "NOT_PROVIDER_TEE" };
  }
  if (code === "policy.tcb_status_not_allowed") {
    const path = String(details.path || details.resource || details.source || "");
    if (/model/i.test(path)) {
      return { ...safe, row: "model_tcb", pipelineCode: "TCB_NOT_UP_TO_DATE" };
    }
    if (/gateway/i.test(path)) {
      return { ...safe, row: "gateway_tcb", pipelineCode: "TCB_NOT_UP_TO_DATE" };
    }
    return { ...safe, row: null, pipelineCode: "TCB_NOT_UP_TO_DATE" };
  }
  return { ...safe, row: null, pipelineCode: "SDK_ERROR" };
}

function tagSdk(err, stage, extra = {}) {
  err.sdkStage = stage;
  Object.assign(err, extra);
  return err;
}

function normalizeSigner(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.replace(/^0x/i, "").toLowerCase();
  const s = raw.signingAddress || raw.publicKey || "";
  return String(s).replace(/^0x/i, "").toLowerCase();
}

function applyTcbChecks(checks, attested) {
  const gwTcb = attested?.gateway?.tcbStatus || attested?.gateway?.tcb_status || null;
  const modelTcb =
    attested?.models?.[0]?.tcbStatus || attested?.models?.[0]?.tcb_status || null;
  if (!gwTcb) {
    setCheck(checks, "gateway_tcb", "fail", { reason: "gateway tcbStatus missing" });
  } else if (gwTcb !== "UpToDate") {
    setCheck(checks, "gateway_tcb", "fail", {
      reason: `gateway tcb=${gwTcb}`,
      evidence: { tcb_status: gwTcb },
    });
  } else {
    setCheck(checks, "gateway_tcb", "pass", { evidence: { tcb_status: gwTcb } });
  }
  if (!modelTcb) {
    setCheck(checks, "model_tcb", "fail", { reason: "model tcbStatus missing" });
  } else if (modelTcb !== "UpToDate") {
    setCheck(checks, "model_tcb", "fail", {
      reason: `model tcb=${modelTcb}`,
      evidence: { tcb_status: modelTcb },
    });
  } else {
    setCheck(checks, "model_tcb", "pass", { evidence: { tcb_status: modelTcb } });
  }
  if (attested?.tcbOk === false) {
    if (checks.gateway_tcb.status === "pass") {
      setCheck(checks, "gateway_tcb", "fail", {
        reason: "tcbOk=false",
        evidence: { tcb_status: gwTcb },
      });
    }
    if (checks.model_tcb.status === "pass") {
      setCheck(checks, "model_tcb", "fail", {
        reason: "tcbOk=false",
        evidence: { tcb_status: modelTcb },
      });
    }
  }
  return { gwTcb, modelTcb };
}

async function defaultTee({ evidenceText, apiKey, sdk = {} }) {
  const client =
    sdk.client ||
    new InferenceClient({
      apiKey,
      signingAlgo: "ed25519",
      e2ee: true,
      attestationCacheTimeToLiveMs: 0,
      gatewayVerification: { policy: tcbPolicy },
      modelVerification: { policy: tcbPolicy },
    });
  let attested;
  try {
    attested = await withNbfRetry("verify()", () =>
      sdk.verify ? sdk.verify({ client, model: MODEL }) : client.verify(MODEL)
    );
  } catch (e) {
    throw tagSdk(e, "verify");
  }
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
  let completion;
  try {
    completion = await withNbfRetry("structured create", () =>
      sdk.createCompletion
        ? sdk.createCompletion({ client, messages })
        : client.chat.completions.create(
            { model: MODEL, messages, stream: false, response_format: SCHEMA },
            { signal: AbortSignal.timeout(120_000) }
          )
    );
  } catch (e) {
    throw tagSdk(e, "createCompletion", { attested });
  }
  let verified;
  try {
    verified = await (sdk.verifyResponse
      ? sdk.verifyResponse({ client, completion })
      : client.verifyResponse(completion.id));
  } catch (e) {
    throw tagSdk(e, "verifyResponse", { attested, completion });
  }
  let sig = null;
  try {
    if (sdk.fetchSignature) {
      sig = await sdk.fetchSignature({ completion });
    } else {
      const attClient = new AttestationClient({ apiKey });
      sig = await attClient.fetchCompletionSignature({
        completionId: completion.id,
        signingAlgo: "ed25519",
      });
    }
  } catch {
    sig = null;
  }
  if (typeof client.clearResponseCache === "function") client.clearResponseCache();
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
  recordFindingFn,
  receiptCountFn = receiptCount,
  viewAccountFn = viewAccount,
  getReceiptFn = getReceipt,
  txStatusFn,
  dcapFn,
  sdk,
}) {
  const text = evidenceText ?? Buffer.from(evidenceBytes).toString("utf8");
  const bytes = evidenceBytes ?? Buffer.from(text, "utf8");
  const envSalt = process.env.CASE_SALT || process.env.EVIDENCE_SALT;
  const caseSalt =
    salt ??
    (envSalt ? hexToBytes(envSalt.replace(/^0x/i, "")) : newSalt());
  const commitment = evidenceCommitment(caseSalt, bytes);

  const checks = emptyChecks();
  let teeResult;
  try {
    teeResult = tee
      ? await tee({ evidenceText: text, apiKey })
      : await defaultTee({ evidenceText: text, apiKey, sdk });
  } catch (e) {
    if (e.attested) applyTcbChecks(checks, e.attested);
    const mapped = classifySdkError(e, e.sdkStage || "tee");
    if (mapped.row) {
      setCheck(checks, mapped.row, "fail", {
        reason: `${mapped.stage}: ${mapped.code}`,
        evidence: { stage: mapped.stage, code: mapped.code },
      });
    }
    throw new PipelineError(
      mapped.pipelineCode,
      e.message || String(e),
      checks
    );
  }

  const { attested, completion, verified, sig } = teeResult;
  const { gwTcb, modelTcb } = applyTcbChecks(checks, attested);
  if (checks.gateway_tcb.status === "fail" || checks.model_tcb.status === "fail") {
    const reason =
      checks.gateway_tcb.status === "fail"
        ? checks.gateway_tcb.reason
        : checks.model_tcb.reason;
    throw new PipelineError("TCB_NOT_UP_TO_DATE", reason, checks);
  }

  const modelNonce = extractNonce(attested.models?.[0]);
  const gatewayNonce = extractNonce(attested.gateway);
  await mkdir(outDir, { recursive: true });
  const seenPath = join(outDir, "seen-nonces.json");
  const seen = await loadSeen(seenPath);
  const nonceHex = attestationNonceHex(modelNonce) || attestationNonceHex(gatewayNonce);
  if (!nonceHex) {
    setCheck(checks, "nonce", "fail", {
      reason: "attested reports did not include a 32-byte nonce",
    });
    throw new PipelineError("NONCE_INVALID", "missing or invalid nonce", checks);
  }
  if (seen.includes(nonceHex)) {
    setCheck(checks, "nonce", "fail", {
      reason: "nonce already used",
      evidence: { nonce: shortHex(nonceHex) },
    });
    throw new PipelineError("NONCE_REUSED", `nonce ${nonceHex} already used`, checks);
  }
  setCheck(checks, "nonce", "pass", {
    evidence: { nonce: shortHex(nonceHex), kind: "format" },
  });

  const requestNonce = attestationNonceHex(teeResult.requestNonce);
  if (!requestNonce) {
    setCheck(checks, "nonce_binding", "unsupported", {
      reason: "SDK enforces request binding internally; this app did not generate a request nonce to compare",
    });
  } else if (requestNonce !== nonceHex) {
    setCheck(checks, "nonce_binding", "fail", {
      reason: "reported nonce does not match the request nonce",
      evidence: { request: shortHex(requestNonce), reported: shortHex(nonceHex) },
    });
    throw new PipelineError("NONCE_BINDING", "request nonce mismatch", checks);
  } else {
    setCheck(checks, "nonce_binding", "pass", {
      evidence: { request: shortHex(requestNonce), reported: shortHex(nonceHex) },
    });
  }
  const nonceBytes = nonceToBytes(nonceHex);

  if (verified?.signatureKind !== "provider_tee") {
    setCheck(checks, "signature", "fail", {
      reason: `signatureKind=${verified?.signatureKind || "missing"}`,
      evidence: { signature_kind: verified?.signatureKind || null },
    });
    throw new PipelineError(
      "NOT_PROVIDER_TEE",
      `signatureKind=${verified?.signatureKind}`,
      checks
    );
  }
  const verifiedSigner = normalizeSigner(
    verified?.signature?.signer ?? verified?.signature?.signingAddress
  );
  const fetchedSigner = normalizeSigner(
    sig?.signer ?? sig?.signingAddress ?? sig?.signing_address
  );
  if (verifiedSigner && fetchedSigner && verifiedSigner !== fetchedSigner) {
    setCheck(checks, "signature", "fail", {
      reason: "fetched completion signer does not match verifyResponse signer",
      evidence: { signature_kind: verified.signatureKind, signer_compared: true },
    });
    throw new PipelineError("SIGNER_MISMATCH", "signer mismatch", checks);
  }
  const signerStr = verifiedSigner || "";
  setCheck(checks, "signature", "pass", {
    evidence: {
      signature_kind: verified.signatureKind,
      ...(verifiedSigner && fetchedSigner
        ? { signer_compared: true, signer: shortHex(verifiedSigner) }
        : {}),
    },
  });

  const parsed = parseModelJson(completionText(completion));
  const policy = evaluate(
    parsed,
    { E1: text },
    { signatureKind: verified.signatureKind, tcbOk: true }
  );

  const p2 = (policy.reasons || []).some((r) => String(r).startsWith("P2"));
  if (policy.verdict === "BLOCK" && (p2 || !policy.citationRecords?.length)) {
    setCheck(checks, "citations", "fail", {
      reason: policy.reasons?.join("; ") || "citation check failed",
      evidence: { citation_count: policy.citationRecords?.length || 0 },
    });
    throw new PipelineError(
      "CITATION_MISMATCH",
      policy.reasons?.join("; ") || "citation check failed",
      checks
    );
  }

  const findingBody = parsed?.findings?.[0];
  if (!findingBody) {
    setCheck(checks, "citations", "fail", {
      reason: "no findings",
      evidence: { citation_count: 0 },
    });
    throw new PipelineError("CITATION_MISMATCH", "no findings", checks);
  }
  setCheck(checks, "citations", "pass", {
    evidence: { citation_count: (policy.citationRecords || []).length },
  });

  const gwReport = rawReport(attested.gateway);
  const modelReport = rawReport(attested.models?.[0]);
  const gwText = JSON.stringify(gwReport, null, 2);
  const modelText = JSON.stringify(modelReport, null, 2);
  const gatewayHash = sha256Hex(Buffer.from(gwText));
  const modelHash = sha256Hex(Buffer.from(modelText));

  const commitHex = bytesToHex(commitment);
  const citRecords = (policy.citationRecords || []).map((c) =>
    citationRecord(commitHex, c)
  );
  const citHashes = citRecords.map((rec) => citationHash(caseSalt, rec));
  const fHash = findingHash(caseSalt, findingBody);

  await writeFile(join(outDir, "gateway-report.json"), gwText);
  await writeFile(join(outDir, "model-report.json"), modelText);

  if (runDcap) {
    try {
      const dcapOut = dcapFn ? await dcapFn(outDir) : await runDcapQvl(outDir);
      setCheck(checks, "independent_dcap", "pass", {
        evidence: { tool: "verify_report.py" },
        reason: "Independent dcap-qvl on dumped quotes. Not RTMR3, MRCONFIGID, or NRAS.",
      });
      void dcapOut;
    } catch (e) {
      setCheck(checks, "independent_dcap", "fail", {
        reason: e.message || "verify_report.py failed",
      });
      throw e instanceof PipelineError
        ? new PipelineError(e.code, e.message, checks)
        : new PipelineError("DCAP_QVL_FAILED", String(e.message || e), checks);
    }
  } else {
    setCheck(checks, "independent_dcap", "unsupported", {
      reason: "verify_report.py not run in this request",
    });
  }

  const signedText = sig.signedText ?? sig.text ?? "";
  const signature =
    typeof sig.signature === "string" ? sig.signature : String(sig.signature ?? "");
  const signer = signerStr || fetchedSigner;
  const [modelId, reqHex, respHex] = signedText.split(":");

  const allowance = await allowanceFn();
  if (
    allowance.allowance === "0" ||
    (typeof allowance.allowance === "string" && BigInt(allowance.allowance) === 0n)
  ) {
    throw new PipelineError("ALLOWANCE_EXHAUSTED", "writer gas allowance is 0", checks);
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
    if (!canRecord(checks)) {
      setCheck(checks, "recording", "not_run", { reason: "prior check did not pass" });
      throw new PipelineError("RECORDING_BLOCKED", "fail closed: not recording", checks);
    }
    try {
      storageBefore = (await viewAccountFn(CONTRACT)).storage_usage;
      const writer = recordFindingFn || ((args, opts) => callWriter("record_finding", args, opts));
      const sent = await writer(recordArgs, { outDir });
      tx = sent?.tx ?? sent?.transaction?.hash ?? null;
      storageAfter = (await viewAccountFn(CONTRACT)).storage_usage;
      if (!tx) {
        setCheck(checks, "recording", "fail", {
          reason: "no transaction hash from record_finding",
        });
        throw new PipelineError("RECORDING_FAILED", "missing transaction hash", checks);
      }
      const statuser =
        txStatusFn ||
        (async (hash) =>
          rpc("EXPERIMENTAL_tx_status", {
            tx_hash: hash,
            sender_account_id: WRITER,
            wait_until: "FINAL",
          }));
      let outcome;
      try {
        outcome = await statuser(tx);
      } catch (e) {
        setCheck(checks, "recording", "fail", {
          reason: `transaction status unknown: ${e.message || e}`,
          evidence: { tx },
        });
        throw new PipelineError("RECORDING_UNCONFIRMED", String(e.message || e), checks);
      }
      const exec = txExecutionState(outcome);
      if (exec === "pending" || exec === "unknown") {
        setCheck(checks, "recording", "fail", {
          reason: `transaction ${exec}; not FINAL success`,
          evidence: { tx },
        });
        throw new PipelineError("RECORDING_UNCONFIRMED", `tx ${exec}`, checks);
      }
      if (exec !== "final_success") {
        setCheck(checks, "recording", "fail", {
          reason: "transaction failed",
          evidence: { tx },
        });
        throw new PipelineError("RECORDING_FAILED", "transaction failed", checks);
      }
      const intended = {
        case_id: caseId,
        finding_hash: bytesToHex(fHash),
        nonce: nonceHex,
        evidence_commitment: commitHex,
      };
      let rec = null;
      const hinted = outcome.receipt_id ?? sent.receipt_id;
      if (hinted != null && hinted !== "") {
        rec = await getReceiptFn(Number(hinted));
        if (receiptMatchesIntended(rec, intended)) receiptId = Number(hinted);
        else rec = null;
      }
      if (!receiptMatchesIntended(rec, intended)) {
        const n = await receiptCountFn();
        for (let i = n - 1; i >= 0 && i >= n - 64; i--) {
          const cand = await getReceiptFn(i);
          if (receiptMatchesIntended(cand, intended)) {
            rec = cand;
            receiptId = i;
            break;
          }
        }
      }
      if (!receiptMatchesIntended(rec, intended)) {
        setCheck(checks, "recording", "fail", {
          reason: "no on-chain receipt matches case, finding hash, nonce, and evidence commitment",
          evidence: { tx },
        });
        throw new PipelineError("RECORDING_MISMATCH", "stored receipt does not match the intended write", checks);
      }
      setCheck(checks, "recording", "pass", {
        evidence: {
          receipt_id: receiptId,
          tx,
          tcb_status: gwTcb,
          case_id: rec.case_id,
          finding_hash: shortHex(fieldHex(rec.finding?.finding_hash)),
        },
      });
      await rememberTx(outDir, receiptId, tx);
    } catch (e) {
      if (e instanceof PipelineError) throw e;
      setCheck(checks, "recording", "fail", {
        reason: e.message || "record_finding failed",
        evidence: { tx: tx || null },
      });
      throw new PipelineError("RECORDING_FAILED", String(e.message || e), checks);
    }
  } else {
    setCheck(checks, "recording", "not_run", {
      reason: "chain write not executed for this run",
    });
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
    checks,
  };
}

export { writerAllowance };
