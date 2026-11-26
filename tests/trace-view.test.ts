import { describe, expect, it } from "vitest";
import { HashEmbedder } from "@/lib/embed";
import { ScriptedGenerator } from "@/lib/llm";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import type { Recording } from "@/lib/recording";
import { MemoryTraceStore } from "@/lib/trace";
import { recordingToOtlp, sampleRun } from "@/lib/trace-view";
import type { Chunk } from "@/lib/types";

const rec: Recording = {
  harness: "askdocs-record/1",
  model: "claude-sonnet-5-5",
  caseId: "q01",
  question: "How do I make a flag?",
  prompt: { system: "s", user: "u" },
  passages: [],
  retrieval: { mode: "hybrid", k: 5, embedder: "m", topSimilarity: 0.4 },
  answer: "Use store_true [1].",
  promptedAt: "2026-11-26T02:44:56.525Z",
  recordedAt: "2026-11-26T02:44:58.591Z",
  secondsToAnswer: 2,
};

type S = { name: string; spanId: string; parentSpanId?: string; startTimeUnixNano: string; endTimeUnixNano: string };
const spansOf = (doc: ReturnType<typeof recordingToOtlp>) => doc.resourceSpans[0]!.scopeSpans[0]!.spans as S[];

describe("recordingToOtlp", () => {
  it("makes a workflow span and one chat span covering the recorded interval, and nothing invented", () => {
    const [root, chat, ...rest] = spansOf(recordingToOtlp(rec));
    expect(rest).toEqual([]);
    expect(root!.name).toBe("invoke_workflow askdocs");
    expect(chat!.name).toBe("chat claude-sonnet-5-5");
    expect(chat!.parentSpanId).toBe(root!.spanId);
    expect(BigInt(root!.endTimeUnixNano) - BigInt(root!.startTimeUnixNano)).toBe(2_066_000_000n);
    expect(JSON.stringify(chat)).not.toContain("usage"); // the recording has no token counts
  });
});

describe("sampleRun", () => {
  it("returns the real pipeline's spans as OTLP JSON", async () => {
    const chunks: Chunk[] = [
      { id: "json-0", doc: "json", section: "Basic Usage", url: "u", ordinal: 0, text: "json.dumps serializes an object to a JSON formatted string. It is part of the json module." },
    ];
    const embedder = new HashEmbedder();
    const deps = { store: new MemoryStore(chunks, await embedder.embed(chunks.map(searchableText))), embedder, generator: new ScriptedGenerator(), traces: new MemoryTraceStore() };
    const spans = spansOf(await sampleRun(deps, "serialize an object to a JSON string"));
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining(["invoke_workflow askdocs", "retrieval hybrid", "chat scripted"]));
    expect(spans.every((s) => /^[0-9a-f]{16}$/.test(s.spanId))).toBe(true);
  });
});
