import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { castVote, getPostBySlug } from "@/lib/queries";

export const runtime = "nodejs";

const Body = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

/** PUT /posts/:slug/vote — upsert + score delta + hot_rank recompute, one tx. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in to vote" }, { status: 401 });

  // votes require accounts >= 1h old (plan §2.4 integrity)
  if (Date.now() - user.createdAt.getTime() < 3_600_000) {
    return NextResponse.json(
      { error: "new accounts can't vote for the first hour" },
      { status: 403 },
    );
  }

  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return NextResponse.json({ error: "no such post" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad value" }, { status: 400 });

  castVote(user.id, post.id, parsed.data.value);
  const fresh = getPostBySlug(slug, user.id)!;
  return NextResponse.json({ score: fresh.score, myVote: fresh.myVote });
}
