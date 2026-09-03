import { useEffect, useRef, useState } from "react";
import { runAgentTurn, resetAgentHistory } from "../agent/runtime";
import { EXAMPLE_PROMPTS } from "../agent/prompt";
import { useStore, type AgentToolCall } from "../store/store";
import { Badge, Button, Icon, ICONS, Segmented, cx } from "./bits";

export function AgentPanel() {
  const agent = useStore((s) => s.agent);
  const setAgentMode = useStore((s) => s.setAgentMode);
  const clearConversation = useStore((s) => s.clearConversation);
  const toolNames = useStore((s) => s.toolNames);
  const [draft, setDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [agent.messages]);

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || agent.busy) return;
    setDraft("");
    void runAgentTurn(prompt);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-hairline px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Agent mode"
            value={agent.mode}
            onChange={(mode) => setAgentMode(mode)}
            options={[
              { value: "scripted", label: "Scripted" },
              { value: "openai", label: "OpenAI" },
            ]}
          />
          <Button
            size="sm"
            variant={agent.apiKey ? "tinted" : "subtle"}
            onClick={() => setShowKey((v) => !v)}
            title="Bring your own OpenAI key"
            ariaLabel="API key settings"
          >
            <Icon path={ICONS.key} size={13} />
          </Button>
          <span className="ml-auto text-[10px] tabular-nums text-label-3">
            {toolNames.length} tools live
          </span>
          {agent.messages.length > 0 && (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => {
                clearConversation();
                resetAgentHistory();
              }}
              ariaLabel="Clear conversation"
            >
              <Icon path={ICONS.reset} size={13} />
            </Button>
          )}
        </div>

        {showKey && <KeyPanel onClose={() => setShowKey(false)} />}

        <p className="mt-2 text-[10px] leading-relaxed text-label-3">
          {agent.mode === "scripted"
            ? "Scripted planner: the routing from your sentence to a plan is canned, but every step is a real executeTool() call and every number below comes back from the page's own engine."
            : "Your key stays in this tab and is sent only to api.openai.com. Tools are read live from document.modelContext each round."}
        </p>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {agent.messages.length === 0 && <Intro onPick={send} />}
        {agent.messages.map((message) => (
          <div key={message.id} className="rise">
            {message.role === "user" ? (
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3 py-2 text-[13px] leading-snug text-accent-label">
                  {message.text}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {message.calls.length > 0 && (
                  <ol className="space-y-1">
                    {message.calls.map((call) => (
                      <ToolCallCard key={call.id} call={call} />
                    ))}
                  </ol>
                )}
                {message.text && (
                  <div className="prose-tool max-w-none rounded-2xl rounded-bl-md border border-hairline bg-raised px-3 py-2 text-[13px] leading-relaxed text-label">
                    {message.text}
                  </div>
                )}
                {message.pending && !message.text && (
                  <p className="breathe flex items-center gap-1.5 px-1 text-[12px] text-label-2">
                    <Icon path={ICONS.sparkle} size={12} />
                    thinking…
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form
        className="shrink-0 border-t border-hairline p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-apple-lg border border-hairline bg-raised p-1.5 focus-within:border-accent/50">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            placeholder="Ask for a change to the rota…"
            aria-label="Message the scheduling agent"
            className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-snug outline-none placeholder:text-label-3"
          />
          {agent.busy ? (
            <Button variant="danger" size="sm" onClick={() => agent.abort?.()} title="Stop">
              <Icon path={ICONS.stop} size={13} />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!draft.trim()}
              ariaLabel="Send"
            >
              <Icon path={ICONS.send} size={13} />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Intro({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="space-y-3 pt-2">
      <div className="rounded-apple-lg border border-hairline bg-raised p-3">
        <h3 className="text-[13px] font-semibold text-label">Work the rota together</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-label-2">
          The agent can read the whole week, rank cover options against the venue's rules, and
          propose changes. It cannot approve them. Everything it does lands in the review drawer
          for you.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {EXAMPLE_PROMPTS.map((example) => (
          <button
            key={example.label}
            onClick={() => onPick(example.prompt)}
            className="group rounded-apple border border-hairline bg-raised px-3 py-2 text-left transition-colors hover:bg-hover"
          >
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-label">
              <span className="text-accent">
                <Icon path={ICONS.sparkle} size={12} />
              </span>
              {example.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-label-3">
              {example.prompt}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ToolCallCard({ call }: { call: AgentToolCall }) {
  const [open, setOpen] = useState(false);
  const args = Object.entries((call.args ?? {}) as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );

  return (
    <li
      className={cx(
        "overflow-hidden rounded-apple border text-[11px] transition-colors",
        call.status === "error" ? "border-red/35 bg-red-soft" : "border-hairline bg-inset",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        aria-expanded={open}
      >
        <span
          className={cx(
            "shrink-0",
            call.status === "running"
              ? "breathe text-accent"
              : call.status === "ok"
                ? "text-green"
                : "text-red",
          )}
        >
          <Icon
            path={
              call.status === "running"
                ? ICONS.sparkle
                : call.status === "ok"
                  ? ICONS.check
                  : ICONS.alert
            }
            size={12}
          />
        </span>
        <code className="min-w-0 truncate font-mono text-[11px] font-medium text-label">
          {call.name}
        </code>
        {call.readOnly && <span className="shrink-0 text-[9px] text-label-3">read</span>}
        {call.editCount > 0 && (
          <Badge tone="agent">
            {call.editCount} staged
          </Badge>
        )}
        {call.durationMs !== undefined && (
          <span className="ml-auto shrink-0 tabular-nums text-[10px] text-label-3">
            {call.durationMs}ms
          </span>
        )}
        <span className={cx("shrink-0 text-label-3 transition-transform", open && "rotate-180")}>
          <Icon path={ICONS.chevronDown} size={11} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-hairline px-2.5 py-2">
          {args.length > 0 && (
            <div>
              <p className="mb-1 text-[9px] font-semibold tracking-wider text-label-3 uppercase">
                Arguments
              </p>
              <pre className="prose-tool overflow-x-auto font-mono text-[10px] leading-relaxed text-label-2">
                {JSON.stringify(Object.fromEntries(args), null, 2)}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <p className="mb-1 text-[9px] font-semibold tracking-wider text-label-3 uppercase">
                Result
              </p>
              <p className="prose-tool font-mono text-[10px] leading-relaxed text-label-2">
                {call.result.slice(0, 1400)}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const MODEL_SUGGESTIONS = ["gpt-5", "gpt-5-mini", "gpt-5.2", "gpt-5.4", "gpt-4.1"];

function KeyPanel({ onClose }: { onClose: () => void }) {
  const agent = useStore((s) => s.agent);
  const setApiKey = useStore((s) => s.setApiKey);
  const setModel = useStore((s) => s.setModel);
  const setAgentMode = useStore((s) => s.setAgentMode);
  const [value, setValue] = useState(agent.apiKey);

  return (
    <div className="mt-2 space-y-2 rounded-apple border border-hairline bg-inset p-2.5">
      <label className="block">
        <span className="text-[10px] font-semibold tracking-wider text-label-3 uppercase">
          OpenAI API key
        </span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-hairline bg-raised px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent/60"
        />
      </label>
      <label className="block">
        <span className="text-[10px] font-semibold tracking-wider text-label-3 uppercase">
          Model
        </span>
        <input
          list="rota-models"
          value={agent.model}
          onChange={(e) => setModel(e.target.value)}
          className="mt-1 w-full rounded-md border border-hairline bg-raised px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent/60"
        />
        <datalist id="rota-models">
          {MODEL_SUGGESTIONS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setApiKey(value.trim());
            if (value.trim()) setAgentMode("openai");
            onClose();
          }}
        >
          Save
        </Button>
        {agent.apiKey && (
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setApiKey("");
              setValue("");
              setAgentMode("scripted");
            }}
          >
            Forget
          </Button>
        )}
        <Button size="sm" variant="subtle" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-label-3">
        Stored in this browser's localStorage only. Rota has no backend — there is nowhere else for
        it to go.
      </p>
    </div>
  );
}
