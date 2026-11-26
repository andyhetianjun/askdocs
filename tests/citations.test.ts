import { describe, expect, it } from "vitest";
import {
  ABSTAIN_MESSAGE,
  checkCitations,
  citedNumbers,
  LexicalVerifier,
  lexicalScore,
  ModelVerifier,
  splitSentences,
  stripMarkers,
} from "@/lib/citations";
import { HashEmbedder } from "@/lib/embed";
import type { Generator } from "@/lib/llm";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import { ask } from "@/lib/pipeline";
import { MemoryTraceStore } from "@/lib/trace";
import { scoreAbstention, scoreChecker } from "@/lib/trust-eval";
import type { Chunk } from "@/lib/types";

const heap = "heappop(heap) pops and returns the smallest item from the heap, maintaining the heap invariant. To create a heap, use a list initialized to [].";

describe("sentences and markers", () => {
  it("splits sentences and keeps a trailing marker with its sentence", () => {
    expect(splitSentences("Use heappush. [1] Then call heappop [2]. Done.")).toEqual([
      "Use heappush [1].",
      "Then call heappop [2].",
      "Done.",
    ]);
  });

  it("does not split after e.g.", () => {
    expect(splitSentences("Use a lock, e.g. threading.Lock [1].")).toHaveLength(1);
  });

  it("reads one or several citation numbers", () => {
    expect(citedNumbers("Claim [1][3] and more [2, 3].")).toEqual([1, 3, 2]);
    expect(stripMarkers("Claim [1] here [2].")).toBe("Claim here.");
  });
});

describe("lexical support", () => {
  const verifier = new LexicalVerifier();
  const verify = (claim: string) => verifier.verify(claim, [{ n: 1, text: heap }]);

  it("accepts a claim the passage states", async () => {
    expect((await verify("heappop returns the smallest item from the heap.")).supported).toBe(true);
  });

  it("rejects a claim about something else", async () => {
    expect((await verify("copytree recursively copies a directory tree.")).supported).toBe(false);
  });

  it("rejects a claim whose exact name or number is not in the passage", async () => {
    expect(lexicalScore("Call heappop(heap, key=len) to pop the smallest item.", heap).missingExact).toContain("key=len");
    expect((await verify("Call heappop(heap, key=len) to pop the smallest item from the heap.")).supported).toBe(false);
  });

  it("rejects a claim with a negation the passage does not have", async () => {
    expect((await verify("heappop does not return the smallest item from the heap.")).supported).toBe(false);
  });
});

describe("checkCitations", () => {
  const passages = [
    { n: 1, text: heap },
    { n: 2, text: "copytree recursively copies an entire directory tree rooted at src." },
  ];

  it("keeps supported sentences and flags the rest", async () => {
    const answer =
      "heappop returns the smallest item from the heap [1]. " +
      "copytree recursively copies a directory tree [1]. " +
      "Heaps are great. " +
      "A tree can be copied [7].";
    const report = await checkCitations(answer, passages, new LexicalVerifier());
    expect(report.sentences.map((s) => s.status)).toEqual(["supported", "unsupported", "uncited", "bad_citation"]);
    expect(report.keptText).toBe("heappop returns the smallest item from the heap [1].");
    expect(report.dropped).toBe(3);
  });

  it("can use a model based verifier", async () => {
    const asked: string[] = [];
    const model = new ModelVerifier(async (prompt) => {
      asked.push(prompt);
      return prompt.split("Sentence:")[1]!.includes("smallest") ? "SUPPORTED" : "UNSUPPORTED";
    });
    const report = await checkCitations("The smallest item comes out first [1]. Heaps are fast [1].", passages, model);
    expect(report.sentences.map((s) => s.status)).toEqual(["supported", "unsupported"]);
    expect(asked[0]).toContain(heap);
  });
});

describe("abstaining", () => {
  const chunks: Chunk[] = [
    { id: "heapq-0", doc: "heapq", section: "Heap", url: "u", ordinal: 0, text: heap },
    { id: "shutil-0", doc: "shutil", section: "Copy", url: "u", ordinal: 0, text: "copytree recursively copies an entire directory tree rooted at src." },
  ];

  async function deps(generator: Generator | null, abstainBelow?: number) {
    const base = new HashEmbedder();
    const embedder = Object.assign(Object.create(base), { abstainBelow }) as HashEmbedder;
    return {
      store: new MemoryStore(chunks, await base.embed(chunks.map(searchableText))),
      embedder,
      generator,
      traces: new MemoryTraceStore(),
    };
  }
  const fixed = (text: string): Generator => ({ generate: async () => ({ text, model: "fake", inputTokens: 1, outputTokens: 1 }) });

  it("says it could not find the answer when similarity is below the cut-off", async () => {
    const result = await ask(await deps(fixed("anything [1]."), 0.99), "smallest item heap");
    expect(result.abstained).toBe(true);
    expect(result.abstainReason).toBe("low_similarity");
    expect(result.answer).toBe(ABSTAIN_MESSAGE);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("does not call the model when it abstains", async () => {
    let called = false;
    const generator: Generator = { generate: async () => ((called = true), { text: "x", model: "m", inputTokens: 0, outputTokens: 0 }) };
    await ask(await deps(generator, 0.99), "smallest item heap");
    expect(called).toBe(false);
  });

  it("drops unsupported sentences and abstains if none are left", async () => {
    const partly = await ask(await deps(fixed("heappop returns the smallest item from the heap [1]. Heaps cure colds [1]."), 0), "smallest item heap");
    expect(partly.abstained).toBe(false);
    expect(partly.answer).toBe("heappop returns the smallest item from the heap [1].");
    const none = await ask(await deps(fixed("Heaps cure colds [1]."), 0), "smallest item heap");
    expect(none.abstained).toBe(true);
    expect(none.abstainReason).toBe("no_supported_sentence");
    expect(none.answer).toBe(ABSTAIN_MESSAGE);
  });

  it("answers normally when the model is confident and cited", async () => {
    const result = await ask(await deps(fixed("heappop returns the smallest item from the heap [1]."), 0), "smallest item heap");
    expect(result.abstained).toBe(false);
    expect(result.trace.droppedSentences).toBe(0);
  });
});

describe("trust metrics", () => {
  it("scores a checker against labels", async () => {
    const items = [
      { chunk: "a", claim: "heappop returns the smallest item from the heap.", supported: true },
      { chunk: "a", claim: "copytree recursively copies a directory tree.", supported: false, kind: "invented" as const },
      { chunk: "a", claim: "heappop returns the smallest item from the heap and also the largest one in the dictionary.", supported: false, kind: "contradiction" as const },
    ];
    const score = await scoreChecker(items, () => heap, new LexicalVerifier());
    expect(score.recall).toBe(1);
    expect(score.rejected.invented).toEqual({ rejected: 1, total: 1 });
  });

  it("computes refusal rates for a threshold", () => {
    const rows = [
      { similarity: 0.6, answerable: true },
      { similarity: 0.3, answerable: true },
      { similarity: 0.2, answerable: false },
      { similarity: 0.5, answerable: false },
    ];
    expect(scoreAbstention(rows, 0.4)).toEqual({ threshold: 0.4, falseAbstainRate: 0.5, correctAbstainRate: 0.5 });
  });
});
