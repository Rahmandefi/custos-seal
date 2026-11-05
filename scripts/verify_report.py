#!/usr/bin/env python3
"""Independent dcap-qvl check of dumped Intel TDX quotes.

Also prints SHA-256 of the dumped report JSON so it can be compared with
gateway_report_hash / model_report_hash in out/receipt.json.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"


def sha256_file_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def extract_quote_hex(report: dict) -> str | None:
    if not isinstance(report, dict):
        return None
    for key in ("intelQuote", "intel_quote", "quote"):
        val = report.get(key)
        if isinstance(val, str) and len(val) > 16:
            return val
    nested = report.get("attestation") or report.get("report")
    if isinstance(nested, dict):
        return extract_quote_hex(nested)
    return None


def verify_quote(label: str, report: dict) -> str | None:
    quote_hex = extract_quote_hex(report)
    if not quote_hex:
        print(f"{label}: no intelQuote found; keys={list(report)[:24]}")
        return None
    try:
        from dcap_qvl import get_collateral_and_verify
    except ImportError:
        print("dcap-qvl not installed. pip install -r requirements-verify.txt", file=sys.stderr)
        sys.exit(2)

    raw = bytes.fromhex(quote_hex.removeprefix("0x"))
    result = asyncio.run(get_collateral_and_verify(raw))
    status = (
        getattr(result, "status", None)
        or getattr(result, "tcb_status", None)
        or getattr(result, "tcbStatus", None)
    )
    if status is None:
        status = result
    print(f"{label}: tcb={status!r} quote_bytes={len(raw)}")
    s = str(status)
    if "UpToDate" not in s:
        print(f"{label}: REJECT (policy accepts UpToDate only)")
        sys.exit(1)
    return s


def main() -> None:
    receipt_path = OUT / "receipt.json"
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}

    files = [
        ("gateway", OUT / "gateway-report.json", receipt.get("gateway_report_hash")),
        ("model", OUT / "model-report.json", receipt.get("model_report_hash")),
    ]
    found = False
    mismatch = False
    for label, path, expected in files:
        if not path.exists():
            print(f"{label}: missing {path}")
            continue
        found = True
        raw = path.read_bytes()
        # Hash of compact JSON as stored by JSON.stringify in Node (no extra spaces).
        obj = json.loads(raw)
        compact = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
        pretty_hash = sha256_file_bytes(raw)
        compact_hash = hashlib.sha256(json.dumps(obj, separators=(",", ":")).encode()).hexdigest()
        # Node JSON.stringify on objects uses no spaces by default in our hashReportObject.
        node_style = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        # Python json.dumps may differ on key order vs Node. Prefer hashing the file
        # as written if Node wrote JSON.stringify(report) without pretty print.
        node_pretty = hashlib.sha256(
            json.dumps(obj, indent=2, ensure_ascii=False).encode() + b"\n"
            if raw.endswith(b"\n")
            else json.dumps(obj, indent=2, ensure_ascii=False).encode()
        ).hexdigest()
        file_hash = sha256_file_bytes(raw)
        print(f"{label}: file_sha256={file_hash}")
        print(f"{label}: receipt_hash={expected}")
        if expected and file_hash != expected:
            # Try compact
            compact2 = hashlib.sha256(
                json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()
            ).hexdigest()
            print(f"{label}: compact_sha256={compact2}")
            if expected not in (file_hash, compact2, node_pretty):
                print(f"{label}: HASH MISMATCH vs receipt")
                mismatch = True
            else:
                print(f"{label}: hash matches via compact/pretty variant")
        elif expected:
            print(f"{label}: hash MATCH file==receipt")
        verify_quote(label, obj)

    if not found:
        print("No dumped reports in out/.")
        sys.exit(1)
    if mismatch and os.environ.get("STRICT_REPORT_HASH") == "1":
        sys.exit(1)
    if mismatch:
        print("hash mismatch vs existing receipt.json (non-fatal; TCB still UpToDate)")


if __name__ == "__main__":
    main()
