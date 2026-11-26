import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SpanStatusCode } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { InMemorySpanExporter, type ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { HashEmbedder } from "@/lib/embed";
import { ScriptedGenerator, type Generator } from "@/lib/llm";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import { ask, type Deps } from "@/lib/pipeline";
import { MemoryTraceStore } from "@/lib/trace";
import { chooseExporters, OtlpJsonFileExporter, setupTracing, shutdownTracing } from "@/lib/tracing";
import type { Chunk, Embedder } from "@/lib/types";

interface JsonSpan {
  name: string;
  traceId: string;
  spanId: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: unknown[];
}
interface JsonDoc {
  resourceSpans: { scopeSpans: { spans: JsonSpan[] }[] }[];
}

const chunks: Chunk[] = [
  { id: "json-0", doc: "json", section: "Basic Usage", url: "https://docs.python.org/3.12/library/json.html", ordinal: 0, text: "json.dumps serializes an object to a JSON formatted string. The json module also reads JSON text back into Python objects." },
  { id: "csv-0", doc: "csv", section: "Reader Objects", url: "https://docs.python.org/3.12/library/csv.html", ordinal: 0, text: "csv.DictReader reads each row into a dictionary. The csv module reads and writes tabular data." },
];

async function makeDeps(over: Partial<Deps> = {}): Promise<Deps> {
  const embedder = new HashEmbedder();
  return {
    store: new MemoryStore(chunks, await embedder.embed(chunks.map(searchableText))),
    embedder,
    generator: new ScriptedGenerator(),
    traces: new MemoryTraceStore(),
    ...over,
  };
}

let exporter: InMemorySpanExporter;
beforeEach(() => {
  exporter = new InMemorySpanExporter();
  setupTracing({ exporters: [exporter], simple: true });
});
afterEach(async () => {
  await shutdownTracing();
  delete process.env.ASKDOCS_TRACE_CONTENT;
});

const spans = (): ReadableSpan[] => exporter.getFinishedSpans();
const named = (prefix: string): ReadableSpan => {
  const found = spans().filter((s) => s.name.startsWith(prefix));
  expect(found, `one span named ${prefix}`).toHaveLength(1);
  return found[0]!;
};
const parentOf = (s: ReadableSpan): string | undefined => s.parentSpanContext?.spanId;
const idOf = (s: ReadableSpan): string => s.spanContext().spanId;

describe("span structure", () => {
  it("makes one trace with the pipeline steps nested under the workflow span", async () => {
    const q = "how do I serialize an object to a JSON string";
    await ask(await makeDeps(), q, "hybrid");
    const root = named("invoke_workflow");
    const retrieval = named("retrieval");
    const embed = named("embeddings");
    const keyword = named("askdocs.keyword_search");
    const vector = named("askdocs.vector_search");
    const chat = named("chat");
    const check = named("askdocs.check_citations");

    expect(parentOf(root)).toBeUndefined();
    expect(parentOf(retrieval)).toBe(idOf(root));
    expect(parentOf(chat)).toBe(idOf(root));
    expect(parentOf(check)).toBe(idOf(root));
    for (const s of [embed, keyword, vector]) expect(parentOf(s)).toBe(idOf(retrieval));
    expect(new Set(spans().map((s) => s.spanContext().traceId)).size).toBe(1);
    expect(spans()).toHaveLength(7);
    // children finish before the parent, and every span has a real duration
    for (const s of spans()) expect(s.endTime[0] * 1e9 + s.endTime[1]).toBeGreaterThanOrEqual(s.startTime[0] * 1e9 + s.startTime[1]);
  });

  it("uses the GenAI attribute names", async () => {
    await ask(await makeDeps(), "serialize an object to a JSON string", "hybrid", 2);
    expect(named("invoke_workflow").attributes).toMatchObject({
      "gen_ai.operation.name": "invoke_workflow",
      "gen_ai.workflow.name": "askdocs",
      "askdocs.abstained": false,
    });
    expect(named("retrieval").name).toBe("retrieval hybrid");
    expect(named("retrieval").attributes).toMatchObject({
      "gen_ai.operation.name": "retrieval",
      "gen_ai.data_source.id": "python-stdlib-docs",
      "askdocs.retrieval.k": 2,
      "askdocs.retrieval.results": 2,
    });
    expect(named("embeddings").attributes).toMatchObject({
      "gen_ai.operation.name": "embeddings",
      "gen_ai.request.model": "hash-384 (tests only)",
      "gen_ai.embeddings.dimension.count": 384,
    });
    expect(named("chat").attributes).toMatchObject({
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "askdocs.offline",
      "gen_ai.request.model": "scripted",
    });
    expect(named("chat").kind).toBe(2); // CLIENT
  });

  it("records token counts for a model that reports them, and none for the offline stand-in", async () => {
    const claude: Generator = {
      model: "claude-sonnet-5-5",
      provider: "anthropic",
      generate: async () => ({ text: "Use json.dumps [1].", model: "claude-sonnet-5-5", inputTokens: 812, outputTokens: 17 }),
    };
    await ask(await makeDeps({ generator: claude }), "serialize an object to a JSON string");
    expect(named("chat").attributes).toMatchObject({ "gen_ai.usage.input_tokens": 812, "gen_ai.usage.output_tokens": 17, "gen_ai.request.model": "claude-sonnet-5-5" });
    exporter.reset();
    await ask(await makeDeps(), "serialize an object to a JSON string");
    expect(named("chat").attributes).not.toHaveProperty("gen_ai.usage.input_tokens");
  });

  it("marks an abstained answer on the workflow span and makes no model call", async () => {
    const strict: Embedder = Object.assign(new HashEmbedder(), { abstainBelow: 2 });
    await ask(await makeDeps({ embedder: strict }), "serialize an object to a JSON string");
    expect(named("invoke_workflow").attributes).toMatchObject({ "askdocs.abstained": true, "askdocs.abstain_reason": "low_similarity" });
    expect(spans().some((s) => s.name.startsWith("chat"))).toBe(false);
  });

  it("links the request log entry to its trace", async () => {
    const deps = await makeDeps();
    const result = await ask(deps, "serialize an object to a JSON string");
    expect(result.trace.otelTraceId).toBe(named("invoke_workflow").spanContext().traceId);
  });
});

describe("errors", () => {
  it("records a failing embedder on the span, its parents and the exception event", async () => {
    const broken: Embedder = { name: "broken", dims: 4, embed: async () => { throw new Error("model files missing"); } };
    await expect(ask(await makeDeps({ embedder: broken }), "anything")).rejects.toThrow("model files missing");
    const embed = named("embeddings");
    expect(embed.status).toMatchObject({ code: SpanStatusCode.ERROR, message: "model files missing" });
    expect(embed.attributes["error.type"]).toBe("Error");
    expect(embed.events.map((e) => e.name)).toContain("exception");
    expect(named("retrieval").status.code).toBe(SpanStatusCode.ERROR);
    expect(named("invoke_workflow").status.code).toBe(SpanStatusCode.ERROR);
    expect(named("invoke_workflow").attributes["error.type"]).toBe("Error");
  });

  it("records a failing model call on the chat span and still returns the passages", async () => {
    const down: Generator = { model: "claude-sonnet-5-5", provider: "anthropic", generate: async () => { throw new Error("529 overloaded"); } };
    const result = await ask(await makeDeps({ generator: down }), "serialize an object to a JSON string");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(named("chat").status.code).toBe(SpanStatusCode.ERROR);
    expect(named("chat").attributes["error.type"]).toBe("Error");
    expect(named("invoke_workflow").status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("content and off switch", () => {
  it("does not record the question or answer by default", async () => {
    await ask(await makeDeps(), "my private question about json");
    expect(JSON.stringify(spans().map((s) => s.attributes))).not.toContain("private question");
  });

  it("records them when ASKDOCS_TRACE_CONTENT is set", async () => {
    process.env.ASKDOCS_TRACE_CONTENT = "1";
    await ask(await makeDeps(), "my private question about json");
    expect(named("invoke_workflow").attributes["askdocs.question"]).toBe("my private question about json");
  });

  it("does nothing, and still answers, when tracing was never set up", async () => {
    await shutdownTracing();
    exporter.reset();
    const result = await ask(await makeDeps(), "serialize an object to a JSON string");
    expect(result.hits.length).toBeGreaterThan(0);
    expect(spans()).toHaveLength(0);
    expect(result.trace.otelTraceId).toBeUndefined();
  });
});

describe("exporters", () => {
  it("writes OTLP JSON, one document per line, with hex ids", async () => {
    await shutdownTracing();
    const dir = await mkdtemp(path.join(os.tmpdir(), "askdocs-trace-"));
    const file = path.join(dir, "nested", "t.jsonl");
    setupTracing({ exporters: [new OtlpJsonFileExporter(file)], simple: true });
    await ask(await makeDeps(), "serialize an object to a JSON string");
    await shutdownTracing();
    const docs = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    const flat: JsonSpan[] = docs.flatMap((d: JsonDoc) => d.resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)));
    expect(flat).toHaveLength(7);
    for (const s of flat) {
      expect(s.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(s.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(BigInt(s.endTimeUnixNano)).toBeGreaterThanOrEqual(BigInt(s.startTimeUnixNano));
    }
    const chat = flat.find((s) => s.name.startsWith("chat"))!;
    expect(chat.attributes).toContainEqual({ key: "gen_ai.operation.name", value: { stringValue: "chat" } });
    expect(docs[0].resourceSpans[0].resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "askdocs" } });
  });

  it("uses the file by default, the OTLP HTTP exporter when an endpoint is set, and both if asked", () => {
    expect(chooseExporters({}).map((e) => e.constructor)).toEqual([OtlpJsonFileExporter]);
    expect(chooseExporters({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }).map((e) => e.constructor)).toEqual([OTLPTraceExporter]);
    expect(chooseExporters({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318", ASKDOCS_TRACE_FILE: "x.jsonl" }).map((e) => e.constructor)).toEqual([OTLPTraceExporter, OtlpJsonFileExporter]);
  });

  it("ships a compose file for Jaeger that exposes the UI and OTLP ports", async () => {
    const doc = parse(await readFile(path.join(process.cwd(), "docker-compose.tracing.yml"), "utf8"));
    expect(doc.services.jaeger.image).toMatch(/^jaegertracing\//);
    expect(doc.services.jaeger.ports).toEqual(expect.arrayContaining(["16686:16686", "4318:4318"]));
  });
});
