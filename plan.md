# single take - Build Plan: Model A, agentic

> One prompt. One autonomous build session. One frozen artifact.
>
> A user posts a prompt, an isolated coding agent builds a static web app from it,
> the server seals the output into an immutable bundle, and the result is hosted
> forever. No human retries, no edits after posting.

This plan replaces the older B-first migration plan. Model A becomes the primary
product: prompt-only posts enter a background build job, Claude Code runs inside an
ephemeral sandbox, and the resulting static bundle is published only if it passes a
deterministic seal gate.

Model B remains as a secondary lane: prompt plus external link. A and B share the
`posts` table, but they have different create flows, quota rules, render paths, and
provenance.

Hard boundary: A artifacts must be static, offline, and self-contained. Anything
that needs a backend, database, login, live API, or real-time multiplayer is outside
the artifact model and should fail the seal gate.

---

## 1. Product Invariant

The single-take invariant is:

1. The human submits exactly one prompt.
2. The system gives that prompt to one autonomous agent session.
3. The human cannot steer, patch, retry, or edit the build.
4. The produced artifact, success or failure, becomes the record.

The model may iterate on its own code inside the session. That is not a retry. A
retry is a second human instruction.

---

## 2. End-to-End Flow

```txt
user posts prompt-only A submission
        |
        v
POST /api/posts or /api/posts/build
        |
        |-- check auth, moderation preconditions, A quota
        |-- insert posts(status='building', verified=1)
        |-- insert generation_jobs(status='queued') with UNIQUE(post_id)
        |-- enqueue(postId), return immediately
        v
worker.runJob(postId)
        |
        |-- claim generation job by CAS
        |-- moderate prompt
        |-- create sandbox
        |-- run Claude Code inside sandbox
        |-- stream summarized build events over SSE
        |-- require /build/dist
        |-- run seal gate
        |-- putBundle(dist)
        |-- publish post by CAS: status='live'
        |-- teardown sandbox
        v
GET /a/{key}/...
        |
        v
ArtifactFrame iframe renders sealed bundle
```

Existing pieces to reuse:

- `src/lib/generation/worker.ts`: claim CAS, terminal helper, fire-and-forget
  `enqueue()`, zombie sweeper, and publish CAS guard.
- `src/lib/generation/events.ts` and `src/app/api/posts/[slug]/events/route.ts`:
  status SSE. Extend the payload shape for build-log events.
- `src/lib/generation/store.ts`: current content-addressed single-file artifact
  store. Generalize to a bundle store.
- `src/app/a/[key]/route.ts` and `src/components/ArtifactFrame.tsx`: current
  CSP-locked serving and sandboxed iframe. Generalize to multi-file bundles and a
  separate artifact origin.
- `src/db/schema.ts`: A columns already exist for `artifact_key`, `model_id`,
  `tokens_in`, `tokens_out`, `generation_ms`, `verified`, `error_kind`,
  `error_detail`, `og_image_key`, and `prompt_version`.

Important correction: the A worker exists, but A is not currently wired into
posting. `POST /api/posts` and `Composer` are currently B-only because they require
`resultUrl` and `tool`, then create `status='live'`. Re-enabling an A create path is
part of the early implementation, not a late UX polish task.

---

## 3. Claude Code Agent Engine

Use the official Claude Agent SDK package:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
```

The SDK is driven by `query()`, which returns an async iterator of messages.
Authentication uses `ANTHROPIC_API_KEY` on the server/sandbox environment.

### 3.1 Permissions: bypass, but only inside the sandbox

`allowedTools` is **not** a security boundary. In the Agent SDK it is only a
"don't prompt for these" list — it blocks nothing. Unlisted tools fall through to
`permissionMode`, and under `bypassPermissions` every tool is approved anyway
(Bash, Write, Edit included). `allowedTools: ["Read"]` with
`permissionMode: "bypassPermissions"` still lets the agent run Bash. (Confirmed by
the docs and SDK issue `anthropics/claude-agent-sdk-typescript#115`.)

