// Runs the labeled questions through keyword, vector and hybrid retrieval and prints the scores.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "../src/lib/deps";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import { evaluate, formatTable, type LabeledQuestion } from "../src/lib/evaluate";
import { MemoryStore } from "../src/lib/memory-store";
import { PgStore } from "../src/lib/pg-store";
import type { Embedder, Store } from "../src/lib/types";

async function main() {
  const from = process.argv.indexOf("--from-recordings");
  if (from > -1) {
    const { evalRecordings } = await import("./eval-recordings");
    await evalRecordings(process.argv[from + 1] ?? "recordings/claude-sonnet-5-5");
    return;
  }
  const questions = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "eval-questions.json"), "utf8"),
  ) as LabeledQuestion[];

  let store: Store;
  let embedder: Embedder;
  let backend: string;
  if (process.env.DATABASE_URL) {
    store = new PgStore(process.env.DATABASE_URL);
    embedder = new TransformersEmbedder();
    backend = "Postgres (pgvector + tsvector)";
  } else {
    const loaded = await MemoryStore.load(INDEX_FILE);
    store = loaded.store;
    embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
    backend = "in-memory (BM25 + cosine)";
  }

  try {
    console.log(`${questions.length} questions, ${await store.count()} chunks, ${backend}, embedder ${embedder.name}\n`);
    const scores = await evaluate(store, embedder, questions);
    console.log("Section level (right doc and right section within the top results)\n");
    console.log(formatTable(scores, "section"));
    console.log("\nDoc level (right doc only)\n");
    console.log(formatTable(scores, "doc"));
    if (!process.env.DATABASE_URL) {
      await mkdir(path.join(process.cwd(), "data", "results"), { recursive: true });
      await writeFile(
        path.join(process.cwd(), "data", "results", "retrieval.json"),
        JSON.stringify({ questions: questions.length, chunks: await store.count(), embedder: embedder.name, scores }, null, 2) + "\n",
      );
    }
  } finally {
    await store.close?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
