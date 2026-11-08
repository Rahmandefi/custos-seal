/** Sanitized /analyze error logs. No evidence, prompts, keys, tokens, or auth headers. */

const CODES = new Set([
  "ERROR",
  "EMPTY",
  "UNAUTHORIZED",
  "WRITE_DENIED",
  "FORBIDDEN",
  "SDK_ERROR",
  "TCB_NOT_UP_TO_DATE",
  "NONCE_INVALID",
  "NONCE_REUSED",
  "NONCE_BINDING",
  "NOT_PROVIDER_TEE",
  "SIGNER_MISMATCH",
  "CITATION_MISMATCH",
  "DCAP_QVL_FAILED",
  "ALLOWANCE_EXHAUSTED",
  "ALLOWANCE_UNVERIFIED",
  "WRITER_KEY_UNSAFE",
  "WRITER_KEY_UNVERIFIED",
  "DEMO_WRITE_CAP",
  "RECORDING_BLOCKED",
  "RECORDING_FAILED",
  "RECORDING_UNCONFIRMED",
  "RECORDING_MISMATCH",
]);

const STAGE = new Set([
  "authorize",
  "read_body",
  "parse",
  "demo_sample",
  "config",
  "start",
  "tee",
  "verify",
  "createCompletion",
  "verifyResponse",
  "tcb",
  "nonce",
  "nonce_binding",
  "signature",
  "citations",
  "dcap",
  "allowance",
  "recording",
  "unknown",
]);

export function sanitizeAnalyzeErrorLog(input = {}) {
  const stageRaw = String(input.stage || "unknown");
  const stage = STAGE.has(stageRaw) ? stageRaw : "unknown";
  const codeRaw = String(input.code || "ERROR");
  const code = CODES.has(codeRaw) ? codeRaw : "ERROR";
  const elapsed = Number(input.elapsed_ms);
  return {
    event: "analyze_error",
    attempt: String(input.attempt || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 64),
    stage,
    code,
    elapsed_ms: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : null,
  };
}

export function logAnalyzeError(input, sink = console.error) {
  const line = JSON.stringify(sanitizeAnalyzeErrorLog(input));
  sink(line);
  return line;
}
