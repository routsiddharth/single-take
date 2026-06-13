/** Renders a prompt as a Newsreader-italic placard with red quote marks —
 *  the prompt IS the artwork's placard (plan §7.2). */
export function PromptText({
  text,
  className = "prompt",
}: {
  text: string;
  className?: string;
}) {
  return (
    <p className={className}>
      <span className="q">“</span>
      {text}
      <span className="q">”</span>
    </p>
  );
}

/** Provenance "medium line" model id, sans the claude- vendor prefix. */
export function shortModel(id: string | null): string {
  if (!id) return "—";
  return id.replace(/^claude-/, "").replace(/^singletake-/, "");
}
