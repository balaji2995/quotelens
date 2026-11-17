"use client";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useStore } from "@/lib/store";
import type { AwardMemo } from "@/lib/server/analyst-types";
import { Btn, DataTable, Pill, SectionTitle, cx } from "./ui";

const cr = (n: number) => (Math.abs(n) >= 1e7 ? `₹${(n / 1e7).toFixed(2)} cr` : `₹${(n / 1e5).toFixed(2)} L`);

function exportXlsx(m: AwardMemo, rfxId: string) {
  const wb = XLSX.utils.book_new();
  const t = m.result.totals;
  const summary = [
    ["Award memo", m.id], ["RFx", rfxId], ["Status", m.status], ["Created", new Date(m.created_at).toLocaleString("en-IN")],
    ["Title", m.title], ["Recommendation", m.recommendation], [],
    ["Annual landed (₹)", t.annual_landed_inr], ["Same lines at FY26 prices (₹)", t.fy26_same_lines_inr], ["Saving vs FY26 (₹)", t.savings_vs_fy26_inr], ["Saving vs FY26 (%)", t.savings_vs_fy26_pct],
    ["Lines awarded", `${t.lines_awarded}/${t.lines_total}`], ["Vendors", t.vendors_used], [],
    ["Scenario question", m.question], ["Scenario parameters", JSON.stringify(m.params)], ["Buyer assumptions", JSON.stringify(m.assumptions)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.result.allocation), "Allocation");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(m.result.by_vendor), "By vendor");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Risks"], ...m.risks.map((r) => [r]), [], ["Conditions before PO"], ...m.conditions.map((r) => [r]), [], ["System caveats"], ...m.result.caveats.map((r) => [r]), [], ["Excluded vendors"], ...m.result.excluded_vendors.map((e) => [`${e.vendor}: ${e.reason}`])]), "Risks & caveats");
  XLSX.writeFile(wb, `${rfxId}_${m.id}_award.xlsx`);
}
function exportMd(m: AwardMemo, rfxId: string) {
  const t = m.result.totals;
  const md = [`# ${m.title}`, `${rfxId} · ${m.id} · ${m.status} · ${new Date(m.created_at).toLocaleDateString("en-IN")}`, "", "## Recommendation", m.recommendation, "",
    `**Annual landed:** ${cr(t.annual_landed_inr)} · **vs FY26:** ${cr(t.savings_vs_fy26_inr)} saved (${t.savings_vs_fy26_pct}%) · **Lines:** ${t.lines_awarded}/${t.lines_total} · **Vendors:** ${t.vendors_used}`, "",
    "## Split by vendor", "| Vendor | Lines | Annual (₹) | Share |", "|---|---|---|---|", ...m.result.by_vendor.map((v) => `| ${v.vendor} | ${v.lines} | ${v.annual_inr.toLocaleString("en-IN")} | ${v.share_pct}% |`), "",
    "## Risks", ...m.risks.map((r) => `- ${r}`), "", "## Conditions before PO", ...m.conditions.map((r) => `- ${r}`), "", "## Next steps", ...m.next_steps.map((r) => `- ${r}`), "",
    "## Line-by-line allocation", "| Line | Awarded to | Landed ₹/unit | Annual ₹ | Runner-up | Confidence |", "|---|---|---|---|---|---|",
    ...m.result.allocation.map((a) => `| ${a.line_id} | ${a.awarded_to} | ${a.landed_unit_inr} | ${a.annual_inr.toLocaleString("en-IN")} | ${a.runner_up} ${a.runner_up_unit_inr ?? ""} | ${a.confidence} |`), "",
    "## How this was computed", `Question: “${m.question}”`, `Parameters: \`${JSON.stringify(m.params)}\``, `Assumptions: \`${JSON.stringify(m.assumptions)}\``, ...m.result.caveats.map((c) => `- ${c}`)];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md.join("\n")], { type: "text/markdown" }));
  a.download = `${rfxId}_${m.id}_award.md`; a.click();
}

