import { randomUUID } from "node:crypto";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import type { Generation, Generator } from "./llm";
import { ABSTAIN_MESSAGE, checkCitations, LexicalVerifier, type CitationReport, type CitationVerifier } from "./citations";
import { retrieveWithConfidence } from "./retrieve";
import type { Trace, TraceStore } from "./trace";
import { captureContent, withSpan } from "./tracing";
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

/** Answer one question. With tracing on (see tracing.ts) the whole call is one trace. */
export async function ask(deps: Deps, question: string, mode: Mode = "hybrid", k = 5): Promise<AskResult> {
  return withSpan(
    "invoke_workflow askdocs",
    {
      "gen_ai.operation.name": "invoke_workflow",
      "gen_ai.workflow.name": "askdocs",
      "askdocs.retrieval.mode": mode,
    },
    (root) => askInner(deps, question, mode, k, root),
  );
}

async function askInner(deps: Deps, question: string, mode: Mode, k: number, root: Span): Promise<AskResult> {
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
      generation = await generate(deps.generator, question, hits);
      const text = generation.text;
      citations = await withSpan("askdocs.check_citations", {}, async (span) => {
        const report = await checkCitations(
          text,
          hits.map((h) => ({ n: h.rank, text: h.chunk.text })),
          deps.verifier ?? new LexicalVerifier(),
        );
        span.setAttribute("askdocs.sentences", report.sentences.length);
        span.setAttribute("askdocs.sentences_dropped", report.dropped);
        return report;
      });
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
  root.setAttribute("askdocs.chunks_returned", hits.length);
  root.setAttribute("askdocs.abstained", abstainReason !== null);
  if (abstainReason) root.setAttribute("askdocs.abstain_reason", abstainReason);
  if (error) {
    root.setAttribute("error.type", "pipeline_error");
    root.setStatus({ code: SpanStatusCode.ERROR, message: error });
  }
  if (captureContent()) {
    root.setAttribute("askdocs.question", question);
    if (answerText(abstainReason, citations)) root.setAttribute("askdocs.answer", answerText(abstainReason, citations)!);
  }
  if (root.isRecording()) trace.otelTraceId = root.spanContext().traceId;
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

const answerText = (abstainReason: AbstainReason | null, citations: CitationReport | null): string | null =>
  abstainReason ? ABSTAIN_MESSAGE : (citations?.keptText ?? null);

/** One model call, as a `chat` span with token counts when the model reports them. */
async function generate(generator: Generator, question: string, hits: Hit[]): Promise<Generation> {
  const model = generator.model ?? "generator";
  const provider = generator.provider ?? "unknown";
  return withSpan(
    `chat ${model}`,
    {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": provider,
      "gen_ai.request.model": model,
      "askdocs.purpose": "answer",
    },
    async (span) => {
      const generation = await generator.generate(question, hits);
      // The offline stand-in is not a model and has no token counts, so none are recorded for it.
      if (provider !== "askdocs.offline") {
        span.setAttribute("gen_ai.usage.input_tokens", generation.inputTokens);
        span.setAttribute("gen_ai.usage.output_tokens", generation.outputTokens);
      }
      span.setAttribute("gen_ai.response.model", generation.model);
      return generation;
    },
    SpanKind.CLIENT,
  );
}

const round = (n: number): number => Math.round(n * 10) / 10;
