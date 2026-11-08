import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { writerAllowance } from "./near.mjs";

function captureLogs() {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  const origInfo = console.info;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.map(String).join(" "));
  console.error = (...a) => lines.push(a.map(String).join(" "));
  console.info = (...a) => lines.push(a.map(String).join(" "));
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  return {
    lines,
    restore() {
      console.log = origLog;
      console.error = origErr;
      console.info = origInfo;
      console.warn = origWarn;
    },
  };
}

function assertNoSecrets(blob, secrets) {
  const text = typeof blob === "string" ? blob : JSON.stringify(blob);
  for (const s of secrets) {
    if (s) assert.doesNotMatch(text, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

async function withWriterEnv(fn) {
  const prevKey = process.env.NEAR_WRITER_PRIVATE_KEY;
  const prevJson = process.env.NEAR_WRITER_KEY_JSON;
  delete process.env.NEAR_WRITER_PRIVATE_KEY;
  delete process.env.NEAR_WRITER_KEY_JSON;
  try {
    return await fn();
  } finally {
    if (prevKey === undefined) delete process.env.NEAR_WRITER_PRIVATE_KEY;
    else process.env.NEAR_WRITER_PRIVATE_KEY = prevKey;
    if (prevJson === undefined) delete process.env.NEAR_WRITER_KEY_JSON;
    else process.env.NEAR_WRITER_KEY_JSON = prevJson;
  }
}

function mockRpc(allowance) {
  return async (method, params) => {
    assert.equal(method, "query");
    assert.equal(params.request_type, "view_access_key");
    return {
      nonce: 1,
      permission: { FunctionCall: { allowance, receiver_id: "ftcust15e434.testnet" } },
    };
  };
}

test("writerAllowance uses NEAR_WRITER_PRIVATE_KEY without a credentials file", async () => {
  await withWriterEnv(async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const secret = kp.toString();
    process.env.NEAR_WRITER_PRIVATE_KEY = secret;
    const logs = captureLogs();
    try {
      const out = await writerAllowance({
        rpcFn: mockRpc("100000000000000000000000"),
        keyFile: join(tmpdir(), "missing-writer-key.json"),
      });
      assert.equal(out.error, undefined);
      assert.equal(out.allowance, "100000000000000000000000");
      assert.equal(out.publicKey, kp.getPublicKey().toString());
      assertNoSecrets(out, [secret]);
      assertNoSecrets(logs.lines.join("\n"), [secret]);
    } finally {
      logs.restore();
    }
  });
});

test("writerAllowance reads file-based credentials when env keys are unset", async () => {
  await withWriterEnv(async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const secret = kp.toString();
    const dir = await mkdtemp(join(tmpdir(), "ft-writer-"));
    const keyFile = join(dir, "writer.json");
    try {
      await writeFile(
        keyFile,
        JSON.stringify({ account_id: "ftwriter15e434.testnet", private_key: secret })
      );
      const logs = captureLogs();
      try {
        const out = await writerAllowance({
          rpcFn: mockRpc("250000000000000000000000"),
          keyFile,
        });
        assert.equal(out.error, undefined);
        assert.equal(out.allowance, "250000000000000000000000");
        assert.equal(out.publicKey, kp.getPublicKey().toString());
        assertNoSecrets(out, [secret]);
        assertNoSecrets(logs.lines.join("\n"), [secret]);
      } finally {
        logs.restore();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("writerAllowance fails closed when credentials are missing", async () => {
  await withWriterEnv(async () => {
    const logs = captureLogs();
    try {
      const out = await writerAllowance({
        rpcFn: async () => {
          throw new Error("rpc must not run without credentials");
        },
        keyFile: join(tmpdir(), "no-such-writer-key.json"),
      });
      assert.equal(out.publicKey, null);
      assert.equal(out.allowance, null);
      assert.equal(out.error, "missing writer credentials");
      assertNoSecrets(out, []);
      assert.equal(logs.lines.join(""), "");
    } finally {
      logs.restore();
    }
  });
});

test("writerAllowance reports exhausted allowance", async () => {
  await withWriterEnv(async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const secret = kp.toString();
    process.env.NEAR_WRITER_PRIVATE_KEY = secret;
    const logs = captureLogs();
    try {
      const out = await writerAllowance({
        rpcFn: mockRpc("0"),
        keyFile: join(tmpdir(), "missing-writer-key.json"),
      });
      assert.equal(out.error, undefined);
      assert.equal(out.allowance, "0");
      assert.equal(out.publicKey, kp.getPublicKey().toString());
      assertNoSecrets(out, [secret]);
      assertNoSecrets(logs.lines.join("\n"), [secret]);
    } finally {
      logs.restore();
    }
  });
});
