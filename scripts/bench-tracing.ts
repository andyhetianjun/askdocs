// Measures what tracing costs: all 42 eval questions through the pipeline with and without it.
//   npm run bench:tracing [rounds] [--hash]
// Rounds alternate off/on so drift on the machine hits both. The model is the offline quoting generator
// (no network), the index is the real one, and the embedder is the real local model unless --hash is given.
// --hash makes the pipeline very fast, so it is close to the worst case for the relative overhead.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INDEX_FILE } from "../src/lib/deps";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import { ScriptedGenerator } from "../src/lib/llm";
import { MemoryStore } from "../src/lib/memory-store";
import { ask } from "../src/lib/pipeline";
import { MemoryTraceStore } from "../src/lib/trace";
import { setupTracing, shutdownTracing } from "../src/lib/tracing";
import type { Embedder } from "../src/lib/types";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function main() {
  const args = process.argv.slice(2);
  const rounds = Number(args.find((a) => /^\d+$/.test(a)) ?? 15);
  const useHash = args.includes("--hash");
  const read = async <T>(f: string) => JSON.parse(await readFile(path.join(process.cwd(), f), "utf8")) as T;
  const questions = [
    ...(await read<{ question: string }[]>("data/eval-questions.json")),
    ...(await read<{ question: string }[]>("data/unanswerable-questions.json")),
  ].map((q) => q.question);

  const loaded = await MemoryStore.load(INDEX_FILE);
  const embedder: Embedder = useHash || loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
  await embedder.embed(["warm up"]);
  const deps = { store: loaded.store, embedder, generator: new ScriptedGenerator(), traces: new MemoryTraceStore() };
  const dir = await mkdtemp(path.join(os.tmpdir(), "askdocs-bench-"));
  const file = path.join(dir, "t.jsonl");

  async function once(traced: boolean): Promise<number> {
    if (traced) setupTracing(); // file exporter via ASKDOCS_TRACE_FILE
    const t = performance.now();
    for (const q of questions) await ask(deps, q);
    await shutdownTracing(); // flushing the file is part of the cost
    return performance.now() - t;
  }

  process.env.ASKDOCS_TRACE_FILE = file;
  await once(false);
  await once(true);
  await rm(file, { force: true });
  const off: number[] = [];
  const on: number[] = [];
  for (let i = 0; i < rounds; i++) {
    off.push(await once(false));
    on.push(await once(true));
  }
  const text = await readFile(file, "utf8");
  const spans = text.split("\n").filter(Boolean).reduce((n, l) => n + (l.match(/"spanId"/g)?.length ?? 0), 0);
  const size = (await stat(file)).size;
  await rm(dir, { recursive: true, force: true });

  const [mo, mn] = [median(off), median(on)];
  const n = questions.length;
  console.log(`embedder: ${embedder.name}; questions per run: ${n}; rounds: ${rounds}`);
  console.log(`median, tracing off: ${mo.toFixed(0)} ms (${(mo / n).toFixed(1)} ms per question)`);
  console.log(`median, tracing on:  ${mn.toFixed(0)} ms (${(mn / n).toFixed(1)} ms per question)`);
  console.log(`overhead: ${(mn - mo).toFixed(0)} ms per run, ${((mn - mo) / n).toFixed(2)} ms per question, ${((mn / mo - 1) * 100).toFixed(1)}%`);
  console.log(`spans per run: ${Math.round(spans / rounds)}, file written per run: ${Math.round(size / rounds)} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
