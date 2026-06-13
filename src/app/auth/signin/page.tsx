import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Ticker, Masthead, Nav, ModeSwitch, SortTabs } from "@/components/chrome";
import { SignInForm } from "@/components/SignInForm";

export const dynamic = "force-dynamic";

const CONDITIONS = [
  ["§ 1", <>reading is <b>free, forever</b></>, "— the museum has no door."],
  ["§ 2", <>posting is <b>free</b></>, "— one prompt, ≤300 chars, link the result."],
  ["§ 3", <>the prompt is <b>permanent</b></>, "— can't be edited, once posted."],
  ["§ 4", <>post <b>any time</b></>, "— no daily limit, post as often as you like."],
] as const;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (user) redirect(`/u/${user.handle}`);
  const { error } = await searchParams;

  return (
    <>
      <Ticker />
      <Masthead vol="sign in" compact />
      <Nav user={null} sorts={<SortTabs />} mid={<ModeSwitch />} />

      <main className="spread">
        <section className="pitch">
          <div className="pitch-kicker">
            <span className="no">FORM 1-A</span>
            <span className="line" />
            <span>create your account</span>
          </div>
          <h2>
            one tap in.
            <span className="alt">
              post your <em>prompt.</em>
            </span>
          </h2>
          <p className="pitch-sub">
            Reading is free, no account needed. To post, sign in with a magic
            link or Google and pick a handle. Once a prompt is up, it stays up.
          </p>
          <div className="conditions">
            <div className="conditions-head">
              <span>the rules</span>
              <span className="fine">all four of them.</span>
            </div>
            {CONDITIONS.map(([n, t, gloss]) => (
              <div className="cond" key={n}>
                <span className="n">{n}</span>
                <span className="t">{t}</span>
                <span className="gloss">{gloss}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="desk">
          <div className="desk-note">
            <span>sign up</span>
            <span>tear here ✂ — — — — —</span>
          </div>
          <SignInForm error={error} />
          <div className="stub">
            <span className="ret">
              already have an account? same email (or google) signs you back in.
            </span>
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
