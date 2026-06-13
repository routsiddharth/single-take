import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Content-addressed artifact store (plan §2.2 "immutability is also security").
 * Stands in for Cloudflare R2: the sha256 of the bytes IS the storage key, and
 * we refuse to overwrite an existing key — what was reviewed is what's served,
 * forever. Served from the CSP-locked /a/[key] route, never from the app origin.
 */
const ROOT = process.env.SINGLETAKE_ARTIFACTS ?? "./data/artifacts";

export function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pathFor(key: string): string {
  // shard by first 2 hex chars to avoid a flat directory of thousands of files
  return path.join(ROOT, key.slice(0, 2), key);
}

/** Put bytes if-not-exists. Returns the content-address key. */
export function putArtifact(html: string): { key: string; bytes: number } {
  const buf = Buffer.from(html, "utf8");
  const key = sha256(buf);
  const dest = pathFor(key);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // write atomically: temp + rename, then make read-only (deny overwrite)
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf, { mode: 0o444 });
    fs.renameSync(tmp, dest);
  }
  return { key, bytes: buf.length };
}

export function getArtifact(key: string): Buffer | null {
  // keys are hex sha256 — reject anything else (path-traversal guard)
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const dest = pathFor(key);
  try {
    return fs.readFileSync(dest);
  } catch {
    return null;
  }
}
