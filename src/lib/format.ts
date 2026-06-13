/** "rolled 2h ago" style relative time used across the catalog. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** Renders a score the way the mockups do: "−34" with a real minus glyph. */
export function score(n: number): string {
  return n < 0 ? `−${num(Math.abs(n))}` : num(n);
}

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

export function utcStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${String(
    d.getUTCFullYear(),
  ).slice(2)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} utc`;
}
