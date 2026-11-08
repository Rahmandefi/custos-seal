/** Sanitized /analyze error logs. No evidence, prompts, keys, tokens, or auth headers. */

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
  const code = (String(input.code || "ERROR").match(/^[A-Za-z0-9_.-]+/) || ["ERROR"])[0].slice(
    0,
    64
  );
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
