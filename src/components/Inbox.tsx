"use client";
import { useRef, useState } from "react";
import { useStore, postJSON } from "@/lib/store";
import type { Layer } from "@/lib/types";
import { Btn, ConfDot, Pill, SectionTitle, Spinner, cx, useNormalized, QaBadge } from "./ui";

export async function urlToBase64(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}
const kindOf = (n: string) => { const s = n.toLowerCase(); return /\.(xlsx|xls|csv)$/.test(s) ? "xlsx" : s.endsWith(".docx") ? "docx" : s.endsWith(".pdf") ? "pdf" : /\.(jpe?g|png|webp)$/.test(s) ? "image" : "email"; };
const ICON: Record<string, string> = { xlsx: "XLS", docx: "DOC", pdf: "PDF", image: "IMG", email: "EML" };

export default function Inbox() {
  const { inbox, vendors, layers, rfx, setLayers, set } = useStore();
  const { summaries } = useNormalized();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function reread(vendorId: string) {
    const item = inbox.find((i) => i.vendor_id === vendorId)!;
    const v = vendors.find((x) => x.id === vendorId)!;
    setBusy((b) => ({ ...b, [vendorId]: true })); setErr((e) => ({ ...e, [vendorId]: "" }));
    try {
      const files = await Promise.all(item.files.map(async (f) => ({ name: f.name, kind: f.kind, role: f.role, base64: await urlToBase64(f.url!) })));
      const layer = await postJSON<Layer>("/api/extract", { rfx, files, vendor_name: v.name, mode: "response" });
      layer.received = item.received;
      const rest = (useStore.getState().layers[vendorId] || []).filter((l) => l.kind !== "response");
      setLayers(vendorId, [layer, ...rest]);
    } catch (e) { setErr((x) => ({ ...x, [vendorId]: String((e as Error).message) })); }
    finally { setBusy((b) => ({ ...b, [vendorId]: false })); }
  }

  return (
    <div>
      <SectionTitle title="Vendor responses"
        sub="Vendors replied however they liked. Each response is read by the model, mapped to RFx lines, then checked: quotes are matched back to the source text, and photos are read twice independently. Re-run any read live, or drop in a new file."
        right={<UploadButton onDone={(vid) => setOpen(vid)} />} />
      <div className="space-y-3">
        {inbox.map((item) => {
          const v = vendors.find((x) => x.id === item.vendor_id)!;
          const ls = layers[item.vendor_id] || [];
          const base = ls.find((l) => l.kind === "response");
          const s = summaries.find((x) => x.vendor_id === item.vendor_id);
          const e = base?.extraction;
          return (
            <div key={item.vendor_id} className="rounded-lg border border-line bg-white">
              <div className="flex items-start gap-4 p-4">
                <div className="w-64 shrink-0">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-ink/50">{v.city} · {v.contact}</div>
                  <div className="mt-1 text-xs text-ink/60">Received {item.received} via {item.channel}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.files.map((f) => (
                      <button key={f.name} onClick={() => setPreview(f.url!)} title={f.name}
                        className="inline-flex items-center gap-1.5 rounded border border-line px-1.5 py-1 text-[11px] hover:bg-paper">
                        <span className="rounded bg-ink/80 px-1 text-[9px] font-semibold text-white">{ICON[f.kind] || "FILE"}</span>
                        <span className="max-w-[150px] truncate">{f.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  {busy[item.vendor_id] ? <Spinner label="Reading the response with the model… (30–60 s)" /> : base ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        {s && <QaBadge v={s.qa_status} />}
                        <Pill>{e!.lines.filter((l) => l.rfx_line_id).length} line prices</Pill>
                        {e!.rate_rules.length > 0 && <Pill tone="blue">{e!.rate_rules.length} rate rule{e!.rate_rules.length > 1 ? "s" : ""}</Pill>}
                        <Pill>{e!.questionnaire.length}/10 questions answered</Pill>
                        {e!.currency_detected !== "INR" && <Pill tone="amber">Currency {e!.currency_detected}</Pill>}
                        {e!.suspicious_content.length > 0 && <Pill tone="red">⚠ Instruction to AI detected — ignored</Pill>}
                        {ls.length > 1 && <Pill tone="emerald">+{ls.length - 1} clarification</Pill>}
                      </div>
                      <p className="mt-2 text-[13px] leading-relaxed text-ink/80">{e!.overall_notes}</p>
                      <div className="mt-1.5 text-[11px] text-ink/40">Read by {base.model} · {new Date(base.ran_at).toLocaleString("en-IN")} · {(base.duration_ms / 1000).toFixed(0)} s</div>
                    </>
                  ) : <span className="text-ink/50">Not read yet.</span>}
                  {err[item.vendor_id] && <div className="mt-2 text-xs text-red-700">Error: {err[item.vendor_id]}</div>}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Btn small onClick={() => reread(item.vendor_id)} disabled={busy[item.vendor_id]}>↻ Re-read live</Btn>
                  {base && <Btn small kind="ghost" onClick={() => setOpen(open === item.vendor_id ? null : item.vendor_id)}>{open === item.vendor_id ? "Hide" : "What the AI extracted"}</Btn>}
                </div>
              </div>
              {open === item.vendor_id && base && <ExtractionDetail layer={base} />}
            </div>
          );
        })}
      </div>
      {preview && <Preview url={preview} onClose={() => setPreview(null)} />}
      <p className="mt-4 text-xs text-ink/50">The starting state was loaded from a real extraction run ({new Date(useStore.getState().snapshotAt).toLocaleString("en-IN")}) so the demo opens instantly. Every “Re-read live” calls the model again; nothing is hard-coded.</p>
      {false && set}
    </div>
  );
}

function ExtractionDetail({ layer }: { layer: Layer }) {
  const e = layer.extraction;
  return (
    <div className="border-t border-line bg-paper/50 p-4 text-xs">
      {e.suspicious_content.map((s, i) => (
        <div key={i} className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-900"><b>Prompt-injection attempt in vendor document (ignored):</b> “{s.quote}” — {s.why}</div>
      ))}
      {e.rate_rules.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 font-medium">Rate rules (applied by code, not by the model)</div>
          {e.rate_rules.map((r, i) => <div key={i} className="py-0.5">• <b>{r.kind.replace(/_/g, " ")}</b> — {r.scope_description} {r.rate != null && <>· {r.currency} {r.rate}</>} <span className="text-ink/50">“{r.source_quote}”</span></div>)}
        </div>
      )}
      {e.lines.length > 0 && (
        <table className="w-full tabular-nums">
          <thead className="text-left text-ink/50"><tr><th className="py-1 pr-2">RFx</th><th className="pr-2">As written</th><th className="pr-2 text-right">Price</th><th className="pr-2">Unit</th><th className="pr-2">Source (verbatim)</th><th className="pr-2">Checks</th></tr></thead>
          <tbody>
            {e.lines.map((l, i) => {
              const v = layer.verification[l.rfx_line_id || ""];
              return (
                <tr key={i} className="border-t border-line/60 align-top">
                  <td className="py-1 pr-2 font-mono">{l.rfx_line_id ?? "—"} <ConfDot c={l.match_confidence} /></td>
                  <td className="pr-2">{l.as_written}<div className="text-ink/40">{l.match_basis}</div></td>
                  <td className="pr-2 text-right">{l.currency} {l.price}</td>
                  <td className="pr-2">{l.price_unit_raw}</td>
                  <td className="max-w-[320px] pr-2 font-mono text-[10.5px] text-ink/70">“{l.source_quote}”<div className="font-sans text-ink/40">{l.source_location}</div></td>
                  <td className="pr-2 whitespace-nowrap">
                    {v?.quote_found === true && <div className="text-emerald-700">✓ quote found in file</div>}
                    {v?.quote_found === false && <div className="text-red-700">✗ quote not in file</div>}
                    {v?.number_in_quote === true && <div className="text-emerald-700">✓ price in quote</div>}
                    {v?.number_in_quote === false && <div className="text-red-700">✗ price not in quote</div>}
                    {v?.second_read != null && <div className={cx(Math.abs(v.second_read - (l.price ?? 0)) < 0.011 ? "text-emerald-700" : "text-red-700")}>{Math.abs(v.second_read - (l.price ?? 0)) < 0.011 ? "✓" : "✗"} 2nd read: {v.second_read}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div><div className="mb-1 font-medium">Commercial terms</div>
          <div>Freight: {e.terms.freight ? `${e.terms.freight.basis.replace(/_/g, " ")} — “${e.terms.freight.source_quote}”` : "not stated"}</div>
          {e.terms.discounts.map((d, i) => <div key={i}>Discount: {d.percent}% ({d.condition_type.replace(/_/g, " ")}) — “{d.source_quote}”</div>)}
          <div>Payment: {e.terms.payment_terms_days ?? "—"} days · Validity: {e.terms.validity_days ?? "—"} days · Lead time: {e.terms.lead_time_days ?? "—"} days</div>
          {e.terms.other.map((o, i) => <div key={i} className="text-ink/60">• {o}</div>)}
        </div>
        <div><div className="mb-1 font-medium">Questionnaire & documents</div>
          {e.questionnaire.map((q) => <div key={q.question_id}><span className="font-mono">{q.question_id}</span> <b>{q.normalized}</b> — {q.answer}</div>)}
          {e.documents.map((d, i) => <div key={i} className="mt-1 text-ink/70">📎 {d.document}: {d.finding} {d.valid_until && <b>(valid until {d.valid_until})</b>}</div>)}
          {!e.questionnaire.length && <div className="text-ink/50">No questionnaire answers in this response.</div>}
        </div>
      </div>
    </div>
  );
}

function Preview({ url, onClose }: { url: string; onClose: () => void }) {
  const k = kindOf(url);
  const [text, setText] = useState<string | null>(null);
  if (k === "email" && text == null) fetch(url).then((r) => r.text()).then(setText);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-6" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[900px] flex-col overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm"><span className="truncate">{decodeURIComponent(url.split("/").pop() || "")}</span><div className="flex gap-2"><a className="text-xs underline" href={url} download>Download</a><Btn small kind="ghost" onClick={onClose}>Close</Btn></div></div>
        <div className="flex-1 overflow-auto bg-paper">
          {k === "image" && <img src={url} alt="vendor upload" className="mx-auto max-h-[80vh]" />}
          {k === "pdf" && <iframe src={url} className="h-[80vh] w-full" />}
          {k === "email" && <pre className="whitespace-pre-wrap p-5 font-mono text-sm">{text}</pre>}
          {(k === "xlsx" || k === "docx") && <div className="p-8 text-sm text-ink/70">Office files can’t be previewed in the browser. <a className="underline" href={url} download>Download</a> to open it, or see “What the AI extracted” for the cell-by-cell read.</div>}
        </div>
      </div>
    </div>
  );
}

function UploadButton({ onDone }: { onDone: (vid: string) => void }) {
  const { vendors, rfx, inbox, set, setLayers } = useStore();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("new");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    const fl = Array.from(fileRef.current?.files || []);
    if (!fl.length) return setErr("Choose at least one file");
    if (fl.some((f) => f.size > 3.5e6)) return setErr("Keep files under 3.5 MB each for the hosted demo");
    setBusy(true); setErr("");
    try {
      let vid = vendorId, vname = vendors.find((v) => v.id === vendorId)?.name || newName;
      if (vendorId === "new") {
        if (!newName.trim()) throw new Error("Enter the vendor name");
        vid = `V${vendors.length + 1}`; vname = newName.trim();
        set({ vendors: [...vendors, { id: vid, name: vname, city: "—", contact: "—" }] });
      }
      const files = await Promise.all(fl.map(async (f) => ({ name: f.name, kind: kindOf(f.name), role: "quote", mime: f.type, base64: await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(f); }) })));
      const layer = await postJSON<Layer>("/api/extract", { rfx, files, vendor_name: vname, mode: "response" });
      setLayers(vid, [layer]);
      const item = { vendor_id: vid, received: new Date().toISOString().slice(0, 10), channel: "uploaded in demo", files: fl.map((f) => ({ name: f.name, kind: kindOf(f.name), role: "quote", url: URL.createObjectURL(f) })) };
      set({ inbox: [...inbox.filter((i) => i.vendor_id !== vid), item] });
      setOpen(false); onDone(vid);
    } catch (e) { setErr(String((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <>
      <Btn kind="primary" onClick={() => setOpen(true)}>+ Add a response</Btn>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onClick={() => !busy && setOpen(false)}>
          <div className="w-[460px] rounded-xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Add a vendor response</h3>
            <p className="mt-1 text-xs text-ink/60">Excel, PDF, Word, a photo, or a .txt/.eml email. It will be read live, against this RFx.</p>
            <label className="mt-4 block text-xs font-medium">Vendor</label>
            <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm">
              <option value="new">New vendor…</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} (replaces its current response)</option>)}
            </select>
            {vendorId === "new" && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Vendor name" className="mt-2 w-full rounded-md border border-line px-2 py-1.5 text-sm" />}
            <label className="mt-3 block text-xs font-medium">Files</label>
            <input ref={fileRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.docx,.jpg,.jpeg,.png,.webp,.txt,.eml" className="mt-1 w-full text-sm" />
            {err && <div className="mt-2 text-xs text-red-700">{err}</div>}
            <div className="mt-4 flex justify-end gap-2">{busy ? <Spinner label="Reading… (30–60 s)" /> : <><Btn kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn kind="primary" onClick={run}>Read it</Btn></>}</div>
          </div>
        </div>
      )}
    </>
  );
}
