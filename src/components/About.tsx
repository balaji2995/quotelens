"use client";
import { SectionTitle } from "./ui";

const ROWS: [string, string, string][] = [
  ["Reading vendor responses", "Real", "Claude reads xlsx (cell-addressed), docx (text + tables), PDF (native), photos (vision), and email. Output is a strict schema of what the vendor said. The model records; it never converts or fills gaps."],
  ["Matching to RFx lines", "Real", "The model matches on size, ply, type and printing (incl. inch → mm). Match confidence and the reasoning are kept per line."],
  ["Checking the read", "Real (code)", "Every price's verbatim quote is searched for in the source text. The price must appear inside its quote. Photos get a second, independent read; any disagreement turns the cell red."],
  ["Units, currency, freight, discounts", "Real (code)", "Deterministic TypeScript: per 100 / per 1,000 / per kg × spec weight, USD × buyer FX, printing surcharges, freight at actuals → buyer assumption, conditional discounts re-checked per award."],
  ["Questionnaire verdicts", "Real (model + code)", "The model judges each vendor claim against the requirement; code cross-checks claims with attached certificates (e.g. an expired ISO cert turns “yes” into a conflict)."],
  ["Clarification emails", "Real", "Open points are detected by code; the model drafts one email covering all of them, without revealing competitor information."],
  ["Vendor replies", "Simulated", "Email is stubbed, so an AI role-plays the vendor from a fixed fact sheet. Paste a real reply to bypass it. Reading the reply is the real extraction engine."],
  ["Analyst", "Real", "Tool-using agent over the normalized data: query, pivot, award optimiser, calculator, provenance. No answers are pre-written; a post-check flags any ₹ figure not traceable to a tool result."],
  ["RFx co-pilot", "Real", "Edits a structured RFx via typed operations."],
  ["Sending the RFx / email", "Stubbed", "Outbox only. Nothing leaves the app."],
  ["Dataset", "Fabricated", "Navika Foods and all vendors are fictional. One price model generates the RFx, ground truth, and five messy responses. Ground truth is used only by the offline eval (scripts/eval_extraction.ts), never by the app."],
];

export default function About() {
  return (
    <div className="max-w-4xl">
      <SectionTitle title="What's real, what's stubbed" sub="The rule was: stub the plumbing, but the AI loops must be real." />
      <div className="rounded-lg border border-line bg-white">
        {ROWS.map(([a, b, c]) => (
          <div key={a} className="grid grid-cols-[220px_120px_1fr] gap-4 border-b border-line/60 px-4 py-2.5 text-sm last:border-0">
            <div className="font-medium">{a}</div>
            <div className={b.startsWith("Real") ? "text-emerald-700" : b === "Simulated" ? "text-amber-700" : "text-ink/50"}>{b}</div>
            <div className="text-ink/70">{c}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-lg border border-line bg-white p-4 text-sm leading-relaxed text-ink/80">
        <div className="mb-1 font-medium text-ink">Design principle</div>
        The model reads and plans; code does the maths. A buyer with ₹4 crore on the line has to be able to click any number and see the sentence it came from, every conversion applied, and every assumption that is theirs to change. Uncertainty is never hidden or silently filled. It's shown on the cell, and it turns into a question for the vendor.
      </div>
    </div>
  );
}
