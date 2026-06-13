import { VoteWidget } from "./VoteWidget";
import { LotActions } from "./LotActions";
import { PromptText } from "./PromptText";
import { ago, num } from "@/lib/format";
import type { FeedPost } from "@/lib/queries";

function lotNo(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return num(10_000 + (h % 89_000));
}

function Provenance({ p }: { p: FeedPost }) {
  if (!p.tool) return null;
  return (
    <div className="provenance">
      <span className="dim">made with {p.tool}</span>
    </div>
  );
}

function Preview({ p }: { p: FeedPost }) {
  if (p.resultImage) {
    return (
      <div className="preview">
        <div className="preview-frame">
          <img src={p.resultImage} alt="result" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      </div>
    );
  }
  if (p.resultUrl) {
    try {
      const url = new URL(p.resultUrl);
      return (
        <div className="preview">
          <div className="preview-frame">
            <a href={p.resultUrl} target="_blank" rel="noopener noreferrer" className="link-card">
              open result ↗
              <div style={{ fontSize: "0.85em", marginTop: 8, opacity: 0.7 }}>
                {url.hostname}
              </div>
            </a>
          </div>
        </div>
      );
    } catch {
      return null;
    }
  }
  return null;
}

export function LotCard({ p }: { p: FeedPost }) {
  return (
    <article className="lot">
      <VoteWidget
        postId={p.id}
        initialScore={p.score}
        initialVote={p.myVote}
        lotNo={lotNo(p.id)}
      />
      <div className="lot-body">
        <div className="byline">
          <a className="handle" href={`/u/${p.authorHandle}`}>
            @{p.authorHandle}
          </a>
          <span className="when">posted {ago(p.createdAt)}</span>
        </div>
        <PromptText text={p.prompt} />
        <Provenance p={p} />
        <LotActions
          slug={p.id}
          prompt={p.prompt}
          resultUrl={p.resultUrl}
          commentCount={p.commentCount}
        />
      </div>
      <Preview p={p} />
    </article>
  );
}
