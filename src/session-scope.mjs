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

export const DEMO_HOURLY_MAX_DEFAULT = 12;
export const DEMO_ALLOWANCE_FLOOR_DEFAULT = "10000000000000000000000";

export function receiptsInWindow(receipts, nowNs, windowNs) {
  const now = BigInt(nowNs);
  const win = BigInt(windowNs);
  let n = 0;
  for (const r of receipts || []) {
    if (r?.timestamp_ns == null) continue;
    try {
      if (now - BigInt(r.timestamp_ns) <= win) n += 1;
    } catch {
      /* skip */
    }
  }
  return n;
}

export function demoLimitReached(receipts, allowance, { nowNs, maxHourly, floorYocto } = {}) {
  const hourly = receiptsInWindow(receipts, nowNs, 3600n * 1_000_000_000n);
  const max = Number(maxHourly ?? DEMO_HOURLY_MAX_DEFAULT);
  if (hourly > max) return { blocked: true, reason: "hourly", hourly, max };
  try {
    if (allowance != null && allowance !== "" && BigInt(allowance) < BigInt(floorYocto ?? DEMO_ALLOWANCE_FLOOR_DEFAULT)) {
      return { blocked: true, reason: "allowance", hourly, max };
    }
  } catch {
    return { blocked: true, reason: "allowance", hourly, max };
  }
  return { blocked: false, hourly, max };
}

export function formatAllowanceNear(yocto) {
  if (yocto == null || yocto === "") return "unknown";
  try {
    const n = Number(BigInt(yocto)) / 1e24;
    return `${n.toFixed(4)} NEAR`;
  } catch {
    return "unknown";
  }
}
