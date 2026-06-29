# What's left — single take (Model A)

Status of `plan.md` execution. The A pipeline is **implemented and verified end-to-end
in fake-build mode** (`SINGLETAKE_FAKE_BUILD=1`): create → `building` → sandbox →
seal gate → content-addressed bundle → `live`, served CSP-locked from
`/a/[key]/[[...path]]` and rendered in `ArtifactFrame`. `tsc --noEmit` and
`next build` are clean (on Node ≥18.18).

What remains is mostly the **real (paid) agent build** and the **production hardening**
around it. Items are grouped by plan phase.

---

## Done & verified
- [x] §0 Re-enable A skeleton — prompt-only A create path, `generation_jobs` row, enqueue.
- [x] §6 Bundle store — `putBundle` / `getManifest` / `getFile`, Merkle/content-addressed.
- [x] §7 Artifact serving — `/a/[key]/[[...path]]`, per-file MIME, runtime CSP. Iframe
      loads `/a/<key>/index.html` so relative same-bundle assets resolve.
- [x] §5 Seal gate — static-only, tree-wide scan, size/file budgets. (Render/OG gate: see below.)
- [x] §9 Data model — `build_turns`, `cost_usd`, `bundle_bytes`, `file_count`.
- [x] §10 Create paths + quota — A/B lane split; quota counts `verified=1` only.
- [x] §11 Worker — build → seal → putBundle → publish-by-CAS w/ provenance; 40-min zombie cutoff.
- [x] §12 Fake build mode — canned multi-file dist, $0.
- [x] §6/§8 UX — mode-aware composer (A default), A render path in feed/post, HatchWatcher,
      `/generate` is the A composer, About/chrome copy.
- [x] §14 Verification — worker `building→live`, bundle serving, 404 + traversal, oversized
      + remote-ref + egress seal failures, A-only quota, B unaffected. (See "How to re-run" below.)

---

## Left to do

### Phase 3 — Real local agent build (`agent.ts`)
- [ ] Validate `runAgentBuild()` against a real `@anthropic-ai/claude-agent-sdk` install
      (the engine is written + gated behind `hasRealAgent()`, but never executed — it has
      not run against the live SDK).
- [ ] Confirm the message-stream parsing maps to real SDK message shapes (`assistant`/
      `result` types, `usage`, `total_cost_usd`, refusal/`error_max_turns` subtypes).
- [ ] Verify the agentic build brief (`AGENT_SYSTEM_PROMPT`, `prompt_version = "a1"`)
      reliably produces a `dist/index.html` that passes the seal gate.
- [ ] Real prompt-to-bundle test: e.g. "make a playable single-player voxel sandbox".

### Phase 4 — Hosted sandbox (`sandbox.ts`)
- [ ] Implement the **Vercel Sandbox** provider behind the `BuildSandbox` interface
      (`SINGLETAKE_SANDBOX=vercel`). The interface + a local dev provider exist; the hosted
      providers are stubbed (`case "vercel"`/`"e2b"` commented out).
- [ ] Keep **E2B** interface-compatible as the alternative (`SINGLETAKE_SANDBOX=e2b`).
- [ ] Build-time egress allowlist (package registries only); ensure the agent process truly
      runs *inside* the sandbox, not on the app host (the local provider is dev-only and is
      NOT a security boundary).
- [ ] Guarantee teardown on success, user failure, and infra exception.

### Phase 5 — Worker integration with the real build
- [ ] Swap fake build for the sandboxed agent build in production (`runBuild` already
      dispatches when `hasRealAgent()` is true — needs a real run to confirm).
- [ ] Confirm the one-retry infra-vs-terminal distinction holds with real provider errors.

### Phase 5b — Open decision: artifact origin (§7.2)
- [ ] Production should serve artifacts from a **separate usercontent origin** (per-key
      subdomain or shared `usercontent.<host>`), with `frame-ancestors <APP_ORIGIN>` via
      `SINGLETAKE_APP_ORIGIN`, and the iframe using `sandbox="allow-scripts allow-same-origin"`.
      Today local dev is same-origin with `sandbox="allow-scripts"` (documented relaxation).

### Phase 5c — Render / OG gate (§5.8, currently skipped)
- [ ] Optional Playwright pass under the production CSP to reject blank/erroring first paint
      and capture the OG screenshot → `og_image_key` (currently published as `null`).

### Phase 7 — Cost governance
- [ ] Per-build budget ceiling using the SDK/CLI print-mode budget option (caps for max-turns
      + wall-clock exist; a hard spend cap does not).
- [ ] **Org-wide daily spend kill switch** (global throttle, not just per-user quota).

### Phase 8 — Build-log UX (§8, partially done)
- [ ] The discriminated build-event bus (`status` / `log` / `tool`) is emitted by the worker,
      but the SSE route only forwards `status` and no UI renders the live log/tool stream while
      `building`. Add log forwarding + a post-page build-log view (optional; SSE-only is fine,
      but persisted `build_events` would be better for replayable provenance).

### Misc / cleanup
- [ ] Legacy `scan.ts` (single-file scanner) and the old single-call `generate.ts` builder are
      now superseded by `seal.ts` + the agent path. `moderatePrompt` still lives in
      `generate.ts` and is used; the rest is dead code that can be removed.
- [ ] `db:seed` should seed some A (`verified=1`) posts, not only B, so the verified wall on
      `/generate` isn't empty cold.
- [ ] Add `@anthropic-ai/claude-agent-sdk` to a real install + lockfile once the agent path is
      validated (currently an `optionalDependency`, dynamically imported).

---

## Environment note
This repo needs **Node ≥18.18** (Next 15 + better-sqlite3 11). The dev box had Node 16, so
verification used a downloaded Node 20. `tsx` (the seed runner) pulls an esbuild binary whose
postinstall can fail on the wrong Node; `npm install --ignore-scripts` is enough for `tsc`.

## How to re-run the verification (Node ≥18.18)
- Type-check: `npx tsc --noEmit`
- Production build: `SINGLETAKE_SESSION_SECRET=dev npm run build`
- Pipeline + worker + serving + quota: drive `runJob()` against a temp DB with
  `SINGLETAKE_FAKE_BUILD=1` (a `building→live` post, bundle stored, route serves
  `/a/<key>/index.html` + relative assets, 404 on missing/traversal/bad key, A-only quota).
