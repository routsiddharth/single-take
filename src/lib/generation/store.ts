import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Content-addressed artifact store (plan §2.2 / §6 "immutability is also
 * security"). Stands in for Cloudflare R2 / S3.
 *
 * Two units coexist:
 *  - Legacy single-file artifacts (`putArtifact`/`getArtifact`) — the old
 *    one-HTML-file Model-B-era output. Kept for any pre-existing rows.
 *  - Bundles (`putBundle`/`getManifest`/`getFile`) — the Model-A unit. A sealed
 *    `dist/` tree is stored as content-addressed blobs plus a canonical JSON
 *    manifest; the manifest's own sha256 is the artifact key.
 *
 * Everything is served from the CSP-locked /a/[key] route, never the app origin.
 */
const ROOT = process.env.SINGLETAKE_ARTIFACTS ?? "./data/artifacts";
const BLOBS = path.join(ROOT, "blobs");
const MANIFESTS = path.join(ROOT, "manifests");

export function sha256(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// ── legacy single-file store ────────────────────────────────────────────────

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

// ── bundle store (plan §6) ──────────────────────────────────────────────────

export type BundleFile = {
  path: string; // bundle-relative POSIX path, e.g. "index.html", "assets/app.js"
  sha: string; // sha256 of the file bytes (the blob key)
  bytes: number;
  mime: string;
};

export type BundleManifest = {
  version: 1;
  files: BundleFile[];
  entrypoint: "index.html";
  bytes: number;
  fileCount: number;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function mimeFor(p: string): string {
  return MIME[path.extname(p).toLowerCase()] ?? "application/octet-stream";
}

/** Recursively list files under `dir` as POSIX-relative paths (sorted). */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, base));
    else if (entry.isFile())
      out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out.sort();
}

function blobPath(sha: string): string {
  return path.join(BLOBS, sha.slice(0, 2), sha);
}

function putBlob(buf: Buffer): string {
  const sha = sha256(buf);
  const dest = blobPath(sha);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, buf, { mode: 0o444 });
    fs.renameSync(tmp, dest);
  }
  return sha;
}

/** Canonical manifest JSON: stable key order, files already sorted by path. */
function canonical(manifest: BundleManifest): string {
  return JSON.stringify({
    version: manifest.version,
    entrypoint: manifest.entrypoint,
    bytes: manifest.bytes,
    fileCount: manifest.fileCount,
    files: manifest.files.map((f) => ({
      path: f.path,
      sha: f.sha,
      bytes: f.bytes,
      mime: f.mime,
    })),
  });
}

/**
 * Store a sealed `dist/` directory as a content-addressed bundle. Each file is
 * written by sha under blobs/<sha>; the canonical manifest is written under
 * manifests/<key>.json where key = sha256(canonical manifest). Idempotent: a
 * re-put of identical bytes reuses blobs and yields the same key.
 */
export function putBundle(dir: string): {
  key: string;
  manifest: BundleManifest;
  bytes: number;
  fileCount: number;
} {
  const rels = walk(dir);
  if (!rels.includes("index.html")) {
    throw new Error("putBundle: bundle is missing index.html entrypoint");
  }

  const files: BundleFile[] = [];
  let bytes = 0;
  for (const rel of rels) {
    const buf = fs.readFileSync(path.join(dir, rel));
    const sha = putBlob(buf);
    files.push({ path: rel, sha, bytes: buf.length, mime: mimeFor(rel) });
    bytes += buf.length;
  }

  const manifest: BundleManifest = {
    version: 1,
    files,
    entrypoint: "index.html",
    bytes,
    fileCount: files.length,
  };

  const json = canonical(manifest);
  const key = sha256(json);
  const dest = path.join(MANIFESTS, `${key}.json`);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(MANIFESTS, { recursive: true });
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, json, { mode: 0o444 });
    fs.renameSync(tmp, dest);
  }

  return { key, manifest, bytes, fileCount: files.length };
}

export function getManifest(key: string): BundleManifest | null {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  try {
    const json = fs.readFileSync(path.join(MANIFESTS, `${key}.json`), "utf8");
    return JSON.parse(json) as BundleManifest;
  } catch {
    return null;
  }
}

export function getFile(sha: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  try {
    return fs.readFileSync(blobPath(sha));
  } catch {
    return null;
  }
}
