import { randomUUID } from "node:crypto";
import type { Generation, Generator } from "./llm";
import { retrieve } from "./retrieve";
import type { Trace, TraceStore } from "./trace";
import type { Embedder, Hit, Mode, Store } from "./types";

export interface Deps {
  store: Store;
  embedder: Embedder;
  generator: Generator | null;
  traces: TraceStore;
}

export interface AskResult {
  answer: string | null;
  model: string | null;
  hits: Hit[];
  trace: Trace;
}

export async function ask(deps: Deps, question: string, mode: Mode = "hybrid", k = 5): Promise<AskResult> {
  const started = performance.now();
  let hits: Hit[] = [];
  let retrievalMs = 0;
  let generation: Generation | null = null;
  let error: string | undefined;

  try {
    const t0 = performance.now();
    hits = await retrieve(deps.store, deps.embedder, question, mode, k);
    retrievalMs = performance.now() - t0;
    if (deps.generator && hits.length > 0) generation = await deps.generator.generate(question, hits);
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
    ...(error ? { error } : {}),
  };
  await deps.traces.add(trace);
  if (error && hits.length === 0) throw new Error(error);
  return { answer: generation?.text ?? null, model: generation?.model ?? null, hits, trace };
}

const round = (n: number): number => Math.round(n * 10) / 10;
