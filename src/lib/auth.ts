import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

const COOKIE = "singletake_session";
const PENDING = "singletake_pending"; // verified identity awaiting a handle
const OAUTH_STATE = "singletake_oauth_state"; // CSRF guard for the Google round-trip
const SECRET =
  process.env.SINGLETAKE_SESSION_SECRET ?? "dev-only-insecure-secret-change-me";

/**
 * Dev-grade signed-cookie session. Stands in for Auth.js magic-link in
 * plan §3.1 — same "own the users table" model, runnable without email infra.
 * Payload is just the user id, HMAC-signed so it can't be forged client-side.
 */
function sign(value: string): string {
  const mac = crypto
    .createHmac("sha256", SECRET)
    .update(value)
    .digest("base64url");
  return `${value}.${mac}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const value = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(value)
    .digest("base64url");
  // timing-safe compare
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Pending sign-in: a verified email (and, for Google, the OAuth subject + name)
 * captured *before* the user has chosen a handle. Stored in its own short-lived
 * signed cookie so the "pick your handle" page can finish account creation.
 */
export type PendingAuth = { email: string; googleId?: string; name?: string };

export async function setPending(data: PendingAuth): Promise<void> {
  const jar = await cookies();
  const value = Buffer.from(JSON.stringify(data)).toString("base64url");
  jar.set(PENDING, sign(value), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15, // 15 minutes to pick a handle
  });
}

export async function getPending(): Promise<PendingAuth | null> {
  const jar = await cookies();
  const value = verify(jar.get(PENDING)?.value);
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString()) as PendingAuth;
  } catch {
    return null;
  }
}

export async function clearPending(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING);
}

/** Set/read/clear the one-shot CSRF state for the Google OAuth redirect. */
export async function setOAuthState(state: string): Promise<void> {
  const jar = await cookies();
  jar.set(OAUTH_STATE, sign(state), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

export async function takeOAuthState(): Promise<string | null> {
  const jar = await cookies();
  const value = verify(jar.get(OAUTH_STATE)?.value);
  jar.delete(OAUTH_STATE);
  return value;
}

/** Returns the signed-in user, or null. Cached per request via React cache. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value);
  if (!userId) return null;
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  return row ?? null;
}
