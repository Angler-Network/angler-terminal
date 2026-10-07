import { NextResponse, type NextRequest } from "next/server";
import { getPredictionEvent } from "@/lib/prediction/server";

// HIP-4 keys carry names ("Deportivo Alavés"), so any printable text after hl:.
const ID = /^(pm:\d{1,12}|hl:[^\u0000-\u001f]{1,200})$/;

/** One event by id (`pm:<Gamma id>` or `hl:<key>`), with fresh prices. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!ID.test(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  try {
    const event = await getPredictionEvent(id);
    return event ? NextResponse.json(event, { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=20" } }) : NextResponse.json({ error: "Not found." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: `Couldn't read the event: ${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}
