/** Flat tables + a small, safe query language for the analyst. No eval, no SQL injection surface. */
import type { Cell, History, Rfx, VendorSummary } from "./types";

export type Row = Record<string, string | number | boolean | null>;

export function buildTables(rfx: Rfx, cells: Cell[], summaries: VendorSummary[], history: History) {
  const vname = (id: string) => summaries.find((s) => s.vendor_id === id)?.name || id;
  const offers: Row[] = cells.map((c) => {
    const l = rfx.lines.find((x) => x.id === c.line_id)!;
    const s = summaries.find((x) => x.vendor_id === c.vendor_id)!;
    const fy = history.prices[c.line_id] ?? null;
    return {
      vendor_id: c.vendor_id, vendor: vname(c.vendor_id), line_id: c.line_id, line: l.description, kind: l.kind, ply: l.ply, uom: l.uom,
      annual_qty: l.annual_qty, status: c.status, unit_inr: c.unit_inr, discount_inr: c.discount_inr ? +c.discount_inr.toFixed(2) : 0,
      freight_inr: c.freight_inr ? +c.freight_inr.toFixed(2) : 0, landed_inr: c.landed_inr, annual_landed_inr: c.annual_landed_inr,
      confidence: c.confidence, qa_status: s?.qa_status ?? null, fy26_price_inr: fy,
      vs_fy26_pct: fy && c.landed_inr ? +(((c.landed_inr - fy) / fy) * 100).toFixed(1) : null,
      flags: c.flags.join("; "),
    };
  });
  const vendors: Row[] = summaries.map((s) => ({
    vendor_id: s.vendor_id, vendor: s.name, qa_status: s.qa_status, lines_quoted: s.lines_quoted, lines_missing: s.lines_missing.length,
    missing_lines: s.lines_missing.join(", "), deviation_lines: s.lines_deviation.join(", "), unresolved_lines: s.lines_unresolved.join(", "),
    payment_days: s.payment_days, freight: s.freight_text, discount: s.discount_text, lead_time_days: s.lead_time_days,
    total_landed_quoted_inr: Math.round(s.total_landed_quoted_inr), low_conf_cells: s.low_conf_cells, suspicious_content: s.suspicious.join(" | "),
  }));
  const questionnaire: Row[] = summaries.flatMap((s) =>
    rfx.questionnaire.map((q) => {
      const d = s.qa_detail.find((x) => x.qid === q.id);
      return { vendor_id: s.vendor_id, vendor: s.name, qid: q.id, question: q.text, knockout: q.knockout, requirement: q.requirement, verdict: d?.verdict ?? "n/a (not knockout)", detail: d?.why ?? "" };
    }));
  const lines: Row[] = rfx.lines.map((l) => ({
    line_id: l.id, line: l.description, kind: l.kind, ply: l.ply, uom: l.uom, annual_qty: l.annual_qty, spec_weight_g: l.spec_weight_g,
    print_colours: l.print_colours, fy26_price_inr: history.prices[l.id] ?? null, fy26_annual_inr: history.prices[l.id] ? Math.round(history.prices[l.id] * l.annual_qty) : null,
  }));
  return { offers, vendors, questionnaire, lines };
}

export interface Query {
  table: "offers" | "vendors" | "questionnaire" | "lines";
  filters?: { field: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "is_null" | "not_null"; value?: unknown }[];
  group_by?: string[];
  aggregates?: { fn: "sum" | "avg" | "min" | "max" | "count"; field?: string; as?: string }[];
  pivot?: { index: string; columns: string; values: string };
  columns?: string[];
  sort?: { field: string; dir?: "asc" | "desc" }[];
  limit?: number;
}

export function runQuery(tables: ReturnType<typeof buildTables>, q: Query): Row[] {
  let rows = [...(tables[q.table] || [])];
  for (const f of q.filters || []) {
    rows = rows.filter((r) => {
      const v = r[f.field];
      const x = f.value as never;
      switch (f.op) {
        case "eq": return v == x;
        case "neq": return v != x;
        case "gt": return v != null && (v as number) > x;
        case "gte": return v != null && (v as number) >= x;
        case "lt": return v != null && (v as number) < x;
        case "lte": return v != null && (v as number) <= x;
        case "in": return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        case "contains": return String(v ?? "").toLowerCase().includes(String(x).toLowerCase());
        case "is_null": return v == null;
        case "not_null": return v != null;
      }
    });
  }
  if (q.pivot) {
    const { index, columns, values } = q.pivot;
    const map = new Map<string, Row>();
    for (const r of rows) {
      const k = String(r[index]);
      if (!map.has(k)) map.set(k, { [index]: r[index], ...(index === "line_id" ? { line: r.line } : {}) });
      map.get(k)![String(r[columns])] = r[values];
    }
    rows = [...map.values()];
  } else if (q.group_by?.length || q.aggregates?.length) {
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const k = (q.group_by || []).map((g) => String(r[g])).join("¦");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    rows = [...groups.values()].map((g) => {
      const out: Row = {};
      for (const gb of q.group_by || []) out[gb] = g[0][gb];
      for (const a of q.aggregates || [{ fn: "count" }]) {
        const nums = a.field ? g.map((r) => r[a.field!]).filter((x) => typeof x === "number") as number[] : [];
        const name = a.as || `${a.fn}_${a.field || "rows"}`;
        out[name] = a.fn === "count" ? (a.field ? nums.length : g.length)
          : a.fn === "sum" ? +nums.reduce((s, x) => s + x, 0).toFixed(2)
          : a.fn === "avg" ? (nums.length ? +(nums.reduce((s, x) => s + x, 0) / nums.length).toFixed(2) : null)
          : a.fn === "min" ? (nums.length ? Math.min(...nums) : null) : (nums.length ? Math.max(...nums) : null);
      }
      return out;
    });
  }
  for (const s of [...(q.sort || [])].reverse()) {
    rows.sort((a, b) => {
      const x = a[s.field], y = b[s.field];
      if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return s.dir === "desc" ? -c : c;
    });
  }
  if (q.columns?.length && !q.pivot) rows = rows.map((r) => Object.fromEntries(q.columns!.filter((c) => c in r).map((c) => [c, r[c]])));
  return rows.slice(0, Math.min(q.limit || 200, 500));
}
