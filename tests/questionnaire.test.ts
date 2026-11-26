import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/questionnaire/route";
import { AnswerBank } from "@/lib/answer-bank";
import { parseCsv, toCsv } from "@/lib/csv";
import { setDeps } from "@/lib/deps";
import { HashEmbedder } from "@/lib/embed";
import { ScriptedGenerator } from "@/lib/llm";
import { MemoryStore, searchableText } from "@/lib/memory-store";
import {
  answerCoverage,
  draftQuestionnaire,
  fillCsv,
  parseQuestionnaire,
  type DraftOptions,
} from "@/lib/questionnaire";
import { MemoryTraceStore } from "@/lib/trace";
import type { Chunk } from "@/lib/types";

const chunks: Chunk[] = [
  { id: "heapq-0", doc: "heapq", section: "Heap", url: "https://docs.python.org/3.12/library/heapq.html", ordinal: 0, text: "heappop pops and returns the smallest item from the heap. A heap is a list that keeps the smallest item at index zero." },
  { id: "shutil-0", doc: "shutil", section: "Copy", url: "https://docs.python.org/3.12/library/shutil.html", ordinal: 0, text: "copytree recursively copies an entire directory tree rooted at the source directory." },
];

// The hash embedder is only a word-count hash, so these cut-offs differ from the real model's.
const options: DraftOptions = { confidentAbove: 0.3, answerCoversAtLeast: 0.3, reuseAbove: 0.7, trustReuseAbove: 0.85 };

async function deps(generator = new ScriptedGenerator()) {
  const embedder = new HashEmbedder();
  return {
    store: new MemoryStore(chunks, await embedder.embed(chunks.map(searchableText))),
    embedder,
    generator,
    traces: new MemoryTraceStore(),
  };
}

describe("csv", () => {
  it("round trips quotes, commas and newlines", () => {
    const rows = [["a", "b"], ['say "hi", ok', "line1\nline2"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("reads CRLF and a byte order mark", () => {
    expect(parseCsv("﻿id,question\r\n1,Why?\r\n")).toEqual([["id", "question"], ["1", "Why?"]]);
  });
});

describe("parseQuestionnaire", () => {
  it("finds the question column in a CSV", () => {
    const p = parseQuestionnaire('id,Question,owner\n1,"What is a heap, exactly?",sam\n2,,sam\n3,How do I copy a tree?,lee\n');
    expect(p.questionColumn).toBe(1);
    expect(p.rows.map((r) => r[1])).toEqual(["What is a heap, exactly?", "How do I copy a tree?"]);
  });

  it("reads a pasted list and strips numbering and bullets", () => {
    const p = parseQuestionnaire("1. First question?\n- Second question?\n\n  3) Third one?\n");
    expect(p.rows.map((r) => r[0])).toEqual(["First question?", "Second question?", "Third one?"]);
  });
});

describe("drafting", () => {
  it("answers from the docs with sources and marks the label", async () => {
    const d = await deps();
    const { answers } = await draftQuestionnaire(d, new AnswerBank(), ["How do I pop the smallest item from a heap?"], options);
    expect(answers[0]!.answer).toMatch(/smallest item/);
    expect(answers[0]!.sources[0]).toContain("heapq: Heap");
    expect(answers[0]!.status).toBe("confident");
  });

  it("reuses the answer of a near-duplicate question and keeps one answer", async () => {
    const d = await deps();
    const bank = new AnswerBank();
    const { answers, counts } = await draftQuestionnaire(
      d,
      bank,
      ["How do I pop the smallest item from a heap?", "How do I pop the smallest item from a heap??", "How do I copy a directory tree?"],
      options,
    );
    expect(answers[1]!.reusedFrom).toBe("How do I pop the smallest item from a heap?");
    expect(answers[1]!.answer).toBe(answers[0]!.answer);
    expect(answers[2]!.reusedFrom).toBeNull();
    expect(counts.reused).toBe(1);
  });

  it("flags a reused answer for review when the questions are only fairly similar", async () => {
    const d = await deps();
    const bank = new AnswerBank();
    await draftQuestionnaire(d, bank, ["How do I pop the smallest item from a heap?"], options);
    const { answers } = await draftQuestionnaire(d, bank, ["How do I pop the smallest value from a heap?"], { ...options, reuseAbove: 0.5, trustReuseAbove: 0.99 });
    expect(answers[0]!.reusedFrom).not.toBeNull();
    expect(answers[0]!.status).toBe("needs review");
  });

  it("measures how much of the question the answer covers", () => {
    expect(answerCoverage("How do I pop the smallest item?", "heappop returns the smallest item")).toBeGreaterThan(0.5);
    expect(answerCoverage("How do I pop the smallest item?", "unrelated text")).toBe(0);
  });

  it("marks questions the docs do not cover as needing review", async () => {
    const base = await deps();
    const d = { ...base, embedder: Object.assign(Object.create(base.embedder), { abstainBelow: 0.99 }) };
    const { answers } = await draftQuestionnaire(d, new AnswerBank(), ["What is the capital of Australia?"], options);
    expect(answers[0]!.status).toBe("needs review");
    expect(answers[0]!.answer).toBe("I couldn't find this in the docs.");
  });
});

describe("fillCsv", () => {
  it("keeps the original columns and adds the draft columns, replacing old ones", () => {
    const parsed = parseQuestionnaire("id,question,answer\n1,Why?,old\n");
    const csv = fillCsv(parsed, [{ question: "Why?", answer: "Because [1].", status: "confident", notes: [], sources: ["[1] a: b url"], reusedFrom: null, similarity: 0.6 }]);
    const [header, row] = parseCsv(csv);
    expect(header).toEqual(["id", "question", "answer", "confidence", "sources", "notes", "reused_from"]);
    expect(row).toEqual(["1", "Why?", "Because [1].", "confident", "[1] a: b url", "", ""]);
  });
});

describe("answer bank", () => {
  it("saves and loads", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "bank-"));
    const file = path.join(dir, "bank.json");
    const vector = (await new HashEmbedder().embed(["heap"]))[0]!;
    const bank = new AnswerBank();
    bank.add({ question: "heap?", answer: "a", status: "confident", sources: ["s"], vector });
    await bank.save(file);
    const loaded = await AnswerBank.load(file);
    expect(loaded.closest(vector, 0.99)?.entry.question).toBe("heap?");
    expect((await AnswerBank.load(path.join(dir, "missing.json"))).entries).toHaveLength(0);
  });
});

describe("POST /api/questionnaire", () => {
  beforeEach(async () => {
    process.env.ANSWER_BANK_FILE = path.join(await mkdtemp(path.join(os.tmpdir(), "bank-")), "bank.json");
    setDeps(await deps());
  });

  const post = (body: unknown) => POST(new Request("http://test/api/questionnaire", { method: "POST", body: JSON.stringify(body) }));

  it("returns answers, counts and a filled CSV", async () => {
    const res = await post({ text: "question\nHow do I pop the smallest item from a heap?\nHow do I copy a directory tree?\n" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.answers).toHaveLength(2);
    expect(parseCsv(data.csv)[0]).toContain("confidence");
  });

  it("remembers answers between requests", async () => {
    await post({ text: "How do I pop the smallest item from a heap?" });
    const data = await (await post({ text: "How do I pop the smallest item from a heap??" })).json();
    expect(data.counts.reused).toBe(1);
  });

  it("rejects bad input", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ text: "  " })).status).toBe(400);
    expect((await post({ text: Array.from({ length: 101 }, (_, i) => `Question number ${i}?`).join("\n") })).status).toBe(400);
  });
});
