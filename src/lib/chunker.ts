export interface ChunkOptions {
  /** Target size of a chunk, counted in whitespace separated words. */
  maxWords: number;
  /** How many words from the end of one chunk are repeated at the start of the next. */
  overlapWords: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxWords: 160, overlapWords: 30 };

const words = (line: string): number => (line.trim() === "" ? 0 : line.trim().split(/\s+/).length);

/**
 * Splits text into chunks of about `maxWords` words. It works on whole lines so code
 * and lists keep their shape. A line longer than `maxWords` becomes its own chunk.
 * Each chunk after the first starts with the last `overlapWords` words (rounded up to
 * whole lines) of the chunk before it.
 */
export function chunkText(text: string, opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  if (opts.overlapWords >= opts.maxWords) throw new Error("overlapWords must be smaller than maxWords");
  const lines = text.split("\n");
  const chunks: string[] = [];
  let start = 0;

  while (start < lines.length) {
    let end = start;
    let count = 0;
    while (end < lines.length) {
      const w = words(lines[end] ?? "");
      if (count > 0 && count + w > opts.maxWords) break;
      count += w;
      end++;
    }
    const body = lines.slice(start, end).join("\n").trim();
    if (body) chunks.push(body);
    if (end >= lines.length) break;

    // step back so the next chunk begins with some overlap, but always move forward
    let back = end;
    let overlap = 0;
    while (back > start + 1 && overlap < opts.overlapWords) {
      back--;
      overlap += words(lines[back] ?? "");
    }
    start = Math.max(back, start + 1);
  }
  return chunks;
}
