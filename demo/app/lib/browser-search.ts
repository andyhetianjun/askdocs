import { Bm25Index } from "../../../src/lib/bm25";
import { reciprocalRankFusion } from "../../../src/lib/rrf";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Same cut-off as the full app (TransformersEmbedder.abstainBelow). */
export const ABSTAIN_BELOW = 0.45;

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/+esm";
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export interface Passage {
  id: string;
  doc: string;
  section: string;
  url: string;
  text: string;
}

export interface Result {
  passage: Passage;
  score: number;
  /** Cosine similarity to the question, when the model is available. */
  similarity: number | null;
}

export type Mode = "keyword" | "vector" | "hybrid";

interface IndexFile {
  chunks: (Passage & { embedding: string })[];
}

export interface Index {
  passages: Passage[];
  vectors: Float32Array[];
  bm25: Bm25Index;
}

const decode = (b64: string): Float32Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};

export async function loadIndex(): Promise<Index> {
  const res = await fetch(`${BASE}/data/index.json`);
  if (!res.ok) throw new Error(`Could not load the index (${res.status})`);
  const file = (await res.json()) as IndexFile;
  const passages = file.chunks.map(({ id, doc, section, url, text }) => ({ id, doc, section, url, text }));
  return {
    passages,
    vectors: file.chunks.map((c) => decode(c.embedding)),
    // the same text the full app indexes (searchableText in src/lib/memory-store.ts)
    bm25: new Bm25Index(passages.map((c) => `${c.doc} ${c.section}\n${c.text}`)),
  };
}

type Embed = (text: string) => Promise<Float32Array>;

/** Loads the same small embedding model as the full app (8-bit version) into the page. Throws if it cannot. */
export async function loadEmbedder(onStatus: (s: string) => void): Promise<Embed> {
  onStatus("Loading the search model (about 23 MB, cached after the first visit)...");
  const lib = await import(/* webpackIgnore: true */ TRANSFORMERS_URL);
  const extractor = await lib.pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
  return async (text: string) => {
    const out = await extractor([text], { pooling: "mean", normalize: true });
    return Float32Array.from(out.tolist()[0] as number[]);
  };
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

const CANDIDATES = 30;

export function search(index: Index, query: string, mode: Mode, vector: Float32Array | null, k = 5): { results: Result[]; topSimilarity: number | null } {
  const keyword = index.bm25.search(query, CANDIDATES);
  const semantic = vector
    ? index.vectors.map((v, i) => ({ index: i, score: dot(v, vector) })).sort((a, b) => b.score - a.score).slice(0, CANDIDATES)
    : [];
  const sim = new Map(semantic.map((s) => [s.index, s.score]));
  const topSimilarity = semantic[0]?.score ?? null;
  const similarityOf = (i: number) => (vector ? dot(index.vectors[i]!, vector) : null);
  const make = (i: number, score: number): Result => ({ passage: index.passages[i]!, score, similarity: sim.get(i) ?? similarityOf(i) });

  if (mode === "keyword" || !vector) return { results: keyword.slice(0, k).map((r) => make(r.index, r.score)), topSimilarity };
  if (mode === "vector") return { results: semantic.slice(0, k).map((r) => make(r.index, r.score)), topSimilarity };
  const fused = reciprocalRankFusion([keyword.map((r) => ({ id: String(r.index) })), semantic.map((r) => ({ id: String(r.index) }))]);
  return { results: fused.slice(0, k).map((f) => make(Number(f.id), f.score)), topSimilarity };
}
