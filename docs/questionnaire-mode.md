# Questionnaire mode

Give askdocs a list of questions and it drafts an answer for each one from the docs, with the sources listed. Each answer is marked **confident** or **needs review**, so you only have to read the ones that need it. You download the result as a CSV with the answers filled in.

If two questions are really the same question worded differently, the second one gets the same answer as the first, so a long list does not contradict itself.

## Why I added this

The first version answers one question at a time. But I kept thinking about the case where you have 40 questions to answer from the same set of docs (a checklist, a support backlog, a set of study questions) and you do not want to type each one in. A batch mode also forces the question "which answers can I trust without reading them?", which is what the confident label is for.

## Try it

In the app, open `/questionnaire`, paste questions (one per line) or load a CSV with a `question` column, and press "Draft answers".

From the command line:

```bash
npm run questionnaire -- examples/questionnaire.csv --out filled.csv
npm run questionnaire -- examples/questionnaire.csv --out filled.csv --bank answers.json   # remember answers between runs
```

`examples/questionnaire.csv` is a 12 question sample and `examples/questionnaire.filled.csv` is what the command wrote for it. Without `ANTHROPIC_API_KEY` the draft answers are quotes from the docs picked by how many words they share with the question (marked "offline draft" in the notes column). With a key they are written answers with citations, checked as described in [trustworthy-answers.md](trustworthy-answers.md).

The output has the original columns plus `answer`, `confidence`, `sources`, `notes` and `reused_from`.

## How it works

For each question, in order:

1. **Reuse.** The question is embedded and compared with every question answered earlier (in this run, and in the answer bank file). If one is at least 0.65 similar, its answer is copied. The copy keeps the label "confident" only if the match is at least 0.85 similar and the first answer was confident. A weaker match is copied but marked "needs review" with a note saying which question it was reused from.
2. **Draft.** Otherwise the question goes through the normal pipeline: retrieve, write sentences with citations, check each sentence, and say "I couldn't find this in the docs" when the docs do not cover it.
3. **Label.** The answer is **confident** only if all of these hold: the closest passage is at least 0.55 similar to the question, the answer contains at least 30% of the question's content words, and no sentence was dropped by the citation check. Everything else is **needs review**, and the notes column says which test failed.

New answers are added to the answer bank, so the next near-duplicate finds them.

## Measured results

`npm run eval:questionnaire` (data in `data/results/questionnaire.json`). This uses the 30 answerable and 12 unanswerable questions from the other evals, drafted with the offline quoting generator.

With the default cut-offs, 12 of the 30 answerable questions were marked confident, and 11 of those 12 cited a passage from the labeled doc. The other 18 were left for review. Of the 12 unanswerable questions, 1 was marked confident (the `getopt` question, which sits close to argparse in the index).

Moving the two cut-offs trades coverage for precision:

| similarity at least | answer covers question at least | confident | of those, cited the right doc | answerable left in needs review | unanswerable marked confident |
|---|---|---|---|---|---|
| 0.5 | 0 | 17 | 16 of 17 | 13 of 30 | 1 of 12 |
| 0.5 | 0.3 | 15 | 14 of 15 | 15 of 30 | 1 of 12 |
| 0.5 | 0.5 | 10 | 10 of 10 | 20 of 30 | 1 of 12 |
| 0.55 | 0 | 14 | 13 of 14 | 16 of 30 | 1 of 12 |
| **0.55** | **0.3 (default)** | 12 | 11 of 12 | 18 of 30 | 1 of 12 |
| 0.55 | 0.5 | 8 | 8 of 8 | 22 of 30 | 1 of 12 |
| 0.6 | 0 | 9 | 9 of 9 | 21 of 30 | 1 of 12 |
| 0.6 | 0.3 | 8 | 8 of 8 | 22 of 30 | 1 of 12 |
| 0.6 | 0.5 | 5 | 5 of 5 | 25 of 30 | 1 of 12 |

"Cited the right doc" only says the answer came from the right place in the docs. It does not say the quoted sentences answer the question, and the offline quotes often do not. That is why the label should not be read as "this answer is correct", only as "this is the kind of answer that is least likely to be wrong".

### Reuse

`data/reuse-pairs.json` has 12 questions that rephrase one of the 30 and 8 different questions on the same topic (for example "How do I rotate a deque?" next to "How do I limit a deque to the last few items?"). The 30 originals are already in the bank.

| reuse at least | rephrased matched to the right earlier question | different questions wrongly matched |
|---|---|---|
| 0.60 | 12 of 12 | 2 of 8 |
| **0.65 (default)** | 12 of 12 | 1 of 8 |
| 0.70 | 10 of 12 | 1 of 8 |
| 0.75 | 8 of 12 | 1 of 8 |
| 0.80 | 6 of 12 | 1 of 8 |
| 0.85 | 4 of 12 | 0 of 8 |

The one wrong match at the default is "How do I read a JSON string back into a Python dict?", which scores 0.83 against "How do I turn a Python dict into a JSON string with indentation?". The embedding model sees the same words and cannot tell the direction. Because 0.83 is under 0.85 it is copied but marked needs review, which is what that second cut-off is for. A wrong pair that scored 0.86 or more would be copied as confident.

## Limits

- The cut-offs were chosen while looking at these same questions, so they are probably a little optimistic.
- 42 questions and 20 reuse pairs is a small sample, written by me.
- Reuse only compares questions, not answers. Two similar questions can need different answers, and the answer bank has no way to expire an old answer when the docs change.
- The CLI and the page both draft questions one after another. 40 questions take a few seconds offline, but with a real model each question is a separate call.
