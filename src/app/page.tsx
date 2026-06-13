import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { getFeed, type Sort } from "@/lib/queries";
import { Ticker, Masthead, Nav, Footer, ModeSwitch, SortTabs } from "@/components/chrome";
import { Composer } from "@/components/Composer";
import { LotCard } from "@/components/LotCard";

export const dynamic = "force-dynamic";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const sort: Sort = (["hot", "new", "top"] as const).includes(sp.sort as Sort)
    ? (sp.sort as Sort)
    : "hot";
  const user = await currentUser();

  const { items, nextCursor } = getFeed({
    sort,
    cursor: sp.cursor,
    viewerId: user?.id,
  });

  return (
    <>
      <Ticker />
      <Masthead vol="the global feed" />
      <Nav
        user={user}
        sorts={<SortTabs active={sort} />}
        mid={<ModeSwitch active="feed" />}
      />

      <Composer signedIn={!!user} />

      <div className="feed-head">
        <span className="left">
          the global feed — <b>sorted by {sort}</b>
        </span>
        <span className="right">
          post the prompt · link the result · nothing gets edited
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          nothing here yet. post the first prompt.
        </div>
      ) : (
        items.map((p) => <LotCard key={p.id} p={p} />)
      )}

      <Footer
        left={`showing ${items.length} posts · sorted by ${sort}`}
        links={
          nextCursor ? (
            <Link className="more" href={`/?sort=${sort}&cursor=${encodeURIComponent(nextCursor)}`}>
              more from the museum ↓
            </Link>
          ) : (
            <span />
          )
        }
      />
    </>
  );
}
