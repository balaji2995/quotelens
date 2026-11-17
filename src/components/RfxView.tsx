"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore, postJSON, type ChatMsg } from "@/lib/store";
import { applyRfxOps } from "@/lib/rfxOps";
import { Btn, Pill, SectionTitle, Spinner, cx } from "./ui";
import type { Rfx } from "@/lib/types";

const STARTERS = [
  "Review this RFx like a senior buyer. What will cause messy or incomparable quotes?",
  "Add a question asking vendors to declare their kraft paper price index and escalation formula.",
  "Make freight basis explicit: prices must be delivered to Ranjangaon, and freight must be shown separately if not included.",
];

function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => { const t = setInterval(() => setS((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  return <div className="flex items-center justify-between rounded-md bg-paper px-2 py-1.5"><Spinner label="The co-pilot is thinking…" /><span className="text-xs text-ink/50">{s}s · usually 20–40s, a full draft up to 90s</span></div>;
}

export default function RfxView() {
  const { rfx, copilot, vendors, rfxSent, set } = useStore();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);

  async function send(text: string) {
    if (!text.trim()) return;
    const hist = copilot.map((m) => ({ role: m.role, content: m.content }));
    const next: ChatMsg[] = [...copilot, { role: "user", content: text }];
    set({ copilot: next });
    setInput(""); setBusy(true);
    try {
      const r = await postJSON<{ text: string; ops: never[] }>("/api/copilot", { rfx, history: hist, message: text });
      let content = r.text;
      if (r.ops?.length) {
        const { rfx: updated, log } = applyRfxOps(useStore.getState().rfx, r.ops);
        set({ rfx: updated });
        setFlash(log);
        content += `\n\n_Applied: ${log.join(" · ")}_`;
      }
      set({ copilot: [...next, { role: "assistant", content }] });
    } catch (e) {
      set({ copilot: [...next, { role: "assistant", content: "", error: String((e as Error).message) }] });
    } finally { setBusy(false); }
  }

  function startBlank() {
    if (!confirm("Start a blank RFx and draft it with the co-pilot? The demo's vendor responses were written against the current RFx, so use 'Reset demo' afterwards to get back.")) return;
    const blank: Rfx = { ...rfx, id: "RFQ-DRAFT", title: "New RFx (draft)", scope: "", lines: [], questionnaire: [], terms: {} };
    set({ rfx: blank, copilot: [], rfxSent: false });
  }

  return (
    <div>
      <SectionTitle title="Draft the RFx with a co-pilot"
        sub="Talk the RFx into existence. The co-pilot asks the questions that prevent messy quotes later and edits the structured RFx directly. Every line is something a vendor can price without guessing."
        right={<div className="flex gap-2"><Btn kind="ghost" onClick={startBlank}>Start blank</Btn><Btn kind="primary" onClick={() => setShowSend(true)}>{rfxSent ? "View sent RFx" : "Send to vendors"}</Btn></div>} />
      <div className="grid grid-cols-[380px_1fr] gap-6">
        {/* co-pilot */}
        <div className="sticky top-6 flex h-[calc(100vh-140px)] flex-col rounded-lg border border-line bg-white">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-sm font-medium"><span>Co-pilot</span>{copilot.length > 0 && <Btn small kind="ghost" onClick={() => set({ copilot: [] })}>Clear</Btn>}</div>
          <div className="flex-1 space-y-3 overflow-auto p-3 text-sm">
            {!copilot.length && (
              <div className="space-y-2">
                <p className="text-ink/60">Describe what you need to buy, or ask for a review of the current draft.</p>
                {STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-md border border-line px-2.5 py-2 text-left text-[13px] hover:bg-paper">{s}</button>)}
              </div>
            )}
            {copilot.map((m, i) => (
              <div key={i} className={cx(m.role === "user" ? "ml-6 rounded-lg bg-ink px-3 py-2 text-white" : "prose-answer")}>
                {m.error ? <span className="text-red-700">Error: {m.error}</span> : m.role === "user" ? m.content : <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>}
              </div>
            ))}
            {busy && <Elapsed />}
          </div>
          {copilot.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto border-t border-line px-2 pt-2">
              {STARTERS.map((s) => <button key={s} disabled={busy} onClick={() => send(s)} title={s} className="shrink-0 rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-ink/70 hover:text-ink disabled:opacity-40">{s.length > 48 ? s.slice(0, 46) + "…" : s}</button>)}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-2">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="e.g. We need 30 corrugated SKUs for the Ranjangaon plant…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              className="w-full resize-none rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-ink/40" />
          </form>
        </div>

        {/* document */}
        <div className="space-y-5">
          {flash.length > 0 && <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Co-pilot applied: {flash.join(" · ")}</div>}
          <div className="rounded-lg border border-line bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-ink/50">{rfx.id} · {rfx.category}</div>
                <h3 className="text-xl font-semibold tracking-tight">{rfx.title}</h3>
                <div className="mt-1 text-sm text-ink/60">{rfx.buyer.company} · {rfx.buyer.plant} · Issued {rfx.issue_date} · Due {rfx.due_date}</div>
              </div>
              {rfxSent && <Pill tone="emerald">Sent to {vendors.length} vendors</Pill>}
            </div>
            <p className="mt-3 text-sm leading-relaxed">{rfx.scope}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
              {Object.entries(rfx.terms).map(([k, v]) => (
                <div key={k} className="flex gap-2 border-t border-line/60 py-1"><span className="w-36 shrink-0 capitalize text-ink/50">{k.replace(/_/g, " ")}</span><span>{v}</span></div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-4 py-2 text-sm font-medium">Line items <span className="font-normal text-ink/50">({rfx.lines.length})</span></div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 bg-paper text-left text-ink/60">
                  <tr><th className="px-3 py-1.5">Line</th><th className="px-3 py-1.5">Description</th><th className="px-3 py-1.5">Board</th><th className="px-3 py-1.5">UoM</th><th className="px-3 py-1.5 text-right">Annual qty</th><th className="px-3 py-1.5 text-right">Ref. weight</th></tr>
                </thead>
                <tbody>
                  {rfx.lines.map((l) => (
                    <tr key={l.id} className="border-t border-line/60">
                      <td className="px-3 py-1.5 font-mono text-ink/60">{l.id}</td>
                      <td className="px-3 py-1.5">{l.description}</td>
                      <td className="px-3 py-1.5 text-ink/60">{l.board}</td>
                      <td className="px-3 py-1.5">{l.uom}</td>
                      <td className="px-3 py-1.5 text-right">{l.annual_qty.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-1.5 text-right">{l.spec_weight_g ? `${l.spec_weight_g} g` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-white">
            <div className="border-b border-line px-4 py-2 text-sm font-medium">Supplier questionnaire</div>
            <div className="divide-y divide-line/60">
              {rfx.questionnaire.map((q) => (
                <div key={q.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                  <span className="w-8 shrink-0 font-mono text-xs text-ink/50">{q.id}</span>
                  <span className="flex-1">{q.text}<span className="ml-2 text-xs text-ink/50">Requirement: {q.requirement}</span></span>
                  {q.knockout && <Pill tone="red">Knockout</Pill>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={() => setShowSend(false)}>
          <div className="max-h-[85vh] w-[720px] overflow-auto rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="font-semibold">Outbox <span className="text-xs font-normal text-ink/50">(email channel is stubbed for the demo; nothing leaves this app)</span></h3><Btn small kind="ghost" onClick={() => setShowSend(false)}>Close</Btn></div>
            <div className="mt-3 space-y-3">
              {vendors.map((v) => (
                <div key={v.id} className="rounded-md border border-line p-3 text-sm">
                  <div className="text-xs text-ink/50">To: {v.contact}, {v.name} · Subject: {rfx.id} — {rfx.title}</div>
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed">{`Dear ${v.contact.split(" ")[0]},\n\nNavika Foods invites your quotation for ${rfx.lines.length} corrugated packaging items for our ${rfx.buyer.plant} plant (${rfx.terms.contract_period ?? "CY2027"}). The line-item schedule and supplier questionnaire are attached. Please quote per unit of measure, ex-GST, delivered to plant, by ${rfx.due_date}.\n\nReply in whatever format is convenient — our system reads spreadsheets, PDFs, documents, photos and plain email.\n\nRegards,\n${rfx.buyer.buyer}`}</p>
                </div>
              ))}
            </div>
            {!rfxSent && <div className="mt-4 flex justify-end"><Btn kind="primary" onClick={() => { set({ rfxSent: true }); setShowSend(false); }}>Mark as sent</Btn></div>}
          </div>
        </div>
      )}
    </div>
  );
}
