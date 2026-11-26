// Scores recorded model answers with the citation check and the refusal metrics.
// Usage: npm run eval -- --from-recordings recordings/claude-sonnet-5-5
// Writes data/results/recordings.json (the demo and README read it).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createVerifier } from "../src/lib/llm";
import { loadCases, scoreRecording, summarize, type CaseResult, type Recording } from "../src/lib/recording";

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

export async function scoreDirectory(dirArg: string) {
  const root = process.cwd();
  const dir = path.resolve(root, dirArg);
  const cases = await loadCases(root);
  const verifier = createVerifier();
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^q\d+\.json$/.test(f)).sort();
  const results: CaseResult[] = [];
  const recs: Recording[] = [];
  for (const f of files) {
    const rec = JSON.parse(await readFile(path.join(dir, f), "utf8")) as Recording;
    const c = cases.find((x) => x.id === rec.caseId);
    if (!c || c.question !== rec.question) {
      console.warn(`Skipping ${f}: it does not match the current question list.`);
      continue;
    }
    results.push(await scoreRecording(c, rec, verifier));
    recs.push(rec);
  }
  const model = recs[0]?.model ?? path.basename(dir);
  const s = summarize(model, verifier.name, cases.length, results);
  return { summary: s, results, recs };
}

export const slimCases = (results: CaseResult[]) =>
  results.map((r) => ({ caseId: r.caseId, question: r.question, answerable: r.answerable, abstained: r.abstained, sentences: r.report?.sentences ?? [] }));

export async function evalRecordings(dirArg: string): Promise<void> {
  const root = process.cwd();
  const { summary: s, results, recs } = await scoreDirectory(dirArg);
  if (recs.length === 0) {
    console.log(`No recordings in ${dirArg}.`);
    return;
  }
  const a = s.answerable, u = s.unanswerable;

  console.log(`Recorded answers from ${s.model}: ${s.recorded} of ${s.totalCases} questions. Citation check: ${s.verifier}.\n`);
  console.log("| measure | result |\n|---|---|");
  console.log(`| answerable questions answered (not refused) | ${a.answered} of ${a.recorded} (${pct(a.answered, a.recorded)}) |`);
  console.log(`| answer sentences kept by the citation check | ${a.supported} of ${a.sentences} (${pct(a.supported, a.sentences)}) |`);
  console.log(`| answers where every sentence was kept | ${a.allSupported} of ${a.answered} |`);
  console.log(`| kept citations that point at the labeled doc | ${a.citationsKeptRightDoc} of ${a.citationsKept} (${pct(a.citationsKeptRightDoc, a.citationsKept)}) |`);
  console.log(`| unanswerable questions correctly refused | ${u.refused} of ${u.recorded} (${pct(u.refused, u.recorded)}) |`);
  console.log(`| unanswerable questions answered anyway | ${u.answered} of ${u.recorded} (${u.answeredWithSupportedSentence} had a sentence that passed the check) |`);

  await mkdir(path.join(root, "data", "results"), { recursive: true });
  await writeFile(path.join(root, "data", "results", "recordings.json"), JSON.stringify({ summary: s, cases: slimCases(results) }, null, 2) + "\n");
  console.log("\nWrote data/results/recordings.json");
}

if (process.argv[1] && /eval-recordings\.ts$/.test(process.argv[1])) {
  const i = process.argv.indexOf("--from-recordings");
  evalRecordings(i > -1 ? (process.argv[i + 1] ?? "recordings/claude-sonnet-5-5") : "recordings/claude-sonnet-5-5").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
