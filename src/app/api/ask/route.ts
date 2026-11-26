import { getDeps } from "@/lib/deps";
import { ask } from "@/lib/pipeline";
import type { Mode } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODES: Mode[] = ["keyword", "vector", "hybrid"];

export async function POST(req: Request): Promise<Response> {
  let body: { question?: unknown; mode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "Field 'question' is required." }, { status: 400 });
  if (question.length > 500) return Response.json({ error: "Question is too long (max 500 characters)." }, { status: 400 });
  const mode = body.mode ?? "hybrid";
  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) {
    return Response.json({ error: `Field 'mode' must be one of ${MODES.join(", ")}.` }, { status: 400 });
  }

  try {
    const result = await ask(await getDeps(), question, mode as Mode);
    return Response.json({
      answer: result.answer,
      model: result.model,
      traceId: result.trace.id,
      retrievalMs: result.trace.retrievalMs,
      passages: result.hits.map((h) => ({
        n: h.rank,
        doc: h.chunk.doc,
        section: h.chunk.section,
        url: h.chunk.url,
        score: h.score,
        text: h.chunk.text,
      })),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
