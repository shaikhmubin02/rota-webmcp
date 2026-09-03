import type { LedgerEntry } from "../types";
import { useStore } from "../store/store";
import { beginCall, endCall, type RotaTool } from "./ctx";
import { ResolveError } from "./resolve";
import { errorResult, resultText, type ToolResult } from "./result";
import { coerceArgs } from "./schema";
import { installWebMCPShim, shimInfo } from "./shim";
import { readTools } from "./tools.read";
import { contextualTools, nextWeekTool, timeOffTool, viewTools } from "./tools.view";
import { writeTools } from "./tools.write";

/** Registered only while a proposal is open, so excluded from the base set. */
export const PROPOSAL_SCOPED = new Set(["revise_proposal", "describe_pending_changes"]);

export const baseTools: RotaTool[] = [...readTools, ...writeTools, ...viewTools].filter(
  (t) => !PROPOSAL_SCOPED.has(t.name),
);

/** Every tool the app can ever register, for documentation and the inspector. */
export function allKnownTools(): RotaTool[] {
  return [
    ...baseTools,
    ...contextualTools({ shiftId: "example", staffId: "example" }),
    timeOffTool(),
    nextWeekTool(),
  ];
}

/* -- caller attribution ---------------------------------------------------- */

let callerLabel = "external agent";
let callSeq = 0;

/**
 * Rota's own in-page agent announces itself before invoking a tool, so the
 * provenance ledger can distinguish "the agent in the side panel did this" from
 * "something outside the page did this". Anything that arrives without
 * announcing itself is a browser-integrated or extension agent reaching in
 * through `document.modelContext`, and is labelled as such.
 */
export function withCaller<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const previous = callerLabel;
  callerLabel = label;
  return fn().finally(() => {
    callerLabel = previous;
  });
}

/* -- instrumentation ------------------------------------------------------- */

/**
 * Wraps a tool so that every invocation is timed, argument-coerced, recorded in
 * the provenance ledger with the edits it produced, and -- crucially -- cannot
 * throw an opaque exception at the agent.
 *
 * Errors come back as `isError` results carrying the message, because a model
 * that receives "Marco is not certified as Baker" recovers on its next turn,
 * whereas one that receives a rejected promise usually just gives up.
 */
