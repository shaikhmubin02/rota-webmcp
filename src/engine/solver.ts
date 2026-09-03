import type { ISODate, Role, Violation } from "../types";
import { ROLE_LABEL } from "../types";
import { costReport } from "./cost";
import type { Roster } from "./rules";
import {
  coverageGaps,
  isEligible,
  rankCandidates,
  validateAll,
  withAssignment,
  withoutAssignment,
} from "./evaluate";
import { fmtDateShort, fmtTime } from "./time";

export type Objective = "balanced" | "minimise_cost" | "maximise_fairness" | "honour_preferences";

export interface SolveOptions {
  objective?: Objective;
  /** Refuse assignments that would push anyone into overtime. */
  avoidOvertime?: boolean;
  /** Only consider these dates. Defaults to the whole roster week. */
  dates?: ISODate[];
  /** Only fill these roles. */
  roles?: Role[];
  /** Never use these people (e.g. someone who just called in sick). */
  excludeStaff?: string[];
  /** Only use these people, if provided. */
  onlyStaff?: string[];
  /** Cap on local-search passes. Kept small so tool calls stay snappy. */
  improvementPasses?: number;
}

export interface PlannedAssignment {
  shiftId: string;
  staffId: string;
  staffName: string;
  date: ISODate;
  start: number;
  end: number;
  role: Role;
  score: number;
  cost: number;
  reasons: string[];
  concerns: string[];
}

export interface SolveResult {
  assignments: PlannedAssignment[];
  /** Slots the solver could not fill legally, with the reason. */
  unfilled: {
    shiftId: string;
    date: ISODate;
    role: Role;
    start: number;
    end: number;
    reason: string;
    /** Who was closest, and what blocked them. */
    nearMisses: { name: string; blockedBy: string }[];
  }[];
  addedCost: number;
  violationsBefore: number;
  violationsAfter: number;
  hardBefore: number;
  hardAfter: number;
  /** One-paragraph plain-English account, ready to show a manager. */
  narrative: string;
}

const OBJECTIVE_WEIGHTS: Record<Objective, { cost: number; fairness: number; preference: number }> =
  {
    balanced: { cost: 1, fairness: 1, preference: 1 },
    minimise_cost: { cost: 3, fairness: 0.4, preference: 0.4 },
    maximise_fairness: { cost: 0.4, fairness: 3, preference: 0.8 },
    honour_preferences: { cost: 0.4, fairness: 0.8, preference: 3 },
  };

/**
 * Fills open slots with a most-constrained-first greedy pass, then a bounded
 * local-search pass that swaps assignments while total soft-violation weight
 * keeps falling.
 *
 * The solver never mutates the live roster. It returns a plan, which the WebMCP
 * `propose_fill_gaps` tool stages as reviewable edits.
 */