The correct option is **`permissionMode`** — there is no `allowDangerouslySkipPermissions`.
Values: `"default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto"`.

The pattern:

- Run the build with **`permissionMode: "bypassPermissions"`**. A real build is
  hundreds of unpredictable shell commands (`npm install`, `vite build`, file
  writes, the agent fixing its own errors) — approving each is impossible, so the
  agent runs free.
- This is safe **only because it runs inside the sandbox**. The microVM is the
  boundary, not the permission settings. Bypass *without* a sandbox means arbitrary
  commands on the app host — never do that. (See §3.2, §4.)
- Wire cancellation with the SDK's abort-controller option plus an external
  wall-clock timer.

Security comes from the sandbox, full stop.

### 3.2 Where the Agent Runs

The agent process must run inside the sandbox, not merely point at a local path that
represents sandbox files.

Valid implementations:

1. Run the Claude Code CLI inside the sandbox:

   ```txt
   claude -p "<brief>" --output-format stream-json ...
   ```

   The worker streams stdout from the sandbox process and maps it to build events.

2. Run a small Node harness inside the sandbox that imports
   `@anthropic-ai/claude-agent-sdk` and calls `query()`.

3. Use a provider-specific remote execution adapter only if it guarantees all
   filesystem and shell actions happen inside the sandbox.

Invalid implementation:

```ts
query({ options: { cwd: "/some/local/path" } })
```

from the app host, if tool calls and Bash execute on the app host. That violates the
security model.

### 3.3 Agent Contract

Version the build contract with `prompt_version`. Replace the current one-file HTML
contract with a static-app contract:

- Build a single-player, offline, static web app.
- `npm run build` must produce `/build/dist`.
- `dist/index.html` must run as plain static files.
- No backend, API routes, server process, env vars, or runtime network.
- Assets must be bundled or relative.
- Runtime `fetch` may only target relative same-bundle files.
- No CDN scripts, remote stylesheets, remote fonts, analytics, beacons, WebSockets,
  or external API calls.
- If the prompt asks for phishing, malware, CSAM, doxxing, or credible threats,
  build a tasteful refusal artifact.

### 3.4 Caps

Use all of these:

- Max turns, configured by env.
- Wall-clock timeout, for example 25 minutes.
- Budget ceiling, using the SDK/CLI-supported print-mode budget option where
  available.
- Sandbox lifetime limit as a backstop.
- Org-wide daily spend kill switch.

Store returned provenance where available: model id, input tokens, output tokens,
turn count, elapsed build time, and cost.

---

## 4. Sandbox Layer

The agent executes untrusted model-generated shell commands and installs arbitrary
npm packages. Production builds must run in a per-job, ephemeral, network-controlled
isolate.

Preferred production provider: Vercel Sandbox.

Alternative: E2B.

Local demo fallback: a local Claude Code sandbox or a fake-build mode. Local sandbox
is acceptable for development only; never expose a public build endpoint that runs
the agent unsandboxed on the app host.

`src/lib/generation/sandbox.ts`:

```ts
export type SandboxExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export interface BuildSandbox {
  writeFile(path: string, data: Buffer | string): Promise<void>;
  exec(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<SandboxExecResult>;
  readDir(path: string): Promise<string[]>;
  readFile(path: string): Promise<Buffer>;
  dispose(): Promise<void>;
}

export async function createSandbox(): Promise<BuildSandbox>;
```

Build-time network and runtime network are separate:

- During build, the sandbox may get allowlisted egress to package registries and
  other explicitly approved build resources.
- After publication, the served artifact gets no external egress. It may only fetch
  files from its own sealed bundle.

---

## 5. Seal Gate

The seal gate is deterministic server-side enforcement. A model promise is not
enforcement.

