# single take — Migration Plan: cloud architecture + the "paste a link" method

> **Status:** plan, not yet built. Supersedes the *generation* model in [`plan.md`](./plan.md)
> for how a post is created. The social layer (feed, votes, comments, profiles, the
> one-shot ethos) is unchanged. `plan.md` is kept intact as the reference for everything
> that still holds.

This document has two jobs:

1. **Move single take off the single local machine onto a reliable, low-latency cloud stack** —
   and *explain every tool choice*, because the point is for you to understand the system,
   not just run it.
2. **Replace AI generation with "paste a link."** The user builds their thing wherever they
   like, hosts it, and pastes the URL. single take **renders a frozen snapshot of that page** and
   posts it to the feed. No per-post AI cost.

Read §1 for the architecture (the "why this tool" walkthrough), §2 for the new security model
(this is the biggest conceptual change), and §3 for the new pipeline.

---

## 0. The pivot in one breath

| | Old (`plan.md`) | New (this doc) |
|---|---|---|
| What the user submits | a prompt (≤300 chars) | a **URL** to a thing they built (+ optional caption) |
| Who builds the artifact | our server, via the Claude API | **the user, elsewhere** (any tool) |
| What we store | self-contained HTML we generated | a **frozen screenshot** of their page (+ optional archived copy) |
| Per-post cost | $0.15–0.60 (LLM tokens) | ~fractions of a cent (one screenshot) |
| Top security threat | hostile code *we* generated | a hostile *external URL* we're asked to fetch and promote |

The cost problem that dominated `plan.md` §2.3 basically **dissolves** — a screenshot is cheap.
Quotas don't disappear, but their job changes from *capping spend* to *throttling spam*.

In exchange, a **new** hard problem appears: we now fetch and render arbitrary URLs that
strangers point us at. That's §2. Take it seriously — it's where this design earns its keep.

---

## 1. System architecture (the reliability walkthrough)

### 1.1 The shape

```
                        ┌───────────────────────────────────────────────┐
   browser ───────────▶ │  Cloudflare (WAF + Turnstile + CDN in front)  │
   (singletake.app)         └───────────────────┬───────────────────────────┘
                                            │
                        ┌───────────────────▼───────────────────────────┐
                        │  Vercel — Next.js 15 (App Router, RSC)         │
                        │   • feed / post / profile pages (edge-cached)  │
                        │   • POST /posts (validate URL, <200ms)         │
                        │   • API routes (votes, comments, quota)        │
                        └───────┬───────────────────┬───────────────────┘
                                │ enqueue           │ read/write
                                ▼                   ▼
                ┌──────────────────────┐   ┌──────────────────────┐
                │  Inngest (worker)    │   │  Neon — Postgres      │
                │  snapshot pipeline:  │   │  users, posts, votes, │
                │  1. URL + SSRF guard │   │  comments, jobs       │
                │  2. render (managed) │   └──────────┬───────────┘
                │  3. (opt) freeze     │              │ status
                │  4. moderate         │              ▼
                │  5. store → R2       │   ┌──────────────────────┐
                │  6. publish (CAS)    │   │  Ably — realtime      │
                │  7. emit post.live ──┼──▶│  "watch it hatch"     │
                └──────────┬───────────┘   └──────────────────────┘
                           │ render call            ▲
                           ▼                        │ subscribe
                ┌──────────────────────┐   ┌──────────────────────┐
                │  Managed renderer    │   │  Upstash — Redis      │
                │  (Browserless /      │   │  rate limits, quota,  │
                │  ScreenshotOne /     │   │  dedupe, circuit-     │
                │  CF Browser Render)  │   │  breaker counters     │
                └──────────┬───────────┘   └──────────────────────┘
                           │ screenshot bytes
                           ▼
                ┌──────────────────────────────────────────────────┐
   browser ───▶ │  Cloudflare R2 + CDN  (snapshots, immutable)     │
   (feed card)  └──────────────────────────────────────────────────┘
```

