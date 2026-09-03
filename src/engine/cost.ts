import type { ISODate, Violation } from "../types";
import type { Roster } from "./rules";
import { shiftsOf, weeklyHours } from "./rules";
import { durationHours } from "./time";

export interface StaffCost {
  staffId: string;
  name: string;
  hours: number;
  regularHours: number;
  overtimeHours: number;
  regularCost: number;
  overtimeCost: number;
  totalCost: number;
}

export interface CostReport {
  currency: string;
  budget: number;
  total: number;
  regularCost: number;
  overtimeCost: number;
  overtimeHours: number;
  /** Fraction of budget consumed. 1.0 = exactly on budget. */
  utilisation: number;
  overBudgetBy: number;
  perStaff: StaffCost[];
  perDay: { date: ISODate; cost: number; hours: number }[];
}

/**
 * Wage cost for the roster week, with overtime priced past each person's
 * contracted target at the venue's multiplier.
 */
export function costReport(roster: Roster): CostReport {
  const perStaff: StaffCost[] = Object.values(roster.staff).map((p) => {
    const hours = weeklyHours(roster, p.id);
    const regularHours = Math.min(hours, p.targetWeeklyHours);
    const overtimeHours = Math.max(0, hours - p.targetWeeklyHours);
    const regularCost = regularHours * p.hourlyRate;
    const overtimeCost = overtimeHours * p.hourlyRate * roster.venue.overtimeMultiplier;
    return {
      staffId: p.id,
      name: p.name,
      hours,
      regularHours,
      overtimeHours,
      regularCost,
      overtimeCost,
      totalCost: regularCost + overtimeCost,
    };
  });

  const perDayMap = new Map<ISODate, { cost: number; hours: number }>();
  for (const shift of Object.values(roster.shifts)) {
    const hrs = durationHours(shift.start, shift.end);
    for (const staffId of shift.assigned) {
      const person = roster.staff[staffId];
      if (!person) continue;
      const entry = perDayMap.get(shift.date) ?? { cost: 0, hours: 0 };
      entry.cost += hrs * person.hourlyRate;
      entry.hours += hrs;
      perDayMap.set(shift.date, entry);
    }
  }

  const regularCost = perStaff.reduce((n, s) => n + s.regularCost, 0);
  const overtimeCost = perStaff.reduce((n, s) => n + s.overtimeCost, 0);
  const total = regularCost + overtimeCost;
  const budget = roster.venue.weeklyLaborBudget;

  return {
    currency: roster.venue.currency,
    budget,
    total,
    regularCost,
    overtimeCost,
    overtimeHours: perStaff.reduce((n, s) => n + s.overtimeHours, 0),
    utilisation: budget > 0 ? total / budget : 0,
    overBudgetBy: Math.max(0, total - budget),
    perStaff: perStaff.sort((a, b) => b.totalCost - a.totalCost),
    perDay: [...perDayMap.entries()]
      .map(([date, x]) => ({ date, ...x }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * The budget rule lives here rather than in `rules.ts` so the rules engine has
 * no dependency on pricing. `validateAll` stitches the two together.
 */
export function budgetViolations(roster: Roster): Violation[] {
  if (!roster.rules.labor_budget?.enabled) return [];
  const report = costReport(roster);
  if (report.overBudgetBy <= 0) return [];
  const fmt = (n: number) => `${roster.venue.currency}${Math.round(n).toLocaleString("en")}`;
  return [
    {
      ruleId: "labor_budget",
      severity: "soft",
      message: `Projected wage cost is ${fmt(report.total)} against a ${fmt(report.budget)} budget - over by ${fmt(report.overBudgetBy)} (${Math.round(report.utilisation * 100)}% of budget), including ${report.overtimeHours.toFixed(1)}h of overtime.`,
      shiftIds: [],
      weight: 4 + Math.min(4, report.overBudgetBy / Math.max(1, report.budget) * 20),
    },
  ];
}

/** Marginal cost of adding one person to one shift, overtime-aware. */
export function marginalCost(roster: Roster, staffId: string, shiftHours: number): number {
  const person = roster.staff[staffId];
  if (!person) return 0;
  const already = weeklyHours(roster, staffId);
  const regular = Math.max(0, Math.min(shiftHours, person.targetWeeklyHours - already));
  const overtime = shiftHours - regular;
  return regular * person.hourlyRate + overtime * person.hourlyRate * roster.venue.overtimeMultiplier;
}

export function shiftCount(roster: Roster, staffId: string): number {
  return shiftsOf(roster, staffId).length;
}
