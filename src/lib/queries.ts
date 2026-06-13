import "server-only";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { posts, users, votes, comments, commentVotes } from "@/db/schema";
import { hotRank } from "@/lib/ranking";

export type Sort = "hot" | "new" | "top";
export type Window = "day" | "week" | "all";

export type FeedPost = {
  id: string;
  prompt: string;
  status: string;
  errorKind: string | null;
  errorDetail: string | null;
  artifactKey: string | null;
  modelId: string | null;
  tokensOut: number | null;
  generationMs: number | null;
  resultUrl: string | null;
  resultImage: string | null;
  tool: string | null;
  verified: boolean;
  score: number;
  commentCount: number;
  createdAt: number;
  authorHandle: string;
  authorId: string;
  myVote: number; // -1 | 0 | 1
};

const PAGE = 25;

function windowFloor(w: Window): number {
  if (w === "day") return Date.now() - 86_400_000;
  if (w === "week") return Date.now() - 7 * 86_400_000;
  return 0;
}

/** Cursor-paginated feed (plan §2.4). Pure index scan, never OFFSET. */
export function getFeed(opts: {
  sort: Sort;
  window?: Window;
  cursor?: string | null;
  viewerId?: string | null;
  authorHandle?: string;
}): { items: FeedPost[]; nextCursor: string | null } {
  const { sort, window = "all", cursor, viewerId, authorHandle } = opts;

  const conds = [sql`p.status != 'removed'`];
  if (authorHandle) conds.push(sql`lower(u.handle) = lower(${authorHandle})`);
  if (sort === "top" && window !== "all") {
    conds.push(sql`p.created_at >= ${windowFloor(window)}`);
  }

  let orderBy = sql`p.hot_rank DESC`;
  if (sort === "new") orderBy = sql`p.created_at DESC`;
  if (sort === "top") orderBy = sql`p.score DESC, p.created_at DESC`;

  if (cursor) {
    const c = decodeCursor(cursor);
    if (c) {
      if (sort === "hot") conds.push(sql`p.hot_rank < ${c.v}`);
      else if (sort === "new") conds.push(sql`p.created_at < ${c.v}`);
      else conds.push(sql`(p.score < ${c.v} OR (p.score = ${c.v} AND p.created_at < ${c.t}))`);
    }
  }

  const where = sql.join(conds, sql` AND `);
  const rows = db.all<FeedRow>(sql`
    SELECT p.id, p.prompt, p.status, p.error_kind AS errorKind, p.error_detail AS errorDetail,
           p.artifact_key AS artifactKey, p.model_id AS modelId, p.tokens_out AS tokensOut,
           p.generation_ms AS generationMs, p.result_url AS resultUrl, p.result_image AS resultImage,
           p.tool, p.verified, p.score, p.comment_count AS commentCount,
           p.created_at AS createdAt, p.hot_rank AS hotRank, p.author_id AS authorId,
           u.handle AS authorHandle,
           COALESCE(v.value, 0) AS myVote
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN votes v ON v.post_id = p.id AND v.user_id = ${viewerId ?? ""}
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${PAGE + 1}
  `);

  const items = rows.slice(0, PAGE).map(toFeedPost);
  let nextCursor: string | null = null;
  if (rows.length > PAGE) {
    const last = rows[PAGE - 1];
    if (sort === "hot") nextCursor = encodeCursor({ v: last.hotRank });
    else if (sort === "new") nextCursor = encodeCursor({ v: last.createdAt });
    else nextCursor = encodeCursor({ v: last.score, t: last.createdAt });
  }
  return { items, nextCursor };
}

type FeedRow = {
  id: string; prompt: string; status: string; errorKind: string | null;
  errorDetail: string | null; artifactKey: string | null; modelId: string | null;
  tokensOut: number | null; generationMs: number | null; resultUrl: string | null;
  resultImage: string | null; tool: string | null; verified: boolean;
  score: number; commentCount: number; createdAt: number; hotRank: number; authorId: string;
  authorHandle: string; myVote: number;
};
function toFeedPost(r: FeedRow): FeedPost {
  const { hotRank: _h, ...rest } = r;
  return rest;
}

function encodeCursor(o: { v: number; t?: number }): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}
function decodeCursor(s: string): { v: number; t?: number } | null {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString());
  } catch {
    return null;
  }
}

export function getPostBySlug(slug: string, viewerId?: string | null): FeedPost | null {
  const rows = db.all<FeedRow>(sql`
    SELECT p.id, p.prompt, p.status, p.error_kind AS errorKind, p.error_detail AS errorDetail,
           p.artifact_key AS artifactKey, p.model_id AS modelId, p.tokens_out AS tokensOut,
           p.generation_ms AS generationMs, p.result_url AS resultUrl, p.result_image AS resultImage,
           p.tool, p.verified, p.score, p.comment_count AS commentCount,
           p.created_at AS createdAt, p.hot_rank AS hotRank, p.author_id AS authorId,
           u.handle AS authorHandle, COALESCE(v.value, 0) AS myVote
    FROM posts p JOIN users u ON u.id = p.author_id
    LEFT JOIN votes v ON v.post_id = p.id AND v.user_id = ${viewerId ?? ""}
    WHERE p.id = ${slug} LIMIT 1
  `);
  return rows[0] ? toFeedPost(rows[0]) : null;
}

