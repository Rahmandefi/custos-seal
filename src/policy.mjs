/**
 * Layer 2 policy engine. Same inputs → same verdict. No model calls.
 * P2 citations: byte-for-byte quote match inside the cited line range.
 */

export const IRREVERSIBLE = new Set([
  "isolate_host",
  "block_ip",
  "delete",
  "notify_external",
  "share_outside_case",
]);

const INJECTION_MARKERS = [
  "ignore previous instructions",
  "ignore all previous",
  "disregard previous",
];

const MAX_QUOTE_BYTES = 512;
const CONFIDENCE_FLOOR = 0.4;

/**
 * @param {object} output parsed model JSON
 * @param {Record<string, string>} evidenceMap evidence_id → original file text
 * @param {{ signatureKind?: string, tcbOk?: boolean }} provenance
 */
export function evaluate(output, evidenceMap, provenance = {}) {
  const reasons = [];
  let verdict = "ACCEPT";

  function worse(v) {
    const rank = { ACCEPT: 0, FLAG: 1, HOLD: 2, BLOCK: 3 };
    if (rank[v] > rank[verdict]) verdict = v;
  }

  if (!output || !Array.isArray(output.findings)) {
    return { verdict: "BLOCK", reasons: ["P1 schema: missing findings[]"] };
  }

  if (provenance.signatureKind && provenance.signatureKind !== "provider_tee") {
    return { verdict: "BLOCK", reasons: ["P3 provenance: not provider_tee"] };
  }
  if (provenance.tcbOk === false) {
    return { verdict: "BLOCK", reasons: ["P3 provenance: TCB outside policy"] };
  }

  const citationRecords = [];

  for (const [i, finding] of output.findings.entries()) {
    if (
      typeof finding?.claim !== "string" ||
      !Array.isArray(finding.citations) ||
      !Array.isArray(finding.iocs) ||
      !Array.isArray(finding.recommended_actions) ||
      typeof finding.confidence !== "number"
    ) {
      return {
        verdict: "BLOCK",
        reasons: [`P1 schema: finding[${i}] missing required fields`],
      };
    }

    if (finding.citations.length === 0) {
      return {
        verdict: "BLOCK",
        reasons: [`P2: finding[${i}] has no citations`],
        citationRecords,
      };
    }

    for (const [j, cit] of finding.citations.entries()) {
      const file = evidenceMap[cit.evidence_id];
      if (file == null) {
        return {
          verdict: "BLOCK",
          reasons: [`P2: unknown evidence_id ${cit.evidence_id}`],
          citationRecords,
        };
      }
      const quote = cit.quote;
      if (typeof quote !== "string" || quote.length === 0) {
        return {
          verdict: "BLOCK",
          reasons: [`P2: empty quote finding[${i}].citations[${j}]`],
          citationRecords,
        };
      }
      if (Buffer.byteLength(quote, "utf8") > MAX_QUOTE_BYTES) {
        return {
          verdict: "BLOCK",
          reasons: [`P2: quote too long finding[${i}].citations[${j}]`],
          citationRecords,
        };
      }
      const lines = file.split("\n");
      const start = cit.line_start;
      const end = cit.line_end;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 1 ||
        end < start ||
        end > lines.length
      ) {
        return {
          verdict: "BLOCK",
          reasons: [`P2: line range out of bounds finding[${i}].citations[${j}]`],
          citationRecords,
        };
      }
      const slice = lines.slice(start - 1, end).join("\n");
      const idx = slice.indexOf(quote);
      if (idx < 0) {
        return {
          verdict: "BLOCK",
          reasons: [
            `P2: quote not byte-for-byte in cited lines finding[${i}].citations[${j}]`,
          ],
          citationRecords,
        };
      }
      // Byte offsets in original file
      const prefix = lines.slice(0, start - 1).join("\n");
      const prefixBytes = Buffer.byteLength(
        prefix + (start > 1 ? "\n" : ""),
        "utf8"
      );
      const byteStart = prefixBytes + Buffer.byteLength(slice.slice(0, idx), "utf8");
      const byteEnd = byteStart + Buffer.byteLength(quote, "utf8");
      citationRecords.push({
        evidence_id: cit.evidence_id,
        line_start: start,
        line_end: end,
        byte_start: byteStart,
        byte_end: byteEnd,
        quote,
      });
    }

    for (const ioc of finding.iocs) {
      const inSpan = finding.citations.some((c) => c.quote.includes(ioc));
      if (!inSpan) {
        worse("FLAG");
        reasons.push(`P2 IOC outside cited spans: ${ioc}`);
      }
    }

    for (const action of finding.recommended_actions) {
      if (IRREVERSIBLE.has(action)) {
        worse("HOLD");
        reasons.push(`P4 irreversible action: ${action}`);
      }
    }

    if (finding.confidence < CONFIDENCE_FLOOR) {
      worse("FLAG");
      reasons.push(`P6 confidence ${finding.confidence} < ${CONFIDENCE_FLOOR}`);
    }
  }

  const allText = Object.values(evidenceMap).join("\n").toLowerCase();
  for (const marker of INJECTION_MARKERS) {
    if (allText.includes(marker)) {
      worse("FLAG");
      reasons.push(`P5 injection marker: ${marker}`);
    }
  }

  return { verdict, reasons, citationRecords };
}
