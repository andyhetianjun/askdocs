import { beforeEach, describe, expect, it } from "vitest";
import { GET as getTraces } from "@/app/api/traces/route";
import { POST } from "@/app/api/ask/route";
import { setDeps } from "@/lib/deps";
import { HashEmbedder } from "@/lib/embed";
import { ScriptedGenerator } from "@/lib/llm";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import { MemoryTraceStore } from "@/lib/trace";
import type { Chunk } from "@/lib/types";

const chunks: Chunk[] = [
  { id: "json-0", doc: "json", section: "Basic Usage", url: "https://docs.python.org/3.12/library/json.html", ordinal: 0, text: "json.dumps serializes an object to a JSON formatted string." },
  { id: "csv-0", doc: "csv", section: "Reader Objects", url: "https://docs.python.org/3.12/library/csv.html", ordinal: 0, text: "csv.DictReader reads each row into a dictionary." },
];

const post = (body: unknown) =>
  POST(new Request("http://test/api/ask", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

let traces: MemoryTraceStore;

async function install(withModel: boolean) {
  const embedder = new HashEmbedder();
  traces = new MemoryTraceStore();
  setDeps({
    store: new MemoryStore(chunks, await embedder.embed(chunks.map(searchableText))),
    embedder,
    generator: withModel ? new ScriptedGenerator() : null,
    traces,
  });
}

describe("POST /api/ask", () => {
  beforeEach(() => install(false));

  it("returns passages with citations and no answer when no model is set", async () => {
    const res = await post({ question: "serialize an object to a JSON string", mode: "hybrid" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answer).toBeNull();
    expect(data.passages[0]).toMatchObject({ n: 1, doc: "json", section: "Basic Usage" });
    expect(data.passages[0].url).toContain("docs.python.org");
  });

  it("adds an answer with citations when a model is configured", async () => {
    await install(true);
    const data = await (await post({ question: "serialize an object to a JSON string" })).json();
    expect(data.model).toBe("scripted");
    expect(data.answer).toMatch(/\[1\]/);
  });

  it("rejects bad input", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ question: "x", mode: "magic" })).status).toBe(400);
    expect((await post({ question: "x".repeat(501) })).status).toBe(400);
  });

  it("records a trace for each request", async () => {
    await post({ question: "csv rows as dictionaries", mode: "keyword" });
    const { traces: recent } = await (await getTraces()).json();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ question: "csv rows as dictionaries", mode: "keyword", llm: null });
    expect(recent[0].retrievalMs).toBeGreaterThanOrEqual(0);
    expect(recent[0].chunksReturned).toBeGreaterThan(0);
  });

  it("records token counts when the model is used", async () => {
    await install(true);
    await post({ question: "serialize an object to a JSON string" });
    const [trace] = await traces.recent(1);
    expect(trace?.llm).toMatchObject({ model: "scripted" });
    expect(trace?.llm?.outputTokens).toBeGreaterThan(0);
  });
});
