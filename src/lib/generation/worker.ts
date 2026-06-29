import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { posts, generationJobs, type ErrorKind } from "@/db/schema";
import { moderatePrompt } from "./generate";
import { runBuild } from "./build";
import { sealGate } from "./seal";
import { putBundle } from "./store";
import { emitStatus, emitLog, emitTool } from "./events";

/**
 * The generation worker (plan §11) — the heart. The control structure (claim
 * CAS, terminal helper, publish CAS, infra-retry) is preserved; the middle is
 * the agentic build:
 *   1 moderate-prompt   → blocked
 *   2 build (sandbox)   → refusal/build (terminal) | throw (infra retry)
 *   3 seal gate         → scan/seal (terminal)
 *   4 putBundle         → content-addressed bundle store
 *   5 publish           → CAS to 'live' with provenance
 *   6 dispose sandbox   → always (finally)
 *
 * One-shot invariant (plan §10): the job row is claimed via an atomic
 * compare-and-swap so two runners can never both build, and the terminal
 * publish is itself CAS-guarded (… WHERE id=? AND status='building').
 */

const BUILD_CAP_MS = Number(process.env.SINGLETAKE_BUILD_TIMEOUT_MS) || 25 * 60_000;

const failPost = sqlite.prepare(
  `UPDATE posts SET status='failed', error_kind=?, error_detail=? WHERE id=? AND status='building'`,
);
const blockPost = sqlite.prepare(
  `UPDATE posts SET status='blocked', error_kind='moderation', error_detail=? WHERE id=? AND status='building'`,
);
const publishPost = sqlite.prepare(
  `UPDATE posts SET status='live', artifact_key=?, og_image_key=?, model_id=?, prompt_version=?,
     tokens_in=?, tokens_out=?, generation_ms=?, build_turns=?, cost_usd=?, bundle_bytes=?, file_count=?
   WHERE id=? AND status='building'`,
);
const claimJob = sqlite.prepare(
  `UPDATE generation_jobs SET status='running', attempt=attempt+1, claimed_at=(unixepoch()*1000) WHERE post_id=? AND status='queued'`,
);
const finishJob = sqlite.prepare(
  `UPDATE generation_jobs SET status=?, finished_at=(unixepoch()*1000) WHERE post_id=?`,
);

function terminal(postId: string, kind: ErrorKind, detail: string) {
  if (kind === "moderation") blockPost.run(detail, postId);
  else failPost.run(kind, detail, postId);
  finishJob.run("failed", postId);
  const status = kind === "moderation" ? "blocked" : "failed";
  emitStatus(postId, status);
}

/** Per-post build-event hooks with light throttling so the log stays readable. */
function makeHooks(postId: string) {
  let last = 0;
  return {
    log(level: "info" | "warn" | "error", message: string) {
      const t = Date.now();
      if (level === "info" && t - last < 120) return; // throttle chatty info
      last = t;
      emitLog(postId, level, message);
    },
    tool(name: string, summary: string) {
      emitTool(postId, name, summary);
    },
  };
}

export async function runJob(postId: string): Promise<void> {
  // Atomic claim — only one runner wins the CAS.
  const claim = claimJob.run(postId);
  if (claim.changes === 0) return; // already running/done elsewhere

  const post = db.select().from(posts).where(eq(posts.id, postId)).get();
  if (!post || post.status !== "building") {
    finishJob.run("done", postId);
    return;
  }

  const startedAt = Date.now();
  const hooks = makeHooks(postId);
  let sandbox: { dispose: () => Promise<void> } | null = null;

  // Hard wall-clock backstop: if the build hangs past the cap, fail terminally.
  const wallClock = setTimeout(() => {
    terminal(postId, "infrastructure", "build exceeded the time cap");
  }, BUILD_CAP_MS + 30_000);

  try {
    // step 1 — moderate
    const verdict = await moderatePrompt(post.prompt);
    if (!verdict.allowed) {
      terminal(postId, "moderation", `blocked: ${verdict.category ?? "policy"}`);
      return;
    }

    // step 2 — build inside the sandbox (fake or agentic)
    const build = await runBuild(post.prompt, hooks);
    sandbox = build.sandbox;
    if (!build.ok) {
      terminal(postId, build.kind, build.detail);
      return;
    }

    // step 3 — seal gate (static-only, tree-wide scan, budgets)
    emitLog(postId, "info", "sealing build…");
    const seal = sealGate(build.buildDir);
    if (!seal.ok) {
      terminal(postId, seal.kind, `failed the seal gate: ${seal.reason}`);
      return;
    }

    // step 4 — store the content-addressed bundle
    const { key, bytes, fileCount } = putBundle(seal.distDir);

    // step 5 — publish (CAS guard — terminal-state safety)
    const prov = build.provenance;
    const res = publishPost.run(
      key,
      null, // og_image_key — render/screenshot gate is behind a flag (plan §5.8)
      prov.modelId,
      prov.promptVersion,
      prov.tokensIn,
      prov.tokensOut,
      Date.now() - startedAt,
      prov.turns,
      prov.costUsd,
      bytes,
      fileCount,
      postId,
    );
    finishJob.run("done", postId);
    if (res.changes > 0) {
      emitLog(postId, "info", `sealed · ${fileCount} files · ${bytes} bytes`);
      emitStatus(postId, "live");
    }
  } catch (err) {
    // Infra failure (not the user's dice roll). Mark failed-infrastructure and
    // flag the job for the single allowed system retry (plan §11).
    console.error(`[worker] post ${postId} infra failure:`, err);
    failPost.run("infrastructure", "our queue stumbled — system retry pending", postId);
    finishJob.run("queued", postId); // re-queue once for the sweeper / retry
    emitStatus(postId, "failed");
  } finally {
    clearTimeout(wallClock);
    if (sandbox) await sandbox.dispose().catch(() => {});
  }
}

/** Fire-and-forget kickoff used by POST /api/posts after the row is committed. */
export function enqueue(postId: string): void {
  // run on next tick so the HTTP response returns fast (plan §2)
  queueMicrotask(() => {
    runJob(postId).catch((e) => console.error("[worker] runJob threw", e));
  });
}

/**
 * Sweeper (plan §11): any post stuck in 'building' past the build cap is a
 * zombie — mark it failed-infrastructure so it reaches a terminal state. Cutoff
 * is widened above the intended build cap (40 min) so a legitimately long agent
 * build is never swept mid-flight.
 */
const ZOMBIE_CUTOFF_MS = Math.max(40 * 60_000, BUILD_CAP_MS + 10 * 60_000);

export function sweepZombies(): number {
  const cutoff = new Date(Date.now() - ZOMBIE_CUTOFF_MS);
  const stuck = db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.status, "building"), lt(posts.createdAt, cutoff)))
    .all();
  for (const { id } of stuck) {
    failPost.run("infrastructure", "stranded in building — swept", id);
    finishJob.run("failed", id);
    emitStatus(id, "failed");
  }
  return stuck.length;
}
