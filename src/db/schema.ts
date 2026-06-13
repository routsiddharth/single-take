import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Schema mirrors plan.md §5. SQLite stand-in for Postgres/Neon:
 *  - uuid PKs  → text (we generate uuids in app code)
 *  - citext    → text + lower() unique index
 *  - timestamptz → integer epoch-ms (mode: 'timestamp_ms')
 *  - CHECK constraints enforced in app code (Zod) + a few SQL CHECKs
 */

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    handle: text("handle").notNull(), // 3-20 chars, [a-z0-9_]
    email: text("email").notNull(),
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
    googleId: text("google_id"), // OAuth subject id, nullable (links a Google account)
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    postKarma: integer("post_karma").notNull().default(0),
    commentKarma: integer("comment_karma").notNull().default(0),
    isBanned: integer("is_banned", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    uniqueIndex("users_handle_unq").on(sql`lower(${t.handle})`),
    uniqueIndex("users_email_unq").on(sql`lower(${t.email})`),
  ],
);

/** building | live | failed | blocked | removed */
export type PostStatus = "building" | "live" | "failed" | "blocked" | "removed";
/** truncation | refusal | scan | moderation | infrastructure */
export type ErrorKind =
  | "truncation"
  | "refusal"
  | "scan"
  | "moderation"
  | "infrastructure";

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(), // also the permalink slug (short base58)
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    prompt: text("prompt").notNull(), // 1..300 chars (enforced in app)
    status: text("status").notNull().default("building"),
    errorKind: text("error_kind"),
    errorDetail: text("error_detail"), // human-facing epitaph / cause of death
    artifactKey: text("artifact_key"), // sha256 content address
    ogImageKey: text("og_image_key"),
    modelId: text("model_id"), // provenance: exact model used
    promptVersion: text("prompt_version"), // provenance: system prompt version
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    generationMs: integer("generation_ms"),
    resultUrl: text("result_url"), // B: external result link (nullable)
    resultImage: text("result_image"), // B: screenshot / thumbnail url (nullable)
    tool: text("tool"), // B: "made with" label (nullable)
    verified: integer("verified", { mode: "boolean" }).notNull().default(false), // reserved for A
    score: integer("score").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    hotRank: real("hot_rank").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("posts_hot_idx").on(t.hotRank),
    index("posts_new_idx").on(t.createdAt),
    index("posts_top_idx").on(t.score, t.createdAt),
    index("posts_author_idx").on(t.authorId, t.createdAt),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    value: integer("value").notNull(), // -1 | 1
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(), // <= 1000 chars
    score: integer("score").notNull().default(0),
    isRemoved: integer("is_removed", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("comments_post_idx").on(t.postId, t.createdAt)],
);

export const commentVotes = sqliteTable(
  "comment_votes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id),
    value: integer("value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.commentId] })],
);

/** queued | running | done | failed — UNIQUE(post_id) is the one-shot constraint */
export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .unique()
      .references(() => posts.id),
    status: text("status").notNull().default("queued"),
    attempt: integer("attempt").notNull().default(0),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  reporterId: text("reporter_id").references(() => users.id),
  targetType: text("target_type").notNull(), // post | comment | user
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | actioned | dismissed
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
