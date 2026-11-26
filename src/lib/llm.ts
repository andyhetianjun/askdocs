import Anthropic from "@anthropic-ai/sdk";
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
  "Cite passages inline like [1] or [2]. If the passages do not contain the answer, say so plainly. Keep answers short.";

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

/** Offline stand-in: quotes the first sentence of the best passages. Used by tests and the no-key demo. */
export class ScriptedGenerator implements Generator {
  async generate(_question: string, hits: Hit[]): Promise<Generation> {
    const parts = hits.slice(0, 2).map((h, i) => {
      const sentence = h.chunk.text.replace(/\s+/g, " ").split(/(?<=\.)\s/)[0] ?? "";
      return `${sentence} [${i + 1}]`;
    });
    const text = parts.length ? parts.join(" ") : "No passages were found.";
    return { text, model: "scripted", inputTokens: 0, outputTokens: text.split(/\s+/).length };
  }
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
