import type { AgentToolCall } from "../store/store";
import { useStore } from "../store/store";
import { runOpenAITurn, type ChatMessage } from "./openai";
import { runScriptedTurn } from "./scripted";

export interface AgentHandlers {
  onText: (text: string) => void;
  onCallStart: (call: AgentToolCall) => void;
  onCallEnd: (call: AgentToolCall) => void;
}

let history: ChatMessage[] = [];

export function resetAgentHistory() {
  history = [];
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Runs one turn of the in-page agent, whichever mode is active.
 *
 * Both modes reach the page the same way -- `getTools()` to discover,
 * `executeTool()` to invoke -- so switching between them changes who decides
 * what to call, and nothing else.
 */
export async function runAgentTurn(prompt: string): Promise<void> {
  const store = useStore.getState();
  if (store.agent.busy) return;

  const controller = new AbortController();
  store.pushMessage({ id: newId("u"), role: "user", text: prompt, calls: [] });

  const assistantId = newId("a");
  store.pushMessage({ id: assistantId, role: "assistant", text: "", calls: [], pending: true });
  store.setAgentBusy(true, () => controller.abort());

  const chunks: string[] = [];
  const handlers: AgentHandlers = {
    onText: (text) => {
      if (!text.trim()) return;
      chunks.push(text.trim());
      useStore.getState().updateMessage(assistantId, { text: chunks.join("\n\n") });
    },
    onCallStart: (call) => useStore.getState().upsertCall(assistantId, call),
    onCallEnd: (call) => {
      // Attribute staged edits to the call, using the ledger the registry wrote.
      const entry = useStore.getState().ledger.find((l) => l.toolName === call.name);
      useStore
        .getState()
        .upsertCall(assistantId, { ...call, editCount: entry?.editIds.length ?? 0 });
    },
  };

  try {
    const { mode, apiKey, model } = useStore.getState().agent;
    if (mode === "openai") {
      if (!apiKey) {
        handlers.onText(
          "No API key set. Add one under the key icon, or switch to the scripted planner, which needs no key and calls the same tools.",
        );
      } else {
        history = await runOpenAITurn(prompt, history, { apiKey, model }, handlers, controller.signal);
      }
    } else {
      await runScriptedTurn(prompt, handlers, controller.signal);
    }
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      handlers.onText("Stopped. Anything I had already staged is still in the review drawer.");
    } else {
      handlers.onText(`Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    useStore.getState().updateMessage(assistantId, { pending: false });
    useStore.getState().setAgentBusy(false);
  }
}
