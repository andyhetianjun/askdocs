import pg from "pg";
import { queryTerms } from "./tokenize";
import type { Chunk, Hit, Store } from "./types";

export const SCHEMA = `
create extension if not exists vector;
create table if not exists chunks (
  id text primary key,
  doc text not null,
  section text not null,
  url text not null,
  ordinal int not null,
  text text not null,
  embedding vector(384) not null,
  tsv tsvector generated always as (to_tsvector('english', doc || ' ' || section || ' ' || text)) stored
);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
`;

interface Row {
  id: string;
  doc: string;
  section: string;
  url: string;
  ordinal: number;
  text: string;
  score: number;
}

const toHit = (r: Row, i: number): Hit => ({
  chunk: { id: r.id, doc: r.doc, section: r.section, url: r.url, ordinal: r.ordinal, text: r.text },
  score: Number(r.score),
  rank: i + 1,
});

const vectorLiteral = (v: Float32Array): string => `[${Array.from(v).join(",")}]`;

/** Postgres with pgvector for similarity and tsvector for keyword search. */
export class PgStore implements Store {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 4 });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async replaceAll(chunks: Chunk[], vectors: Float32Array[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("truncate chunks");
      for (const [i, c] of chunks.entries()) {
        await client.query(
          "insert into chunks (id, doc, section, url, ordinal, text, embedding) values ($1,$2,$3,$4,$5,$6,$7::vector)",
          [c.id, c.doc, c.section, c.url, c.ordinal, c.text, vectorLiteral(vectors[i]!)],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async keywordSearch(query: string, k: number): Promise<Hit[]> {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];
    // OR the terms together: questions are sentences, so requiring every word would find nothing
    const tsquery = terms.map((t) => `'${t}'`).join(" | ");
    const { rows } = await this.pool.query<Row>(
      `select id, doc, section, url, ordinal, text, ts_rank_cd(tsv, q) as score
       from chunks, to_tsquery('english', $1) q
       where tsv @@ q order by score desc, id limit $2`,
      [tsquery, k],
    );
    return rows.map(toHit);
  }

  async vectorSearch(vector: Float32Array, k: number): Promise<Hit[]> {
    const { rows } = await this.pool.query<Row>(
      `select id, doc, section, url, ordinal, text, 1 - (embedding <=> $1::vector) as score
       from chunks order by embedding <=> $1::vector, id limit $2`,
      [vectorLiteral(vector), k],
    );
    return rows.map(toHit);
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>("select count(*) as n from chunks");
    return Number(rows[0]?.n ?? 0);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
