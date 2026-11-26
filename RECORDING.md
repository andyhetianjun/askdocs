# Recording a model's answers

This file is the instruction sheet for a model that is being tested. A recording is one question, the passages the search returned for it, and the answer the model wrote. The answers are scored afterwards with the citation check (does each sentence say what its cited passage says?) and the refusal check (does the model say "I couldn't find this in the docs." when the passages do not answer the question?).

## If you are the model being tested

You are answering Python standard library questions from a few numbered passages. Use only those passages. Do not read other files in this repo, run other commands, or look anything up. Answer one question per session.

1. Run `npm run -s record -- prompt <case-id>`. It prints the instructions you must follow, the question, and the passages.
2. Write your answer following those instructions. Cite with numbers like `[1]`, and refuse with the exact refusal sentence if the passages do not answer the question.
3. Save it:

```bash
npm run -s record -- answer <case-id> - <<'EOF'
Your answer here.
EOF
```

You can also pass the answer as a quoted argument instead of `-`. The command prints `Saved <case-id>.` and you are done.

## If you are running the recordings

```bash
npm run -s record -- list      # all case ids
npm run -s record -- status    # which are recorded, which are not
npm run eval -- --from-recordings recordings/claude-sonnet-5-5   # score them
```

Use a fresh session for each case id so one answer cannot influence the next. Recordings are saved as `recordings/<model>/<case-id>.json`. Use `--model <label>` to record a different model under its own folder.
