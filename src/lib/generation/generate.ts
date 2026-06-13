import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, userMessage } from "./prompt";
import { stubArtifact } from "./stub";

const GEN_MODEL = process.env.SINGLETAKE_GEN_MODEL ?? "claude-sonnet-4-6";
const MOD_MODEL = process.env.SINGLETAKE_MOD_MODEL ?? "claude-haiku-4-5";
const MAX_OUTPUT = 64_000; // output budget (plan §1.4); Sonnet 4.6 streams up to 64K

export type GenError = "truncation" | "refusal";
export type GenResult = {
  html: string | null;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  error?: GenError;
};

let _client: Anthropic | null = null;
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export function hasRealGeneration(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Pull the single HTML document out of the model's fenced reply (plan §3.2 step 3). */
export function extractHtml(raw: string): string | null {
  const fenced = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.search(/<!doctype html|<html[\s>]/i);
  if (start === -1) return null;
  return body.slice(start).trim();
}

/**
 * Generation (plan §3.2 step 2). Streams the Claude call and assembles the
 * result. If ANTHROPIC_API_KEY is unset, falls back to a built-in stub that
 * still produces a real, self-contained artifact so the whole loop works.
 */
export async function generate(prompt: string): Promise<GenResult> {
  const api = client();
  if (!api) {
    const html = stubArtifact(prompt);
    return {
      html,
      modelId: "singletake-stub-v0",
      tokensIn: Math.ceil(prompt.length / 4),
      tokensOut: Math.ceil(html.length / 4),
    };
  }

  const stream = api.messages.stream({
    model: GEN_MODEL,
    max_tokens: MAX_OUTPUT,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage(prompt) }],
  });
  const msg = await stream.finalMessage();

  const tokensIn = msg.usage.input_tokens ?? 0;
  const tokensOut = msg.usage.output_tokens ?? 0;

  // "refusal" is a newer stop_reason; cast since the pinned SDK type predates it.
  if ((msg.stop_reason as string) === "refusal") {
    return { html: null, modelId: GEN_MODEL, tokensIn, tokensOut, error: "refusal" };
  }

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const html = extractHtml(text);
  // max_tokens means the model ran out of room → truncated artifact = failed
  if (msg.stop_reason === "max_tokens" || !html) {
    return {
      html: null,
      modelId: GEN_MODEL,
      tokensIn,
      tokensOut,
      error: "truncation",
    };
  }

  return { html, modelId: GEN_MODEL, tokensIn, tokensOut };
}

export type ModerationVerdict = { allowed: boolean; category?: string };

/**
 * Pre-generation prompt moderation (plan §3.2 step 1). Haiku-class classifier.
 * Returns allowed=true when no API key (the stub generator is harmless and
 * local dogfooding shouldn't be gated).
 */
export async function moderatePrompt(prompt: string): Promise<ModerationVerdict> {
  const api = client();
  if (!api) return { allowed: true };

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      allowed: { type: "boolean" },
      category: {
        type: "string",
        enum: ["ok", "phishing", "malware", "csam", "doxxing", "threats", "other"],
      },
    },
    required: ["allowed", "category"],
  } as const;

  try {
    const res = await api.messages.create({
      model: MOD_MODEL,
      max_tokens: 200,
      system:
        "You screen prompts for an app that turns each prompt into a self-contained HTML artifact (no network access). Block ONLY prompts whose clear intent is phishing / deceptive replicas of real login pages, malware, CSAM, doxxing, or credible threats. Edgy, ugly, offensive-but-legal, or weird creative prompts are ALLOWED. Respond with the structured verdict.",
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const block = res.content.find((b) => b.type === "text") as
      | Anthropic.TextBlock
      | undefined;
    if (!block) return { allowed: true };
    const parsed = JSON.parse(block.text) as { allowed: boolean; category: string };
    return { allowed: parsed.allowed, category: parsed.category };
  } catch {
    // fail-open on classifier error — infra failure isn't the user's dice roll
    return { allowed: true };
  }
}

export { GEN_MODEL, MOD_MODEL };
