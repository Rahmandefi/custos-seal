import { createHash, randomBytes } from "node:crypto";

export function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}

export function sha256Hex(buf) {
  return sha256(buf).toString("hex");
}

export function hexToBytes(hex) {
  const h = String(hex).replace(/^0x/i, "");
  if (h.length % 2) throw new Error(`odd hex length: ${h.length}`);
  return Buffer.from(h, "hex");
}

export function bytesToHex(buf) {
  return Buffer.from(buf).toString("hex");
}

export function bytesToArray(buf) {
  return Array.from(Buffer.from(buf));
}

export function arrayToHex(arr) {
  return Buffer.from(arr).toString("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function evidenceCommitment(salt, fileBytes) {
  return sha256(Buffer.concat([Buffer.from(salt), Buffer.from(fileBytes)]));
}

/** sha256(salt ‖ canonical JSON of the citation record). Quote text is not in the record. */
export function citationRecord(commitmentHex, cit) {
  return {
    evidence_commitment: commitmentHex,
    line_start: cit.line_start,
    line_end: cit.line_end,
    byte_start: cit.byte_start,
    byte_end: cit.byte_end,
    quote_sha256: sha256Hex(Buffer.from(cit.quote, "utf8")),
  };
}

export function citationHash(salt, record) {
  return sha256(Buffer.concat([Buffer.from(salt), Buffer.from(canonicalJson(record), "utf8")]));
}

/** sha256(salt ‖ canonical finding JSON). */
export function findingHash(salt, finding) {
  return sha256(
    Buffer.concat([Buffer.from(salt), Buffer.from(canonicalJson(finding), "utf8")])
  );
}

export function newSalt() {
  return randomBytes(32);
}

export function nonceToBytes(nonce) {
  if (!nonce) throw new Error("missing nonce");
  if (typeof nonce === "string") {
    const h = nonce.replace(/^0x/i, "");
    if (/^[0-9a-fA-F]+$/.test(h) && h.length === 64) return hexToBytes(h);
    return sha256(Buffer.from(nonce, "utf8"));
  }
  if (nonce instanceof Uint8Array || Buffer.isBuffer(nonce)) {
    const b = Buffer.from(nonce);
    if (b.length === 32) return b;
    throw new Error(`nonce length ${b.length}`);
  }
  throw new Error("unsupported nonce type");
}
