import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface Trace {
  id: string;
  timestamp: string; // ISO
  question: string;
  mode: string;
  retrievalMs: number;
  totalMs: number;
  chunksReturned: number;
  topChunks: { id: string; doc: string; section: string }[];
  llm: { model: string; inputTokens: number; outputTokens: number } | null;
  similarity?: number;
  abstained?: boolean;
  abstainReason?: string;
  citedSentences?: number;
  droppedSentences?: number;
  error?: string;
  /** The OpenTelemetry trace id, when tracing was on, to find this request in a trace viewer. */
  otelTraceId?: string;
}

export interface TraceStore {
  add(trace: Trace): Promise<void>;
  recent(limit: number): Promise<Trace[]>;
}

export class MemoryTraceStore implements TraceStore {
  private readonly items: Trace[] = [];
  async add(trace: Trace): Promise<void> {
    this.items.push(trace);
  }
  async recent(limit: number): Promise<Trace[]> {
    return this.items.slice(-limit).reverse();
  }
}

/** One JSON object per line. Simple, easy to grep, and fine for a single-process demo. */
export class JsonlTraceStore implements TraceStore {
  constructor(private readonly file: string) {}

  async add(trace: Trace): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, JSON.stringify(trace) + "\n");
  }

  async recent(limit: number): Promise<Trace[]> {
    let raw = "";
    try {
      raw = await readFile(this.file, "utf8");
    } catch {
      return [];
    }
    const lines = raw.split("\n").filter(Boolean).slice(-limit);
    return lines.map((l) => JSON.parse(l) as Trace).reverse();
  }
}
