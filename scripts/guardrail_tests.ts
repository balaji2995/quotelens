// Adversarial checks for the normalization guardrails. Run: npx tsx scripts/guardrail_tests.ts
import { normalize, DEFAULT_ASSUMPTIONS } from "../src/lib/normalize";
import rfx from "../src/data/rfx.json";
import history from "../src/data/history.json";
import type { ExtractedLine, Layer } from "../src/lib/types";

const L = (id: string | null, price: number | null, currency = "INR", unit: ExtractedLine["price_unit"] = "per_piece", as = "item"): ExtractedLine => ({
  rfx_line_id: id, match_basis: "test", match_confidence: "high", as_written: as, price, currency, price_unit: unit, price_unit_raw: unit,
  includes_printing: true, spec_deviation: null, source_quote: `${as} ${price}`, source_location: "test", confidence: "high",
});
const layer = (lines: ExtractedLine[], extra: Partial<Layer["extraction"]> = {}): Layer => ({
  id: "t", kind: "response", received: "2026-11-12", label: "Test response", model: "test", ran_at: "", duration_ms: 0, verification: {},
  extraction: { vendor_name_detected: "Test", currency_detected: "INR", lines, rate_rules: [], questionnaire: [], documents: [], explicitly_not_quoted: [], suspicious_content: [], overall_notes: "",
    terms: { freight: { basis: "included", amount: null, condition_text: "", source_quote: "" }, discounts: [], payment_terms_days: 60, validity_days: 15, lead_time_days: 7, gst_note: "Prices are inclusive of GST", other: [] }, ...extra },
});
const fy = (id: string) => (history.prices as Record<string, number>)[id];
const tests = layer([
  L("L01", +(fy("L01") / 88).toFixed(2), "INR", "per_piece", "USD price mislabelled as INR"),
  L("L02", +(fy("L02") * 100).toFixed(0), "INR", "per_piece", "per-100 price read as per piece"),
  L("L03", fy("L03"), "Rs.", "per_piece", "currency written 'Rs.'"),
  L("L04", 0.12, "EUR", "per_piece", "quoted in EUR"),
  L("L05", fy("L05"), "INR", "per_piece", "first price"), L("L05", fy("L05") * 1.1, "INR", "per_piece", "second price"),
  L("L06", 0, "INR", "per_piece", "zero price"),
  L("L07", +(fy("L07") / 88).toFixed(2), "USD", "per_piece", "one USD line in an INR response"),
  L(null, 12.5, "INR", "per_piece", "Mystery box 999x999x999"),
]);
const vendors = [{ id: "VT", name: "Test vendor", city: "", contact: "" }];
const run = (a = DEFAULT_ASSUMPTIONS) => normalize(rfx as never, vendors, history as never, { VT: [tests] }, a);
const { cells, summaries, issues } = run();
const cell = (id: string) => cells.find((c) => c.line_id === id)!;
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail: string) => results.push([name, ok, detail]);
const has = (id: string, re: RegExp) => cell(id).flags.some((f) => re.test(f));

check("USD mislabelled as INR is caught", has("L01", /^Implausible/) && cell("L01").confidence === "low", cell("L01").flags.find((f) => /Implausible/.test(f)) ?? "");
check("Per-100 read as per piece is caught", has("L02", /^Implausible/) && cell("L02").confidence === "low", cell("L02").flags.find((f) => /Implausible/.test(f)) ?? "");
check("'Rs.' treated as INR, no false alarm", cell("L03").landed_inr != null && !has("L03", /Implausible|mix-up|Quoted in/), `landed ₹${cell("L03").landed_inr}`);
check("EUR is not silently converted", cell("L04").status === "unresolved" && has("L04", /Quoted in EUR/), cell("L04").flags.find((f) => /EUR/.test(f)) ?? "");
check("Two prices for one line flagged", has("L05", /different prices/) && cell("L05").confidence === "low", cell("L05").flags.find((f) => /different prices/.test(f)) ?? "");
check("Zero price not treated as a real price", cell("L06").status === "unresolved" && cell("L06").landed_inr == null, cell("L06").flags.find((f) => /zero/.test(f)) ?? "");
check("Single USD line in INR response flagged", has("L07", /currency mix-up/), cell("L07").flags.find((f) => /mix-up/.test(f)) ?? "");
check("GST-inclusive note flagged on every priced line", cells.filter((c) => c.landed_inr != null).every((c) => c.flags.some((f) => /include GST/.test(f))), "");
check("Unmatched item surfaced, not dropped", summaries[0].unmatched_items.length === 1 && issues.some((i) => i.topic === "Items we couldn't match"), summaries[0].unmatched_items.join("; "));
check("Short validity raised as a clarification", issues.some((i) => i.topic === "Quote validity"), issues.find((i) => i.topic === "Quote validity")?.detail ?? "");
check("Unit/currency errors become a vendor question", issues.some((i) => i.topic === "Possible unit or currency error" && i.lines.includes("L01") && i.lines.includes("L02")), "");
const zeroFx = run({ ...DEFAULT_ASSUMPTIONS, fx_usd_inr: 0 });
const c7 = zeroFx.cells.find((c) => c.line_id === "L07")!;
check("FX of 0 doesn't make USD prices free", c7.landed_inr == null && c7.flags.some((f) => /no valid exchange rate/.test(f)), c7.flags.find((f) => /exchange rate/.test(f)) ?? "");

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`);
console.log(`\n${results.filter((r) => r[1]).length}/${results.length} passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
