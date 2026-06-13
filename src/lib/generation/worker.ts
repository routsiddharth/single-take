import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { posts, generationJobs, type ErrorKind } from "@/db/schema";
import { generate, moderatePrompt } from "./generate";
import { scanArtifact } from "./scan";
import { putArtifact } from "./store";
import { PROMPT_VERSION } from "./prompt";
import { emitStatus } from "./events";

/**
 * The generation worker (plan §3.2) — the heart. Steps:
 *   1 moderate-prompt   → blocked
 *   2 generate          → failed (refusal/truncation)
 *   3 extract+validate  → (folded into generate)
 *   4 scan              → failed (scan)
 *   5 upload            → content-addressed put
 *   6 screenshot        → (out of scope locally; OG falls back to a render)
 *   7 publish           → CAS to 'live'
 *
 * One-shot invariant (plan §2.1): the job row is claimed via an atomic
 * compare-and-swap so two runners can never both generate, and the terminal
 * publish is itself CAS-guarded (… WHERE id=? AND status='building').
 */

const failPost = sqlite.prepare(
  `UPDATE posts SET status='failed', error_kind=?, error_detail=? WHERE id=? AND status='building'`,
);
const blockPost = sqlite.prepare(
  `UPDATE posts SET status='blocked', error_kind='moderation', error_detail=? WHERE id=? AND status='building'`,
);
const publishPost = sqlite.prepare(
  `UPDATE posts SET status='live', artifact_key=?, og_image_key=?, model_id=?, prompt_version=?, tokens_in=?, tokens_out=?, generation_ms=? WHERE id=? AND status='building'`,
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
  try {
    // step 1 — moderate
    const verdict = await moderatePrompt(post.prompt);
    if (!verdict.allowed) {
      terminal(postId, "moderation", `blocked: ${verdict.category ?? "policy"}`);
      return;
    }

    // step 2/3 — generate + extract/validate
    const gen = await generate(post.prompt);
    if (!gen.html) {
      const detail =
        gen.error === "refusal"
          ? "the model declined the prompt"
          : "truncated at the output budget — cause of death: ambition";
      terminal(postId, gen.error ?? "truncation", detail);
      return;
    }

    // step 4 — static scan
    const scan = scanArtifact(gen.html);
    if (!scan.ok) {
      terminal(postId, "scan", `flagged by scan: ${scan.reason}`);
      return;
    }

    // step 5 — upload (content-addressed, if-not-exists)
    const { key } = putArtifact(gen.html);

    // step 6 — screenshot/OG: out of scope for the local build (Playwright in
    // the worker per plan §3.1). The feed card uses the live sandboxed iframe
    // as its own preview, so OG is non-fatal and left null here.

    // step 7 — publish (CAS guard — terminal-state safety)
    const res = publishPost.run(
      key,
      null,
      gen.modelId,
      PROMPT_VERSION,
      gen.tokensIn,
      gen.tokensOut,
      Date.now() - startedAt,
      postId,
    );
    finishJob.run("done", postId);
    if (res.changes > 0) emitStatus(postId, "live");
  } catch (err) {
    // Infra failure (not the user's dice roll). Mark failed-infrastructure and
    // flag the job for the single allowed system retry (plan §1.5).
    console.error(`[worker] post ${postId} infra failure:`, err);
    failPost.run("infrastructure", "our queue stumbled — system retry pending", postId);
    finishJob.run("queued", postId); // re-queue once for the sweeper / retry
    emitStatus(postId, "failed");
  }
}

/** Fire-and-forget kickoff used by POST /api/posts after the row is committed. */
export function enqueue(postId: string): void {
  // run on next tick so the HTTP response returns in <200ms (plan §2.1)
  queueMicrotask(() => {
    runJob(postId).catch((e) => console.error("[worker] runJob threw", e));
  });
}

/**
 * Sweeper (plan §10 Phase 3): any post stuck in 'building' for >10 min is a
 * zombie — mark it failed-infrastructure so it reaches a terminal state.
 */
export function sweepZombies(): number {
  const cutoff = new Date(Date.now() - 10 * 60_000);
  const stuck = db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.status, "building"), lt(posts.createdAt, cutoff)))
    .all();
  for (const { id } of stuck) {
    failPost.run("infrastructure", "stranded in building >10min — swept", id);
    finishJob.run("failed", id);
    emitStatus(id, "failed");
  }
  return stuck.length;
}
