"use client";
import { useState } from "react";
import { useStore, postJSON } from "@/lib/store";
import { normalize } from "@/lib/normalize";
import type { Issue, Layer } from "@/lib/types";
import { Btn, Pill, QaBadge, SectionTitle, Spinner, cx, useNormalized } from "./ui";

const SEV = { blocker: "red", major: "amber", minor: "slate" } as const;

function diff(before: ReturnType<typeof normalize>, after: ReturnType<typeof normalize>, vid: string) {
  const out: string[] = [];
  const sb = before.summaries.find((s) => s.vendor_id === vid), sa = after.summaries.find((s) => s.vendor_id === vid);
  if (sb && sa && sb.qa_status !== sa.qa_status) out.push(`Questionnaire: ${sb.qa_status} → ${sa.qa_status}`);
  for (const c of after.cells.filter((c) => c.vendor_id === vid)) {
    const b = before.cells.find((x) => x.vendor_id === vid && x.line_id === c.line_id)!;
    if (b.landed_inr !== c.landed_inr || b.status !== c.status || b.confidence !== c.confidence) {
      const f = (x: typeof c) => (x.landed_inr != null ? `₹${x.landed_inr.toFixed(2)}` : x.status) + (x.confidence !== "high" && x.landed_inr != null ? ` (${x.confidence})` : "");
      out.push(`${c.line_id}: ${f(b)} → ${f(c)}`);
    }
  }
  if (sb && sa && sb.freight_text !== sa.freight_text) out.push(`Freight: ${sb.freight_text} → ${sa.freight_text}`);
  if (sb && sa && sb.payment_days !== sa.payment_days) out.push(`Payment: ${sb.payment_days ?? "—"} → ${sa.payment_days ?? "—"} days`);
  return out;
}

