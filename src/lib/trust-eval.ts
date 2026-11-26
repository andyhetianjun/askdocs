import type { CitationVerifier } from "./citations";

export interface CheckItem {
  chunk: string; // chunk id
  claim: string;
  supported: boolean; // the hand label
  kind?: "invented" | "contradiction" | "wrong passage";
}

export interface CheckerScore {
  verifier: string;
  total: number;
  /** Of the claims the checker accepted, the share that really are supported. */
  precision: number;
  /** Of the supported claims, the share the checker accepted. */
  recall: number;
  accuracy: number;
  /** Share of unsupported claims the checker rejected, by kind of unsupported claim. */
  rejected: Record<string, { rejected: number; total: number }>;
}

export async function scoreChecker(
  items: CheckItem[],
  textOf: (chunkId: string) => string,
  verifier: CitationVerifier,
): Promise<CheckerScore> {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const rejected: CheckerScore["rejected"] = {};
  for (const item of items) {
    const { supported } = await verifier.verify(item.claim, [{ n: 1, text: textOf(item.chunk) }]);
    if (item.supported) {
      if (supported) tp++;
      else fn++;
    } else {
      if (supported) fp++;
      else tn++;
      const bucket = (rejected[item.kind ?? "unsupported"] ??= { rejected: 0, total: 0 });
      bucket.total++;
      if (!supported) bucket.rejected++;
    }
  }
  return {
    verifier: verifier.name,
    total: items.length,
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    accuracy: (tp + tn) / items.length,
    rejected,
  };
}

export interface SimilarityRow {
  similarity: number; // best passage cosine
  answerable: boolean;
}

export interface AbstainScore {
  threshold: number;
  /** Answerable questions wrongly refused. */
  falseAbstainRate: number;
  /** Unanswerable questions correctly refused. */
  correctAbstainRate: number;
}

/** A question is refused when its best passage scores below the threshold. */
export function scoreAbstention(rows: SimilarityRow[], threshold: number): AbstainScore {
  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const share = (list: SimilarityRow[], pred: (r: SimilarityRow) => boolean) =>
    list.length === 0 ? 0 : list.filter(pred).length / list.length;
  return {
    threshold,
    falseAbstainRate: share(answerable, (r) => r.similarity < threshold),
    correctAbstainRate: share(unanswerable, (r) => r.similarity < threshold),
  };
}
