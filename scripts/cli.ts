// The askdocs command line. Searches the index that ships with the repo, from any folder.
//   askdocs ask "how do I limit a deque to the last few items?" [--mode hybrid|keyword|vector] [-k 5] [--trace]
// With ANTHROPIC_API_KEY set it also writes a cited answer (see README).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator, createVerifier } from "../src/lib/llm";
import { HashEmbedder, TransformersEmbedder } from "../src/lib/embed";
import { MemoryStore } from "../src/lib/memory-store";
import { ask } from "../src/lib/pipeline";
import { MemoryTraceStore } from "../src/lib/trace";
import { setupFromEnv, shutdownTracing } from "../src/lib/tracing";
import type { Embedder, Mode } from "../src/lib/types";

const HELP = `askdocs: ask questions about the Python standard library docs.

Usage:
  askdocs ask "<question>" [--mode hybrid|keyword|vector] [-k 5] [--trace]

--trace writes OpenTelemetry traces (see docs/tracing.md).
Shows the passages that best match, with a link to each. Set ANTHROPIC_API_KEY to also get
a written answer with citations. The first run downloads a small embedding model (about 90 MB).`;

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "ask" || args.length < 2 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(args[0] === "ask" || args.length === 0 ? 0 : 1);
  }
  let mode: Mode = "hybrid";
  let k = 5;
  const words: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--mode") mode = (args[++i] ?? "hybrid") as Mode;
    else if (a === "--trace") process.env.ASKDOCS_TRACE = "1";
    else if (a === "-k") k = Math.max(1, Number(args[++i]) || 5);
    else words.push(a);
  }
  if (!["hybrid", "keyword", "vector"].includes(mode)) throw new Error(`Unknown mode "${mode}". Use hybrid, keyword or vector.`);
  const question = words.join(" ").trim();
  if (!question) throw new Error("Give a question in quotes.");

  const indexFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "index.json");
  const loaded = await MemoryStore.load(indexFile);
  const embedder: Embedder = loaded.embedder.name.startsWith("hash") ? new HashEmbedder() : new TransformersEmbedder();
  console.error("Searching (the first run downloads the embedding model)...");
  if (setupFromEnv()) console.error("Tracing is on (see docs/tracing.md).");
  const result = await ask(
    { store: loaded.store, embedder, generator: createGenerator(), verifier: createVerifier(), traces: new MemoryTraceStore() },
    question,
    mode,
    k,
  );

  await shutdownTracing(); // writes out the last spans
  if (result.abstainReason === "low_similarity") {
    console.log(`I couldn't find this in the docs. The closest passage scored ${result.similarity.toFixed(2)} for similarity, under the ${embedder.abstainBelow} cut-off. Nearest passages:\n`);
  }
  for (const h of result.hits) {
    const text = h.chunk.text.replace(/\s+/g, " ").trim();
    console.log(`[${h.rank}] ${h.chunk.doc}: ${h.chunk.section}\n    ${h.chunk.url}\n    ${text.length > 260 ? `${text.slice(0, 260)}...` : text}\n`);
  }
  if (result.answer && result.abstainReason !== "low_similarity") console.log(`Answer:\n${result.answer}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
