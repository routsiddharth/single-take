import "server-only";
import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for build events (plan §8), consumed by the SSE endpoint.
 * Single dev process → a Node EventEmitter is enough; the SSE route also polls
 * the DB as a fallback so a missed status event never strands a "building" card.
 *
 * The stream is a discriminated union: status transitions, throttled build-log
 * lines, and summarized tool calls. We stream summaries, never raw token deltas.
 */
export type BuildBusEvent =
  | { type: "status"; postId: string; status: string }
  | { type: "log"; postId: string; level: "info" | "warn" | "error"; message: string; ts: number }
  | { type: "tool"; postId: string; name: string; summary: string; ts: number };

const g = globalThis as unknown as { __singleTakeBus?: EventEmitter };
const bus = g.__singleTakeBus ?? new EventEmitter();
bus.setMaxListeners(0);
g.__singleTakeBus = bus;

function now(): number {
  return Date.now();
}

export function emitStatus(postId: string, status: string): void {
  bus.emit("event", { type: "status", postId, status } satisfies BuildBusEvent);
}

export function emitLog(
  postId: string,
  level: "info" | "warn" | "error",
  message: string,
): void {
  bus.emit("event", { type: "log", postId, level, message, ts: now() } satisfies BuildBusEvent);
}

export function emitTool(postId: string, name: string, summary: string): void {
  bus.emit("event", { type: "tool", postId, name, summary, ts: now() } satisfies BuildBusEvent);
}

export function onEvent(fn: (e: BuildBusEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}

/** Back-compat helper: subscribe to status transitions only. */
export function onStatus(fn: (p: { postId: string; status: string }) => void): () => void {
  const handler = (e: BuildBusEvent) => {
    if (e.type === "status") fn({ postId: e.postId, status: e.status });
  };
  bus.on("event", handler);
  return () => bus.off("event", handler);
}
