import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { addComment, getComments, getPostBySlug } from "@/lib/queries";
import { uuid } from "@/lib/ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  body: z
    .string()
    .trim()
    .min(1, "say something")
    .refine((s) => [...s].length <= 1000, "1000 character limit"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await currentUser();
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return NextResponse.json({ error: "no such post" }, { status: 404 });
  const sort = (req.nextUrl.searchParams.get("sort") as "top" | "new") ?? "top";
  return NextResponse.json({ comments: getComments(post.id, user?.id, sort) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "sign in to remark" }, { status: 401 });

  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return NextResponse.json({ error: "no such post" }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid remark" },
      { status: 400 },
    );
  }

  const id = uuid();
  addComment(id, post.id, user.id, parsed.data.body);
  return NextResponse.json({
    comment: {
      id,
      body: parsed.data.body,
      score: 0,
      createdAt: Date.now(),
      isRemoved: 0,
      authorHandle: user.handle,
      authorId: user.id,
      myVote: 0,
    },
  });
}
