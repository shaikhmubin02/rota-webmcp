import { useEffect } from "react";
import { useStore } from "./store/store";
import { startDeclarativeTools } from "./webmcp/declarative";
import { startWebMCP } from "./webmcp/registry";
import { AgentPanel } from "./ui/AgentPanel";
import { LedgerPanel, RulesPanel, ToolsPanel } from "./ui/Panels";
import { ConsentNotice, ProposalBar } from "./ui/ProposalDrawer";
import { PublishPanel } from "./ui/PublishPanel";
import { StaffRail } from "./ui/StaffRail";
import { PanelTabs, TopBar } from "./ui/TopBar";
import { CostView, SelectionDetail, StaffView } from "./ui/Views";
import { ViolationsStrip, WeekGrid } from "./ui/WeekGrid";
import { Icon, ICONS, SectionTitle, cx } from "./ui/bits";

export default function App() {
  const view = useStore((s) => s.view);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const highlight = useStore((s) => s.highlight);
  const setHighlight = useStore((s) => s.setHighlight);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  // The review bar floats over the bottom of the main column, so the column
  // needs to give up the height while it is showing.
  const reviewBarShowing = useStore((s) => (s.proposal?.edits.length ?? 0) > 0);

  // Boot WebMCP: imperative tools, then the declarative forms.
  useEffect(() => {
    const stopTools = startWebMCP();
    const stopForms = startDeclarativeTools();
    return () => {
      stopForms();
      stopTools();
    };
  }, []);

  // An agent filling a declarative form should not leave the manager hunting
  // for it behind a tab.
  useEffect(() => {
    const onFilled = () => setPanel("publish");
    window.addEventListener("rota:form-filled", onFilled);
    return () => window.removeEventListener("rota:form-filled", onFilled);
  }, [setPanel]);

  // Highlights are a pointing gesture, not a state change: they fade.
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), 12_000);
    return () => clearTimeout(timer);
  }, [highlight, setHighlight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "/" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setPanel("agent");
        document
          .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message the scheduling agent"]')
          ?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setPanel]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-base">
      <TopBar />
      <ViolationsStrip />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[268px] shrink-0 flex-col border-r border-hairline bg-base">
          <SectionTitle
            right={
              <span className="text-[10px] text-label-3">
                <Icon path={ICONS.users} size={12} />
              </span>
            }
          >
            Team
          </SectionTitle>
          <StaffRail />
        </aside>

        <main
          className={cx(
            "relative flex min-w-0 flex-1 flex-col",
            reviewBarShowing && "pb-[54px]",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col pt-3">
            {view === "week" && <WeekGrid />}
            {view === "staff" && <StaffView />}
            {view === "cost" && <CostView />}
          </div>
          <SelectionDetail />
          <ProposalBar />
        </main>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-hairline bg-base 2xl:w-[440px]">
          <PanelTabs />
          <Panel active={panel === "agent"}>
            <AgentPanel />
          </Panel>
          <Panel active={panel === "tools"}>
            <ToolsPanel />
          </Panel>
          <Panel active={panel === "ledger"}>
            <LedgerPanel />
          </Panel>
          <Panel active={panel === "rules"}>
            <RulesPanel />
          </Panel>
          {/* Always mounted: the declarative publish form must stay in the DOM
              for its synthesised tool to remain registered. */}
          <Panel active={panel === "publish"} keepMounted>
            <PublishPanel />
          </Panel>
          <ConsentNotice />
        </aside>
      </div>
    </div>
  );
}

/**
 * Panels stay mounted when `keepMounted` is set, so any declarative WebMCP
 * forms inside them keep their tools registered even while hidden.
 */
function Panel({
  active,
  keepMounted,
  children,
}: {
  active: boolean;
  keepMounted?: boolean;
  children: React.ReactNode;
}) {
  if (!active && !keepMounted) return null;
  return (
    <div
      className={cx("min-h-0 flex-1", active ? "flex flex-col" : "hidden")}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}
