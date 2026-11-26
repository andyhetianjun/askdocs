import { firstHitRank, meanReciprocalRank, recallAtK, type Expected, type Level } from "./metrics";
import { retrieve } from "./retrieve";
import type { Embedder, Mode, Store } from "./types";

export interface LabeledQuestion extends Expected {
  question: string;
}

export interface ModeScore {
  mode: Mode;
  level: Level;
  recallAt5: number;
  mrr: number;
  avgMs: number;
}

const DEPTH = 10; // MRR looks this far down the list

export async function evaluate(
  store: Store,
  embedder: Embedder,
  questions: LabeledQuestion[],
  modes: Mode[] = ["keyword", "vector", "hybrid"],
): Promise<ModeScore[]> {
  const scores: ModeScore[] = [];
  await embedder.embed(["warm up"]); // keep model loading out of the timings
  for (const mode of modes) {
    const ranks: Record<Level, (number | null)[]> = { section: [], doc: [] };
    let totalMs = 0;
    for (const q of questions) {
      const t0 = performance.now();
      const hits = await retrieve(store, embedder, q.question, mode, DEPTH);
      totalMs += performance.now() - t0;
      const results = hits.map((h) => h.chunk);
      ranks.section.push(firstHitRank(results, q, "section"));
      ranks.doc.push(firstHitRank(results, q, "doc"));
    }
    for (const level of ["section", "doc"] as Level[]) {
      scores.push({
        mode,
        level,
        recallAt5: recallAtK(ranks[level], 5),
        mrr: meanReciprocalRank(ranks[level]),
        avgMs: totalMs / questions.length,
      });
    }
  }
  return scores;
}

export function formatTable(scores: ModeScore[], level: Level): string {
  const rows = scores.filter((s) => s.level === level);
  const lines = ["| Retrieval | recall@5 | MRR | avg ms per query |", "|---|---|---|---|"];
  for (const s of rows) {
    lines.push(`| ${s.mode} | ${s.recallAt5.toFixed(3)} | ${s.mrr.toFixed(3)} | ${s.avgMs.toFixed(1)} |`);
  }
  return lines.join("\n");
}
