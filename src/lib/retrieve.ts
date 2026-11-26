import { reciprocalRankFusion } from "./rrf";
import { withSpan } from "./tracing";
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
  return withSpan(
    `retrieval ${mode}`,
    {
      "gen_ai.operation.name": "retrieval",
      "gen_ai.data_source.id": "python-stdlib-docs",
      "askdocs.retrieval.mode": mode,
      "askdocs.retrieval.k": k,
    },
    async (span) => {
      const result = await retrieveInner(store, embedder, query, mode, k);
      span.setAttribute("askdocs.retrieval.results", result.hits.length);
      span.setAttribute("askdocs.retrieval.top_similarity", Math.round(result.topSimilarity * 1000) / 1000);
      return result;
    },
  );
}

const embedQuery = (embedder: Embedder, query: string): Promise<Float32Array[]> =>
  withSpan(
    `embeddings ${embedder.name}`,
    {
      "gen_ai.operation.name": "embeddings",
      "gen_ai.provider.name": embedder.name.startsWith("hash") ? "askdocs.test" : "transformers.js",
      "gen_ai.request.model": embedder.name,
      "gen_ai.embeddings.dimension.count": embedder.dims,
    },
    () => embedder.embed([query]),
  );

const searching = (name: string, run: () => Promise<Hit[]>): Promise<Hit[]> =>
  withSpan(`askdocs.${name}`, {}, async (span) => {
    const hits = await run();
    span.setAttribute("askdocs.results", hits.length);
    return hits;
  });

async function retrieveInner(
  store: Store,
  embedder: Embedder,
  query: string,
  mode: Mode,
  k: number,
): Promise<Retrieval> {
  const [vector] = await embedQuery(embedder, query);
  if (!vector) throw new Error("embedder returned no vector");

  if (mode === "keyword") {
    const hits = (await searching("keyword_search", () => store.keywordSearch(query, k))).slice(0, k);
    return { hits, topSimilarity: (await store.vectorSearch(vector, 1))[0]?.score ?? 0 };
  }
  if (mode === "vector") {
    const hits = await searching("vector_search", () => store.vectorSearch(vector, k));
    return { hits, topSimilarity: hits[0]?.score ?? 0 };
  }

  const [keyword, semantic] = await Promise.all([
    searching("keyword_search", () => store.keywordSearch(query, CANDIDATES)),
    searching("vector_search", () => store.vectorSearch(vector, CANDIDATES)),
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
