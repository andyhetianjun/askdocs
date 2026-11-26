import { reciprocalRankFusion } from "./rrf";
import type { Chunk, Embedder, Hit, Mode, Store } from "./types";

/** How many candidates each ranker contributes before fusion. */
const CANDIDATES = 30;

export async function retrieve(
  store: Store,
  embedder: Embedder,
  query: string,
  mode: Mode,
  k = 5,
): Promise<Hit[]> {
  if (mode === "keyword") return (await store.keywordSearch(query, k)).slice(0, k);
  const [vector] = await embedder.embed([query]);
  if (!vector) throw new Error("embedder returned no vector");
  if (mode === "vector") return store.vectorSearch(vector, k);

  const [keyword, semantic] = await Promise.all([
    store.keywordSearch(query, CANDIDATES),
    store.vectorSearch(vector, CANDIDATES),
  ]);
  const byId = new Map<string, Chunk>();
  for (const h of [...keyword, ...semantic]) byId.set(h.chunk.id, h.chunk);
  return reciprocalRankFusion([
    keyword.map((h) => ({ id: h.chunk.id })),
    semantic.map((h) => ({ id: h.chunk.id })),
  ])
    .slice(0, k)
    .map((f, i) => ({ chunk: byId.get(f.id)!, score: f.score, rank: i + 1 }));
}
