// Recorded model runs: the case list, the file format and the scoring.
// A model is shown a question and the passages retrieved for it, writes a cited answer or refuses,
// and the answer is saved as JSON. Scoring uses the same citation check as the app.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ABSTAIN_MESSAGE, checkCitations, type CitationReport, type CitationVerifier } from "./citations";

export const HARNESS_VERSION = "askdocs-record/1";

export interface CaseSource {
  question: string;
  /** Present for answerable questions: the labeled doc and section. */
  doc?: string;
  section?: string;
}

export interface Case {
  id: string;
  question: string;
  answerable: boolean;
  doc?: string;
  section?: string;
}

/**
 * Ids are q01, q02, ... in an order fixed by a hash of the question text, so the id
 * does not say whether the question is answerable and the list does not change when files are re-read.
 */
export function buildCases(answerable: CaseSource[], unanswerable: CaseSource[]): Case[] {
  const all: Omit<Case, "id">[] = [
    ...answerable.map((q) => ({ question: q.question, answerable: true, doc: q.doc, section: q.section })),
    ...unanswerable.map((q) => ({ question: q.question, answerable: false })),
  ];
  const key = (q: string) => createHash("sha1").update(q).digest("hex");
  all.sort((a, b) => key(a.question).localeCompare(key(b.question)));
  const width = Math.max(2, String(all.length).length);
  return all.map((c, i) => ({ id: `q${String(i + 1).padStart(width, "0")}`, ...c }));
}

export async function loadCases(root: string): Promise<Case[]> {
  const read = async (f: string) => JSON.parse(await readFile(path.join(root, f), "utf8")) as CaseSource[];
  return buildCases(await read("data/eval-questions.json"), await read("data/unanswerable-questions.json"));
}

export interface RecordedPassage {
  n: number;
  id: string;
  doc: string;
  section: string;
  url: string;
  text: string;
}

export interface Recording {
  harness: string;
  model: string;
  caseId: string;
  question: string;
  /** What the model was shown. */
  prompt: { system: string; user: string };
  passages: RecordedPassage[];
  retrieval: { mode: string; k: number; embedder: string; topSimilarity: number };
  answer: string;
  promptedAt: string;
  recordedAt: string;
  /** Seconds between `record prompt` and `record answer`. */
  secondsToAnswer: number;
}

/** True when the whole answer is the refusal sentence (quotes, case and a missing full stop are tolerated). */
export function isAbstention(answer: string): boolean {
  const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/["'`\u201c\u201d]/g, "").replace(/[\s.]+$/g, "").trim();
  return plain(answer) === plain(ABSTAIN_MESSAGE);
}

export interface CaseResult {
  caseId: string;
  question: string;
  answerable: boolean;
  abstained: boolean;
  sentences: number;
  supported: number;
  unsupported: number;
  uncited: number;
  badCitation: number;
  /** Cited passages that come from the labeled doc, among supported sentences (answerable only). */
  citationsKept: number;
  citationsKeptRightDoc: number;
  report: CitationReport | null;
}

export async function scoreRecording(c: Case, rec: Recording, verifier: CitationVerifier): Promise<CaseResult> {
  const abstained = isAbstention(rec.answer);
  const base: CaseResult = {
    caseId: c.id, question: c.question, answerable: c.answerable, abstained,
    sentences: 0, supported: 0, unsupported: 0, uncited: 0, badCitation: 0,
    citationsKept: 0, citationsKeptRightDoc: 0, report: null,
  };
  if (abstained) return base;
  const report = await checkCitations(rec.answer, rec.passages.map((p) => ({ n: p.n, text: p.text })), verifier);
  base.report = report;
  base.sentences = report.sentences.length;
  for (const s of report.sentences) {
    if (s.status === "supported") {
      base.supported++;
      for (const n of s.cited) {
        base.citationsKept++;
        if (rec.passages.find((p) => p.n === n)?.doc === c.doc) base.citationsKeptRightDoc++;
      }
    } else if (s.status === "unsupported") base.unsupported++;
    else if (s.status === "uncited") base.uncited++;
    else base.badCitation++;
  }
  return base;
}

export interface Summary {
  model: string;
  verifier: string;
  recorded: number;
  totalCases: number;
  answerable: { recorded: number; answered: number; refused: number; sentences: number; supported: number; allSupported: number; citationsKept: number; citationsKeptRightDoc: number };
  unanswerable: { recorded: number; refused: number; answered: number; answeredWithSupportedSentence: number };
}

export function summarize(model: string, verifier: string, totalCases: number, results: CaseResult[]): Summary {
  const a = results.filter((r) => r.answerable);
  const u = results.filter((r) => !r.answerable);
  const sum = (xs: CaseResult[], f: (r: CaseResult) => number) => xs.reduce((t, r) => t + f(r), 0);
  return {
    model, verifier, recorded: results.length, totalCases,
    answerable: {
      recorded: a.length,
      answered: a.filter((r) => !r.abstained).length,
      refused: a.filter((r) => r.abstained).length,
      sentences: sum(a, (r) => r.sentences),
      supported: sum(a, (r) => r.supported),
      allSupported: a.filter((r) => !r.abstained && r.sentences > 0 && r.supported === r.sentences).length,
      citationsKept: sum(a, (r) => r.citationsKept),
      citationsKeptRightDoc: sum(a, (r) => r.citationsKeptRightDoc),
    },
    unanswerable: {
      recorded: u.length,
      refused: u.filter((r) => r.abstained).length,
      answered: u.filter((r) => !r.abstained).length,
      answeredWithSupportedSentence: u.filter((r) => !r.abstained && r.supported > 0).length,
    },
  };
}
