import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/db";
import { currentUser } from "@/lib/auth";
import { hotRank } from "@/lib/ranking";
import { slug } from "@/lib/ids";
import { MODEL_VALUES } from "@/lib/models";

export const runtime = "nodejs";

const Body = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "a prompt is required")
    .refine((s) => [...s].length <= 300, "300 character ceiling"),
  resultUrl: z.string().url("a result link is required"),
  resultImage: z.string().url().optional(),
  // every post declares its model, chosen from the canonical roster (no free text)
  tool: z.enum(MODEL_VALUES as [string, ...string[]], {
    message: "pick the model it was made with",
  }),
});

// In-memory idempotency cache: a double-clicked "post it" returns the same post
// rather than creating two. Dev single-process.
const idem = new Map<string, string>();

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "sign in to post" },
      { status: 401 },
    );
  }
  if (user.isBanned) {
    return NextResponse.json({ error: "you are banned" }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid prompt" },
      { status: 400 },
    );
  }
  const { prompt, resultUrl, resultImage, tool } = parsed.data;

  const idemKey = req.headers.get("idempotency-key");
  if (idemKey) {
    const existing = idem.get(`${user.id}:${idemKey}`);
    if (existing) {
      return NextResponse.json({ post: { id: existing, status: "live" } });
    }
  }

  const postId = slug();
  const created = Date.now();

  sqlite.prepare(
    `INSERT INTO posts (id, author_id, prompt, status, result_url, result_image, tool, verified, score, comment_count, hot_rank, created_at)
     VALUES (?,?,?,'live',?,?,?,0,0,0,?,?)`,
  ).run(postId, user.id, prompt, resultUrl ?? null, resultImage ?? null, tool ?? null, hotRank(0, created), created);

  if (idemKey) idem.set(`${user.id}:${idemKey}`, postId);

  return NextResponse.json({ post: { id: postId, status: "live" } });
}
