import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/db";
import { setSession, setPending } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Magic-link entry (dev stand-in). In production this would email a one-time
 * link; locally we accept the email and move the flow forward without sending
 * one. Returning emails sign straight in; new emails go pick a handle.
 */
const Body = z.object({
  email: z.string().trim().email("a real-looking email, please"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid email" },
      { status: 400 },
    );
  }
  const { email } = parsed.data;

  const existing = sqlite
    .prepare(`SELECT id FROM users WHERE lower(email)=lower(?)`)
    .get(email) as { id: string } | undefined;

  if (existing) {
    await setSession(existing.id);
    return NextResponse.json({ next: "/" });
  }

  await setPending({ email });
  return NextResponse.json({ next: "/auth/handle" });
}
