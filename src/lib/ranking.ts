/**
 * Reddit-style hot rank, computed at write time (plan §2.4):
 *
 *   hot_rank = log10(max(|score|,1)) * sign(score) + (epoch_seconds / 45000)
 *
 * Feed query is then a pure index scan ORDER BY hot_rank DESC with cursor
 * pagination — never recomputed at read time.
 */
export function hotRank(score: number, createdAtMs: number): number {
  const order = Math.log10(Math.max(Math.abs(score), 1));
  const sign = score > 0 ? 1 : score < 0 ? -1 : 0;
  const seconds = createdAtMs / 1000;
  return Number((sign * order + seconds / 45000).toFixed(7));
}
