export interface Ranked {
  id: string;
}

export interface Fused {
  id: string;
  score: number;
}

/**
 * Reciprocal rank fusion: each list gives an item 1 / (k + rank) and the scores add up.
 * Items that appear high in several lists win, and the raw scores of the lists
 * (BM25 vs cosine) never have to be compared. k = 60 is the value from the original paper.
 */
export function reciprocalRankFusion(lists: Ranked[][], k = 60): Fused[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, i) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
