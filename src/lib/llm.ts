import Anthropic from "@anthropic-ai/sdk";
import { ModelVerifier, LexicalVerifier, type CitationVerifier } from "./citations";
import { tokenize } from "./tokenize";
import type { Hit } from "./types";

export const MODEL = "claude-sonnet-5-5";

export interface Generation {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Generator {
  generate(question: string, hits: Hit[]): Promise<Generation>;
}

const SYSTEM =
  "You answer questions about the Python standard library using only the numbered passages you are given. " +
  "Write short sentences. Every sentence must make one claim and end with the number of the passage that backs it, like [1] or [2]. " +
  "Do not write a sentence you cannot back with a passage. If the passages do not contain the answer, reply with exactly: " +
  "I couldn't find this in the docs.";

export function buildPrompt(question: string, hits: Hit[]): string {
  const passages = hits
    .map((h, i) => `[${i + 1}] ${h.chunk.doc} / ${h.chunk.section}\n${h.chunk.text}`)
    .join("\n\n");
  return `Passages:\n\n${passages}\n\nQuestion: ${question}`;
}

export class AnthropicGenerator implements Generator {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(question: string, hits: Hit[]): Promise<Generation> {
    const res = await this.client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(question, hits) }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    return { text, model: MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}

/**
 * Offline stand-in: quotes the sentences of the top passages that share the most words with the question.
 * It writes nothing of its own, so every sentence it returns is supported by the passage it cites.
 * Used by tests, the questionnaire without a key, and the offline numbers in the docs.
 */
export class ScriptedGenerator implements Generator {
  async generate(question: string, hits: Hit[]): Promise<Generation> {
    const wanted = new Set(tokenize(question));
    const candidates = hits.slice(0, 3).flatMap((h, i) =>
      sentencesOf(h.chunk.text).map((sentence) => {
        const tokens = tokenize(sentence);
        const overlap = tokens.filter((t) => wanted.has(t)).length;
        return { sentence, n: i + 1, score: overlap / Math.sqrt(Math.max(tokens.length, 1)) };
      }),
    );
    candidates.sort((a, b) => b.score - a.score || a.n - b.n);
    const picked = candidates.filter((c) => c.score > 0).slice(0, 2);
    const text = picked.length ? picked.map((c) => `${c.sentence.replace(/\.$/, "")} [${c.n}].`).join(" ") : "No passages were found.";
    return { text, model: "scripted", inputTokens: 0, outputTokens: text.split(/\s+/).length };
  }
}

/** Prose sentences of a passage: code lines, tables and very short or very long fragments are skipped. */
function sentencesOf(text: string): string[] {
  const prose = text
    .split("\n")
    .filter((l) => !/^\s*(>>>|\.\.\.|\$|[{}\[\]|=+-]{2,})/.test(l))
    .join(" ")
    .replace(/\s+/g, " ");
  return prose
    .split(/(?<=[.!?])\s+(?=[A-Za-z*`])/)
    .map((s) => s.trim())
    .filter((s) => {
      const words = s.split(" ").length;
      return words >= 6 && words <= 45 && /[.!?]$/.test(s) && !/[{}]|=>|>>>/.test(s);
    });
}

/**
 * ANTHROPIC_API_KEY set: real model. ASKDOCS_LLM=scripted: offline stand-in.
 * Otherwise null, and the app shows retrieved passages with citations only.
 */
export function createGenerator(env: NodeJS.ProcessEnv = process.env): Generator | null {
  if (env.ASKDOCS_LLM === "scripted") return new ScriptedGenerator();
  if (env.ANTHROPIC_API_KEY) return new AnthropicGenerator(env.ANTHROPIC_API_KEY);
  return null;
}

/**
 * With ANTHROPIC_API_KEY the citation check is made by the model (one short call per cited sentence).
 * Without one, or with ASKDOCS_VERIFIER=lexical, it uses the offline word-overlap check.
 */
export function createVerifier(env: NodeJS.ProcessEnv = process.env): CitationVerifier {
  if (!env.ANTHROPIC_API_KEY || env.ASKDOCS_VERIFIER === "lexical") return new LexicalVerifier();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return new ModelVerifier(async (prompt) => {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  });
}
