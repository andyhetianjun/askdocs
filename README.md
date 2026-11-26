# askdocs

[![CI](https://github.com/andyhetianjun/askdocs/actions/workflows/ci.yml/badge.svg)](https://github.com/andyhetianjun/askdocs/actions/workflows/ci.yml)

Ask questions about a small set of Python standard library docs and get back the passages that answer them, with citations. If an Anthropic API key is set, it also writes a short answer that cites those passages.

I built this to learn how to measure retrieval instead of guessing. The repo has a labeled question set and an `npm run eval` command that compares keyword search, vector search and a hybrid of the two. Every request is traced, and there is a `/traces` page to look at them.

## Results

30 questions I wrote by hand, each labeled with the doc and the section that should answer it. A result counts as a hit if a returned chunk comes from that doc and that section. The index has 1268 chunks from 30 docs, and embeddings come from all-MiniLM-L6-v2.

Section level (right doc and right section):

| Retrieval | recall@5 | MRR | avg ms per query |
|---|---|---|---|
| keyword (BM25) | 0.700 | 0.585 | 0.2 |
| vector | 0.867 | 0.684 | 2.9 |
| hybrid (RRF) | 0.900 | 0.703 | 2.7 |

Doc level (right doc only):

| Retrieval | recall@5 | MRR | avg ms per query |
|---|---|---|---|
| keyword (BM25) | 1.000 | 0.872 | 0.2 |
| vector | 1.000 | 0.983 | 2.9 |
| hybrid (RRF) | 1.000 | 1.000 | 2.7 |

Reproduce with `npm run eval` (in-memory index, one laptop CPU, timings include query embedding but not model loading).

Things I would not read too much into:

- 30 questions is small. Hybrid vs vector at the section level is one question (27 vs 26 hits in the top 5).
- Sections are coarse, and some answers sit in neighbouring sections. For example "make instances of a dataclass read-only" should land in "Frozen instances", but none of the three methods put that section in the top 5.
- I wrote the questions before running the eval and only fixed one label that pointed at the wrong section. I did not tune the chunk size, the BM25 settings or the questions against the scores.
- It was not run against the Postgres backend in my environment (no Docker daemon was running), so the numbers above are for the in-memory backend. The Postgres code and its test are in the repo and run in CI, but I have not seen them pass yet.

## How it works

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
- `src/lib/bm25.ts` and `src/lib/pg-store.ts` are the keyword side. The vector side is cosine similarity in memory, or pgvector in Postgres.
- `src/lib/rrf.ts` merges the two ranked lists. Each item gets `1 / (60 + rank)` from each list, and the scores are added. That way BM25 scores and cosine scores never need to be compared.
- `src/lib/llm.ts` calls `claude-sonnet-5-5` through the official SDK. Without a key the UI shows passages only. `ASKDOCS_LLM=scripted` swaps in an offline stand-in that quotes the best passages; the tests use it.
- `src/lib/trace.ts` appends one JSON line per request to `data/traces.jsonl` (ignored by git).

## Run it

You need Node 20 or newer. The search index is already committed, so no Docker and no key are needed.

```bash
npm install
npm run dev          # http://localhost:3000
```

The first question downloads the embedding model (about 90 MB, cached after that).

Optional steps:

```bash
export ANTHROPIC_API_KEY=...     # written answers with citations
npm run ingest                   # rebuild data/index.json from data/corpus
npm run eval                     # recall@5 and MRR table

docker compose up -d db          # Postgres with pgvector
export DATABASE_URL=postgres://askdocs:askdocs@localhost:5432/askdocs
npm run ingest                   # also loads the chunks into Postgres
npm run dev                      # now searches Postgres
```

`npm run fetch` re-downloads the docs subset if you want to change the list of modules.

## Tests

```bash
npm test             # Vitest: 30 tests pass, 1 skipped (needs DATABASE_URL)
npm run lint
npm run typecheck
```

They cover the chunker, RRF merge, the eval metrics, BM25 and the RST reader, and the `/api/ask` and `/api/traces` routes. The tests use a deterministic hash-based embedder, so they run with no downloads, no database and no key. The Postgres test runs when `DATABASE_URL` is set, and CI runs it against a pgvector service.

## Data

The docs are the Python 3.12 standard library reference (`Doc/library/*.rst`, tag v3.12.7 of [python/cpython](https://github.com/python/cpython)), 30 modules. Copyright Python Software Foundation, used under the PSF license (docs.python.org/3/license.html). Embeddings use [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), an ONNX version of sentence-transformers/all-MiniLM-L6-v2 (Apache 2.0).

## What I'd do next

- Run the Postgres path end to end and add its numbers to the table above.
- Write more questions, including some where the answer is spread over two sections, and label a set of acceptable sections instead of one.
- Try a cross-encoder reranker on the top 20 and see whether it changes MRR.
- Check that cited passages really support each sentence of the answer.
- Store traces in Postgres when it is configured, with a latency chart on the traces page.

## License

MIT