export default function Clarifications() {
  const { vendors, threads, layers } = useStore();
  const { issues, summaries } = useNormalized();
  const [sel, setSel] = useState<string>(vendors.find((v) => issues.some((i) => i.vendor_id === v.id))?.id || vendors[0].id);
  return (
    <div>
      <SectionTitle title="Clarifications: uncertainty becomes a vendor question"
        sub="The system doesn't ask you to guess. Every gap it found (a missing line, an ambiguous unit, an assumed freight cost, an unanswered knockout, an expired certificate) becomes a precise question to the vendor. The reply is read by the same extraction engine and merged as a new, traceable layer. The original read is never overwritten." />
      <div className="grid grid-cols-[260px_1fr] gap-6">
        <div className="space-y-1.5">
          {vendors.filter((v) => layers[v.id]).map((v) => {
            const n = issues.filter((i) => i.vendor_id === v.id);
            const s = summaries.find((x) => x.vendor_id === v.id);
            const t = threads[v.id];
            return (
              <button key={v.id} onClick={() => setSel(v.id)} className={cx("block w-full rounded-lg border px-3 py-2.5 text-left", sel === v.id ? "border-ink bg-white" : "border-line bg-white/60 hover:bg-white")}>
                <div className="text-sm font-medium">{v.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {s && <QaBadge v={s.qa_status} />}
                  <Pill tone={n.some((i) => i.severity === "blocker") ? "red" : n.length ? "amber" : "emerald"}>{n.length} open</Pill>
                  {t && t.status !== "none" && <Pill tone="blue">{t.status}</Pill>}
                </div>
              </button>
            );
          })}
        </div>
        <VendorThread key={sel} vendorId={sel} issues={issues.filter((i) => i.vendor_id === sel)} />
      </div>
    </div>
  );
}

function VendorThread({ vendorId, issues }: { vendorId: string; issues: Issue[] }) {
  const st = useStore();
  const { rfx, vendors, threads, setThread, addLayer, setLayers } = st;
  const v = vendors.find((x) => x.id === vendorId)!;
  const t = threads[vendorId] || { status: "none" };
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const clarLayers = (st.layers[vendorId] || []).filter((l) => l.kind === "clarification");

  async function draft() {
    setBusy("Drafting a clarification email…"); setErr("");
    try {
      const r = await postJSON<{ subject: string; body: string; internal_note: string }>("/api/clarify", { rfx, vendor: v, issues });
      setThread(vendorId, { status: "drafted", ...r, reply: "", change_summary: [] });
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(""); }
  }
  async function simulate() {
    setBusy(`${v.contact} is replying… (AI role-play of the vendor)`); setErr("");
    try {
      const r = await postJSON<{ reply: string }>("/api/vendor-sim", { vendor: v, email: `Subject: ${t.subject}\n\n${t.body}` });
      setThread(vendorId, { status: "replied", reply: r.reply, reply_simulated: true });
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(""); }
  }
  async function apply() {
    setBusy("Reading the reply and updating the comparison…"); setErr("");
    try {
      const s = useStore.getState();
      const before = normalize(s.rfx, s.vendors, s.history, s.layers, s.assumptions, s.overrides);
      const text = `From: ${v.contact} <${v.name}>\nSubject: Re: ${t.subject}\n\n${t.reply}\n\n--- Our original message ---\n${t.body}`;
      const layer = await postJSON<Layer>("/api/extract", { rfx, vendor_name: v.name, mode: "clarification", issues, files: [{ name: `clarification_reply_${vendorId}.eml`, kind: "email", role: "quote", base64: btoa(unescape(encodeURIComponent(text))) }] });
      addLayer(vendorId, layer);
      const s2 = useStore.getState();
      const after = normalize(s2.rfx, s2.vendors, s2.history, s2.layers, s2.assumptions, s2.overrides);
      setThread(vendorId, { status: "applied", change_summary: diff(before, after, vendorId) });
    } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(""); }
  }
  function undoLast() {
    const ls = st.layers[vendorId] || [];
    const idx = ls.map((l) => l.kind).lastIndexOf("clarification");
    if (idx < 0) return;
    setLayers(vendorId, ls.filter((_, i) => i !== idx));
    setThread(vendorId, { status: "none", change_summary: [] });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <div className="text-sm font-medium">Open points for {v.name} <span className="font-normal text-ink/50">({issues.length}, detected deterministically from the comparison)</span></div>
          {clarLayers.length > 0 && <Btn small kind="ghost" onClick={undoLast}>Undo last clarification</Btn>}
        </div>
        {issues.length === 0 ? <div className="px-4 py-3 text-sm text-emerald-700">Nothing open. This response is fully comparable.</div> : (
          <div className="divide-y divide-line/60">
            {issues.map((i) => (
              <div key={i.id} className="flex gap-3 px-4 py-2 text-sm">
                <div className="w-16 shrink-0"><Pill tone={SEV[i.severity]}>{i.severity}</Pill></div>
                <div className="min-w-0"><div className="font-medium">{i.topic}{i.lines.length > 0 && <span className="ml-2 font-mono text-xs font-normal text-ink/50">{i.lines.slice(0, 12).join(" ")}{i.lines.length > 12 ? " …" : ""}</span>}</div><div className="text-xs text-ink/60">{i.detail}</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
      {busy && <Spinner label={busy} />}

      {!busy && issues.length > 0 && t.status === "none" && <Btn kind="primary" onClick={draft}>Draft clarification email</Btn>}

      {t.status !== "none" && t.body && (
        <div className="rounded-lg border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm font-medium">
            <span>1 · Clarification email <span className="font-normal text-ink/50">— editable; never reveals competitor prices</span></span>
            <span className="flex gap-2">{t.status === "drafted" && <><Btn small kind="ghost" onClick={draft}>Redraft</Btn><Btn small kind="primary" onClick={() => setThread(vendorId, { status: "sent" })}>Send (stub)</Btn></>}{t.status !== "drafted" && <Pill tone="blue">sent</Pill>}</span>
          </div>
          {t.internal_note && <div className="border-b border-line bg-paper px-4 py-1.5 text-xs text-ink/70">Why this matters: {t.internal_note}</div>}
          <div className="p-4">
            <input value={t.subject} disabled={t.status !== "drafted"} onChange={(e) => setThread(vendorId, { subject: e.target.value })} className="mb-2 w-full rounded border border-line px-2 py-1 text-sm font-medium disabled:bg-paper/50" />
            <textarea value={t.body} disabled={t.status !== "drafted"} onChange={(e) => setThread(vendorId, { body: e.target.value })} rows={Math.min(22, (t.body || "").split("\n").length + 2)} className="w-full rounded border border-line px-2 py-1.5 font-mono text-[12.5px] leading-relaxed disabled:bg-paper/50" />
          </div>
        </div>
      )}

      {["sent", "replied", "applied"].includes(t.status) && (
        <div className="rounded-lg border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm font-medium">
            <span>2 · Vendor reply {t.reply_simulated && <span className="ml-1 font-normal text-ink/50">(simulated: an AI plays the vendor, because email is stubbed. You can paste a real reply instead)</span>}</span>
            {t.status === "sent" && <Btn small onClick={simulate}>Simulate vendor reply</Btn>}
          </div>
          <div className="p-4">
            <textarea value={t.reply || ""} disabled={t.status === "applied"} onChange={(e) => setThread(vendorId, { reply: e.target.value, status: e.target.value ? "replied" : "sent", reply_simulated: false })} rows={8} placeholder="Paste the vendor's reply here, or simulate one…" className="w-full rounded border border-line px-2 py-1.5 font-mono text-[12.5px] leading-relaxed disabled:bg-paper/50" />
            {t.status === "replied" && <div className="mt-2"><Btn kind="primary" onClick={apply}>Read reply & update comparison</Btn></div>}
          </div>
        </div>
      )}

      {t.status === "applied" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-sm font-medium text-emerald-900">3 · Merged as a new layer: “{clarLayers.at(-1)?.label}”</div>
          {t.change_summary?.length ? (
            <>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[13px] tabular-nums text-emerald-950">{[...t.change_summary.filter((c) => !/^L\d/.test(c)), ...t.change_summary.filter((c) => /^L\d/.test(c)).slice(0, 12)].map((c, i) => <li key={i}>• {c}</li>)}</ul>
              {t.change_summary.filter((c) => /^L\d/.test(c)).length > 12 && <div className="mt-1 text-xs text-emerald-900/70">+ {t.change_summary.filter((c) => /^L\d/.test(c)).length - 12} more line changes. See the Comparison tab (changed cells show the clarification as their source).</div>}
            </>
          ) : <div className="mt-1 text-sm text-emerald-900">The reply didn't change any number or status.</div>}
          <div className="mt-3 flex gap-2"><Btn small onClick={() => setThread(vendorId, { status: "none", subject: "", body: "", reply: "", change_summary: [] })}>Start another round</Btn></div>
        </div>
      )}
    </div>
  );
}
