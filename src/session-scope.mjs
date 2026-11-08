export const SAMPLE_CASE_ID = "larkmoor-demo";
export const CASE_IDS_HEADER = "x-custos-case-ids";

const HEX32 = /^[0-9a-f]{32}$/i;

export function isSampleCaseId(id) {
  return String(id || "") === SAMPLE_CASE_ID;
}

export function parseCaseIdsHeader(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => HEX32.test(s))
    .map((s) => s.toLowerCase());
}

export function isOperatorRequest(req, token = process.env.CUSTOS_WRITE_TOKEN || process.env.WRITE_TOKEN) {
  if (!token) return false;
  const got = String(req?.headers?.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return Boolean(got) && got === token;
}

export function receiptCaseId(r) {
  return String(r?.case_id || "");
}

export function receiptVisible(r, callerIds, operator) {
  if (operator) return true;
  const cid = receiptCaseId(r);
  if (cid === SAMPLE_CASE_ID) return true;
  return callerIds.includes(cid.toLowerCase());
}

export function filterReceipts(receipts, callerIds, operator) {
  return (receipts || []).filter((r) => receiptVisible(r, callerIds, operator));
}

export function sampleWriteBlocked(caseId) {
  return isSampleCaseId(caseId);
}
