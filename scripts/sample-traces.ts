// Runs the recorded questions through the real pipeline with tracing on and saves the spans.
//   npm run traces:sample        writes data/results/sample-traces.json
// Uses the real index and the local embedding model, with the offline quoting generator, so it needs no key.
// Timings are from the machine that ran it. The demo build combines this file with the recordings.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "../src/lib/deps";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import { ScriptedGenerator } from "../src/lib/llm";
import { MemoryStore } from "../src/lib/memory-store";
import { MemoryTraceStore } from "../src/lib/trace";
import { sampleRun, type ViewerTrace } from "../src/lib/trace-view";
import { scoreDirectory } from "./eval-recordings";
import type { Embedder } from "../src/lib/types";

async function main() {
  const { recs } = await scoreDirectory("recordings/claude-sonnet-5-5");
  const loaded = await MemoryStore.load(INDEX_FILE);
  const embedder: Embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
  await embedder.embed(["warm up"]);
  const deps = { store: loaded.store, embedder, generator: new ScriptedGenerator(), traces: new MemoryTraceStore() };
  const out: ViewerTrace[] = [];
  for (const rec of recs) {
    out.push({
      id: `sample-${rec.caseId}`,
      label: rec.question,
      source: "sample run",
      model: "Offline quoting generator",
      otlp: await sampleRun(deps, rec.question),
    });
  }
  const file = path.join(process.cwd(), "data", "results", "sample-traces.json");
  await writeFile(file, JSON.stringify({ embedder: embedder.name, ranOn: new Date().toISOString(), traces: out }) + "\n");
  console.log(`${out.length} sample traces written to data/results/sample-traces.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
