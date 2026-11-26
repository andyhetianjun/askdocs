import { reciprocalRankFusion } from "./rrf";
import type { Chunk, Embedder, Hit, Mode, Store } from "./types";

/** How many candidates each ranker contributes before fusion. */
const CANDIDATES = 30;

export interface Retrieval {
  hits: Hit[];
  /**
   * Cosine similarity of the question to the closest passage in the whole index.
   * RRF scores only say how two rankings were merged, so this is the number used to
   * decide whether the docs contain anything relevant at all.
   */
  topSimilarity: number;
}

export async function retrieveWithConfidence(
  store: Store,
  embedder: Embedder,
  query: string,
  mode: Mode,
  k = 5,
): Promise<Retrieval> {
  const [vector] = await embedder.embed([query]);
  if (!vector) throw new Error("embedder returned no vector");

  if (mode === "keyword") {
    const hits = (await store.keywordSearch(query, k)).slice(0, k);
    return { hits, topSimilarity: (await store.vectorSearch(vector, 1))[0]?.score ?? 0 };
  }
  if (mode === "vector") {
    const hits = await store.vectorSearch(vector, k);
    return { hits, topSimilarity: hits[0]?.score ?? 0 };
  }

  const [keyword, semantic] = await Promise.all([
    store.keywordSearch(query, CANDIDATES),
    store.vectorSearch(vector, CANDIDATES),
  ]);
  const byId = new Map<string, Chunk>();
  for (const h of [...keyword, ...semantic]) byId.set(h.chunk.id, h.chunk);
  const hits = reciprocalRankFusion([
    keyword.map((h) => ({ id: h.chunk.id })),
    semantic.map((h) => ({ id: h.chunk.id })),
  ])
    .slice(0, k)
    .map((f, i) => ({ chunk: byId.get(f.id)!, score: f.score, rank: i + 1 }));
  return { hits, topSimilarity: semantic[0]?.score ?? 0 };
}

export async function retrieve(
  store: Store,
  embedder: Embedder,
  query: string,
  mode: Mode,
  k = 5,
): Promise<Hit[]> {
  if (mode === "keyword") return (await store.keywordSearch(query, k)).slice(0, k);
  return (await retrieveWithConfidence(store, embedder, query, mode, k)).hits;
}
