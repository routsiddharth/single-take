"use client";
import { useState } from "react";
import Link from "next/link";
import { ago } from "@/lib/format";
import type { CommentRow } from "@/lib/queries";

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

function Remark({ c, opHandle }: { c: CommentRow; opHandle: string }) {
  const [score, setScore] = useState(c.score);
  const [vote, setVote] = useState(c.myVote);
  async function cast(dir: 1 | -1) {
    const next = vote === dir ? 0 : dir;
    setScore(score - vote + next);
    setVote(next);
    await fetch(`/api/comments/${c.id}/vote`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    }).catch(() => {});
  }
  return (
    <article className="remark">
      <div className="r-votes">
        <button className={`r-arrow up${vote === 1 ? " on" : ""}`} onClick={() => cast(1)} aria-label="upvote">
          {UP}
        </button>
        <div className={`r-score${score < 0 ? " neg" : ""}`}>{score < 0 ? `−${Math.abs(score)}` : score}</div>
        <button className={`r-arrow dn${vote === -1 ? " on" : ""}`} onClick={() => cast(-1)} aria-label="downvote">
          {DOWN}
        </button>
      </div>
      <div className="r-body">
        <div className="r-byline">
          <Link className="handle" href={`/u/${c.authorHandle}`}>
            @{c.authorHandle}
          </Link>
          <span className="when">{ago(c.createdAt)}</span>
          {c.authorHandle === opHandle && <span className="badge op">maker</span>}
        </div>
        <p className="r-text">{c.body}</p>
        <div className="r-acts">
          <a>reply</a>
          <a>share</a>
          <a>report</a>
        </div>
      </div>
    </article>
  );
}

export function CommentSection({
  slug,
  opHandle,
  signedIn,
  initial,
  initialCount,
}: {
  slug: string;
  opHandle: string;
  signedIn: boolean;
  initial: CommentRow[];
  initialCount: number;
}) {
  const [comments, setComments] = useState(initial);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const len = [...body].length;

  async function reSort(next: "top" | "new") {
    setSort(next);
    const res = await fetch(`/api/posts/${slug}/comments?sort=${next}`);
    if (res.ok) setComments((await res.json()).comments);
  }

  async function post() {
    if (posting || len === 0 || len > 1000) return;
    setPosting(true);
    setErr(null);
    const res = await fetch(`/api/posts/${slug}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "rejected");
      setPosting(false);
      return;
    }
    setComments([data.comment, ...comments]);
    setBody("");
    setPosting(false);
  }

  return (
    <>
      <div className="remarks-head">
        <h2>
          remarks <b>·</b> {initialCount} on record
        </h2>
        <span className="sortby">
          sorted by{" "}
          <a onClick={() => reSort(sort === "top" ? "new" : "top")}>
            {sort === "top" ? "loudest" : "newest"}
          </a>{" "}
          · remarks are permanent too
        </span>
      </div>

      {comments.length === 0 ? (
        <div className="empty">no remarks yet. sign the guestbook.</div>
      ) : (
        comments.map((c) => <Remark key={c.id} c={c} opHandle={opHandle} />)
      )}

      {signedIn ? (
        <section className="r-slip">
          <div className="r-slip-label">
            <div className="no">
              remark
              <br />№&nbsp;{initialCount + 1}
            </div>
            <div className="big">sign the guestbook</div>
          </div>
          <div className="r-slip-main">
            <textarea
              rows={2}
              maxLength={1000}
              placeholder="add your remark — it goes on the record, forever…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="r-slip-meta">
              <span>
                <b style={{ color: len > 940 ? "var(--red)" : undefined }}>{len}</b>/1000 —
                remarks cannot be edited.
              </span>
              <span>
                <b>NO DELETE · NO EDIT</b>
              </span>
            </div>
            {err && <div className="form-msg err">{err}</div>}
          </div>
          <div className="r-send-col">
            <button className="r-send-btn" disabled={posting || len === 0} onClick={post}>
              {posting ? "posting…" : "post remark"} ↗
            </button>
            <div className="r-send-sub">witnessed · notarized · permanent</div>
          </div>
        </section>
      ) : (
        <section className="r-slip">
          <div className="slip-signin" style={{ gridColumn: "1 / -1" }}>
            <span>remarks need an account.</span>
            <Link href="/auth/signin">sign in ↗</Link>
          </div>
        </section>
      )}
    </>
  );
}
