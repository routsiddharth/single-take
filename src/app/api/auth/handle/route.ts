import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/db";
import { setSession, getPending, clearPending } from "@/lib/auth";
import { uuid } from "@/lib/ids";

export const runtime = "nodejs";

/**
 * Finish sign-up: a verified-but-handle-less identity (the pending cookie) picks
 * its permanent handle. Creates the user, links Google if present, signs in.
 */
const Body = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "3–20 chars, a–z 0–9 _ only"),
});

export async function POST(req: NextRequest) {
  const pending = await getPending();
  if (!pending) {
    return NextResponse.json(
      { error: "your sign-in expired — start again" },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid handle" },
      { status: 400 },
    );
  }
  const { handle } = parsed.data;

  const taken = sqlite
    .prepare(`SELECT id FROM users WHERE lower(handle)=lower(?)`)
    .get(handle) as { id: string } | undefined;
  if (taken) {
    return NextResponse.json(
      { error: "that handle is taken — the wall is permanent" },
      { status: 409 },
    );
  }

  // Guard the rare race where this email got an account in another tab.
  const emailClash = sqlite
    .prepare(`SELECT id FROM users WHERE lower(email)=lower(?)`)
    .get(pending.email) as { id: string } | undefined;
  if (emailClash) {
    await clearPending();
    await setSession(emailClash.id);
    return NextResponse.json({ next: "/" });
  }

  const id = uuid();
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO users (id, handle, email, email_verified_at, google_id, created_at) VALUES (?,?,?,?,?,?)`,
    )
    .run(id, handle, pending.email, now, pending.googleId ?? null, now);

  await clearPending();
  await setSession(id);
  return NextResponse.json({ next: "/" });
}
