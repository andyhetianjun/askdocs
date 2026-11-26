import { describe, expect, it } from "vitest";
import type { SourceDoc } from "@/lib/connectors/types";
import { HashEmbedder } from "@/lib/embed";
import { chunkDoc, configKey, docHash, syncIndex } from "@/lib/sync";

class CountingEmbedder extends HashEmbedder {
  embedded = 0;
  override async embed(texts: string[]): Promise<Float32Array[]> {
    this.embedded += texts.length;
    return super.embed(texts);
  }
}

const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
// Each section is a few lines so that one doc becomes several chunks.
const body = (tag: string) => Array.from({ length: 8 }, (_, i) => words(40, `${tag}${i}x`)).join("\n");

function doc(id: string, tag = id): SourceDoc {
  return { id, url: `u/${id}`, sections: [{ title: `${id} intro`, text: body(tag) }] };
}

const strip = (index: { chunks: { id: string; text: string; embedding: string }[] }) =>
  index.chunks.map((c) => [c.id, c.text, c.embedding]);

describe("syncIndex", () => {
  it("builds everything the first time", async () => {
    const e = new CountingEmbedder();
    const { index, report } = await syncIndex(null, [doc("b"), doc("a")], e);
    expect(report.added).toEqual(["a", "b"]);
    expect(report.chunksEmbedded).toBe(index.chunks.length);
    expect(index.chunks[0]!.doc).toBe("a");
    expect(Object.keys(index.docs!)).toEqual(["a", "b"]);
  });

  it("does no embedding when nothing changed", async () => {
    const docs = [doc("a"), doc("b")];
    const first = await syncIndex(null, docs, new HashEmbedder());
    const e = new CountingEmbedder();
    const second = await syncIndex(first.index, docs, e);
    expect(e.embedded).toBe(0);
    expect(second.report).toMatchObject({ added: [], changed: [], deleted: [], unchanged: 2, chunksEmbedded: 0 });
    expect(strip(second.index)).toEqual(strip(first.index));
  });

  it("detects added, changed and deleted documents", async () => {
    const first = await syncIndex(null, [doc("a"), doc("b"), doc("c")], new HashEmbedder());
    const edited = doc("b");
    edited.sections[0]!.text += "\nsomething new at the end of the page that adds a handful of words";
    const { report, index } = await syncIndex(first.index, [doc("a"), edited, doc("d")], new HashEmbedder());
    expect(report.added).toEqual(["d"]);
    expect(report.changed).toEqual(["b"]);
    expect(report.deleted).toEqual(["c"]);
    expect(report.unchanged).toBe(1);
    expect(index.chunks.some((c) => c.doc === "c")).toBe(false);
  });

  it("re-embeds only the chunks whose text changed inside an edited document", async () => {
    const first = await syncIndex(null, [doc("a")], new HashEmbedder());
    const edited = doc("a");
    edited.sections[0]!.text += "\nan added closing line with several extra words so it counts";
    const e = new CountingEmbedder();
    const { report } = await syncIndex(first.index, [edited], e);
    expect(report.changed).toEqual(["a"]);
    expect(e.embedded).toBeGreaterThan(0);
    expect(e.embedded).toBeLessThan(first.index.chunks.length);
  });

  it("gives the same index as a full rebuild", async () => {
    const before = [doc("a"), doc("b"), doc("c")];
    const first = await syncIndex(null, before, new HashEmbedder());
    const edited = doc("b");
    edited.sections[0]!.text = edited.sections[0]!.text.replace("b3x0", "changed");
    const after = [doc("a"), edited, doc("d")];
    const incremental = await syncIndex(first.index, after, new HashEmbedder());
    const full = await syncIndex(null, after, new HashEmbedder());
    expect(strip(incremental.index)).toEqual(strip(full.index));
    expect(incremental.index.docs).toEqual(full.index.docs);
  });

  it("rebuilds everything when the embedding model changes", async () => {
    const first = await syncIndex(null, [doc("a")], new HashEmbedder());
    const e = new CountingEmbedder();
    Object.defineProperty(e, "name", { value: "another-model" });
    const { report } = await syncIndex(first.index, [doc("a")], e);
    expect(report.rebuiltAll).toBe(true);
    expect(report.chunksReused).toBe(0);
    expect(configKey(e)).not.toBe(configKey(new HashEmbedder()));
  });

  it("adopts an index made before hashes were stored, without re-embedding", async () => {
    const docs = [doc("a"), doc("b")];
    const { index } = await syncIndex(null, docs, new HashEmbedder());
    const legacy = { embedder: index.embedder, chunks: index.chunks };
    const e = new CountingEmbedder();
    const { report, index: adopted } = await syncIndex(legacy, docs, e);
    expect(e.embedded).toBe(0);
    expect(report.unchanged).toBe(2);
    expect(adopted.docs).toEqual(index.docs);
  });
});

describe("hashing", () => {
  it("changes when any section changes, and not otherwise", () => {
    const a = doc("a");
    expect(docHash(a)).toBe(docHash(doc("a")));
    const b = doc("a");
    b.sections[0]!.title = "other";
    expect(docHash(b)).not.toBe(docHash(a));
  });

  it("skips chunks that are too short", () => {
    expect(chunkDoc({ id: "x", url: "u", sections: [{ title: "t", text: "too short" }] })).toEqual([]);
  });
});
