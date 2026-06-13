/**
 * The canonical "made with" roster. Posts must declare which model built the
 * result, chosen from this flat list — no free text, so the `tool` label stays
 * consistent across the feed. Shared by the composer (<select>) and the
 * create-post route (server-side validation).
 *
 * Curated for breadth across current (non-deprecated) models; extend freely.
 * "Other" is the catch-all so nothing is un-postable.
 */
export const MODELS: string[] = [
  // Anthropic — Claude
  "Claude Opus 4.8",
  "Claude Sonnet 4.6",
  "Claude Haiku 4.5",
  "Claude Fable 5",
  // OpenAI
  "GPT-5",
  "GPT-5 mini",
  "GPT-4.1",
  "GPT-4o",
  "o4-mini",
  "o3",
  // Google — Gemini
  "Gemini 2.5 Pro",
  "Gemini 2.5 Flash",
  "Gemini 2.0 Flash",
  // xAI — Grok
  "Grok 4",
  "Grok 3",
  // DeepSeek
  "DeepSeek V3",
  "DeepSeek R1",
  // Moonshot — Kimi
  "Kimi K2",
  "Kimi K1.5",
  // Alibaba — Qwen
  "Qwen3 Max",
  "Qwen3",
  "Qwen2.5 Max",
  // Meta — Llama
  "Llama 4 Maverick",
  "Llama 4 Scout",
  "Llama 3.3",
  // Mistral
  "Mistral Large",
  "Mistral Medium",
  "Codestral",
  // Builders & other tools
  "v0",
  "Cursor",
  "Lovable",
  "Bolt",
  "Replit Agent",
  "Midjourney",
  "Other",
];

export const MODEL_VALUES = MODELS;

export function isKnownModel(v: string): boolean {
  return MODELS.includes(v);
}
