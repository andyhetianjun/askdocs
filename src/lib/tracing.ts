// OpenTelemetry tracing for the question pipeline, following the GenAI semantic conventions
// (https://opentelemetry.io/docs/specs/semconv/gen-ai/).
//
// Off unless asked for. Then spans go to a local file, one OTLP JSON document per line, so nothing
// outside this machine is needed. Set OTEL_EXPORTER_OTLP_ENDPOINT to send them to a collector or Jaeger.
//
//   ASKDOCS_TRACE=1                      turn it on
//   ASKDOCS_TRACE_FILE=path.jsonl        where the file goes (default traces/askdocs.otlp.jsonl)
//   ASKDOCS_TRACE_CONTENT=1              also record the question and answer text (off by default)
//   OTEL_EXPORTER_OTLP_ENDPOINT=...      send to an OTLP/HTTP endpoint instead of the file
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { context, SpanStatusCode, trace, type Attributes, type Span, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";

export const DEFAULT_TRACE_FILE = path.join("traces", "askdocs.otlp.jsonl");

/** Appends one OTLP JSON `ExportTraceServiceRequest` per export, the collector's file format. */
export class OtlpJsonFileExporter implements SpanExporter {
  constructor(private readonly file: string) {}

  export(spans: ReadableSpan[], done: (result: { code: number }) => void): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const body = JsonTraceSerializer.serializeRequest(spans);
      appendFileSync(this.file, Buffer.from(body ?? []).toString("utf8") + "\n");
      done({ code: 0 });
    } catch {
      done({ code: 1 });
    }
  }

  async shutdown(): Promise<void> {}
}

interface Active {
  provider: BasicTracerProvider;
  tracer: Tracer;
  manager: AsyncLocalStorageContextManager;
}

let active: Active | null = null;

type Env = Record<string, string | undefined>;

export const tracingRequested = (env: Env = process.env): boolean =>
  ["1", "true", "yes"].includes((env.ASKDOCS_TRACE ?? "").toLowerCase());

export const captureContent = (env: Env = process.env): boolean =>
  ["1", "true", "yes"].includes((env.ASKDOCS_TRACE_CONTENT ?? "").toLowerCase());

const endpointSet = (env: Env): boolean =>
  Boolean(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT);

/** Which exporters setupTracing would use for this environment. Exposed so a test can check it. */
export function chooseExporters(env: Env = process.env): SpanExporter[] {
  const exporters: SpanExporter[] = [];
  if (endpointSet(env)) exporters.push(new OTLPTraceExporter()); // reads the standard OTEL_EXPORTER_OTLP_* variables
  if (env.ASKDOCS_TRACE_FILE || exporters.length === 0) {
    exporters.push(new OtlpJsonFileExporter(env.ASKDOCS_TRACE_FILE ?? DEFAULT_TRACE_FILE));
  }
  return exporters;
}

/** Start tracing. Pass your own exporters (tests use an in-memory one); `simple` exports each span at once. */
export function setupTracing(opts: { exporters?: SpanExporter[]; simple?: boolean } = {}): BasicTracerProvider {
  if (active) void shutdownTracing();
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": "askdocs" }),
    spanProcessors: (opts.exporters ?? chooseExporters()).map((e) =>
      opts.simple ? new SimpleSpanProcessor(e) : new BatchSpanProcessor(e),
    ),
  });
  active = { provider, tracer: provider.getTracer("askdocs"), manager };
  return provider;
}

export function setupFromEnv(): boolean {
  if (tracingRequested() && !active) {
    setupTracing();
    process.once("beforeExit", () => void shutdownTracing());
  }
  return active !== null;
}

/** Flush and stop. Safe to call twice. */
export async function shutdownTracing(): Promise<void> {
  const current = active;
  active = null;
  if (!current) return;
  await current.provider.shutdown();
  current.manager.disable();
  context.disable();
}

/** The tracer to use; without setupTracing() it is the API's no-op tracer. */
export const getTracer = (): Tracer => active?.tracer ?? trace.getTracer("askdocs");

/**
 * Run `fn` inside a span. An exception is recorded on the span (status ERROR, `error.type`) and thrown again.
 * Without setupTracing() the span is a no-op and this costs a function call.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  kind?: number,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes, ...(kind === undefined ? {} : { kind }) }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : String(err));
      span.setAttribute("error.type", err instanceof Error ? err.name : "Error");
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