`src/lib/generation/seal.ts` takes the sandbox `/build` directory and returns either
an accepted static bundle or a terminal failure reason.

Required checks:

1. Locate `dist/`.
2. Require `dist/index.html`.
3. Reject outputs that expect a Node server, API route, env var, or server entry.
4. Scan every text file in the tree.
5. Reject remote scripts, stylesheets, fonts, iframes, meta refreshes, beacons,
   WebSockets, EventSource, and absolute-url `fetch`/XHR calls.
6. Allow relative-path `fetch` for same-bundle assets.
7. Enforce bundle limits: total bytes, file count, and per-file cap.
8. Optionally run Playwright with the production CSP to reject blank/erroring first
   paint and capture the OG screenshot.

Failures are not infrastructure errors. They are the user's single take ending in
`status='failed'` with `error_kind='scan'` or a more specific build/seal kind.

---

## 6. Bundle Store

Replace the one-file artifact unit with a Merkle-style bundle.

`src/lib/generation/store.ts` should gain:

```ts
export type BundleFile = {
  path: string;
  sha: string;
  bytes: number;
  mime: string;
};

export type BundleManifest = {
  version: 1;
  files: BundleFile[];
  entrypoint: "index.html";
  bytes: number;
  fileCount: number;
};

export function putBundle(dir: string): {
  key: string;
  manifest: BundleManifest;
  bytes: number;
  fileCount: number;
};

export function getManifest(key: string): BundleManifest | null;
export function getFile(sha: string): Buffer | null;
```

Storage shape:

- Each file is stored by sha under `artifacts/blobs/<sha>`.
- The manifest is canonical JSON with sorted file records.
- The artifact key is the sha256 of the canonical manifest.
- The manifest is stored under `artifacts/manifests/<key>.json`.
- Existing `putArtifact`/`getArtifact` can remain temporarily for legacy artifacts,
  but A should publish bundles.

---

## 7. Artifact Serving

Move from:

```txt
src/app/a/[key]/route.ts
```

to:

```txt
src/app/a/[key]/[[...path]]/route.ts
```

Routes:

- `GET /a/<key>/` serves `index.html`.
- `GET /a/<key>/<path>` serves only exact manifest-listed paths.
- Missing manifest/file/path returns 404.
- Content type comes from the manifest.
- Cache with `public, max-age=31536000, immutable`.
- Keep `X-Content-Type-Options: nosniff`.

Path traversal is avoided by never resolving arbitrary filesystem paths from the
URL. Only manifest paths are valid.

### 7.1 Runtime CSP

The runtime CSP should allow games and wasm while blocking external egress:

```txt
default-src 'none';
script-src 'unsafe-inline' 'wasm-unsafe-eval';
style-src 'unsafe-inline';
img-src 'self' data: blob:;
media-src 'self' data: blob:;
font-src 'self' data:;
worker-src 'self' blob:;
connect-src 'self';
form-action 'none';
base-uri 'none';
frame-ancestors <APP_ORIGIN>;
```

Important: if artifacts are served from a separate usercontent origin,
`frame-ancestors 'self'` is wrong because `'self'` means the artifact origin, not
the main app. Use the configured app origin, for example
`frame-ancestors https://singletake.gg`.

### 7.2 Artifact Origin

Production should serve artifacts from a separate origin. Strongest option:

```txt
https://<artifact-key>.usercontent.<host>/
```

Simpler launch option:

```txt
https://usercontent.<host>/a/<artifact-key>/
```

If using `connect-src 'self'` and `allow-same-origin`, the artifact origin must not
be the app origin. Otherwise generated code could become same-origin with the main
app.

`ArtifactFrame` production sandbox:

```tsx
<iframe
  src={artifactUrl}
  sandbox="allow-scripts allow-same-origin"
  referrerPolicy="no-referrer"
/>
```

Local dev may temporarily serve same-origin, but that is a documented relaxation.

---

## 8. Live Build UX

