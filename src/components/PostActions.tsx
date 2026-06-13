"use client";
import { useState } from "react";

export function PostActions({
  slug,
  prompt,
  resultUrl,
}: {
  slug: string;
  prompt: string;
  resultUrl: string | null;
}) {
  const [shared, setShared] = useState(false);
  const [stolen, setStolen] = useState(false);
  const [reported, setReported] = useState(false);
  const url = typeof window !== "undefined" ? `${location.origin}/p/${slug}` : `/p/${slug}`;

  return (
    <div className="prov-actions">
      {resultUrl && (
        <a className="pact primary" href={resultUrl} target="_blank" rel="noreferrer noopener">
          open result ↗ <span className="hint">new tab</span>
        </a>
      )}
      <button
        className="pact"
        onClick={() => {
          navigator.clipboard?.writeText(url).catch(() => {});
          setShared(true);
        }}
      >
        {shared ? "link copied ✓" : "share permalink"} <span className="hint">{`singletake.gg/p/${slug}`}</span>
      </button>
      <button
        className="pact"
        onClick={() => {
          navigator.clipboard?.writeText(prompt).catch(() => {});
          setStolen(true);
        }}
      >
        {stolen ? "stolen ✓" : "steal prompt"}{" "}
        <span className="hint">copies the prompt</span>
      </button>
      <button
        className="pact"
        onClick={async () => {
          await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_type: "post", target_id: slug, reason: "user report" }),
          }).catch(() => {});
          setReported(true);
        }}
      >
        {reported ? "reported ✓" : "report this post"}{" "}
        <span className="hint">sends it to the review queue</span>
      </button>
    </div>
  );
}
