import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { writerAllowance, writerIdentityFromAccessKey } from "./near.mjs";
import { analyzeEvidence, PipelineError } from "./pipeline.mjs";
import { mkdtemp, rm } from "node:fs/promises";

const evidenceText =
  "alpha\nwwwroot\\human2.aspx  created 2023-06-01 02:39\nomega\n";

function teeStub() {
  return async () => ({
    attested: {
      tcbOk: true,
      gateway: { tcbStatus: "UpToDate", report: { nonce: "aa".repeat(32) } },
      models: [{ tcbStatus: "UpToDate", report: { nonce: "bb".repeat(32) } }],
    },
    completion: {
      id: "c1",
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: [
                {
                  claim: "webshell present",
                  citations: [
                    {
                      evidence_id: "E1",
                      line_start: 2,
                      line_end: 2,
                      quote: "wwwroot\\human2.aspx  created 2023-06-01 02:39",
                    },
                  ],
                  iocs: ["human2.aspx"],
                  recommended_actions: ["review"],
                  confidence: 0.9,
                },
              ],
            }),
          },
        },
      ],
    },
    verified: { signatureKind: "provider_tee" },
    sig: {
      signedText: `z-ai/glm-5.3-flash:${"11".repeat(32)}:${"22".repeat(32)}`,
      signature: "33".repeat(64),
      signer: "44".repeat(32),
    },
  });
}

function fc(methods, extra = {}) {
  return {
    permission: {
      FunctionCall: {
        allowance: "1",
        receiver_id: "ftcust15e434.testnet",
        method_names: methods,
        ...extra,
      },
    },
  };
}

test("identity requires record_finding and rejects extra methods", () => {
  const pk = "ed25519:testpk";
  const ok = writerIdentityFromAccessKey(pk, fc(["record_finding", "record_custody_check"]), pk);
  assert.equal(ok.ok, true);
  const noFinding = writerIdentityFromAccessKey(pk, fc(["record_custody_check"]), pk);
  assert.equal(noFinding.ok, false);
  assert.equal(noFinding.code, "WRITER_KEY_UNSAFE");
  const extra = writerIdentityFromAccessKey(pk, fc(["record_finding", "add_signer"]), pk);
  assert.equal(extra.ok, false);
  assert.equal(extra.code, "WRITER_KEY_UNSAFE");
});

test("identity rejects FullAccess and missing pin", () => {
  const pk = "ed25519:testpk";
  const fa = writerIdentityFromAccessKey(pk, { permission: "FullAccess" }, pk);
  assert.equal(fa.ok, false);
  assert.equal(fa.code, "WRITER_KEY_UNSAFE");
  const missing = writerIdentityFromAccessKey(pk, fc(["record_finding"]), "");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "WRITER_KEY_UNVERIFIED");
});

test("writerAllowance fails closed on missing pin and does not print secrets", async () => {
  const prev = process.env.NEAR_WRITER_PUBLIC_KEY;
  const prevK = process.env.NEAR_WRITER_PRIVATE_KEY;
  delete process.env.NEAR_WRITER_PUBLIC_KEY;
  const kp = KeyPair.fromRandom("ed25519");
  const secret = kp.toString();
  process.env.NEAR_WRITER_PRIVATE_KEY = secret;
  try {
    const out = await writerAllowance({
      rpcFn: async () => fc(["record_finding"]),
      keyFile: join(tmpdir(), "no-file.json"),
      expectedPublic: "",
    });
    assert.equal(out.identityOk, false);
    assert.equal(out.identityCode, "WRITER_KEY_UNVERIFIED");
    assert.equal(JSON.stringify(out).includes(secret), false);
  } finally {
    if (prev === undefined) delete process.env.NEAR_WRITER_PUBLIC_KEY;
    else process.env.NEAR_WRITER_PUBLIC_KEY = prev;
    if (prevK === undefined) delete process.env.NEAR_WRITER_PRIVATE_KEY;
    else process.env.NEAR_WRITER_PRIVATE_KEY = prevK;
  }
});

test("pipeline rejects unsafe writer key without recording", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ft-id-"));
  try {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          writeOnChain: true,
          runDcap: false,
          tee: teeStub(),
          allowanceFn: async () => ({
            publicKey: "ed25519:x",
            allowance: "1",
            identityOk: false,
            identityCode: "WRITER_KEY_UNSAFE",
            error: "writer key is FullAccess",
          }),
          recordFindingFn: async () => {
            throw new Error("must not record");
          },
        }),
      (e) => e instanceof PipelineError && e.code === "WRITER_KEY_UNSAFE" && e.skipChain
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("pipeline rejects missing writer identity configuration", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "ft-id-"));
  try {
    await assert.rejects(
      () =>
        analyzeEvidence({
          evidenceText,
          outDir,
          writeOnChain: false,
          runDcap: false,
          tee: teeStub(),
          allowanceFn: async () => ({
            publicKey: null,
            allowance: null,
            identityOk: false,
            identityCode: "WRITER_KEY_UNVERIFIED",
            error: "missing writer public key pin",
          }),
        }),
      (e) => e instanceof PipelineError && e.code === "WRITER_KEY_UNVERIFIED" && e.skipChain
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
