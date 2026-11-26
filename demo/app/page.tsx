"use client";

import { useEffect, useRef, useState } from "react";
import { ABSTAIN_BELOW, loadEmbedder, loadIndex, search, type Index, type Mode, type Result } from "./lib/browser-search";

const EXAMPLES = [
  "How do I limit a deque to the last few items?",
  "How can I make instances of a dataclass read-only?",
  "How do I compute the SHA-256 digest of a large file in chunks?",
  "How do I send an email with smtplib?",
];

type Embed = (text: string) => Promise<Float32Array>;

export default function Home() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [status, setStatus] = useState("Loading the index (about 4 MB)...");
  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [results, setResults] = useState<Result[] | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [asked, setAsked] = useState("");
  const [ms, setMs] = useState(0);
  const index = useRef<Index | null>(null);
  const embed = useRef<Embed | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        index.current = await loadIndex();
        if (cancelled) return;
        setStatus(`${index.current.passages.length} passages loaded. Keyword search works now.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not load the index.");
        setModelState("failed");
        return;
      }
      try {
        embed.current = await loadEmbedder((s) => !cancelled && setStatus(s));
        if (cancelled) return;
        setModelState("ready");
        setStatus("Ready. Search runs in this page; your question is not sent anywhere.");
      } catch {
        if (cancelled) return;
        setModelState("failed");
        setStatus("The search model could not be loaded here, so this demo is using keyword search only.");
        setMode("keyword");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(q: string, m: Mode) {
    if (!index.current || !q.trim()) return;
    const t0 = performance.now();
    // The question is embedded even in keyword mode, only so the "weak match" notice can work.
    const vector = embed.current ? await embed.current(q) : null;
    const out = search(index.current, q, m, vector);
    setResults(out.results);
    setSimilarity(out.topSimilarity);
    setAsked(q);
    setMs(Math.round(performance.now() - t0));
  }

  const lowMatch = similarity !== null && similarity < ABSTAIN_BELOW;

  return (
    <div className="space-y-6">
      <div className="rounded border border-stone-300 bg-white p-4 text-sm leading-relaxed">
        <p className="font-medium">What this demo is</p>
        <p className="mt-1 text-stone-700">
          Search over 1268 passages from 30 Python standard library docs, running entirely in your browser. The index and
          the passage vectors were computed ahead of time and are static files; your question is turned into a vector in
          this page by the same small model the full app uses (the 8-bit version).
        </p>
        <p className="mt-2 text-stone-700">
          <strong>Written answers are not part of this demo.</strong> They need an Anthropic API key, so the demo shows the
          passages an answer would cite. When the closest passage is a weak match it says the docs may not cover the question,
          the same cut-off the full app uses to refuse. Run the full app to get citation-checked answers.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(question, mode);
        }}
        className="space-y-3"
      >
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
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            className="rounded border border-stone-300 bg-white px-2 py-1"
            aria-label="Retrieval mode"
          >
            <option value="hybrid" disabled={modelState === "failed"}>hybrid</option>
            <option value="keyword">keyword</option>
            <option value="vector" disabled={modelState === "failed"}>vector</option>
          </select>
          <button type="submit" disabled={!index.current && status.startsWith("Loading the index")} className="rounded bg-stone-900 px-4 py-1.5 text-white disabled:opacity-50">
            Search
          </button>
          <span className="text-xs text-stone-500" role="status">{status}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex}
              onClick={() => {
                setQuestion(ex);
                void run(ex, mode);
              }}
              className="rounded border border-stone-300 bg-white px-2 py-1 text-left text-stone-700 hover:border-stone-500"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {results && (
        <section className="space-y-4" aria-label="Results">
          {lowMatch && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-medium">I couldn&apos;t find this in the docs.</p>
              <p className="mt-1 text-xs text-stone-600">
                The closest passage scored {similarity!.toFixed(2)} for similarity, under the {ABSTAIN_BELOW} cut-off. The nearest
                passages are shown anyway.
              </p>
            </div>
          )}
          <p className="text-xs text-stone-500">
            {results.length} passages for &quot;{asked}&quot; in {ms} ms ({embed.current ? mode : "keyword only"})
          </p>
          <ol className="space-y-3">
            {results.map((r, i) => (
              <li key={r.passage.id} className="rounded border border-stone-200 bg-white p-3 text-sm">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <a href={r.passage.url} className="font-medium underline" target="_blank" rel="noreferrer">
                    [{i + 1}] {r.passage.doc}: {r.passage.section}
                  </a>
                  <span className="text-xs text-stone-400">
                    {r.similarity !== null ? `similarity ${r.similarity.toFixed(2)}` : `score ${r.score.toFixed(2)}`}
                  </span>
                </div>
                <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap text-stone-700">{r.passage.text}</pre>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
