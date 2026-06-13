import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/db";
import { setSession } from "@/lib/auth";
import { uuid } from "@/lib/ids";

export const runtime = "nodejs";

/**
 * Dev "claim a handle" sign-in (stands in for Auth.js magic-link, plan §3.1).
 * In production this would email a magic link + Turnstile; locally we claim the
 * handle and set a signed session cookie so the loop is runnable end to end.
 * Re-claiming an existing handle with its email signs you back in.
 */
const Body = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "3–20 chars, a–z 0–9 _ only"),
  email: z.string().trim().email("a real-looking email, please"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid" },
      { status: 400 },
    );
  }
  const { handle, email } = parsed.data;

  const existing = sqlite
    .prepare(`SELECT id, email FROM users WHERE lower(handle)=lower(?)`)
    .get(handle) as { id: string; email: string } | undefined;

  if (existing) {
    if (existing.email.toLowerCase() !== email) {
      return NextResponse.json(
        { error: "that handle is taken — the wall is permanent" },
        { status: 409 },
      );
    }
    await setSession(existing.id);
    return NextResponse.json({ handle, returning: true });
  }

  const emailClash = sqlite
    .prepare(`SELECT id FROM users WHERE lower(email)=lower(?)`)
    .get(email) as { id: string } | undefined;
  if (emailClash) {
    return NextResponse.json(
      { error: "that email already has an account" },
      { status: 409 },
    );
  }

  const id = uuid();
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO users (id, handle, email, email_verified_at, created_at) VALUES (?,?,?,?,?)`,
    )
    .run(id, handle, email, now, now);
  await setSession(id);
  return NextResponse.json({ handle, returning: false });
}
