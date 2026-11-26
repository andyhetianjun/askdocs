import { createHash } from "node:crypto";
import { chunkText, DEFAULT_CHUNK_OPTIONS } from "./chunker";
import type { SourceDoc } from "./connectors/types";
import { encodeVector, searchableText, type IndexFile } from "./memory-store";
import type { Chunk, Embedder } from "./types";

export const MIN_CHUNK_WORDS = 12;

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Fingerprint of everything that changes what a chunk's vector would be besides its text. */
export function configKey(embedder: Embedder): string {
  return sha(JSON.stringify({ model: embedder.name, dims: embedder.dims, chunk: DEFAULT_CHUNK_OPTIONS, min: MIN_CHUNK_WORDS }));
}

/** Hash of a document's content (its url and every section), so any edit changes it. */
export function docHash(doc: SourceDoc): string {
  return sha(JSON.stringify([doc.url, doc.sections.map((s) => [s.title, s.text])]));
}

export function chunkDoc(doc: SourceDoc): Chunk[] {
  const chunks: Chunk[] = [];
  let ordinal = 0;
  for (const section of doc.sections) {
    for (const text of chunkText(section.text)) {
      if (text.split(/\s+/).length < MIN_CHUNK_WORDS) continue;
      chunks.push({ id: `${doc.id}-${ordinal}`, doc: doc.id, section: section.title || doc.id, url: doc.url, ordinal, text });
      ordinal++;
    }
  }
  return chunks;
}

export interface SyncReport {
  added: string[];
  changed: string[];
  deleted: string[];
  unchanged: number;
  chunksTotal: number;
  /** Chunks that needed a new embedding. */
  chunksEmbedded: number;
  /** Chunks whose vector was copied from the previous index. */
  chunksReused: number;
  /** True when the embedding model or chunk settings changed, so nothing could be reused. */
  rebuiltAll: boolean;
  ms: number;
}

/**
 * Brings an index up to date with the current documents.
 *
 * - A document whose content hash is unchanged is copied over untouched.
 * - A new or edited document is re-chunked, and only chunks whose text is new get embedded.
 *   Chunks with the same text as before keep their old vector, so editing one paragraph
 *   re-embeds about one or two chunks, not the whole document.
 * - Documents that are no longer in the source are dropped.
 *
 * Pass `previous = null` for a full build.
 */
export async function syncIndex(
  previous: IndexFile | null,
  docs: SourceDoc[],
  embedder: Embedder,
): Promise<{ index: IndexFile; report: SyncReport }> {
  const started = performance.now();
  const key = configKey(embedder);
  // Index files written before this feature have no config key. They are reusable if the model matches.
  const sameModel = (p: IndexFile) => p.embedder.name === embedder.name && p.embedder.dims === embedder.dims;
  const usable = previous && (previous.config === key || (previous.config === undefined && sameModel(previous))) ? previous : null;
  const rebuiltAll = previous !== null && usable === null && previous.chunks.length > 0;

  const previousByDoc = new Map<string, IndexFile["chunks"]>();
  const reusable = new Map<string, string>(); // hash of the searchable text -> base64 vector
  for (const c of usable?.chunks ?? []) {
    const list = previousByDoc.get(c.doc) ?? [];
    list.push(c);
    previousByDoc.set(c.doc, list);
    reusable.set(sha(searchableText(c)), c.embedding);
  }

  const sorted = [...docs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  const manifest: Record<string, string> = {};
  const kept: Record<string, IndexFile["chunks"]> = {};
  const toEmbed: { chunk: Chunk; slot: IndexFile["chunks"][number] }[] = [];
  let chunksReused = 0;

  for (const doc of sorted) {
    const hash = docHash(doc);
    manifest[doc.id] = hash;
    const old = usable?.docs?.[doc.id];
    if (old === hash && previousByDoc.has(doc.id)) {
      kept[doc.id] = previousByDoc.get(doc.id)!;
      chunksReused += kept[doc.id]!.length;
      unchanged++;
      continue;
    }
    const fresh = chunkDoc(doc);
    const before = previousByDoc.get(doc.id);
    if (old === undefined && before && before.length === fresh.length && before.every((b, i) => b.text === fresh[i]!.text && b.section === fresh[i]!.section)) {
      // an older index without hashes, and the content is the same: nothing to do
      kept[doc.id] = before;
      chunksReused += before.length;
      unchanged++;
      continue;
    }
    if (old === undefined && !before) added.push(doc.id);
    else changed.push(doc.id);

    kept[doc.id] = fresh.map((chunk) => {
      const slot = { ...chunk, embedding: reusable.get(sha(searchableText(chunk))) ?? "" };
      if (slot.embedding === "") toEmbed.push({ chunk, slot });
      else chunksReused++;
      return slot;
    });
  }

  if (toEmbed.length > 0) {
    const vectors = await embedder.embed(toEmbed.map((t) => searchableText(t.chunk)));
    toEmbed.forEach((t, i) => {
      t.slot.embedding = encodeVector(vectors[i]!);
    });
  }

  const present = new Set(sorted.map((d) => d.id));
  const deleted = [...new Set([...Object.keys(usable?.docs ?? {}), ...previousByDoc.keys()])].filter((id) => !present.has(id)).sort();
  const chunks = sorted.flatMap((d) => kept[d.id]!);

  return {
    index: { embedder: { name: embedder.name, dims: embedder.dims }, config: key, docs: manifest, chunks },
    report: {
      added,
      changed,
      deleted,
      unchanged,
      chunksTotal: chunks.length,
      chunksEmbedded: toEmbed.length,
      chunksReused,
      rebuiltAll,
      ms: performance.now() - started,
    },
  };
}

