# single take — Migration Plan: "B-first"

> **Post the prompt. Link the result if you've got it. Upvote the best.**
>
> This plan pivots single take from *"we generate and host the artifact"* (**Model A**) to
> *"you post the prompt + a link to wherever the result lives"* (**Model B**). B is far cheaper,
> instant, model-agnostic, and crosspostable from X. A becomes a **future, gated sub-feature**
> ("verified one-shot") behind a *Coming soon* page.
>
> The original Model-A spec (generation pipeline, hosted immutable artifacts, the one-shot
> constraint) is preserved in git history and lives on as the **dormant `lib/generation` module** —
> it is not deleted, just unwired. This document supersedes the old `plan.md` as the build target.

---

## 0. Why this pivot

| | A — host it (old plan) | **B — just the prompt (this plan)** |
|---|---|---|
| Build effort | hard (worker, sandbox, scan, quota, cost ledger) | **small** — reuses the existing social layer |
| Marginal cost | dollars→cents per post | **~zero** (no API spend, no hosting) |
| Cold start / distribution | supply must be generated in-house | **crosspost from X/Reddit/anywhere** |
| Model-agnostic | locked to one pipeline | **any tool** (Claude, GPT, v0, Midjourney…) |
| Latency | seconds→minutes | **instant** |
| The one-shot constraint | enforced + provable | **not enforceable** → becomes A's "verified" badge |

**Strategy:** B is the substrate (volume, virality, free). A is the credibility layer (verified
one-shot, real provenance) — shipped later when there are API credits. The feed fills from B;
the brand integrity lives in A's future verified lane.

---

## 1. The new unit: a B post

A post is now **a prompt + optional result pointer**. The prompt stays the hero (the Newsreader
placard); the result is a link/image card beside it.

| Field | Required | Notes |
|---|---|---|
| `prompt` | ✅ | ≤ 300 chars, verbatim. The post body. The hero. |
| `result_url` | ❌ | Where the result lives — a Vercel/v0 link, a tweet, a Claude share link, a CodePen, etc. |
| `result_image` | ❌ | A screenshot/thumbnail URL (or, later, an uploaded image). Drives the preview. |
| `tool` | ❌ | Free-text "made with" label (`Claude`, `v0`, `GPT-5`, `Midjourney`). Replaces the provenance "medium line". |
| `verified` | — | Reserved for A. Always `false`/`0` for B. The future "generated here, real one-shot" stamp. |

**We do not iframe `result_url`** — external sites are unsafe to embed and most block framing.
B renders either the `result_image` (`<img>`) or a link card ("open result ↗" + domain). The
sandboxed-iframe path (`ArtifactFrame` + `/a/[key]`) is **A-only**, dormant.

### Locked decisions
1. **No posting quota for B.** The "1 shot/day" was a *generation-cost* device; B is free. (Light
   per-minute anti-spam can come later.) → remove the shots/quota UI.
2. **`result_url` is optional.** Prompt-only posts are allowed; this is what makes
   crossposting-from-X frictionless.
3. **Keep the `single take` name + visual design.** Reframe copy away from "one shot / no retries /
   failures stay" (those are A) toward the B model. The verified one-shot becomes the coming-soon badge.

---

## 2. What's deleted vs parked

**Deleted (B has no concept of these):**
- Generation states `building` / `failed` / `blocked` and all their rendering.
- Tombstone / grave / "survival rate" / "failures stay on the wall".
- The profile career form-guide (calendar) and the "house · regular" stamp.
- The shots/quota indicator and "now building" counters.
- SSE "hatch" wiring on B pages.

**Parked — kept in the tree, unimported by B, ready to light up for A:**
- `lib/generation/*` — `worker.ts`, `generate.ts`, `stub.ts`, `scan.ts`, `store.ts`, `events.ts`, `prompt.ts`.
- `app/a/[key]/route.ts` (artifact serving), `app/api/posts/[slug]/events/route.ts` (SSE).
- `components/ArtifactFrame.tsx`, `components/HatchWatcher.tsx`, `components/vignettes.tsx`.
- `lib/quota.ts`, the `generation_jobs` table, the A columns on `posts`, the `verified` flag.

Status post-migration: `posts.status` for B is only `live` | `removed`.

---

## 3. Phased execution

