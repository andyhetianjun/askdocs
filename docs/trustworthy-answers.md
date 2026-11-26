# Checking that answers are backed by the docs

A written answer can sound right and still be wrong. In the first version of askdocs, the model was asked to cite passages like [1], but nothing checked that passage [1] actually says what the sentence claims. And when a question had no answer in the docs, the app still showed five passages and (with a key) wrote something anyway.

So I added two things:

1. **A citation check.** Every sentence in an answer must end with a citation, and the cited passage must back the sentence up. A sentence that fails is left out. If nothing is left, the app answers "I couldn't find this in the docs."
2. **An "I couldn't find this" path.** If even the closest passage in the index is a weak match for the question, the app says so and does not write an answer at all.

## Why I added this

I wanted to see how much of "the model made something up" can be caught by simple checks, and to measure it instead of guessing. Not all of it can, and the numbers below show where it falls short.

## How it works

```
question --> retrieve top 5 --> closest passage similar enough? --no--> "I couldn't find this in the docs."
                                          | yes
                                          v
                              model writes sentences ending in [n]
                                          |
                     for each sentence: does passage [n] back it up?
                         yes: keep it        no / no citation / bad number: drop it
                                          |
                          nothing kept? --> "I couldn't find this in the docs."
```

**The abstain cut-off.** Each passage and the question are embedded (a list of numbers that captures meaning). The cosine similarity of the question to its closest passage is the confidence signal. Below 0.45 the app abstains. Rank fusion scores can't be used for this because they only say how two rankings were merged, not whether anything is relevant.

**The offline citation check** (`src/lib/citations.ts`, `LexicalVerifier`) is an entailment-style word overlap test. It takes the claim and the cited passage text and looks at:

- how many of the claim's content words (stopwords removed, plurals stripped) appear in the passage,
- how many neighbouring word pairs appear in the passage,
- exact names and numbers in the claim (`frozen=True`, `os.path`, `3.12`), which must appear in the passage,
- negation: a claim that says "not" where the passage does not is rejected.

The score is 0.75 x word overlap + 0.25 x pair overlap, and 0.5 is the pass mark.

**The model check.** With `ANTHROPIC_API_KEY` set, `ModelVerifier` asks the model, for each sentence, whether the cited passages say what the sentence says. Set `ASKDOCS_VERIFIER=lexical` to keep the offline check even with a key. I could not run the model check here (no key), so it is covered by a test with a fake model only.

## Try it

```bash
npm run dev                          # the answer shows the check result, or the abstain notice
ASKDOCS_VERIFIER=lexical npm run eval:trust
npm test
```

