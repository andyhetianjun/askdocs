// Drafts an answer for every question in a CSV (or a plain list) and writes a filled CSV.
// Usage: npm run questionnaire -- examples/questionnaire.csv --out filled.csv [--bank answers.json]
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AnswerBank } from "../src/lib/answer-bank";
import { getDeps } from "../src/lib/deps";
import { draftQuestionnaire, fillCsv, parseQuestionnaire } from "../src/lib/questionnaire";

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith("--")) {
    console.error("Usage: npm run questionnaire -- <questions.csv|questions.txt> [--out filled.csv] [--bank answers.json]");
    process.exit(1);
  }
  const out = option("--out") ?? input.replace(/\.[^.]+$/, "") + ".filled.csv";
  const bankFile = option("--bank");

  const parsed = parseQuestionnaire(await readFile(input, "utf8"));
  const deps = await getDeps();
  const bank = bankFile ? await AnswerBank.load(bankFile) : new AnswerBank();
  const t0 = performance.now();
  const { answers, counts } = await draftQuestionnaire(deps, bank, parsed.rows.map((r) => r[parsed.questionColumn] ?? ""));
  await writeFile(out, fillCsv(parsed, answers));
  if (bankFile) await bank.save(bankFile);

  answers.forEach((a, i) => {
    const tag = a.reusedFrom ? "reused " : "       ";
    console.log(`${String(i + 1).padStart(2)}. ${a.status.padEnd(12)} ${tag}${a.question.slice(0, 70)}`);
  });
  console.log(`\n${counts.confident} confident, ${counts.needsReview} need review, ${counts.reused} reused. ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
