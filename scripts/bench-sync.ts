// Times a full build against incremental updates on a temporary copy of the sources.
// Writes data/results/sync.json. Nothing in data/ or examples/ is modified besides that file.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConnector, type SourceDoc } from "../src/lib/connectors";
import { createEmbedder } from "../src/lib/embed";
import type { IndexFile } from "../src/lib/memory-store";
import { syncIndex } from "../src/lib/sync";

const root = process.cwd();
const rows: { step: string; docs: string; embedded: number; reused: number; ms: number }[] = [];

async function main() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "askdocs-sync-"));
  try {
    await cp(path.join(root, "data", "corpus"), path.join(tmp, "rst"), { recursive: true });
    await cp(path.join(root, "examples", "sources"), path.join(tmp, "sources"), { recursive: true });
    const embedder = createEmbedder();
    await embedder.embed(["warm up"]); // keep model loading out of the timings

    const load = async (): Promise<SourceDoc[]> => [
      ...(await createConnector("rst", path.join(tmp, "rst")).load()),
      ...(await createConnector("markdown", path.join(tmp, "sources", "markdown")).load()),
      ...(await createConnector("notion", path.join(tmp, "sources", "notion")).load()),
      ...(await createConnector("slack", path.join(tmp, "sources", "slack")).load()),
    ];

    let index: IndexFile | null = null;
    async function step(name: string, previous: IndexFile | null) {
      const t0 = performance.now(); // includes reading and parsing the source files
      const docs = await load();
      const result = await syncIndex(previous, docs, embedder);
      const ms = performance.now() - t0;
      const r = result.report;
      rows.push({
        step: name,
        docs: `${r.added.length} added, ${r.changed.length} changed, ${r.deleted.length} deleted`,
        embedded: r.chunksEmbedded,
        reused: r.chunksReused,
        ms,
      });
      index = result.index;
    }

    const edit = async (file: string, fn: (text: string) => string) => {
      const full = path.join(tmp, file);
      await writeFile(full, fn(await readFile(full, "utf8")));
    };

    await step("full build", null);
    const built = index!;
    await step("nothing changed", built);
    await edit("rst/json.rst", (t) => t.replace("Python", "CPython"));
    await step("one word edited in one doc", index);
    await edit("rst/heapq.rst", (t) => t + "\n\nNote\n====\n\nA short note added at the end of the page with enough words to become a chunk of its own.\n");
    await step("a paragraph appended to one doc", index);
    await writeFile(path.join(tmp, "sources", "markdown", "new-note.md"), "# New note\n\nThis note is new and has more than twelve words in it so that it becomes a chunk in the index.\n");
    await step("one new Markdown file", index);
    await rm(path.join(tmp, "rst", "bisect.rst"));
    await step("one doc deleted", index);
    await step("full build again (for comparison)", null);

    console.log(`${built.chunks.length} chunks in the full build, embedder ${embedder.name}\n`);
    console.log("| step | documents | chunks embedded | chunks reused | time |\n|---|---|---|---|---|");
    for (const r of rows) {
      console.log(`| ${r.step} | ${r.docs} | ${r.embedded} | ${r.reused} | ${r.ms < 1000 ? `${r.ms.toFixed(0)} ms` : `${(r.ms / 1000).toFixed(1)} s`} |`);
    }
    await mkdir(path.join(root, "data", "results"), { recursive: true });
    await writeFile(path.join(root, "data", "results", "sync.json"), JSON.stringify({ embedder: embedder.name, rows }, null, 2) + "\n");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