export function solve(roster: Roster, opts: SolveOptions = {}): SolveResult {
  const objective = opts.objective ?? "balanced";
  const weights = OBJECTIVE_WEIGHTS[objective];
  const excluded = new Set(opts.excludeStaff ?? []);
  const allowed = opts.onlyStaff && opts.onlyStaff.length ? new Set(opts.onlyStaff) : null;

  const before = validateAll(roster);
  const costBefore = costReport(roster).total;

  let working = roster;

  // One entry per missing person, so a shift needing 2 more appears twice.
  const slots = coverageGaps(working)
    .filter((g) => !opts.dates || opts.dates.includes(g.date))
    .filter((g) => !opts.roles || opts.roles.includes(g.role))
    .flatMap((g) => Array.from({ length: g.missing }, () => g));

  const unfilled: SolveResult["unfilled"] = [];
  const assignments: PlannedAssignment[] = [];

  // Most-constrained-first: repeatedly take the slot with the fewest legal
  // candidates. Recomputed each round because every assignment changes the
  // eligibility landscape (rest windows, weekly caps, consecutive days).
  const remaining = [...slots];
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCount = Infinity;
    let bestRanked: ReturnType<typeof rankCandidates> = [];

    for (let i = 0; i < remaining.length; i++) {
      const ranked = rankCandidates(working, remaining[i].shiftId).filter(
        (c) =>
          !excluded.has(c.staffId) &&
          (!allowed || allowed.has(c.staffId)) &&
          (!opts.avoidOvertime || c.overtimeHours === 0),
      );
      if (ranked.length < bestCount) {
        bestCount = ranked.length;
        bestIdx = i;
        bestRanked = ranked;
      }
      if (bestCount === 0) break;
    }

    const slot = remaining.splice(bestIdx, 1)[0];
    const shift = working.shifts[slot.shiftId];
    if (!shift) continue;

    if (bestRanked.length === 0) {
      const nearMisses = rankCandidates(working, slot.shiftId, { includeIneligible: true })
        .filter((c) => c.blockers.length > 0)
        .slice(0, 3)
        .map((c) => ({
          name: c.name,
          blockedBy: c.blockers[0]?.message ?? "unknown constraint",
        }));
      const reason = excluded.size
        ? `No eligible staff remain once ${[...excluded].map((id) => roster.staff[id]?.name ?? id).join(", ")} ${excluded.size === 1 ? "is" : "are"} excluded${opts.avoidOvertime ? " and overtime is off the table" : ""}.`
        : opts.avoidOvertime
          ? "Nobody can take this without going into overtime."
          : "Every remaining person would breach a hard rule.";
      unfilled.push({
        shiftId: shift.id,
        date: shift.date,
        role: shift.role,
        start: shift.start,
        end: shift.end,
        reason,
        nearMisses,
      });
      continue;
    }

    const scored = bestRanked
      .map((c) => {
        const preferencePain = c.concerns
          .filter((x) => x.ruleId === "honor_preferences")
          .reduce((n, x) => n + x.weight, 0);
        const fairnessPain = c.concerns
          .filter((x) => x.ruleId === "fair_weekend_load" || x.ruleId === "fair_closing_load")
          .reduce((n, x) => n + x.weight, 0);
        const adjusted =
          c.score -
          weights.cost * (c.costForShift / 10) -
          weights.preference * preferencePain * 3 -
          weights.fairness * fairnessPain * 3;
        return { c, adjusted };
      })
      .sort((a, b) => b.adjusted - a.adjusted);

    const pick = scored[0].c;
    working = withAssignment(working, shift.id, pick.staffId);
    assignments.push({
      shiftId: shift.id,
      staffId: pick.staffId,
      staffName: pick.name,
      date: shift.date,
      start: shift.start,
      end: shift.end,
      role: shift.role,
      score: pick.score,
      cost: pick.costForShift,
      reasons: pick.reasons,
      concerns: pick.concerns.map((x) => x.message),
    });
  }

  // Bounded local search: try moving one just-made assignment to a different
  // person if it lowers total soft weight. Keeps the plan honest about fairness
  // without turning a tool call into a long-running optimisation.
  const passes = opts.improvementPasses ?? 2;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const a of assignments) {
      const currentWeight = softWeight(validateAll(working));
      const stripped = withoutAssignment(working, a.shiftId, a.staffId);
      const alternatives = rankCandidates(stripped, a.shiftId).filter(
        (c) =>
          c.staffId !== a.staffId &&
          !excluded.has(c.staffId) &&
          (!allowed || allowed.has(c.staffId)) &&
          (!opts.avoidOvertime || c.overtimeHours === 0),
      );
      for (const alt of alternatives.slice(0, 4)) {
        const candidate = withAssignment(stripped, a.shiftId, alt.staffId);
        const w = softWeight(validateAll(candidate));
        if (w < currentWeight - 0.5) {
          working = candidate;
          a.staffId = alt.staffId;
          a.staffName = alt.name;
          a.score = alt.score;
          a.cost = alt.costForShift;
          a.reasons = alt.reasons;
          a.concerns = alt.concerns.map((x) => x.message);
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }

  const after = validateAll(working);
  const costAfter = costReport(working).total;
  const hardBefore = before.filter((x) => x.severity === "hard").length;
  const hardAfter = after.filter((x) => x.severity === "hard").length;

  return {
    assignments,
    unfilled,
    addedCost: Math.round((costAfter - costBefore) * 100) / 100,
    violationsBefore: before.length,
    violationsAfter: after.length,
    hardBefore,
    hardAfter,
    narrative: narrate(roster, assignments, unfilled, {
      objective,
      addedCost: costAfter - costBefore,
      hardBefore,
      hardAfter,
    }),
  };
}

function softWeight(violations: Violation[]): number {
  return violations
    .filter((x) => x.severity === "soft")
    .reduce((n, x) => n + x.weight, 0);
}

function narrate(
  roster: Roster,
  assignments: PlannedAssignment[],
  unfilled: SolveResult["unfilled"],
  meta: { objective: Objective; addedCost: number; hardBefore: number; hardAfter: number },
): string {
  const cur = roster.venue.currency;
  const parts: string[] = [];
  if (assignments.length === 0 && unfilled.length === 0) {
    return "Nothing to fill - every shift in scope already has full coverage.";
  }
  if (assignments.length > 0) {
    parts.push(
      `Filled ${assignments.length} open slot${assignments.length === 1 ? "" : "s"} optimising for ${meta.objective.replace(/_/g, " ")}, adding ${cur}${Math.round(meta.addedCost)} to the week.`,
    );
  }
  if (unfilled.length > 0) {
    const list = unfilled
      .slice(0, 3)
      .map(
        (u) => `${fmtDateShort(u.date)} ${fmtTime(u.start)}-${fmtTime(u.end)} ${ROLE_LABEL[u.role]}`,
      )
      .join("; ");
    parts.push(
      `${unfilled.length} slot${unfilled.length === 1 ? "" : "s"} could not be filled legally (${list}${unfilled.length > 3 ? ", ..." : ""}).`,
    );
  }
  if (meta.hardAfter < meta.hardBefore) {
    parts.push(`Hard-rule breaches fell from ${meta.hardBefore} to ${meta.hardAfter}.`);
  } else if (meta.hardAfter > meta.hardBefore) {
    parts.push(`Warning: hard-rule breaches rose from ${meta.hardBefore} to ${meta.hardAfter}.`);
  }
  return parts.join(" ");
}

/**
 * Re-covers the shifts a person can no longer work -- the "called in sick"
 * cascade. Returns the removals plus a plan to backfill them.
 */
export function planAbsenceCover(
  roster: Roster,
  staffId: string,
  dates: ISODate[],
  opts: SolveOptions = {},
): { removals: { shiftId: string; date: ISODate; role: Role; start: number; end: number }[]; fill: SolveResult } {
  const affected = Object.values(roster.shifts).filter(
    (s) => s.assigned.includes(staffId) && dates.includes(s.date),
  );
  let stripped = roster;
  for (const s of affected) stripped = withoutAssignment(stripped, s.id, staffId);
  const fill = solve(stripped, {
    ...opts,
    dates,
    excludeStaff: [...(opts.excludeStaff ?? []), staffId],
  });
  return {
    removals: affected.map((s) => ({
      shiftId: s.id,
      date: s.date,
      role: s.role,
      start: s.start,
      end: s.end,
    })),
    fill,
  };
}

/** Finds a legal two-way swap that resolves a specific violation, if one exists. */
export function findSwapFor(
  roster: Roster,
  shiftId: string,
  staffId: string,
): { withShiftId: string; withStaffId: string; withStaffName: string; note: string } | null {
  const target = roster.shifts[shiftId];
  if (!target) return null;
  const baselineHard = validateAll(roster).filter((x) => x.severity === "hard").length;

  // Any shift will do as a swap partner, not just one with the same role:
  // `isEligible` already enforces certification, so restricting the search to
  // identical roles only threw away legal swaps.
  for (const other of Object.values(roster.shifts)) {
    if (other.id === shiftId) continue;
    for (const otherStaff of other.assigned) {
      if (otherStaff === staffId) continue;
      let sim = withoutAssignment(roster, shiftId, staffId);
      sim = withoutAssignment(sim, other.id, otherStaff);
      if (!isEligible(sim, shiftId, otherStaff)) continue;
      const step = withAssignment(sim, shiftId, otherStaff);
      if (!isEligible(step, other.id, staffId)) continue;
      const done = withAssignment(step, other.id, staffId);
      const hard = validateAll(done).filter((x) => x.severity === "hard").length;
      if (hard < baselineHard) {
        return {
          withShiftId: other.id,
          withStaffId: otherStaff,
          withStaffName: roster.staff[otherStaff]?.name ?? otherStaff,
          note: `Swapping with ${roster.staff[otherStaff]?.name} on ${fmtDateShort(other.date)} clears ${baselineHard - hard} hard breach${baselineHard - hard === 1 ? "" : "es"}.`,
        };
      }
    }
  }
  return null;
}
