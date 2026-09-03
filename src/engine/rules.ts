import type {
  ISODate,
  Rule,
  RuleId,
  Shift,
  StaffMember,
  Venue,
  Violation,
} from "../types";
import { ROLE_LABEL } from "../types";
import {
  absMinutes,
  addDays,
  durationHours,
  fmtDateShort,
  fmtTime,
  isWeekend,
  overlaps,
  weekdayOf,
} from "./time";

/**
 * An immutable snapshot of everything the rules engine needs. Tools, the UI and
 * the solver all evaluate against this same shape, so an agent asking "would
 * this be legal?" gets exactly the answer the manager's screen shows.
 */
export interface Roster {
  venue: Venue;
  staff: Record<string, StaffMember>;
  shifts: Record<string, Shift>;
  rules: Record<RuleId, Rule>;
  weekStart: ISODate;
}

export const DEFAULT_RULES: Rule[] = [
  {
    id: "no_double_booking",
    label: "No double-booking",
    description: "A person cannot be assigned to two shifts that overlap in time.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "respect_availability",
    label: "Respect stated availability",
    description:
      "A shift must fall entirely inside one of the person's declared weekly availability windows.",
    severity: "hard",
    enabled: true,
    statutory: false,
  },
  {
    id: "respect_approved_time_off",
    label: "Respect approved time off",
    description: "Nobody may be scheduled during time off that a manager has approved.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "role_certification",
    label: "Role certification",
    description:
      "A person may only work a shift for a role they are trained and certified for.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "max_daily_hours",
    label: "Maximum hours per day",
    description:
      "Total scheduled hours on any single calendar day may not exceed the person's daily cap.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "max_weekly_hours",
    label: "Maximum hours per week",
    description:
      "Total scheduled hours in the roster week may not exceed the person's weekly cap.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "min_rest_between_shifts",
    label: "Minimum rest between shifts",
    description:
      "There must be at least the person's required rest period between the end of one shift and the start of the next. Breaching this is the classic clopening: closing late, then opening early the next morning.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "max_consecutive_days",
    label: "Maximum consecutive days",
    description: "Nobody may work more than their permitted number of days in a row.",
    severity: "hard",
    enabled: true,
    statutory: true,
  },
  {
    id: "minor_no_late_shifts",
    label: "Under-18 curfew",
    description: "Staff under 18 may not be scheduled to work past the curfew time.",
    severity: "hard",
    enabled: true,
    statutory: true,
    param: 22 * 60,
    paramLabel: "Curfew",
    paramUnit: "time",
  },
  {
    id: "coverage_met",
    label: "Coverage met",
    description: "Every shift must have as many people assigned as its required headcount.",
    severity: "hard",
    enabled: true,
    statutory: false,
  },
  {
    id: "labor_budget",
    label: "Weekly labor budget",
    description:
      "Projected wage cost for the week, including overtime, should stay within the venue's labor budget.",
    severity: "soft",
    enabled: true,
    statutory: false,
  },
  {
    id: "honor_preferences",
    label: "Honour stated preferences",
    description:
      "Try to respect soft preferences: preferred times of day, avoiding closes, avoiding weekends, and shift-count caps.",
    severity: "soft",
    enabled: true,
    statutory: false,
  },
  {
    id: "fair_weekend_load",
    label: "Fair weekend load",
    description:
      "Weekend shifts should be spread evenly across everyone who is available at weekends.",
    severity: "soft",
    enabled: true,
    statutory: false,
    param: 2,
    paramLabel: "Max spread",
    paramUnit: "shifts",
  },
  {
    id: "fair_closing_load",
    label: "Fair closing load",
    description:
      "Closing shifts should be spread evenly rather than always landing on the same people.",
    severity: "soft",
    enabled: true,
    statutory: false,
    param: 2,
    paramLabel: "Max spread",
    paramUnit: "shifts",
  },
  {
    id: "minimum_hours_met",
    label: "Contracted hours met",
    description:
      "Full-time and part-time staff should reach the hours their contract guarantees them.",
    severity: "soft",
    enabled: true,
    statutory: false,
    param: 0.85,
    paramLabel: "Floor",
    paramUnit: "fraction of target",
  },
];

export function rulesRecord(rules: Rule[]): Record<RuleId, Rule> {
  return Object.fromEntries(rules.map((r) => [r.id, r])) as Record<RuleId, Rule>;
}

/* -- derived helpers ------------------------------------------------------- */

