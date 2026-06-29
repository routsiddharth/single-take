import "server-only";
import type { BuildSandbox } from "./sandbox";
import { AGENT_SYSTEM_PROMPT } from "./prompt";

/**
 * The Claude Code agent engine (plan §3). Drives an autonomous build session
 * with the official Agent SDK `query()`, run with `permissionMode:
 * "bypassPermissions"` — safe ONLY because it executes inside the sandbox
 * (§3.1). Caps: max turns (env), a wall-clock timeout, and the sandbox lifetime
 * as a backstop (§3.4).
 *
 * The SDK is an optional dependency: it is imported dynamically through a
 * runtime specifier so a missing package never breaks `next build`. The worker
 * only calls this path when `hasRealAgent()` is true.
 */

const GEN_MODEL = process.env.SINGLETAKE_GEN_MODEL ?? "claude-sonnet-4-6";
const MAX_TURNS = Number(process.env.SINGLETAKE_MAX_TURNS) || 60;
const WALL_CLOCK_MS = Number(process.env.SINGLETAKE_BUILD_TIMEOUT_MS) || 25 * 60_000;
const SDK_PKG = "@anthropic-ai/claude-agent-sdk";

export type AgentHooks = {
  log: (level: "info" | "warn" | "error", message: string) => void;
  tool: (name: string, summary: string) => void;
};

export type AgentResult = {
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  turns: number;
  costUsd: number | null;
  refusal: boolean;
};

/** True when a real sandboxed agent build should run (key present, fake off). */
export function hasRealAgent(): boolean {
  return (
    !!process.env.ANTHROPIC_API_KEY && process.env.SINGLETAKE_FAKE_BUILD !== "1"
  );
}

// Hide the specifier from the bundler so a missing optional dep is a runtime
// (catchable) failure, not a build-time resolution error.
const dynamicImport: (s: string) => Promise<unknown> = new Function(
  "s",
  "return import(s)",
) as (s: string) => Promise<unknown>;

function shortSummary(input: unknown): string {
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input);
    return s.length > 140 ? s.slice(0, 137) + "…" : s;
  } catch {
    return "";
  }
}

/**
 * Run the agent inside `sandbox`, building into `sandbox.root`. Returns
 * provenance on completion. Throws on SDK/transport failure (the worker treats
 * a throw as infrastructure and retries once). A refusal is signalled via
 * `result.refusal` (terminal, not a throw).
 */
export async function runAgentBuild(
  prompt: string,
  sandbox: BuildSandbox,
  hooks: AgentHooks,
): Promise<AgentResult> {
  const mod = (await dynamicImport(SDK_PKG)) as {
    query: (args: unknown) => AsyncIterable<Record<string, unknown>>;
  };
  const { query } = mod;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), WALL_CLOCK_MS);

  let tokensIn = 0;
  let tokensOut = 0;
  let turns = 0;
  let costUsd: number | null = null;
  let refusal = false;

  try {
    const iterator = query({
      prompt:
        `${prompt}\n\n---\nBuild this as a static offline app. ` +
        `Produce dist/index.html. The project root is your working directory.`,
      options: {
        cwd: sandbox.root,
        systemPrompt: AGENT_SYSTEM_PROMPT,
        model: GEN_MODEL,
        permissionMode: "bypassPermissions", // safe only inside the sandbox (§3.1)
        maxTurns: MAX_TURNS,
        abortController: abort,
      },
    });

    for await (const message of iterator) {
      const type = String(message.type ?? "");
      if (type === "assistant" || type === "user") turns++;

      // surface tool calls as build events (throttled by the caller)
      const content = (message as { message?: { content?: unknown[] } }).message
        ?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_use") {
            hooks.tool(String(b.name ?? "tool"), shortSummary(b.input));
          } else if (b.type === "text" && typeof b.text === "string") {
            const t = b.text.trim();
            if (t) hooks.log("info", shortSummary(t));
          }
        }
      }

      if (type === "result") {
        const usage = (message as { usage?: Record<string, number> }).usage;
        if (usage) {
          tokensIn += usage.input_tokens ?? 0;
          tokensOut += usage.output_tokens ?? 0;
        }
        const cost = (message as { total_cost_usd?: number }).total_cost_usd;
        if (typeof cost === "number") costUsd = cost;
        const subtype = String((message as { subtype?: string }).subtype ?? "");
        if (subtype.includes("refus") || subtype.includes("error_max_turns")) {
          if (subtype.includes("refus")) refusal = true;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }

  return {
    modelId: GEN_MODEL,
    tokensIn,
    tokensOut,
    turns: Math.max(turns, 1),
    costUsd,
    refusal,
  };
}

export { GEN_MODEL };
