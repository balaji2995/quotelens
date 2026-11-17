import { NextResponse } from "next/server";
import { draftClarification } from "@/lib/server/agents";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  try { const b = await req.json(); return NextResponse.json(await draftClarification(b.rfx, b.vendor, b.issues, b.note)); }
  catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 500 }); }
}
