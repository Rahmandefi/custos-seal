import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load `.env` name=value pairs without overriding already-set env. */
export async function loadEnv(path = join(ROOT, ".env")) {
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (process.env[k] === undefined || process.env[k] === "") {
        process.env[k] = v;
      }
    }
  } catch {
    /* no .env is fine when the shell already exported vars */
  }
}
