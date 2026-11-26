// Brings data/index.json up to date with the documents in one or more sources.
//
//   npm run ingest                                       the Python docs in data/corpus (default)
//   npm run ingest -- --markdown notes/ --notion export/ --slack slack-export/
//   npm run ingest -- --full                             ignore the existing index and re-embed everything
//   npm run ingest -- --index other.json                 read and write a different index file
//
// Only new or edited documents are re-embedded. If DATABASE_URL is set the chunks are also loaded into Postgres.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createConnector, CONNECTOR_KINDS, type SourceDoc } from "../src/lib/connectors";
import { createEmbedder } from "../src/lib/embed";
import { decodeVector, saveIndex, type IndexFile } from "../src/lib/memory-store";
import { PgStore } from "../src/lib/pg-store";
import { syncIndex, type SyncReport } from "../src/lib/sync";

export function parseSources(argv: string[]): { kind: string; dir: string }[] {
  const sources: { kind: string; dir: string }[] = [];
  for (const kind of CONNECTOR_KINDS) {
    argv.forEach((arg, i) => {
      if (arg === `--${kind}` && argv[i + 1]) sources.push({ kind, dir: argv[i + 1]! });
    });
  }
  return sources.length > 0 ? sources : [{ kind: "rst", dir: path.join(process.cwd(), "data", "corpus") }];
}

export function describeReport(r: SyncReport): string {
  const list = (label: string, ids: string[]) => (ids.length ? `${label}: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? `, and ${ids.length - 5} more` : ""}` : "");
  return [
    `${r.added.length} added, ${r.changed.length} changed, ${r.deleted.length} deleted, ${r.unchanged} unchanged`,
    ...[list("added", r.added), list("changed", r.changed), list("deleted", r.deleted)].filter(Boolean),
    `${r.chunksTotal} chunks: ${r.chunksEmbedded} embedded, ${r.chunksReused} reused${r.rebuiltAll ? " (model or chunk settings changed, so everything was rebuilt)" : ""}`,
    `took ${(r.ms / 1000).toFixed(2)}s`,
  ].join("\n");
}

async function main() {
  const flag = process.argv.indexOf("--index");
  const indexFile = flag === -1 ? path.join(process.cwd(), "data", "index.json") : path.resolve(process.argv[flag + 1]!);
  const full = process.argv.includes("--full");
  const docs: SourceDoc[] = [];
  for (const { kind, dir } of parseSources(process.argv.slice(2))) {
    const loaded = await createConnector(kind, dir).load();
    console.log(`${kind}: ${loaded.length} documents from ${dir}`);
    docs.push(...loaded);
  }
  const ids = new Set<string>();
  for (const d of docs) {
    if (ids.has(d.id)) throw new Error(`Two documents have the id "${d.id}".`);
    ids.add(d.id);
  }

  let previous: IndexFile | null = null;
  if (!full) {
    try {
      previous = JSON.parse(await readFile(indexFile, "utf8")) as IndexFile;
    } catch {
      previous = null;
    }
  }

  const embedder = createEmbedder();
  const { index, report } = await syncIndex(previous, docs, embedder);
  console.log(describeReport(report));
  await saveIndex(indexFile, index);
  console.log(`wrote ${path.relative(process.cwd(), indexFile)}`);

  if (process.env.DATABASE_URL) {
    const store = new PgStore(process.env.DATABASE_URL);
    try {
      await store.migrate();
      await store.replaceAll(index.chunks, index.chunks.map((c) => decodeVector(c.embedding)));
      console.log(`loaded ${await store.count()} chunks into Postgres`);
    } finally {
      await store.close();
    }
  }
}

if (process.argv[1]?.endsWith("ingest.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
