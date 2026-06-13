"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Watches building lots hatch (plan §7.2). Opens ONE multiplexed SSE connection
 * for every visible building post; when any flips to a terminal status, refresh
 * the route so the card resolves in place — "you watch your own roll resolve in
 * public." This is the dopamine core.
 */
export function HatchWatcher({ ids }: { ids: string[] }) {
  const router = useRouter();
  useEffect(() => {
    if (ids.length === 0) return;
    const es = new EventSource(
      `/api/posts/_/events?ids=${encodeURIComponent(ids.join(","))}`,
    );
    es.onmessage = (e) => {
      try {
        const { status } = JSON.parse(e.data) as { id: string; status: string };
        if (status && status !== "building") {
          // small delay so the worker's commit is visible to the next read
          setTimeout(() => router.refresh(), 150);
        }
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [ids.join(","), router]);
  return null;
}