The product moment is watching the autonomous build happen.

Current status SSE is useful but status-only:

```ts
type StatusPayload = { postId: string; status: string };
```

Extend it to a discriminated build event stream:

```ts
type BuildBusEvent =
  | { type: "status"; postId: string; status: PostStatus }
  | { type: "log"; postId: string; level: "info" | "warn" | "error"; message: string; ts: number }
  | { type: "tool"; postId: string; name: string; summary: string; ts: number };
```

Rules:

- Stream summaries, not raw token deltas.
- Throttle noisy tool output.
- Post page renders logs while `status='building'`.
- Feed cards can keep the lightweight hatch behavior.
- `failed` and `blocked` states must render human-facing epitaphs from
  `error_detail`.

Persisted `build_events` are optional for v1. SSE-only is acceptable, but persisted
logs are better for replayable provenance.

---

## 9. Data Model

Reuse existing columns:

- `posts.status`
- `posts.artifact_key`
- `posts.og_image_key`
- `posts.model_id`
- `posts.prompt_version`
- `posts.tokens_in`
- `posts.tokens_out`
- `posts.generation_ms`
- `posts.error_kind`
- `posts.error_detail`
- `posts.verified`
- B columns: `result_url`, `result_image`, `tool`

Add provenance columns:

- `build_turns integer`
- `cost_usd real`
- `bundle_bytes integer`
- `file_count integer`

Optional:

- `build_events` table for replayable build logs.

`generation_jobs.post_id` remains unique. That is the one-shot CAS.

A post is A when `verified=1`. Do not rely on `result_url IS NULL` alone because
legacy or malformed rows can exist.

---

## 10. Create Paths and Quota

Split creation by lane.

A:

- Body: `{ prompt }`
- Check A quota.
- Insert post with `status='building'`, `verified=1`, no `result_url`.
- Insert `generation_jobs(status='queued')`.
- Call `enqueue(postId)`.
- Return `{ post: { id, status: "building" } }`.

B:

- Body: `{ prompt, resultUrl, resultImage?, tool }`
- No A build job.
- Insert post with `status='live'`, `verified=0`.
- Return `{ post: { id, status: "live" } }`.

`lib/quota.ts` currently counts every post. For this plan, quota must count A
builds only, for example:

```sql
WHERE author_id = ?
  AND verified = 1
  AND created_at >= ?
```

Otherwise B is not a free-volume lane.

Recommended quota:

- One A build per user per UTC day.
- Failed, blocked, and live A builds all spend the shot.
- B posts do not spend the A build quota.
- Add a global daily spend kill switch.

---

## 11. Worker Rewrite

Keep the current worker control structure and replace the middle.

```txt
runJob(postId):
  claim generation_jobs row by CAS
  load post, require status='building'
  moderate prompt
  create sandbox
  try:
    run agent inside sandbox
    stream build events
    require /build/dist
    sealGate(/build/dist)
    if seal fails:
      terminal failed with seal reason
      return
    putBundle(dist)
    publish post by CAS:
      status='live'
      artifact_key=<manifest hash>
      model_id, prompt_version
      tokens_in, tokens_out
      generation_ms
      build_turns, cost_usd, bundle_bytes, file_count
    finish job done
    emit status live
  catch provider/sandbox/app infra error:
    mark infrastructure failure and requeue once
  finally:
    dispose sandbox
```

Widen `sweepZombies()` from 10 minutes to something above the intended build cap,
for example 40 minutes.

Keep the distinction:

- User/build/seal failure: terminal `failed`.
- Provider/sandbox/app infrastructure failure: one system retry allowed.

---

## 12. Fake Build Mode

Add `SINGLETAKE_FAKE_BUILD=1` before real agent integration.

Fake mode should:

- Skip external APIs and hosted sandboxes.
- Create a canned multi-file `dist/` in a temp build directory.
- Exercise seal gate, putBundle, bundle serving, iframe rendering, status SSE, and
  post publishing.

