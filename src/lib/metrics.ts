export interface Expected {
  doc: string;
  section: string;
}

export interface Retrieved {
  doc: string;
  section: string;
}

export type Level = "section" | "doc";

const matches = (r: Retrieved, e: Expected, level: Level): boolean =>
  r.doc === e.doc && (level === "doc" || r.section === e.section);

/** 1-based rank of the first matching result, or null if nothing matches. */
export function firstHitRank(results: Retrieved[], expected: Expected, level: Level = "section"): number | null {
  const i = results.findIndex((r) => matches(r, expected, level));
  return i === -1 ? null : i + 1;
}

/** Fraction of queries with a match in the top k. */
export function recallAtK(ranks: (number | null)[], k: number): number {
  if (ranks.length === 0) return 0;
  return ranks.filter((r) => r !== null && r <= k).length / ranks.length;
}

/** Mean reciprocal rank. A miss counts as 0. */
export function meanReciprocalRank(ranks: (number | null)[]): number {
  if (ranks.length === 0) return 0;
  return ranks.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0) / ranks.length;
}
