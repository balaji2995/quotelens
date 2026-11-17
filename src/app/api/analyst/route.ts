import { NextResponse } from "next/server";
import { runAnalyst } from "@/lib/server/analyst";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    return NextResponse.json(await runAnalyst(await req.json()));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
