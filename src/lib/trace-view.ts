// Data for the trace viewer page: traces in OTLP JSON, labelled by where they came from.
//
// recorded: built from a saved model recording. A recording keeps when the model was shown its prompt and
//   when its answer was saved, to the millisecond, and nothing inside that interval: no retrieval timing
//   (retrieval ran before the prompt was shown), no token counts. So it has an agent span and one model span.
// sample run: the real pipeline run with tracing on, so these are the spans the code emits. The generator
//   is the offline quoting stand-in, which is not a model and reports no tokens.
import { createHash } from "node:crypto";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { ask, type Deps } from "./pipeline";
import type { Recording } from "./recording";
import { setupTracing, shutdownTracing } from "./tracing";

export interface OtlpDoc {
  resourceSpans: { resource: { attributes: unknown[] }; scopeSpans: { scope: { name: string }; spans: unknown[] }[] }[];
}

export interface ViewerTrace {
  id: string;
  label: string;
  source: "recorded" | "sample run";
  model: string;
  otlp: OtlpDoc;
}

const hex = (seed: string, n: number): string => createHash("sha256").update(seed).digest("hex").slice(0, n);
const str = (key: string, value: string) => ({ key, value: { stringValue: value } });
const ns = (iso: string): bigint => BigInt(Date.parse(iso)) * 1_000_000n;

export function recordingToOtlp(rec: Recording): OtlpDoc {
  const traceId = hex(`trace:${rec.caseId}`, 32);
  const rootId = hex(`root:${rec.caseId}`, 16);
  const start = ns(rec.promptedAt);
  const end = ns(rec.recordedAt);
  const root = {
    traceId,
    spanId: rootId,
    name: "invoke_workflow askdocs",
    kind: 1,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: end.toString(),
    attributes: [
      str("gen_ai.operation.name", "invoke_workflow"),
      str("gen_ai.workflow.name", "askdocs"),
      str("askdocs.retrieval.mode", rec.retrieval.mode),
    ],
    status: {},
  };
  const chat = {
    traceId,
    spanId: hex(`chat:${rec.caseId}`, 16),
    parentSpanId: rootId,
    name: `chat ${rec.model}`,
    kind: 3,
    startTimeUnixNano: start.toString(),
    endTimeUnixNano: end.toString(),
    attributes: [
      str("gen_ai.operation.name", "chat"),
      str("gen_ai.provider.name", "anthropic"),
      str("gen_ai.request.model", rec.model),
      str("askdocs.purpose", "answer"),
    ],
    status: {},
  };
  return {
    resourceSpans: [{ resource: { attributes: [str("service.name", "askdocs")] }, scopeSpans: [{ scope: { name: "askdocs" }, spans: [root, chat] }] }],
  };
}

/** Run one question through the pipeline with tracing on and return its spans as OTLP JSON. */
export async function sampleRun(deps: Deps, question: string): Promise<OtlpDoc> {
  const exporter = new InMemorySpanExporter();
  setupTracing({ exporters: [exporter], simple: true });
  try {
    await ask(deps, question);
    const body = JsonTraceSerializer.serializeRequest(exporter.getFinishedSpans());
    return JSON.parse(Buffer.from(body ?? []).toString("utf8")) as OtlpDoc;
  } finally {
    await shutdownTracing();
  }
}
