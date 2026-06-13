import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { posts, type User } from "@/db/schema";

export const FULL_SHOTS = 1; // one shot per person per day
export const NEW_ACCOUNT_SHOTS = 1; // same for new accounts

/** Epoch-ms at the start of the current UTC day. Quota resets at 00:00 UTC. */
export function utcDayStart(now = Date.now()): number {
  return Math.floor(now / 86_400_000) * 86_400_000;
}

export function nextUtcReset(now = Date.now()): number {
  return utcDayStart(now) + 86_400_000;
}

export function dailyLimit(user: User, now = Date.now()): number {
  const ageMs = now - user.createdAt.getTime();
  return ageMs < 86_400_000 ? NEW_ACCOUNT_SHOTS : FULL_SHOTS;
}

export type Quota = {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
};

/** Today's usage for a user. Counts every post made this UTC day (a roll is a
 *  roll — building/live/failed/blocked all spend the shot, per plan §1.5). */
export function quotaFor(user: User, now = Date.now()): Quota {
  const dayStart = utcDayStart(now);
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(posts)
    .where(
      and(
        eq(posts.authorId, user.id),
        gte(posts.createdAt, new Date(dayStart)),
      ),
    )
    .get();
  const used = row?.c ?? 0;
  const limit = dailyLimit(user, now);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: nextUtcReset(now),
  };
}
