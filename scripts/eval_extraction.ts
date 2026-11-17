// Scores the live extraction + normalization against the generator's ground truth.
// Usage: npx tsx scripts/eval_extraction.ts
import fs from "node:fs";
import { normalize, DEFAULT_ASSUMPTIONS } from "../src/lib/normalize";
import rfx from "../src/data/rfx.json";
import vendors from "../src/data/vendors.json";
import history from "../src/data/history.json";

const snap = JSON.parse(fs.readFileSync("src/data/snapshot.json", "utf8"));
const { truth, fx_vendor_used } = JSON.parse(fs.readFileSync("scripts/ground_truth/truth.json", "utf8"));
const { cells, summaries, issues } = normalize(rfx as never, vendors, history, snap.layers, { ...DEFAULT_ASSUMPTIONS, fx_usd_inr: fx_vendor_used, accept_spec_deviations: true });

function expected(v: string, line: string): number | null {
  const t = truth[v]?.[line];
  if (!t) return null;
  if (t.price != null) return t.price;
  if (t.derived_price != null) return t.derived_price;
  if (t.price_usd_per_1000 != null) return (t.price_usd_per_1000 / 1000) * fx_vendor_used;
  if (t.price_usd != null) return t.price_usd * fx_vendor_used;
  return null;
}
let tot = 0, exact = 0, wrong = 0, missedPresent = 0, falsePresent = 0;
const rows: string[] = [];
for (const v of Object.keys(truth)) {
  for (const line of rfx.lines) {
    const exp = expected(v, line.id);
    const c = cells.find((x) => x.vendor_id === v && x.line_id === line.id);
    const got = c?.unit_inr ?? null;
    tot++;
    if (exp == null && got == null) { exact++; continue; }
    if (exp == null && got != null) { falsePresent++; rows.push(`${v} ${line.id}: expected none, got ${got} [${c?.flags.join("; ")}]`); continue; }
    if (exp != null && got == null) { missedPresent++; rows.push(`${v} ${line.id}: expected ${exp.toFixed(2)}, got none (${c?.status})`); continue; }
    if (Math.abs(exp! - got!) / exp! <= 0.005) exact++;
    else { wrong++; rows.push(`${v} ${line.id}: expected ${exp!.toFixed(2)}, got ${got} conf=${c?.confidence} [${c?.flags.join("; ")}]`); }
  }
}
console.log(rows.join("\n"));
console.log(`\nCells: ${tot}  correct(±0.5%)=${exact}  wrong=${wrong}  missed=${missedPresent}  invented=${falsePresent}`);
const wrongLow = rows.length;
console.log(summaries.map((s) => `${s.vendor_id} QA=${s.qa_status} quoted=${s.lines_quoted} missing=${s.lines_missing.length} dev=${s.lines_deviation.length} lowconf=${s.low_conf_cells} susp=${s.suspicious.length} | ${s.qa_detail.map((d) => d.qid + ":" + d.verdict).join(" ")} | freight=${s.freight_text} | disc=${s.discount_text}`).join("\n"));
console.log(`issues: ${issues.length}`, wrongLow ? "" : "");
