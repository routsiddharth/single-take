import { NextRequest } from "next/server";
import { getManifest, getFile, getArtifact } from "@/lib/generation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The artifact server (plan §7). Serves a sealed, content-addressed bundle:
 *   GET /a/<key>/index.html → the entrypoint (this is what ArtifactFrame loads;
 *                             its base dir is /a/<key>/ so relative same-bundle
 *                             assets like ./app.js and ./meta.json resolve)
 *   GET /a/<key>/<path>     → the exact manifest-listed file at <path>
 *   GET /a/<key> (or /)     → also returns index.html when hit directly
 * Anything not listed in the manifest is a 404. Path traversal is impossible
 * because we never resolve a filesystem path from the URL — only manifest paths
 * are valid, and blobs are addressed by sha. (Note: Next normalizes a trailing
 * slash with a 308, so the iframe targets the explicit /index.html path.)
 *
 * Legacy single-file artifacts (pre-bundle rows) still resolve at /a/<key>.
 *
 * Hosting untrusted AI-generated code: the runtime CSP allows games + wasm but
 * blocks all external egress (`connect-src 'self'`, no remote origins). In-feed
 * embeds use <iframe sandbox="allow-scripts"> WITHOUT allow-same-origin, so the
 * artifact runs at an opaque origin with no access to app cookies/storage.
 *
 * Locally this is same-origin, so `frame-ancestors 'self'` is correct. In
 * production with a separate usercontent origin, set SINGLETAKE_APP_ORIGIN so
 * frame-ancestors points at the app, not the artifact origin (plan §7.1).
 */
const APP_ORIGIN = process.env.SINGLETAKE_APP_ORIGIN ?? "'self'";

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  `frame-ancestors ${APP_ORIGIN}`,
].join("; ");

function headersFor(contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    // immutable, content-addressed → cache forever (plan §7)
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Frame-Options": "SAMEORIGIN",
  };
}

function notFound(): Response {
  return new Response("artifact not found — or removed from the wall", {
    status: 404,
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string; path?: string[] }> },
) {
  const { key, path } = await params;
  if (!/^[0-9a-f]{64}$/.test(key)) return notFound();

  const manifest = getManifest(key);

  // Bundle path.
  if (manifest) {
    const rel = (path ?? []).join("/") || manifest.entrypoint;
    const file = manifest.files.find((f) => f.path === rel);
    if (!file) return notFound();
    const bytes = getFile(file.sha);
    if (!bytes) return notFound();
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: headersFor(file.mime),
    });
  }

  // Legacy single-file artifact (only at the bare key — no subpaths).
  if (!path || path.length === 0) {
    const bytes = getArtifact(key);
    if (bytes) {
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: headersFor("text/html; charset=utf-8"),
      });
    }
  }

  return notFound();
}
