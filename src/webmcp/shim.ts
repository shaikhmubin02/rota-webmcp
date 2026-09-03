/**
 * A WebMCP polyfill for `document.modelContext`.
 *
 * WebMCP ships today behind a Chrome 149 / Edge 150 origin trial, in ChatGPT
 * Desktop, and in Brave's Leo. That is a narrow window for anyone judging a
 * hackathon on whatever browser they happen to have open.
 *
 * So Rota installs this shim when -- and only when -- `document.modelContext`
 * is missing. It implements the same surface the explainer specifies:
 * `registerTool`, `getTools`, `executeTool`, the `toolchange` event, unregister
 * via `AbortSignal`, and `exposedTo` / `fromOrigins` origin gating. The
 * application code above it cannot tell the difference, and neither can Rota's
 * own in-page agent: it goes through `document.modelContext` in both cases.
 *
 * Deliberate limitation, stated plainly: a page script cannot mediate calls
 * between two genuinely cross-origin documents. Only a browser can do that. The
 * shim therefore enforces `exposedTo` and `fromOrigins` for callers inside this
 * document, and reports `crossOriginMediation: false` so the UI can say so
 * rather than pretending otherwise.
 */

import { coerceArgs, isValidToolName, type JsonSchema } from "./schema";

type ExecuteCallback = (
  input: Record<string, unknown>,
  options: { signal: AbortSignal },
) => unknown | Promise<unknown>;

interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface ModelContextToolInit {
  name: string;
  title?: string;
  description: string;
  inputSchema?: JsonSchema;
  execute: ExecuteCallback;
  annotations?: ToolAnnotations;
}

interface RegisteredToolLike {
  name: string;
  title: string;
  description: string;
  inputSchema?: JsonSchema;
  window: Window;
  origin: string;
  annotations?: ToolAnnotations;
}

interface Entry {
  init: ModelContextToolInit;
  exposedTo: string[] | null;
  abort?: () => void;
}

export interface ShimInfo {
  installed: boolean;
  crossOriginMediation: boolean;
}

const REGISTRY = new Map<string, Entry>();

function domException(message: string, name: string): DOMException {
  return new DOMException(message, name);
}

function toRegistered(entry: Entry): RegisteredToolLike {
  return {
    name: entry.init.name,
    title: entry.init.title ?? entry.init.name,
    description: entry.init.description,
    inputSchema: entry.init.inputSchema,
    window,
    origin: location.origin,
    annotations: entry.init.annotations,
  };
}

class ShimModelContext extends EventTarget {
  ontoolchange: ((this: unknown, ev: Event) => unknown) | null = null;

  constructor() {
    super();
    this.addEventListener("toolchange", (ev) => this.ontoolchange?.call(this, ev));
  }

  async registerTool(
    tool: ModelContextToolInit,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void> {
    if (!tool || typeof tool !== "object") {
      throw new TypeError("registerTool requires a tool dictionary");
    }
    if (!isValidToolName(tool.name)) {
      throw new TypeError(
        `Invalid tool name ${JSON.stringify(tool.name)}: expected 1-128 characters of A-Z, a-z, 0-9, "_", "-" or ".".`,
      );
    }
    if (typeof tool.description !== "string" || tool.description.length === 0) {
      throw new TypeError(`Tool "${tool.name}" needs a non-empty description.`);
    }
    if (typeof tool.execute !== "function") {
      throw new TypeError(`Tool "${tool.name}" needs an execute callback.`);
    }
    for (const origin of options?.exposedTo ?? []) {
      // The spec restricts `exposedTo` to secure origins.
      if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        throw domException(
          `exposedTo origin "${origin}" is not a secure origin.`,
          "NotAllowedError",
        );
      }
    }

    // Bail out before touching the registry at all if the caller's signal is
    // already aborted. Checking this later would let a stale, still-unwinding
    // registration loop detach or replace a live entry on its way out -- which
    // is exactly what React's StrictMode double-mount produces.
    if (options?.signal?.aborted) return;

    // Re-registering a name replaces the previous definition, matching the
    // explainer's "registered, unregistered, or updated" language.
    REGISTRY.get(tool.name)?.abort?.();

    const entry: Entry = { init: tool, exposedTo: options?.exposedTo ?? null };
    if (options?.signal) {
      const onAbort = () => {
        if (REGISTRY.get(tool.name) === entry) {
          REGISTRY.delete(tool.name);
          this.#fireToolChange();
        }
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      entry.abort = () => options.signal!.removeEventListener("abort", onAbort);
    }

    REGISTRY.set(tool.name, entry);
    this.#fireToolChange();
  }

  async getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredToolLike[]> {
    const from = options?.fromOrigins ?? [];
    for (const origin of from) {
      if (!/^https:\/\//.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
        throw domException(`fromOrigins entry "${origin}" is not a secure origin.`, "NotAllowedError");
      }
    }
    // Same-origin tools are always included; cross-origin documents are not
    // reachable from a page script, so nothing is added for `fromOrigins`.
    return [...REGISTRY.values()]
      .filter((e) => this.#visibleTo(e, location.origin))
      .map(toRegistered);
  }

  async executeTool(
    tool: { name: string } | string,
    args?: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> {
    const name = typeof tool === "string" ? tool : tool?.name;
    const entry = name ? REGISTRY.get(name) : undefined;
    if (!entry) throw domException(`No tool named "${String(name)}" is registered.`, "NotFoundError");
    if (!this.#visibleTo(entry, location.origin)) {
      throw domException(`Tool "${name}" is not exposed to ${location.origin}.`, "NotAllowedError");
    }

    const controller = new AbortController();
    if (options?.signal) {
      if (options.signal.aborted) throw domException("Tool execution aborted.", "AbortError");
      options.signal.addEventListener("abort", () => controller.abort(options.signal!.reason), {
        once: true,
      });
    }

    const coerced = coerceArgs(entry.init.inputSchema, args);
    if (!coerced.ok) {
      throw new TypeError(`Invalid arguments for "${name}": ${coerced.errors.join("; ")}`);
    }

    return await entry.init.execute(coerced.value, { signal: controller.signal });
  }

  #visibleTo(entry: Entry, callerOrigin: string): boolean {
    if (!entry.exposedTo) return callerOrigin === location.origin;
    return callerOrigin === location.origin || entry.exposedTo.includes(callerOrigin);
  }

  #fireToolChange() {
    this.dispatchEvent(new Event("toolchange"));
  }
}

let info: ShimInfo = { installed: false, crossOriginMediation: true };

/**
 * Installs the shim if the browser has no native WebMCP. Safe to call twice.
 * Returns whether the shim (rather than a real implementation) is in play.
 */
export function installWebMCPShim(): ShimInfo {
  if (typeof document === "undefined") return info;
  if ((document as Document).modelContext) return info;

  const ctx = new ShimModelContext();
  try {
    Object.defineProperty(document, "modelContext", {
      value: ctx,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  } catch {
    // Some environments make `document` non-extensible; fall back to a plain
    // assignment so the app still works.
    (document as unknown as Record<string, unknown>).modelContext = ctx;
  }
  info = { installed: true, crossOriginMediation: false };
  return info;
}

export function shimInfo(): ShimInfo {
  return info;
}

/** True when a real browser/agent implementation is providing the API. */
export function hasNativeWebMCP(): boolean {
  return typeof document !== "undefined" && Boolean(document.modelContext) && !info.installed;
}
