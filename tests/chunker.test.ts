import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunker";

const lines = (n: number, wordsPerLine = 5) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: wordsPerLine }, (_, j) => `w${i}x${j}`).join(" ")).join("\n");

describe("chunkText", () => {
  it("returns one chunk for short text", () => {
    expect(chunkText("hello world", { maxWords: 50, overlapWords: 10 })).toEqual(["hello world"]);
  });

  it("returns nothing for empty text", () => {
    expect(chunkText("  \n ", { maxWords: 50, overlapWords: 10 })).toEqual([]);
  });

  it("keeps chunks near the size limit", () => {
    const chunks = chunkText(lines(40), { maxWords: 30, overlapWords: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.split(/\s+/).length).toBeLessThanOrEqual(30);
  });

  it("repeats the end of a chunk at the start of the next one", () => {
    const chunks = chunkText(lines(40), { maxWords: 30, overlapWords: 10 });
    for (let i = 1; i < chunks.length; i++) {
      const lastLineOfPrevious = chunks[i - 1]!.split("\n").at(-1)!;
      expect(chunks[i]!.split("\n")).toContain(lastLineOfPrevious);
    }
  });

  it("covers every line of the input", () => {
    const text = lines(37);
    const joined = chunkText(text, { maxWords: 25, overlapWords: 5 }).join("\n");
    for (const line of text.split("\n")) expect(joined).toContain(line);
  });

  it("always makes progress when a single line is longer than the limit", () => {
    const chunks = chunkText(`${lines(1, 100)}\nshort line`, { maxWords: 20, overlapWords: 5 });
    expect(chunks).toHaveLength(2);
  });

  it("rejects an overlap that is not smaller than the chunk size", () => {
    expect(() => chunkText("a b c", { maxWords: 10, overlapWords: 10 })).toThrow();
  });
});
