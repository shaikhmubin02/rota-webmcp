import { useEffect, useState } from "react";
import { addDays, fmtDateShort, weekDates } from "../engine/time";
import { useStore } from "../store/store";
import { webmcpStatus } from "../webmcp/registry";
import { PublishStatus } from "./PublishPanel";
import { Badge, Button, Icon, ICONS, Segmented, cx } from "./bits";

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const weekStart = useStore((s) => s.weekStart);
  const setWeekStart = useStore((s) => s.setWeekStart);
  const venue = useStore((s) => s.roster.venue);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const resetAll = useStore((s) => s.resetAll);
  const dates = weekDates(weekStart);

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-hairline material px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-[15px] font-bold text-accent-label">
          R
        </span>
        <div className="leading-tight">
          <h1 className="text-[14px] font-semibold tracking-tight text-label">Rota</h1>
          <p className="text-[10.5px] text-label-3">{venue.name}</p>
        </div>
      </div>

      <div className="ml-2 flex items-center gap-1">
        <Button
          size="sm"
          variant="subtle"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          ariaLabel="Previous week"
        >
          <Icon path={ICONS.chevronLeft} size={14} />
        </Button>
        <div className="min-w-[168px] text-center">
          <p className="text-[12.5px] font-medium text-label">
            {fmtDateShort(dates[0])} – {fmtDateShort(dates[6])}
          </p>
        </div>
        <Button
          size="sm"
          variant="subtle"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          ariaLabel="Next week"
        >
          <Icon path={ICONS.chevronRight} size={14} />
        </Button>
        <PublishStatus />
      </div>

      <div className="mx-auto">
        <Segmented
          ariaLabel="View"
          value={view}
          onChange={setView}
          options={[
            { value: "week", label: "Week" },
            { value: "staff", label: "People" },
            { value: "cost", label: "Cost" },
          ]}
        />
      </div>

      <div className="flex items-center gap-1">
        <Button size="sm" variant="subtle" onClick={undo} disabled={!canUndo} ariaLabel="Undo" title="Undo (⌘Z)">
          <Icon path={ICONS.undo} size={14} />
        </Button>
        <Button size="sm" variant="subtle" onClick={redo} disabled={!canRedo} ariaLabel="Redo" title="Redo (⇧⌘Z)">
          <Icon path={ICONS.redo} size={14} />
        </Button>
        <span className="mx-1 h-4 w-px bg-hairline" />
        <WebMCPBadge />
        <ThemeToggle />
        <Button
          size="sm"
          variant="subtle"
          onClick={() => {
            if (confirm("Reset the demo to the original broken rota?")) resetAll();
          }}
          ariaLabel="Reset demo"
          title="Reset the demo"
        >
          <Icon path={ICONS.reset} size={14} />
        </Button>
      </div>
    </header>
  );
}

function WebMCPBadge() {
  const [status, setStatus] = useState(() => webmcpStatus());
  const toolCount = useStore((s) => s.toolNames.length);

  useEffect(() => {
    setStatus(webmcpStatus());
  }, [toolCount]);

  return (
    <Badge
      tone={status.native ? "good" : "info"}
      title={
        status.native
          ? "The browser or host provides document.modelContext, so an external agent can drive this page."
          : "No native WebMCP here, so Rota installed its own spec-shaped polyfill. Everything works in-page."
      }
    >
      <Icon path={ICONS.plug} size={11} />
      {status.native ? "WebMCP native" : "WebMCP polyfill"} · {toolCount}
    </Badge>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.dataset.theme === "dark",
  );

  const apply = (next: boolean) => {
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("rota.theme", next ? "dark" : "light");
    } catch {
      /* private mode */
    }
    setDark(next);
  };

  return (
    <Button
      size="sm"
      variant="subtle"
      onClick={() => apply(!dark)}
      ariaLabel={dark ? "Switch to light appearance" : "Switch to dark appearance"}
      title="Appearance"
    >
      <Icon path={dark ? ICONS.sun : ICONS.moon} size={14} />
    </Button>
  );
}

/** Right-rail tab strip. */
export function PanelTabs() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const ledgerCount = useStore((s) => s.ledger.length);
  const pending = useStore((s) => s.proposal?.edits.length ?? 0);

  const tabs = [
    { id: "agent" as const, label: "Agent", icon: ICONS.sparkle, badge: pending || undefined },
    { id: "tools" as const, label: "WebMCP", icon: ICONS.tool },
    { id: "ledger" as const, label: "Ledger", icon: ICONS.book, badge: ledgerCount || undefined },
    { id: "rules" as const, label: "Rules", icon: ICONS.scale },
    { id: "publish" as const, label: "Publish", icon: ICONS.send },
  ];

  return (
    <div
      role="tablist"
      aria-label="Side panel"
      className="flex shrink-0 items-center gap-0.5 border-b border-hairline px-2 py-1.5"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={panel === tab.id}
          onClick={() => setPanel(tab.id)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition-colors",
            panel === tab.id ? "bg-inset text-label" : "text-label-2 hover:bg-hover",
          )}
        >
          <Icon path={tab.icon} size={13} />
          <span className="hidden xl:inline">{tab.label}</span>
          {tab.badge !== undefined && (
            <span className="rounded-full bg-accent px-1.5 text-[9.5px] font-semibold text-accent-label">
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
