# Design notes

```
data/corpus/*.rst  --ingest-->  chunks (about 160 words, 30 word overlap)
                                   |
                     embed with all-MiniLM-L6-v2 (local, no key)
                                   |
                   data/index.json     or     Postgres (pgvector + tsvector)

question --> keyword search (BM25 / ts_rank_cd) --\
         \-> vector search (cosine)              ---> reciprocal rank fusion --> top 5 chunks
                                                                                   |
                                      Anthropic model writes a cited answer  <-----+  (only if ANTHROPIC_API_KEY is set)
                                                                                   |
                                  trace: retrieval ms, chunks, tokens  --> /traces
```

- `src/lib/rst.ts` reads the Sphinx source of the docs and splits it by heading.
- `src/lib/chunker.ts` cuts each section into line-based chunks with overlap.
- `src/lib/bm25.ts` and `src/lib/pg-store.ts` are the keyword side. The vector side is cosine similarity in memory (`memory-store.ts`), or pgvector in Postgres.
- `src/lib/rrf.ts` merges the two ranked lists.
- `src/lib/evaluate.ts` and `metrics.ts` compute recall@5 and MRR against `data/eval-questions.json`.
- `src/lib/llm.ts` calls `claude-sonnet-5-5` through the official SDK. Without a key the UI shows passages only. `ASKDOCS_LLM=scripted` swaps in an offline stand-in that quotes the best passages; the tests use it.
- `src/lib/trace.ts` appends one JSON line per request to `data/traces.jsonl` (ignored by git).
