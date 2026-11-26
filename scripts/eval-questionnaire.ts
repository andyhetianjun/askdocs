// Measures questionnaire mode: how often "confident" is right, and whether near-duplicates are matched.
// Writes data/results/questionnaire.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AnswerBank } from "../src/lib/answer-bank";
import { getDeps } from "../src/lib/deps";
import type { LabeledQuestion } from "../src/lib/evaluate";
import { ScriptedGenerator } from "../src/lib/llm";
import { DEFAULT_DRAFT_OPTIONS, draftQuestion, type DraftOptions } from "../src/lib/questionnaire";

const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(process.cwd(), file), "utf8")) as T;

async function main() {
  const answerable = await read<LabeledQuestion[]>("data/eval-questions.json");
  const unanswerable = await read<{ question: string }[]>("data/unanswerable-questions.json");
  const pairs = await read<{ paraphrases: { of: number; question: string }[]; different: { near: number; question: string }[] }>(
    "data/reuse-pairs.json",
  );
  const deps = { ...(await getDeps()), generator: new ScriptedGenerator() };
  await deps.embedder.embed(["warm up"]);

  // 1. Is "confident" worth trusting? Each question is drafted on its own (empty answer bank).
  console.log(`Confident vs needs review (${answerable.length} answerable, ${unanswerable.length} unanswerable questions, offline quoting generator)\n`);
  console.log("| similarity at least | answer covers question at least | confident | of those, cited the right doc | answerable left in needs review | unanswerable marked confident |");
  console.log("|---|---|---|---|---|---|");
  const grid: Record<string, number | string>[] = [];
  for (const confidentAbove of [0.5, 0.55, 0.6]) {
    for (const answerCoversAtLeast of [0, 0.3, 0.5]) {
      const options: DraftOptions = { ...DEFAULT_DRAFT_OPTIONS, confidentAbove, answerCoversAtLeast };
      let confident = 0, right = 0, review = 0, bad = 0;
      for (const q of answerable) {
        const a = await draftQuestion(deps, new AnswerBank(), q.question, options);
        const docs = a.sources.map((s) => /^\[\d+\] ([^:]+):/.exec(s)?.[1]);
        if (a.status === "confident") {
          confident++;
          if (docs.includes(q.doc)) right++;
        } else review++;
      }
      for (const q of unanswerable) {
        if ((await draftQuestion(deps, new AnswerBank(), q.question, options)).status === "confident") bad++;
      }
      const row = { confidentAbove, answerCoversAtLeast, confident, right, review, unanswerableConfident: bad };
      grid.push(row);
      const mark = confidentAbove === DEFAULT_DRAFT_OPTIONS.confidentAbove && answerCoversAtLeast === DEFAULT_DRAFT_OPTIONS.answerCoversAtLeast ? " (default)" : "";
      console.log(`| ${confidentAbove}${mark} | ${answerCoversAtLeast} | ${confident} | ${right} of ${confident} | ${review} of ${answerable.length} | ${bad} of ${unanswerable.length} |`);
    }
  }

  // 2. Reuse: are rephrased questions matched to the earlier one, and different ones left alone?
  const bank = new AnswerBank();
  const vectors = await deps.embedder.embed(answerable.map((q) => q.question));
  answerable.forEach((q, i) => bank.add({ question: q.question, answer: "a", status: "confident", sources: [], vector: vectors[i]! }));
  console.log(`\nReuse (${pairs.paraphrases.length} rephrased questions, ${pairs.different.length} different questions on the same topic)\n`);
  console.log("| reuse at least | rephrased matched to the right earlier question | different questions wrongly matched |\n|---|---|---|");
  const reuse: Record<string, number>[] = [];
  const rephrasedVectors = await deps.embedder.embed(pairs.paraphrases.map((p) => p.question));
  const differentVectors = await deps.embedder.embed(pairs.different.map((p) => p.question));
  for (const t of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
    const found = pairs.paraphrases.filter((p, i) => bank.closest(rephrasedVectors[i]!, t)?.entry.question === answerable[p.of]!.question).length;
    const wrong = pairs.different.filter((_, i) => bank.closest(differentVectors[i]!, t) !== null).length;
    reuse.push({ reuseAbove: t, matched: found, wronglyMatched: wrong });
    const mark = t === DEFAULT_DRAFT_OPTIONS.reuseAbove ? " (default)" : "";
    console.log(`| ${t}${mark} | ${found} of ${pairs.paraphrases.length} | ${wrong} of ${pairs.different.length} |`);
  }

  await mkdir(path.join(process.cwd(), "data", "results"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), "data", "results", "questionnaire.json"),
    JSON.stringify({ embedder: deps.embedder.name, defaults: DEFAULT_DRAFT_OPTIONS, grid, reuse }, null, 2) + "\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