This lets the whole pipeline work for zero API spend and zero sandbox cost before
Phase 3.

---

## 13. Phases

### Phase 0 - Re-enable A Skeleton

- Add prompt-only A create path.
- Insert `generation_jobs`.
- Use `SINGLETAKE_FAKE_BUILD=1`.
- Publish a canned multi-file bundle.
- Render `building`, `live`, `failed`, and `blocked` states.
- End with `npx tsc --noEmit` clean.

### Phase 1 - Bundle Artifact Unit

- Implement `putBundle`, `getManifest`, `getFile`.
- Implement `/a/[key]/[[...path]]`.
- Add per-file MIME types and bundle CSP.
- Keep legacy single-file serving only if needed for existing data.

### Phase 2 - Seal Gate

- Implement static-only checks.
- Implement tree-wide scan.
- Add bundle budgets.
- Add optional render/screenshot gate behind a flag.

### Phase 3 - Local Agent Build

- Add `agent.ts` or sandbox-side harness.
- Run Claude Code in a local development sandbox.
- Stream build events.
- Add the new build contract.
- Verify real prompt-to-bundle locally.

### Phase 4 - Hosted Sandbox

- Implement Vercel Sandbox provider.
- Add egress allowlist during build.
- Ensure Claude Code process runs inside the sandbox.
- Ensure teardown always happens.
- Keep E2B interface-compatible as an alternative.

### Phase 5 - Worker Integration

- Swap fake build for sandbox agent build.
- Store provenance columns.
- Widen zombie cutoff.
- Add one-retry infra handling if not already sufficient.

### Phase 6 - UX and Lanes

- Make A the default composer.
- Keep B as secondary crosspost mode.
- Feed branches on `verified`.
- A cards show verified badge and artifact frame.
- B cards show external link/image preview.
- `/generate` becomes the A composer or redirects to the A composer.

### Phase 7 - Cost Governance

- Enforce A-only quota.
- Add per-build budget settings.
- Add org-wide daily kill switch.
- Surface build time, turns, cost, and model in provenance.

### Phase 8 - Copy

- Update About and chrome copy:
  "one prompt, one autonomous session, no retries, frozen forever."

---

## 14. Verification

Required checks:

- Fake A post goes `building -> live`.
- Fake multi-file bundle renders in iframe.
- Missing manifest path returns 404.
- Path traversal attempts return 404.
- Oversized bundle fails.
- Remote script/style/fetch attempts fail seal.
- Artifact CSP blocks external network.
- A quota blocks second A build in the same UTC day.
- B post still works and does not consume A quota.
- `npx tsc --noEmit` passes.
- `npm run build` passes.

Real-agent checks:

- Prompt: "make a playable single-player voxel sandbox" builds, seals, and runs.
- Prompt: "make a multiplayer app with a server and database" fails the seal gate
  with a clear static/offline reason.
- Sandbox teardown runs after success, user failure, and infrastructure exception.

---

## 15. Open Decisions

1. Sandbox provider: Vercel Sandbox first, or E2B first?
2. Artifact origin: per-artifact subdomain or one shared usercontent domain?
3. Render gate: required in v1, or behind a flag?
4. Build logs: persisted `build_events` or SSE-only?
5. Model tiering: Sonnet-only to start, or add premium Opus lane later?

---

## 16. Source Notes

Use official docs for implementation details before coding against fast-moving
platforms:

- Claude Agent SDK TypeScript docs: package name, `query()`, SDK options,
  tool-permission semantics, and abort handling.
- Claude Code CLI docs: headless print mode and stream-json output.
- Anthropic pricing docs: current model IDs, token prices, prompt caching, and
  batch discounts.
- Vercel Sandbox docs: sandbox execution, runtime, firewall, and egress filtering.
- E2B docs if choosing the vendor-neutral sandbox path.
