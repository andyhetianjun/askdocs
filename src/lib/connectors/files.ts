import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** All files under `dir` with one of the extensions, as paths relative to `dir` with "/" separators, sorted. */
export async function listFiles(dir: string, extensions: string[]): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
        out.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  }
  await walk(dir);
  return out.sort();
}

export const readText = (file: string): Promise<string> => readFile(file, "utf8");
