"use client";
import { useState } from "react";
import Link from "next/link";

export function LotActions({
  slug,
  prompt,
  resultUrl,
  commentCount,
}: {
  slug: string;
  prompt: string;
  resultUrl: string | null;
  commentCount: number;
}) {
  const [shared, setShared] = useState(false);
  const [stolen, setStolen] = useState(false);

  function copy(text: string, then: () => void) {
    navigator.clipboard?.writeText(text).catch(() => {});
    then();
  }

  const url =
    typeof window !== "undefined" ? `${window.location.origin}/p/${slug}` : `/p/${slug}`;

  return (
    <div className="lot-actions">
      <Link className="act" href={`/p/${slug}`}>
        <b>{commentCount}</b>&nbsp;comments
      </Link>
      {resultUrl && (
        <a className="act open-act" href={resultUrl} target="_blank" rel="noopener noreferrer">
          open result ↗
        </a>
      )}
      <button className="act" onClick={() => copy(url, () => setShared(true))}>
        {shared ? "link copied ✓" : "share permalink"}
      </button>
      <button className="act" onClick={() => copy(prompt, () => setStolen(true))}>
        {stolen ? "stolen ✓" : "steal prompt"}
      </button>
    </div>
  );
}
