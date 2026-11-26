export interface Chunk {
  id: string;
  doc: string; // module name, e.g. "json"
  section: string; // nearest heading, e.g. "Basic Usage"
  url: string;
  ordinal: number; // position of the chunk inside its doc
  text: string;
}

export type Mode = "keyword" | "vector" | "hybrid";

export interface Hit {
  chunk: Chunk;
  score: number;
  rank: number; // 1-based
}

export interface Store {
  /** BM25 or full-text ranking, best first. */
  keywordSearch(query: string, k: number): Promise<Hit[]>;
  /** Cosine similarity ranking over normalized vectors, best first. */
  vectorSearch(vector: Float32Array, k: number): Promise<Hit[]>;
  count(): Promise<number>;
  close?(): Promise<void>;
}

export interface Embedder {
  readonly name: string;
  readonly dims: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  /**
   * Questions whose best passage scores below this cosine similarity are treated as not
   * answered by the docs. It depends on the model's score scale, so it lives with the embedder.
   */
  readonly abstainBelow?: number;
}
