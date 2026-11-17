import "server-only";
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type Anthropic from "@anthropic-ai/sdk";

export interface InFile { name: string; kind: string; role: string; base64: string; mime?: string }

/** Turns a vendor file into (a) content blocks for the model and (b) plain text we can verify quotes against. */
export async function fileToBlocks(f: InFile): Promise<{ blocks: Anthropic.ContentBlockParam[]; text: string | null }> {
  const buf = Buffer.from(f.base64, "base64");
  const header = `=== FILE: ${f.name} (${f.role === "quote" ? "vendor response" : "attachment"}) ===`;
  const kind = f.kind || guessKind(f.name);

  if (kind === "xlsx") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      parts.push(`--- Sheet "${sn}" (cell-addressed; each line = one row) ---`);
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cells: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell && cell.v !== undefined && cell.v !== "") cells.push(`${addr}=${String(cell.v)}`);
        }
        if (cells.length) parts.push(cells.join(" | "));
      }
    }
    const text = parts.join("\n");
    return { blocks: [{ type: "text", text: `${header}\n${text}` }], text };
  }
  if (kind === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    // also capture tables as text via HTML conversion for structure
    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    const tableText = html.includes("<table") ? htmlTablesToText(html) : "";
    const text = value + (tableText ? `\n\n[Tables as rows]\n${tableText}` : "");
    return { blocks: [{ type: "text", text: `${header}\n${text}` }], text };
  }
  if (kind === "pdf") {
    let text: string | null = null;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const res = await extractText(pdf, { mergePages: false });
      text = (res.text as string[]).map((t, i) => `[page ${i + 1}]\n${t}`).join("\n");
    } catch { text = null; }
    return {
      blocks: [
        { type: "text", text: header },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } },
      ], text,
    };
  }
  if (kind === "image") {
    const mime = (f.mime || (f.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg")) as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
    return { blocks: [{ type: "text", text: header }, { type: "image", source: { type: "base64", media_type: mime, data: f.base64 } }], text: null };
  }
  // email / txt
  const text = buf.toString("utf8");
  return { blocks: [{ type: "text", text: `${header}\n${text}` }], text };
}

function htmlTablesToText(html: string) {
  return (html.match(/<table[\s\S]*?<\/table>/g) || [])
    .map((t) => (t.match(/<tr[\s\S]*?<\/tr>/g) || [])
      .map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) || []).map((td) => td.replace(/<[^>]+>/g, "").trim()).join(" | "))
      .join("\n"))
    .join("\n\n");
}

export function guessKind(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return "xlsx";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/.test(n)) return "image";
  return "email";
}