Without a key you see passages only (and an abstain notice for questions the docs don't cover). `ASKDOCS_LLM=scripted` uses an offline stand-in that quotes the two best passages, which is what the numbers below use.

## Measured results

From `npm run eval:trust` (all numbers are in `data/results/trust.json`).

### Does the check tell backed claims from unbacked ones?

`data/citation-checks.json` has 36 claims I wrote by hand, each paired with one passage: 17 that the passage supports, and 19 that it doesn't (8 invented, 6 that contradict the passage, 5 that belong to a different passage).

| | result |
|---|---|
| precision (accepted claims that really are backed) | 72.7% |
| recall (backed claims that were accepted) | 94.1% |
| invented claims rejected | 6 of 8 |
| claims from the wrong passage rejected | 5 of 5 |
| claims that contradict the passage rejected | 2 of 6 |

A word-overlap check is good at "this is about something else" and bad at "this says the opposite". "heappop returns the largest item" shares every word with a passage that says "smallest", so it passes. That is the gap a model check is meant to fill.

The pass mark sweep, same 36 claims:

| pass mark | precision | recall |
|---|---|---|
| 0.4 | 66.7% | 94.1% |
| 0.5 | 72.7% | 94.1% |
| 0.6 | 68.4% | 76.5% |
| 0.7 | 60.0% | 35.3% |
| 0.8 | 62.5% | 29.4% |

### Does it refuse questions the docs can't answer?

`data/unanswerable-questions.json` has 12 questions the 30 indexed modules do not cover: 9 about Python modules that are not in the index (smtplib, tkinter, asyncio and so on) and 3 that have nothing to do with Python. The 30 answerable questions are the ones from the retrieval eval.

| refuse below | answerable wrongly refused | unanswerable correctly refused |
|---|---|---|
| 0.30 | 0.0% | 33.3% |
| 0.35 | 0.0% | 50.0% |
| 0.40 | 0.0% | 58.3% |
| **0.45 (default)** | 10.0% | 66.7% |
| 0.50 | 26.7% | 91.7% |
| 0.55 | 43.3% | 91.7% |

At the default, 8 of the 12 unanswerable questions were refused and 27 of 30 answerable ones were answered. The four that were not refused are the ones that sound like the docs: `getopt` (close to argparse), `asyncio.gather` (close to threading), a multiprocessing pool and decimal rounding. A question about a missing module that sits near a module in the index gets a similarity score like a real question.

### The whole pipeline, offline

With the offline generator (it quotes the sentences of the top passages that share the most words with the question), 85.2% of 54 citations pointed at a passage from the labeled doc before the check and 86.5% of the 52 that survived did after it. So the check dropped 2 citations and both were wrong-doc ones. The generator only quotes, so it cannot invent anything, and this line shows the plumbing works more than it shows the check is good. The table above is the real test of the check.

### With a real model, recorded

| | offline quoting generator | recorded Claude Sonnet 5.5 |
|---|---|---|
| answerable questions answered | 27 of 30 | 28 of 30 |
| unanswerable questions correctly refused | 8 of 12 | 12 of 12 |
| unanswerable questions answered anyway | 4 of 12 | 0 of 12 |
| kept citations pointing at the labeled doc | 86.5% of 52 | 99.1% of 107 |
| answer sentences kept by the citation check | not measured | 107 of 134 (79.9%) |

Each Claude answer was recorded once, by a separate fresh Claude Sonnet 5.5 session that was shown only the question and the five retrieved passages (see [RECORDING.md](../RECORDING.md)); it is not a live call and has no retries. The offline column is the quoting generator with the 0.45 similarity cut-off, so it refuses before writing; the Claude column has no cut-off, the model decided by itself. The citation check is the offline word-overlap version, not a model. Reproduce with `npm run eval:trust` and `npm run eval -- --from-recordings recordings/claude-sonnet-5-5`.

Three cases that show what the numbers mean:

- **A sentence the check dropped (q33, "How do I limit a deque to the last few items?").** Claude wrote five cited sentences and the check kept four. The dropped one was "Pass a maxlen argument when you create the deque." It is correct, but the passage only shows `deque([iterable, [maxlen]])`, so the word overlap was too low. So 27 dropped sentences out of 134 are not 27 wrong sentences. I have not hand-labeled them, so I cannot say how many were really unsupported.
- **A correct refusal (the smtplib question).** The index has no smtplib doc, and the model replied exactly "I couldn't find this in the docs." The offline path refuses this one too, but it missed 4 other unanswerable questions that the model refused.
- **A refusal that cost an answer (q13, "How do I stop two threads from changing shared data at the same moment?").** The docs do cover this (the answer is a lock), but the five passages did not include the `Lock` section, so the model refused. That one is a search miss more than a model error. The other wrongly refused question, q16 (counting items), did have the `Counter` passages in its top five and the model still refused; I did not look into why.

## Limits

- 36 claims and 42 questions is a small sample, and I wrote them all. I also chose the two cut-offs (0.5 and 0.45) while looking at these same numbers, so they are probably a little better than they would be on new questions.
- The model check is untested against a real model.
- Citations are checked one sentence at a time against only the passages it cites. A sentence that needs two passages together is judged on both joined, which is lenient.
- "Does the passage say it" is not the same as "is it correct". The docs can be out of date.
