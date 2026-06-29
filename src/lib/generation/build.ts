import "server-only";
import { createSandbox, type BuildSandbox } from "./sandbox";
import { fakeBuild } from "./fakebuild";
import { hasRealAgent, runAgentBuild, GEN_MODEL } from "./agent";
import { AGENT_PROMPT_VERSION } from "./prompt";

/**
 * Build dispatcher (plan §11 middle / §12). Creates a sandbox, runs either the
 * fake build (SINGLETAKE_FAKE_BUILD=1) or the real agentic build inside it, and
 * hands back the build directory for the seal gate plus build provenance.
 *
 * The caller owns disposal of the returned sandbox (the worker disposes in
 * `finally`, after sealing/publishing).
 */

export type BuildHooks = {
  log: (level: "info" | "warn" | "error", message: string) => void;
  tool: (name: string, summary: string) => void;
};

export type BuildProvenance = {
  modelId: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  turns: number;
  costUsd: number | null;
};

export type BuildOutcome =
  | { ok: true; sandbox: BuildSandbox; buildDir: string; provenance: BuildProvenance }
  // terminal: the user's single take failed (refusal / produced nothing usable)
  | { ok: false; terminal: true; kind: "refusal" | "build"; detail: string; sandbox: BuildSandbox };

const FAKE = () => process.env.SINGLETAKE_FAKE_BUILD === "1";

export async function runBuild(
  prompt: string,
  hooks: BuildHooks,
): Promise<BuildOutcome> {
  const sandbox = await createSandbox();

  // Fake build: canned multi-file dist, zero spend (plan §12).
  if (FAKE() || !hasRealAgent()) {
    hooks.log("info", FAKE() ? "fake build: writing canned bundle" : "no agent configured — using offline build");
    const p = fakeBuild(prompt, sandbox.root);
    hooks.tool("write", "dist/index.html, styles.css, app.js, meta.json");
    return {
      ok: true,
      sandbox,
      buildDir: sandbox.root,
      provenance: {
        modelId: "singletake-fakebuild",
        promptVersion: AGENT_PROMPT_VERSION,
        tokensIn: p.tokensIn,
        tokensOut: p.tokensOut,
        turns: p.turns,
        costUsd: 0,
      },
    };
  }

  // Real agentic build inside the sandbox (plan §3). A throw here propagates to
  // the worker as an infrastructure failure (one retry); a refusal is terminal.
  hooks.log("info", `agent build starting (${GEN_MODEL})`);
  const r = await runAgentBuild(prompt, sandbox, hooks);
  const provenance: BuildProvenance = {
    modelId: r.modelId,
    promptVersion: AGENT_PROMPT_VERSION,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    turns: r.turns,
    costUsd: r.costUsd,
  };
  if (r.refusal) {
    return { ok: false, terminal: true, kind: "refusal", detail: "the agent declined the prompt", sandbox };
  }
  return { ok: true, sandbox, buildDir: sandbox.root, provenance };
}
