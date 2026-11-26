import { tokenize } from "./tokenize";

export const ABSTAIN_MESSAGE = "I couldn't find this in the docs.";

export interface Passage {
  n: number; // the number used in the answer, e.g. [1]
  text: string;
}

export type SentenceStatus = "supported" | "unsupported" | "uncited" | "bad_citation";

export interface SentenceCheck {
  text: string; // the sentence without its [n] markers
  cited: number[];
  status: SentenceStatus;
  score: number; // 0 to 1, how well the cited passages cover the sentence
}

export interface CitationReport {
  sentences: SentenceCheck[];
  /** The sentences that passed, with their markers, joined back into text. */
  keptText: string;
  dropped: number;
}

export interface CitationVerifier {
  readonly name: string;
  /** Does the cited text back up the sentence? */
  verify(sentence: string, cited: Passage[]): Promise<{ supported: boolean; score: number }>;
}

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs)\.$/i;

/** Splits an answer into sentences. A trailing "[1]" stays with the sentence before it. */
export function splitSentences(answer: string): string[] {
  const out: string[] = [];
  for (const line of answer.split(/\n+/)) {
    const sentences: string[] = [];
    // "Use it. [1] Next." -> "Use it [1]. Next." so the marker stays with its sentence.
    const tidy = line.trim().replace(/([.!?])\s+((?:\[\d+(?:\s*,\s*\d+)*\]\s*)+)/g, (_m, end: string, markers: string) => ` ${markers.trim()}${end} `);
    for (const piece of tidy.trim().split(/(?<=[.!?])\s+/)) {
      if (!piece) continue;
      const previous = sentences[sentences.length - 1];
      const onlyMarkers = piece.replace(MARKER, "").replace(/[\s.,;]/g, "") === "";
      if (previous !== undefined && (onlyMarkers || ABBREVIATIONS.test(previous))) {
        sentences[sentences.length - 1] = `${previous} ${piece}`;
      } else {
        sentences.push(piece);
      }
    }
    out.push(...sentences);
  }
  return out;
}

export function citedNumbers(sentence: string): number[] {
  const numbers: number[] = [];
  for (const m of sentence.matchAll(MARKER)) {
    for (const part of m[1]!.split(",")) numbers.push(Number(part.trim()));
  }
  return [...new Set(numbers)];
}

export const stripMarkers = (sentence: string): string =>
  sentence.replace(MARKER, "").replace(/\s+([.,;!?])/g, "$1").replace(/\s+/g, " ").trim();

const NEGATIONS = /\b(?:not|never|no|cannot|without|unlike|nothing)\b|n't\b/i;

/** Words like `os.path`, `frozen=True` or `3.12`: if the claim says them, the passage has to as well. */
function exactTerms(claim: string): string[] {
  const terms = claim.match(/`[^`]+`|[A-Za-z_]+(?:[._][A-Za-z_]+)+|\b[A-Za-z_]+=[A-Za-z0-9_]+|\b\d[\d.]*\b/g) ?? [];
  return terms.map((t) => t.replace(/`/g, "").toLowerCase());
}

export interface LexicalScore {
  score: number;
  unigrams: number;
  bigrams: number;
  missingExact: string[];
  negationMismatch: boolean;
}

/**
 * Entailment-style overlap. It asks how much of the claim shows up in the passage:
 * single words (after dropping stopwords and plurals), neighbouring word pairs, and
 * exact names or numbers. A claim with a negation the passage lacks (or the reverse) is flagged.
 * This is a heuristic. It cannot tell a rephrased claim from a reversed one.
 */
export function lexicalScore(claim: string, passage: string): LexicalScore {
  const claimTokens = tokenize(claim);
  if (claimTokens.length === 0) return { score: 0, unigrams: 0, bigrams: 0, missingExact: [], negationMismatch: false };
  const passageTokens = tokenize(passage);
  const passageSet = new Set(passageTokens);
  const unigrams = claimTokens.filter((t) => passageSet.has(t)).length / claimTokens.length;

  const pairs = (tokens: string[]) => tokens.slice(1).map((t, i) => `${tokens[i]} ${t}`);
  const passagePairs = new Set(pairs(passageTokens));
  const claimPairs = pairs(claimTokens);
  const bigrams = claimPairs.length === 0 ? unigrams : claimPairs.filter((p) => passagePairs.has(p)).length / claimPairs.length;

  const lowered = passage.toLowerCase();
  const missingExact = exactTerms(claim).filter((t) => !lowered.includes(t));
  const negationMismatch = NEGATIONS.test(claim) !== NEGATIONS.test(passage) && NEGATIONS.test(claim);
  return { score: 0.75 * unigrams + 0.25 * bigrams, unigrams, bigrams, missingExact, negationMismatch };
}

/** Pass mark for the overlap score, picked from the sweep in docs/trustworthy-answers.md. */
export const LEXICAL_THRESHOLD = 0.5;

export class LexicalVerifier implements CitationVerifier {
  readonly name = "lexical overlap";
  constructor(private readonly threshold = LEXICAL_THRESHOLD) {}

  async verify(sentence: string, cited: Passage[]): Promise<{ supported: boolean; score: number }> {
    // Judge against the cited passages together, since one sentence can combine two of them.
    const r = lexicalScore(sentence, cited.map((p) => p.text).join("\n"));
    const supported = r.score >= this.threshold && r.missingExact.length === 0 && !r.negationMismatch;
    return { supported, score: r.score };
  }
}

/** Asks a model whether the passages back the sentence. `complete` is the model call, so tests can fake it. */
export class ModelVerifier implements CitationVerifier {
  readonly name = "model";
  constructor(private readonly complete: (prompt: string) => Promise<string>) {}

  async verify(sentence: string, cited: Passage[]): Promise<{ supported: boolean; score: number }> {
    const passages = cited.map((p) => `[${p.n}] ${p.text}`).join("\n\n");
    const reply = await this.complete(
      `Passages:\n\n${passages}\n\nSentence: ${sentence}\n\n` +
        "Do the passages above say what the sentence says, without needing anything else? " +
        "Reply with exactly one word: SUPPORTED or UNSUPPORTED.",
    );
    const supported = /^\s*SUPPORTED/i.test(reply);
    return { supported, score: supported ? 1 : 0 };
  }
}

/** Checks every sentence of an answer against the passages it cites. */
export async function checkCitations(
  answer: string,
  passages: Passage[],
  verifier: CitationVerifier,
): Promise<CitationReport> {
  const byNumber = new Map(passages.map((p) => [p.n, p]));
  const sentences: SentenceCheck[] = [];
  const kept: string[] = [];

  for (const raw of splitSentences(answer)) {
    const cited = citedNumbers(raw);
    const text = stripMarkers(raw);
    if (!text) continue;
    if (cited.length === 0) {
      sentences.push({ text, cited, status: "uncited", score: 0 });
      continue;
    }
    const found = cited.map((n) => byNumber.get(n)).filter((p): p is Passage => p !== undefined);
    if (found.length !== cited.length) {
      sentences.push({ text, cited, status: "bad_citation", score: 0 });
      continue;
    }
    const { supported, score } = await verifier.verify(text, found);
    sentences.push({ text, cited, status: supported ? "supported" : "unsupported", score });
    if (supported) kept.push(raw.trim());
  }
  return { sentences, keptText: kept.join(" "), dropped: sentences.length - kept.length };
}
