import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/auth";
import { Ticker, Masthead, Nav, Footer } from "@/components/chrome";
import { num } from "@/lib/format";

export const dynamic = "force-dynamic";

const ARTICLES = [
  { n: "1", lbl: "rule 1 -- the prompt", legal: <>Every post is exactly <span className="hl">one prompt</span>, up to three hundred (300) characters, sent as typed.</>, gloss: <><b>plain version:</b> your prompt is the whole entry, typos and all. the exact string you type is what everyone sees.</>, stamp: "as-is", stampClass: "", note: "we do not spell-check it for you." },
  { n: "2", lbl: "rule 2 -- link the result", legal: <>If you hosted the result, <span className="hl">link it</span> - any tool, anywhere.</>, gloss: <><b>plain version:</b> post prompt-only if you like, or point to where your result lives. Claude, GPT, v0, Midjourney, wherever.</>, stamp: "or not", stampClass: "", note: "prompt-only posts are allowed." },
  { n: "3", lbl: "rule 3 -- upvote + comment", legal: <>Vote on the best, comment freely. <span className="hl">No edits</span> - posts cannot be changed.</>, gloss: <><b>plain version:</b> the prompt is the record. it never changes. you can vote, you can remark, but the original stands.</>, stamp: "as written", stampClass: "inkfill", note: "permanent means permanent." },
  { n: "4", lbl: "rule 4 -- instant", legal: <>Posted <span className="hl">instantly</span>. No draft, no preview, no confirm step.</>, gloss: <><b>plain version:</b> the moment you hit send, its public. the button is the whole commitment.</>, stamp: "sent ↗", stampClass: "", note: "there is no confirm here." },
] as const;

export default async function AboutPage() {
  const user = await currentUser();
  const stats = db
    .all<{ total: number }>(sql`
      SELECT COUNT(*) AS total FROM posts WHERE status != 'removed'
    `)[0];

  return (
    <>
      <Ticker />
      <Masthead vol="the rules" />
      <Nav
        user={user}
        sorts={
          <>
            <Link href="/?sort=hot"><span className="flame">▲</span>hot</Link>
            <Link href="/?sort=new"><span className="flame">○</span>new</Link>
            <Link href="/?sort=top"><span className="flame">№1</span>top</Link>
            <Link className="on" href="/about"><span className="flame">§</span>about</Link>
          </>
        }
        mid={<>the rules · they apply to everyone, including the model</>}
      />

      <section className="billboard">
        <div className="bill-kicker">
          <span className="doc">
            <b>DOC. 001-A</b> the manifesto, notarized
          </span>
          <span>filed in public · cannot be unfiled</span>
        </div>
        <h2 className="manifesto">
          post the prompt. <span className="shot">link the result.</span>
          <br />
          upvote the best.
        </h2>
        <p className="manifesto-sub">
          the prompt is <b>the whole record</b>. nothing gets edited.
        </p>
        <div className="bill-stamp">
          no take-backs<small>certified · est. 2026</small>
        </div>
      </section>

      <div className="sec-head">
        <span className="left">
          the rules -- <b>the short version</b>
        </span>
        <span>four rules · that&apos;s all there is</span>
      </div>

      <section className="cos-title">
        <h2>
          the
          <br />
          <span>rules</span>
        </h2>
        <p className="note">
          posting means you&apos;re fine with the rules below. there is no rule eight.
        </p>
      </section>

      {ARTICLES.map((a) => (
        <article className="article" key={a.n}>
          <div className="art-num">
            <div className="n">{a.n}</div>
            <div className="lbl">{a.lbl}</div>
          </div>
          <div className="art-body">
            <p className="art-legal">{a.legal}</p>
            <p className="art-gloss">{a.gloss}</p>
          </div>
          <div className="art-side">
            <span className={`side-stamp ${a.stampClass}`}>{a.stamp}</span>
            <p className="side-note">{a.note}</p>
          </div>
        </article>
      ))}

      <article className="article tinted">
        <div className="art-num">
          <div className="n">5</div>
          <div className="lbl">coming soon -- the verified one-shot ✨</div>
        </div>
        <div className="art-body">
          <p className="art-legal">
            Generate it here. <span className="hl">No retries. No edits.</span> Real provenance. A permanent immutable artifact.
          </p>
          <p className="art-gloss">
            <b>plain version:</b> the thing crossposts can't prove. coming soon when we get some API credits.
          </p>
        </div>
        <div className="art-side">
          <span className="side-stamp">coming soon</span>
          <p className="side-note">working on it. patience.</p>
        </div>
      </article>

      <div className="sec-head">
        <span className="left">
          appendix b -- <b>the ledger</b>
        </span>
        <span>live numbers · straight from the feed</span>
      </div>
      <section className="stats">
        <div className="stat">
          <div className="big">{num(stats.total ?? 0)}</div>
          <div className="lbl">prompts posted</div>
          <p className="fine">every one of them permanent.</p>
        </div>
      </section>

      <section className="signoff">
        <div className="seal">
          the seal<small>accepted the moment you send</small>
        </div>
        <p className="line">
          that&apos;s everything. post the prompt, link the result, and{" "}
          <b>let it live.</b>
        </p>
        <Link className="cta" href="/">
          post your prompt <span className="arr">↗</span>
        </Link>
        <div className="sub">the prompt is the record · nothing gets edited</div>
      </section>

      <Footer
        left="single take · est. 2026 · every link is permanent"
        links={
          <Link className="more" href="/">
            back to the feed ↓
          </Link>
        }
      />
    </>
  );
}
