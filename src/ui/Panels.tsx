import { useEffect, useMemo, useState } from "react";
import type { Rule } from "../types";
import { fmtTime } from "../engine/time";
import { ruleEdit } from "../store/edits";
import { useStore } from "../store/store";
import { declarativeToolInfo } from "../webmcp/declarative";
import { allKnownTools, callTool, reregisterBase, webmcpStatus } from "../webmcp/registry";
import { resultText } from "../webmcp/result";
import { Badge, Button, Empty, Icon, ICONS, SectionTitle, Toggle, cx } from "./bits";

/* -- provenance ------------------------------------------------------------ */

export function LedgerPanel() {
  const ledger = useStore((s) => s.ledger);
  const clearLedger = useStore((s) => s.clearLedger);
  const [expanded, setExpanded] = useState<string | null>(null);

  const download = () => {
    const blob = new Blob([JSON.stringify(ledger, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rota-provenance-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionTitle
        right={
          ledger.length > 0 && (
            <div className="flex gap-1">
              <Button size="sm" variant="subtle" onClick={download} title="Export as JSON">
                Export
              </Button>
              <Button size="sm" variant="subtle" onClick={clearLedger}>
                Clear
              </Button>
            </div>
          )
        }
      >
        Provenance · {ledger.length} calls
      </SectionTitle>

      <p className="px-4 pb-2 text-[10.5px] leading-relaxed text-label-3">
        Every WebMCP tool invocation on this page, whoever made it — the panel agent, a browser
        agent, or you. Arguments, result, timing, and the edits it staged.
      </p>

      {ledger.length === 0 ? (
        <Empty>No tool calls yet. Ask the agent for something.</Empty>
      ) : (
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {ledger.map((entry) => (
            <li
              key={entry.id}
              className={cx(
                "overflow-hidden rounded-apple border text-[11px]",
                entry.ok ? "border-hairline bg-raised" : "border-red/30 bg-red-soft",
              )}
            >
              <button
                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                <span className="shrink-0 tabular-nums text-[10px] text-label-3">
                  {new Date(entry.at).toLocaleTimeString("en-GB")}
                </span>
                <code className="min-w-0 truncate font-mono font-medium text-label">
                  {entry.toolName}
                </code>
                {entry.readOnly ? (
                  <Badge tone="neutral">read</Badge>
                ) : entry.editIds.length > 0 ? (
                  <Badge tone="agent">{entry.editIds.length} staged</Badge>
                ) : null}
                <span className="ml-auto shrink-0 tabular-nums text-[10px] text-label-3">
                  {entry.durationMs}ms
                </span>
              </button>
              {expanded === entry.id && (
                <div className="space-y-1.5 border-t border-hairline px-2.5 py-2">
                  <Field label="Caller">{entry.caller}</Field>
                  <Field label="Origin">
                    <code className="font-mono">{entry.origin}</code>
                  </Field>
                  <Field label="Arguments">
                    <pre className="prose-tool font-mono text-[10px] text-label-2">
                      {JSON.stringify(entry.args, null, 2)}
                    </pre>
                  </Field>
                  <Field label="Result">
                    <p className="prose-tool font-mono text-[10px] text-label-2">{entry.result}</p>
                  </Field>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-semibold tracking-wider text-label-3 uppercase">{label}</p>
      <div className="mt-0.5 text-[10.5px] text-label-2">{children}</div>
    </div>
  );
}

/* -- rules ----------------------------------------------------------------- */

export function RulesPanel() {
  const roster = useStore((s) => s.roster);
  const commitDirect = useStore((s) => s.commitDirect);
  const rules = Object.values(roster.rules);

  const change = (rule: Rule, changes: Partial<Rule>) => {
    const edit = ruleEdit(roster, rule.id, changes, {
      sourceCallId: "direct",
      author: "manager",
    });
    if (edit) commitDirect([edit]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionTitle>Rules · {rules.filter((r) => r.enabled).length} active</SectionTitle>
      <p className="px-4 pb-2 text-[10.5px] leading-relaxed text-label-3">
        The engine behind every answer the agent gives. Statutory rules cannot be switched off — not
        by you, and not by a tool.
      </p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-apple border border-hairline bg-raised p-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[12.5px] font-medium text-label">{rule.label}</p>
                  <Badge tone={rule.severity === "hard" ? "bad" : "warn"}>{rule.severity}</Badge>
                  {rule.statutory && <Badge tone="neutral">statutory</Badge>}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-label-2">{rule.description}</p>
                <code className="mt-1 block font-mono text-[9.5px] text-label-3">{rule.id}</code>
              </div>
              <Toggle
                checked={rule.enabled}
                disabled={rule.statutory}
                label={`Enable ${rule.label}`}
                onChange={(enabled) => change(rule, { enabled })}
              />
            </div>
            {rule.param !== undefined && (
              <label className="mt-2 flex items-center gap-2 border-t border-hairline pt-2">
                <span className="text-[10.5px] text-label-2">{rule.paramLabel}</span>
                {rule.paramUnit === "time" ? (
                  <span className="ml-auto text-[11px] font-medium tabular-nums text-label">
                    {fmtTime(rule.param)}
                  </span>
                ) : null}
                <input
                  type="number"
                  step={rule.paramUnit === "fraction of target" ? 0.05 : rule.paramUnit === "time" ? 30 : 1}
                  value={rule.param}
                  onChange={(e) => change(rule, { param: Number(e.target.value) })}
                  className="ml-auto w-20 rounded-md border border-hairline bg-inset px-1.5 py-1 text-right text-[11px] tabular-nums outline-none focus:border-accent/60"
                />
                {rule.paramUnit !== "time" && (
                  <span className="text-[10px] text-label-3">{rule.paramUnit}</span>
                )}
              </label>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -- tool inspector -------------------------------------------------------- */

export function ToolsPanel() {
  const toolNames = useStore((s) => s.toolNames);
  const exposedOrigins = useStore((s) => s.exposedOrigins);
  const setExposedOrigins = useStore((s) => s.setExposedOrigins);
  const [live, setLive] = useState<{ name: string; description: string; inputSchema?: unknown; readOnly: boolean }[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [originDraft, setOriginDraft] = useState("");

  const status = webmcpStatus();
  const catalogue = useMemo(() => allKnownTools(), []);
  const declarative = useMemo(() => declarativeToolInfo(), [toolNames]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mc = document.modelContext;
      if (!mc) return;
      const tools = await mc.getTools();
      if (cancelled) return;
      setLive(
        tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          readOnly: Boolean(t.annotations?.readOnlyHint),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [toolNames]);

  const groupOf = (name: string) =>
    catalogue.find((t) => t.name === name)?.group ??
    (declarative.some((d) => d.name === name) ? "declarative" : "other");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SectionTitle>WebMCP · {live.length} registered</SectionTitle>

      <div className="space-y-2 px-4 pb-3">
        <div className="rounded-apple border border-hairline bg-raised p-2.5">
          <div className="flex items-center gap-2">
            <span className={status.native ? "text-green" : "text-orange"}>
              <Icon path={ICONS.plug} size={14} />
            </span>
            <p className="text-[12px] font-medium text-label">
              {status.native ? "Native WebMCP detected" : "Running on the bundled polyfill"}
            </p>
          </div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-label-2">
            {status.native
              ? "document.modelContext is provided by the browser or host, so an external agent — ChatGPT Desktop, Chrome's built-in agent, an extension — can discover and drive these tools directly."
              : "This browser has no WebMCP yet, so Rota installed its own spec-shaped implementation. Everything works, except that only this page can reach the tools: cross-origin mediation needs a real browser."}
          </p>
        </div>

        <details className="rounded-apple border border-hairline bg-raised">
          <summary className="cursor-pointer px-2.5 py-2 text-[11.5px] font-medium text-label">
            Share tools with another origin ({exposedOrigins.length})
          </summary>
          <div className="space-y-2 border-t border-hairline px-2.5 py-2">
            <p className="text-[10.5px] leading-relaxed text-label-2">
              WebMCP's <code className="font-mono">exposedTo</code> lets a page hand its tools to a
              specific secure origin — an author-provided agent in an iframe, say. Origins listed
              here are passed to every <code className="font-mono">registerTool</code> call.
            </p>
            {exposedOrigins.map((origin) => (
              <div key={origin} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-label">
                  {origin}
                </code>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setExposedOrigins(exposedOrigins.filter((o) => o !== origin));
                    void reregisterBase();
                  }}
                >
                  <Icon path={ICONS.x} size={11} />
                </Button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input
                value={originDraft}
                onChange={(e) => setOriginDraft(e.target.value)}
                placeholder="https://partner.example"
                className="min-w-0 flex-1 rounded-md border border-hairline bg-inset px-2 py-1 font-mono text-[10.5px] outline-none focus:border-accent/60"
              />
              <Button
                size="sm"
                onClick={() => {
                  const origin = originDraft.trim().replace(/\/$/, "");
                  if (!origin) return;
                  setExposedOrigins([...new Set([...exposedOrigins, origin])]);
                  setOriginDraft("");
                  void reregisterBase();
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </details>
      </div>

      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {live
          .slice()
          .sort((a, b) => groupOf(a.name).localeCompare(groupOf(b.name)) || a.name.localeCompare(b.name))
          .map((tool) => {
            const group = groupOf(tool.name);
            const contextual = catalogue.find((t) => t.name === tool.name)?.contextual;
            return (
              <li key={tool.name} className="overflow-hidden rounded-apple border border-hairline bg-raised">
                <button
                  onClick={() => setExpanded(expanded === tool.name ? null : tool.name)}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
                >
                  <span className="mt-px">
                    <GroupDot group={group} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <code className="block truncate font-mono text-[11.5px] font-medium text-label">
                      {tool.name}
                    </code>
                    <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-label-2">
                      {tool.description}
                    </p>
                    {contextual && (
                      <p className="mt-1 text-[9.5px] font-medium text-purple">{contextual}</p>
                    )}
                  </div>
                  {tool.readOnly && <Badge tone="neutral">read</Badge>}
                </button>
                {expanded === tool.name && (
                  <ToolRunner name={tool.name} schema={tool.inputSchema} />
                )}
              </li>
            );
          })}
      </ol>
    </div>
  );
}

function GroupDot({ group }: { group: string }) {
  const tones: Record<string, string> = {
    read: "bg-blue",
    write: "bg-purple",
    view: "bg-teal",
    meta: "bg-label-3",
    declarative: "bg-green",
    other: "bg-label-3",
  };
  return (
    <span
      title={group}
      className={cx("inline-block size-2 rounded-full", tones[group] ?? tones.other)}
    />
  );
}

/** Lets a human invoke any registered tool by hand — a debugger for WebMCP. */
function ToolRunner({ name, schema }: { name: string; schema?: unknown }) {
  const [args, setArgs] = useState("{}");
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setOutput(null);
    try {
      const parsed = args.trim() ? JSON.parse(args) : {};
      const result = await callTool(name, parsed, { caller: "manual (inspector)" });
      setOutput(resultText(result) || "(no output)");
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-hairline px-2.5 py-2">
      <div>
        <p className="text-[9px] font-semibold tracking-wider text-label-3 uppercase">
          Input schema
        </p>
        <pre className="prose-tool mt-0.5 max-h-40 overflow-auto font-mono text-[9.5px] leading-relaxed text-label-2">
          {JSON.stringify(schema ?? {}, null, 2)}
        </pre>
      </div>
      <label className="block">
        <span className="text-[9px] font-semibold tracking-wider text-label-3 uppercase">
          Arguments
        </span>
        <textarea
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          rows={2}
          spellCheck={false}
          className="mt-0.5 w-full rounded-md border border-hairline bg-inset px-2 py-1.5 font-mono text-[10.5px] outline-none focus:border-accent/60"
        />
      </label>
      <Button size="sm" variant="tinted" onClick={run} disabled={busy}>
        {busy ? "Running…" : "Run tool"}
      </Button>
      {output && (
        <p className="prose-tool max-h-48 overflow-auto rounded-md bg-inset p-2 font-mono text-[10px] leading-relaxed text-label-2">
          {output}
        </p>
      )}
    </div>
  );
}