Each phase is independently committable. Order matters (schema first). End with `npx tsc --noEmit`.

### Phase 1 — Data model
**Files:** `src/db/schema.ts`, `src/db/ddl.ts`, `src/lib/queries.ts`, `src/db/seed.ts`

- **`schema.ts` / `ddl.ts`** — add B columns to `posts` (keep all A columns dormant):
  ```
  result_url    text            -- external result link (nullable)
  result_image  text            -- screenshot / thumbnail url (nullable)
  tool          text            -- "made with" label (nullable)
  verified      integer bool default 0   -- reserved for A
  ```
  Add the same columns to the raw `SCHEMA_SQL` in `ddl.ts` (used by seed + first-run boot).
  Leave `generation_jobs`, `artifact_key`, `model_id`, `tokens_*`, `generation_ms`, `error_*`,
  `og_image_key`, `prompt_version` in place — dormant.
- **`queries.ts`:**
  - `FeedPost`: add `resultUrl`, `resultImage`, `tool`, `verified`; keep A fields nullable.
  - `getFeed` / `getPostBySlug`: SELECT the new columns.
  - `profileStats`: rewrite to `{ prompts, best }` — `COUNT(*)` of non-removed posts + `MAX(score)`.
    Drop `survived` / `failed` / `building`.
- **`seed.ts`:** seed B rows (prompt + `result_url`/`result_image`/`tool`, all `status='live'`).
  Remove the `failed`/`building` seed rows and the `generation_jobs` inserts. (seed.ts is gitignored
  but still drives `npm run db:seed`.)

> Schema changes recreate the throwaway `data/` DB. Reseed so the feed isn't empty.

### Phase 2 — Post creation + composer
**Files:** `src/app/api/posts/route.ts`, `src/components/Composer.tsx`

- **`route.ts`:** `Body` = `{ prompt, resultUrl?, resultImage?, tool? }` (validate `resultUrl` as a URL
  when present). Insert one `status='live'` post with the B columns. **Remove** the quota check,
  the `generation_jobs` insert, and `enqueue()`. Drop the `lib/generation/worker` and `lib/quota`
  imports. Keep idempotency. Response returns the live post.
- **`Composer.tsx`:** prompt textarea **+ a result-link input + optional "made with" input** + a
  **post it** button. Remove the `shots` / `limit` / `resetAt` props and the "shots left / resets"
  UI. On success, push to `/p/{id}` (now already `live`, no hatch).

### Phase 3 — Feed + cards
**Files:** `src/components/LotCard.tsx`, `LotActions.tsx`, `src/app/page.tsx`; stop importing
`vignettes.tsx` / `HatchWatcher.tsx` / `ArtifactFrame.tsx` from B.

- **`LotCard.tsx`:** delete the `building` / `failed` / `blocked` branches. `Provenance` → a single
  "made with {tool}" line (omit if no tool). `Preview` → `result_image` `<img>` if present, else a
  link card ("open result ↗" + domain), else just the prompt placard (prompt-only post). Drop the
  status stamp.
- **`LotActions.tsx`:** actions = comments · **open result ↗** (if `result_url`) · share permalink ·
  steal prompt. Remove "watch it build" / "visit the grave".
- **`page.tsx`:** remove the `building` count query + `<HatchWatcher>`. nav-mid → a B line
  (e.g. "the feed · newest first" or a count of prompts). Empty state: "nothing here yet. post the first prompt."

### Phase 4 — Post page
**Files:** `src/app/p/[slug]/page.tsx`, `src/components/PostActions.tsx`

- Remove the building/failed/blocked `exhibit` logic and `<HatchWatcher>`. Layout: prompt placard +
  result preview (image or link card) + "made with {tool}" + actions + comments + adjacent.
- The "AI-generated artifact / sandboxed" frame bar → "the result" + "open ↗" to `result_url`.
- **`PostActions.tsx`:** "open artifact" → **"open result ↗"** (`result_url`); remove the
  "no artifact / nothing rendered" failure branch. Drop the `lot-strip` status stamp.

### Phase 5 — Profile page (explicit changes)
**File:** `src/app/u/[handle]/page.tsx`

