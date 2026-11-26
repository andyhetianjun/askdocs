import { describe, expect, it } from "vitest";
import { Bm25Index } from "@/lib/bm25";
import { HashEmbedder } from "@/lib/embed";
import { evaluate } from "@/lib/evaluate";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import { retrieve } from "@/lib/retrieve";
import { cleanInline, parseRst } from "@/lib/rst";
import { tokenize } from "@/lib/tokenize";
import type { Chunk } from "@/lib/types";

const chunks: Chunk[] = [
  { id: "json-0", doc: "json", section: "Basic Usage", url: "u", ordinal: 0, text: "dumps serializes an object to a JSON string with indent" },
  { id: "csv-0", doc: "csv", section: "Reader Objects", url: "u", ordinal: 0, text: "DictReader reads each row of a csv file into a dictionary" },
  { id: "re-0", doc: "re", section: "Flags", url: "u", ordinal: 0, text: "VERBOSE lets you write a regular expression with comments and whitespace" },
];

async function makeStore() {
  const embedder = new HashEmbedder();
  const vectors = await embedder.embed(chunks.map(searchableText));
  return { store: new MemoryStore(chunks, vectors), embedder };
}

describe("tokenize and BM25", () => {
  it("lowercases, drops stopwords and strips plurals", () => {
    expect(tokenize("How do the Files work?")).toEqual(["file", "work"]);
  });

  it("ranks the document that has the rare term first", () => {
    const index = new Bm25Index(["the cat sat", "dogs bark loudly", "a cat and a dog"]);
    expect(index.search("bark", 3)[0]?.index).toBe(1);
  });
});

describe("retrieve", () => {
  it("finds the right chunk in all three modes", async () => {
    const { store, embedder } = await makeStore();
    for (const mode of ["keyword", "vector", "hybrid"] as const) {
      const hits = await retrieve(store, embedder, "regular expression VERBOSE comments", mode, 2);
      expect(hits[0]?.chunk.id).toBe("re-0");
      expect(hits[0]?.rank).toBe(1);
    }
  });

  it("evaluate reports perfect scores when the labels match", async () => {
    const { store, embedder } = await makeStore();
    const scores = await evaluate(store, embedder, [
      { question: "serialize object to JSON string", doc: "json", section: "Basic Usage" },
      { question: "DictReader csv row dictionary", doc: "csv", section: "Reader Objects" },
    ]);
    const hybrid = scores.find((s) => s.mode === "hybrid" && s.level === "section")!;
    expect(hybrid.recallAt5).toBe(1);
    expect(hybrid.mrr).toBe(1);
  });
});

describe("rst reader", () => {
  it("splits sections at headings and cleans roles", () => {
    const rst = [
      ":mod:`demo` --- A demo",
      "======================",
      "",
      "Intro with :func:`os.walk` and ``code``.",
      "",
      "Usage",
      "-----",
      "",
      ".. function:: run(a, b)",
      "",
      "   Runs things.",
    ].join("\n");
    const sections = parseRst(rst);
    expect(sections.map((s) => s.title)).toEqual(["demo - A demo", "Usage"]);
    expect(sections[0]?.text).toBe("Intro with os.walk and code.");
    expect(sections[1]?.text).toContain("run(a, b)");
    expect(sections[1]?.text).toContain("Runs things.");
  });

  it("uses the label of a role with an explicit target", () => {
    expect(cleanInline(":ref:`the table <my-table>`")).toBe("the table");
  });
});
