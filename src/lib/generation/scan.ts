import "server-only";

/**
 * Layer-4 static scan (plan §2.2). A fast pass over generated HTML that flags
 * the cheap-to-detect abuse patterns. The CSP on the artifact response is the
 * real backstop (no network egress possible); this catches the obvious stuff
 * pre-publish and routes it to the review queue.
 */
export type ScanResult = { ok: true } | { ok: false; reason: string };

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB final-file cap (plan §1.4)

export function scanArtifact(html: string): ScanResult {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_BYTES) {
    return { ok: false, reason: `oversized artifact (${bytes} bytes > 2MB)` };
  }

  const lower = html.toLowerCase();

  // meta-refresh redirect to an external URL
  if (/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=\s*https?:/i.test(html)) {
    return { ok: false, reason: "external meta-refresh redirect" };
  }

  // remote script/style/iframe sources (must be self-contained per the contract)
  if (/<script[^>]+src=["']?\s*https?:/i.test(html)) {
    return { ok: false, reason: "remote <script src> (not self-contained)" };
  }
  if (/<link[^>]+href=["']?\s*https?:\/\//i.test(html) && /rel=["']?stylesheet/i.test(html)) {
    return { ok: false, reason: "remote stylesheet (not self-contained)" };
  }

  // network egress attempts — CSP blocks these, but flag for review anyway
  for (const probe of ["fetch(", "xmlhttprequest", "navigator.sendbeacon", "websocket(", "eventsource("]) {
    if (lower.includes(probe)) {
      return { ok: false, reason: `network egress attempt (${probe})` };
    }
  }

  // suspiciously large base64 blob (possible smuggled payload)
  const b64 = html.match(/[A-Za-z0-9+/]{2000,}={0,2}/);
  if (b64 && b64[0].length > 200_000) {
    return { ok: false, reason: "oversized base64 blob" };
  }

  return { ok: true };
}