/**
 * Cast/clear a vote (plan §2.4). The votes table is the source of truth; the
 * denormalized posts.score and write-time hot_rank are updated in one tx.
 */
export const castVote = sqlite.transaction((userId: string, postId: string, value: number) => {
  const prev = sqlite.prepare(`SELECT value FROM votes WHERE user_id=? AND post_id=?`).get(userId, postId) as { value: number } | undefined;
  const old = prev?.value ?? 0;
  if (value === 0) {
    sqlite.prepare(`DELETE FROM votes WHERE user_id=? AND post_id=?`).run(userId, postId);
  } else if (prev) {
    sqlite.prepare(`UPDATE votes SET value=?, created_at=(unixepoch()*1000) WHERE user_id=? AND post_id=?`).run(value, userId, postId);
  } else {
    sqlite.prepare(`INSERT INTO votes (user_id, post_id, value) VALUES (?,?,?)`).run(userId, postId, value);
  }
  const delta = value - old;
  if (delta !== 0) {
    const row = sqlite.prepare(`SELECT score, created_at, author_id FROM posts WHERE id=?`).get(postId) as { score: number; created_at: number; author_id: string };
    const newScore = row.score + delta;
    const rank = hotRank(newScore, row.created_at);
    sqlite.prepare(`UPDATE posts SET score=?, hot_rank=? WHERE id=?`).run(newScore, rank, postId);
    sqlite.prepare(`UPDATE users SET post_karma = post_karma + ? WHERE id=?`).run(delta, row.author_id);
    return newScore;
  }
  return undefined;
}) as (userId: string, postId: string, value: number) => number | undefined;

export type CommentRow = {
  id: string; body: string; score: number; createdAt: number; isRemoved: number;
  authorHandle: string; authorId: string; myVote: number;
};

export function getComments(postId: string, viewerId?: string | null, sort: "top" | "new" = "top"): CommentRow[] {
  const order = sort === "new" ? sql`c.created_at DESC` : sql`c.score DESC, c.created_at DESC`;
  return db.all<CommentRow>(sql`
    SELECT c.id, c.body, c.score, c.created_at AS createdAt, c.is_removed AS isRemoved,
           u.handle AS authorHandle, c.author_id AS authorId, COALESCE(v.value,0) AS myVote
    FROM comments c JOIN users u ON u.id = c.author_id
    LEFT JOIN comment_votes v ON v.comment_id = c.id AND v.user_id = ${viewerId ?? ""}
    WHERE c.post_id = ${postId}
    ORDER BY ${order}
  `);
}

export const addComment = sqlite.transaction((id: string, postId: string, authorId: string, body: string) => {
  sqlite.prepare(`INSERT INTO comments (id, post_id, author_id, body) VALUES (?,?,?,?)`).run(id, postId, authorId, body);
  sqlite.prepare(`UPDATE posts SET comment_count = comment_count + 1 WHERE id=?`).run(postId);
}) as (id: string, postId: string, authorId: string, body: string) => void;

export const castCommentVote = sqlite.transaction((userId: string, commentId: string, value: number) => {
  const prev = sqlite.prepare(`SELECT value FROM comment_votes WHERE user_id=? AND comment_id=?`).get(userId, commentId) as { value: number } | undefined;
  const old = prev?.value ?? 0;
  if (value === 0) sqlite.prepare(`DELETE FROM comment_votes WHERE user_id=? AND comment_id=?`).run(userId, commentId);
  else if (prev) sqlite.prepare(`UPDATE comment_votes SET value=? WHERE user_id=? AND comment_id=?`).run(value, userId, commentId);
  else sqlite.prepare(`INSERT INTO comment_votes (user_id, comment_id, value) VALUES (?,?,?)`).run(userId, commentId, value);
  const delta = value - old;
  if (delta !== 0) {
    const row = sqlite.prepare(`SELECT author_id FROM comments WHERE id=?`).get(commentId) as { author_id: string };
    sqlite.prepare(`UPDATE comments SET score = score + ? WHERE id=?`).run(delta, commentId);
    sqlite.prepare(`UPDATE users SET comment_karma = comment_karma + ? WHERE id=?`).run(delta, row.author_id);
  }
}) as (userId: string, commentId: string, value: number) => void;

export function getUserByHandle(handle: string) {
  return db.select().from(users).where(sql`lower(${users.handle}) = lower(${handle})`).get() ?? null;
}

export function profileStats(authorId: string) {
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS prompts,
      MAX(score) AS best
    FROM posts WHERE author_id=? AND status != 'removed'
  `).get(authorId) as { prompts: number; best: number | null };
  return row;
}

export { eq, and, desc, gt, lt };
