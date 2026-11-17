import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, forcedTool, MODEL } from "./claude";
import personas from "@/data/personas.json";
import type { Issue, Rfx, Vendor } from "../types";

// ------------------------------------------------ clarification email drafter
export async function draftClarification(rfx: Rfx, vendor: Vendor, issues: Issue[], buyerNote?: string) {
  const { data } = await forcedTool<{ subject: string; body: string; internal_note: string }>({
    system: `You draft vendor clarification emails for a procurement buyer at ${rfx.buyer.company}. Goals: get every open point answered in ONE round-trip; make it easy to reply (numbered questions, reference RFx line ids, ask for explicit numbers and units); stay courteous and neutral; never reveal other vendors' prices, names, or our ranking; never promise award. Indian business English. Keep it short.`,
    content: [{ type: "text", text: `RFx ${rfx.id} — ${rfx.title}. Vendor: ${vendor.name} (contact ${vendor.contact}). Reply deadline: 2 working days.\n\nOpen points detected by the system (severity, topic, detail, suggested question):\n${issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.topic} — ${i.detail}${i.lines.length ? ` (lines ${i.lines.join(", ")})` : ""}\n   Suggested question: ${i.question}`).join("\n")}\n${buyerNote ? `\nBuyer's note: ${buyerNote}` : ""}\n\nRelevant RFx lines:\n${rfx.lines.filter((l) => issues.some((i) => i.lines.includes(l.id))).map((l) => `${l.id}: ${l.description}`).join("\n")}` }],
    tool: {
      name: "clarification_email", description: "The email to send",
      input_schema: { type: "object", required: ["subject", "body", "internal_note"], properties: { subject: { type: "string" }, body: { type: "string" }, internal_note: { type: "string", description: "One line for the buyer: what matters most in this clarification and why" } } },
    },
    maxTokens: 3000,
  });
  return data;
}

// ------------------------------------------------ simulated vendor (plumbing stub: plays the vendor)
export async function simulateVendorReply(vendor: Vendor, email: string) {
  const p = (personas as Record<string, { style: string; facts: string }>)[vendor.id];
  const msg = await claude().messages.create({
    model: MODEL, max_tokens: 1500,
    system: `You are role-playing ${vendor.contact} of ${vendor.name}, a corrugated-box vendor in Maharashtra, replying to a buyer's clarification email. Writing style: ${p?.style ?? "brief, business-like"}. Ground truth about your company (answer consistently with these facts; if asked something not covered, give a plausible short answer or say you'll revert): ${p?.facts ?? "none"}. Reply as a real vendor would by email: plain text, no markdown, may not answer in the same order, may be terse. Do not mention you are an AI.`,
    messages: [{ role: "user", content: email }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
}

// ------------------------------------------------ RFx co-pilot
const RFX_TOOL: Anthropic.Tool = {
  name: "update_rfx",
  description: "Apply edits to the RFx draft. Use only when the buyer asks for a change or confirms a suggestion.",
  input_schema: {
    type: "object", required: ["ops"],
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object", required: ["op"],
          properties: {
            op: { type: "string", enum: ["set_header", "set_term", "add_line", "update_line", "remove_line", "add_question", "update_question", "remove_question", "replace_all_lines"] },
            field: { type: "string", description: "set_header: title|scope|category|due_date; set_term: term key" },
            value: { type: "string" },
            line: { type: "object", description: "For add/update_line: {id?, kind, description, ply, dims_mm, print_colours, uom (pc|set|kg), annual_qty, spec_weight_g}" },
            lines: { type: "array", items: { type: "object" }, description: "For replace_all_lines" },
            id: { type: "string" },
            question: { type: "object", description: "{id?, text, type (yes_no|number|text), knockout, requirement}" },
          },
        },
      },
    },
  },
};

export async function copilotTurn(rfx: Rfx, history: { role: "user" | "assistant"; content: string }[], message: string) {
  const system = `You are an RFx co-pilot for a category buyer in an Indian FMCG/manufacturing company. You help them talk an RFx into existence: scope, line items with specs that vendors can price unambiguously, a supplier questionnaire with sensible knockouts, and commercial terms.
Be brief: replies under ~200 words. For a review, give only the top 3 issues as a numbered list (one line of why + one line of fix each), then offer to apply them. Be an opinionated expert: point out ambiguity that will cause messy quotes later (missing UoM, no spec weight for per-kg pricing, printing not specified, freight basis, currency, GST basis, price validity, escalation clause). Ask at most 2 questions at a time. When the buyer agrees or asks, apply changes with update_rfx and then summarise what changed in 1–3 lines.
For corrugated packaging, a good line spec has: type (RSC/tray/partition/pad/roll), internal dims in mm, ply, BF/GSM, print colours, UoM, annual qty, and a reference box weight in grams.

Current RFx draft (JSON):\n${JSON.stringify({ ...rfx, lines: rfx.lines.map((l) => [l.id, l.description, l.uom, l.annual_qty, l.spec_weight_g].join(" | ")) })}`;
  const messages: Anthropic.MessageParam[] = [...history.slice(-10).map((m) => ({ role: m.role, content: m.content })), { role: "user", content: message }];
  const ops: unknown[] = [];
  let text = "";
  for (let i = 0; i < 4; i++) {
    const msg = await claude().messages.create({ model: MODEL, max_tokens: 6000, system, tools: [RFX_TOOL], messages });
    messages.push({ role: "assistant", content: msg.content });
    text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n") || text;
    const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) break;
    for (const u of uses) ops.push(...((u.input as { ops: unknown[] }).ops || []));
    messages.push({ role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: "applied" })) });
  }
  return { text, ops };
}

// ------------------------------------------------ award memo writer (narrative only; figures come from the scenario)
import { checkNumbers } from "./analyst";
import type { AwardResult } from "./analyst-types";
export async function writeAwardMemo(rfx: Rfx, question: string, params: Record<string, unknown>, result: AwardResult, assumptions: Record<string, unknown>) {
  const { data } = await forcedTool<{ title: string; recommendation: string; risks: string[]; conditions: string[]; next_steps: string[] }>({
    system: `You write award recommendation memos for a procurement buyer to send to their VP. The award scenario below was computed deterministically; it is the single source of truth. Use ONLY figures that appear in it (you may restate them in lakh/crore, rounded). Do not compute new numbers. Be specific and brief: the VP reads this in two minutes. Name the vendors and what each gets. State what the recommendation depends on and what must happen before POs are issued. Neutral, factual, Indian business English.`,
    content: [{ type: "text", text: `RFx ${rfx.id}: ${rfx.title} for ${rfx.buyer.company}.\nQuestion that produced this scenario: "${question}"\nScenario parameters: ${JSON.stringify(params)}\nBuyer assumptions in effect: ${JSON.stringify(assumptions)}\n\nSCENARIO RESULT:\n${JSON.stringify({ ...result, allocation: result.allocation.map((a) => ({ line_id: a.line_id, awarded_to: a.awarded_to, annual_inr: a.annual_inr, confidence: a.confidence, flags: a.flags })) })}` }],
    tool: {
      name: "award_memo", description: "The memo",
      input_schema: {
        type: "object", required: ["title", "recommendation", "risks", "conditions", "next_steps"],
        properties: {
          title: { type: "string", description: "e.g. 'Recommend 3-vendor split for CY2027 corrugated'" },
          recommendation: { type: "string", description: "One paragraph, 3–5 sentences: what to award to whom, total, saving vs last year, why" },
          risks: { type: "array", items: { type: "string" }, description: "3–5 specific risks, each one sentence" },
          conditions: { type: "array", items: { type: "string" }, description: "What must be confirmed before POs (e.g. written confirmation of specific prices)" },
          next_steps: { type: "array", items: { type: "string" }, description: "2–4 actions with owners (buyer / vendor / VP)" },
        },
      },
    },
    maxTokens: 3000,
  });
  const pool: number[] = [];
  const walk = (x: unknown) => { if (typeof x === "number") pool.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
  walk(result);
  const allText = [data.recommendation, ...data.risks, ...data.conditions, ...data.next_steps].join("\n");
  return { ...data, numberCheck: checkNumbers(allText, pool) };
}
