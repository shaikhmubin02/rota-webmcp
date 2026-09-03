/**
 * Rota domain model.
 *
 * Everything here lives in the browser tab. There is no server, and no roster
 * data ever leaves the page — which is precisely why WebMCP (in-page, client-side
 * tools) is the right integration surface rather than a backend MCP server.
 */

/** Minutes since local midnight. 0 = 00:00, 1440 = 24:00. */
export type Minutes = number;

/** ISO date, `YYYY-MM-DD`, interpreted in the venue's local timezone. */
export type ISODate = string;

export type Role = "barista" | "baker" | "shift_lead" | "cashier";

export const ROLES: Role[] = ["barista", "baker", "shift_lead", "cashier"];

export const ROLE_LABEL: Record<Role, string> = {
  barista: "Barista",
  baker: "Baker",
  shift_lead: "Shift Lead",
  cashier: "Cashier",
};

/** A recurring weekly availability window. `weekday` is 0=Sun … 6=Sat. */
export interface AvailabilityWindow {
  weekday: number;
  start: Minutes;
  end: Minutes;
}

export type TimeOffStatus = "approved" | "pending" | "declined";

export interface TimeOff {
  id: string;
  date: ISODate;
  /** Omitted start/end means the whole day. */
  start?: Minutes;
  end?: Minutes;
  reason: string;
  status: TimeOffStatus;
}

export type ContractType = "full_time" | "part_time" | "casual";

export interface StaffMember {
  id: string;
  name: string;
  /** Roles this person is trained and certified for. */
  roles: Role[];
  contract: ContractType;
  hourlyRate: number;
  /** Contractual/target hours per week. Overtime accrues past this. */
  targetWeeklyHours: number;
  maxWeeklyHours: number;
  maxDailyHours: number;
  /** Statutory minimum rest between the end of one shift and the start of the next. */
  minRestHours: number;
  maxConsecutiveDays: number;
  /** Under 18: extra statutory protections apply. */
  isMinor: boolean;
  availability: AvailabilityWindow[];
  timeOff: TimeOff[];
  /** Soft preferences the solver tries to honour and the agent can reason about. */
  preferences: {
    prefersMornings?: boolean;
    prefersEvenings?: boolean;
    avoidsClosing?: boolean;
    avoidsWeekends?: boolean;
    maxShiftsPerWeek?: number;
  };
  /** Free-text notes a manager typed. The agent reads these for context. */
  notes?: string;
  /** Higher wins ties when the solver is otherwise indifferent. */
  seniority: number;
  avatarHue: number;
}

export type ShiftStatus = "draft" | "published";

export interface Shift {
  id: string;
  date: ISODate;
  start: Minutes;
  end: Minutes;
  role: Role;
  /** How many people this shift needs. */
  headcount: number;
  /** Staff assigned so far. May be shorter than `headcount` (a coverage gap). */
  assigned: string[];
  status: ShiftStatus;
  /** Marks the last shift of the trading day — used by the "clopening" rule. */
  isClosing: boolean;
  isOpening: boolean;
  label?: string;
  notes?: string;
}

export type RuleSeverity = "hard" | "soft";

export type RuleId =
  | "no_double_booking"
  | "respect_availability"
  | "respect_approved_time_off"
  | "role_certification"
  | "max_daily_hours"
  | "max_weekly_hours"
  | "min_rest_between_shifts"
  | "max_consecutive_days"
  | "minor_no_late_shifts"
  | "coverage_met"
  | "labor_budget"
  | "honor_preferences"
  | "fair_weekend_load"
  | "fair_closing_load"
  | "minimum_hours_met";

export interface Rule {
  id: RuleId;
  label: string;
  /** Explains the rule in the terms a manager (or an agent) would use. */
  description: string;
  severity: RuleSeverity;
  enabled: boolean;
  /** Statutory rules can be inspected but not switched off from the UI or by a tool. */
  statutory: boolean;
  /** Tunable numeric knob, where the rule has one. */
  param?: number;
  paramLabel?: string;
  paramUnit?: string;
}

export interface Violation {
  ruleId: RuleId;
  severity: RuleSeverity;
  /** Human-readable, complete sentence. This is what the agent quotes back. */
  message: string;
  staffId?: string;
  shiftIds: string[];
  date?: ISODate;
  /** Relative badness within a severity class, for sorting. */
  weight: number;
}

export interface CoverageGap {
  shiftId: string;
  date: ISODate;
  role: Role;
  start: Minutes;
  end: Minutes;
  required: number;
  assigned: number;
  missing: number;
}

/** A candidate for a shift, with the reasoning the agent surfaces to the user. */
export interface Candidate {
  staffId: string;
  name: string;
  /** 0–100. Higher is a better fit. */
  score: number;
  /** Hard-rule breaches this assignment would cause. Non-empty ⇒ ineligible. */
  blockers: Violation[];
  /** Soft-rule costs this assignment would incur. */
  concerns: Violation[];
  /** Positive reasons, e.g. "12h under target this week". */
  reasons: string[];
  projectedWeeklyHours: number;
  overtimeHours: number;
  costForShift: number;
}

export interface Venue {
  name: string;
  timezone: string;
  /** Weekly labor budget in currency units. */
  weeklyLaborBudget: number;
  currency: string;
  overtimeMultiplier: number;
}

/* ── Proposals: the staging layer that keeps the human in charge ───────────── */

export type EditKind =
  | "assign"
  | "unassign"
  | "create_shift"
  | "delete_shift"
  | "update_shift"
  | "time_off"
  | "rule";

/**
 * One atomic, reversible change. Agent tool calls never mutate the roster —
 * they append `Edit`s to the open `Proposal`, which a human then approves.
 */
export interface Edit {
  id: string;
  kind: EditKind;
  /** One-line description rendered in the review drawer. */
  summary: string;
  /** Which tool call produced this edit, for the provenance ledger. */
  sourceCallId: string;
  /** `agent` | `user` | tool origin. */
  author: string;
  createdAt: number;
  /** Applied to state on commit. */
  forward: StatePatch;
  /** Applied to state on undo. */
  backward: StatePatch;
  /** Entities to highlight when this edit is focused. */
  touches: { staffIds: string[]; shiftIds: string[]; dates: ISODate[] };
  accepted: boolean;
}

export interface StatePatch {
  shifts?: Record<string, Shift | null>;
  staff?: Record<string, StaffMember | null>;
  rules?: Record<string, Partial<Rule>>;
}

export interface Proposal {
  id: string;
  createdAt: number;
  /** Natural-language intent that started this proposal, if known. */
  intent?: string;
  edits: Edit[];
  status: "open" | "committed" | "discarded";
}

/* ── Provenance ledger ────────────────────────────────────────────────────── */

export interface LedgerEntry {
  id: string;
  at: number;
  toolName: string;
  origin: string;
  /** Who invoked it: the in-page agent, a native browser agent, or the user. */
  caller: string;
  args: unknown;
  /** Trimmed result text. */
  result: string;
  ok: boolean;
  durationMs: number;
  readOnly: boolean;
  /** Edits this call staged, if any. */
  editIds: string[];
}

export type ViewMode = "week" | "staff" | "cost";

export interface Selection {
  shiftId?: string;
  staffId?: string;
}
