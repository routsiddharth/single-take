import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPostBySlug, getComments, getFeed } from "@/lib/queries";
import { ago, num, utcStamp } from "@/lib/format";
import { Ticker, Masthead, Nav, Footer, ModeSwitch, SortTabs } from "@/components/chrome";
import { VoteWidget } from "@/components/VoteWidget";
import { PromptText } from "@/components/PromptText";
import { PostActions } from "@/components/PostActions";
import { CommentSection } from "@/components/CommentSection";
import { ArtifactFrame } from "@/components/ArtifactFrame";
import { HatchWatcher } from "@/components/HatchWatcher";
import { BuildingVignette, TombVignette, BlockedVignette } from "@/components/vignettes";

export const dynamic = "force-dynamic";

function lotNo(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return num(10_000 + (h % 89_000));
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await currentUser();
  const post = getPostBySlug(slug, user?.id);
  if (!post || post.status === "removed") notFound();

  const comments = getComments(post.id, user?.id, "top");
  const adjacent = getFeed({ sort: "hot", viewerId: user?.id })
    .items.filter((p) => p.id !== post.id)
    .slice(0, 3);

  const chars = [...post.prompt].length;

  return (
    <>
      <Ticker />
      <Masthead vol={`post №${lotNo(post.id)}`} />
      <Nav user={user} sorts={<SortTabs />} mid={<ModeSwitch />} />

      <div className="lot-strip">
        <div className="lot-id">
          № <em>{lotNo(post.id)}</em>
        </div>
        <div className="crumbs">
          <Link className="handle" href={`/u/${post.authorHandle}`}>
            @{post.authorHandle}
          </Link>
          <span className="when">
            posted {ago(post.createdAt)} · {utcStamp(post.createdAt)}
          </span>
        </div>
        <span className="permalink">singletake.gg/p/{post.id}</span>
      </div>

      <section className="placard-zone">
        <VoteWidget
          postId={post.id}
          initialScore={post.score}
          initialVote={post.myVote}
          variant="placard"
        />
        <div className="placard-main">
          <div className="placard-kicker">
            the prompt — exactly as typed, {chars} of 300 characters used
          </div>
          <PromptText text={post.prompt} />
          <div className="placard-sub">
            <span className="dim">
              this exact string is the entire instruction posted.
            </span>
            <span className="note">
              — link the result, or post prompt-only.
            </span>
          </div>
        </div>
      </section>

      {/* ── Model A: the verified one-shot, built + sealed here ── */}
      {post.verified ? (
        <>
          {post.status === "building" && <HatchWatcher ids={[post.id]} />}
          <section className="exhibit">
            <div className="frame-mat">
              <div className="frame-outer">
                <div className="frame-inner">
                  {post.status === "live" && post.artifactKey ? (
                    <ArtifactFrame artifactKey={post.artifactKey} autoRun title={`artifact ${post.id}`} />
                  ) : post.status === "building" ? (
                    <BuildingVignette />
                  ) : post.status === "blocked" ? (
                    <BlockedVignette />
                  ) : (
                    <TombVignette
                      rip={`№${lotNo(post.id)}`}
                      epitaph={post.errorDetail || "the model fumbled it"}
                    />
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="prov-zone">
            <div className="prov-card">
              <div className="prov-kicker">
                ✦ verified one-shot · built &amp; sealed here
              </div>
              <div className="prov-grid">
                <div className="prov-cell">
                  <span className="k">status</span>
                  <span className="v">{post.status}</span>
                </div>
                <div className="prov-cell">
                  <span className="k">model</span>
                  <span className="v">{post.modelId || "—"}</span>
                </div>
                <div className="prov-cell">
                  <span className="k">build time</span>
                  <span className="v">
                    {post.generationMs != null ? (post.generationMs / 1000).toFixed(1) : "—"}
                    <small>s</small>
                  </span>
                </div>
                <div className="prov-cell">
                  <span className="k">turns</span>
                  <span className="v">{post.buildTurns ?? "—"}</span>
                </div>
                <div className="prov-cell">
                  <span className="k">tokens</span>
                  <span className="v">
                    {post.tokensIn != null || post.tokensOut != null
                      ? `${num(post.tokensIn ?? 0)}→${num(post.tokensOut ?? 0)}`
                      : "—"}
                  </span>
                </div>
                <div className="prov-cell">
                  <span className="k">bundle</span>
                  <span className="v">
                    {post.fileCount != null ? `${post.fileCount} files` : "—"}
                    {post.bundleBytes != null && (
                      <small> · {(post.bundleBytes / 1024).toFixed(1)}kb</small>
                    )}
                  </span>
                </div>
                <div className="prov-cell">
                  <span className="k">cost</span>
                  <span className="v">
                    {post.costUsd != null ? `$${post.costUsd.toFixed(4)}` : "—"}
                  </span>
                </div>
                <div className="prov-cell">
                  <span className="k">posted</span>
                  <span className="v">{utcStamp(post.createdAt)}</span>
                </div>
              </div>
            </div>
            <PostActions slug={post.id} prompt={post.prompt} resultUrl={post.artifactKey ? `/a/${post.artifactKey}/index.html` : null} />
          </section>
        </>
      ) : (
        <>
          {post.resultUrl && (
            <section className="exhibit">
              <div className="frame-mat">
                <div className="frame-outer">
                  <div className="frame-inner">
                    {post.resultImage ? (
                      <img src={post.resultImage} alt="result" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <a href={post.resultUrl} target="_blank" rel="noopener noreferrer" className="link-card">
                        open result ↗
                        <div style={{ fontSize: "0.85em", marginTop: 8, opacity: 0.7 }}>
                          {new URL(post.resultUrl).hostname}
                        </div>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className="prov-zone">
            <div className="prov-card">
              <div className="prov-kicker">the result</div>
              <div className="prov-grid">
                <div className="prov-cell">
                  <span className="k">made with</span>
                  <span className="v">{post.tool || "—"}</span>
                </div>
                <div className="prov-cell">
                  <span className="k">prompt length</span>
                  <span className="v">
                    {chars}
                    <small>/300 chars</small>
                  </span>
                </div>
                <div className="prov-cell">
                  <span className="k">posted</span>
                  <span className="v">{utcStamp(post.createdAt)}</span>
                </div>
              </div>
            </div>
            <PostActions slug={post.id} prompt={post.prompt} resultUrl={post.resultUrl} />
          </section>
        </>
      )}

      <CommentSection
        slug={post.id}
        opHandle={post.authorHandle}
        signedIn={!!user}
        initial={comments}
        initialCount={post.commentCount}
      />

      <div className="adjacent-head">
        <h2>more from the feed</h2>
        <span>the museum never closes</span>
      </div>
      <section className="adjacent">
        {adjacent.map((a) => (
          <Link key={a.id} className="mini-lot" href={`/p/${a.id}`}>
            {a.resultImage && (
              <div className="mini-thumb">
                <img src={a.resultImage} alt="" />
              </div>
            )}
            <div className="mini-meta">
              <span>
                №{lotNo(a.id)} · <b>@{a.authorHandle}</b>
              </span>
              <span className={a.score < 0 ? "neg" : ""}>{a.score} pts</span>
            </div>
            <p className="mini-prompt">
              "{a.prompt}"
            </p>
            {a.tool && (
              <div className="mini-foot">
                <span>{a.tool}</span>
              </div>
            )}
          </Link>
        ))}
      </section>

      <Footer left={`post №${lotNo(post.id)} of ∞`} links={<Link className="more" href="/">back to the feed ↑</Link>} />
    </>
  );
}
