"use client";
import { useMemo } from "react";
import * as XLSX from "xlsx";
import { useStore } from "@/lib/store";
import { normalize } from "@/lib/normalize";
import type { Conf, QaVerdict } from "@/lib/types";
import type { Row } from "@/lib/tables";

export function useNormalized() {
  const { rfx, vendors, history, layers, assumptions, overrides } = useStore();
  return useMemo(() => normalize(rfx, vendors, history, layers, assumptions, overrides), [rfx, vendors, history, layers, assumptions, overrides]);
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Btn({ children, onClick, kind = "secondary", disabled, small, title, type }: { children: React.ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; small?: boolean; title?: string; type?: "submit" | "button" }) {
  return (
    <button type={type || "button"} title={title} disabled={disabled} onClick={onClick}
      className={cx("inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap",
        small ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        kind === "primary" && "bg-ink text-white hover:bg-ink/85",
        kind === "secondary" && "border border-line bg-white text-ink hover:bg-paper",
        kind === "ghost" && "text-ink/70 hover:text-ink hover:bg-paper",
        kind === "danger" && "border border-red-200 text-red-700 hover:bg-red-50")}>
      {children}
    </button>
  );
}

const QA_STYLE: Record<QaVerdict, string> = {
  pass: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  fail: "bg-red-50 text-red-800 ring-red-200",
  conflict: "bg-orange-50 text-orange-800 ring-orange-200",
  unverified: "bg-slate-100 text-slate-700 ring-slate-200",
};
export function QaBadge({ v, children }: { v: QaVerdict; children?: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", QA_STYLE[v])}>{children ?? (v === "pass" ? "QA cleared" : v === "fail" ? "QA failed" : v === "conflict" ? "QA conflict" : "QA unverified")}</span>;
}
export function ConfDot({ c }: { c: Conf }) {
  return <span title={`${c} confidence`} className={cx("inline-block h-1.5 w-1.5 rounded-full", c === "high" ? "bg-emerald-500" : c === "medium" ? "bg-amber-400" : "bg-red-500")} />;
}
export function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "amber" | "red" | "violet" | "emerald" | "blue" }) {
  const t = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700", emerald: "bg-emerald-50 text-emerald-700", blue: "bg-sky-50 text-sky-800" }[tone];
  return <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium", t)}>{children}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return <span className="inline-flex items-center gap-2 text-sm text-ink/60"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/20 border-t-ink/70" />{label}</span>;
}

export function fmtCell(v: unknown, col: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (/_inr$|inr$|price/.test(col) && !/pct/.test(col)) return Math.abs(v) >= 1000 ? "₹" + Math.round(v).toLocaleString("en-IN") : "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (/pct/.test(col)) return `${v}%`;
    return v.toLocaleString("en-IN");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}
export const prettyCol = (c: string) => c.replace(/_inr$/, " (₹)").replace(/_pct$/, " %").replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());

export function exportRows(rows: Row[], columns: string[], name: string, fmt: "csv" | "xlsx") {
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [prettyCol(c), r[c] ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const safe = name.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  XLSX.writeFile(wb, `${safe}.${fmt}`, { bookType: fmt });
}

export function DataTable({ rows, columns, title, maxH = 420 }: { rows: Row[]; columns: string[]; title: string; maxH?: number }) {
  return (
    <div className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="text-sm font-medium">{title} <span className="ml-1 text-xs font-normal text-ink/50">{rows.length} rows</span></div>
        <div className="flex gap-1">
          <Btn small kind="ghost" onClick={() => exportRows(rows, columns, title, "csv")}>CSV</Btn>
          <Btn small kind="ghost" onClick={() => exportRows(rows, columns, title, "xlsx")}>Excel</Btn>
        </div>
      </div>
      <div className="overflow-auto" style={{ maxHeight: maxH }}>
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 bg-paper text-left text-ink/60">
            <tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium">{prettyCol(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line/70 hover:bg-paper/60">
                {columns.map((c) => <td key={c} className={cx("px-3 py-1.5 align-top", typeof r[c] === "number" ? "text-right whitespace-nowrap" : "max-w-[380px]")}>{fmtCell(r[c], c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 max-w-3xl text-sm text-ink/60">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
