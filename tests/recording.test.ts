import { describe, expect, it } from "vitest";
import { LexicalVerifier } from "../src/lib/citations";
import { buildCases, isAbstention, scoreRecording, summarize, type Recording } from "../src/lib/recording";

const rec = (answer: string): Recording => ({
  harness: "askdocs-record/1", model: "test", caseId: "q01", question: "How do I limit a deque?",
  prompt: { system: "", user: "" },
  passages: [{ n: 1, id: "collections-19", doc: "collections", section: "deque", url: "", text: "A deque can be given a maximum length by passing maxlen. Bounded deques discard items from the opposite end." }],
  retrieval: { mode: "hybrid", k: 5, embedder: "test", topSimilarity: 0.6 },
  answer, promptedAt: "2026-01-01T00:00:00Z", recordedAt: "2026-01-01T00:00:10Z", secondsToAnswer: 10,
});

describe("recording cases", () => {
  it("gives the same ids every time and hides which questions are answerable", () => {
    const a = [{ question: "A?", doc: "x", section: "y" }, { question: "B?", doc: "x", section: "y" }];
    const u = [{ question: "C?" }, { question: "D?" }];
    const one = buildCases(a, u);
    expect(buildCases(a, u)).toEqual(one);
    expect(one.map((c) => c.id)).toEqual(["q01", "q02", "q03", "q04"]);
    expect(buildCases([...a].reverse(), [...u].reverse()).map((c) => c.question)).toEqual(one.map((c) => c.question));
  });
});

describe("scoring recordings", () => {
  it("recognizes the refusal sentence in its usual spellings", () => {
    expect(isAbstention("I couldn't find this in the docs.")).toBe(true);
    expect(isAbstention("“I couldn’t find this in the docs”")).toBe(true);
    expect(isAbstention("I couldn't find this in the docs, but sets are fast. [1]")).toBe(false);
  });

  it("keeps supported sentences and drops invented ones", async () => {
    const c = { id: "q01", question: "How do I limit a deque?", answerable: true, doc: "collections", section: "deque" };
    const r = await scoreRecording(c, rec("A deque can be given a maximum length by passing maxlen [1]. Deques are stored on disk [1]. Uncited claim."), new LexicalVerifier());
    expect(r.sentences).toBe(3);
    expect(r.supported).toBe(1);
    expect(r.unsupported).toBe(1);
    expect(r.uncited).toBe(1);
    expect(r.citationsKeptRightDoc).toBe(1);
    const s = summarize("test", "lexical overlap", 4, [r]);
    expect(s.answerable.answered).toBe(1);
  });

  it("counts a refusal on an unanswerable question as correct", async () => {
    const c = { id: "q02", question: "send email", answerable: false };
    const r = await scoreRecording(c, rec("I couldn't find this in the docs."), new LexicalVerifier());
    const s = summarize("test", "lexical overlap", 4, [r]);
    expect(s.unanswerable.refused).toBe(1);
  });
});
