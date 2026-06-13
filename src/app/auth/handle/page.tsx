import { redirect } from "next/navigation";
import { currentUser, getPending } from "@/lib/auth";
import { Ticker, Masthead, Nav, ModeSwitch, SortTabs } from "@/components/chrome";
import { HandleForm } from "@/components/HandleForm";

export const dynamic = "force-dynamic";

export default async function HandlePage() {
  const user = await currentUser();
  if (user) redirect(`/u/${user.handle}`);

  // Must arrive here with a verified-but-handle-less identity.
  const pending = await getPending();
  if (!pending) redirect("/auth/signin");

  return (
    <>
      <Ticker />
      <Masthead vol="finish sign-up" compact />
      <Nav user={null} sorts={<SortTabs />} mid={<ModeSwitch />} />

      <main className="spread">
        <section className="pitch">
          <div className="pitch-kicker">
            <span className="no">FORM 1-B</span>
            <span className="line" />
            <span>choose your name</span>
          </div>
          <h2>
            almost in.
            <span className="alt">
              pick your <em>handle.</em>
            </span>
          </h2>
          <p className="pitch-sub">
            Your email is verified. Now choose the handle that goes on every prompt you post — it&apos;s
            permanent, so make it one you&apos;ll stand behind.
          </p>
        </section>

        <section className="desk">
          <div className="desk-note">
            <span>last step</span>
            <span>tear here ✂ — — — — —</span>
          </div>
          <HandleForm email={pending.email} name={pending.name} />
          <div className="stub">
            <span className="ret">one handle per account · permanent · no renames.</span>
          </div>
        </section>
      </main>

      <footer className="feed-foot">
        <span />
        <span />
        <span>single take © 2026</span>
      </footer>
    </>
  );
}
