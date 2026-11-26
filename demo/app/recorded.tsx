"use client";

import { useEffect, useState } from "react";
import { BASE } from "./lib/browser-search";

interface Sentence {
  text: string;
  cited: number[];
  status: "supported" | "unsupported" | "uncited" | "bad_citation";
}

interface Entry {
  caseId: string;
  question: string;
  answerable: boolean;
  abstained: boolean;
  answer: string;
  sentences: Sentence[];
  passages: { n: number; doc: string; section: string; url: string; text: string }[];
  topSimilarity: number;
  recordedAt: string;
}

interface Recorded {
  model: string;
  verifier: string;
  entries: Entry[];
}

const STATUS: Record<Sentence["status"], { label: string; cls: string }> = {
  supported: { label: "kept", cls: "border-green-300 bg-green-50 text-green-900" },
  unsupported: { label: "dropped: the cited passage does not say this", cls: "border-red-300 bg-red-50 text-red-900" },
  uncited: { label: "dropped: no citation", cls: "border-red-300 bg-red-50 text-red-900" },
  bad_citation: { label: "dropped: cites a passage that was not given", cls: "border-red-300 bg-red-50 text-red-900" },
};

/** Shows answers that were recorded once from a model. Renders nothing when no recordings were built into the demo. */
export function RecordedAnswers({ preferred }: { preferred: string }) {
  const [data, setData] = useState<Recorded | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/data/recordings.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Recorded>) : null))
      .then((d) => {
        if (cancelled || !d || !Array.isArray(d.entries) || d.entries.length === 0) return;
        setData(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (data?.entries.some((e) => e.question === preferred)) setSelected(preferred);
  }, [preferred, data]);

  if (!data) return null;
  const entry = data.entries.find((e) => e.question === selected) ?? null;
  const kept = entry?.sentences.filter((s) => s.status === "supported").length ?? 0;

  return (
    <section className="space-y-3 rounded border border-stone-300 bg-white p-4 text-sm" aria-label="Recorded answers">
      <div>
        <h2 className="font-medium">Recorded answers</h2>
        <p className="mt-1 text-xs text-stone-600">
          Recorded once from Claude Sonnet 5.5 through a recording harness (each question run by a separate fresh session); not a live
          call. The model was given the question and the five passages the search returned, and wrote a cited answer or said it
          could not find one. The checker then compared each sentence with the passage it cites ({data.verifier}).
        </p>
      </div>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-xs"
        aria-label="Recorded question"
      >
        <option value="">Pick a recorded question ({data.entries.length})</option>
        {data.entries.map((e) => (
          <option key={e.caseId} value={e.question}>{e.question}</option>
        ))}
      </select>

      {entry && (
        <div className="space-y-3">
          <p className="text-xs text-stone-500">
            Recorded {entry.recordedAt.slice(0, 10)}. Closest passage similarity {entry.topSimilarity.toFixed(2)}.{" "}
            {entry.answerable ? "The docs cover this question." : "The docs do not cover this question."}
          </p>
          <div>
            <p className="text-xs font-medium text-stone-600">Answer</p>
            {entry.abstained ? (
              <p className="mt-1 rounded border border-amber-300 bg-amber-50 p-3">{entry.answer}</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {entry.sentences.map((s, i) => (
                  <li key={i} className="rounded border border-stone-200 p-2">
                    <p>
                      {s.text} {s.cited.length > 0 && <span className="text-stone-500">{s.cited.map((n) => `[${n}]`).join("")}</span>}
                    </p>
                    <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-xs ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs font-medium">
            Verdict:{" "}
            {entry.abstained
              ? entry.answerable
                ? "the model refused, but the docs do cover this question."
                : "the model refused, and the docs do not cover this question."
              : `${kept} of ${entry.sentences.length} sentences kept.${entry.answerable ? "" : " The docs do not cover this question, so any answer here is unsupported by the right material."}`}
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-stone-600">The passages the model was given</summary>
            <ol className="mt-2 space-y-2">
              {entry.passages.map((p) => (
                <li key={p.n} className="rounded border border-stone-200 p-2">
                  <a href={p.url} target="_blank" rel="noreferrer" className="font-medium underline">[{p.n}] {p.doc}: {p.section}</a>
                  <pre className="mt-1 max-h-40 overflow-auto font-mono whitespace-pre-wrap text-stone-700">{p.text}</pre>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
