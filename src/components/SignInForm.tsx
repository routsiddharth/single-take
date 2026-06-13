"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Verify = "idle" | "checking" | "ok";

const ERRORS: Record<string, string> = {
  google_unconfigured: "google sign-in isn't configured yet — use a magic link",
  google_denied: "google sign-in was cancelled",
  state: "that sign-in link expired — try again",
  unverified: "that google account has an unverified email",
  google: "google sign-in failed — try again",
};

/**
 * Sign-in: two paths, no handle here. Magic link (dev stand-in — no email is
 * actually sent locally) or Continue with Google. A handle is chosen afterwards
 * on /auth/handle for brand-new accounts.
 */
export function SignInForm({ error }: { error?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [verify, setVerify] = useState<Verify>("idle");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    error ? { kind: "err", text: ERRORS[error] ?? "something went wrong — try again" } : null,
  );

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const verified = verify === "ok";

  // Turnstile-style human check (stands in for the real Cloudflare widget).
  function runCheck() {
    if (busy) return;
    if (verify === "ok") return setVerify("idle");
    setVerify("checking");
    setMsg(null);
    setTimeout(() => setVerify("ok"), 650);
  }

  async function sendLink() {
    if (busy) return;
    if (!verified) {
      setMsg({ kind: "err", text: "complete the human check first" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error ?? "couldn't sign you in" });
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
          <div className="th-kicker">single take · sign in</div>
          <div className="th-title">your account</div>
        </div>
      </div>

      <div className="ticket-body">
        <div className="field">
          <div className="field-lbl">
            <span>your email</span>
            <span className="avail">we send a one-tap magic link</span>
          </div>
          <div className="inputwrap">
            <input
              className="email"
              type="email"
              value={email}
              spellCheck={false}
              placeholder="you@somewhere.tld"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendLink();
              }}
            />
          </div>
        </div>

        <div className="captcha">
          <button
            type="button"
            className={`box${verified ? " checked" : ""}${verify === "checking" ? " checking" : ""}`}
            onClick={runCheck}
            disabled={busy}
            aria-pressed={verified}
            aria-label="human verification"
          />
          <span className="txt">
            {verify === "checking"
              ? "verifying…"
              : verified
                ? "verified — you are human"
                : "prove you are a person"}
            <em>— machines don&apos;t get accounts.</em>
          </span>
          <span className="brand">
            turnstile
            <br />
            checkpoint
          </span>
        </div>

        <button className="magic-btn" disabled={busy || !emailOk || !verified} onClick={sendLink}>
          {busy ? "signing in…" : "sign in with magic link"} <span className="arr">→</span>
        </button>

        <div className="divider">or</div>
        <a className="google-btn" href="/api/auth/google">
          <span className="g">G</span>continue with google
        </a>

        {msg && <div className={`form-msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="legalese">
        by creating an account you accept the rules (left). handles are permanent. posts are
        permanent. no edits, no take-backs. © single take 2026.
      </div>
    </form>
  );
}
