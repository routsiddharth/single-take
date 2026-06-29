# CLAUDE.md

Working notes for Claude Code on **single take**. Read this first; it captures the product,
the code map, the hard invariants, and the cold-start strategy.

> **Direction change (current):** single take is pivoting to **Model A, agentic** — the
> autonomous verified one-shot — as the *main* product. `plan.md` is the build target and the
> source of truth for the architecture.
>
> **Status: the A pipeline is implemented end-to-end (plan Phases 0–8).** Prompt-only A posts
> now flow create → `building` → sandboxed build → seal gate → content-addressed bundle →
> `live`, served from `/a/[key]/[[...path]]` under the runtime CSP and rendered in
> `ArtifactFrame`. Both lanes are wired in the composer (A = build it here, default; B = post a
> link). The default build path is **`SINGLETAKE_FAKE_BUILD=1`** (a canned multi-file dist, $0,
> exercises the whole pipeline); the real agent path (`agent.ts` + `sandbox.ts`, gated on
> `ANTHROPIC_API_KEY`) and hosted-sandbox providers (Vercel/E2B) are stubbed behind flags per
> plan §3–§4. The core pipeline (fakeBuild → sealGate → putBundle → serve, incl. all seal
> negatives) is verified by `scratchpad/verify.js`; `tsc --noEmit` is clean.
>
> **Local toolchain note:** this repo needs **Node ≥18.18** (Next 15 + better-sqlite3 11).
> `next dev`/`next build`/`db:seed` will not run on older Node. `tsx` (the seed runner) pulls an
> esbuild binary whose postinstall can fail; `npm install --ignore-scripts` is enough for `tsc`.

---

## What single take is

> Post one prompt. A coding agent builds it, alone, in one unbroken session. We freeze
> whatever it made and host it forever. Upvote the best.

A global feed of AI prompts and what they built. The hero is always **one prompt** (≤ 300 chars,
verbatim — **nothing gets edited**). Two lanes produce a post:

- **Model A — the verified one-shot (primary, the hero).** The user posts a prompt; the server
  hands it to an **autonomous coding agent (Claude Code, via the Agent SDK) running in an
  isolated sandbox**, which spends ~5–20 min building a real, multi-file, **self-contained static
  web app**. We **seal that build into an immutable, content-addressed bundle** and serve it in a
  locked-down iframe. `verified=1`, real provenance (model, tokens, turns, cost, build time).
  This is the credibility tier — the thing crossposts can't prove.
- **Model B — post the link (secondary, the on-ramp).** Already made something elsewhere? Post
  the prompt + a **result link** + the **model** it was made with (fixed roster, not free text).
  Instant, free, model-agnostic, crosspostable. `verified=0`. This is the volume tier.

The **single take** principle is identical for both: *one prompt → one frozen record, no human
iteration.* For A, the agent iterating on its **own** output is not a retry (a retry is a *human*
asking again) — an autonomous session left alone with one prompt is the *purest* single take.
**The process** can be a 20-min tool-calling build; **the output** must be a static, immutable
bundle. That split is the whole design — see `plan.md`.