- "lots rolled" → **"prompts shipped"**.
- **Remove** the survival-rate stat block.
- **Remove** the entire `career` aside (form-guide / calendar).
- **Remove** the `dealer-stampbox` ("house · regular").
- Keep post-karma / comment-karma. "career best — №X" → **"top prompt"**.
- Tiles: drop the failed/building rendering; show `result_image`/link preview. Empty: "no posts yet."

### Phase 6 — Segment A off (Coming soon)
**New:** `src/app/generate/page.tsx`

- A page using the shared chrome that says **"Coming soon — working on getting some API credits."**
  with a short blurb: *the verified one-shot — generate it here, no retries, real provenance, a
  permanent immutable artifact. The thing crossposts can't prove.*
- Add a secondary CTA near the composer and/or a nav link: **"generate it here (verified) ✨ — soon"**
  → `/generate`.
- Confirm nothing in the B render path imports `lib/generation/*`, `quota.ts`, `vignettes`,
  `HatchWatcher`, or `ArtifactFrame`. Those compile but are unreachable from B.

### Phase 7 — Copy
**Files:** `src/components/chrome.tsx` (ticker/masthead), `src/app/about/page.tsx`, `auth/signin`

- **Ticker / masthead:** reframe from "one prompt · one shot · no retries · no edits · failures stay
  up" to the B model — e.g. "post the prompt · link the result · upvote the best · nothing gets edited".
- **`about/page.tsx`:** rewrite "the rules" for B:
  1. a post is one prompt (≤300 chars), as typed;
  2. link the result if you hosted it — any tool, anywhere;
  3. upvote the best, comment freely;
  4. posts aren't edited; the prompt is the record;
  5. *(teaser)* the **verified one-shot** is coming — generated here, provable, permanent.
- **signin:** drop any remaining "shots" language.

---

## 4. File-by-file change map

| File | Action |
|---|---|
| `db/schema.ts`, `db/ddl.ts` | **edit** — add B columns; A columns/`generation_jobs` dormant |
| `lib/queries.ts` | **edit** — new columns in feed/post selects; `profileStats` → `{prompts,best}` |
| `db/seed.ts` | **edit** — seed B posts; drop failed/building + jobs |
| `api/posts/route.ts` | **edit** — B insert; remove quota/job/enqueue |
| `components/Composer.tsx` | **edit** — prompt + link + tool; remove shots UI |
| `components/LotCard.tsx` | **edit** — remove failure/building; image/link preview |
| `components/LotActions.tsx` | **edit** — open-result; remove watch/grave |
| `app/page.tsx` | **edit** — remove building count + HatchWatcher |
| `app/p/[slug]/page.tsx` | **edit** — remove exhibit/hatch; result preview |
| `components/PostActions.tsx` | **edit** — open result; remove no-artifact branch |
| `app/u/[handle]/page.tsx` | **edit** — prompts shipped; remove survival/career/stampbox |
| `components/chrome.tsx`, `app/about/page.tsx`, `app/auth/signin/page.tsx` | **edit** — copy |
| `app/generate/page.tsx` | **new** — A "Coming soon" |
| `lib/generation/*`, `app/a/[key]`, `api/posts/[slug]/events`, `components/{ArtifactFrame,HatchWatcher,vignettes}.tsx`, `lib/quota.ts` | **park** — keep, unimport from B |

---

## 5. Verification
- `npx tsc --noEmit` clean.
- `npm run db:seed && npm run dev`: feed shows seeded B posts (prompt + result preview), no failure
  states anywhere; vote + comment work; profile shows "prompts shipped" with no survival/career/stamp;
  `/generate` shows "Coming soon".
- Grep check: no B page imports `lib/generation`, `quota`, `vignettes`, `HatchWatcher`, `ArtifactFrame`.

---

## 6. Future: Model A (the verified one-shot)

When API credits land, light up `/generate`:
- Reuse the dormant `lib/generation` pipeline (or a Managed Agents session for the longer agentic
  build discussed separately).
- A posts set `verified=1`, write real provenance (`model_id`, tokens, `generation_ms`), host an
  immutable self-contained artifact via `/a/[key]`, and render in the sandboxed `ArtifactFrame`.
- A "verified one shot" badge distinguishes them in the feed. **Constraint for the agentic path:**
  the *process* can be a 15–20 min tool-calling build, but the *output* must be a static,
  self-contained bundle so the immutable-artifact model holds.

This is the only structurally-defensible layer — keep it as the credibility tier on top of B's volume.
