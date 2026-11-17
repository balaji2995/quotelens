import type { Row } from "../tables";
export interface Display { result_id: string; title: string; as: "table" | "bar" | "grouped_bar" | "stacked_bar"; columns: string[]; rows: Row[]; x?: string; y?: string[]; note?: string }
export interface TraceStep { tool: string; input: unknown; result_id?: string; summary: string }
export interface AwardScenario { result_id: string; params: Record<string, unknown>; result: AwardResult }
export interface AwardResult {
  kind: "per_line_award";
  eligible_vendors: string[];
  excluded_vendors: { vendor: string; reason: string }[];
  allocation: { line_id: string; line: string; annual_qty: number; awarded_to: string; landed_unit_inr: number; annual_inr: number; runner_up: string; runner_up_unit_inr: number | null; fy26_unit_inr: number | null; confidence: string; flags: string }[];
  by_vendor: { vendor: string; lines: number; annual_inr: number; share_pct: number }[];
  totals: { annual_landed_inr: number; lines_awarded: number; lines_total: number; fy26_same_lines_inr: number; savings_vs_fy26_inr: number; savings_vs_fy26_pct: number | null; vendors_used: number };
  uncovered: { line_id: string; reason: string }[];
  caveats: string[];
}
export interface AwardMemo {
  id: string; created_at: string; question: string; params: Record<string, unknown>; result: AwardResult;
  title: string; recommendation: string; risks: string[]; conditions: string[]; next_steps: string[];
  numberCheck: { checked: number; unverified: string[] }; assumptions: Record<string, unknown>; status: "draft" | "submitted";
}
