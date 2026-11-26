import { getDeps } from "@/lib/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { traces } = await getDeps();
  return Response.json({ traces: await traces.recent(50) });
}
