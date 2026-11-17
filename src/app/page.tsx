"use client";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { useNormalized, cx, Btn } from "@/components/ui";
import RfxView from "@/components/RfxView";
import Inbox from "@/components/Inbox";
import Comparison from "@/components/Comparison";
import Clarifications from "@/components/Clarifications";
import Analyst from "@/components/Analyst";
import About from "@/components/About";
import Award from "@/components/Award";

type Tab = "rfx" | "inbox" | "compare" | "clarify" | "analyst" | "award" | "about";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("rfx");
  useEffect(() => {
    setMounted(true);
    const h = window.location.hash.slice(1) as Tab;
    if (h) setTab(h);
  }, []);
  useEffect(() => { if (mounted) history.replaceState(null, "", `#${tab}`); }, [tab, mounted]);
  if (!mounted) return <div className="p-10 text-sm text-ink/50">Loading…</div>;
  return <Shell tab={tab} setTab={setTab} />;
}

function Shell({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { rfx, layers, reset, awards, guideOpen, set } = useStore();
  const { issues, summaries } = useNormalized();
  const threads = useStore((s) => s.threads);
  const openIssues = issues.length; void threads;
  const cleared = summaries.filter((s) => s.qa_status === "pass").length;
  const nav: { id: Tab; n: string; label: string; meta: string }[] = [
    { id: "rfx", n: "1", label: "Draft RFx", meta: `${rfx.lines.length} lines · ${rfx.questionnaire.length} questions` },
    { id: "inbox", n: "2", label: "Vendor responses", meta: `${Object.keys(layers).length} of 5 read` },
    { id: "compare", n: "3", label: "Comparison", meta: `${cleared} vendor${cleared === 1 ? "" : "s"} QA-cleared` },
    { id: "clarify", n: "4", label: "Clarifications", meta: `${openIssues} open points` },
    { id: "analyst", n: "5", label: "Ask the analyst", meta: "plain-language analysis" },
    { id: "award", n: "6", label: "Award decision", meta: awards.length ? `${awards.length} memo${awards.length > 1 ? "s" : ""}` : "memo for approval" },
  ];
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-white/70 px-3 py-4">
        <div className="px-2">
          <div className="text-[15px] font-semibold tracking-tight">QuoteLens</div>
          <div className="text-[11px] text-ink/50">Kill the quote spreadsheet</div>
        </div>
        <div className="mt-5 rounded-md bg-paper px-2 py-2 text-[11px] leading-snug text-ink/70">
          <div className="font-medium text-ink">{rfx.id}</div>
          <div>{rfx.title}</div>
          <div className="mt-0.5 text-ink/50">{rfx.buyer.company}</div>
        </div>
        <nav className="mt-4 flex flex-col gap-0.5">
          {nav.map((x) => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={cx("flex items-start gap-2.5 rounded-md px-2 py-2 text-left transition", tab === x.id ? "bg-ink text-white" : "hover:bg-paper")}>
              <span className={cx("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold", tab === x.id ? "bg-white text-ink" : "bg-ink/10")}>{x.n}</span>
              <span>
                <span className="block text-sm font-medium">{x.label}</span>
                <span className={cx("block text-[11px]", tab === x.id ? "text-white/60" : "text-ink/50")}>{x.meta}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2 text-[11px] text-ink/50">
          {!guideOpen && <button onClick={() => set({ guideOpen: true })} className="block hover:text-ink">Show the guided tour</button>}
          <button onClick={() => setTab("about")} className={cx("block hover:text-ink", tab === "about" && "text-ink font-medium")}>How this works · what's real</button>
          <Btn small kind="ghost" onClick={() => { if (confirm("Reset the demo to its starting state? Clarifications, overrides and chat will be cleared.")) reset(); }}>Reset demo</Btn>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-6">
        {guideOpen && <Guide tab={tab} setTab={setTab} onClose={() => set({ guideOpen: false })} />}
        {tab === "rfx" && <RfxView />}
        {tab === "inbox" && <Inbox />}
        {tab === "compare" && <Comparison goClarify={() => setTab("clarify")} />}
        {tab === "clarify" && <Clarifications />}
        {tab === "analyst" && <Analyst goAward={() => setTab("award")} />}
        {tab === "award" && <Award goAnalyst={() => setTab("analyst")} />}
        {tab === "about" && <About />}
      </main>
    </div>
  );
}

const GUIDE: { tab: Tab; title: string; hint: string }[] = [
  { tab: "rfx", title: "Draft the RFx", hint: "This is the request sent to 5 box suppliers. Click “Review this RFx like a senior buyer” to see the AI co-pilot critique it (it can also edit it)." },
  { tab: "inbox", title: "See what vendors sent back", hint: "Five formats: Excel, PDF, Word, a phone photo, a one-line email. Click a file to preview it, then “What the AI extracted” on Globepack: look for the red banner." },
  { tab: "compare", title: "Compare on one basis", hint: "All prices are ₹ per unit, delivered, ex-GST. Click any number to see its source sentence and every calculation step. Try changing the FX rate." },
  { tab: "analyst", title: "Ask the VP’s question", hint: "Click “What if we split it… only among vendors who cleared the quality questionnaire?”. Only one vendor qualifies so far. The others haven’t failed; they haven’t answered." },
  { tab: "clarify", title: "Let the system chase the vendors", hint: "Pick Mahalaxmi → Draft email → Send → Simulate vendor reply → Read reply. Watch its quality status flip. Each step takes ~20–40 s (real AI)." },
  { tab: "analyst", title: "Ask again, then award it", hint: "Re-ask the VP question: more vendors qualify now. Under the answer, click “Award this scenario” to create a memo." },
  { tab: "award", title: "Approve and export", hint: "The memo: recommendation, split, risks, conditions and line-by-line allocation. Export to Excel, Markdown or PDF. “Reset demo” (bottom left) starts over." },
];

function Guide({ tab, setTab, onClose }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    // keep the step in sync when the reviewer navigates by the sidebar
    if (GUIDE[step].tab !== tab) { const i = GUIDE.findIndex((g, k) => g.tab === tab && k >= step); const j = i >= 0 ? i : GUIDE.findIndex((g) => g.tab === tab); if (j >= 0) setStep(j); }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = GUIDE[step];
  const go = (i: number) => { setStep(i); setTab(GUIDE[i].tab); };
  return (
    <div className="guide-strip mb-5 flex items-center gap-4 rounded-lg border border-accent/30 bg-[#eaf4f1] px-4 py-2.5 text-sm">
      <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">Guided tour</span>
      <div className="flex shrink-0 gap-1">
        {GUIDE.map((_, i) => <button key={i} onClick={() => go(i)} title={GUIDE[i].title} className={cx("h-2 w-6 rounded-full", i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-ink/15")} />)}
      </div>
      <div className="min-w-0 flex-1"><b>Step {step + 1} of {GUIDE.length}: {g.title}.</b> <span className="text-ink/75">{g.hint}</span></div>
      <div className="flex shrink-0 gap-1">
        {step > 0 && <Btn small kind="ghost" onClick={() => go(step - 1)}>← Back</Btn>}
        {step < GUIDE.length - 1 ? <Btn small kind="primary" onClick={() => go(step + 1)}>Next →</Btn> : <Btn small kind="primary" onClick={onClose}>Done</Btn>}
        <Btn small kind="ghost" onClick={onClose}>Hide</Btn>
      </div>
    </div>
  );
}
