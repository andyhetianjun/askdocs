import { getDeps } from "@/lib/deps";

export const dynamic = "force-dynamic";

export default async function TracesPage() {
  const { traces } = await getDeps();
  const rows = await traces.recent(50);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Recent requests</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-600">Nothing yet. Ask a question on the home page.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-stone-200 bg-stone-100 text-stone-600">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2 text-right">Retrieval ms</th>
                <th className="px-3 py-2 text-right">Chunks</th>
                <th className="px-3 py-2 text-right">Tokens in/out</th>
                <th className="px-3 py-2">Top result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-stone-100 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{t.timestamp.replace("T", " ").slice(0, 19)}</td>
                  <td className="px-3 py-2">{t.question}{t.error ? ` (error: ${t.error})` : ""}</td>
                  <td className="px-3 py-2">{t.mode}</td>
                  <td className="px-3 py-2 text-right">{t.retrievalMs}</td>
                  <td className="px-3 py-2 text-right">{t.chunksReturned}</td>
                  <td className="px-3 py-2 text-right">{t.llm ? `${t.llm.inputTokens} / ${t.llm.outputTokens}` : "no LLM"}</td>
                  <td className="px-3 py-2">{t.topChunks[0] ? `${t.topChunks[0].doc}: ${t.topChunks[0].section}` : "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
