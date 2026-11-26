# Connectors and incremental sync

askdocs can now read its documents from more than the Python docs: a folder of Markdown files, a Notion export, or a Slack export. And when you run it again after something changed, it only re-embeds the parts that changed. Changing one word in one document takes about 45 ms instead of about 18 seconds for a full rebuild.

## Why I added this

The first version could only read one fixed set of files, and every `npm run ingest` embedded all 1268 chunks again (about 18 seconds on my laptop), even if I had touched one line. That was fine for a demo but it is the first thing that would hurt with real notes that change daily. I wanted to see how to tell what changed, and how little work a small change really needs.

## Try it

```bash
npm run ingest                                            # the Python docs, as before
npm run ingest -- --markdown examples/sources/markdown \
                  --notion   examples/sources/notion \
                  --slack    examples/sources/slack         # three other kinds of source
npm run ingest -- --full                                  # ignore the old index and rebuild
npm run bench:sync                                        # the timings below
```

The index always matches the sources you name on that run. If you leave one out, its documents are reported as deleted and dropped. Run it twice and the second run says `0 added, 0 changed, 0 deleted` and embeds nothing.

The example sources in `examples/sources/` are small samples I wrote in the shape of each export format (they are not real data).

## The three connectors

| Source | Flag | What one document is | Details |
|---|---|---|---|
| Python docs (`.rst`) | `--rst` | one file | the original source, still the default |
| Markdown folder | `--markdown` | one `.md` file | split at `#` headings, `#` lines inside code fences are ignored, id is the path |
| Notion "Export as Markdown" | `--notion` | one page | the 32 character id Notion adds to every file name is removed, links to other pages become plain text, images are dropped, the title is the first `#` line |
| Slack export | `--slack` | one channel on one day | each thread (a message and its replies) is a section, `<@U123>` becomes a name from `users.json`, links keep their label, joins and leaves are skipped |

A connector is a class with a `load()` that returns documents (`id`, `url`, sections with a title and text). Adding another kind of source means writing one more of those (`src/lib/connectors/`).

## How the sync works

```
sources --> documents --> hash each document's content (sha256)
                              |
          compare with the hashes stored in the index (index.docs)
                              |
      same hash:  keep its old chunks as they are
      new / edited:  cut into chunks; a chunk whose text was seen before keeps its vector,
                     only chunks with new text are embedded
      gone from the sources:  dropped
```

- The index file now also stores a content hash for every document and a fingerprint of the embedding model plus chunk settings. If the fingerprint differs from the current one, vectors from the old model would be meaningless, so everything is rebuilt and the report says so.
- Re-use goes down to single chunks: the key is a hash of the exact text that gets embedded. That is why editing one word in a long document re-embeds one chunk and not the document.
- The result is the same as a full rebuild. A test builds an index step by step and in one go from the same documents and checks that every chunk id, text and vector matches.
- An index made before this change (no hashes) is accepted as long as the model is the same. Running `npm run ingest` on the committed index re-embedded 0 of 1268 chunks, which also shows the new chunking code makes the same chunks as the old code.

## Measured results

`npm run bench:sync` copies the Python docs plus the example Notion, Slack and Markdown sources to a temp folder, builds the index, then makes one change at a time. Times are wall clock on one laptop CPU with the real embedding model already loaded, and include reading and parsing the source files. Numbers are in `data/results/sync.json`.

| step | documents | chunks embedded | chunks reused | time |
|---|---|---|---|---|
| full build | 37 added | 1279 | 0 | 18.0 s |
| nothing changed | none | 0 | 1279 | 34 ms |
| one word edited in one doc | 1 changed | 1 | 1278 | 45 ms |
| a paragraph appended to one doc | 1 changed | 1 | 1279 | 31 ms |
| one new Markdown file | 1 added | 1 | 1280 | 30 ms |
| one doc deleted | 1 deleted | 0 | 1270 | 27 ms |
| full build again (for comparison) | 37 added | 1270 | 0 | 16.3 s |

So a small change costs roughly 400 to 600 times less than a rebuild here. Most of what is left is reading all the files and hashing them.

## Limits

- Change detection reads and hashes every source file each time. That is cheap at this size (37 documents) but it would not scale to something that should not be scanned in full on every run. The next step would be to ask the source what changed.
- The Notion and Slack readers handle the files in my samples and what I know of the export formats. I have not run them on a real export, so odd cases (Notion databases as CSV, Slack file uploads, edited and deleted messages) are not handled.
- An edit that shifts line boundaries early in a long document can change several chunks after it, so those are re-embedded too. The timing above edits one word and appends text, which is the cheap case.
- With Postgres the sync still replaces the whole table. Only the embedding work is incremental, not the database write.
- The Slack connector gives one document per channel per day, which keeps ids stable but splits a conversation across midnight.
