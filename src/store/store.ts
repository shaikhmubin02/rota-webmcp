import { create } from "zustand";
import type {
  Edit,
  ISODate,
  LedgerEntry,
  Proposal,
  Rule,
  RuleId,
  Selection,
  Shift,
  StaffMember,
  ViewMode,
} from "../types";
import type { Roster } from "../engine/rules";
import { seedRoster } from "../data/seed";
import { applyEdits } from "./edits";
import { startOfWeek, toISODate } from "../engine/time";

export type AgentMode = "scripted" | "openai";

export interface AgentToolCall {
  id: string;
  name: string;
  args: unknown;
  status: "running" | "ok" | "error";
  result?: string;
  durationMs?: number;
  readOnly: boolean;
  editCount: number;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  calls: AgentToolCall[];
  /** Set while the assistant turn is still streaming in. */
  pending?: boolean;
}

export interface Highlight {
  staffIds: string[];
  shiftIds: string[];
  dates: ISODate[];
  /** Why these are lit up, shown as a floating caption. */
  note?: string;
  at: number;
}

interface State {
  roster: Roster;
  /** Snapshot the roster is compared against when showing "published" state. */
  publishedAt: number | null;

  proposal: Proposal | null;
  undoStack: Edit[][];
  redoStack: Edit[][];

  ledger: LedgerEntry[];

  view: ViewMode;
  weekStart: ISODate;
  today: ISODate;
  selection: Selection;
  highlight: Highlight | null;
  /** Which right-hand panel is showing. */
  panel: "agent" | "ledger" | "rules" | "tools" | "publish";

  agent: {
    mode: AgentMode;
    apiKey: string;
    model: string;
    busy: boolean;
    messages: AgentMessage[];
    /** Aborts the running turn. */
    abort: (() => void) | null;
  };

  /** Origins granted access to Rota's tools via WebMCP `exposedTo`. */
  exposedOrigins: string[];

  toolNames: string[];
}

interface Actions {
  /* roster mutation always flows through edits, never direct setState */
  stage: (edits: Edit[], intent?: string) => Edit[];
  commitProposal: () => Edit[];
  discardProposal: () => void;
  toggleEdit: (editId: string) => void;
  setEditAccepted: (editId: string, accepted: boolean) => void;
  /** Applies edits immediately, as a manager's own direct action. */
  commitDirect: (edits: Edit[]) => void;
  undo: () => void;
  redo: () => void;

  log: (entry: LedgerEntry) => void;
  clearLedger: () => void;

  setView: (view: ViewMode) => void;
  setWeekStart: (date: ISODate) => void;
  select: (selection: Selection) => void;
  setHighlight: (h: Omit<Highlight, "at"> | null) => void;
  setPanel: (panel: State["panel"]) => void;

  setAgentMode: (mode: AgentMode) => void;
  setApiKey: (key: string) => void;
  setModel: (model: string) => void;
  setAgentBusy: (busy: boolean, abort?: (() => void) | null) => void;
  pushMessage: (message: AgentMessage) => void;
  updateMessage: (id: string, patch: Partial<AgentMessage>) => void;
  upsertCall: (messageId: string, call: AgentToolCall) => void;
  clearConversation: () => void;

  setExposedOrigins: (origins: string[]) => void;
  setToolNames: (names: string[]) => void;

  publish: (shiftIds: string[]) => void;
  resetAll: () => void;
}

const today = toISODate(new Date());
const initialRoster = seedRoster(today);

const KEY_STORAGE = "rota.openai.key";
const MODEL_STORAGE = "rota.openai.model";

function readStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export const useStore = create<State & Actions>((set, get) => ({
  roster: initialRoster,
  publishedAt: null,
  proposal: null,
  undoStack: [],
  redoStack: [],
  ledger: [],
  view: "week",
  weekStart: initialRoster.weekStart,
  today,
  selection: {},
  highlight: null,
  panel: "agent",
  agent: {
    mode: "scripted",
    apiKey: readStored(KEY_STORAGE, ""),
    model: readStored(MODEL_STORAGE, "gpt-5"),
    busy: false,
    messages: [],
    abort: null,
  },
  exposedOrigins: [],
  toolNames: [],

  stage: (edits, intent) => {
    if (edits.length === 0) return [];
    set((s) => {
      const proposal: Proposal =
        s.proposal ?? {
          id: `p-${Date.now().toString(36)}`,
          createdAt: Date.now(),
          intent,
          edits: [],
          status: "open",
        };
      return {
        proposal: {
          ...proposal,
          intent: proposal.intent ?? intent,
          edits: [...proposal.edits, ...edits],
        },
      };
    });
    return edits;
  },

  commitProposal: () => {
    const { proposal, roster } = get();
    if (!proposal) return [];
    const accepted = proposal.edits.filter((e) => e.accepted);
    if (accepted.length === 0) {
      set({ proposal: null });
      return [];
    }
    set({
      roster: applyEdits(roster, accepted, "forward"),
      proposal: null,
      undoStack: [...get().undoStack, accepted],
      redoStack: [],
    });
    return accepted;
  },

  discardProposal: () => set({ proposal: null }),

  toggleEdit: (editId) =>
    set((s) =>
      s.proposal
        ? {
            proposal: {
              ...s.proposal,
              edits: s.proposal.edits.map((e) =>
                e.id === editId ? { ...e, accepted: !e.accepted } : e,
              ),
            },
          }
        : {},
    ),

  setEditAccepted: (editId, accepted) =>
    set((s) =>
      s.proposal
        ? {
            proposal: {
              ...s.proposal,
              edits: s.proposal.edits.map((e) => (e.id === editId ? { ...e, accepted } : e)),
            },
          }
        : {},
    ),

  commitDirect: (edits) => {
    if (edits.length === 0) return;
    set((s) => ({
      roster: applyEdits(s.roster, edits, "forward"),
      undoStack: [...s.undoStack, edits],
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack, roster } = get();
    if (undoStack.length === 0) return;
    const batch = undoStack[undoStack.length - 1];
    set({
      roster: applyEdits(roster, batch, "backward"),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, batch],
    });
  },

  redo: () => {
    const { redoStack, roster } = get();
    if (redoStack.length === 0) return;
    const batch = redoStack[redoStack.length - 1];
    set({
      roster: applyEdits(roster, batch, "forward"),
      redoStack: redoStack.slice(0, -1),
      undoStack: [...get().undoStack, batch],
    });
  },

  log: (entry) => set((s) => ({ ledger: [entry, ...s.ledger].slice(0, 500) })),
  clearLedger: () => set({ ledger: [] }),

  setView: (view) => set({ view }),
  setWeekStart: (date) => set({ weekStart: startOfWeek(date) }),
  select: (selection) => set({ selection }),
  setHighlight: (h) => set({ highlight: h ? { ...h, at: Date.now() } : null }),
  setPanel: (panel) => set({ panel }),

  setAgentMode: (mode) => set((s) => ({ agent: { ...s.agent, mode } })),
  setApiKey: (apiKey) => {
    try {
      if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
      else localStorage.removeItem(KEY_STORAGE);
    } catch {
      /* private mode - keep it in memory only */
    }
    set((s) => ({ agent: { ...s.agent, apiKey } }));
  },
  setModel: (model) => {
    try {
      localStorage.setItem(MODEL_STORAGE, model);
    } catch {
      /* ignore */
    }
    set((s) => ({ agent: { ...s.agent, model } }));
  },
  setAgentBusy: (busy, abort = null) =>
    set((s) => ({ agent: { ...s.agent, busy, abort: busy ? abort : null } })),

  pushMessage: (message) =>
    set((s) => ({ agent: { ...s.agent, messages: [...s.agent.messages, message] } })),

  updateMessage: (id, patch) =>
    set((s) => ({
      agent: {
        ...s.agent,
        messages: s.agent.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      },
    })),

  upsertCall: (messageId, call) =>
    set((s) => ({
      agent: {
        ...s.agent,
        messages: s.agent.messages.map((m) => {
          if (m.id !== messageId) return m;
          const exists = m.calls.some((c) => c.id === call.id);
          return {
            ...m,
            calls: exists ? m.calls.map((c) => (c.id === call.id ? { ...c, ...call } : c)) : [...m.calls, call],
          };
        }),
      },
    })),

  clearConversation: () => set((s) => ({ agent: { ...s.agent, messages: [] } })),

  setExposedOrigins: (exposedOrigins) => set({ exposedOrigins }),
  setToolNames: (toolNames) => set({ toolNames }),

  publish: (shiftIds) =>
    set((s) => {
      const shifts = { ...s.roster.shifts };
      for (const id of shiftIds) {
        if (shifts[id]) shifts[id] = { ...shifts[id], status: "published" };
      }
      return { roster: { ...s.roster, shifts }, publishedAt: Date.now() };
    }),

  resetAll: () => {
    const fresh = seedRoster(toISODate(new Date()));
    set((s) => ({
      roster: fresh,
      weekStart: fresh.weekStart,
      proposal: null,
      undoStack: [],
      redoStack: [],
      ledger: [],
      selection: {},
      highlight: null,
      publishedAt: null,
      agent: { ...s.agent, messages: [], busy: false, abort: null },
    }));
  },
}));

/* -- selectors ------------------------------------------------------------- */

/**
 * The roster as it *would* look if the open proposal were approved.
 *
 * Memoised on the identity of `roster` and `proposal`, which is not an
 * optimisation but a correctness requirement: this is used as a zustand
 * selector, and zustand compares results with `Object.is`. Rebuilding the
 * object on every call makes every render produce a "new" value, which
 * re-renders, which rebuilds... until React gives up with "Maximum update
 * depth exceeded" and unmounts the tree.
 *
 * Both cache keys are replaced wholesale on any change (edits are staged by
 * constructing a new proposal object, commits by constructing a new roster),
 * so reference equality is a sound test here.
 */
let previewCache: { roster: Roster; proposal: Proposal; value: Roster } | null = null;

export function previewRoster(state: State): Roster {
  if (!state.proposal) return state.roster;
  const accepted = state.proposal.edits.filter((e) => e.accepted);
  if (accepted.length === 0) return state.roster;
  if (
    previewCache &&
    previewCache.roster === state.roster &&
    previewCache.proposal === state.proposal
  ) {
    return previewCache.value;
  }
  const value = applyEdits(state.roster, accepted, "forward");
  previewCache = { roster: state.roster, proposal: state.proposal, value };
  return value;
}

export function pendingEditCount(state: State): number {
  return state.proposal?.edits.filter((e) => e.accepted).length ?? 0;
}

export function staffList(state: State): StaffMember[] {
  return Object.values(state.roster.staff);
}

export function shiftsForWeek(roster: Roster, weekStart: ISODate): Shift[] {
  const end = weekStart;
  return Object.values(roster.shifts)
    .filter((s) => s.date >= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

export function rulesList(state: State): Rule[] {
  return Object.values(state.roster.rules);
}

export function ruleById(state: State, id: RuleId): Rule | undefined {
  return state.roster.rules[id];
}
