import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getUserByHandle, getFeed, profileStats } from "@/lib/queries";
import { ago, num } from "@/lib/format";
import { Ticker, Masthead, Nav, Footer, ModeSwitch, SortTabs } from "@/components/chrome";
import { LogoutButton } from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

function lotNo(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return num(10_000 + (h % 89_000));
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const viewer = await currentUser();
  const dealer = getUserByHandle(handle);
  if (!dealer) notFound();
  const isMe = viewer?.id === dealer.id;

  const { items } = getFeed({ sort: "new", authorHandle: dealer.handle, viewerId: viewer?.id });
  const stats = profileStats(dealer.id);
  const best = items.reduce<typeof items[number] | null>(
    (b, p) => (!b || p.score > b.score) ? p : b,
    null,
  );

  return (
    <>
      <Ticker />
      <Masthead vol="profile" />
      <Nav user={viewer} sorts={<SortTabs />} mid={<ModeSwitch />} />

      <section className="dealer">
        <div className="dealer-main">
          <div className="dealer-kicker">
            <span className="tag">maker</span>
            {isMe && (
              <span className="since">
                <LogoutButton />
              </span>
            )}
          </div>
          <h2 className="dealer-handle">
            <span className="at">@</span>
            {dealer.handle}
          </h2>
          {dealer.bio && (
            <p className="dealer-bio">
              <span className="q">“</span>
              {dealer.bio}
              <span className="q">”</span>
            </p>
          )}
          <div className="dealer-foot">
            <span className="dim">
              creating since {new Date(dealer.createdAt).toUTCString().slice(5, 16)}
            </span>
          </div>
        </div>
      </section>

      <section className="record">
        <div className="stat">
          <div className="num">{num(dealer.postKarma)}</div>
          <div className="lbl">post karma</div>
        </div>
        <div className="stat">
          <div className="num">{num(dealer.commentKarma)}</div>
          <div className="lbl">comment karma</div>
        </div>
        <div className="stat">
          <div className="num">{stats.prompts ?? 0}</div>
          <div className="lbl">prompts shipped</div>
        </div>
        <div className="stat">
          {best ? (
            <Link className="bestlink" href={`/p/${best.id}`}>
              <div className="num">
                {num(best.score)}
                <small> pts</small>
              </div>
              <div className="lbl">top prompt — №{lotNo(best.id)}</div>
            </Link>
          ) : (
            <>
              <div className="num">—</div>
              <div className="lbl">no posts yet</div>
            </>
          )}
        </div>
      </section>

      <nav className="tabs">
        <a className="on">
          posts <b>{stats.prompts ?? 0}</b>
        </a>
        <span className="tabs-note">newest first</span>
      </nav>

      <div className="wall-head">
        <span className="left">
          prompts shipped — <b>newest first</b> · {items.length} posts shown
        </span>
        <span>singletake.gg/u/{dealer.handle}</span>
      </div>

      {items.length === 0 ? (
        <div className="empty">no posts yet.</div>
      ) : (
        <section className="wall">
          {items.map((p) => (
            <article key={p.id} className="tile">
              {best?.id === p.id && (
                <div className="best-tag">
                  top prompt · <b>№1</b>
                </div>
              )}
              {p.resultImage && (
                <div className="tile-vg">
                  <img src={p.resultImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}
              <div className="tile-body">
                <div className="tile-top">
                  <span className="no">№&nbsp;{lotNo(p.id)}</span>
                  <span className="when">{ago(p.createdAt)}</span>
                </div>
                <p className="tile-prompt">
                  <span className="q">"</span>
                  {p.prompt}
                  <span className="q">"</span>
                </p>
                <div className="tile-meta">
                  <span className={`pts${p.score < 0 ? " neg" : ""}`}>
                    {num(p.score)}
                  </span>
                  <span className="ptlbl">pts</span>
                  {p.tool && (
                    <>
                      <span className="sep">·</span>
                      <span className="dim">{p.tool}</span>
                    </>
                  )}
                  <Link className="open" href={`/p/${p.id}`}>
                    open ↗
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <Footer
        left={`@${dealer.handle}`}
        links={
          <Link className="more" href="/">
            back to the feed ↑
          </Link>
        }
      />
    </>
  );
}
