import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/db";
import { setSession, setPending, takeOAuthState } from "@/lib/auth";
import { exchangeCode } from "@/lib/google";

export const runtime = "nodejs";

/**
 * Google OAuth callback. Verifies CSRF state, exchanges the code for the
 * verified profile, then either signs in an existing account (matched by
 * google_id or email) or stashes a pending identity → /auth/handle.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = await takeOAuthState();

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/auth/signin?error=${reason}`, req.url));

  if (url.searchParams.get("error")) return fail("google_denied");
  if (!code || !state || !expected || state !== expected) return fail("state");

  try {
    const profile = await exchangeCode(code);
    if (!profile.emailVerified) return fail("unverified");

    const existing = sqlite
      .prepare(
        `SELECT id, google_id FROM users WHERE google_id = ? OR lower(email) = lower(?) LIMIT 1`,
      )
      .get(profile.sub, profile.email) as
      | { id: string; google_id: string | null }
      | undefined;

    if (existing) {
      // link the Google account to a pre-existing (e.g. magic-link) user
      if (!existing.google_id) {
        sqlite
          .prepare(`UPDATE users SET google_id = ? WHERE id = ?`)
          .run(profile.sub, existing.id);
      }
      await setSession(existing.id);
      return NextResponse.redirect(new URL("/", req.url));
    }

    await setPending({ email: profile.email, googleId: profile.sub, name: profile.name });
    return NextResponse.redirect(new URL("/auth/handle", req.url));
  } catch {
    return fail("google");
  }
}