export function shiftsOf(roster: Roster, staffId: string): Shift[] {
  return Object.values(roster.shifts)
    .filter((s) => s.assigned.includes(staffId))
    .sort((a, b) => absMinutes(a.date, a.start) - absMinutes(b.date, b.start));
}

export function weeklyHours(roster: Roster, staffId: string): number {
  return shiftsOf(roster, staffId).reduce((h, s) => h + durationHours(s.start, s.end), 0);
}

export function dailyHours(roster: Roster, staffId: string, date: ISODate): number {
  return shiftsOf(roster, staffId)
    .filter((s) => s.date === date)
    .reduce((h, s) => h + durationHours(s.start, s.end), 0);
}

/** True when the shift sits inside at least one availability window for that weekday. */
export function fitsAvailability(person: StaffMember, shift: Shift): boolean {
  const wd = weekdayOf(shift.date);
  return person.availability.some(
    (w) => w.weekday === wd && shift.start >= w.start && shift.end <= w.end,
  );
}

export function timeOffConflict(person: StaffMember, shift: Shift) {
  return person.timeOff.find((t) => {
    if (t.status !== "approved" || t.date !== shift.date) return false;
    if (t.start === undefined || t.end === undefined) return true;
    return overlaps(shift.date, shift.start, shift.end, t.date, t.start, t.end);
  });
}

/** Longest run of consecutive worked days that includes `date`. */
function consecutiveRunAround(roster: Roster, staffId: string, date: ISODate): number {
  const worked = new Set(shiftsOf(roster, staffId).map((s) => s.date));
  if (!worked.has(date)) return 0;
  let run = 1;
  for (let d = addDays(date, -1); worked.has(d); d = addDays(d, -1)) run++;
  for (let d = addDays(date, 1); worked.has(d); d = addDays(d, 1)) run++;
  return run;
}

/* -- the validator --------------------------------------------------------- */

function v(
  ruleId: RuleId,
  roster: Roster,
  message: string,
  extra: Partial<Violation> = {},
): Violation {
  return {
    ruleId,
    severity: roster.rules[ruleId].severity,
    message,
    shiftIds: [],
    weight: 1,
    ...extra,
  };
}

/**
 * Evaluates the whole roster against every enabled rule.
 *
 * This is the single source of truth for "is this schedule legal and sane?".
 * The UI renders its output, the solver minimises it, and the WebMCP
 * `validate_schedule` tool returns it verbatim -- so the agent never has to
 * guess at labour law, it just asks the page.
 */
