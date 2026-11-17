"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore, postJSON, leanLayers, type ChatMsg } from "@/lib/store";
import type { AwardMemo, AwardScenario, Display, TraceStep } from "@/lib/server/analyst-types";
import { Btn, DataTable, SectionTitle, Spinner, cx, prettyCol, fmtCell } from "./ui";

const SUGGESTED = [
  "Who didn't quote everything, and what exactly is missing?",
  "What if we split it, cheapest per line, but only among vendors who cleared the quality questionnaire?",
  "Same split, but include vendors who are only unverified (not failed). What's the prize for chasing their answers?",
  "Show landed cost by vendor for the lines everyone quoted, as a chart.",
  "Cap any single vendor at 40% of spend. What does that cost us vs the cheapest split?",
  "Which numbers are you least sure about, and how much spend rides on them?",
  "Draft a one-paragraph award recommendation I can send to my VP, with the risks.",
];
const COLORS = ["#0f6e5c", "#3b6fb6", "#c07a1c", "#8a4fb0", "#b8433f", "#5b6770"];

export default function Analyst({ goAward }: { goAward?: () => void }) {
  const { analyst, set, rfx, vendors, history, layers, assumptions, overrides } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [analyst.length, busy]);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    const hist = analyst.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    const next: ChatMsg[] = [...analyst, { role: "user", content: q }];
    set({ analyst: next }); setInput(""); setBusy(true);
    const t0 = Date.now();
    try {
      const r = await postJSON<{ answer: string; displays: Display[]; trace: TraceStep[]; numberCheck: ChatMsg["numberCheck"]; awards: AwardScenario[] }>("/api/analyst", { question: q, history: hist, rfx, vendors, hist: history, layers: leanLayers(layers), assumptions, overrides });
      set({ analyst: [...next, { role: "assistant", content: r.answer, displays: r.displays, trace: r.trace, numberCheck: r.numberCheck, ms: Date.now() - t0, awards: r.awards, question: q }] });
    } catch (e) {
      set({ analyst: [...next, { role: "assistant", content: "", error: String((e as Error).message) }] });
    } finally { setBusy(false); }
  }

  function exportMemo() {
    const md = [`# ${rfx.id} — analysis log`, `_${new Date().toLocaleString("en-IN")} · assumptions: FX ₹${assumptions.fx_usd_inr}/USD, freight-at-actuals ${assumptions.freight_at_actuals_pct}%_`, ""];
    for (const m of analyst) {
      if (m.role === "user") md.push(`## Q: ${m.content}`, "");
      else {
        md.push(m.content || `_error: ${m.error}_`, "");
        for (const d of m.displays || []) {
          md.push(`**${d.title}**`, "", `| ${d.columns.map(prettyCol).join(" | ")} |`, `|${d.columns.map(() => "---").join("|")}|`);
          for (const r of d.rows.slice(0, 60)) md.push(`| ${d.columns.map((c) => fmtCell(r[c], c)).join(" | ")} |`);
          md.push("");
        }
        if (m.trace?.length) md.push(`<sub>Computed via: ${m.trace.map((t) => `${t.tool} (${t.summary})`).join("; ")}</sub>`, "");
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md.join("\n")], { type: "text/markdown" }));
    a.download = `${rfx.id}_analysis.md`; a.click();
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <SectionTitle title="Ask the analyst"
        sub="Plain-language questions over the normalized comparison. The model plans the analysis, but every figure comes from deterministic tools (query, award optimiser, calculator). Each answer shows its working, and any ₹ figure that can't be traced back to a tool result gets flagged."
        right={<div className="flex gap-2">{analyst.length > 0 && <><Btn onClick={exportMemo}>Export log (.md)</Btn><Btn kind="ghost" onClick={() => set({ analyst: [] })}>Clear</Btn></>}</div>} />
      <div className="space-y-5 pb-40">
        {!analyst.length && (
          <div className="grid grid-cols-2 gap-2">
            {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-lg border border-line bg-white px-3 py-2.5 text-left text-sm hover:border-ink/30">{s}</button>)}
          </div>
        )}
        {analyst.map((m, i) => m.role === "user"
          ? <div key={i} className="ml-auto max-w-[75%] rounded-xl bg-ink px-4 py-2.5 text-sm text-white">{m.content}</div>
          : <Answer key={i} m={m} goAward={goAward} />)}
        {busy && <div className="rounded-lg border border-line bg-white p-4"><Progress /></div>}
        <div ref={endRef} />
      </div>
      <div className="fixed bottom-0 left-60 right-0 border-t border-line bg-paper/95 px-8 py-3 backdrop-blur">
        <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="mx-auto flex max-w-[1100px] gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything about the bids… e.g. “What do we lose if we drop Deccan?”" className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink/40" />
          <Btn kind="primary" type="submit" disabled={busy || !input.trim()}>Ask</Btn>
        </form>
        {analyst.length > 0 && <div className="mx-auto mt-2 flex max-w-[1100px] gap-1.5 overflow-x-auto">{SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy} className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink">{s.length > 60 ? s.slice(0, 58) + "…" : s}</button>)}</div>}
      </div>
    </div>
  );
}

function describe(p: Record<string, unknown>) {
  const qa = (p.qa_allowed as string[] | undefined) || ["pass"];
  const parts = [qa.length === 1 && qa[0] === "pass" ? "QA-cleared only" : `QA: ${qa.join(" + ")}`];
  if ((p.exclude_vendors as string[] | undefined)?.length) parts.push(`excl. ${(p.exclude_vendors as string[]).join(", ")}`);
  if ((p.include_vendors as string[] | undefined)?.length) parts.push(`only ${(p.include_vendors as string[]).join(", ")}`);
  if (p.max_share_pct) parts.push(`cap ${p.max_share_pct}%`);
  if (p.max_vendors) parts.push(`max ${p.max_vendors} vendors`);
  return parts.join(", ");
}

