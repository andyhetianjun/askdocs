"use client";

import { useState } from "react";

interface Passage {
  n: number;
  doc: string;
  section: string;
  url: string;
  score: number;
  text: string;
}

interface Sentence {
  text: string;
  cited: number[];
  status: "supported" | "unsupported" | "uncited" | "bad_citation";
}

interface Response {
  abstained: boolean;
  similarity: number;
  citations: Sentence[] | null;
  droppedSentences: number;
  answer: string | null;
  model: string | null;
  retrievalMs: number;
  passages: Passage[];
}

const MODES = ["hybrid", "keyword", "vector"] as const;

export default function Home() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("hybrid");
  const [result, setResult] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, mode }),
      });
      const data = (await res.json()) as Response & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="q" className="block text-sm font-medium">
          Ask about the Python standard library
        </label>
        <input
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="How do I read a CSV file into dictionaries?"
          className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-500"
        />
        <div className="flex items-center gap-3 text-sm">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}
            className="rounded border border-stone-300 bg-white px-2 py-1"
            aria-label="Retrieval mode"
          >
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-stone-900 px-4 py-1.5 text-white disabled:opacity-50"
          >
            {loading ? "Searching..." : "Ask"}
          </button>
        </div>
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {result && (
        <section className="space-y-4">
          {result.abstained ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-medium">{result.answer}</p>
              <p className="mt-1 text-xs text-stone-600">
                The closest passage scored {result.similarity.toFixed(2)} for similarity, which is too low to trust. The
                passages below are the nearest ones, shown anyway.
              </p>
            </div>
          ) : result.answer ? (
            <div className="rounded border border-stone-200 bg-white p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {result.answer}
              <p className="mt-2 text-xs text-stone-500">
                Answer by {result.model}. Each sentence was checked against the passage it cites.
                {result.droppedSentences > 0 && ` ${result.droppedSentences} sentence(s) failed the check and were left out.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-600">
              No model is configured (set ANTHROPIC_API_KEY to get written answers), so these are the matching passages.
            </p>
          )}
          <p className="text-xs text-stone-500">
            {result.passages.length} passages in {result.retrievalMs} ms
          </p>
          <ol className="space-y-3">
            {result.passages.map((p) => (
              <li key={p.n} className="rounded border border-stone-200 bg-white p-3 text-sm">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <a href={p.url} className="font-medium underline" target="_blank" rel="noreferrer">
                    [{p.n}] {p.doc}: {p.section}
                  </a>
                  <span className="text-xs text-stone-400">{p.score.toFixed(3)}</span>
                </div>
                <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-stone-700">{p.text}</pre>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
