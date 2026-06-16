# CLAUDE.md

Working notes for Claude Code on **single take**. Read this first; it captures the product,
the code map, the hard invariants, and the cold-start strategy.

---

## What single take is

> Post the prompt. Link the result. Upvote the best.

A global feed of AI prompts and what they built. Every post is **one prompt** (≤ 300 chars,
verbatim — the hero), a **result link** (where the result lives — Vercel, CodePen, a tweet…),
and the **model** it was made with (chosen from a fixed list, not free text). The prompt is
the record: **nothing gets edited.** It's a creation/showcase network — model-agnostic,
instant, crosspostable from anywhere.

This is **Model B**. The project pivoted from Model A ("we generate and host the artifact")
to B ("you post the prompt + a link"). The full rationale is `plan.md`, which supersedes the
original spec. Model A survives as the **dormant `lib/generation` module** + the "verified
one-shot" coming-soon lane (`/generate`) — preserved, unwired, ready to light up later.

---

## Stack

- **Next.js 15** (App Router, React 19) — server components + route handlers.
- **SQLite via better-sqlite3 + Drizzle ORM** (`src/db/schema.ts`). uuid PKs as text,
  timestamps as epoch-ms integers.
- **Signed-cookie auth** (`src/lib/auth.ts`) — own the users table. Two paths: magic-link
  (dev stand-in, no real email sent) and hand-rolled **Google OAuth 2.0** (`src/lib/google.ts`,
  no SDK). New accounts go through a pick-a-handle step.
- **Write-time ranking** (`src/lib/ranking.ts`) — `hot_rank` computed on every vote; the feed
  is a pure cursor-paginated index scan.

Commands: `npm run dev`, `npm run db:seed`, `npm run db:push`, `npm run build`.
Env: see `.env.example` — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
for Google sign-in, `SINGLETAKE_SESSION_SECRET`, `SINGLETAKE_DB`. **`.env` is gitignored —
never commit the OAuth secret.**

---

## Code map

### Routes / pages (`src/app`)
- `page.tsx` — the feed (home). `p/[slug]/page.tsx` — a post. `u/[handle]/page.tsx` — profile.
- `generate/page.tsx` — verified one-shot "coming soon". `about/page.tsx` — the rules.
- `auth/signin/page.tsx` (magic link / Google), `auth/handle/page.tsx` (pick a handle).
- `a/[key]/route.ts` — **dormant** artifact server (CSP-locked, content-addressed; A-only).
- `api/` route handlers:
  - `posts/route.ts` (create a `live` post — B insert, no worker), `posts/[slug]/vote`,
    `posts/[slug]/comments`, `feed/route.ts`, `comments/[id]/vote`, `reports/route.ts`.
  - `auth/email` (magic-link entry), `auth/google` + `auth/google/callback` (OAuth),
    `auth/handle` (claim handle for a pending identity), `auth/logout`.
  - `posts/[slug]/events` (SSE) is **dormant** (A live-hatch).

### Components (`src/components`)
`chrome` exports the shared shell: `Ticker` (seamless marquee), `Masthead`, `Nav`,
`SortTabs` (hot/new/top), `ModeSwitch` (the feed / verified one-shot), `Footer`. Plus
`Composer` (prompt + result link + model select), `LotCard`, `LotActions`, `PostActions`,
`VoteWidget`, `CommentSection`, `PromptText`, `SignInForm`, `HandleForm`, `LogoutButton`.
**Dormant (A-only):** `ArtifactFrame`, `HatchWatcher`, `vignettes`.

### Lib (`src/lib`)
- `auth.ts` — session + `pending`/OAuth-state cookies. `google.ts` — OAuth helper (no SDK).
- `models.ts` — the canonical "made with" roster (flat list; both composer + create route
  validate against it). `ranking.ts`, `queries.ts`, `format.ts`, `ids.ts`.
- `generation/*` — **dormant**: `worker.ts` (7-step pipeline), `generate.ts`/`stub.ts`,
  `scan.ts`, `store.ts`, `events.ts`, `prompt.ts`. `quota.ts` is also dormant.

### Data (`src/db`)
`schema.ts`, `ddl.ts`, `index.ts` (db handle), `seed.ts` (sample feed; **gitignored**).
Tables: `users`, `posts`, `votes`, `comments`, `comment_votes`, `reports`,
+ dormant `generation_jobs`. `posts` has B columns (`result_url`, `result_image`, `tool`,
`verified`) + a `google_id` on `users`; the A columns stay dormant.

---

## Hard invariants — do not break

1. **The prompt is the record.** A post's prompt is verbatim and permanent. There is no edit
   or delete endpoint for it; posts can only be `removed` (tombstoned). B `status` is only
   `live` | `removed`.
2. **Result link + model are required** on every B post — validated client-side (composer
   gating) and server-side (`api/posts` Zod: `result_url` a URL, `tool` ∈ `models.ts`).
3. **hot_rank is write-time only.** Computed on every vote; never recompute at read time.
4. **Vote integrity.** `votes` PK `(user_id, post_id)`; denormalized `score` + `hot_rank`
   updated in one transaction with karma.
5. **Auth: own the users table.** Sessions are HMAC-signed cookies. A verified-but-handle-less
   identity lives in a short-lived `pending` cookie until the handle step creates the user.
   Match Google accounts by `google_id` or email; link `google_id` to a pre-existing user.
6. **A stays dormant but intact.** Don't delete `lib/generation/*`, `a/[key]`, the SSE route,
   or the A columns — they're the verified-one-shot lane. No B page imports them.

---

## Cold-start strategy (decided)

The cold-start problem is **creator** cold-start (getting people to post). Decisions:

### Do — seed content with house-account personas (the honest Reddit playbook)
- Seed the feed with a roster of **personas** posting **real prompts**, **backdated** across
  weeks so the feed reads as history. `npm run db:seed` (the persona roster + posts).
- A *light* social layer (a few votes/remarks) to show the mechanics — keep small.

### Do NOT
- **No fake aggregate metrics** — seeding *content* is fine; faking *the numbers people trust*
  (user/vote counts, testimonials) is the line.
- **Have an exit plan.** Seeding is a launch ramp; taper as real makers arrive, and never
  inject fake engagement onto real users' posts.

### Other levers (ranked, for later)
1. **Daily prompt / challenge** — kills blank-textarea paralysis, manufactures a reason to
   return. Highest leverage.
2. **Hall of Fame / Best** curated from on-platform posts (seeds aspiration, compounds).
3. **Shareable result + OG cards** as the viral loop.
4. **Distribute where the format lands** (AI-twitter, r/webdev, HN, Discord).

---

## Conventions

- Match surrounding code style; server-only modules import `"server-only"`.
- Validation with Zod at the edges; a few SQL CHECKs.
- End with `npx tsc --noEmit` clean; `npm run build` clean.
- When touching auth, preserve the session/pending-cookie model and the handle step.
- Don't wire B pages to the dormant A modules.