export function validate(roster: Roster): Violation[] {
  const out: Violation[] = [];
  const on = (id: RuleId) => roster.rules[id]?.enabled;
  const staffList = Object.values(roster.staff);

  for (const person of staffList) {
    const mine = shiftsOf(roster, person.id);

    if (on("no_double_booking")) {
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const a = mine[i];
          const b = mine[j];
          if (overlaps(a.date, a.start, a.end, b.date, b.start, b.end)) {
            out.push(
              v(
                "no_double_booking",
                roster,
                `${person.name} is double-booked on ${fmtDateShort(a.date)}: ${fmtTime(a.start)}-${fmtTime(a.end)} overlaps ${fmtTime(b.start)}-${fmtTime(b.end)}.`,
                {
                  staffId: person.id,
                  shiftIds: [a.id, b.id],
                  date: a.date,
                  weight: 10,
                },
              ),
            );
          }
        }
      }
    }

    if (on("respect_availability")) {
      for (const s of mine) {
        if (!fitsAvailability(person, s)) {
          out.push(
            v(
              "respect_availability",
              roster,
              `${person.name} is scheduled ${fmtTime(s.start)}-${fmtTime(s.end)} on ${fmtDateShort(s.date)}, outside their stated availability.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 8 },
            ),
          );
        }
      }
    }

    if (on("respect_approved_time_off")) {
      for (const s of mine) {
        const conflict = timeOffConflict(person, s);
        if (conflict) {
          out.push(
            v(
              "respect_approved_time_off",
              roster,
              `${person.name} has approved time off on ${fmtDateShort(s.date)} (${conflict.reason}) but is scheduled ${fmtTime(s.start)}-${fmtTime(s.end)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 10 },
            ),
          );
        }
      }
    }

    if (on("role_certification")) {
      for (const s of mine) {
        if (!person.roles.includes(s.role)) {
          out.push(
            v(
              "role_certification",
              roster,
              `${person.name} is not certified as ${ROLE_LABEL[s.role]} but is assigned to the ${ROLE_LABEL[s.role]} shift on ${fmtDateShort(s.date)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 9 },
            ),
          );
        }
      }
    }

    if (on("max_daily_hours")) {
      const byDate = new Map<ISODate, Shift[]>();
      for (const s of mine) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
      for (const [date, list] of byDate) {
        const hrs = list.reduce((h, s) => h + durationHours(s.start, s.end), 0);
        if (hrs > person.maxDailyHours + 1e-9) {
          out.push(
            v(
              "max_daily_hours",
              roster,
              `${person.name} is scheduled ${hrs.toFixed(1)}h on ${fmtDateShort(date)}, over their ${person.maxDailyHours}h daily limit.`,
              {
                staffId: person.id,
                shiftIds: list.map((s) => s.id),
                date,
                weight: 7,
              },
            ),
          );
        }
      }
    }

    if (on("max_weekly_hours")) {
      const hrs = mine.reduce((h, s) => h + durationHours(s.start, s.end), 0);
      if (hrs > person.maxWeeklyHours + 1e-9) {
        out.push(
          v(
            "max_weekly_hours",
            roster,
            `${person.name} is scheduled ${hrs.toFixed(1)}h this week, over their ${person.maxWeeklyHours}h weekly limit.`,
            { staffId: person.id, shiftIds: mine.map((s) => s.id), weight: 7 },
          ),
        );
      }
    }

    if (on("min_rest_between_shifts")) {
      for (let i = 0; i + 1 < mine.length; i++) {
        const a = mine[i];
        const b = mine[i + 1];
        const gapH = (absMinutes(b.date, b.start) - absMinutes(a.date, a.end)) / 60;
        if (gapH >= 0 && gapH < person.minRestHours - 1e-9) {
          const clopen = a.isClosing && b.isOpening;
          out.push(
            v(
              "min_rest_between_shifts",
              roster,
              `${person.name} gets only ${gapH.toFixed(1)}h rest between ${fmtDateShort(a.date)} ${fmtTime(a.end)} and ${fmtDateShort(b.date)} ${fmtTime(b.start)} - ${person.minRestHours}h required${clopen ? " (a close-then-open)" : ""}.`,
              {
                staffId: person.id,
                shiftIds: [a.id, b.id],
                date: b.date,
                weight: clopen ? 9 : 6,
              },
            ),
          );
        }
      }
    }

    if (on("max_consecutive_days")) {
      const dates = [...new Set(mine.map((s) => s.date))].sort();
      let worst = 0;
      let worstDate: ISODate | undefined;
      for (const d of dates) {
        const run = consecutiveRunAround(roster, person.id, d);
        if (run > worst) {
          worst = run;
          worstDate = d;
        }
      }
      if (worst > person.maxConsecutiveDays) {
        out.push(
          v(
            "max_consecutive_days",
            roster,
            `${person.name} works ${worst} days in a row, over their ${person.maxConsecutiveDays}-day limit.`,
            {
              staffId: person.id,
              shiftIds: mine.filter((s) => s.date === worstDate).map((s) => s.id),
              date: worstDate,
              weight: 6,
            },
          ),
        );
      }
    }

    if (on("minor_no_late_shifts") && person.isMinor) {
      const curfew = roster.rules.minor_no_late_shifts.param ?? 22 * 60;
      for (const s of mine) {
        if (s.end > curfew) {
          out.push(
            v(
              "minor_no_late_shifts",
              roster,
              `${person.name} is under 18 and is scheduled until ${fmtTime(s.end)} on ${fmtDateShort(s.date)}, past the ${fmtTime(curfew)} curfew.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 10 },
            ),
          );
        }
      }
    }

    if (on("honor_preferences")) {
      const p = person.preferences;
      for (const s of mine) {
        if (p.avoidsClosing && s.isClosing) {
          out.push(
            v(
              "honor_preferences",
              roster,
              `${person.name} prefers not to close but has the closing shift on ${fmtDateShort(s.date)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 3 },
            ),
          );
        }
        if (p.avoidsWeekends && isWeekend(s.date)) {
          out.push(
            v(
              "honor_preferences",
              roster,
              `${person.name} prefers to avoid weekends but is scheduled on ${fmtDateShort(s.date)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 2 },
            ),
          );
        }
        if (p.prefersMornings && s.start >= 14 * 60) {
          out.push(
            v(
              "honor_preferences",
              roster,
              `${person.name} prefers mornings but starts at ${fmtTime(s.start)} on ${fmtDateShort(s.date)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 2 },
            ),
          );
        }
        if (p.prefersEvenings && s.end <= 13 * 60) {
          out.push(
            v(
              "honor_preferences",
              roster,
              `${person.name} prefers evenings but finishes at ${fmtTime(s.end)} on ${fmtDateShort(s.date)}.`,
              { staffId: person.id, shiftIds: [s.id], date: s.date, weight: 2 },
            ),
          );
        }
      }
      if (p.maxShiftsPerWeek !== undefined && mine.length > p.maxShiftsPerWeek) {
        out.push(
          v(
            "honor_preferences",
            roster,
            `${person.name} asked for at most ${p.maxShiftsPerWeek} shifts a week but has ${mine.length}.`,
            { staffId: person.id, shiftIds: mine.map((s) => s.id), weight: 3 },
          ),
        );
      }
    }

    if (on("minimum_hours_met") && person.contract !== "casual") {
      const floor = (roster.rules.minimum_hours_met.param ?? 0.85) * person.targetWeeklyHours;
      const hrs = mine.reduce((h, s) => h + durationHours(s.start, s.end), 0);
      if (hrs < floor - 1e-9) {
        out.push(
          v(
            "minimum_hours_met",
            roster,
            `${person.name} is contracted for ${person.targetWeeklyHours}h but only has ${hrs.toFixed(1)}h scheduled.`,
            {
              staffId: person.id,
              shiftIds: mine.map((s) => s.id),
              weight: hrs === 0 ? 4 : 3,
            },
          ),
        );
      }
    }
  }

  if (on("coverage_met")) {
    for (const s of Object.values(roster.shifts)) {
      if (s.assigned.length < s.headcount) {
        const missing = s.headcount - s.assigned.length;
        out.push(
          v(
            "coverage_met",
            roster,
            `${fmtDateShort(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)} ${ROLE_LABEL[s.role]} needs ${s.headcount} but has ${s.assigned.length} - ${missing} unfilled.`,
            { shiftIds: [s.id], date: s.date, weight: 5 + missing },
          ),
        );
      }
    }
  }

  if (on("fair_weekend_load")) out.push(...fairnessViolations(roster, "fair_weekend_load"));
  if (on("fair_closing_load")) out.push(...fairnessViolations(roster, "fair_closing_load"));

  return sortViolations(out);
}

export function sortViolations(list: Violation[]): Violation[] {
  return [...list].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1) || b.weight - a.weight,
  );
}

function fairnessViolations(
  roster: Roster,
  ruleId: "fair_weekend_load" | "fair_closing_load",
): Violation[] {
  const spread = roster.rules[ruleId].param ?? 2;
  const counts = new Map<string, number>();
  const eligible = Object.values(roster.staff).filter((p) =>
    ruleId === "fair_weekend_load"
      ? p.availability.some((w) => w.weekday === 0 || w.weekday === 6)
      : !p.preferences.avoidsClosing,
  );
  for (const p of eligible) counts.set(p.id, 0);
  for (const s of Object.values(roster.shifts)) {
    const relevant = ruleId === "fair_weekend_load" ? isWeekend(s.date) : s.isClosing;
    if (!relevant) continue;
    for (const id of s.assigned) if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  if (counts.size < 2) return [];
  const values = [...counts.values()];
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max - min <= spread) return [];
  const worst = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
  const label = ruleId === "fair_weekend_load" ? "weekend" : "closing";
  return worst.map((id) =>
    v(
      ruleId,
      roster,
      `${roster.staff[id].name} has ${max} ${label} shifts while someone else has ${min} - an uneven spread of ${max - min} (limit ${spread}).`,
      {
        staffId: id,
        shiftIds: Object.values(roster.shifts)
          .filter(
            (s) =>
              s.assigned.includes(id) &&
              (ruleId === "fair_weekend_load" ? isWeekend(s.date) : s.isClosing),
          )
          .map((s) => s.id),
        weight: 3,
      },
    ),
  );
}

/** Groups violations by rule for compact reporting to an agent. */
export function summarizeViolations(violations: Violation[]) {
  const byRule = new Map<RuleId, number>();
  for (const x of violations) byRule.set(x.ruleId, (byRule.get(x.ruleId) ?? 0) + 1);
  return {
    hard: violations.filter((x) => x.severity === "hard").length,
    soft: violations.filter((x) => x.severity === "soft").length,
    byRule: Object.fromEntries(byRule),
  };
}
