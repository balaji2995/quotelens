/** Award scenarios — deterministic. The analyst model chooses parameters; this code does the optimisation. */
import type { Cell, Conf, History, QaVerdict, Rfx, VendorSummary } from "./types";

export interface AwardParams {
  qa_allowed?: QaVerdict[];
  include_vendors?: string[];
  exclude_vendors?: string[];
  include_deviations?: boolean;
  min_confidence?: Conf;
  mode?: "per_line" | "single_vendor";
  max_vendors?: number;
  max_share_pct?: number;
  lines?: string[];
}
const RANK: Record<Conf, number> = { low: 0, medium: 1, high: 2 };

export function optimizeAward(rfx: Rfx, cells: Cell[], summaries: VendorSummary[], history: History, p: AwardParams) {
  const qa = p.qa_allowed?.length ? p.qa_allowed : (["pass"] as QaVerdict[]);
  const minC = p.min_confidence || "low";
  const lines = rfx.lines.filter((l) => !p.lines?.length || p.lines.includes(l.id));
  const name = (id: string) => summaries.find((s) => s.vendor_id === id)?.name || id;
  const excluded: { vendor: string; reason: string }[] = [];
  const eligible = summaries.filter((s) => {
    if (p.include_vendors?.length && !p.include_vendors.includes(s.vendor_id)) { excluded.push({ vendor: s.name, reason: "not in requested vendor set" }); return false; }
    if (p.exclude_vendors?.includes(s.vendor_id)) { excluded.push({ vendor: s.name, reason: "excluded by request" }); return false; }
    if (!qa.includes(s.qa_status)) { excluded.push({ vendor: s.name, reason: `questionnaire status: ${s.qa_status}` }); return false; }
    return true;
  }).map((s) => s.vendor_id);

  const usable = (c: Cell) => c.landed_inr != null && (c.status === "quoted" || (p.include_deviations && c.status === "deviation")) && RANK[c.confidence] >= RANK[minC];
  const offer = new Map<string, Cell>();
  for (const c of cells) if (eligible.includes(c.vendor_id) && usable(c)) offer.set(`${c.vendor_id}|${c.line_id}`, c);
  const qty = (lid: string) => rfx.lines.find((l) => l.id === lid)!.annual_qty;
  const caveats: string[] = [];

  if (p.mode === "single_vendor") {
    const ranking = eligible.map((v) => {
      const covered = lines.filter((l) => offer.has(`${v}|${l.id}`));
      const total = covered.reduce((s, l) => s + offer.get(`${v}|${l.id}`)!.landed_inr! * l.annual_qty, 0);
      const fy = covered.reduce((s, l) => s + (history.prices[l.id] ?? 0) * l.annual_qty, 0);
      return { vendor_id: v, vendor: name(v), lines_covered: covered.length, lines_total: lines.length, annual_landed_inr: Math.round(total), fy26_same_lines_inr: Math.round(fy), vs_fy26_pct: fy ? +(((total - fy) / fy) * 100).toFixed(1) : null, uncovered: lines.filter((l) => !offer.has(`${v}|${l.id}`)).map((l) => l.id).join(", ") };
    }).sort((a, b) => b.lines_covered - a.lines_covered || a.annual_landed_inr - b.annual_landed_inr);
    if (ranking.some((r) => r.lines_covered < lines.length)) caveats.push("Vendors with partial coverage are not comparable on total; compare like-for-like lines with query_table.");
    return { kind: "single_vendor_ranking", eligible_vendors: eligible.map(name), excluded_vendors: excluded, ranking, caveats };
  }

  // per-line: search vendor subsets (<= 2^5) and pick best coverage, then cost
  const subsets: string[][] = [];
  for (let mask = 1; mask < 1 << eligible.length; mask++) {
    const s = eligible.filter((_, i) => mask & (1 << i));
    if (!p.max_vendors || s.length <= p.max_vendors) subsets.push(s);
  }
  let best: { subset: string[]; alloc: Map<string, string>; cost: number; uncovered: string[]; capOk: boolean } | null = null;
  for (const subset of subsets) {
    const alloc = new Map<string, string>();
    const uncovered: string[] = [];
    for (const l of lines) {
      const opts = subset.filter((v) => offer.has(`${v}|${l.id}`)).sort((a, b) => offer.get(`${a}|${l.id}`)!.landed_inr! - offer.get(`${b}|${l.id}`)!.landed_inr!);
      if (opts.length) alloc.set(l.id, opts[0]); else uncovered.push(l.id);
    }
    let capOk = true;
    if (p.max_share_pct) capOk = applyCap(alloc, subset, offer, qty, p.max_share_pct);
    const cost = [...alloc].reduce((s, [lid, v]) => s + offer.get(`${v}|${lid}`)!.landed_inr! * qty(lid), 0);
    const better = !best || (capOk && !best.capOk) || (capOk === best.capOk && (uncovered.length < best.uncovered.length || (uncovered.length === best.uncovered.length && cost < best.cost - 1)));
    if (better) best = { subset, alloc, cost, uncovered, capOk };
  }
  if (!best || !eligible.length) return { kind: "per_line_award", eligible_vendors: [], excluded_vendors: excluded, allocation: [], by_vendor: [], totals: null, uncovered: lines.map((l) => ({ line_id: l.id, reason: "no eligible vendor" })), caveats: ["No vendor is eligible under these constraints."] };
  if (p.max_share_pct && !best.capOk) caveats.push(`Could not satisfy the ${p.max_share_pct}% share cap with available offers; result is the closest feasible.`);

  // re-check conditional discounts against the allocated volume
  const allocCost = (vid: string, lid: string) => {
    const c = offer.get(`${vid}|${lid}`)!;
    return c.landed_inr!;
  };
  const adjust = new Map<string, number>(); // per vendor|line additional cost if discount lost
  for (const v of best.subset) {
    const mine = [...best.alloc].filter(([, vv]) => vv === v).map(([lid]) => lid);
    const cd = mine.map((lid) => offer.get(`${v}|${lid}`)!.conditional_discount).find(Boolean);
    if (!cd) continue;
    const monthlyGross = mine.reduce((s, lid) => s + (offer.get(`${v}|${lid}`)!.unit_inr ?? 0) * qty(lid), 0) / 12;
    if (monthlyGross < cd.threshold_monthly_inr) {
      for (const lid of mine) adjust.set(`${v}|${lid}`, offer.get(`${v}|${lid}`)!.conditional_discount?.amount_inr ?? 0);
      caveats.push(`${name(v)}'s ${cd.pct}% discount is NOT earned at this allocation (≈₹${Math.round(monthlyGross).toLocaleString("en-IN")}/month < ₹${cd.threshold_monthly_inr.toLocaleString("en-IN")}); prices shown without it.`);
    } else caveats.push(`${name(v)}'s ${cd.pct}% conditional discount holds at this allocation (≈₹${Math.round(monthlyGross).toLocaleString("en-IN")}/month).`);
  }

  const allocation = lines.filter((l) => best!.alloc.has(l.id)).map((l) => {
    const v = best!.alloc.get(l.id)!;
    const c = offer.get(`${v}|${l.id}`)!;
    const unit = +(allocCost(v, l.id) + (adjust.get(`${v}|${l.id}`) ?? 0)).toFixed(2);
    const others = eligible.filter((x) => x !== v && offer.has(`${x}|${l.id}`)).map((x) => ({ x, p: offer.get(`${x}|${l.id}`)!.landed_inr! })).sort((a, b) => a.p - b.p);
    return {
      line_id: l.id, line: l.description, annual_qty: l.annual_qty, awarded_to: name(v), landed_unit_inr: unit, annual_inr: Math.round(unit * l.annual_qty),
      runner_up: others[0] ? name(others[0].x) : "—", runner_up_unit_inr: others[0]?.p ?? null,
      fy26_unit_inr: history.prices[l.id] ?? null, confidence: c.confidence, flags: c.flags.filter((f) => !f.startsWith("Freight free")).slice(0, 2).join("; "),
    };
  });
  const total = allocation.reduce((s, a) => s + a.annual_inr, 0);
  const fy26 = allocation.reduce((s, a) => s + (a.fy26_unit_inr ?? 0) * a.annual_qty, 0);
  const by_vendor = best.subset.map((v) => {
    const rows = allocation.filter((a) => a.awarded_to === name(v));
    const spend = rows.reduce((s, a) => s + a.annual_inr, 0);
    return { vendor: name(v), lines: rows.length, annual_inr: spend, share_pct: total ? +((spend / total) * 100).toFixed(1) : 0 };
  }).filter((r) => r.lines > 0);
  const lowConf = allocation.filter((a) => a.confidence === "low").length;
  if (lowConf) caveats.push(`${lowConf} awarded line(s) rest on low-confidence prices — resolve before committing.`);
  const assumed = allocation.filter((a) => /assumed|Derived|Resolved from contract/.test(a.flags)).length;
  if (assumed) caveats.push(`${assumed} awarded line(s) include an assumption (freight %, per-kg derivation or prior-contract price).`);
  return {
    kind: "per_line_award", eligible_vendors: eligible.map(name), excluded_vendors: excluded,
    allocation, by_vendor,
    totals: { annual_landed_inr: total, lines_awarded: allocation.length, lines_total: lines.length, fy26_same_lines_inr: Math.round(fy26), savings_vs_fy26_inr: Math.round(fy26 - total), savings_vs_fy26_pct: fy26 ? +(((fy26 - total) / fy26) * 100).toFixed(1) : null, vendors_used: by_vendor.length },
    uncovered: best.uncovered.map((lid) => ({ line_id: lid, reason: "no eligible vendor quoted this line (under current filters)" })),
    caveats,
  };
}

function applyCap(alloc: Map<string, string>, subset: string[], offer: Map<string, Cell>, qty: (l: string) => number, capPct: number) {
  for (let iter = 0; iter < 200; iter++) {
    const spend = new Map<string, number>();
    let total = 0;
    for (const [lid, v] of alloc) { const x = offer.get(`${v}|${lid}`)!.landed_inr! * qty(lid); spend.set(v, (spend.get(v) || 0) + x); total += x; }
    const over = [...spend].find(([, s]) => s / total > capPct / 100 + 1e-9);
    if (!over) return true;
    const [v] = over;
    let bestMove: { lid: string; to: string; penalty: number } | null = null;
    for (const [lid, vv] of alloc) {
      if (vv !== v) continue;
      const cur = offer.get(`${v}|${lid}`)!.landed_inr!;
      for (const to of subset) {
        if (to === v || !offer.has(`${to}|${lid}`)) continue;
        const pen = (offer.get(`${to}|${lid}`)!.landed_inr! - cur) / cur;
        if (!bestMove || pen < bestMove.penalty) bestMove = { lid, to, penalty: pen };
      }
    }
    if (!bestMove) return false;
    alloc.set(bestMove.lid, bestMove.to);
  }
  return false;
}
