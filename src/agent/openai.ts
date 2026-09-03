import { callTool, describeRegisteredTools } from "../webmcp/registry";
import { resultText } from "../webmcp/result";
import { SYSTEM_PROMPT } from "./prompt";
import type { AgentHandlers } from "./runtime";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

const MAX_ROUNDS = 12;

/** Fields not every model family accepts; dropped and retried on a 400. */
const OPTIONAL_FIELDS = ["parallel_tool_calls", "tool_choice"] as const;

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools: unknown[];
}

/**
 * Posts one Chat Completions request.
 *
 * Whoever runs this brings their own key and picks their own model, so the
 * request has to survive a model that rejects one of the optional fields. On a
 * 400 that names an unsupported or unrecognised parameter, the offending
 * optional field is dropped and the call retried once, rather than dead-ending
 * a judge with an opaque API error.
 */
async function postChat(
  request: ChatRequest,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ choices?: { message?: ChatMessage }[] }> {
  const body: Record<string, unknown> = {
    ...request,
    tool_choice: "auto",
    parallel_tool_calls: false,
  };

  for (let attempt = 0; attempt <= OPTIONAL_FIELDS.length; attempt++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (response.ok) return await response.json();

    const raw = await response.text();
    let detail = raw.slice(0, 400);
    let param: string | undefined;
    try {
      const parsed = JSON.parse(raw)?.error;
      detail = parsed?.message ?? detail;
      param = parsed?.param;
    } catch {
      /* keep the raw body */
    }

    const droppable = OPTIONAL_FIELDS.find(
      (field) =>
        field in body &&
        (param === field || (detail.includes(field) && /unsupported|unrecognized|not supported/i.test(detail))),
    );
    if (response.status === 400 && droppable) {
      delete body[droppable];
      continue;
    }

    const hint =
      response.status === 401
        ? " Check the API key."
        : response.status === 404
          ? ` Is "${request.model}" available on your account? Try another model in the key panel.`
          : response.status === 429
            ? " Rate limited or out of quota — wait a moment, or use the scripted planner, which needs no key."
            : "";
    throw new Error(`OpenAI API returned ${response.status}: ${detail}${hint}`);
  }

  throw new Error("OpenAI API rejected the request even after dropping optional parameters.");
}

/**
 * A bring-your-own-key agent loop over the OpenAI Chat Completions API.
 *
 * The tool list is not hardcoded: it is read from `document.modelContext`
 * every round, so tools the page registers or withdraws mid-conversation --
 * when the manager selects a shift, or once a proposal is open -- appear and
 * disappear in the model's tool list exactly as WebMCP intends.
 *
 * The key stays in this tab. It is sent to api.openai.com and nowhere else;
 * there is no backend in this project to send it to.
 */
export async function runOpenAITurn(
  prompt: string,
  history: ChatMessage[],
  config: { apiKey: string; model: string },
  handlers: AgentHandlers,
  signal: AbortSignal,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: prompt },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");

    const registered = await describeRegisteredTools();
    const tools = registered.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const data = await postChat(
      { model: config.model, messages, tools },
      config.apiKey,
      signal,
    );
    const choice = data.choices?.[0];
    const message: ChatMessage = choice?.message ?? { role: "assistant", content: "" };
    messages.push(message);

    if (message.content) handlers.onText(String(message.content));

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return messages.slice(1); // drop the system prompt from stored history
    }

    // Sequential, not parallel: each call sees the state the previous one
    // staged, and the provenance ledger stays unambiguous about ordering.
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = { _unparsed: call.function.arguments };
      }

      const readOnly = registered.find((t) => t.name === call.function.name)?.readOnly ?? false;
      handlers.onCallStart({
        id: call.id,
        name: call.function.name,
        args,
        status: "running",
        readOnly,
        editCount: 0,
      });

      const started = performance.now();
      let text: string;
      let ok = true;
      try {
        const output = await callTool(call.function.name, args, {
          caller: "in-page agent (OpenAI)",
          signal,
        });
        text = resultText(output) || "(no output)";
        ok = !output.isError;
      } catch (error) {
        ok = false;
        text = `Tool call failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      handlers.onCallEnd({
        id: call.id,
        name: call.function.name,
        args,
        status: ok ? "ok" : "error",
        result: text,
        durationMs: Math.round(performance.now() - started),
        readOnly,
        editCount: 0,
      });

      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }

  handlers.onText(
    `I stopped after ${MAX_ROUNDS} rounds of tool calls to avoid looping. Check what I have staged with the review drawer, and tell me how to carry on.`,
  );
  return messages.slice(1);
}

export type { ChatMessage };
