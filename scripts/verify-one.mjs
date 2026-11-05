#!/usr/bin/env node
/**
 * Verified Confidential TEE completion + real R1/R3 receipt fields.
 * Fail-closed: no receipt unless provider_tee.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InferenceClient,
  AttestationClient,
  getSdkError,
} from "@nearai/inference-sdk/node";
import { evaluate } from "../src/policy.mjs";
import {
  bytesToArray,
  bytesToHex,
  canonicalJson,
  citationHash,
  evidenceCommitment,
  findingHash,
  hexToBytes,
  newSalt,
  nonceToBytes,
  sha256Hex,
} from "../src/commit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODEL = process.env.NEAR_AI_MODEL || "z-ai/glm-5.3-flash";
const API_KEY = process.env.NEAR_AI_API_KEY || "";
const ATTEST_ONLY = process.argv.includes("--attest-only") || !API_KEY;
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
        console.log(`${label}: NVIDIA JWT nbf not yet valid. retry ${attempt}/5 in 4s`);
        await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw err;
    }
  }
}

function rawReport(attestedPiece) {
  return attestedPiece?.report ?? attestedPiece ?? null;
}

function hashReportObject(report) {
  if (!report) return null;
  return sha256Hex(Buffer.from(JSON.stringify(report)));
}

function extractNonce(attestedPiece) {
  const report = rawReport(attestedPiece);
  return (
    report?.nonce ||
    attestedPiece?.clientBinding?.nonce ||
    attestedPiece?.nonce ||
    null
  );
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

async function main() {
  if (process.versions.node.split(".").map(Number)[0] < 24) {
    throw new Error(`Need Node >= 24.22.1, got ${process.version}`);
  }

  const client = new InferenceClient({
    apiKey: API_KEY || undefined,
    signingAlgo: "ed25519",
    e2ee: !ATTEST_ONLY,
    attestationCacheTimeToLiveMs: 0,
    gatewayVerification: { policy: tcbPolicy },
    modelVerification: { policy: tcbPolicy },
  });

  const evidencePath = join(ROOT, "samples/larkmoor-listing.txt");
  const evidenceText = await readFile(evidencePath, "utf8");
  const evidenceBytes = Buffer.from(evidenceText, "utf8");
  const salt = newSalt();
  const commitment = evidenceCommitment(salt, evidenceBytes);

  console.log("model:", MODEL);
  console.log("evidence:", evidencePath, "bytes", evidenceBytes.length);
  console.log("commitment:", bytesToHex(commitment));

  const attested = await withNbfRetry("verify()", () => client.verify(MODEL));
  console.log("gateway verified:", Boolean(attested.gateway));
  console.log("model reports:", attested.models?.length ?? 0);

  const outDir = join(ROOT, "out");
  await mkdir(outDir, { recursive: true });

  const gwReport = rawReport(attested.gateway);
  const modelReport = rawReport(attested.models?.[0]);
  let gatewayHash = hashReportObject(gwReport);
  let modelHash = hashReportObject(modelReport);
  const modelNonce = extractNonce(attested.models?.[0]);
  const gatewayNonce = extractNonce(attested.gateway);
  const nonceBytes = nonceToBytes(modelNonce || gatewayNonce);

  const gwText = JSON.stringify(gwReport, null, 2);
  const modelText = JSON.stringify(modelReport, null, 2);
  await writeFile(join(outDir, "gateway-report.json"), gwText);
  await writeFile(join(outDir, "model-report.json"), modelText);
  gatewayHash = sha256Hex(Buffer.from(gwText));
  modelHash = sha256Hex(Buffer.from(modelText));

  await writeFile(
    join(outDir, "attestation.json"),
    JSON.stringify(
      {
        model: MODEL,
        verifiedAt: attested.verifiedAt,
        gateway_nonce: gatewayNonce,
        model_nonce: modelNonce,
        gateway_report_hash: gatewayHash,
        model_report_hash: modelHash,
        gateway_intel_quote: gwReport?.intelQuote ? "present" : null,
        model_intel_quote: modelReport?.intelQuote ? "present" : null,
      },
      null,
      2
    )
  );

  if (ATTEST_ONLY) {
    console.log("SKIP completion: no API key / --attest-only");
    return;
  }

  const schema = {
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

  const numbered = numberLines(evidenceText, "E1");
  const messages = [
    {
      role: "system",
      content:
        "You are a forensic triage assistant. Reply with JSON only matching the schema. Citations must copy quotes byte-for-byte from the evidence lines. FICTIONAL SCENARIO.",
    },
    {
      role: "user",
      content: `Evidence file E1 (line-numbered):\n${numbered}\n\nIs human2.aspx present in the listing? Cite the exact line text.`,
    },
  ];

  const createOpts = { signal: AbortSignal.timeout(120_000) };
  let structuredOk = false;
  let completion = await withNbfRetry("structured create", () =>
    client.chat.completions.create(
      { model: MODEL, messages, stream: false, response_format: schema },
      createOpts
    )
  );
  structuredOk = true;
  console.log("structured_outputs+E2EE: ok");

  const id = completion.id;
  if (!id) throw new Error("completion missing id");

  const verified = await client.verifyResponse(id);
  console.log("verifyResponse:", verified.signatureKind, verified.id);
  if (verified.signatureKind !== "provider_tee") {
    throw new Error(`fail-closed: expected provider_tee, got ${verified.signatureKind}`);
  }

  const parsed = parseModelJson(completionText(completion));
  const policy = evaluate(parsed, { E1: evidenceText }, {
    signatureKind: verified.signatureKind,
    tcbOk: true,
  });
  console.log("policy:", policy.verdict, policy.reasons);

  const findingBody = parsed?.findings?.[0] ?? {
    claim: "unparseable",
    citations: [],
    iocs: [],
    recommended_actions: [],
    confidence: 0,
  };
  const fHash = findingHash(findingBody);
  const citHashes = (policy.citationRecords ?? []).map((c) =>
    citationHash(c.quote)
  );

  const attClient = new AttestationClient({ apiKey: API_KEY });
  const sig = await attClient.fetchCompletionSignature({
    completionId: id,
    signingAlgo: "ed25519",
  });
  const signedText = sig.signedText ?? sig.text ?? "";
  const signature =
    typeof sig.signature === "string" ? sig.signature : String(sig.signature ?? "");
  const signerRaw = sig.signer ?? sig.signingAddress ?? sig.signing_address;
  const signer =
    typeof signerRaw === "string"
      ? signerRaw.replace(/^0x/, "")
      : signerRaw?.signingAddress || signerRaw?.publicKey;

  const [modelId, reqHex, respHex] = signedText.split(":");

  const receipt = {
    model_id: modelId || MODEL,
    completion_id: id,
    signature_kind: verified.signatureKind,
    signed_text: signedText,
    signature,
    signer_pubkey: signer,
    request_hash: reqHex,
    response_hash: respHex,
    nonce: bytesToHex(nonceBytes),
    gateway_nonce: gatewayNonce,
    model_nonce: modelNonce,
    gateway_report_hash: gatewayHash,
    model_report_hash: modelHash,
    evidence_id: "E1",
    evidence_path: "samples/larkmoor-listing.txt",
    evidence_commitments: [bytesToHex(commitment)],
    finding_hash: bytesToHex(fHash),
    citation_hashes: citHashes.map(bytesToHex),
    policy_verdict: policy.verdict,
    policy_reasons: policy.reasons,
    citations: policy.citationRecords ?? [],
    finding: findingBody,
    structured_outputs_with_e2ee: structuredOk,
    verified_at: attested.verifiedAt,
  };

  await writeFile(join(outDir, "receipt.json"), JSON.stringify(receipt, null, 2));
  await writeFile(join(outDir, "case-salt.hex"), bytesToHex(salt) + "\n");
  await writeFile(
    join(outDir, "record_finding.json"),
    JSON.stringify({
      case_id: "larkmoor-demo",
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
      verdict: policy.verdict === "BLOCK" ? "Block" : policy.verdict === "HOLD" ? "Hold" : policy.verdict === "FLAG" ? "Flag" : "Accept",
    })
  );
  console.log("wrote out/receipt.json nonce", receipt.nonce);
  console.log("finding_hash", receipt.finding_hash);
  console.log("citations", receipt.citation_hashes.length);
  client.clearResponseCache();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
