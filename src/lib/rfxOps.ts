import type { Question, Rfx, RfxLine } from "./types";
type Op = { op: string; field?: string; value?: string; line?: Partial<RfxLine>; lines?: Partial<RfxLine>[]; id?: string; question?: Partial<Question> };
const nextId = (prefix: string, ids: string[]) => {
  const n = Math.max(0, ...ids.map((i) => parseInt(i.replace(/\D/g, "")) || 0)) + 1;
  return `${prefix}${prefix === "L" ? String(n).padStart(2, "0") : n}`;
};
const fillLine = (l: Partial<RfxLine>, id: string): RfxLine => ({
  id, kind: l.kind || "RSC", description: l.description || "", ply: l.ply ?? null, dims_mm: l.dims_mm ?? null, board: l.board || (l.ply ? `${l.ply}-ply` : ""),
  print_colours: Number(l.print_colours ?? 0), uom: (l.uom as RfxLine["uom"]) || "pc", annual_qty: Number(l.annual_qty ?? 0), spec_weight_g: l.spec_weight_g ?? null,
});
export function applyRfxOps(rfx: Rfx, ops: Op[]): { rfx: Rfx; log: string[] } {
  const r: Rfx = JSON.parse(JSON.stringify(rfx));
  const log: string[] = [];
  for (const o of ops) {
    switch (o.op) {
      case "set_header": if (o.field) { (r as unknown as Record<string, string>)[o.field] = o.value ?? ""; log.push(`Set ${o.field}`); } break;
      case "set_term": if (o.field) { r.terms[o.field] = o.value ?? ""; log.push(`Term “${o.field}” updated`); } break;
      case "add_line": { const id = o.line?.id || nextId("L", r.lines.map((l) => l.id)); r.lines.push(fillLine(o.line || {}, id)); log.push(`Added line ${id}`); break; }
      case "update_line": { const id = o.id || o.line?.id; const i = r.lines.findIndex((l) => l.id === id); if (i >= 0) { r.lines[i] = { ...r.lines[i], ...o.line, id: r.lines[i].id } as RfxLine; log.push(`Updated ${id}`); } break; }
      case "remove_line": r.lines = r.lines.filter((l) => l.id !== o.id); log.push(`Removed ${o.id}`); break;
      case "replace_all_lines": r.lines = (o.lines || []).map((l, i) => fillLine(l, `L${String(i + 1).padStart(2, "0")}`)); log.push(`Replaced line list (${r.lines.length} lines)`); break;
      case "add_question": { const id = o.question?.id || nextId("Q", r.questionnaire.map((q) => q.id)); r.questionnaire.push({ text: "", type: "yes_no", knockout: false, requirement: "", ...o.question, id } as Question); log.push(`Added question ${id}`); break; }
      case "update_question": { const id = o.id || o.question?.id; const i = r.questionnaire.findIndex((q) => q.id === id); if (i >= 0) { r.questionnaire[i] = { ...r.questionnaire[i], ...o.question, id: r.questionnaire[i].id } as Question; log.push(`Updated ${id}`); } break; }
      case "remove_question": r.questionnaire = r.questionnaire.filter((q) => q.id !== o.id); log.push(`Removed ${o.id}`); break;
    }
  }
  return { rfx: r, log };
}
