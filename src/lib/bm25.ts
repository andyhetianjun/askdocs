import { tokenize } from "./tokenize";

export interface Bm25Result {
  index: number;
  score: number;
}

/** Okapi BM25 over an in-memory list of documents. */
export class Bm25Index {
  private readonly postings = new Map<string, Map<number, number>>();
  private readonly lengths: number[] = [];
  private readonly avgLength: number;

  constructor(
    docs: string[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    docs.forEach((doc, i) => {
      const tokens = tokenize(doc);
      this.lengths.push(tokens.length);
      for (const t of tokens) {
        let posting = this.postings.get(t);
        if (!posting) this.postings.set(t, (posting = new Map()));
        posting.set(i, (posting.get(i) ?? 0) + 1);
      }
    });
    this.avgLength = this.lengths.reduce((a, c) => a + c, 0) / Math.max(1, docs.length);
  }

  search(query: string, k: number): Bm25Result[] {
    const n = this.lengths.length;
    const scores = new Map<number, number>();
    for (const term of new Set(tokenize(query))) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5));
      for (const [doc, tf] of posting) {
        const len = this.lengths[doc] ?? 0;
        const norm = tf + this.k1 * (1 - this.b + (this.b * len) / this.avgLength);
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * tf * (this.k1 + 1)) / norm);
      }
    }
    return [...scores.entries()]
      .map(([index, score]) => ({ index, score }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, k);
  }
}
