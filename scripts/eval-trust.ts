// Measures the citation check and the "I couldn't find this" path. Writes data/results/trust.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LexicalVerifier, LEXICAL_THRESHOLD, ABSTAIN_MESSAGE } from "../src/lib/citations";
import { INDEX_FILE } from "../src/lib/deps";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import type { Embedder } from "../src/lib/types";
import type { LabeledQuestion } from "../src/lib/evaluate";
import { createVerifier, ScriptedGenerator } from "../src/lib/llm";
import { MemoryStore } from "../src/lib/memory-store";
import { ask } from "../src/lib/pipeline";
import { MemoryTraceStore } from "../src/lib/trace";
import { scoreAbstention, scoreChecker, type CheckItem, type SimilarityRow } from "../src/lib/trust-eval";

const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(process.cwd(), file), "utf8")) as T;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const questions = await read<LabeledQuestion[]>("data/eval-questions.json");
  const unanswerable = await read<{ question: string; kind: string }[]>("data/unanswerable-questions.json");
  const checks = await read<CheckItem[]>("data/citation-checks.json");
  const loaded = await MemoryStore.load(INDEX_FILE);
  const store = loaded.store;
  const embedder: Embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
  const index = await read<{ chunks: { id: string; text: string }[] }>("data/index.json");
  const textOf = (id: string) => index.chunks.find((c) => c.id === id)!.text;

  // 1. Does the citation check tell supported claims from unsupported ones?
  const verifier = createVerifier();
  const checker = await scoreChecker(checks, textOf, verifier);
  console.log(`Citation check (${checker.verifier}) on ${checks.length} hand-labeled claims (${checks.filter((c) => c.supported).length} supported)`);
  console.log(`  precision ${pct(checker.precision)}, recall ${pct(checker.recall)}, accuracy ${pct(checker.accuracy)}`);
  for (const [kind, r] of Object.entries(checker.rejected)) console.log(`  unsupported (${kind}): rejected ${r.rejected} of ${r.total}`);

  const sweep: { threshold: number; precision: number; recall: number }[] = [];
  if (verifier instanceof LexicalVerifier) {
    for (const t of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      const s = await scoreChecker(checks, textOf, new LexicalVerifier(t));
      sweep.push({ threshold: t, precision: s.precision, recall: s.recall });
    }
    console.log("\nLexical pass mark sweep\n\n| pass mark | precision | recall |\n|---|---|---|");
    for (const s of sweep) console.log(`| ${s.threshold} | ${pct(s.precision)} | ${pct(s.recall)} |`);
  }

  // 2. Does it refuse questions the docs cannot answer, without refusing the ones they can?
  await embedder.embed(["warm up"]);
  const rows: SimilarityRow[] = [];
  for (const [list, answerable] of [[questions, true], [unanswerable, false]] as const) {
    for (const q of list) {
      const [v] = await embedder.embed([q.question]);
      const top = (await store.vectorSearch(v!, 1))[0];
      rows.push({ similarity: top?.score ?? 0, answerable });
    }
  }
  const thresholds = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
  const abstain = thresholds.map((t) => scoreAbstention(rows, t));
  console.log(`\nAbstention sweep (${questions.length} answerable, ${unanswerable.length} unanswerable)\n`);
  console.log("| refuse below | answerable wrongly refused | unanswerable correctly refused |\n|---|---|---|");
  for (const a of abstain) console.log(`| ${a.threshold} | ${pct(a.falseAbstainRate)} | ${pct(a.correctAbstainRate)} |`);

  // 3. The whole pipeline, offline: the quoting generator plus the citation check.
  const deps = { store, embedder, generator: new ScriptedGenerator(), traces: new MemoryTraceStore(), verifier: new LexicalVerifier() };
  let cited = 0, citedRight = 0, keptRight = 0, kept = 0, answeredAnswerable = 0;
  for (const q of questions) {
    const r = await ask(deps, q.question);
    if (!r.abstained) answeredAnswerable++;
    for (const s of r.citations?.sentences ?? []) {
      for (const n of s.cited) {
        const doc = r.hits[n - 1]?.chunk.doc;
        cited++;
        if (doc === q.doc) citedRight++;
        if (s.status === "supported") {
          kept++;
          if (doc === q.doc) keptRight++;
        }
      }
    }
  }
  let refused = 0;
  for (const q of unanswerable) {
    const r = await ask(deps, q.question);
    if (r.abstained && r.answer === ABSTAIN_MESSAGE) refused++;
  }
  const endToEnd = {
    answerableAnswered: answeredAnswerable,
    answerableTotal: questions.length,
    unanswerableRefused: refused,
    unanswerableTotal: unanswerable.length,
    citationPrecisionBeforeCheck: citedRight / Math.max(1, cited),
    citationPrecisionAfterCheck: keptRight / Math.max(1, kept),
    citationsBeforeCheck: cited,
    citationsAfterCheck: kept,
  };
  console.log(`\nEnd to end (offline quoting generator, default similarity cut-off ${embedder.abstainBelow ?? 0})`);
  console.log(`  answerable answered: ${answeredAnswerable}/${questions.length}; unanswerable refused: ${refused}/${unanswerable.length}`);
  console.log(`  cited passage from the labeled doc: ${pct(endToEnd.citationPrecisionBeforeCheck)} of ${cited} citations before the check, ${pct(endToEnd.citationPrecisionAfterCheck)} of ${kept} after`);

  await mkdir(path.join(process.cwd(), "data", "results"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "data", "results", "trust.json"),
    JSON.stringify({ embedder: embedder.name, abstainBelow: embedder.abstainBelow ?? 0, lexicalThreshold: LEXICAL_THRESHOLD, checker, sweep, abstain, endToEnd }, null, 2) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
