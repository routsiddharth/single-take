import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { setOAuthState } from "@/lib/auth";
import { isGoogleConfigured, buildAuthUrl } from "@/lib/google";

export const runtime = "nodejs";

/** Kick off Google OAuth: set a CSRF state cookie, redirect to consent. */
export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/auth/signin?error=google_unconfigured", req.url));
  }
  const state = crypto.randomBytes(16).toString("hex");
  await setOAuthState(state);
  return NextResponse.redirect(buildAuthUrl(state));
}