function Progress() {
  const steps = ["Reading the question…", "Querying the comparison data…", "Running award scenarios in code…", "Cross-checking numbers against tool results…", "Writing up the answer and caveats…"];
  const [i, setI] = useState(0);
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => { setSec((s) => s + 1); }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setI(Math.min(steps.length - 1, Math.floor(sec / 7))); }, [sec, steps.length]);
  return <div className="flex items-center justify-between"><Spinner label={steps[i]} /><span className="text-xs text-ink/40">{sec}s · usually 20–50s</span></div>;
}

function Answer({ m, goAward }: { m: ChatMsg; goAward?: () => void }) {
  const [showTrace, setShowTrace] = useState(false);
  const [memoBusy, setMemoBusy] = useState("");
  const [memoErr, setMemoErr] = useState("");
  const st = useStore();
  async function makeMemo(a: AwardScenario) {
    setMemoBusy(a.result_id); setMemoErr("");
    try {
      const r = await postJSON<Omit<AwardMemo, "id" | "created_at" | "question" | "params" | "result" | "assumptions" | "status">>("/api/memo", { rfx: st.rfx, question: m.question, params: a.params, result: a.result, assumptions: st.assumptions });
      const memo: AwardMemo = { ...r, id: `AW-${Date.now().toString().slice(-6)}`, created_at: new Date().toISOString(), question: m.question || "", params: a.params, result: a.result, assumptions: { ...st.assumptions }, status: "draft" };
      st.set({ awards: [memo, ...useStore.getState().awards] });
      goAward?.();
    } catch (e) { setMemoErr(String((e as Error).message)); } finally { setMemoBusy(""); }
  }
  if (m.error) return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Error: {m.error}</div>;
  const nc = m.numberCheck;
  return (
    <div className="space-y-3 rounded-xl border border-line bg-white p-5">
      <div className="prose-answer text-[14px]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>
      {m.displays?.map((d, i) => <DisplayView key={i} d={d} />)}
      {m.awards && m.awards.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="mb-2 text-xs font-medium text-emerald-900">Award scenario{m.awards.length > 1 ? "s" : ""} computed in this answer: turn one into a memo for approval</div>
          <div className="flex flex-wrap gap-2">
            {m.awards.map((a) => (
              <Btn key={a.result_id} kind="primary" small disabled={!!memoBusy} onClick={() => makeMemo(a)}>
                {memoBusy === a.result_id ? "Writing memo…" : `Award this scenario (${describe(a.params)}): ₹${(a.result.totals.annual_landed_inr / 1e7).toFixed(2)} cr · ${a.result.totals.vendors_used} vendor${a.result.totals.vendors_used > 1 ? "s" : ""} · ${a.result.totals.lines_awarded}/${a.result.totals.lines_total} lines`}
              </Btn>
            ))}
          </div>
          {memoErr && <div className="mt-2 text-xs text-red-700">{memoErr}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2 text-[11px] text-ink/50">
        {nc && (nc.unverified.length === 0
          ? <span className="text-emerald-700">✓ {nc.checked} ₹ figure{nc.checked === 1 ? "" : "s"} traced to tool results</span>
          : <span className="text-amber-700">⚠ Not traceable to a tool result: {nc.unverified.join(", ")}</span>)}
        {m.ms && <span>{(m.ms / 1000).toFixed(0)} s</span>}
        {m.trace?.length ? <button onClick={() => setShowTrace(!showTrace)} className="underline">{showTrace ? "Hide" : "Show"} how this was computed ({m.trace.length} steps)</button> : null}
      </div>
      {showTrace && (
        <ol className="space-y-1.5 rounded-md bg-paper p-3 text-[11.5px]">
          {m.trace!.map((t, i) => (
            <li key={i}><span className="font-mono font-medium">{t.tool}</span> <span className="text-ink/60">→ {t.summary}</span>
              <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap font-mono text-[10.5px] text-ink/50">{JSON.stringify(t.input)}</pre></li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DisplayView({ d }: { d: Display }) {
  if (d.as === "table" || !d.x || !d.y?.length) return <DataTable rows={d.rows} columns={d.columns} title={d.title} />;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 text-sm font-medium">{d.title}</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={d.rows as Record<string, number | string>[]} margin={{ left: 20, right: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e1d8" vertical={false} />
            <XAxis dataKey={d.x} tick={{ fontSize: 11 }} interval={0} angle={d.rows.length > 6 ? -25 : 0} textAnchor={d.rows.length > 6 ? "end" : "middle"} height={d.rows.length > 6 ? 70 : 30} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}cr` : v >= 1e5 ? `${(v / 1e5).toFixed(0)}L` : String(v))} />
            <Tooltip formatter={(v, n) => [fmtCell(v, String(n)), prettyCol(String(n))]} />
            {d.y.length > 1 && <Legend formatter={(v: string) => prettyCol(v)} wrapperStyle={{ fontSize: 11 }} />}
            {d.y.map((y, i) => <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} stackId={d.as === "stacked_bar" ? "s" : undefined} radius={d.as === "stacked_bar" ? 0 : [3, 3, 0, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {d.note && <div className="mt-1 text-xs text-ink/50">{d.note}</div>}
      <details className="mt-2 text-xs"><summary className={cx("cursor-pointer text-ink/50")}>Data</summary><div className="mt-2"><DataTable rows={d.rows} columns={d.columns} title={d.title} maxH={240} /></div></details>
    </div>
  );
}