function instrument(tool: RotaTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    async execute(rawArgs: Record<string, unknown>, options: { signal: AbortSignal }) {
      callSeq += 1;
      const callId = `c${callSeq}`;
      const caller = callerLabel;
      const started = performance.now();
      beginCall(callId, caller);

      let output: ToolResult;
      let ok = true;
      let coercionNotes: string[] = [];

      try {
        const coerced = coerceArgs(tool.inputSchema, rawArgs);
        coercionNotes = coerced.coercions;
        if (!coerced.ok) {
          ok = false;
          output = errorResult(
            `Invalid arguments for ${tool.name}: ${coerced.errors.join("; ")}. Check the input schema and try again.`,
          );
        } else {
          if (options.signal?.aborted) {
            ok = false;
            output = errorResult("Cancelled before it started.");
          } else {
            output = (await tool.execute(coerced.value, options)) as ToolResult;
            ok = !output?.isError;
          }
        }
      } catch (error) {
        ok = false;
        // A resolve failure is expected traffic, not a crash: the model guessed
        // a name or a date and the page is telling it the valid options.
        output =
          error instanceof ResolveError
            ? errorResult(error.message)
            : errorResult(
                `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
              );
        if (!(error instanceof ResolveError)) console.error(`[rota] ${tool.name} threw`, error);
      }

      const edits = endCall();
      const entry: LedgerEntry = {
        id: callId,
        at: Date.now(),
        toolName: tool.name,
        origin: location.origin,
        caller,
        args: rawArgs,
        result: resultText(output).slice(0, 1200),
        ok,
        durationMs: Math.round(performance.now() - started),
        readOnly: Boolean(tool.annotations?.readOnlyHint),
        editIds: edits.map((e) => e.id),
      };
      useStore.getState().log(entry);

      if (coercionNotes.length > 0) {
        output = {
          ...output,
          content: [
            ...output.content,
            { type: "text", text: `(Arguments adjusted: ${coercionNotes.join("; ")}.)` },
          ],
        };
      }
      return output;
    },
  };
}

/* -- registration ---------------------------------------------------------- */

let baseController: AbortController | null = null;
let contextualController: AbortController | null = null;

async function registerSet(
  tools: RotaTool[],
  controller: AbortController,
  exposedTo: string[],
): Promise<void> {
  const mc = document.modelContext;
  if (!mc) return;
  for (const tool of tools) {
    // `registerTool` is awaited per tool, so a teardown part-way through this
    // loop must abandon the rest of it.
    if (controller.signal.aborted) return;
    try {
      await mc.registerTool(instrument(tool) as never, {
        signal: controller.signal,
        ...(exposedTo.length ? { exposedTo } : {}),
      });
    } catch (error) {
      console.error(`[rota] could not register ${tool.name}`, error);
    }
  }
}

async function refreshToolNames() {
  const mc = document.modelContext;
  if (!mc) return;
  try {
    const tools = await mc.getTools();
    useStore.getState().setToolNames(tools.map((t) => t.name).sort());
  } catch (error) {
    console.error("[rota] getTools failed", error);
  }
}

/**
 * Boots WebMCP for the page: installs the polyfill if needed, registers the
 * base tool set, and then keeps the contextual tool set in step with what the
 * manager has selected.
 *
 * Returns a teardown function.
 */
export function startWebMCP(): () => void {
  installWebMCPShim();
  const mc = document.modelContext;
  if (!mc) {
    console.warn("[rota] no modelContext available; agent features are disabled");
    return () => {};
  }

  const onToolChange = () => void refreshToolNames();
  mc.addEventListener("toolchange", onToolChange);

  baseController = new AbortController();
  void registerSet(baseTools, baseController, useStore.getState().exposedOrigins).then(
    refreshToolNames,
  );

  let lastKey = "";
  const syncContextual = async () => {
    const state = useStore.getState();
    const hasPendingTimeOff = Object.values(state.roster.staff).some((p) =>
      p.timeOff.some((t) => t.status === "pending"),
    );
    const proposalOpen = Boolean(state.proposal && state.proposal.edits.length > 0);
    const key = [
      state.selection.shiftId ?? "",
      state.selection.staffId ?? "",
      hasPendingTimeOff ? "off" : "",
      proposalOpen ? "prop" : "",
      state.exposedOrigins.join(","),
    ].join("|");
    if (key === lastKey) return;
    lastKey = key;

    contextualController?.abort();
    contextualController = new AbortController();

    const tools = [
      ...contextualTools(state.selection),
      ...(hasPendingTimeOff ? [timeOffTool()] : []),
    ];
    // `describe_pending_changes` and `revise_proposal` are only meaningful while
    // there is something staged, so they come and go with the proposal.
    if (proposalOpen) {
      tools.push(
        ...[...writeTools, ...viewTools].filter((t) => PROPOSAL_SCOPED.has(t.name)),
      );
    }
    await registerSet(tools, contextualController, state.exposedOrigins);
    await refreshToolNames();
  };

  void syncContextual();
  const unsubscribe = useStore.subscribe(() => void syncContextual());

  return () => {
    unsubscribe();
    mc.removeEventListener("toolchange", onToolChange);
    baseController?.abort();
    contextualController?.abort();
    baseController = null;
    contextualController = null;
  };
}

/**
 * Re-registers the base tool set. Called when the manager changes which origins
 * the tools are exposed to, since `exposedTo` is fixed at registration time.
 */
export async function reregisterBase(): Promise<void> {
  if (!document.modelContext) return;
  baseController?.abort();
  baseController = new AbortController();
  await registerSet(baseTools, baseController, useStore.getState().exposedOrigins);
  await refreshToolNames();
}

/* -- invocation ------------------------------------------------------------ */

/**
 * Invokes a tool the way an agent would: through `document.modelContext`.
 *
 * Rota's in-page agent deliberately does not hold references to its own tool
 * functions. It discovers tools with `getTools()` and calls them with
 * `executeTool()`, exactly as an external agent must. That means the code path
 * exercised in the demo is the same one a browser agent takes, and a bug in the
 * integration shows up in our own UI rather than only in someone else's client.
 */
export async function callTool(
  name: string,
  args: unknown,
  options: { caller: string; signal?: AbortSignal } = { caller: "in-page agent" },
): Promise<ToolResult> {
  const mc = document.modelContext;
  if (!mc) return errorResult("WebMCP is not available in this browser.");

  return withCaller(options.caller, async () => {
    const tools = await mc.getTools();
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return errorResult(
        `No tool named "${name}" is registered right now. Available: ${tools.map((t) => t.name).join(", ")}.`,
      );
    }
    const exec = (mc as unknown as {
      executeTool?: (t: unknown, a: unknown, o?: unknown) => Promise<unknown>;
    }).executeTool;
    if (typeof exec !== "function") {
      return errorResult(
        "This browser exposes registerTool but not executeTool, so the in-page agent cannot invoke tools. Drive the page from ChatGPT Desktop or Chrome instead.",
      );
    }
    const raw = await exec.call(mc, tool, args, options.signal ? { signal: options.signal } : undefined);
    return (raw ?? { content: [] }) as ToolResult;
  });
}

/** Tool descriptors for the in-page agent's planner, from the live registry. */
export async function describeRegisteredTools(): Promise<
  { name: string; description: string; inputSchema: unknown; readOnly: boolean }[]
> {
  const mc = document.modelContext;
  if (!mc) return [];
  const tools = await mc.getTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    readOnly: Boolean(t.annotations?.readOnlyHint),
  }));
}

export function webmcpStatus(): { native: boolean; shim: boolean; crossOrigin: boolean } {
  const info = shimInfo();
  return {
    native: Boolean(document.modelContext) && !info.installed,
    shim: info.installed,
    crossOrigin: info.crossOriginMediation,
  };
}
