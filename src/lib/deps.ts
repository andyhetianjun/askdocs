import path from "node:path";
import { createEmbedder, HashEmbedder } from "./embed";
import { createGenerator, createVerifier } from "./llm";
import { MemoryStore } from "./memory-store";
import type { Deps } from "./pipeline";
import { PgStore } from "./pg-store";
import { JsonlTraceStore } from "./trace";
import { setupFromEnv } from "./tracing";
import type { Embedder, Store } from "./types";

export const INDEX_FILE = path.join(process.cwd(), "data", "index.json");

let cached: Promise<Deps> | null = null;
let override: Deps | null = null;

/** Lets tests swap in their own store, embedder and model. */
export function setDeps(deps: Deps | null): void {
  override = deps;
}

export function getDeps(): Promise<Deps> {
  if (override) return Promise.resolve(override);
  cached ??= build();
  return cached;
}

async function build(): Promise<Deps> {
  setupFromEnv(); // OpenTelemetry tracing, only when ASKDOCS_TRACE is set
  let store: Store;
  let embedder: Embedder;
  if (process.env.DATABASE_URL) {
    store = new PgStore(process.env.DATABASE_URL);
    embedder = createEmbedder();
  } else {
    const loaded = await MemoryStore.load(INDEX_FILE);
    store = loaded.store;
    embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : createEmbedder();
  }
  return {
    store,
    embedder,
    generator: createGenerator(),
    verifier: createVerifier(),
    traces: new JsonlTraceStore(process.env.TRACE_FILE ?? path.join(process.cwd(), "data", "traces.jsonl")),
  };
}
