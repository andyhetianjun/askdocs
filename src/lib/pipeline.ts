import { randomUUID } from "node:crypto";
import type { Generation, Generator } from "./llm";
import { ABSTAIN_MESSAGE, checkCitations, LexicalVerifier, type CitationReport, type CitationVerifier } from "./citations";
import { retrieveWithConfidence } from "./retrieve";
import type { Trace, TraceStore } from "./trace";
import type { Embedder, Hit, Mode, Store } from "./types";

export interface Deps {
  store: Store;
  embedder: Embedder;
  generator: Generator | null;
  traces: TraceStore;
  /** Checks each answer sentence against the passage it cites. Defaults to the offline word-overlap check. */
  verifier?: CitationVerifier;
}

export type AbstainReason = "low_similarity" | "no_supported_sentence";

export interface AskResult {
  answer: string | null;
  model: string | null;
  hits: Hit[];
  trace: Trace;
  /** True when the docs did not seem to answer the question. `answer` is then the abstain message. */
  abstained: boolean;
  abstainReason: AbstainReason | null;
  /** Cosine similarity of the question to the closest passage. */
  similarity: number;
  citations: CitationReport | null;
}

export async function ask(deps: Deps, question: string, mode: Mode = "hybrid", k = 5): Promise<AskResult> {
  const started = performance.now();
  let hits: Hit[] = [];
  let similarity = 0;
  let retrievalMs = 0;
  let generation: Generation | null = null;
  let citations: CitationReport | null = null;
  let abstainReason: AbstainReason | null = null;
  let error: string | undefined;

  try {
    const t0 = performance.now();
    ({ hits, topSimilarity: similarity } = await retrieveWithConfidence(deps.store, deps.embedder, question, mode, k));
    retrievalMs = performance.now() - t0;
    if (hits.length > 0 && similarity < (deps.embedder.abstainBelow ?? 0)) {
      abstainReason = "low_similarity";
    } else if (deps.generator && hits.length > 0) {
      generation = await deps.generator.generate(question, hits);
      citations = await checkCitations(
        generation.text,
        hits.map((h) => ({ n: h.rank, text: h.chunk.text })),
        deps.verifier ?? new LexicalVerifier(),
      );
      if (!citations.keptText) abstainReason = "no_supported_sentence";
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const trace: Trace = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    question,
    mode,
    retrievalMs: round(retrievalMs),
    totalMs: round(performance.now() - started),
    chunksReturned: hits.length,
    topChunks: hits.map((h) => ({ id: h.chunk.id, doc: h.chunk.doc, section: h.chunk.section })),
    llm: generation
      ? { model: generation.model, inputTokens: generation.inputTokens, outputTokens: generation.outputTokens }
      : null,
    similarity: Math.round(similarity * 1000) / 1000,
    abstained: abstainReason !== null,
    ...(abstainReason ? { abstainReason } : {}),
    ...(citations ? { citedSentences: citations.sentences.length, droppedSentences: citations.dropped } : {}),
    ...(error ? { error } : {}),
  };
  await deps.traces.add(trace);
  if (error && hits.length === 0) throw new Error(error);
  const answer = abstainReason ? ABSTAIN_MESSAGE : citations ? citations.keptText : null;
  return {
    answer,
    model: generation?.model ?? null,
    hits,
    trace,
    abstained: abstainReason !== null,
    abstainReason,
    similarity,
    citations,
  };
}

const round = (n: number): number => Math.round(n * 10) / 10;
