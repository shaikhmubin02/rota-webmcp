import type { Edit } from "../types";
import type { Roster } from "../engine/rules";
import { previewRoster, useStore } from "../store/store";
import type { JsonSchema } from "./schema";
import type { ToolResult } from "./result";

export interface RotaTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  /** Grouping for the in-app tool inspector and the generated docs. */
  group: "read" | "write" | "view" | "meta";
  /** Only registered while some condition holds. Documented, not enforced here. */
  contextual?: string;
  execute: (
    args: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => ToolResult | Promise<ToolResult>;
}

/**
 * Every tool reads and writes the *preview* roster: the committed schedule plus
 * whatever the current proposal has staged.
 *
 * That choice is what lets an agent build a multi-step plan. `assign_staff`
 * then `validate_schedule` reports on the schedule as the agent is proposing
 * it, not the untouched one, so the agent can check its own work before asking
 * the manager to approve anything.
 */
export function ctx(): { roster: Roster; today: string } {
  const state = useStore.getState();
  return { roster: previewRoster(state), today: state.today };
}

/** The committed roster, ignoring staged edits. */
export function committed(): Roster {
  return useStore.getState().roster;
}

/**
 * Tool calls run inside an invocation frame that knows its own call id, so any
 * edits they stage are attributable in the provenance ledger.
 */
let activeCall: { id: string; author: string; edits: Edit[] } | null = null;

export function beginCall(id: string, author: string) {
  activeCall = { id, author, edits: [] };
  return activeCall;
}

export function endCall(): Edit[] {
  const edits = activeCall?.edits ?? [];
  activeCall = null;
  return edits;
}

export function editContext() {
  return {
    sourceCallId: activeCall?.id ?? "direct",
    author: activeCall?.author ?? "user",
  };
}

/** Stages edits onto the open proposal and records them against this call. */
export function stageEdits(edits: (Edit | null)[], intent?: string): Edit[] {
  const real = edits.filter((e): e is Edit => e !== null);
  if (real.length === 0) return [];
  useStore.getState().stage(real, intent);
  if (activeCall) activeCall.edits.push(...real);
  return real;
}
