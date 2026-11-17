/**
 * Deterministic normalization. No model calls here: the model extracts, this code does the maths.
 * Every number on the comparison grid is produced by this file, with the steps recorded.
 */
import type {
  Assumptions, Cell, Conf, ExtractedLine, Extraction, History, Issue, Layer, QaVerdict, RateRule,
  Rfx, RfxLine, Step, Vendor, VendorSummary,
} from "./types";

const CONF_RANK: Record<Conf, number> = { low: 0, medium: 1, high: 2 };
export const minConf = (...c: Conf[]): Conf => c.reduce((a, b) => (CONF_RANK[a] <= CONF_RANK[b] ? a : b), "high" as Conf);
const r2 = (n: number) => Math.round(n * 100) / 100;
export const inr = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
export const crore = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} cr` : `₹${(n / 1e5).toFixed(2)} L`);

export interface Override { vendor_id: string; line_id: string; landed_inr: number | null; note: string; by: string }

interface Merged {
  lines: Map<string, { line: ExtractedLine; layer: Layer }>;
  rules: { rule: RateRule; layer: Layer }[];
  terms: Extraction["terms"];
  termsLayer: Record<string, string>;
  questionnaire: Map<string, { a: Extraction["questionnaire"][number]; layer: Layer }>;
  documents: Extraction["documents"];
  notQuoted: Set<string>;
  suspicious: Extraction["suspicious_content"];
  currency: string;
  dupes: Map<string, number[]>;
  unmatched: { as_written: string; price: number | null; currency: string; layer: string }[];
}

export function mergeLayers(layers: Layer[]): Merged {
  const m: Merged = {
    lines: new Map(), rules: [], questionnaire: new Map(), documents: [], notQuoted: new Set(), suspicious: [],
    terms: { freight: null, discounts: [], payment_terms_days: null, validity_days: null, lead_time_days: null, gst_note: "", other: [] },
    termsLayer: {}, currency: "INR", dupes: new Map(), unmatched: [],
  };
  for (const layer of layers) {
    const e = layer.extraction;
    if (layer.kind === "response" && e.currency_detected) m.currency = e.currency_detected;
    const seen = new Map<string, number[]>();
    for (const l of e.lines || []) {
      if (!l.rfx_line_id) {
        if (l.price != null) m.unmatched.push({ as_written: l.as_written, price: l.price, currency: l.currency, layer: layer.label });
        continue;
      }
      // two prices for the same RFx line inside ONE layer = ambiguity (a later layer overriding is normal)
      seen.set(l.rfx_line_id, [...(seen.get(l.rfx_line_id) || []), l.price ?? NaN]);
      m.lines.set(l.rfx_line_id, { line: l, layer });
      m.notQuoted.delete(l.rfx_line_id);
    }
    for (const [id, prices] of seen) if (prices.length > 1) m.dupes.set(id, prices); else m.dupes.delete(id);
    for (const id of e.explicitly_not_quoted || []) if (!m.lines.has(id)) m.notQuoted.add(id);
    // later rules take priority -> unshift
    for (const r of e.rate_rules || []) m.rules.unshift({ rule: r, layer });
    const t = e.terms || ({} as Extraction["terms"]);
    if (t.freight && t.freight.basis !== "unknown") { m.terms.freight = t.freight; m.termsLayer.freight = layer.label; }
    else if (t.freight && !m.terms.freight) m.terms.freight = t.freight;
    if (t.discounts && t.discounts.length) { m.terms.discounts = t.discounts; m.termsLayer.discounts = layer.label; }
    for (const k of ["payment_terms_days", "validity_days", "lead_time_days"] as const)
      if (t[k] != null) { m.terms[k] = t[k]; m.termsLayer[k] = layer.label; }
    if (t.gst_note) m.terms.gst_note = t.gst_note;
    if (t.other?.length) m.terms.other = [...m.terms.other, ...t.other];
    for (const q of e.questionnaire || []) {
      if (layer.kind === "clarification" && (q.normalized === "unknown" || !q.answer)) continue;
      m.questionnaire.set(q.question_id, { a: q, layer });
    }
    m.documents.push(...(e.documents || []));
    m.suspicious.push(...(e.suspicious_content || []));
  }
  return m;
}

function verificationConf(layer: Layer, line: ExtractedLine, flags: string[]): Conf {
  const v = layer.verification?.[line.rfx_line_id || ""];
  if (!v) return "high";
  let c: Conf = "high";
  if (v.quote_found === false) { flags.push("Source quote not found verbatim in document — check"); c = "low"; }
  if (v.number_in_quote === false) { flags.push("Price not present in the quoted source text — check"); c = "low"; }
  if (v.second_read != null && line.price != null && Math.abs(v.second_read - line.price) > 0.011) {
    flags.push(`Two independent reads disagree (${line.price} vs ${v.second_read})`); c = "low";
  }
  return c;
}

function findRule(rules: Merged["rules"], kind: RateRule["kind"], line: RfxLine) {
  return rules.find(({ rule }) =>
    rule.kind === kind &&
    (rule.ply == null || rule.ply === line.ply) &&
    (!rule.applies_to_kinds?.length || rule.applies_to_kinds.map((k) => k.toLowerCase()).includes(String(line.kind).toLowerCase())));
}

/** Canonical currency code from whatever the vendor wrote ("Rs.", "₹", "INR ", "US$", "usd"…). */
export function canonCurrency(c: string | null | undefined): string {
  const raw = String(c ?? "").trim().toUpperCase();
  const t = raw.replace(/[^A-Z₹$€£]/g, "");
  if (!t || ["INR", "RS", "RUPEE", "RUPEES", "₹", "INRS"].includes(t)) return "INR";
  if (["USD", "$", "US$", "USDOLLAR", "USDOLLARS", "DOLLAR", "DOLLARS"].includes(t)) return "USD";
  if (["EUR", "€", "EURO", "EUROS"].includes(t)) return "EUR";
  if (["GBP", "£"].includes(t)) return "GBP";
  return t;
}

function toInr(amount: number, currency: string, a: Assumptions, steps: Step[], flags: string[]): number | null {
  const c = canonCurrency(currency);
  if (c === "INR") return amount;
  if (c === "USD") {
    if (!(a.fx_usd_inr > 0)) { flags.push("Quoted in USD but no valid exchange rate is set (buyer assumptions)"); return null; }
    const v = amount * a.fx_usd_inr;
    steps.push({ label: `USD ${amount} × ₹${a.fx_usd_inr}/USD (buyer FX assumption)`, value: r2(v) });
    flags.push(`Quoted in USD — converted at ₹${a.fx_usd_inr}/USD`);
    return v;
  }
  flags.push(`Quoted in ${c}: no exchange rate configured for it, so this price is not converted. Ask the vendor for INR`);
  return null;
}

export function normalize(
  rfx: Rfx, vendors: Vendor[], history: History, layersByVendor: Record<string, Layer[]>, a: Assumptions, overrides: Override[] = [],
): { cells: Cell[]; summaries: VendorSummary[]; issues: Issue[] } {
  const cells: Cell[] = [];
  const summaries: VendorSummary[] = [];
  const issues: Issue[] = [];

  for (const v of vendors) {
    const layers = layersByVendor[v.id] || [];
    if (!layers.length) continue;
    const m = mergeLayers(layers);
    const vCells: Cell[] = [];

    for (const line of rfx.lines) {
      const steps: Step[] = [];
      const flags: string[] = [];
      let conf: Conf = "high";
      let status: Cell["status"] = "quoted";
      let unit: number | null = null;
      let source: Cell["source"] = null;
      const ex = m.lines.get(line.id);

      if (ex && ex.line.price != null) {
        const l = ex.line;
        source = { quote: l.source_quote, location: l.source_location, layer: ex.layer.label };
        conf = minConf(l.confidence, l.match_confidence, verificationConf(ex.layer, l, flags));
        steps.push({ label: `As quoted: ${l.currency} ${l.price} ${l.price_unit_raw || l.price_unit}`, value: l.price! });
        const dup = m.dupes.get(line.id);
        if (dup) { flags.push(`Vendor gave ${dup.length} different prices for this line (${dup.join(", ")}); using the last one`); conf = "low"; }
        if (canonCurrency(l.currency) !== canonCurrency(m.currency)) {
          flags.push(`This line is priced in ${canonCurrency(l.currency)} but the rest of the response is in ${canonCurrency(m.currency)}. Check for a currency mix-up`);
          conf = minConf(conf, "medium");
        }
        if (l.match_confidence !== "high") flags.push(`Line match ${l.match_confidence}: ${l.match_basis}`);
        let p: number | null = l.price! > 0 ? toInr(l.price!, l.currency, a, steps, flags) : (flags.push("Price is zero or negative: treated as not quoted"), null);
        if (p != null) {
          switch (l.price_unit) {
            case "per_100": p = p / 100; steps.push({ label: "÷ 100 (quoted per 100 nos)", value: r2(p) }); break;
            case "per_1000": p = p / 1000; steps.push({ label: "÷ 1,000 (quoted per 1,000 pcs)", value: r2(p) }); break;
            case "per_kg":
              if (line.uom === "kg") break;
              if (line.spec_weight_g) {
                p = (p * line.spec_weight_g) / 1000;
                steps.push({ label: `× spec weight ${line.spec_weight_g} g (quoted per kg)`, value: r2(p) });
                flags.push("Per-kg rate converted using RFx spec weight; actual board weight may vary");
                conf = minConf(conf, "medium");
              } else { p = null; flags.push("Per-kg rate but no spec weight to convert"); }
              break;
            case "per_piece": case "per_set": case "per_sheet":
              if (line.uom === "kg") { p = null; flags.push("Quoted per piece but RFx UoM is kg"); }
              break;
            default: p = null; flags.push(`Unrecognised unit "${l.price_unit_raw}"`);
          }
        }
        if (p != null && l.includes_printing === false && line.print_colours > 0) {
          const pr = findRule(m.rules, "print_surcharge_per_colour", line) ||
            m.rules.find(({ rule }) => rule.kind === "print_surcharge_per_colour");
          if (pr && pr.rule.rate != null) {
            const add = (toInr(pr.rule.rate, pr.rule.currency, a, [], []) || 0) * line.print_colours;
            p += add;
            steps.push({ label: `+ printing ${line.print_colours} colour × ₹${pr.rule.rate} (vendor surcharge)`, value: r2(p) });
          } else {
            flags.push("Price is for plain box but RFx line is printed; no printing surcharge quoted");
            conf = "low";
          }
        }
        if (l.includes_printing == null && line.print_colours > 0) {
          flags.push("Unclear whether price includes printing"); conf = minConf(conf, "medium");
        }
        const printOnly = l.spec_deviation && l.includes_printing === false && /plain|print/i.test(l.spec_deviation) && !/ply|bf|gsm|size|flute/i.test(l.spec_deviation);
        if (l.spec_deviation && !printOnly) {
          status = a.accept_spec_deviations ? "quoted" : "deviation";
          flags.push(`Spec deviation: ${l.spec_deviation}`);
        }
        unit = p;
        if (p == null) status = "unresolved";
      } else {
        const kgRule = findRule(m.rules, "rate_per_kg", line);
        const refRule = findRule(m.rules, "reference_previous_contract", line);
        if (kgRule && kgRule.rule.rate != null && (line.spec_weight_g || line.uom === "kg")) {
          const r = kgRule.rule;
          source = { quote: r.source_quote, location: r.scope_description, layer: kgRule.layer.label };
          const rate = toInr(r.rate!, r.currency, a, steps, flags);
          if (rate != null) {
            steps.unshift({ label: `Rate rule: ${r.currency} ${r.rate}/kg (${r.scope_description})`, value: r.rate! });
            unit = line.uom === "kg" ? rate : (rate * line.spec_weight_g!) / 1000;
            if (line.uom !== "kg") steps.push({ label: `× spec weight ${line.spec_weight_g} g`, value: r2(unit) });
            flags.push("Derived: per-kg rate × RFx spec weight");
            conf = minConf(r.confidence, "medium");
            const ref = findRule(m.rules, "reference_previous_contract", line);
            const boxy = ["rsc", "tray"].includes(String(line.kind).toLowerCase());
            if (ref && !boxy && !r.applies_to_kinds?.length) {
              const alt = history.vendor_id === v.id ? history.prices[line.id] : undefined;
              flags.push(`Ambiguous: "${r.source_quote}" may cover only boxes; "${ref.rule.source_quote}" would give ${alt != null ? inr(alt) : "a different price"}`);
              conf = "low";
            }
            if (line.print_colours > 0) {
              if (r.includes_printing == null) { flags.push("Unclear whether per-kg rate includes printing"); conf = minConf(conf, "medium"); }
              else if (r.includes_printing === false) {
                const pr = m.rules.find(({ rule }) => rule.kind === "print_surcharge_per_colour");
                if (pr?.rule.rate != null) { unit += pr.rule.rate * line.print_colours; steps.push({ label: `+ printing ${line.print_colours} × ₹${pr.rule.rate}`, value: r2(unit) }); }
                else { flags.push("Per-kg rate excludes printing; no surcharge quoted"); conf = "low"; }
              }
            }
          }
        } else if (refRule) {
          const r = refRule.rule;
          source = { quote: r.source_quote, location: "reference to previous contract", layer: refRule.layer.label };
          if (history.vendor_id === v.id && history.prices[line.id] != null) {
            unit = history.prices[line.id];
            steps.push({ label: `"Same as last year" → ${history.contract} price`, value: unit });
            flags.push(`Resolved from contract ${history.contract} — vendor did not restate this price`);
            conf = minConf(r.confidence, "medium");
          } else {
            status = "unresolved";
            flags.push("Vendor referred to a previous price we have no record of");
          }
        } else {
          status = "missing";
          if (m.notQuoted.has(line.id)) flags.push("Vendor explicitly did not quote this line");
        }
      }

      // plausibility: a price far from last year's for the same line usually means a unit or currency slip
      const ref = history.prices[line.id];
      if (unit != null && ref && ref > 0 && status !== "deviation") {
        const ratio = unit / ref;
        if (ratio > 2.5 || ratio < 0.4) {
          flags.push(`Implausible: ${ratio >= 1 ? ratio.toFixed(1) + "×" : "only " + Math.round(ratio * 100) + "% of"} last year's price (₹${ref}). Possible unit (per 100 / per 1,000 / per kg) or currency error`);
          conf = "low";
        }
      }
      const gst = (m.terms.gst_note || "").toLowerCase();
      if (unit != null && /incl|inclusive|including/.test(gst) && !/excl|exclusive|extra|plus|\+|additional/.test(gst)) {
        flags.push(`Vendor's note suggests prices may include GST (“${m.terms.gst_note}”). Comparison is ex-GST; confirm`);
        conf = minConf(conf, "medium");
      }

      // commercial adjustments
      let discount = 0, freight = 0;
      if (unit != null) {
        const fr = m.terms.freight;
        if (!fr || fr.basis === "unknown") {
          freight = (unit * a.freight_at_actuals_pct) / 100;
          steps.push({ label: `+ freight assumed ${a.freight_at_actuals_pct}% (vendor silent on freight)`, value: r2(unit + freight) });
          flags.push("Freight not stated — buyer assumption applied");
        } else if (fr.basis === "extra_at_actuals") {
          freight = (unit * a.freight_at_actuals_pct) / 100;
          steps.push({ label: `+ freight "at actuals" → assumed ${a.freight_at_actuals_pct}%`, value: r2(unit + freight) });
          flags.push(`Freight extra at actuals — assumed ${a.freight_at_actuals_pct}%`);
        } else if (fr.basis === "extra_percent" && fr.amount != null) {
          freight = (unit * fr.amount) / 100;
          steps.push({ label: `+ freight ${fr.amount}% (vendor)`, value: r2(unit + freight) });
        } else if (fr.basis === "extra_per_unit" && fr.amount != null) {
          freight = toInr(fr.amount, m.currency, a, [], []) || 0;
          steps.push({ label: `+ freight ₹${r2(freight)} per unit (vendor)`, value: r2(unit + freight) });
        } else if (fr.basis === "conditional_free") {
          flags.push(`Freight free conditionally: ${fr.condition_text}`);
        }
        for (const d of m.terms.discounts || []) {
          if (d.condition_type === "unconditional") {
            discount += (unit * d.percent) / 100;
            steps.push({ label: `− ${d.percent}% discount (unconditional)`, value: r2(unit - discount + freight) });
          }
        }
      }
      vCells.push({
        vendor_id: v.id, line_id: line.id, status, unit_inr: unit != null ? r2(unit) : null, discount_inr: discount, freight_inr: freight,
        landed_inr: unit != null ? r2(unit - discount + freight) : null, annual_landed_inr: null, confidence: status === "missing" ? "high" : conf,
        flags, steps, source,
      });
    }

    // conditional discounts: evaluate against vendor's monthly value assuming full award of quoted lines
    const monthly = vCells.reduce((s, c) => s + (c.unit_inr ?? 0) * (rfx.lines.find((l) => l.id === c.line_id)!.annual_qty), 0) / 12;
    for (const d of m.terms.discounts || []) {
      if (d.condition_type === "unconditional") continue;
      const met = d.condition_type === "monthly_value_threshold" && d.threshold_amount_inr != null ? monthly >= d.threshold_amount_inr : null;
      for (const c of vCells) {
        if (c.unit_inr == null) continue;
        if (met && a.apply_conditional_discounts) {
          const amt = (c.unit_inr * d.percent) / 100;
          c.discount_inr += amt;
          c.conditional_discount = { pct: d.percent, threshold_monthly_inr: d.threshold_amount_inr!, amount_inr: amt };
          c.landed_inr = r2(c.unit_inr - c.discount_inr + c.freight_inr);
          c.steps.push({ label: `− ${d.percent}% conditional discount (met if full award: ~${crore(monthly)}/month ≥ ${crore(d.threshold_amount_inr!)})`, value: c.landed_inr });
          c.flags.push(`Conditional discount ${d.percent}% applied — holds only if monthly offtake stays above ${crore(d.threshold_amount_inr!)}`);
        } else {
          c.flags.push(`Conditional discount ${d.percent}% not applied (${met === false ? "threshold not met" : met == null ? "condition not evaluable" : "disabled by buyer"})`);
        }
      }
    }

    for (const c of vCells) {
      const line = rfx.lines.find((l) => l.id === c.line_id)!;
      const ov = overrides.find((o) => o.vendor_id === v.id && o.line_id === c.line_id);
      if (ov) {
        c.overridden = { by: ov.by, previous: c.landed_inr };
        c.landed_inr = ov.landed_inr;
        c.status = ov.landed_inr == null ? "missing" : "quoted";
        c.steps.push({ label: `Buyer override: ${ov.note}`, value: ov.landed_inr ?? undefined });
        c.confidence = "high";
      }
      c.annual_landed_inr = c.landed_inr != null ? Math.round(c.landed_inr * line.annual_qty) : null;
    }
    cells.push(...vCells);

    // ---- questionnaire verdicts
    const qa_detail: VendorSummary["qa_detail"] = [];
    for (const q of rfx.questionnaire.filter((q) => q.knockout)) {
      const ans = m.questionnaire.get(q.id);
      let verdict: QaVerdict = "unverified";
      let why = "No answer received";
      if (ans) {
        const n = String(ans.a.normalized).toLowerCase();
        if (n === "yes") { verdict = "pass"; why = ans.a.answer; }
        else if (n === "no") { verdict = "fail"; why = ans.a.answer; }
        else if (n === "partial") { verdict = "unverified"; why = `Partial / unevidenced: ${ans.a.answer}`; }
        else { verdict = "unverified"; why = `Unclear answer: ${ans.a.answer}`; }
        if (ans.layer.kind === "clarification") why += ` (via ${ans.layer.label})`;
      }
      if (q.id === "Q1" && verdict === "pass") {
        const certs = m.documents.filter((d) => d.doc_type === "iso_certificate");
        const latest = certs.map((c) => c.valid_until).filter(Boolean).sort().pop();
        const clarified = ans?.layer.kind === "clarification";
        if (latest && latest < a.contract_start && !clarified) {
          verdict = "conflict"; why = `Says yes, but attached certificate expired ${latest}`;
        } else if (!certs.length) {
          why += " — declared; certificate copy not seen";
        } else if (latest) why += ` — certificate valid until ${latest}`;
      }
      qa_detail.push({ qid: q.id, verdict, why });
    }
    const vs = qa_detail.map((d) => d.verdict);
    const qa_status: QaVerdict = vs.includes("fail") ? "fail" : vs.includes("conflict") ? "conflict" : vs.includes("unverified") ? "unverified" : "pass";

    const fr = m.terms.freight;
    summaries.push({
      vendor_id: v.id, name: v.name, qa_status, qa_detail,
      lines_quoted: vCells.filter((c) => c.status === "quoted").length,
      lines_missing: vCells.filter((c) => c.status === "missing").map((c) => c.line_id),
      lines_deviation: vCells.filter((c) => c.status === "deviation").map((c) => c.line_id),
      lines_unresolved: vCells.filter((c) => c.status === "unresolved").map((c) => c.line_id),
      unmatched_items: m.unmatched.map((u) => `${u.as_written} (${u.currency} ${u.price})`),
      validity_days: m.terms.validity_days,
      payment_days: m.terms.payment_terms_days,
      freight_text: fr ? `${fr.basis.replace(/_/g, " ")}${fr.amount != null ? ` (${fr.amount})` : ""}${fr.condition_text ? ` — ${fr.condition_text}` : ""}` : "not stated",
      discount_text: (m.terms.discounts || []).map((d) => `${d.percent}% ${d.condition_type === "unconditional" ? "" : "if " + d.condition_text}`).join("; ") || "none",
      lead_time_days: m.terms.lead_time_days,
      total_landed_quoted_inr: vCells.reduce((s, c) => s + (c.status === "quoted" ? c.annual_landed_inr ?? 0 : 0), 0),
      low_conf_cells: vCells.filter((c) => c.status !== "missing" && c.confidence === "low").length,
      suspicious: m.suspicious.map((s) => `${s.why}: “${s.quote}”`),
    });

    // ---- issues -> clarification agenda (deterministic)
    const add = (severity: Issue["severity"], topic: string, detail: string, lines: string[], question: string) =>
      issues.push({ id: `${v.id}-${issues.length + 1}`, vendor_id: v.id, severity, topic, detail, lines, question });
    const missing = vCells.filter((c) => c.status === "missing").map((c) => c.line_id);
    if (missing.length) add("major", "Lines not quoted", `${missing.length} of ${rfx.lines.length} lines not quoted`, missing, `Please quote, or confirm you cannot supply: ${missing.join(", ")}.`);
    const dev = vCells.filter((c) => c.flags.some((f) => f.startsWith("Spec deviation")));
    if (dev.length) add("major", "Alternate specification", dev.map((c) => c.flags.find((f) => f.startsWith("Spec"))).join("; "), dev.map((c) => c.line_id), "Please also quote these lines exactly as specified so we can compare like-for-like.");
    const unres = vCells.filter((c) => c.status === "unresolved");
    if (unres.length) add("major", "Price could not be resolved", unres.map((c) => `${c.line_id}: ${c.flags.at(-1)}`).join("; "), unres.map((c) => c.line_id), "Please state an explicit price per unit for these lines.");
    const low = vCells.filter((c) => c.status !== "missing" && c.status !== "unresolved" && c.confidence === "low" && !c.flags.some((f) => f.startsWith("Implausible") || f.includes("currency mix-up") || f.includes("different prices")));
    if (low.length) add("major", "Low-confidence reads", low.map((c) => `${c.line_id}: ${c.flags[0] ?? "low confidence"}`).join("; "), low.map((c) => c.line_id), "Please confirm the prices for these lines.");
    const kg = vCells.filter((c) => c.flags.some((f) => f.includes("per-kg") || f.includes("Per-kg")));
    if (kg.length) add("minor", "Per-kg pricing", "Per-piece prices derived from per-kg rate × our spec weight", kg.map((c) => c.line_id), "Please confirm per-piece prices, or the board weight you have assumed per box.");
    const pr = vCells.filter((c) => c.flags.some((f) => f.toLowerCase().includes("includes printing")));
    if (pr.length) add("major", "Printing inclusion", "Unclear whether printing is included", pr.map((c) => c.line_id), "Does your rate include printing? If not, what is the printing charge per colour per box?");
    const hist = vCells.filter((c) => c.flags.some((f) => f.startsWith("Resolved from contract")));
    if (hist.length) add("minor", "“Same as last year”", `${hist.length} lines resolved from ${history.contract}`, hist.map((c) => c.line_id), `Please confirm that “same as last year” means the prices in contract ${history.contract}, valid for CY2027.`);
    if (m.currency.toUpperCase() === "USD") add("minor", "Currency", "Quoted in USD; RFx asks for INR", [], "Please confirm INR prices (or the exchange rate you will invoice at) — our RFx requires INR.");
    if (!fr || fr.basis === "extra_at_actuals" || fr.basis === "unknown") add("major", "Freight", fr ? "Freight extra at actuals — landed cost is an assumption" : "Freight not stated", [], "Please give a firm freight charge to our Ranjangaon plant (per box or % of invoice), or confirm prices are delivered.");
    for (const d of m.terms.discounts || []) if (d.condition_type !== "unconditional") add("minor", "Conditional discount", d.condition_text, [], `Please confirm how the ${d.percent}% discount applies if we award only part of the volume to you.`);
    if (m.unmatched.length) add("minor", "Items we couldn't match", `${m.unmatched.length} priced item(s) don't match any RFx line: ${m.unmatched.slice(0, 4).map((u) => u.as_written).join("; ")}${m.unmatched.length > 4 ? "…" : ""}`, [], "Which of our RFx lines (if any) do these items correspond to?");
    const askValidity = parseInt(String(rfx.terms?.validity ?? "90")) || 90;
    if (m.terms.validity_days != null && m.terms.validity_days < askValidity) add("minor", "Quote validity", `Quote valid ${m.terms.validity_days} days vs ${askValidity} requested; it may lapse before award`, [], `Please extend your quote validity to ${askValidity} days from the bid due date.`);
    const dupLines = [...m.dupes.keys()];
    if (dupLines.length) add("major", "Two prices for one line", `Vendor gave more than one price for: ${dupLines.join(", ")}`, dupLines, "You quoted more than one price for these lines. Which one applies, and under what condition?");
    const odd = vCells.filter((c) => c.flags.some((f) => f.startsWith("Implausible") || f.includes("currency mix-up")));
    if (odd.length) add("major", "Possible unit or currency error", odd.map((c) => `${c.line_id}: ${c.flags.find((f) => f.startsWith("Implausible") || f.includes("currency mix-up"))}`).join("; "), odd.map((c) => c.line_id), "Please confirm the price, unit of measure (per piece / per 100 / per kg) and currency for these lines.");
    if (m.terms.payment_terms_days != null && m.terms.payment_terms_days < 60) add("minor", "Payment terms", `Vendor offers ${m.terms.payment_terms_days} days vs 60 required`, [], "Our terms are 60 days from GRN. Please confirm acceptance and any price impact.");
    for (const d of qa_detail.filter((d) => d.verdict !== "pass")) {
      const q = rfx.questionnaire.find((x) => x.id === d.qid)!;
      add(d.verdict === "fail" ? "major" : "blocker", `Questionnaire ${q.id}${d.verdict === "fail" ? " (fails knockout)" : ""}`, `${q.text} — ${d.why}`, [],
        d.verdict === "conflict" ? `Your ISO 9001 certificate on file expired. Please share the current valid certificate.` : d.verdict === "fail" ? `${q.text} Our requirement: ${q.requirement}. Can you meet this?` : q.text);
    }
  }
  return { cells, summaries, issues };
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  fx_usd_inr: 88.0,
  freight_at_actuals_pct: 3,
  apply_conditional_discounts: true,
  accept_spec_deviations: false,
  contract_start: "2027-01-01",
};
