import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.QUOTELENS_MODEL || "claude-sonnet-5-5";
export const FAST_MODEL = process.env.QUOTELENS_FAST_MODEL || "claude-haiku-5-5";

let _c: Anthropic | null = null;
export function claude() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server");
  if (!_c) _c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return _c;
}

/** Calls the model with a single forced tool and returns its input. Streams to avoid long-request timeouts. */
export async function forcedTool<T>(opts: {
  system: string; content: Anthropic.ContentBlockParam[]; tool: Anthropic.Tool; maxTokens?: number; model?: string;
}): Promise<{ data: T; usage: Anthropic.Usage; model: string }> {
  let last: Anthropic.Message | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = claude().messages.stream({
      model: opts.model || MODEL,
      max_tokens: opts.maxTokens || 16000,
      system: `${opts.system}\n\nYou MUST respond by calling the \`${opts.tool.name}\` tool exactly once with complete input. Do not answer in plain text.`,
      tools: [opts.tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: opts.content }],
    });
    const msg = await stream.finalMessage();
    last = msg;
    if (msg.stop_reason === "max_tokens") throw new Error("Extraction truncated (max_tokens)");
    const block = msg.content.find((b) => b.type === "tool_use");
    if (block && block.type === "tool_use") return { data: block.input as T, usage: msg.usage, model: msg.model };
  }
  throw new Error("Model did not return structured output: " + JSON.stringify(last?.content).slice(0, 300));
}
