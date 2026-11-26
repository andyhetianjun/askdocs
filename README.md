# askdocs

![CI](https://github.com/andyhetianjun/askdocs/actions/workflows/ci.yml/badge.svg)

I built a small web app that answers questions about Python's standard library docs because I wanted to understand how "ask your docs" search actually finds the right passage, and how to measure whether it does. I picked Python's docs because I read them anyway.

**Try it:** https://andyhetianjun.github.io/askdocs/ (search runs in your browser, no server and no key)

**Install in one line** (Node 20 or newer):

```bash
npx github:andyhetianjun/askdocs ask "how do I limit a deque to the last few items?"
```

It prints the five passages from the docs that match best, each with a link. The first run installs the dependencies and downloads a small embedding model (about 90 MB); in my test the first run took about a minute and left about 1.3 GB in the npm cache, later runs took a few seconds. Set `ANTHROPIC_API_KEY` to also get a written answer with citations.

![The demo: typing a question, then the matching passages, then a question the docs do not cover](docs/img/demo.gif)

## Features

- [Checking that answers are backed by the docs](docs/trustworthy-answers.md): every answer sentence must cite a passage that really says it, and the app says "I couldn't find this in the docs" when the docs do not cover the question.
- [Questionnaire mode](docs/questionnaire-mode.md): paste or upload a list of questions, get a drafted answer for each, labelled confident or needs review, as a filled CSV. Near-duplicate questions get the same answer.
- [Connectors and incremental sync](docs/connectors-and-sync.md): read Markdown folders, Notion exports and Slack exports, and re-embed only what changed (about 45 ms for a one word edit, against about 18 s for a full rebuild).
- [Recorded model runs](RECORDING.md): a small harness that shows a model each question with its retrieved passages, saves the answer it writes, and scores it with the citation check and the refusal check. The demo has a section for these recordings.
- [The browser demo](docs/demo.md): the search runs entirely in the page, plus the measured results.

## What it does

You type a question like "how do I make a dataclass read-only?" and it shows the five passages from the docs most likely to answer it, each with a link back to its doc and section. If you set an Anthropic API key, it also writes a short answer that cites those passages. Without a key you still get the passages.

The part I cared about most is the measuring. The repo has 30 questions I wrote by hand, each labeled with the doc and section that should answer it, and one command that scores three ways of searching:

- Keyword search (BM25) scores passages by how often your words appear, and how rare they are.
- Vector search turns the question and every passage into an embedding (a list of numbers that captures what a passage means) and finds the closest ones.
- Hybrid search runs both and merges the two ranked lists.

Every request is also recorded (time taken, which passages came back, tokens used), and the `/traces` page shows them.

## Results

The index has 1268 passages ("chunks") from 30 library docs. A question counts as a hit if one of the top 5 chunks comes from the right doc and the right section. recall@5 is the share of questions with a hit in the top 5. MRR (mean reciprocal rank) is the average of 1 divided by the position of the first correct chunk, so 1.0 means it was always first.

Right doc and right section:

| Search | recall@5 | MRR | avg ms per query |
|---|---|---|---|
| keyword (BM25) | 0.700 | 0.585 | 0.2 |
| vector | 0.867 | 0.684 | 2.5 |
| hybrid (RRF) | 0.900 | 0.703 | 2.2 |

Right doc only:

| Search | recall@5 | MRR | avg ms per query |
|---|---|---|---|
| keyword (BM25) | 1.000 | 0.872 | 0.2 |
| vector | 1.000 | 0.983 | 2.5 |
| hybrid (RRF) | 1.000 | 1.000 | 2.2 |

Reproduce with `npm run eval`. It uses the in-memory index on one laptop CPU. Timings include embedding the question but not loading the model.

Things I would not read too much into:

- 30 questions is small. Hybrid vs vector at the section level is one question (27 vs 26 hits in the top 5).
- Sections are coarse, and some answers sit in neighbouring sections. For example "make instances of a dataclass read-only" should land in "Frozen instances", but none of the three methods put that section in the top 5.
- I wrote the questions before running the eval and only fixed one label that pointed at the wrong section. I did not tune the chunk size, the BM25 settings or the questions against the scores.
- It was not run against the Postgres backend on my machine (no Docker daemon was running), so the numbers are for the in-memory backend. The Postgres code and its test are in the repo and run in CI, but I have not seen them pass yet.

## Try it

You need Node 20 or newer. The search index is already in the repo, so no Docker and no key are needed.

```bash
npm install
npm run dev          # http://localhost:3000
```

The first question downloads the embedding model (about 90 MB, cached after that).

Optional:

```bash
export ANTHROPIC_API_KEY=...     # written answers with citations
npm run ingest                   # bring data/index.json up to date (only changed docs are re-embedded)
npm run eval                     # the tables above
npm run eval:trust               # citation check and "I couldn't find this" numbers
npm run eval:questionnaire       # questionnaire labels and answer reuse numbers
npm run bench:sync               # incremental sync timings
npm run questionnaire -- examples/questionnaire.csv --out filled.csv
npm run build:demo               # the static browser demo in demo/out

docker compose up -d db          # Postgres with pgvector
export DATABASE_URL=postgres://askdocs:askdocs@localhost:5432/askdocs
npm run ingest                   # also loads the chunks into Postgres
npm run dev                      # now searches Postgres
```

`npm run fetch` re-downloads the docs if you want to change the list of modules.

## How it works

```mermaid
flowchart LR
    D[Python docs] --> C[split into chunks]
    C --> E[embed each chunk]
    E --> I[(index.json)]
    Q[your question] --> K[keyword search]
    Q --> V[vector search]
    I --> K
    I --> V
    K --> R[merge with RRF]
    V --> R
    R --> P[top 5 passages]
    P --> A[model writes a cited answer]
    A --> X[check each sentence against its citation]
    X --> O["answer, or: I couldn't find this in the docs"]
```

1. The docs are split by heading, then each section is cut into chunks of about 160 words with a 30 word overlap, so an answer that straddles a cut is not lost.
2. Each chunk is embedded locally with all-MiniLM-L6-v2, a small model that needs no key.
3. For a question, keyword search and vector search each return a ranked list.
4. Reciprocal rank fusion (RRF) merges them. A chunk gets `1 / (60 + rank)` from each list and the scores are added. That way keyword scores and similarity scores never have to be compared directly.
5. The top 5 chunks are shown, and if a key is set they are sent to an Anthropic model to write a cited answer.

More detail and the file layout are in [docs/design.md](docs/design.md).

## Tests and CI

```bash
npm test             # 81 tests pass, 1 skipped (needs DATABASE_URL)
npm run lint
npm run typecheck
```

The tests cover the chunker, the RRF merge, the eval metrics, BM25, the RST reader, the citation check, questionnaire drafting and answer reuse, the Markdown, Notion and Slack readers, incremental sync, and the `/api/ask`, `/api/questionnaire` and `/api/traces` routes. They use a deterministic hash-based embedder, so they need no downloads, database or key. The Postgres test runs when `DATABASE_URL` is set. GitHub Actions runs lint, typecheck, tests and a production build, deploys the demo to GitHub Pages, runs the Postgres test against a pgvector service, and builds the Dockerfile. The Docker build has not run yet, since I have no Docker daemon here.

## Data

The docs are the Python 3.12 standard library reference (`Doc/library/*.rst`, tag v3.12.7 of [python/cpython](https://github.com/python/cpython)), 30 modules. Copyright Python Software Foundation, used under the PSF license (docs.python.org/3/license.html). Embeddings use [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), an ONNX version of sentence-transformers/all-MiniLM-L6-v2 (Apache 2.0).

## What I would do next

- Run the Postgres path end to end and add its numbers to the tables.
- Write more questions, including some where the answer is spread over two sections, and label a set of acceptable sections instead of one.
- Try a reranker on the top 20 and see whether it changes MRR.
- Run the model-based citation check against a real model. Only the offline word-overlap version has been measured so far.
- Try a reranker to catch the unanswerable questions that sit close to a module in the index (`getopt` next to `argparse`).

## License

MIT
