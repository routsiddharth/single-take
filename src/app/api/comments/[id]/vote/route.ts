import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { castCommentVote } from "@/lib/queries";

export const runtime = "nodejs";

const Body = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in to vote" }, { status: 401 });
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad value" }, { status: 400 });
  castCommentVote(user.id, id, parsed.data.value);
  return NextResponse.json({ ok: true });
}
