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
- `src/lib/citations.ts` splits an answer into sentences and checks each one against the passage it cites (word-overlap offline, a model call with a key). `pipeline.ts` also refuses when the closest passage is too far from the question. See [trustworthy-answers.md](trustworthy-answers.md).
- `src/lib/questionnaire.ts`, `answer-bank.ts` and `csv.ts` draft answers for a list of questions and reuse answers for near-duplicates. See [questionnaire-mode.md](questionnaire-mode.md).
- `src/lib/connectors/` read the Python docs, Markdown, Notion and Slack into one document shape, and `sync.ts` updates the index from them by content hash. See [connectors-and-sync.md](connectors-and-sync.md).
- `demo/` is a separate static Next.js app that reuses `src/lib/bm25.ts` and `rrf.ts` in the browser. See [demo.md](demo.md).
- `src/lib/trace.ts` appends one JSON line per request to `data/traces.jsonl` (ignored by git).
