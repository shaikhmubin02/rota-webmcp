import type { Candidate, CoverageGap, ISODate, Shift, Violation } from "../types";
import { budgetViolations, marginalCost } from "./cost";
import type { Roster } from "./rules";
import {
  fitsAvailability,
  shiftsOf,
  sortViolations,
  timeOffConflict,
  validate,
  weeklyHours,
} from "./rules";
import { durationHours, isWeekend } from "./time";

/** Every rule, including the cost-dependent budget rule. */
export function validateAll(roster: Roster): Violation[] {
  return sortViolations([...validate(roster), ...budgetViolations(roster)]);
}

/* -- cheap immutable simulation -------------------------------------------- */

/**
 * Returns a copy of the roster with `staffId` added to `shiftId`.
 * Only the touched shift is cloned; everything else is shared by reference,
 * which keeps candidate ranking fast enough to run on every keystroke.
 */
export function withAssignment(roster: Roster, shiftId: string, staffId: string): Roster {
  const shift = roster.shifts[shiftId];
  if (!shift || shift.assigned.includes(staffId)) return roster;
  return {
    ...roster,
    shifts: { ...roster.shifts, [shiftId]: { ...shift, assigned: [...shift.assigned, staffId] } },
  };
}

export function withoutAssignment(roster: Roster, shiftId: string, staffId: string): Roster {
  const shift = roster.shifts[shiftId];
  if (!shift || !shift.assigned.includes(staffId)) return roster;
  return {
    ...roster,
    shifts: {
      ...roster.shifts,
      [shiftId]: { ...shift, assigned: shift.assigned.filter((id) => id !== staffId) },
    },
  };
}

export function withShift(roster: Roster, shift: Shift): Roster {
  return { ...roster, shifts: { ...roster.shifts, [shift.id]: shift } };
}

/* -- coverage -------------------------------------------------------------- */

