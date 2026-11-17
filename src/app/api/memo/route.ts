import { NextResponse } from "next/server";
import { writeAwardMemo } from "@/lib/server/agents";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  try { const b = await req.json(); return NextResponse.json(await writeAwardMemo(b.rfx, b.question, b.params, b.result, b.assumptions)); }
  catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 500 }); }
}
