import path from "node:path";
import { AnswerBank } from "@/lib/answer-bank";
import { getDeps } from "@/lib/deps";
import { draftQuestionnaire, fillCsv, parseQuestionnaire } from "@/lib/questionnaire";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUESTIONS = 100;
const bankFile = () => process.env.ANSWER_BANK_FILE ?? path.join(process.cwd(), "data", "answer-bank.json");

export async function POST(req: Request): Promise<Response> {
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return Response.json({ error: "Field 'text' (a CSV or one question per line) is required." }, { status: 400 });
  }
  const parsed = parseQuestionnaire(body.text);
  if (parsed.rows.length === 0) return Response.json({ error: "No questions found." }, { status: 400 });
  if (parsed.rows.length > MAX_QUESTIONS) {
    return Response.json({ error: `At most ${MAX_QUESTIONS} questions at a time.` }, { status: 400 });
  }

  try {
    const bank = await AnswerBank.load(bankFile());
    const { answers, counts } = await draftQuestionnaire(
      await getDeps(),
      bank,
      parsed.rows.map((r) => r[parsed.questionColumn] ?? ""),
    );
    await bank.save(bankFile());
    return Response.json({ answers, counts, csv: fillCsv(parsed, answers) });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Something went wrong." }, { status: 500 });
  }
}
