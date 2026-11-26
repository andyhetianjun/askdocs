import questionnaire from "../../../data/results/questionnaire.json";
import retrieval from "../../../data/results/retrieval.json";
import sync from "../../../data/results/sync.json";
import trust from "../../../data/results/trust.json";

export const metadata = { title: "Eval results - askdocs demo" };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded border border-stone-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-stone-200 bg-stone-100 text-stone-600">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-stone-100">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EvalPage() {
  const retrievalRows = (level: string) =>
    retrieval.scores.filter((s) => s.level === level).map((s) => [s.mode, s.recallAt5.toFixed(3), s.mrr.toFixed(3), s.avgMs.toFixed(1)]);
  const checker = trust.checker;

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold">Eval results</h1>
        <p className="text-sm text-stone-700">
          Numbers from the commands in the repo, run once on one laptop with the real embedding model. They are copied here as
          static data, not measured in your browser. Each section names the command that makes it. The questions and labels
          were written by hand and the set is small, so treat differences of one question as noise.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-medium">Search: does the right passage come back?</h2>
        <p className="text-xs text-stone-600">
          <code>npm run eval</code>. {retrieval.questions} questions, {retrieval.chunks} passages. A hit is a top 5 result from the right doc and section.
        </p>
        <Table head={["search", "recall@5", "MRR", "avg ms per query"]} rows={retrievalRows("section")} />
        <p className="text-xs text-stone-600">Right doc only:</p>
        <Table head={["search", "recall@5", "MRR", "avg ms per query"]} rows={retrievalRows("doc")} />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Citation check</h2>
        <p className="text-xs text-stone-600">
          <code>npm run eval:trust</code>. {checker.total} claims I wrote by hand, each paired with a passage, some backed by it and some not. This is the
          offline word-overlap check; the model-based check was not run (no key).
        </p>
        <Table
          head={["precision", "recall", "invented claims rejected", "wrong-passage claims rejected", "contradictions rejected"]}
          rows={[[
            pct(checker.precision),
            pct(checker.recall),
            `${checker.rejected.invented?.rejected} of ${checker.rejected.invented?.total}`,
            `${checker.rejected["wrong passage"]?.rejected} of ${checker.rejected["wrong passage"]?.total}`,
            `${checker.rejected.contradiction?.rejected} of ${checker.rejected.contradiction?.total}`,
          ]]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Saying &quot;I couldn&apos;t find this&quot;</h2>
        <p className="text-xs text-stone-600">
          <code>npm run eval:trust</code>. 30 answerable questions and 12 the docs cannot answer. A question is refused when its closest passage scores below the cut-off.
          The demo uses {trust.abstainBelow}.
        </p>
        <Table
          head={["refuse below", "answerable wrongly refused", "unanswerable correctly refused"]}
          rows={trust.abstain.map((a) => [a.threshold, pct(a.falseAbstainRate), pct(a.correctAbstainRate)])}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Questionnaire mode: reusing answers</h2>
        <p className="text-xs text-stone-600">
          <code>npm run eval:questionnaire</code>. 12 rephrased questions and 8 different questions on the same topic, checked against the 30 already answered.
        </p>
        <Table
          head={["reuse at least", "rephrased matched", "different wrongly matched"]}
          rows={questionnaire.reuse.map((r) => [r.reuseAbove, `${r.matched} of 12`, `${r.wronglyMatched} of 8`])}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Incremental sync</h2>
        <p className="text-xs text-stone-600">
          <code>npm run bench:sync</code>. Time to bring the index up to date after one change, compared with a full rebuild.
        </p>
        <Table
          head={["step", "documents", "chunks embedded", "time"]}
          rows={sync.rows.map((r) => [r.step, r.docs, r.embedded, r.ms < 1000 ? `${r.ms.toFixed(0)} ms` : `${(r.ms / 1000).toFixed(1)} s`])}
        />
      </section>
    </div>
  );
}
