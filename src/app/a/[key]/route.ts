import { NextRequest } from "next/server";
import { getArtifact } from "@/lib/generation/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hosting untrusted AI-generated code (plan §2.2). Defense in depth:
 *  - Served from a dedicated path with a strict CSP — `connect-src 'none'`
 *    means the artifact JS cannot phone home (kills exfiltration / beacons).
 *  - Everything must be inline or data:/blob: (consistent with self-contained).
 *  - In-feed embeds use <iframe sandbox="allow-scripts"> WITHOUT
 *    allow-same-origin → opaque origin, no access to app cookies/storage.
 *  - frame-ancestors locks embedding to our own pages.
 *
 * (Locally this is same-origin; in production it would be a separate
 * singletakeusercontent.com-style domain — see README.)
 */
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const bytes = getArtifact(key);
  if (!bytes) {
    return new Response("artifact not found — or removed from the wall", {
      status: 404,
    });
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      // immutable, content-addressed → cache forever (plan §2.2)
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
