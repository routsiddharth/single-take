import "server-only";
import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for post status transitions, consumed by the SSE endpoint
 * (plan §2.1 / §5.6). Stands in for Inngest's `post.live` fanout. Single dev
 * process → a Node EventEmitter is enough; the SSE route also polls the DB as a
 * fallback so a missed event never strands a "building" card.
 */
type StatusPayload = { postId: string; status: string };

const g = globalThis as unknown as { __singleTakeBus?: EventEmitter };
const bus = g.__singleTakeBus ?? new EventEmitter();
bus.setMaxListeners(0);
g.__singleTakeBus = bus;

export function emitStatus(postId: string, status: string): void {
  bus.emit("status", { postId, status } satisfies StatusPayload);
}

export function onStatus(fn: (p: StatusPayload) => void): () => void {
  bus.on("status", fn);
  return () => bus.off("status", fn);
}
