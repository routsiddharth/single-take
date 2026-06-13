"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Step two of sign-up: a verified identity (email shown, locked) picks its one
 * permanent handle. POSTs to /api/auth/handle, which reads the pending cookie.
 */
export function HandleForm({ email, name }: { email: string; name?: string }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const handleOk = /^[a-z0-9_]{3,20}$/.test(handle.toLowerCase());

  async function claim() {
    if (busy || !handleOk) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/handle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "couldn't claim that handle" });
        setBusy(false);
        return;
      }
      router.refresh();
      router.push(data.next ?? "/");
    } catch {
      setMsg({ kind: "err", text: "lost connection. try again." });
      setBusy(false);
    }
  }

  return (
    <form className="ticket" onSubmit={(e) => e.preventDefault()}>
      <div className="ticket-head">
        <div className="th-left">
          <div className="th-kicker">single take · finish sign-up</div>
          <div className="th-title">pick your handle</div>
        </div>
      </div>

      <div className="ticket-body">
        <div className="field">
          <div className="field-lbl">
            <span>signed in as</span>
            <span className="avail">
              <span className="ok">verified ✓</span>
            </span>
          </div>
          <div className="inputwrap locked-field">
            <input className="email" type="email" value={email} disabled readOnly />
          </div>
        </div>

        <div className="field">
          <div className="field-lbl">
            <span>your handle</span>
            <span className="avail">
              {handle ? (
                handleOk ? (
                  <>
                    @{handle.toLowerCase()} — <span className="ok">looks valid</span>
                  </>
                ) : (
                  "3–20 chars · a–z 0–9 _"
                )
              ) : name ? (
                `hi ${name.split(" ")[0]} — 3–20 chars · a–z 0–9 _`
              ) : (
                "3–20 chars · a–z 0–9 _"
              )}
            </span>
          </div>
          <div className="inputwrap">
            <span className="at">@</span>
            <input
              type="text"
              value={handle}
              spellCheck={false}
              autoFocus
              placeholder="null_set"
              onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") claim();
              }}
            />
          </div>
        </div>

        <button className="magic-btn" disabled={busy || !handleOk} onClick={claim}>
          {busy ? "claiming…" : "claim it"} <span className="arr">→</span>
        </button>
        <div className="magic-sub">
          your handle is <b>permanent</b> · it&apos;s your name on every post
        </div>

        {msg && (
          <div className={`form-msg ${msg.kind}`}>
            {msg.text}
            {msg.text.includes("expired") && (
              <>
                {" "}
                <a href="/auth/signin" style={{ textDecoration: "underline" }}>
                  start again ↗
                </a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="legalese">
        handles are permanent. posts are permanent. no edits, no take-backs. © single take 2026.
      </div>
    </form>
  );
}
