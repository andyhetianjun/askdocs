// Reads data/corpus/*.rst, chunks it, embeds each chunk, and writes data/index.json.
// If DATABASE_URL is set the chunks are also loaded into Postgres (pgvector).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chunkText } from "../src/lib/chunker";
import { createEmbedder } from "../src/lib/embed";
import { encodeVector, saveIndex, searchableText } from "../src/lib/memory-store";
import { PgStore } from "../src/lib/pg-store";
import { parseRst } from "../src/lib/rst";
import type { Chunk } from "../src/lib/types";

const corpusDir = path.join(process.cwd(), "data", "corpus");
const MIN_WORDS = 12;

export async function buildChunks(dir: string): Promise<Chunk[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".rst")).sort();
  const chunks: Chunk[] = [];
  for (const file of files) {
    const doc = file.replace(/\.rst$/, "");
    const url = `https://docs.python.org/3.12/library/${doc}.html`;
    let ordinal = 0;
    for (const section of parseRst(await readFile(path.join(dir, file), "utf8"))) {
      const title = section.title || doc;
      for (const text of chunkText(section.text)) {
        if (text.split(/\s+/).length < MIN_WORDS) continue;
        chunks.push({ id: `${doc}-${ordinal}`, doc, section: title, url, ordinal, text });
        ordinal++;
      }
    }
  }
  return chunks;
}

async function main() {
  const chunks = await buildChunks(corpusDir);
  console.log(`${chunks.length} chunks from ${new Set(chunks.map((c) => c.doc)).size} docs`);

  const embedder = createEmbedder();
  const t0 = performance.now();
  const vectors = await embedder.embed(chunks.map(searchableText));
  console.log(`embedded with ${embedder.name} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  await saveIndex(
    path.join(process.cwd(), "data", "index.json"),
    {
      embedder: { name: embedder.name, dims: embedder.dims },
      chunks: chunks.map((c, i) => ({ ...c, embedding: encodeVector(vectors[i]!) })),
    },
  );
  console.log("wrote data/index.json");

  if (process.env.DATABASE_URL) {
    const store = new PgStore(process.env.DATABASE_URL);
    try {
      await store.migrate();
      await store.replaceAll(chunks, vectors);
      console.log(`loaded ${await store.count()} chunks into Postgres`);
    } finally {
      await store.close();
    }
  }
}

if (process.argv[1]?.endsWith("ingest.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
