import { AnswerBank, type Status } from "./answer-bank";
import { parseCsv, toCsv } from "./csv";
import { ScriptedGenerator } from "./llm";
import { ask, type Deps } from "./pipeline";
import { tokenize } from "./tokenize";

export interface ParsedQuestionnaire {
  /** Column names of the input. Pasted lists get a single "question" column. */
  header: string[];
  questionColumn: number;
  rows: string[][];
}

const QUESTION_HEADER = /^(questions?|prompt|q)$/i;
const LIST_PREFIX = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** A CSV with a "question" column, or one question per line. */
export function parseQuestionnaire(input: string): ParsedQuestionnaire {
  const records = parseCsv(input);
  const first = records[0] ?? [];
  const column = first.findIndex((c) => QUESTION_HEADER.test(c.trim()));
  if (column !== -1) {
    const rows = records.slice(1).filter((r) => (r[column] ?? "").trim() !== "");
    return { header: first, questionColumn: column, rows };
  }
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.replace(LIST_PREFIX, "").trim())
    .filter(Boolean);
  return { header: ["question"], questionColumn: 0, rows: lines.map((l) => [l]) };
}

export interface DraftOptions {
  /** The closest passage must be at least this similar for an answer to be called confident. */
  confidentAbove: number;
  /** The answer must contain at least this share of the question's content words. */
  answerCoversAtLeast: number;
  /** An earlier question at least this similar is treated as the same question. */
  reuseAbove: number;
  /** A reused answer keeps its "confident" label only if the earlier question is at least this similar. */
  trustReuseAbove: number;
}

/** Cut-offs for all-MiniLM-L6-v2. The first is from docs/questionnaire-mode.md, the second two from the reuse sweep there. */
export const DEFAULT_DRAFT_OPTIONS: DraftOptions = { confidentAbove: 0.55, answerCoversAtLeast: 0.3, reuseAbove: 0.65, trustReuseAbove: 0.85 };

/** Share of the question's content words (stemmed, no stopwords) that appear in the answer. */
export function answerCoverage(question: string, answer: string): number {
  const wanted = [...new Set(tokenize(question))];
  if (wanted.length === 0) return 0;
  const have = new Set(tokenize(answer));
  return wanted.filter((t) => have.has(t)).length / wanted.length;
}

export interface DraftedAnswer {
  question: string;
  answer: string;
  status: Status;
  /** Why it needs review, or a short note when it does not. */
  notes: string[];
  sources: string[];
  reusedFrom: string | null;
  similarity: number;
}

export async function draftQuestion(
  deps: Deps,
  bank: AnswerBank,
  question: string,
  options: DraftOptions = DEFAULT_DRAFT_OPTIONS,
): Promise<DraftedAnswer> {
  const [vector] = await deps.embedder.embed([question]);
  if (!vector) throw new Error("embedder returned no vector");

  const earlier = bank.closest(vector, options.reuseAbove);
  if (earlier) {
    const trusted = earlier.similarity >= options.trustReuseAbove && earlier.entry.status === "confident";
    return {
      question,
      answer: earlier.entry.answer,
      status: trusted ? "confident" : "needs review",
      notes: trusted
        ? ["same answer as a near-duplicate question"]
        : [`reused from a similar question (${earlier.similarity.toFixed(2)} similar), check it is the same question`],
      sources: earlier.entry.sources,
      reusedFrom: earlier.entry.question,
      similarity: earlier.similarity,
    };
  }

  // Without a key the answer quotes the best passages, so questionnaires still work offline.
  const offline = deps.generator === null;
  const result = await ask({ ...deps, generator: deps.generator ?? new ScriptedGenerator() }, question);
  const notes: string[] = [];
  if (result.abstained) {
    notes.push(
      result.abstainReason === "low_similarity"
        ? `the docs probably do not cover this (closest passage ${result.similarity.toFixed(2)})`
        : "no sentence passed the citation check",
    );
  } else {
    if (result.similarity < options.confidentAbove) notes.push(`weak match (closest passage ${result.similarity.toFixed(2)})`);
    if (result.citations && result.citations.dropped > 0) notes.push(`${result.citations.dropped} sentence(s) failed the citation check and were left out`);
  }
  if (offline && !result.abstained) notes.push("offline draft: quotes the best passages instead of a written answer");

  const cited = new Set(result.citations?.sentences.filter((s) => s.status === "supported").flatMap((s) => s.cited));
  const sources = [...cited].sort((a, b) => a - b).flatMap((n) => {
    const hit = result.hits[n - 1];
    return hit ? [`[${n}] ${hit.chunk.doc}: ${hit.chunk.section} ${hit.chunk.url}`] : [];
  });

  const coverage = answerCoverage(question, result.answer ?? "");
  if (!result.abstained && coverage < options.answerCoversAtLeast) {
    notes.push(`the answer shares few words with the question (${Math.round(coverage * 100)}%), it may not answer it`);
  }
  const confident =
    !result.abstained &&
    result.similarity >= options.confidentAbove &&
    coverage >= options.answerCoversAtLeast &&
    (result.citations?.dropped ?? 0) === 0;
  const status: Status = confident ? "confident" : "needs review";
  const answer = result.answer ?? "";
  if (!result.abstained) bank.add({ question, answer, status, sources, vector });
  return { question, answer, status, notes, sources, reusedFrom: null, similarity: result.similarity };
}

export interface QuestionnaireResult {
  answers: DraftedAnswer[];
  counts: { confident: number; needsReview: number; reused: number };
}

export async function draftQuestionnaire(
  deps: Deps,
  bank: AnswerBank,
  questions: string[],
  options: DraftOptions = DEFAULT_DRAFT_OPTIONS,
): Promise<QuestionnaireResult> {
  const answers: DraftedAnswer[] = [];
  for (const q of questions) answers.push(await draftQuestion(deps, bank, q, options));
  return {
    answers,
    counts: {
      confident: answers.filter((a) => a.status === "confident").length,
      needsReview: answers.filter((a) => a.status === "needs review").length,
      reused: answers.filter((a) => a.reusedFrom !== null).length,
    },
  };
}

export const OUTPUT_COLUMNS = ["answer", "confidence", "sources", "notes", "reused_from"] as const;

/** The input CSV with the draft columns added (or replaced, if the file already has them). */
export function fillCsv(parsed: ParsedQuestionnaire, answers: DraftedAnswer[]): string {
  const keep = parsed.header.map((h, i) => ({ h, i })).filter(({ h }) => !(OUTPUT_COLUMNS as readonly string[]).includes(h.trim().toLowerCase()));
  const header = [...keep.map((k) => k.h), ...OUTPUT_COLUMNS];
  const body = parsed.rows.map((row, r) => {
    const a = answers[r]!;
    return [
      ...keep.map((k) => row[k.i] ?? ""),
      a.answer,
      a.status,
      a.sources.join("\n"),
      a.notes.join("; "),
      a.reusedFrom ?? "",
    ];
  });
  return toCsv([header, ...body]);
}

