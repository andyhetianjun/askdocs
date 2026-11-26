import { readFile, writeFile } from "node:fs/promises";
import { decodeVector, encodeVector } from "./memory-store";

export interface BankEntry {
  question: string;
  answer: string;
  /** "confident" or "needs review" when the answer was first drafted. */
  status: Status;
  sources: string[];
  vector: Float32Array;
}

export type Status = "confident" | "needs review";

const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
};

/** Questions that were already answered, so a near-duplicate gets the same answer. */
export class AnswerBank {
  constructor(readonly entries: BankEntry[] = []) {}

  add(entry: BankEntry): void {
    this.entries.push(entry);
  }

  /** The closest earlier question, if it is at least `minSimilarity` similar (cosine of normalised vectors). */
  closest(vector: Float32Array, minSimilarity: number): { entry: BankEntry; similarity: number } | null {
    let best: { entry: BankEntry; similarity: number } | null = null;
    for (const entry of this.entries) {
      const similarity = dot(entry.vector, vector);
      if (similarity >= minSimilarity && (!best || similarity > best.similarity)) best = { entry, similarity };
    }
    return best;
  }

  static async load(file: string): Promise<AnswerBank> {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as (Omit<BankEntry, "vector"> & { vector: string })[];
      return new AnswerBank(raw.map((e) => ({ ...e, vector: decodeVector(e.vector) })));
    } catch {
      return new AnswerBank();
    }
  }

  async save(file: string): Promise<void> {
    await writeFile(file, JSON.stringify(this.entries.map((e) => ({ ...e, vector: encodeVector(e.vector) }))));
  }
}
