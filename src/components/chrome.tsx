import Link from "next/link";
import type { User } from "@/db/schema";

// One run of the message. Repeated enough times that a single "half" always
// overflows the viewport, so the -50% loop never shows a gap.
const PHRASE = (
  <>
    post the prompt <b>·</b> link the result <b>·</b> upvote the best <b>·</b>{" "}
    nothing gets edited <b>·</b> the prompt is the record <b>·</b>{" "}
  </>
);
const HALF = (
  <>
    {PHRASE}
    {PHRASE}
    {PHRASE}
  </>
);

export function Ticker() {
  return (
    <div className="ticker">
      <div className="ticker-inner">
        <span>{HALF}</span>
        <span aria-hidden>{HALF}</span>
      </div>
    </div>
  );
}

export function Masthead({
  vol = "the global feed",
  compact = false,
}: {
  vol?: string;
  compact?: boolean;
}) {
  return (
    <header className={`masthead${compact ? " compact" : ""}`}>
      <Link className="wordmark" href="/">
        single take<span className="dot">.</span>
      </Link>
      <div className="masthead-meta">
        {vol && <div className="vol">{vol}</div>}
        <div className="masthead-tag">post the prompt. link the result.</div>
      </div>
    </header>
  );
}

export type SortKey = "hot" | "new" | "top";

const SORTS: { key: SortKey; flame: string; label: string }[] = [
  { key: "hot", flame: "▲", label: "hot" },
  { key: "new", flame: "○", label: "new" },
  { key: "top", flame: "№1", label: "top" },
];

/**
 * The hot/new/top sort tabs — identical on every page. `active` highlights the
 * current sort (feed only); omit it (profile, post, signin…) for an all-unselected
 * row. Tabs always link to the feed.
 */
export function SortTabs({ active }: { active?: SortKey }) {
  return (
    <>
      {SORTS.map((s) => (
        <Link
          key={s.key}
          className={s.key === active ? "on" : undefined}
          href={`/?sort=${s.key}`}
        >
          <span className="flame">{s.flame}</span>
          {s.label}
        </Link>
      ))}
    </>
  );
}

/**
 * The two modes of single take, as a segmented switch. Lives in the nav-mid
 * slot. `feed` is the live B feed; `verified` is the A "verified one-shot"
 * (generated here, real provenance) — coming soon at /generate.
 */
export function ModeSwitch({ active }: { active?: "feed" | "verified" }) {
  return (
    <div className="mode-switch" role="tablist" aria-label="mode">
      <Link className={active === "feed" ? "on" : undefined} href="/" aria-selected={active === "feed"}>
        the feed
      </Link>
      <Link
        className={active === "verified" ? "on" : undefined}
        href="/generate"
        aria-selected={active === "verified"}
      >
        verified one-shot <span className="spark">✨</span>
      </Link>
    </div>
  );
}

export function Nav({
  sorts,
  mid,
  user,
}: {
  sorts: React.ReactNode;
  mid: React.ReactNode;
  user: User | null;
}) {
  return (
    <nav className="nav">
      <div className="sorts">{sorts}</div>
      <div className="nav-mid">
        <span className="blink" />
        {mid}
      </div>
      {user ? (
        <Link className="signin" href={`/u/${user.handle}`}>
          @{user.handle}
        </Link>
      ) : (
        <Link className="signin" href="/auth/signin">
          sign in
        </Link>
      )}
    </nav>
  );
}

export function Footer({
  left,
  right = "single take © 2026",
  links,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  links?: React.ReactNode;
}) {
  return (
    <footer className="feed-foot">
      <span>{left}</span>
      {links ?? <span />}
      <span>{right}</span>
    </footer>
  );
}
