import { NextRequest } from "next/server";
import { db } from "@/db";
import { posts } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { onStatus } from "@/lib/generation/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE status stream (plan §5.6 / §7.2). The feed multiplexes ONE connection for
 * all visible building posts via ?ids=a,b,c. Emits {id,status} on every
 * transition so cards visibly "hatch" building → live/failed. Also does an
 * initial DB sweep (covers a transition that fired before the client connected)
 * and a slow poll fallback so a dropped in-process event never strands a card.
 */
export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  if (ids.length === 0) return new Response("no ids", { status: 400 });

  const watching = new Set(ids);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (id: string, status: string) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ id, status })}\n\n`),
        );
        if (status !== "building") {
          watching.delete(id);
          if (watching.size === 0) close();
        }
      };

      // 1) initial sweep — anything already terminal gets reported immediately
      const rows = db
        .select({ id: posts.id, status: posts.status })
        .from(posts)
        .where(inArray(posts.id, ids))
        .all();
      for (const r of rows) {
        if (r.status !== "building") send(r.id, r.status);
      }

      // 2) live in-process events
      const off = onStatus(({ postId, status }) => {
        if (watching.has(postId)) send(postId, status);
      });

      // 3) heartbeat + DB poll fallback every 4s
      const poll = setInterval(() => {
        if (closed || watching.size === 0) return;
        controller.enqueue(encoder.encode(`: ping\n\n`));
        const live = db
          .select({ id: posts.id, status: posts.status })
          .from(posts)
          .where(inArray(posts.id, [...watching]))
          .all();
        for (const r of live) if (r.status !== "building") send(r.id, r.status);
      }, 4000);

      function close() {
        if (closed) return;
        closed = true;
        off();
        clearInterval(poll);
        try {
          controller.close();
        } catch {}
      }

      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
