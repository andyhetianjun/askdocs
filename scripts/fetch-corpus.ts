// Downloads a small subset of the Python standard library docs (reStructuredText)
// from the CPython repository. The files are committed, so this only needs to run
// again if you want to change the subset.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const REF = "v3.12.7";
const MODULES = [
  "json", "re", "collections", "itertools", "functools", "pathlib", "argparse",
  "datetime", "logging", "csv", "sqlite3", "subprocess", "threading", "heapq",
  "bisect", "random", "statistics", "shutil", "tempfile", "textwrap",
  "dataclasses", "enum", "contextlib", "hashlib", "zipfile", "time", "string",
  "copy", "math", "queue",
];

const outDir = path.join(process.cwd(), "data", "corpus");
await mkdir(outDir, { recursive: true });

for (const name of MODULES) {
  const url = `https://raw.githubusercontent.com/python/cpython/${REF}/Doc/library/${name}.rst`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  await writeFile(path.join(outDir, `${name}.rst`), await res.text());
  console.log("fetched", name);
}