export default function Award({ goAnalyst }: { goAnalyst: () => void }) {
  const { awards, rfx, set } = useStore();
  const [sel, setSel] = useState(awards[0]?.id);
  const m = awards.find((a) => a.id === sel) || awards[0];

  if (!awards.length) return (
    <div className="max-w-3xl">
      <SectionTitle title="Award decision" sub="Turn an analyst scenario into a memo the VP can approve: recommendation, split, risks and conditions, with every figure taken from the computed scenario." />
      <div className="rounded-lg border border-dashed border-line bg-white p-8 text-sm text-ink/70">
        No award memos yet. In <b>Ask the analyst</b>, ask for an award scenario, for example <i>“split it, cheapest per line, only among vendors who cleared the quality questionnaire”</i>. Then click <b>Award this scenario</b> under the answer.
        <div className="mt-4"><Btn kind="primary" onClick={goAnalyst}>Go to the analyst →</Btn></div>
      </div>
    </div>
  );

  const t = m.result.totals;
  const update = (patch: Partial<AwardMemo>) => set({ awards: awards.map((a) => (a.id === m.id ? { ...a, ...patch } : a)) });
  return (
    <div>
      <div className="no-print"><SectionTitle title="Award decision" sub="Every figure in the memo comes from the computed scenario. The narrative is AI-written and checked against those figures."
        right={<div className="flex gap-2"><Btn onClick={() => exportXlsx(m, rfx.id)}>Excel</Btn><Btn onClick={() => exportMd(m, rfx.id)}>Markdown</Btn><Btn onClick={() => window.print()}>Print / PDF</Btn></div>} /></div>
      <div className="grid grid-cols-[240px_1fr] gap-6">
        <div className="no-print space-y-1.5">
          {awards.map((a) => (
            <button key={a.id} onClick={() => setSel(a.id)} className={cx("block w-full rounded-lg border px-3 py-2 text-left text-xs", a.id === m.id ? "border-ink bg-white" : "border-line bg-white/60 hover:bg-white")}>
              <div className="font-medium">{a.id} · {cr(a.result.totals.annual_landed_inr)}</div>
              <div className="mt-0.5 text-ink/60">{a.result.totals.vendors_used} vendor(s) · {new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="mt-1"><Pill tone={a.status === "submitted" ? "blue" : "slate"}>{a.status}</Pill></div>
            </button>
          ))}
          <button onClick={goAnalyst} className="mt-2 text-xs text-ink/60 underline">+ New scenario in the analyst</button>
        </div>

        <article id="memo" className="rounded-xl border border-line bg-white p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs text-ink/50">{rfx.id} · {rfx.buyer.company} · Award memo {m.id} · {new Date(m.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight">{m.title}</h3>
            </div>
            <Pill tone={m.status === "submitted" ? "blue" : "slate"}>{m.status === "submitted" ? "Submitted for approval" : "Draft"}</Pill>
          </div>

          <div className="mt-5 grid grid-cols-4 gap-3">
            {[["Annual landed cost", cr(t.annual_landed_inr)], ["Saving vs last year", `${cr(t.savings_vs_fy26_inr)} (${t.savings_vs_fy26_pct}%)`], ["Lines covered", `${t.lines_awarded} / ${t.lines_total}`], ["Vendors", String(t.vendors_used)]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-paper px-4 py-3"><div className="text-[11px] uppercase tracking-wide text-ink/50">{k}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div></div>
            ))}
          </div>

          <h4 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink/50">Recommendation</h4>
          <p className="mt-1.5 text-[15px] leading-relaxed">{m.recommendation}</p>

          <h4 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink/50">Split by vendor</h4>
          <table className="mt-2 w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-ink/50"><tr><th className="py-1">Vendor</th><th className="text-right">Lines</th><th className="text-right">Annual</th><th className="w-1/3 pl-4">Share</th></tr></thead>
            <tbody>{m.result.by_vendor.map((v) => (
              <tr key={v.vendor} className="border-t border-line/60"><td className="py-1.5">{v.vendor}</td><td className="text-right">{v.lines}</td><td className="text-right">₹{v.annual_inr.toLocaleString("en-IN")}</td>
                <td className="pl-4"><div className="flex items-center gap-2"><div className="h-2 rounded bg-accent" style={{ width: `${v.share_pct}%` }} /><span className="text-xs">{v.share_pct}%</span></div></td></tr>
            ))}</tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-6">
            <div><h4 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Risks</h4><ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{m.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <div><h4 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Conditions before PO</h4><ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{m.conditions.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <h4 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink/50">Next steps</h4><ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">{m.next_steps.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
          </div>

          {m.result.excluded_vendors.length > 0 && (
            <p className="mt-5 text-sm text-ink/70"><b>Not considered:</b> {m.result.excluded_vendors.map((e) => `${e.vendor} (${e.reason})`).join("; ")}.</p>
          )}
          {m.result.uncovered.length > 0 && <p className="mt-1 text-sm text-amber-800"><b>Uncovered lines:</b> {m.result.uncovered.map((u) => u.line_id).join(", ")}</p>}

          <div className="mt-6"><DataTable title="Line-by-line allocation" rows={m.result.allocation} columns={["line_id", "line", "annual_qty", "awarded_to", "landed_unit_inr", "annual_inr", "runner_up", "runner_up_unit_inr", "fy26_unit_inr", "confidence"]} maxH={360} /></div>

          <details className="mt-5 text-xs text-ink/60" open>
            <summary className="cursor-pointer font-medium text-ink/70">How this was computed</summary>
            <div className="mt-2 space-y-1">
              <div>Question: “{m.question}”</div>
              <div>Scenario parameters: <code>{JSON.stringify(Object.fromEntries(Object.entries(m.params).filter(([k]) => k !== "purpose")))}</code></div>
              <div>Buyer assumptions: <code>{JSON.stringify(m.assumptions)}</code></div>
              <ul className="list-disc pl-5">{m.result.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
              <div className={m.numberCheck.unverified.length ? "text-amber-700" : "text-emerald-700"}>{m.numberCheck.unverified.length ? `⚠ Figures in the narrative not found in the scenario: ${m.numberCheck.unverified.join(", ")}` : `✓ All ${m.numberCheck.checked} ₹ figures in the narrative match the computed scenario`}</div>
            </div>
          </details>

          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-line pt-4 text-sm">
            <div><div className="text-xs text-ink/50">Prepared by</div><div className="mt-1">{rfx.buyer.buyer}</div></div>
            <div><div className="text-xs text-ink/50">Approval</div><div className="mt-1">{m.status === "submitted" ? "Awaiting VP Procurement (approval workflow is stubbed)" : "Not yet submitted"}</div></div>
          </div>
          <div className="no-print mt-4 flex gap-2">
            {m.status === "draft" ? <Btn kind="primary" onClick={() => update({ status: "submitted" })}>Submit for approval (stub)</Btn> : <Btn onClick={() => update({ status: "draft" })}>Back to draft</Btn>}
            <Btn kind="danger" onClick={() => { if (confirm("Delete this memo?")) set({ awards: awards.filter((a) => a.id !== m.id) }); }}>Delete</Btn>
          </div>
        </article>
      </div>
    </div>
  );
}
