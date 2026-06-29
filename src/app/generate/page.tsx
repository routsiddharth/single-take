import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getFeed } from "@/lib/queries";
import { quotaFor } from "@/lib/quota";
import { Ticker, Masthead, Nav, Footer, ModeSwitch, SortTabs } from "@/components/chrome";
import { Composer } from "@/components/Composer";
import { LotCard } from "@/components/LotCard";
import { HatchWatcher } from "@/components/HatchWatcher";

export const dynamic = "force-dynamic";

export default async function GeneratePage() {
  const user = await currentUser();
  const quota = user ? quotaFor(user) : null;

  // recent verified one-shots — the A wall
  const verified = getFeed({ sort: "new", viewerId: user?.id })
    .items.filter((p) => p.verified)
    .slice(0, 12);

  return (
    <>
      <Ticker />
      <Masthead vol="the verified one-shot" />
      <Nav user={user} sorts={<SortTabs />} mid={<ModeSwitch active="verified" />} />

      <section className="verified-hero">
        <div className="cs-kicker">✦ the verified one-shot</div>
        <h1>
          post one prompt. <span className="alt">it builds, alone.</span>
        </h1>
        <p className="verified-lede">
          An autonomous coding agent takes your prompt into an isolated sandbox,
          builds a real static app, and we <b>seal it</b> into an immutable
          bundle hosted forever. No retries. No edits. Real provenance.
        </p>
      </section>

      {user ? (
        <>
          <Composer signedIn defaultMode="a" />
          {quota && (
            <div className="feed-head">
              <span className="left">
                today&apos;s shot —{" "}
                <b>{quota.remaining > 0 ? "1 build available" : "used"}</b>
              </span>
              <span className="right">one build per day · resets 00:00 UTC</span>
            </div>
          )}
        </>
      ) : (
        <div className="empty">
          <Link href="/auth/signin">sign in</Link> to take your one shot.
        </div>
      )}

      <div className="feed-head">
        <span className="left">
          the verified wall — <b>built &amp; sealed here</b>
        </span>
        <span className="right">verified · one prompt · one session</span>
      </div>

      {verified.length === 0 ? (
        <div className="empty">no verified builds yet. post the first prompt.</div>
      ) : (
        verified.map((p) => <LotCard key={p.id} p={p} />)
      )}

      <HatchWatcher ids={verified.filter((p) => p.status === "building").map((p) => p.id)} />

      <Footer
        left="verified one-shot · built here · sealed forever"
        links={
          <Link className="more" href="/">
            back to the feed ↑
          </Link>
        }
      />
    </>
  );
}