### 1.2 Every tool, and *why this one*

The principle running through all of these: **put slow, flaky, or untrusted work in a durable
queue — never inside an HTTP request — and serve reads from the edge so the feed is fast
everywhere.** Here's how each piece serves that.

**Vercel — the app (Next.js 15, App Router).**
The feed is read-heavy: thousands of people scrolling, very few posting. App-Router server
components let those pages render on the server and **cache at the edge**, so a feed read is
sub-50ms anywhere in the world regardless of where the database lives. Vercel also gives us
the best Next.js deploy story and scales to zero. *Why not run our own server?* We'd be paying
for idle boxes and hand-rolling autoscaling for a workload that's 95% cacheable reads.
→ **Caveat we design around:** serverless functions can't cheaply hold long-lived connections
(see Ably below), and they exhaust database connections fast (see Neon's pooler below).

**Neon — Postgres (with Drizzle ORM).**
Posts, votes, comments, and the one-job-per-post invariant are all *relational* — rows with
foreign keys and uniqueness constraints. Postgres models that exactly, and a `UNIQUE`
constraint is how we mechanically enforce "one snapshot job per post" (the same trick `plan.md`
used). Neon is serverless Postgres: it scales connections, supports branching (a throwaway DB
per preview deploy), and we use its **pooled** connection string + serverless driver because
Vercel opens many short-lived connections that would otherwise blow past Postgres's limit.
*Why not keep the local SQLite we have?* SQLite is one file on one machine — it can't be shared
by serverless functions running in many places at once. The schema ports almost unchanged
(Postgres was the original target), so this is a driver swap, not a rewrite.
→ **Latency rule:** pin the app *and* Neon to the same region (e.g. us-east). The `POST /posts`
write path must be physically close to the DB to keep its <200ms promise; global users still
get fast *reads* from the edge cache, so we don't need a globally-distributed database.

**Inngest — the durable worker / job queue.**
Snapshotting a random website is **slow and failure-prone**: the site might be down, slow,
huge, or redirect three times. That work must never sit inside the user's HTTP request, and
each step needs independent retries. Inngest gives us *durable step functions* — each stage
(guard → render → freeze → moderate → store → publish) is a checkpoint that retries on its own
if it fails, without re-running the steps that already succeeded. Its **concurrency cap** (e.g.
"max 20 renders at once") doubles as a built-in circuit breaker so a traffic spike queues
instead of melting the renderer. *Why not a cron job or a raw queue we write?* We'd be
re-implementing retries, checkpointing, and concurrency control by hand — exactly what Inngest
already does well. (And this pipeline is *flakier* than the old LLM one, because we're at the
mercy of arbitrary external sites, so durable retries matter even more.)

**Managed renderer (Browserless / ScreenshotOne / Urlbox / Cloudflare Browser Rendering) — the new core dependency.**
This is the piece that turns a URL into an image. It runs a headless Chromium, loads the page,
and returns a screenshot. *Why managed instead of running Playwright ourselves?* Three reasons,
all serious: (1) **SSRF isolation** — these services render untrusted URLs from inside a
sandboxed network you don't own, so a malicious URL can't reach *your* internal services (more
in §2); (2) **ops** — headless Chromium is memory-hungry and cold-starts slowly inside a
serverless function; a managed service keeps a warm browser pool and patches Chromium for us;
(3) **resource limits** — they enforce timeouts and page-size caps so one giant page can't hang
the pipeline. Running our own headless browser against the open internet is a security and ops
project we don't want on day one.

**Cloudflare R2 + CDN — snapshot storage.**
Every feed card shows a screenshot, so these images are the **bandwidth hot spot** — served on
every scroll, by everyone. R2 has **zero egress fees**, which on a bandwidth-heavy workload is
the decisive cost factor (S3 would bill us for every image view). Snapshots are written once and
never change, so we store them **content-addressed** (the key is the sha256 of the bytes) with
`immutable` cache headers — the CDN caches them forever and a given image can never be silently
swapped. *Why content-addressing?* It makes immutability free and de-dupes identical images
automatically.

**Ably (or Pusher) — realtime "watch it hatch."**
A snapshot takes a few seconds, so a post appears as `building` and then flips to `live` — the
satisfying moment from the original product survives. The browser needs a push when that flip
happens. *Why a managed realtime service instead of the SSE endpoint `plan.md` described?* On
Vercel, every open SSE connection pins a serverless function invocation; with many viewers
watching many building posts, that's expensive and fragile. Ably holds those connections on
infrastructure built for exactly this; our worker just publishes `post.live` to a channel and
the browser subscribes. Same UX, far more reliable.

**Upstash — serverless Redis.**
We need a few fast, ephemeral counters that don't belong in Postgres: per-user/IP **rate
limits** (token buckets), the daily **quota** ("shots remaining"), a **dedupe** check so the
same URL spammed twice in a row is caught, and a rolling **circuit-breaker** counter. Redis is
the right tool for hot counters, and Upstash is a serverless Redis that bills per request so it
fits the Vercel model. *Why not just use Postgres rows?* These are high-frequency, short-lived,
and don't need durability — hammering the primary DB for rate-limit checks would be wasteful.

**Cloudflare (WAF + Turnstile) — the front door.**
With AI cost gone, the main abuse vector becomes **spam submissions and bot signups**. Putting
Cloudflare in front gives DDoS protection, bot filtering, and a Turnstile CAPTCHA on signup —
stopping junk before it ever reaches the app or the renderer (each render still costs *something*
and pollutes the feed). This is the cheapest place to reject abuse: at the edge.

**Auth.js v5 — accounts.**
We still own the users table (quota, karma, profiles depend on it), and a consumer app
shouldn't pay a per-user vendor fee. Magic-link + Google OAuth, Turnstile on signup. Unchanged
reasoning from `plan.md`.

**Sentry + Axiom — observability.**
This pipeline talks to *arbitrary external websites*, so it *will* fail in novel ways. We need
error tracking (Sentry) and queryable structured logs correlated by `post_id` (Axiom) to answer
"why did this snapshot fail?" and "what's our render success rate?" — see §6.

### 1.3 The latency budget (what "fast" means concretely)

| Path | Target | How |
|---|---|---|
| Feed read (the bulk of traffic) | <50ms globally | RSC + edge cache (~10s TTL for anonymous) |
| Snapshot image load | <50ms after first view | R2 + CDN, immutable headers |
| `POST /posts` ("instant post") | <200ms | one DB transaction in the DB's region: validate URL → insert post(`building`) → insert job → enqueue → return |
| URL → live snapshot | a few seconds | Inngest pipeline; the post is already in the feed as `building`, flips via Ably |

The contract from `plan.md` §2.1 holds: **the post is in the feed before the snapshot exists.**

---

## 2. The new security model (read this twice)

The original threat was *code we generated*. We controlled it, so we locked it in a box (own
origin, strict CSP, `connect-src 'none'`, sandboxed iframe). Now the threat is **a URL a
stranger hands us**, and it splits into two genuinely different dangers:

### 2.1 Threat A — SSRF: the URL attacks *our* infrastructure

When our server fetches `http://169.254.169.254/` (cloud metadata), `http://localhost:6379`
(an internal Redis), or `http://10.0.0.5/admin`, it's making a request *from inside our network*
to somewhere it shouldn't. This is **Server-Side Request Forgery**, and it's the classic way
"let users submit a URL we fetch" gets a company breached.

**Defenses, in order:**

1. **Render via the managed service, not from our own network.** The single biggest mitigation:
   the headless browser runs in *their* sandbox, not ours, so even a malicious URL can't reach
   *our* internal services. This is the main reason we don't self-host Playwright.
2. **Validate and resolve before we touch the URL.** In `POST /posts` and again in the worker:
   `https` scheme only; reject URLs whose host resolves to a private/reserved range
   (RFC1918 `10/8`, `172.16/12`, `192.168/16`; loopback `127/8`; link-local `169.254/16`;
   IPv6 ULA/loopback); **re-check on every redirect hop** (a public URL can 302 to an internal
   one).
3. **Timeouts and size caps** on the render (the managed service enforces these), so a
   slow-loris or a 2GB page can't tie up the pipeline.

### 2.2 Threat B — malicious destination: the URL attacks *our users*

A submitted link could be a phishing page, malware, or a bait-and-switch. We're about to
*promote* it to a feed of people. Defenses:

1. **We never embed the live URL.** The feed shows our **frozen screenshot** — an image, which
   can't phish or run code. This alone removes the bulk of the risk, and it's why the live-iframe
   idea was rejected: besides being unsafe, most real sites block iframing with `X-Frame-Options`
   anyway, so it wouldn't even work.
2. **Outbound is an explicit, warned action.** "Open it ↗" goes to the external site in a new
   tab through an **interstitial** ("You're leaving single take — this is user-submitted external
   content"), with `rel="noopener noreferrer"`. No silent redirects.
3. **Moderation on the captured artifact**, not the live site: a moderation pass on the
   screenshot (cheap vision/LLM check for obvious phishing/abuse), plus a URL-reputation lookup.
   Flagged → post `blocked`.
4. **Report + takedown.** Every post is reportable; a removed post's snapshot is cut at the CDN
   via a denylist of keys, and the host can be denylisted. (Same tombstone model as `plan.md`.)

### 2.3 Immutability vs. link rot (an honesty problem)

A screenshot is frozen forever — good. But the **live link can change, break, or get swapped**
after we approve it. We handle this with honesty and an optional upgrade:

- **v1:** the card is the frozen screenshot (immutable, content-addressed in R2); the "open
  live" button is clearly labelled *"may have changed since posted."* We show the snapshot
  timestamp.
- **v2 (optional but recommended):** also capture a **self-contained frozen archive** of the
  page (inlined HTML/CSS/JS, like SingleFile / the Wayback Machine). Because that archive is
  *our* bytes with *our* CSP, we can safely serve it in the **same sandboxed iframe the original
  build already uses** — giving a real "run the frozen version" experience with zero link-rot
  and zero SSRF. This is the bridge back to the original hosting model, and most of that code
  survives (see §5).

> **The mental model:** *fetching* the URL is the SSRF risk (mitigate with the managed sandbox +
> IP guards); *promoting* the URL is the user-safety risk (mitigate by showing a frozen image,
> never the live site, plus warnings + moderation + takedown).

---

## 3. The new snapshot pipeline (Inngest, step by step)

Triggered by `post.created`. Concurrency-capped (e.g. 20 global = circuit breaker). Each step is
durable and independently retried.

```
step 1  guard-url     Re-validate scheme/host; DNS-resolve; reject private/reserved IPs.
                      Follow redirects, re-checking each hop. Record final_url.
                      Fail (content) → post.status='blocked' (bad URL spent the shot).

step 2  render        Call the managed renderer for the live URL:
                       • full-page screenshot (the artifact)
                       • a 1200×630 "card"/OG crop (the feed thumbnail + share image)
                      Timeout + page-size caps enforced. Render error after retries →
                      status='failed', error_kind='infrastructure' (one system retry, per
                      plan.md §1.5 — a dead renderer is our fault, not the user's dice).

step 3  freeze (opt)  Capture a self-contained single-file archive of the page → safe,
                      immutable "run it" copy. v2; skippable in v1.

step 4  moderate      Vision/LLM moderation on the screenshot + URL-reputation lookup.
                      Flag → status='blocked' + review-queue row.

step 5  store         sha256 each image → R2 put (if-not-exists), immutable cache headers.

step 6  publish       UPDATE posts SET status='live', snapshot_key, card_key, final_url,
                      captured_at WHERE id=? AND status='building'   ← CAS guard.

step 7  emit          Publish post.live to Ably channel post:{id} → feed flips in place.
```

Steps 1 and 4 failing for *content* reasons are terminal (`blocked`) — the shot is spent, no
free retry. Infrastructure failures (renderer down, R2 5xx) get Inngest's bounded retries, then
the one allowed system retry. A **sweeper cron** still flips `>10min building` zombies to
`failed-infrastructure` — even with durable steps, a post must never get stuck `building`.

The one-shot invariant survives mechanically exactly as before: `snapshot_jobs.post_id` is
`UNIQUE`, the worker claims via CAS (`UPDATE … WHERE status='queued'`), and publish is
CAS-guarded. There's still **no** API that re-runs, edits, or re-snapshots a post.

> **Note on "one shot":** since the user builds *elsewhere*, the one-shot rule is now a cultural
> convention, not a mechanism (they can rebuild and resubmit a different URL). We keep the ethos
> in the UI — no retry button, the prompt/caption shown as the body — but we don't pretend it's
> cryptographically enforced. (This was the conscious trade you picked.)

---

## 4. Data model changes

Mostly additive. Starting from `plan.md` §5:

```sql
posts (
  id            uuid PK,
  author_id     uuid NOT NULL REFERENCES users,
  caption       text CHECK (char_length(caption) BETWEEN 0 AND 300),  -- the post body:
                -- the prompt they used / a one-line description. Keeps the "one line" ethos.
  url           text NOT NULL,                  -- the submitted link (validated https)
  url_host      text NOT NULL,                  -- resolved host, for display + denylist
  final_url     text,                           -- post-redirect resolved URL (provenance)
  status        text NOT NULL DEFAULT 'building',-- building | live | failed | blocked | removed
  error_kind    text,                           -- unreachable | blocked_embed | scan | infrastructure
  snapshot_key  text,                           -- full screenshot, sha256 in R2
  card_key      text,                           -- 1200×630 OG/feed crop
  archive_key   text,                           -- optional frozen single-file copy (v2)
  captured_at   timestamptz,                    -- when the snapshot was taken (shown in UI)
  score         int NOT NULL DEFAULT 0,
  comment_count int NOT NULL DEFAULT 0,
  hot_rank      double precision NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
)
  INDEX (hot_rank DESC), (created_at DESC), (score DESC, created_at), (author_id, created_at DESC)

snapshot_jobs (                                  -- was generation_jobs; same invariant
  id         uuid PK,
  post_id    uuid UNIQUE NOT NULL REFERENCES posts,   -- ← the one-shot constraint
  status     text NOT NULL DEFAULT 'queued',          -- queued | running | done | failed
  attempt    int NOT NULL DEFAULT 0,
  claimed_at timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

`users`, `votes`, `comments`, `comment_votes`, `reports` are **unchanged** from `plan.md` §5.
Removed columns: `prompt_version`, `model_id`, `tokens_in/out`, `generation_ms` (no LLM
anymore). Gone: the per-post token/cost provenance — replaced by `captured_at` + `final_url`.

---

## 5. What survives from the current build (migration mapping)

The good news: the seams the local build chose are exactly where we cut. This is mostly swapping
implementations behind stable interfaces.

| Current local piece | Becomes | Effort |
|---|---|---|
| SQLite + Drizzle (`src/db`) | Neon + same Drizzle schema (driver swap, add new columns) | low |
| In-process `worker.ts` (7 steps) | Inngest function (steps become `step.run(...)`); **steps change content** to the snapshot pipeline (§3); CAS claim/publish logic identical | medium |
| `generate.ts` / `stub.ts` (LLM call) | **Deleted.** Replaced by a `render.ts` that calls the managed renderer | — |
| `scan.ts` (static HTML scan) | Repurposed: runs on the *frozen archive* (v2) + screenshot moderation | low |
| `store.ts` (content-addressed disk) | R2 put/get, same sha256-key + if-not-exists semantics | low |
| `a/[key]/route.ts` (CSP-locked serving) | Serves snapshots/archives from R2; for the v2 archive, the **same sandboxed-iframe + CSP model is reused unchanged** | low |
| `events.ts` (SSE bus) + `HatchWatcher` | Ably publish/subscribe; event shape (`post.live`) unchanged | low |
| Signed-cookie auth | Auth.js v5 (users table is already the source of truth) | medium |
| Composer (prompt textarea) | URL input + optional caption; client-side URL validation; same "send it", no retry | medium |
| `quota.ts`, `ranking.ts`, `queries.ts` | Unchanged logic; quota/rate-limit counters move to Upstash | low |

**New code to write:** `src/lib/snapshot/guard.ts` (SSRF/URL validation), `render.ts` (managed
renderer client), the URL-reputation + screenshot-moderation step, and the Cloudflare/Turnstile
front-door config.

---

## 6. Observability & ops (what to watch)

The failure modes are different now — they're about *external sites*, not token budgets:

- **Dashboards:** posts/day, **render success rate**, p50/p95 snapshot time, failure rate by
  `error_kind` (unreachable / embed-blocked / moderation / infra), queue depth, quota-hit rate.
- **Alerts:** render success rate < 90% (renderer or our guard misbehaving), queue latency > 5min,
  any spike in `blocked` (someone probing moderation), zombie-`building` count > 0.
- **Cost ledger:** now trivial — renders × per-render price + R2 storage/egress. Pennies, but
  watch render volume as the abuse signal.
- **Per-post provenance:** `final_url`, `captured_at`, `url_host`, the snapshot keys — enough to
  audit "what did we actually capture and when."

---

## 7. Build phases

**Phase 0 — Cloud skeleton.** Neon + Drizzle (port schema, add new columns); deploy to Vercel
from day one; Auth.js with magic links; Cloudflare in front. CI = lint, typecheck, migrate-check.

**Phase 1 — The link loop, ugly.** `POST /posts` (URL) → Inngest → guard → managed render →
R2 → status flip. New-sort feed of cards. No votes. **Milestone: a URL pasted in prod becomes a
live frozen card in the feed in under ~10s.**

**Phase 2 — It's a social network.** Votes + hot ranking, comments, profiles, the composer done
right (URL + caption), Ably hatching, quotas + rate limits on Upstash, Cloudflare Turnstile.

**Phase 3 — Safe to show strangers.** Harden the SSRF guard against a real red-team URL list
(metadata endpoints, internal IPs, redirect-to-internal, decompression bombs, embed-blockers);
screenshot moderation + URL reputation; report queue + admin takedown + CDN denylist; outbound
interstitial; ToS/about pages. Load-test the feed; chaos-test the worker (kill mid-render → post
ends terminal, never zombie).

**Phase 4 — (Optional) the frozen archive.** Add step 3 (self-contained capture) and serve it in
the sandboxed iframe for a real "run the frozen version" — kills link rot, reuses the original
CSP/iframe code.

---

## 8. Open questions

1. **Caption = the prompt they used, or a free description?** Leaning: "the prompt you used to
   build it" — keeps the prompt-craft culture even though we no longer run it.
2. **v1 with frozen archive, or screenshot-only first?** Leaning: screenshot-only for Phase 1–3,
   archive in Phase 4 — it's the heavier, fiddlier capture and not needed to validate the loop.
3. **Which managed renderer?** Browserless (most control), ScreenshotOne/Urlbox (simplest API),
   or Cloudflare Browser Rendering (keeps us in one vendor with R2/WAF). Decide on a quick
   spike: test each against 20 real, messy URLs (SPAs, auth walls, slow sites) and compare
   success rate + latency + SSRF posture.
4. **Allow non-web submissions at all?** A screenshot only means something for a web page. v1:
   restrict to `https` web URLs; reject/queue anything that renders to a 404 or a bare repo
   README. Revisit "submitter-supplied cover image" later (trust problem).

---

*Migration plan v1 — supersedes `plan.md`'s generation model; keeps its social layer. The plan
is detailed; the product stays simple.*
