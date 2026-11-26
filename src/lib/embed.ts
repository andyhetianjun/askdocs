import type { Embedder } from "./types";

export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const DIMS = 384;

/** Local sentence embeddings (all-MiniLM-L6-v2 through transformers.js). No API key. */
export class TransformersEmbedder implements Embedder {
  readonly name = MODEL_ID;
  readonly dims = DIMS;
  private extractor: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | null = null;

  private load() {
    if (!this.extractor) {
      this.extractor = import("@huggingface/transformers").then(async (m) => {
        const pipe = await m.pipeline("feature-extraction", MODEL_ID, { dtype: "fp32" });
        return pipe as unknown as (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;
      });
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const run = await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const result = await run(batch, { pooling: "mean", normalize: true });
      for (const row of result.tolist()) out.push(Float32Array.from(row));
    }
    return out;
  }
}

/**
 * Deterministic bag-of-words hashing into 384 dimensions. It is not a real semantic model.
 * It exists so tests and CI can run the whole pipeline without downloading anything.
 */
export class HashEmbedder implements Embedder {
  readonly name = "hash-384 (tests only)";
  readonly dims = DIMS;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => hashVector(t, this.dims));
  }
}

function hashVector(text: string, dims: number): Float32Array {
  const v = new Float32Array(dims);
  for (const token of text.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
    v[(h >>> 0) % dims]! += (h & 0x100) === 0 ? 1 : -1;
  }
  return normalize(v);
}

export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

export function createEmbedder(): Embedder {
  return process.env.ASKDOCS_EMBEDDER === "hash" ? new HashEmbedder() : new TransformersEmbedder();
}
