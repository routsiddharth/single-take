import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Ticker, Masthead, Nav, Footer, ModeSwitch, SortTabs } from "@/components/chrome";

export default async function GeneratePage() {
  const user = await currentUser();

  return (
    <>
      <Ticker />
      <Masthead vol="coming soon" />
      <Nav user={user} sorts={<SortTabs />} mid={<ModeSwitch active="verified" />} />

      <div className="coming-soon">
        <div className="coming-soon-content">
          <div className="cs-kicker">coming soon</div>
          <h1>
            the verified <span className="alt">one-shot.</span>
          </h1>
          <p className="cs-lede">
            Generated here — no retries, no edits, real provenance, a permanent
            immutable artifact. <b>The thing crossposts can&apos;t prove.</b>
          </p>
          <p className="cs-note">working on getting some API credits.</p>
        </div>
      </div>

      <Footer
        left="coming soon"
        links={
          <Link className="more" href="/">
            back to the feed ↑
          </Link>
        }
      />
    </>
  );
}
