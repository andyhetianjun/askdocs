"use client";

import { useEffect, useMemo, useState } from "react";
import { BASE } from "../lib/browser-search";

interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: AnyValue[] };
}
interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: { key: string; value: AnyValue }[];
  status?: { code?: number };
}
interface Doc {
  resourceSpans?: { scopeSpans?: { spans?: Span[] }[] }[];
}
interface Trace {
  id: string;
  label: string;
  source: "recorded" | "sample run";
  model: string;
  otlp: Doc;
}

const flat = (doc: Doc): Span[] => (doc.resourceSpans ?? []).flatMap((rs) => (rs.scopeSpans ?? []).flatMap((ss) => ss.spans ?? []));
const show = (v: AnyValue): string =>
  v.stringValue ?? String(v.intValue ?? v.doubleValue ?? v.boolValue ?? v.arrayValue?.values.map(show).join(", ") ?? "");
const attrsOf = (s: Span): Record<string, string> => Object.fromEntries((s.attributes ?? []).map((a) => [a.key, show(a.value)]));
const fmt = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`);

/** Parents first, children in start order, with a depth for indenting. */
function ordered(spans: Span[]): { span: Span; depth: number }[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const kids = new Map<string, Span[]>();
  for (const s of spans) {
    const key = s.parentSpanId && ids.has(s.parentSpanId) ? s.parentSpanId : "";
    kids.set(key, [...(kids.get(key) ?? []), s]);
  }
  const out: { span: Span; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    const list = (kids.get(parent) ?? []).sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
    for (const s of list) {
      out.push({ span: s, depth });
      walk(s.spanId, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

const COLORS: Record<string, string> = {
  invoke_workflow: "#c9c4bb",
  chat: "#7c5cd6",
  retrieval: "#0f6fa8",
  embeddings: "#0f8a80",
};

function Waterfall({ doc }: { doc: Doc }) {
  const [picked, setPicked] = useState<Span | null>(null);
  const spans = flat(doc);
  if (spans.length === 0) return <p className="text-sm text-stone-600">No spans.</p>;
  const t0 = spans.reduce((m, s) => (BigInt(s.startTimeUnixNano) < m ? BigInt(s.startTimeUnixNano) : m), BigInt(spans[0]!.startTimeUnixNano));
  const t1 = spans.reduce((m, s) => (BigInt(s.endTimeUnixNano) > m ? BigInt(s.endTimeUnixNano) : m), t0);
  const total = Math.max(Number(t1 - t0), 1);
  const detail = picked ? attrsOf(picked) : null;
  return (
    <div>
      <div className="rounded border border-stone-200 bg-white">
        {ordered(spans).map(({ span, depth }) => {
          const a = attrsOf(span);
          const start = Number(BigInt(span.startTimeUnixNano) - t0);
          const dur = Number(BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano));
          const color = a["error.type"] ? "#c0392b" : (COLORS[a["gen_ai.operation.name"] ?? ""] ?? "#78716c");
          return (
            <button
              key={span.spanId}
              onClick={() => setPicked(span)}
              style={{ display: "grid", gridTemplateColumns: "minmax(7rem, 14rem) 1fr 4.5rem" }}
              className={`w-full items-center gap-2 border-b border-stone-100 px-2 py-1 text-left text-xs hover:bg-stone-50 ${picked === span ? "bg-stone-100" : ""}`}
            >
              <span className="truncate" style={{ paddingLeft: `${depth * 0.9}rem` }} title={span.name}>{span.name}</span>
              <span style={{ position: "relative", display: "block", height: "0.8rem", background: "#ece9e4", borderRadius: 3 }}>
                <span
                  style={{ background: color, position: "absolute", top: 0, bottom: 0, minWidth: 3, borderRadius: 3, left: `${(start / total) * 100}%`, width: `${(dur / total) * 100}%` }}
                />
              </span>
              <span className="text-right text-stone-600">{fmt(dur / 1e6)}</span>
            </button>
          );
        })}
      </div>
      <pre className="mt-3 overflow-x-auto rounded bg-stone-100 p-3 text-xs">
        {picked && detail
          ? `${picked.name}\n${Object.entries(detail).map(([k, v]) => `${k} = ${v}`).join("\n")}`
          : "Click a bar to see its attributes."}
      </pre>
    </div>
  );
}

export default function TracesPage() {
  const [traces, setTraces] = useState<Trace[] | null>(null);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [own, setOwn] = useState<{ name: string; doc: Doc } | null>(null);

  useEffect(() => {
    fetch(`${BASE}/data/traces.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Trace[]>) : Promise.reject(new Error("traces.json not found"))))
      .then((list) => {
        setTraces(list);
        // a link like /traces/#sample-q33 opens that trace
        const wanted = list.findIndex((t) => t.id === window.location.hash.slice(1));
        if (wanted >= 0) setIndex(wanted);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load traces."));
  }, []);

  const current = traces?.[index];
  const note = useMemo(
    () =>
      current?.source === "recorded"
        ? `Recorded from ${current.model}. Two spans only: the recording keeps when the model was shown its prompt and when the answer was saved, and nothing in between, so there is no retrieval timing or token count.`
        : `Sample run of the real pipeline with tracing on (offline quoting generator, not a language model, so no tokens). Timings are from one laptop.`,
    [current],
  );

  async function load(file: File | undefined) {
    if (!file) return;
    const text = (await file.text()).trim();
    const docs = text.split("\n").map((l) => JSON.parse(l) as Doc);
    setOwn({ name: file.name, doc: { resourceSpans: docs.flatMap((d) => d.resourceSpans ?? []) } });
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">Trace viewer</h1>
        <p className="text-sm text-stone-700">
          Where the time goes in one answer. Each bar is a span: a timed step of the pipeline, named with the OpenTelemetry GenAI
          conventions. Every trace is labelled by where it came from.
        </p>
      </header>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {traces && (
        <>
          <label className="block text-sm">
            Trace{" "}
            <select
              className="max-w-full rounded border border-stone-300 bg-white p-1"
              value={index}
              onChange={(e) => {
                setIndex(Number(e.target.value));
                setOwn(null);
              }}
            >
              {traces.map((t, i) => (
                <option key={t.id} value={i}>
                  [{t.source}] {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-stone-600">{own ? `Your file: ${own.name}` : note}</p>
          {own ? <Waterfall key={own.name} doc={own.doc} /> : current && <Waterfall key={current.id} doc={current.otlp} />}
          <p className="text-xs text-stone-600">
            Open your own: <input type="file" accept=".json,.jsonl" onChange={(e) => void load(e.target.files?.[0])} /> (the file the code writes with ASKDOCS_TRACE=1)
          </p>
        </>
      )}
    </div>
  );
}
