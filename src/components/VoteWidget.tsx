"use client";
import { useState } from "react";
import { score as fmtScore } from "@/lib/format";

const UP = (
  <svg viewBox="0 0 34 24">
    <polygon points="17,3 31,21 3,21" />
  </svg>
);
const DOWN = (
  <svg viewBox="0 0 34 24">
    <polygon points="17,21 3,3 31,3" />
  </svg>
);

/** Up/down vote column. Optimistic; reconciles with the server response.
 *  One vote per user per post, switchable + removable (plan §1.6). */
export function VoteWidget({
  postId,
  initialScore,
  initialVote,
  variant = "lot",
  lotNo,
}: {
  postId: string;
  initialScore: number;
  initialVote: number;
  variant?: "lot" | "placard";
  lotNo?: string;
}) {
  const [scoreVal, setScore] = useState(initialScore);
  const [vote, setVote] = useState(initialVote);
  const [busy, setBusy] = useState(false);

  async function cast(dir: 1 | -1) {
    if (busy) return;
    const next = vote === dir ? 0 : dir;
    const prevScore = scoreVal;
    const prevVote = vote;
    setScore(scoreVal - vote + next);
    setVote(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/vote`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { score: number; myVote: number };
      setScore(data.score);
      setVote(data.myVote);
    } catch {
      setScore(prevScore);
      setVote(prevVote);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="votes">
      <button
        className={`arrow up${vote === 1 ? " on" : ""}`}
        aria-label="upvote"
        onClick={() => cast(1)}
      >
        {UP}
      </button>
      <div className={`score${scoreVal < 0 ? " neg" : ""}`}>
        {fmtScore(scoreVal)}
      </div>
      <div className="score-lbl">points</div>
      <button
        className={`arrow dn${vote === -1 ? " on" : ""}`}
        aria-label="downvote"
        onClick={() => cast(-1)}
      >
        {DOWN}
      </button>
      {variant === "lot" && lotNo && <div className="lotno">№&nbsp;{lotNo}</div>}
      {variant === "placard" && (
        <div className="vote-note">votes are permanent too.</div>
      )}
    </div>
  );
}
