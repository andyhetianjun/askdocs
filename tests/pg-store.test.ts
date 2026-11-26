import { describe, expect, it } from "vitest";
import { HashEmbedder } from "@/lib/embed";
import { searchableText } from "@/lib/memory-store";
import { PgStore } from "@/lib/pg-store";
import { retrieve } from "@/lib/retrieve";
import type { Chunk } from "@/lib/types";

// Only runs when a Postgres with pgvector is available: DATABASE_URL=... npm test
describe.skipIf(!process.env.DATABASE_URL)("PgStore", () => {
  it("stores chunks and ranks them with keyword, vector and hybrid search", async () => {
    const chunks: Chunk[] = [
      { id: "t-0", doc: "json", section: "Basic Usage", url: "u", ordinal: 0, text: "dumps serializes an object to a JSON string" },
      { id: "t-1", doc: "csv", section: "Reader Objects", url: "u", ordinal: 0, text: "DictReader reads each row into a dictionary" },
    ];
    const embedder = new HashEmbedder();
    const store = new PgStore(process.env.DATABASE_URL!, "chunks_test");
    try {
      await store.migrate();
      await store.replaceAll(chunks, await embedder.embed(chunks.map(searchableText)));
      expect(await store.count()).toBe(2);
      for (const mode of ["keyword", "vector", "hybrid"] as const) {
        const hits = await retrieve(store, embedder, "DictReader row dictionary", mode, 2);
        expect(hits[0]?.chunk.id).toBe("t-1");
      }
    } finally {
      await store.close();
    }
  });
});
