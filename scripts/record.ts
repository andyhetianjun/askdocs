// Recording harness. A model is shown one question and its retrieved passages and writes a cited answer.
// Commands (see RECORDING.md):
//   npm run -s record -- list
//   npm run -s record -- status
//   npm run -s record -- prompt <case-id>
//   npm run -s record -- answer <case-id> "<answer text>"     (or `-` to read the answer from stdin)
// Options: --model <label> (default claude-sonnet-5-5), --dir <folder> (default recordings)
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_FILE } from "../src/lib/deps";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import { buildPrompt, SYSTEM } from "../src/lib/llm";
import { MemoryStore } from "../src/lib/memory-store";
import { HARNESS_VERSION, loadCases, type Case, type RecordedPassage, type Recording } from "../src/lib/recording";
import { retrieveWithConfidence } from "../src/lib/retrieve";

const root = process.cwd();


function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--") && arg.length > 2) opts[arg.slice(2)] = argv[++i] ?? "";
    else positional.push(arg);
  }
  return { positional, opts };
}

const exists = async (file: string) => readFile(file).then(() => true, () => false);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [command, caseId, ...rest] = positional;
  const model = opts.model ?? "claude-sonnet-5-5";
  const dir = path.resolve(root, opts.dir ?? "recordings", model);
  const pendingDir = path.join(dir, ".pending");
  const cases = await loadCases(root);
  const find = (id: string | undefined): Case => {
    const c = cases.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown case id "${id ?? ""}". Run: npm run -s record -- list`);
    return c;
  };

  if (command === "list") {
    console.log(cases.map((c) => c.id).join(" "));
    return;
  }

  if (command === "status") {
    const done = new Set((await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
    const todo = cases.filter((c) => !done.has(c.id)).map((c) => c.id);
    console.log(`${done.size} of ${cases.length} recorded for ${model}.`);
    console.log(todo.length ? `Still to do: ${todo.join(" ")}` : "All done.");
    return;
  }

  if (command === "prompt") {
    const c = find(caseId);
    const loaded = await MemoryStore.load(INDEX_FILE);
    const embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
    const mode = "hybrid";
    const k = 5;
    const { hits, topSimilarity } = await retrieveWithConfidence(loaded.store, embedder, c.question, mode, k);
    const passages: RecordedPassage[] = hits.map((h) => ({
      n: h.rank, id: h.chunk.id, doc: h.chunk.doc, section: h.chunk.section, url: h.chunk.url, text: h.chunk.text,
    }));
    const user = buildPrompt(c.question, hits);
    const pending = {
      harness: HARNESS_VERSION, model, caseId: c.id, question: c.question,
      prompt: { system: SYSTEM, user }, passages,
      retrieval: { mode, k, embedder: loaded.embedder.name, topSimilarity: Math.round(topSimilarity * 1000) / 1000 },
      promptedAt: new Date().toISOString(),
    };
    await mkdir(pendingDir, { recursive: true });
    await writeFile(path.join(pendingDir, `${c.id}.json`), JSON.stringify(pending, null, 2) + "\n");
    console.log(`=== SYSTEM PROMPT ===\n${SYSTEM}\n\n=== MESSAGE ===\n${user}\n\n=== WHAT TO DO ===`);
    console.log("Write your answer using only the passages above. Then save it with a command like:\n");
    console.log(`npm run -s record -- answer ${c.id} - <<'EOF'\n<your answer here>\nEOF\n`);
    console.log("Give just the answer text, nothing else. Passing the text as an argument instead of `-` also works.");
    return;
  }

  if (command === "answer") {
    const c = find(caseId);
    const text = (rest.join(" ") === "-" ? await readStdin() : rest.join(" ")).trim();
    if (!text) throw new Error("The answer is empty.");
    const pendingFile = path.join(pendingDir, `${c.id}.json`);
    if (!(await exists(pendingFile))) throw new Error(`Run "npm run -s record -- prompt ${c.id}" first.`);
    const pending = JSON.parse(await readFile(pendingFile, "utf8")) as Omit<Recording, "answer" | "recordedAt" | "secondsToAnswer"> & { promptedAt: string };
    const recordedAt = new Date().toISOString();
    const rec: Recording = {
      ...pending,
      answer: text,
      recordedAt,
      secondsToAnswer: Math.round((Date.parse(recordedAt) - Date.parse(pending.promptedAt)) / 1000),
    };
    await writeFile(path.join(dir, `${c.id}.json`), JSON.stringify(rec, null, 2) + "\n");
    await rename(pendingFile, path.join(pendingDir, `${c.id}.done`)).catch(() => undefined);
    console.log(`Saved ${c.id}.`);
    return;
  }

  console.log("Usage: record list | status | prompt <case-id> | answer <case-id> <text|->");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