> Project history: this is the second pivot. The original spec was A ("we generate and host the
> artifact") → it pivoted to B ("just the prompt + a link") when the agentic build wasn't yet
> feasible → it is now pivoting **back to A**, done properly as an autonomous sandboxed build,
> with B kept as the secondary lane. The old B-first migration doc was replaced by the current
> `plan.md`.

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
- **The A build pipeline** (`src/lib/generation/*`, being relit): an **autonomous agent build**
  driven by `@anthropic-ai/claude-agent-sdk` (`query()`), running inside a **per-job ephemeral
  microVM sandbox** (Vercel Sandbox in prod / E2B alt / Claude Code's built-in sandbox locally),
  gated by a deterministic server-side **seal step**, then stored as a **content-addressed
  bundle** and served CSP-locked from `/a/[key]`. See `plan.md` §2–§5.

Commands: `npm run dev`, `npm run db:seed`, `npm run db:push`, `npm run build`.
Env: see `.env.example` — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI`
for Google sign-in, `SINGLETAKE_SESSION_SECRET`, `SINGLETAKE_DB`. **`.env` is gitignored —
never commit secrets.** A-pipeline env (as it lands): `ANTHROPIC_API_KEY` (billed to the API
account; no interactive login), `SINGLETAKE_GEN_MODEL` (default `claude-sonnet-4-6`),
`SINGLETAKE_MOD_MODEL` (default `claude-haiku-4-5`), `SINGLETAKE_MAX_TURNS`, the sandbox
provider/keys, and `SINGLETAKE_FAKE_BUILD=1` (the zero-cost skeleton — see `plan.md` Phase 0).

---

## Code map

### Routes / pages (`src/app`)
- `page.tsx` — the feed (home). `p/[slug]/page.tsx` — a post. `u/[handle]/page.tsx` — profile.
- `generate/page.tsx` — the verified one-shot. **Target:** the A composer (today: "coming soon").
- `about/page.tsx` — the rules.
- `auth/signin/page.tsx` (magic link / Google), `auth/handle/page.tsx` (pick a handle).
- `a/[key]/route.ts` — the artifact server (CSP-locked, content-addressed). **A.** Being
  generalized from one HTML file → a sealed multi-file **bundle** (`/a/[key]/*path`, see `plan.md` §5).
- `api/` route handlers:
  - `posts/route.ts` — create a post. **Target:** branches by lane — **A** inserts `building` +
    a `generation_jobs` row + `enqueue()` the worker; **B** inserts `live` (link + model, no
    worker). *Currently:* B insert only.
  - `posts/[slug]/vote`, `posts/[slug]/comments`, `feed/route.ts`, `comments/[id]/vote`,
    `reports/route.ts`.
  - `auth/email` (magic-link entry), `auth/google` + `auth/google/callback` (OAuth),
    `auth/handle` (claim handle for a pending identity), `auth/logout`.
  - `posts/[slug]/events` (SSE) — the live "watch it build" hatch. **A.** Reused for status;
    being extended to also stream the build log.

### Components (`src/components`)
`chrome` exports the shared shell: `Ticker` (seamless marquee), `Masthead`, `Nav`,
`SortTabs` (hot/new/top), `ModeSwitch` (A: build it here / B: post a link), `Footer`. Plus
`Composer` (mode-aware: A = prompt only; B = prompt + result link + model select), `LotCard`,
`LotActions`, `PostActions`, `VoteWidget`, `CommentSection`, `PromptText`, `SignInForm`,
`HandleForm`, `LogoutButton`. **A render path:** `ArtifactFrame` (sandboxed iframe),
`HatchWatcher` (SSE hatch), `vignettes` (building/failed states).

### Lib (`src/lib`)
- `auth.ts` — session + `pending`/OAuth-state cookies. `google.ts` — OAuth helper (no SDK).
- `models.ts` — the canonical "made with" roster (B validates against it). `ranking.ts`,
  `queries.ts`, `format.ts`, `ids.ts`.
- `generation/*` — **the A build pipeline** (was dormant, now the active build target):
  - `worker.ts` — job-claim CAS, terminal-state handling, publish CAS, `enqueue()`, zombie
    sweeper. **Kept; only `runJob`'s middle changes** (single API call → sandboxed agent build).
  - `prompt.ts` — the build contract / system prompt (rewriting from "emit one HTML file" → the
    agentic static-bundle brief). `events.ts` — in-process bus → SSE.
  - `scan.ts`, `store.ts` — **being reworked:** scan goes tree-wide; `putArtifact(html)` →
    `putBundle(dir)` (Merkle, content-addressed tree).
  - **New (per `plan.md`):** `agent.ts` (Agent-SDK `query()` engine), `sandbox.ts` (provider
    interface: Vercel Sandbox / E2B / local), `seal.ts` (static-only seal gate).
  - `generate.ts`/`stub.ts` — the old single-call generator + offline stub. The stub stays as
    the basis of `SINGLETAKE_FAKE_BUILD` (zero-cost pipeline testing).
- `quota.ts` — **active:** the 1-build/day cap is A's primary spend throttle.

### Data (`src/db`)
`schema.ts`, `ddl.ts`, `index.ts` (db handle), `seed.ts` (sample feed; **gitignored**).
Tables: `users`, `posts`, `votes`, `comments`, `comment_votes`, `reports`, `generation_jobs`
(`UNIQUE(post_id)` = the one-shot CAS). `posts` carries both lanes: A columns (`artifact_key`
= bundle manifest hash, `model_id`, `tokens_in/out`, `generation_ms`, `og_image_key`,
`prompt_version`, `error_kind`/`error_detail`, `verified`) and B columns (`result_url`,
`result_image`, `tool`). New A provenance columns landing per `plan.md` §7: `build_turns`,
`cost_usd`, `bundle_bytes`, `file_count`.

---

## Hard invariants — do not break

1. **The prompt is the record.** A post's prompt is verbatim and permanent. There is no edit or
   delete endpoint for it; posts can only be `removed` (tombstoned).
2. **One shot, no human iteration.** For A, the human types one prompt and never touches it
   again; the agent's one autonomous session is the take. No re-prompting, no human edits to the
   build. For B, the prompt is frozen as typed. (A retry is a *human* asking again — that's what's
   forbidden; the agent fixing its own build mid-session is not.)
3. **Post status:** `building | live | failed | blocked | removed`. A builds move
   `building → live/failed/blocked`; B posts are born `live`. Failed single-takes **stay up**
   with their epitaph — they're content, not errors.
4. **A's output is a sealed, static, self-contained, immutable bundle.** Enforced by the
   server-side **seal gate** (static-only + tree-wide no-egress scan + size budget), not by
   trusting the model. Served content-addressed and CSP-locked (`connect-src` never reaches the
   open network). A build that needs a server / DB / login / live API / multiplayer **fails the
   gate** — that's the boundary, and it's what keeps artifacts safe and immutable.
5. **Untrusted build code runs only in an isolated sandbox.** The agent executes
   model-generated shell commands (`npm install` of arbitrary packages) — that MUST happen in a
   per-job ephemeral microVM with controlled egress, torn down after sealing. Never run the agent
   unsandboxed on the app host. `permissionMode: "bypassPermissions"` is safe *only* inside the
   sandbox.
6. **B requires result link + model;** A is prompt-only. Validate at both edges (composer gating +
   `api/posts` Zod): B's `result_url` is a URL and `tool ∈ models.ts`; A takes only the prompt.
7. **hot_rank is write-time only.** Computed on every vote; never recompute at read time.
8. **Vote integrity.** `votes` PK `(user_id, post_id)`; denormalized `score` + `hot_rank` updated
   in one transaction with karma.
9. **Auth: own the users table.** Sessions are HMAC-signed cookies. A verified-but-handle-less
   identity lives in a short-lived `pending` cookie until the handle step creates the user. Match
   Google accounts by `google_id` or email; link `google_id` to a pre-existing user.
10. **The one-shot CAS holds.** `generation_jobs.UNIQUE(post_id)` + the atomic job claim + the
    `WHERE … AND status='building'` publish guard ensure two runners can never both build/publish
    a post. Don't weaken them.

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
   return. Highest leverage, and a natural fit for A (one daily prompt, everyone's one shot at it).
2. **Hall of Fame / Best** curated from on-platform posts (seeds aspiration, compounds).
3. **Shareable result + OG cards** as the viral loop — A's sealed artifact + render screenshot
   is the shareable.
4. **Distribute where the format lands** (AI-twitter, r/webdev, HN, Discord).

---

## Conventions

- Match surrounding code style; server-only modules import `"server-only"`.
- Validation with Zod at the edges; a few SQL CHECKs.
- End with `npx tsc --noEmit` clean; `npm run build` clean.
- When touching auth, preserve the session/pending-cookie model and the handle step.
- Build the A pipeline behind the seal gate — never publish an artifact that didn't pass it; never
  run the agent outside the sandbox.
- `plan.md` is the architecture source of truth; keep it and this file in sync as phases land.
