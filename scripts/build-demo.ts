// Builds the static browser demo into demo/out. Run with `npm run build:demo`.
// Copies the prebuilt index next to the pages so the site needs no server, then runs a static Next.js export.
import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { recordingToOtlp, type ViewerTrace } from "../src/lib/trace-view";
import { scoreDirectory } from "./eval-recordings";

const root = process.cwd();

async function main() {
  const publicData = path.join(root, "demo", "public", "data");
  await rm(publicData, { recursive: true, force: true });
  await mkdir(publicData, { recursive: true });
  await cp(path.join(root, "data", "index.json"), path.join(publicData, "index.json"));
  // Recorded model answers, if there are any. The demo hides its "Recorded" section when this file is missing.
  const { summary, results, recs } = await scoreDirectory("recordings/claude-sonnet-5-5");
  if (recs.length > 0) {
    const entries = recs.map((rec, i) => ({
      caseId: rec.caseId,
      question: rec.question,
      answerable: results[i]!.answerable,
      abstained: results[i]!.abstained,
      answer: rec.answer,
      sentences: results[i]!.report?.sentences ?? [],
      passages: rec.passages.map(({ n, doc, section, url, text }) => ({ n, doc, section, url, text })),
      topSimilarity: rec.retrieval.topSimilarity,
      recordedAt: rec.recordedAt,
    }));
    await writeFile(path.join(publicData, "recordings.json"), JSON.stringify({ model: summary.model, verifier: summary.verifier, entries }) + "\n");
    console.log(`${recs.length} recorded answers added to the demo`);
  } else {
    await writeFile(path.join(publicData, "recordings.json"), JSON.stringify({ model: summary.model, verifier: summary.verifier, entries: [] }) + "\n");
  }
  // Traces for the viewer page: recorded ones from the recordings, sample runs from data/results/sample-traces.json.
  const traces: ViewerTrace[] = recs.map((rec) => ({
    id: `rec-${rec.caseId}`,
    label: rec.question,
    source: "recorded",
    model: summary.model,
    otlp: recordingToOtlp(rec),
  }));
  try {
    const sample = JSON.parse(await readFile(path.join(root, "data", "results", "sample-traces.json"), "utf8")) as { traces: ViewerTrace[] };
    traces.push(...sample.traces);
  } catch {
    console.log("no data/results/sample-traces.json; run `npm run traces:sample` to add sample runs to the viewer");
  }
  await writeFile(path.join(publicData, "traces.json"), JSON.stringify(traces));
  await rm(path.join(root, "demo", "out"), { recursive: true, force: true });

  const build = spawnSync("npx", ["next", "build", "demo"], { stdio: "inherit", cwd: root, env: process.env });
  if (build.status !== 0) process.exit(build.status ?? 1);
  console.log("demo built in demo/out");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
