"use client";
import { useState } from "react";

/**
 * Sandboxed in-place artifact runner (plan §2.2 layer 3 / §7.2). Default is a
 * lightweight "run it" panel (cheap, fast scroll); clicking swaps in the live
 * iframe in place. The iframe is sandboxed with allow-scripts but WITHOUT
 * allow-same-origin → opaque origin, no access to app cookies/storage. Without
 * allow-top-navigation / allow-popups / allow-downloads either.
 */
export function ArtifactFrame({
  artifactKey,
  autoRun = false,
  title = "AI-generated artifact",
}: {
  artifactKey: string;
  autoRun?: boolean;
  title?: string;
}) {
  const [running, setRunning] = useState(autoRun);
  if (!running) {
    return (
      <button className="preview-run" onClick={() => setRunning(true)}>
        <span>▶ run it</span>
      </button>
    );
  }
  return (
    <iframe
      src={`/a/${artifactKey}/index.html`}
      title={title}
      sandbox="allow-scripts"
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  );
}
