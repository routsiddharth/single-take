"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MODELS } from "@/lib/models";

const MAX = 300;
type Mode = "a" | "b";

function isUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function Composer({
  signedIn,
  defaultMode = "a",
}: {
  signedIn: boolean;
  defaultMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [prompt, setPrompt] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [tool, setTool] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const len = [...prompt].length;
  const over = len > MAX;
  const linkOk = isUrl(resultUrl);

  // signed-out visitors browse freely; the nav holds the sign-in entry point.
  if (!signedIn) return null;

  const canSend =
    !sending &&
    !over &&
    len > 0 &&
    (mode === "a" || (linkOk && tool !== ""));

  const hint =
    len === 0
      ? "type your prompt"
      : mode === "a"
        ? "one shot. it builds, alone. no edits."
        : !linkOk
          ? "add the result link"
          : tool === ""
            ? "pick the model"
            : "no confirm. no edits.";

  async function send() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const body =
        mode === "a"
          ? { lane: "a", prompt }
          : { lane: "b", prompt, resultUrl: resultUrl.trim(), tool };
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "that one didn't go through");
        setSending(false);
        return;
      }
      setPrompt("");
      setResultUrl("");
      setTool("");
      router.refresh();
      router.push(`/p/${data.post.id}`);
    } catch {
      setError("lost connection. try again.");
      setSending(false);
    }
  }

  return (
    <section className="slip">
      <div className="slip-label">
        <div className="big">{mode === "a" ? "post the prompt" : "post a link"}</div>
        <div className="mode-switch slip-modes" role="tablist" aria-label="post mode">
          <button
            type="button"
            className={mode === "a" ? "on" : undefined}
            onClick={() => setMode("a")}
            disabled={sending}
            aria-selected={mode === "a"}
          >
            build it here <span className="spark">✦</span>
          </button>
          <button
            type="button"
            className={mode === "b" ? "on" : undefined}
            onClick={() => setMode("b")}
            disabled={sending}
            aria-selected={mode === "b"}
          >
            post a link
          </button>
        </div>
      </div>
      <div className="slip-main">
        <textarea
          rows={2}
          placeholder={
            mode === "a"
              ? "one prompt. an agent builds it, alone, in one session…"
              : "one prompt. whatever ships, ships…"
          }
          value={prompt}
          disabled={sending}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
          }}
        />
        <div className="slip-meta">
          <span className="count">
            <b className={over ? "warn" : ""}>{len}</b>/{MAX} —{" "}
            {mode === "a"
              ? "this exact string is handed to the agent. one shot per day."
              : "this exact string becomes the post. typos included."}
          </span>
        </div>
        {mode === "b" && (
          <div className="slip-fields">
            <input
              className="slip-input"
              type="text"
              placeholder="result link (vercel, codepen, a tweet…)"
              value={resultUrl}
              disabled={sending}
              onChange={(e) => setResultUrl(e.target.value)}
            />
            <div className="slip-select-wrap">
              <select
                className={`slip-select${tool === "" ? " empty" : ""}`}
                value={tool}
                disabled={sending}
                onChange={(e) => setTool(e.target.value)}
                aria-label="made with"
              >
                <option value="" disabled>
                  made with…
                </option>
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {tool === "" && <span className="slip-ph">made with…</span>}
            </div>
          </div>
        )}
        {error && (
          <div className="form-msg err" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>
      <div className="send-col">
        <button className="send-btn" disabled={!canSend} onClick={send}>
          {sending ? (mode === "a" ? "building…" : "posting…") : mode === "a" ? "build it" : "post it"}{" "}
          <span className="arr">↗</span>
        </button>
        <div className="send-sub">{hint}</div>
      </div>
    </section>
  );
}
