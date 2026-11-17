// ---------- RFx ----------
export type Uom = "pc" | "set" | "kg";
export interface RfxLine {
  id: string;
  kind: "RSC" | "tray" | "partition" | "pad" | "roll" | string;
  description: string;
  ply: number | null;
  dims_mm: number[] | null;
  board: string;
  print_colours: number;
  uom: Uom;
  annual_qty: number;
  spec_weight_g: number | null;
}
export interface Question {
  id: string;
  text: string;
  type: "yes_no" | "number" | "text";
  knockout: boolean;
  requirement: string;
}
export interface Rfx {
  id: string;
  title: string;
  category: string;
  buyer: { company: string; plant: string; buyer: string };
  issue_date: string;
  due_date: string;
  currency: string;
  scope: string;
  terms: Record<string, string>;
  lines: RfxLine[];
  questionnaire: Question[];
}
export interface Vendor { id: string; name: string; city: string; contact: string }
export interface History { contract: string; vendor_id: string; vendor: string; period: string; basis: string; prices: Record<string, number> }

// ---------- Extraction (what the model returns) ----------
export type Conf = "high" | "medium" | "low";
export type PriceUnit = "per_piece" | "per_set" | "per_100" | "per_1000" | "per_kg" | "per_sheet" | "other";

export interface ExtractedLine {
  rfx_line_id: string | null;
  match_basis: string;
  match_confidence: Conf;
  as_written: string;
  price: number | null;
  currency: string;
  price_unit: PriceUnit;
  price_unit_raw: string;
  includes_printing: boolean | null;
  spec_deviation: string | null;
  source_quote: string;
  source_location: string;
  confidence: Conf;
  notes?: string;
}
export interface RateRule {
  kind: "rate_per_kg" | "reference_previous_contract" | "print_surcharge_per_colour" | "other";
  scope_description: string;
  ply: number | null; // null = any
  applies_to_kinds: string[]; // e.g. ["RSC","tray"]; empty = any not otherwise quoted
  rate: number | null;
  currency: string;
  includes_printing: boolean | null;
  source_quote: string;
  confidence: Conf;
}
export interface Discount {
  percent: number;
  condition_type: "unconditional" | "monthly_value_threshold" | "annual_value_threshold" | "other";
  threshold_amount_inr: number | null;
  condition_text: string;
  source_quote: string;
}
export interface Freight {
  basis: "included" | "extra_at_actuals" | "extra_per_unit" | "extra_percent" | "conditional_free" | "unknown";
  amount: number | null; // per piece in vendor currency or percent
  condition_text: string;
  source_quote: string;
}
export interface QAnswer {
  question_id: string;
  answer: string;
  normalized: "yes" | "no" | "partial" | "unknown" | string;
  evidence_quote: string;
  confidence: Conf;
}
export interface DocFinding {
  document: string;
  doc_type: "iso_certificate" | "test_report" | "other";
  issued_to: string;
  valid_until: string | null; // YYYY-MM-DD
  finding: string;
}
export interface Extraction {
  vendor_name_detected: string;
  currency_detected: string;
  lines: ExtractedLine[];
  rate_rules: RateRule[];
  terms: {
    freight: Freight | null;
    discounts: Discount[];
    payment_terms_days: number | null;
    validity_days: number | null;
    lead_time_days: number | null;
    gst_note: string;
    other: string[];
  };
  questionnaire: QAnswer[];
  documents: DocFinding[];
  explicitly_not_quoted: string[];
  suspicious_content: { quote: string; why: string }[];
  overall_notes: string;
}

/** One extraction "layer" — the original response, or a clarification reply. Later layers override earlier ones. */
export interface Layer {
  id: string;
  kind: "response" | "clarification";
  received: string;
  label: string;
  model: string;
  ran_at: string;
  duration_ms: number;
  extraction: Extraction;
  verification: Record<string, { quote_found: boolean | null; number_in_quote: boolean | null; second_read?: number | null }>;
  source_text?: string; // text the model saw (for provenance view), when text-based
}

// ---------- Normalized ----------
export interface Step { label: string; value?: number }
export interface Cell {
  vendor_id: string;
  line_id: string;
  status: "quoted" | "missing" | "unresolved" | "deviation";
  unit_inr: number | null; // ex-GST per RFx UoM, before discount & freight
  discount_inr: number;
  freight_inr: number;
  landed_inr: number | null; // per RFx UoM
  annual_landed_inr: number | null;
  confidence: Conf;
  flags: string[];
  steps: Step[];
  source: { quote: string; location: string; layer: string; file?: string } | null;
  overridden?: { by: string; previous: number | null };
  conditional_discount?: { pct: number; threshold_monthly_inr: number; amount_inr: number };
}
export type QaVerdict = "pass" | "fail" | "unverified" | "conflict";
export interface VendorSummary {
  vendor_id: string;
  name: string;
  qa_status: QaVerdict;
  qa_detail: { qid: string; verdict: QaVerdict; why: string }[];
  lines_quoted: number;
  lines_missing: string[];
  lines_deviation: string[];
  lines_unresolved: string[];
  unmatched_items: string[];
  validity_days: number | null;
  payment_days: number | null;
  freight_text: string;
  discount_text: string;
  lead_time_days: number | null;
  total_landed_quoted_inr: number;
  low_conf_cells: number;
  suspicious: string[];
}
export interface Assumptions {
  fx_usd_inr: number;
  freight_at_actuals_pct: number;
  apply_conditional_discounts: boolean;
  accept_spec_deviations: boolean;
  contract_start: string;
}
export interface Issue {
  id: string;
  vendor_id: string;
  severity: "blocker" | "major" | "minor";
  topic: string;
  detail: string;
  lines: string[];
  question: string;
}
