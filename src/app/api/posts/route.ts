import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { sqlite } from "@/db";
import { currentUser } from "@/lib/auth";
import { hotRank } from "@/lib/ranking";
import { slug } from "@/lib/ids";
import { MODEL_VALUES } from "@/lib/models";
import { quotaFor } from "@/lib/quota";
import { enqueue } from "@/lib/generation/worker";

export const runtime = "nodejs";

/**
 * Create a post (plan §10). Two lanes share the posts table:
 *
 *  - Model A (verified one-shot): body is `{ prompt }` only. We check the A
 *    build quota, insert `status='building', verified=1`, insert a queued
 *    `generation_jobs` row (UNIQUE(post_id) is the one-shot CAS), and enqueue
 *    the worker. Returns immediately with status 'building'.
 *  - Model B (post a link): body is `{ prompt, resultUrl, resultImage?, tool }`.
 *    Born `status='live', verified=0`. No build job, no A quota spend.
 *
 * The lane is inferred from the body: a `resultUrl` means B, otherwise A.
 */

const promptField = z
  .string()
  .trim()
  .min(1, "a prompt is required")
  .refine((s) => [...s].length <= 300, "300 character ceiling");

const ASchema = z.object({
  prompt: promptField,
  lane: z.literal("a").optional(),
});

const BSchema = z.object({
  prompt: promptField,
  lane: z.literal("b").optional(),
  resultUrl: z.string().url("a result link is required"),
  resultImage: z.string().url().optional(),
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
    return NextResponse.json({ error: "sign in to post" }, { status: 401 });
  }
  if (user.isBanned) {
    return NextResponse.json({ error: "you are banned" }, { status: 403 });
  }

  const json = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json || typeof json !== "object") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  // Lane B when a result link is supplied (or lane explicitly "b"); else A.
  const isB = json.lane === "b" || (json.lane !== "a" && "resultUrl" in json);
  const idemKey = req.headers.get("idempotency-key");

  if (isB) {
    const parsed = BSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "invalid post" },
        { status: 400 },
      );
    }
    const { prompt, resultUrl, resultImage, tool } = parsed.data;

    if (idemKey) {
      const existing = idem.get(`${user.id}:${idemKey}`);
      if (existing) return NextResponse.json({ post: { id: existing, status: "live" } });
    }

    const postId = slug();
    const created = Date.now();
    sqlite
      .prepare(
        `INSERT INTO posts (id, author_id, prompt, status, result_url, result_image, tool, verified, score, comment_count, hot_rank, created_at)
         VALUES (?,?,?,'live',?,?,?,0,0,0,?,?)`,
      )
      .run(postId, user.id, prompt, resultUrl, resultImage ?? null, tool, hotRank(0, created), created);

    if (idemKey) idem.set(`${user.id}:${idemKey}`, postId);
    return NextResponse.json({ post: { id: postId, status: "live" } });
  }

  // ── Lane A: the verified one-shot ──────────────────────────────────────────
  const parsed = ASchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid prompt" },
      { status: 400 },
    );
  }
  const { prompt } = parsed.data;

  if (idemKey) {
    const existing = idem.get(`${user.id}:${idemKey}`);
    if (existing) return NextResponse.json({ post: { id: existing, status: "building" } });
  }

  // A build quota (one shot per UTC day; failed/blocked/live all count).
  const quota = quotaFor(user);
  if (quota.remaining <= 0) {
    return NextResponse.json(
      {
        error: "you've used your build today — one shot per day",
        resetAt: quota.resetAt,
      },
      { status: 429 },
    );
  }

  const postId = slug();
  const created = Date.now();

  // Insert post + job atomically so the one-shot CAS (UNIQUE(post_id)) holds.
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO posts (id, author_id, prompt, status, verified, score, comment_count, hot_rank, created_at)
         VALUES (?,?,?,'building',1,0,0,?,?)`,
      )
      .run(postId, user.id, prompt, hotRank(0, created), created);
    sqlite
      .prepare(`INSERT INTO generation_jobs (id, post_id, status) VALUES (?,?,'queued')`)
      .run(crypto.randomUUID(), postId);
  });
  tx();

  if (idemKey) idem.set(`${user.id}:${idemKey}`, postId);

  // Fire-and-forget the build worker.
  enqueue(postId);

  return NextResponse.json({ post: { id: postId, status: "building" } });
}
