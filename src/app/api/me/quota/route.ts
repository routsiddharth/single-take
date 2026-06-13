import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { quotaFor } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /me/quota — drives the composer's "shots remaining" indicator (plan §6). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ signedIn: false });
  const q = quotaFor(user);
  return NextResponse.json({
    signedIn: true,
    handle: user.handle,
    shots_remaining: q.remaining,
    limit: q.limit,
    reset_at: q.resetAt,
  });
}
