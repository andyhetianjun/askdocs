"use client";

import { useState } from "react";

interface Drafted {
  question: string;
  answer: string;
  status: "confident" | "needs review";
  notes: string[];
  sources: string[];
  reusedFrom: string | null;
}

interface Result {
  answers: Drafted[];
  counts: { confident: number; needsReview: number; reused: number };
  csv: string;
}

export default function QuestionnairePage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadFile(file: File | undefined) {
    if (file) setText(await file.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/questionnaire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as Result & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "answers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="qs" className="block text-sm font-medium">
          Paste questions (one per line), or a CSV with a &quot;question&quot; column
        </label>
        <textarea
          id="qs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded border border-stone-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-stone-500"
          placeholder={"How do I limit a deque to the last few items?\nHow do I read a CSV file as dictionaries?"}
        />
        <div className="flex items-center gap-3 text-sm">
          <input type="file" accept=".csv,.txt" onChange={(e) => loadFile(e.target.files?.[0])} aria-label="Load a CSV file" />
          <button type="submit" disabled={loading || !text.trim()} className="rounded bg-stone-900 px-4 py-1.5 text-white disabled:opacity-50">
            {loading ? "Drafting..." : "Draft answers"}
          </button>
        </div>
      </form>

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {result && (
        <section className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <p>
              {result.counts.confident} confident, {result.counts.needsReview} need review, {result.counts.reused} reused
            </p>
            <button onClick={download} className="rounded border border-stone-300 bg-white px-3 py-1">
              Download CSV
            </button>
          </div>
          <ol className="space-y-3">
            {result.answers.map((a, i) => (
              <li key={i} className="rounded border border-stone-200 bg-white p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{a.question}</p>
                  <span
                    className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${a.status === "confident" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}
                  >
                    {a.status}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-stone-700">{a.answer || "No answer drafted."}</p>
                {a.notes.length > 0 && <p className="mt-1 text-xs text-stone-500">{a.notes.join("; ")}</p>}
                {a.reusedFrom && <p className="text-xs text-stone-500">Reused from: {a.reusedFrom}</p>}
                {a.sources.length > 0 && (
                  <ul className="mt-1 text-xs text-stone-500">
                    {a.sources.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
