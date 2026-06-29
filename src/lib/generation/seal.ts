import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * The seal gate (plan §5). Deterministic, server-side enforcement of the A
 * artifact contract: static, offline, self-contained. A model promise is not
 * enforcement — this is. It runs over the agent's build output BEFORE anything
 * is stored or published.
 *
 * Takes a build directory, locates `dist/`, and returns either an accepted
 * static bundle (the dist path + measured size) or a terminal failure reason.
 * A failure here is the user's single take ending in `status='failed'` — it is
 * NOT an infrastructure error.
 */

export type SealOk = {
  ok: true;
  distDir: string;
  bytes: number;
  fileCount: number;
};
export type SealFail = {
  ok: false;
  kind: "seal" | "scan";
  reason: string;
};
export type SealResult = SealOk | SealFail;

// Budgets (plan §5.7), env-overridable.
const TOTAL_BYTES = numEnv("SINGLETAKE_BUNDLE_MAX_BYTES", 30 * 1024 * 1024); // 30 MB
const FILE_COUNT = numEnv("SINGLETAKE_BUNDLE_MAX_FILES", 1500);
const PER_FILE_BYTES = numEnv("SINGLETAKE_BUNDLE_MAX_FILE_BYTES", 10 * 1024 * 1024); // 10 MB

function numEnv(name: string, dflt: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Extensions whose bytes we scan for forbidden content. Binaries are size-checked
// but not content-scanned.
const TEXT_EXT = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".map",
  ".svg", ".txt", ".xml", ".webmanifest",
]);

// Files/dirs that mark a non-static, server-expecting output (plan §5.3).
const SERVER_MARKERS = [
  "server.js", "server.mjs", "server.ts",
  "next.config.js", "next.config.mjs", "next.config.ts",
  "package.json", // a dist should never ship a package.json — it's a build, not an app to install
  ".env", ".env.local", ".env.production",
];

type Violation = { kind: "seal" | "scan"; reason: string };

/** Locate the static output directory under the build root. */
function locateDist(buildDir: string): string | null {
  const direct = path.join(buildDir, "dist");
  if (isDir(direct) && fileExists(path.join(direct, "index.html"))) return direct;
  // some toolchains emit build/, out/, or public/ — accept the first with index.html
  for (const name of ["build", "out", "public", "www"]) {
    const cand = path.join(buildDir, name);
    if (isDir(cand) && fileExists(path.join(cand, "index.html"))) return cand;
  }
  // buildDir itself may already BE the dist (fake build hands us dist directly)
  if (fileExists(path.join(buildDir, "index.html"))) return buildDir;
  return null;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

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

/** Scan one text file's contents for forbidden remote/egress patterns. */
function scanText(rel: string, body: string): Violation | null {
  const lower = body.toLowerCase();

  // meta-refresh redirect to an external URL
  if (/<meta[^>]+http-equiv=["']?\s*refresh["']?[^>]+url=\s*["']?\s*https?:/i.test(body)) {
    return { kind: "scan", reason: `${rel}: external meta-refresh redirect` };
  }
  // remote <script src>
  if (/<script[^>]+src=["']?\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: remote <script src> (not self-contained)` };
  }
  // remote <link href> (stylesheet, fonts, preload, prefetch, dns-prefetch…)
  if (/<link[^>]+href=["']?\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: remote <link href> (remote stylesheet/font)` };
  }
  // remote <iframe src>
  if (/<iframe[^>]+src=["']?\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: remote <iframe src>` };
  }
  // CSS @import of a remote sheet
  if (/@import\s+(?:url\()?["']?\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: remote CSS @import` };
  }
  // CSS url() pointing off-bundle (remote fonts/images)
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: remote url() reference (remote font/asset)` };
  }
  // JS network egress to an absolute / protocol-relative URL
  if (/\bfetch\s*\(\s*["'`]\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: fetch() to an absolute URL (network egress)` };
  }
  if (/\.open\s*\(\s*["'][a-z]+["']\s*,\s*["'`]\s*(?:https?:)?\/\//i.test(body)) {
    return { kind: "scan", reason: `${rel}: XMLHttpRequest to an absolute URL` };
  }
  for (const probe of ["new websocket(", "new eventsource(", "navigator.sendbeacon("]) {
    if (lower.includes(probe)) {
      return { kind: "scan", reason: `${rel}: network egress (${probe.replace(/\($/, "")})` };
    }
  }
  // expects a server backend / API route
  if (/\b(?:fetch|axios)\s*\(\s*["'`]\s*\/api\//i.test(body)) {
    return { kind: "seal", reason: `${rel}: calls a /api backend (not a static artifact)` };
  }
  // expects server-side env injection
  if (/\bprocess\.env\.[A-Z]/.test(body)) {
    return { kind: "seal", reason: `${rel}: references process.env (expects a server)` };
  }
  return null;
}

export function sealGate(buildDir: string): SealResult {
  // 1–2. locate dist + require index.html
  const distDir = locateDist(buildDir);
  if (!distDir) {
    return { ok: false, kind: "seal", reason: "no dist/ with an index.html — nothing static to seal" };
  }

  const rels = walk(distDir);
  if (rels.length === 0) {
    return { ok: false, kind: "seal", reason: "dist/ is empty" };
  }
  if (!rels.includes("index.html")) {
    return { ok: false, kind: "seal", reason: "dist/index.html is missing" };
  }

  // 3. reject server-expecting outputs (shipped server entry / package.json / env)
  for (const rel of rels) {
    const baseName = rel.split("/").pop() ?? rel;
    if (SERVER_MARKERS.includes(baseName) || SERVER_MARKERS.includes(rel)) {
      return { ok: false, kind: "seal", reason: `ships ${rel} — expects a server/install step, not static` };
    }
  }

  // 7. budgets (file count first, cheap)
  if (rels.length > FILE_COUNT) {
    return { ok: false, kind: "seal", reason: `too many files (${rels.length} > ${FILE_COUNT})` };
  }

  // 4–6 + per-file/total budget
  let total = 0;
  for (const rel of rels) {
    const abs = path.join(distDir, rel);
    const stat = fs.statSync(abs);
    if (stat.size > PER_FILE_BYTES) {
      return { ok: false, kind: "seal", reason: `${rel}: file too large (${stat.size} > ${PER_FILE_BYTES})` };
    }
    total += stat.size;
    if (total > TOTAL_BYTES) {
      return { ok: false, kind: "seal", reason: `bundle exceeds size budget (> ${TOTAL_BYTES} bytes)` };
    }
    const ext = path.extname(rel).toLowerCase();
    if (TEXT_EXT.has(ext)) {
      const body = fs.readFileSync(abs, "utf8");
      const v = scanText(rel, body);
      if (v) return { ok: false, kind: v.kind, reason: v.reason };
    }
  }

  return { ok: true, distDir, bytes: total, fileCount: rels.length };
}
