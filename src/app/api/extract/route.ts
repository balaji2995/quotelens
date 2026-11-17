import { NextResponse } from "next/server";
import { runExtraction } from "@/lib/server/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const layer = await runExtraction(body.rfx, body.files, body.vendor_name, { mode: body.mode || "response", issues: body.issues });
    return NextResponse.json(layer);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
