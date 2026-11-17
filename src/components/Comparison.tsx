"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { crore, inr } from "@/lib/normalize";
import type { Cell } from "@/lib/types";
import { Btn, ConfDot, Pill, QaBadge, SectionTitle, cx, exportRows, useNormalized } from "./ui";

export default function Comparison({ goClarify }: { goClarify: () => void }) {
  const { rfx, history, assumptions, set, inbox } = useStore();
  const { cells, summaries } = useNormalized();
  const [sel, setSel] = useState<Cell | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [bestScope, setBestScope] = useState<"cleared" | "all">("all");
  const vendors = summaries;
  const cell = (v: string, l: string) => cells.find((c) => c.vendor_id === v && c.line_id === l)!;

  const best = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const l of rfx.lines) {
      const cands = cells.filter((c) => c.line_id === l.id && c.status === "quoted" && c.landed_inr != null && (bestScope === "all" || summaries.find((s) => s.vendor_id === c.vendor_id)?.qa_status === "pass"));
      cands.sort((a, b) => a.landed_inr! - b.landed_inr!);
      m[l.id] = cands[0]?.vendor_id ?? null;
    }
    return m;
  }, [cells, rfx.lines, bestScope, summaries]);

  const lines = rfx.lines.filter((l) => !onlyIssues || vendors.some((v) => { const c = cell(v.vendor_id, l.id); return c && (c.status !== "quoted" || c.confidence !== "high"); }));
  const fileFor = (vid: string) => inbox.find((i) => i.vendor_id === vid)?.files.find((f) => f.role === "quote");

  function exportGrid() {
    const rows = rfx.lines.map((l) => {
      const r: Record<string, string | number | null> = { line_id: l.id, line: l.description, uom: l.uom, annual_qty: l.annual_qty, fy26_price_inr: history.prices[l.id] ?? null };
      for (const v of vendors) { const c = cell(v.vendor_id, l.id); r[`${v.name} landed_inr`] = c?.landed_inr ?? null; r[`${v.name} status`] = c ? `${c.status}/${c.confidence}` : null; }
      return r;
    });
    exportRows(rows, Object.keys(rows[0]), `${rfx.id}_comparison`, "xlsx");
  }

  return (
    <div>
      <SectionTitle title="Side-by-side comparison"
        sub={<>Every cell shows the landed price per RFx unit, ex-GST, in ₹: quoted price, converted to RFx units, plus printing and freight, minus discounts. Click any cell to see where the number came from and each step that produced it.</>}
        right={<div className="flex gap-2"><Btn onClick={exportGrid}>Export Excel</Btn><Btn kind="primary" onClick={goClarify}>Resolve open points →</Btn></div>} />

      {/* assumptions */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-ink/50">Buyer assumptions</span>
        <label className="flex items-center gap-2">FX ₹/USD <input type="number" step="0.1" value={assumptions.fx_usd_inr} onChange={(e) => { const v = +e.target.value; if (v > 0 && v < 1000) set({ assumptions: { ...assumptions, fx_usd_inr: v } }); }} className="w-20 rounded border border-line px-1.5 py-0.5 text-right tabular-nums" /></label>
        <label className="flex items-center gap-2">Freight when “at actuals” / unstated <input type="number" step="0.5" value={assumptions.freight_at_actuals_pct} onChange={(e) => { const v = +e.target.value; if (v >= 0 && v <= 30) set({ assumptions: { ...assumptions, freight_at_actuals_pct: v } }); }} className="w-14 rounded border border-line px-1.5 py-0.5 text-right tabular-nums" />%</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={assumptions.apply_conditional_discounts} onChange={(e) => set({ assumptions: { ...assumptions, apply_conditional_discounts: e.target.checked } })} />Apply conditional discounts when met</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={assumptions.accept_spec_deviations} onChange={(e) => set({ assumptions: { ...assumptions, accept_spec_deviations: e.target.checked } })} />Treat alternate specs as comparable</label>
      </div>

      {/* vendor cards */}
      <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${vendors.length}, minmax(0,1fr))` }}>
        {vendors.map((v) => (
          <div key={v.vendor_id} className="rounded-lg border border-line bg-white p-3 text-xs">
            <div className="flex items-start justify-between gap-2"><div className="text-sm font-medium leading-tight">{v.name}</div><QaBadge v={v.qa_status} /></div>
            <div className="mt-2 space-y-0.5 text-ink/70">
              <div><b className="text-ink">{v.lines_quoted}</b>/{rfx.lines.length} lines comparable{v.lines_deviation.length ? ` · ${v.lines_deviation.length} alt-spec` : ""}{v.lines_missing.length ? ` · ${v.lines_missing.length} missing` : ""}</div>
              <div>Quoted lines: <b className="text-ink">{crore(v.total_landed_quoted_inr)}</b>/yr landed</div>
              <div className="truncate" title={v.freight_text}>Freight: {v.freight_text}</div>
              <div className="truncate" title={v.discount_text}>Discount: {v.discount_text}</div>
              <div>Payment: {v.payment_days ?? "—"} days{v.payment_days != null && v.payment_days < 60 ? <span className="text-amber-700"> (asked 60)</span> : ""}</div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {v.low_conf_cells > 0 && <Pill tone="amber">{v.low_conf_cells} low-confidence</Pill>}
              {v.suspicious.length > 0 && <Pill tone="red" >⚠ AI-directed text</Pill>}
              {v.unmatched_items?.length > 0 && <span title={v.unmatched_items.join("\n")}><Pill tone="amber">{v.unmatched_items.length} unmatched item{v.unmatched_items.length > 1 ? "s" : ""}</Pill></span>}
              {v.validity_days != null && v.validity_days < 90 && <Pill tone="amber">valid {v.validity_days} days</Pill>}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex items-center gap-4 text-xs text-ink/60">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Only lines needing attention</label>
        <label className="flex items-center gap-1.5">Highlight cheapest among
          <select value={bestScope} onChange={(e) => setBestScope(e.target.value as "all" | "cleared")} className="rounded border border-line px-1 py-0.5"><option value="all">all comparable offers</option><option value="cleared">QA-cleared vendors only</option></select></label>
        <span className="ml-auto flex items-center gap-3"><span className="flex items-center gap-1"><ConfDot c="high" />high</span><span className="flex items-center gap-1"><ConfDot c="medium" />medium</span><span className="flex items-center gap-1"><ConfDot c="low" />low</span><span>≈ assumption applied</span><span className="text-violet-700">alt spec</span></span>
      </div>

      {/* grid */}
      <div className="overflow-auto rounded-lg border border-line bg-white" style={{ maxHeight: "62vh" }}>
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-paper text-ink/60">
            <tr>
              <th className="sticky left-0 bg-paper px-3 py-2 text-left font-medium">Line</th>
              <th className="px-2 py-2 text-left font-medium">Item</th>
              <th className="px-2 py-2 text-right font-medium">Qty / yr</th>
              <th className="px-2 py-2 text-right font-medium">FY26 ₹</th>
              {vendors.map((v) => <th key={v.vendor_id} className="min-w-[112px] px-2 py-2 text-right font-medium">{v.name.split(" ").slice(0, 2).join(" ")}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-line/60">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-mono text-ink/50">{l.id}</td>
                <td className="max-w-[300px] truncate px-2 py-1.5" title={l.description}>{l.description} <span className="text-ink/40">/{l.uom}</span></td>
                <td className="px-2 py-1.5 text-right text-ink/60">{l.annual_qty.toLocaleString("en-IN")}</td>
                <td className="px-2 py-1.5 text-right text-ink/50">{history.prices[l.id]?.toFixed(2)}</td>
                {vendors.map((v) => {
                  const c = cell(v.vendor_id, l.id);
                  const isBest = best[l.id] === v.vendor_id;
                  const assumed = c?.flags.some((f) => /assum|Derived|Resolved from|converted|spec weight/i.test(f));
                  return (
                    <td key={v.vendor_id} onClick={() => c && setSel(c)}
                      className={cx("cursor-pointer px-2 py-1.5 text-right hover:outline hover:outline-1 hover:outline-ink/30",
                        c?.confidence === "low" && c.status !== "missing" && "bg-amber-50", sel === c && "outline outline-2 outline-ink")}>
                      {!c || c.status === "missing" ? <span className="text-ink/25">—</span>
                        : c.status === "unresolved" ? <span className="font-medium text-red-600">? unresolved</span>
                        : <span className={cx("inline-flex items-center justify-end gap-1.5", c.status === "deviation" && "italic text-violet-700", isBest && "font-semibold text-emerald-700")}>
                            {assumed && <span className="text-ink/40">≈</span>}{c.landed_inr?.toFixed(2)}{c.status === "deviation" && <span className="text-[9px]">alt</span>}<ConfDot c={c.confidence} />
                          </span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="sticky bottom-0 border-t-2 border-line bg-paper font-medium">
              <td className="sticky left-0 bg-paper px-3 py-2" colSpan={4}>Annual landed, comparable lines only</td>
              {vendors.map((v) => <td key={v.vendor_id} className="px-2 py-2 text-right">{crore(v.total_landed_quoted_inr)}<div className="text-[10px] font-normal text-ink/50">{v.lines_quoted} lines</div></td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <Documents />
      <Questionnaire />
      {sel && <CellDrawer cell={sel} onClose={() => setSel(null)} file={fileFor(sel.vendor_id)?.url} />}
    </div>
  );
}

function Documents() {
  const { inbox, layers, vendors, assumptions } = useStore();
  return (
    <div className="mt-6 rounded-lg border border-line bg-white">
      <div className="border-b border-line px-4 py-2 text-sm font-medium">Documents & attachments <span className="font-normal text-ink/50">— what each vendor sent, and what the system found in it</span></div>
      <div className="grid gap-px bg-line" style={{ gridTemplateColumns: `repeat(${vendors.filter((v) => layers[v.id]).length}, minmax(0,1fr))` }}>
        {vendors.filter((v) => layers[v.id]).map((v) => {
          const item = inbox.find((i) => i.vendor_id === v.id);
          const ls = layers[v.id] || [];
          const docs = ls.flatMap((l) => l.extraction.documents || []);
          const clar = ls.filter((l) => l.kind === "clarification");
          return (
            <div key={v.id} className="bg-white p-3 text-xs">
              <div className="mb-2 font-medium">{v.name}</div>
              <div className="space-y-1">
                {item?.files.map((f) => (
                  <a key={f.name} href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:underline">
                    <span className="rounded bg-ink/80 px-1 text-[9px] font-semibold text-white">{f.kind.toUpperCase().slice(0, 4)}</span>
                    <span className="truncate" title={f.name}>{f.role === "quote" ? "Quote" : "Attachment"}: {f.name}</span>
                  </a>
                ))}
                {clar.map((l) => <div key={l.id} className="flex items-center gap-1.5 text-ink/70"><span className="rounded bg-sky-700 px-1 text-[9px] font-semibold text-white">MAIL</span>{l.label}</div>)}
              </div>
              {docs.length > 0 && (
                <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
                  {docs.map((d, i) => {
                    const expired = d.valid_until && d.valid_until < assumptions.contract_start;
                    return (
                      <div key={i}>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-medium">{d.doc_type === "iso_certificate" ? "ISO 9001 certificate" : d.doc_type === "test_report" ? "Test report" : d.document}</span>
                          {d.valid_until && <Pill tone={expired ? "red" : "emerald"}>{expired ? "expired" : "valid"} {d.valid_until}</Pill>}
                        </div>
                        <div className="text-ink/60">{d.finding}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!docs.length && <div className="mt-2 border-t border-line/60 pt-2 text-ink/40">No certificates or reports attached</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Questionnaire() {
  const { rfx } = useStore();
  const { summaries } = useNormalized();
  const ko = rfx.questionnaire.filter((q) => q.knockout);
  return (
    <div className="mt-6 rounded-lg border border-line bg-white">
      <div className="border-b border-line px-4 py-2 text-sm font-medium">Quality knockouts <span className="font-normal text-ink/50">— a vendor is “QA-cleared” only if every knockout passes. “Unverified” means we don't know yet; it is not a fail.</span></div>
      <table className="w-full text-xs">
        <thead className="text-left text-ink/50"><tr><th className="px-4 py-1.5 font-medium">Vendor</th>{ko.map((q) => <th key={q.id} className="px-3 py-1.5 font-medium">{q.id}: {q.text.split("?")[0].slice(0, 46)}…</th>)}</tr></thead>
        <tbody>
          {summaries.map((s) => (
            <tr key={s.vendor_id} className="border-t border-line/60 align-top">
              <td className="px-4 py-2 font-medium">{s.name}<div className="mt-1"><QaBadge v={s.qa_status} /></div></td>
              {ko.map((q) => { const d = s.qa_detail.find((x) => x.qid === q.id); return <td key={q.id} className="px-3 py-2"><QaBadge v={d?.verdict ?? "unverified"}>{d?.verdict}</QaBadge><div className="mt-1 text-ink/60">{d?.why}</div></td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellDrawer({ cell, onClose, file }: { cell: Cell; onClose: () => void; file?: string }) {
  const { rfx, vendors, overrides, set } = useStore();
  const l = rfx.lines.find((x) => x.id === cell.line_id)!;
  const v = vendors.find((x) => x.id === cell.vendor_id)!;
  const [val, setVal] = useState(cell.landed_inr?.toString() ?? "");
  const [note, setNote] = useState("");
  const isImg = file && /\.(jpe?g|png)$/i.test(file);
  return (
    <div className="fixed inset-y-0 right-0 z-40 w-[460px] overflow-auto border-l border-line bg-white shadow-2xl">
      <div className="sticky top-0 flex items-start justify-between border-b border-line bg-white px-5 py-3">
        <div><div className="text-xs text-ink/50">{v.name} · {l.id}</div><div className="text-sm font-medium">{l.description}</div></div>
        <Btn small kind="ghost" onClick={onClose}>✕</Btn>
      </div>
      <div className="space-y-5 p-5 text-sm">
        <div className="flex items-end justify-between">
          <div><div className="text-xs text-ink/50">Landed price per {l.uom} (ex-GST)</div><div className="text-3xl font-semibold tabular-nums">{cell.landed_inr != null ? inr(cell.landed_inr) : "—"}</div>
            {cell.annual_landed_inr != null && <div className="text-xs text-ink/50">× {l.annual_qty.toLocaleString("en-IN")} = {crore(cell.annual_landed_inr)}/yr</div>}</div>
          <div className="text-right"><Pill tone={cell.status === "quoted" ? "emerald" : cell.status === "deviation" ? "violet" : cell.status === "missing" ? "slate" : "red"}>{cell.status}</Pill><div className="mt-1 flex items-center justify-end gap-1.5 text-xs"><ConfDot c={cell.confidence} />{cell.confidence} confidence</div></div>
        </div>
        {cell.source && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">Where it came from</div>
            <blockquote className="rounded-md border-l-4 border-accent bg-paper px-3 py-2 font-mono text-[12px] leading-relaxed">“{cell.source.quote}”</blockquote>
            <div className="mt-1 text-xs text-ink/50">{cell.source.location} · {cell.source.layer}</div>
            {isImg && <a href={file} target="_blank" rel="noreferrer"><img src={file} alt="source" className="mt-2 max-h-56 rounded border border-line" /></a>}
          </div>
        )}
        {cell.steps.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">How the number was built (deterministic)</div>
            <ol className="space-y-1">
              {cell.steps.map((s, i) => <li key={i} className="flex justify-between gap-3 border-b border-line/50 pb-1 text-[13px]"><span>{s.label}</span>{s.value != null && <span className="shrink-0 tabular-nums text-ink/70">{s.value.toFixed(2)}</span>}</li>)}
            </ol>
          </div>
        )}
        {cell.flags.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">What to know</div>
            <ul className="space-y-1">{cell.flags.map((f, i) => <li key={i} className="rounded bg-amber-50 px-2 py-1 text-[12.5px] text-amber-900">{f}</li>)}</ul>
          </div>
        )}
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/50">Buyer override</div>
          <p className="mb-2 text-xs text-ink/60">If you've confirmed the price another way (a call, a revised quote), set it here. It's logged and shown as an override; the original read is kept.</p>
          <div className="flex gap-2">
            <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="₹ landed / unit (blank = not quoted)" className="w-36 rounded border border-line px-2 py-1 text-sm tabular-nums" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" className="flex-1 rounded border border-line px-2 py-1 text-sm" />
          </div>
          <div className="mt-2 flex gap-2">
            <Btn small kind="primary" disabled={!note.trim()} onClick={() => { set({ overrides: [...overrides.filter((o) => !(o.vendor_id === cell.vendor_id && o.line_id === cell.line_id)), { vendor_id: cell.vendor_id, line_id: cell.line_id, landed_inr: val.trim() ? +val : null, note, by: "Buyer" }] }); onClose(); }}>Save override</Btn>
            {cell.overridden && <Btn small kind="danger" onClick={() => { set({ overrides: overrides.filter((o) => !(o.vendor_id === cell.vendor_id && o.line_id === cell.line_id)) }); onClose(); }}>Remove override</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}
