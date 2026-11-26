import { readFile, writeFile } from "node:fs/promises";
import { Bm25Index } from "./bm25";
import type { Chunk, Hit, Store } from "./types";

export interface IndexFile {
  embedder: { name: string; dims: number };
  chunks: (Chunk & { embedding: string })[]; // embedding is base64 of a Float32Array
  /** Content hash of every document that was indexed. Used to find what changed. Missing in older index files. */
  docs?: Record<string, string>;
  /** Fingerprint of the embedding model and chunk settings the vectors were made with. */
  config?: string;
}

/** Text that is searched: the title parts help short chunks match the right topic. */
export const searchableText = (c: Pick<Chunk, "doc" | "section" | "text">): string =>
  `${c.doc} ${c.section}\n${c.text}`;

export class MemoryStore implements Store {
  private readonly bm25: Bm25Index;

  constructor(
    private readonly chunks: Chunk[],
    private readonly vectors: Float32Array[],
  ) {
    if (chunks.length !== vectors.length) throw new Error("chunks and vectors differ in length");
    this.bm25 = new Bm25Index(chunks.map(searchableText));
  }

  async keywordSearch(query: string, k: number): Promise<Hit[]> {
    return this.bm25.search(query, k).map((r, i) => ({ chunk: this.chunks[r.index]!, score: r.score, rank: i + 1 }));
  }

  async vectorSearch(vector: Float32Array, k: number): Promise<Hit[]> {
    const scored = this.vectors.map((v, index) => ({ index, score: dot(v, vector) }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.slice(0, k).map((r, i) => ({ chunk: this.chunks[r.index]!, score: r.score, rank: i + 1 }));
  }

  async count(): Promise<number> {
    return this.chunks.length;
  }

  static fromIndex(index: IndexFile): MemoryStore {
    const chunks = index.chunks.map((c) => ({
      id: c.id,
      doc: c.doc,
      section: c.section,
      url: c.url,
      ordinal: c.ordinal,
      text: c.text,
    }));
    return new MemoryStore(chunks, index.chunks.map((c) => decodeVector(c.embedding)));
  }

  static async load(file: string): Promise<{ store: MemoryStore; embedder: IndexFile["embedder"] }> {
    const index = JSON.parse(await readFile(file, "utf8")) as IndexFile;
    return { store: MemoryStore.fromIndex(index), embedder: index.embedder };
  }
}

export async function saveIndex(file: string, index: IndexFile): Promise<void> {
  await writeFile(file, JSON.stringify(index));
}

export const encodeVector = (v: Float32Array): string =>
  Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");

export function decodeVector(s: string): Float32Array {
  const buf = Buffer.from(s, "base64");
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