export function coverageGaps(roster: Roster): CoverageGap[] {
  return Object.values(roster.shifts)
    .filter((s) => s.assigned.length < s.headcount)
    .map((s) => ({
      shiftId: s.id,
      date: s.date,
      role: s.role,
      start: s.start,
      end: s.end,
      required: s.headcount,
      assigned: s.assigned.length,
      missing: s.headcount - s.assigned.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

export function coveragePercent(roster: Roster): number {
  const shifts = Object.values(roster.shifts);
  const required = shifts.reduce((n, s) => n + s.headcount, 0);
  if (required === 0) return 1;
  const filled = shifts.reduce((n, s) => n + Math.min(s.assigned.length, s.headcount), 0);
  return filled / required;
}

/* -- candidate ranking ----------------------------------------------------- */

/**
 * Ranks everyone for a shift by simulating the assignment and re-running the
 * real validator. Hard-rule breaches become `blockers` (ineligible); soft-rule
 * costs become `concerns`. The agent surfaces both to the manager verbatim,
 * which is why an agent using Rota can explain *why* someone cannot cover.
 */
export function rankCandidates(
  roster: Roster,
  shiftId: string,
  opts: { includeIneligible?: boolean } = {},
): Candidate[] {
  const shift = roster.shifts[shiftId];
  if (!shift) return [];
  const hours = durationHours(shift.start, shift.end);
  const baseline = new Map<string, Violation[]>();
  for (const id of Object.keys(roster.staff)) baseline.set(id, []);
  for (const x of validateAll(roster)) {
    if (x.staffId && baseline.has(x.staffId)) baseline.get(x.staffId)!.push(x);
  }

  const out: Candidate[] = [];
  for (const person of Object.values(roster.staff)) {
    if (shift.assigned.includes(person.id)) continue;

    const sim = withAssignment(roster, shiftId, person.id);
    const before = new Set(baseline.get(person.id)!.map(violationKey));
    const mine = validateAll(sim).filter((x) => x.staffId === person.id);
    const added = mine.filter((x) => !before.has(violationKey(x)));

    const blockers = added.filter((x) => x.severity === "hard");
    // A person going *from* under-hours *to* properly scheduled is an
    // improvement, not a concern -- only count newly introduced soft costs.
    const concerns = added.filter(
      (x) => x.severity === "soft" && x.ruleId !== "minimum_hours_met",
    );

    if (blockers.length > 0 && !opts.includeIneligible) continue;

    const already = weeklyHours(roster, person.id);
    const projected = already + hours;
    const overtime = Math.max(0, projected - person.targetWeeklyHours);
    const cost = marginalCost(roster, person.id, hours);

    const reasons: string[] = [];
    const shortfall = person.targetWeeklyHours - already;
    if (person.contract !== "casual" && shortfall > 0) {
      reasons.push(`${shortfall.toFixed(1)}h short of their ${person.targetWeeklyHours}h contract`);
    }
    if (overtime === 0) reasons.push("no overtime incurred");
    if (person.preferences.prefersMornings && shift.start < 12 * 60) {
      reasons.push("prefers mornings");
    }
    if (person.preferences.prefersEvenings && shift.start >= 12 * 60) {
      reasons.push("prefers evenings");
    }
    if (person.roles[0] === shift.role) reasons.push("primary role");
    if (shift.isClosing && !person.preferences.avoidsClosing) reasons.push("happy to close");

    // Score: start at 100, subtract soft-rule pain, overtime, and cost pressure,
    // add back credit for people who need hours and for a role/preference match.
    let score = 100;
    score -= concerns.reduce((n, c) => n + c.weight * 4, 0);
    score -= overtime * 6;
    score -= (cost / Math.max(1, hours * 30)) * 8;
    if (person.contract !== "casual" && shortfall > 0) score += Math.min(18, shortfall * 1.6);
    if (person.roles[0] === shift.role) score += 6;
    score += Math.min(4, person.seniority);
    if (blockers.length > 0) score = 0;

    out.push({
      staffId: person.id,
      name: person.name,
      score: Math.max(0, Math.round(score)),
      blockers,
      concerns,
      reasons,
      projectedWeeklyHours: projected,
      overtimeHours: overtime,
      costForShift: Math.round(cost * 100) / 100,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.costForShift - b.costForShift);
}

function violationKey(x: Violation): string {
  return `${x.ruleId}|${x.staffId ?? ""}|${x.shiftIds.join(",")}|${x.message}`;
}

/** Quick yes/no used by the solver's inner loop. */
export function isEligible(roster: Roster, shiftId: string, staffId: string): boolean {
  const shift = roster.shifts[shiftId];
  const person = roster.staff[staffId];
  if (!shift || !person) return false;
  if (shift.assigned.includes(staffId)) return false;
  if (!person.roles.includes(shift.role)) return false;
  if (!fitsAvailability(person, shift)) return false;
  if (timeOffConflict(person, shift)) return false;
  const sim = withAssignment(roster, shiftId, staffId);
  return !validate(sim).some((x) => x.severity === "hard" && x.staffId === staffId);
}

/* -- fairness -------------------------------------------------------------- */

export interface FairnessRow {
  staffId: string;
  name: string;
  hours: number;
  targetWeeklyHours: number;
  shifts: number;
  weekendShifts: number;
  closingShifts: number;
  openingShifts: number;
  /** hours ÷ target. 1.0 = exactly contracted. */
  loadIndex: number;
}

export interface FairnessReport {
  rows: FairnessRow[];
  weekendSpread: number;
  closingSpread: number;
  /** Gini-style inequality of load index. 0 = perfectly even. */
  loadInequality: number;
  notes: string[];
}

export function fairnessReport(roster: Roster): FairnessReport {
  const rows: FairnessRow[] = Object.values(roster.staff).map((p) => {
    const mine = shiftsOf(roster, p.id);
    const hours = mine.reduce((h, s) => h + durationHours(s.start, s.end), 0);
    return {
      staffId: p.id,
      name: p.name,
      hours,
      targetWeeklyHours: p.targetWeeklyHours,
      shifts: mine.length,
      weekendShifts: mine.filter((s) => isWeekend(s.date)).length,
      closingShifts: mine.filter((s) => s.isClosing).length,
      openingShifts: mine.filter((s) => s.isOpening).length,
      loadIndex: p.targetWeeklyHours > 0 ? hours / p.targetWeeklyHours : 0,
    };
  });

  const spread = (pick: (r: FairnessRow) => number) => {
    const vals = rows.map(pick);
    return vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  };

  const loads = rows.map((r) => r.loadIndex);
  const mean = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
  const meanAbsDiff =
    loads.reduce((acc, a) => acc + loads.reduce((s, b) => s + Math.abs(a - b), 0), 0) /
    Math.max(1, loads.length * loads.length);
  const loadInequality = mean > 0 ? meanAbsDiff / (2 * mean) : 0;

  const notes: string[] = [];
  const weekendSpread = spread((r) => r.weekendShifts);
  const closingSpread = spread((r) => r.closingShifts);
  if (weekendSpread > 2) notes.push(`Weekend shifts vary by ${weekendSpread} between staff.`);
  if (closingSpread > 2) notes.push(`Closing shifts vary by ${closingSpread} between staff.`);
  const starved = rows.filter((r) => r.targetWeeklyHours > 0 && r.loadIndex < 0.6);
  for (const r of starved) {
    notes.push(`${r.name} is at ${Math.round(r.loadIndex * 100)}% of contracted hours.`);
  }

  return {
    rows: rows.sort((a, b) => b.loadIndex - a.loadIndex),
    weekendSpread,
    closingSpread,
    loadInequality: Math.round(loadInequality * 1000) / 1000,
    notes,
  };
}

/** Dates in the roster week where a person is scheduled at all. */
export function workedDates(roster: Roster, staffId: string): ISODate[] {
  return [...new Set(shiftsOf(roster, staffId).map((s) => s.date))].sort();
}
