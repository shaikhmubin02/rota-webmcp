import { ROLES, ROLE_LABEL } from "../types";
import { costReport } from "../engine/cost";
import {
  coverageGaps,
  coveragePercent,
  fairnessReport,
  rankCandidates,
  validateAll,
  workedDates,
} from "../engine/evaluate";
import { fitsAvailability, shiftsOf, timeOffConflict, weeklyHours } from "../engine/rules";
import {
  WEEKDAY_SHORT,
  durationHours,
  fmtDateShort,
  fmtTime,
  isWeekend,
  weekDates,
} from "../engine/time";
import { ctx, type RotaTool } from "./ctx";
import { resolveDateOrThrow, resolveRole, resolveShift, resolveStaff } from "./resolve";
import { describeCandidates, describeShift, describeViolations, money, result } from "./result";

const readOnly = { readOnlyHint: true } as const;

export const readTools: RotaTool[] = [
  {
    name: "get_schedule_overview",
    title: "Schedule overview",
    description:
      "Get the headline state of the roster week: coverage percentage, number of open slots, rule breaches by severity, projected wage cost against budget, and overtime. Call this first when you do not yet know the state of the schedule.",
    group: "read",
    annotations: readOnly,
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const violations = validateAll(roster);
      const hard = violations.filter((v) => v.severity === "hard");
      const soft = violations.filter((v) => v.severity === "soft");
      const gaps = coverageGaps(roster);
      const cost = costReport(roster);
      const dates = weekDates(roster.weekStart);
      const shifts = Object.values(roster.shifts).filter((s) => dates.includes(s.date));

      const text = [
        `${roster.venue.name} - roster week ${fmtDateShort(dates[0])} to ${fmtDateShort(dates[6])}.`,
        `Coverage: ${Math.round(coveragePercent(roster) * 100)}% (${shifts.length} shifts, ${gaps.reduce((n, g) => n + g.missing, 0)} unfilled slots across ${gaps.length} shifts).`,
        `Rules: ${hard.length} hard breach${hard.length === 1 ? "" : "es"}, ${soft.length} soft issue${soft.length === 1 ? "" : "s"}.`,
        `Cost: ${money(roster, cost.total)} of a ${money(roster, cost.budget)} budget (${Math.round(cost.utilisation * 100)}%), including ${cost.overtimeHours.toFixed(1)}h overtime worth ${money(roster, cost.overtimeCost)}.`,
        hard.length
          ? `Most serious: ${hard[0].message}`
          : "No hard breaches - the week is legal as it stands.",
        `Team: ${Object.keys(roster.staff).length} people.`,
      ].join("\n");

      return result(text, {
        weekStart: roster.weekStart,
        coverage: coveragePercent(roster),
        openSlots: gaps.reduce((n, g) => n + g.missing, 0),
        hardViolations: hard.length,
        softViolations: soft.length,
        cost: { total: cost.total, budget: cost.budget, overtimeHours: cost.overtimeHours },
      });
    },
  },

  {
    name: "list_staff",
    title: "List staff",
    description:
      "List the team with their roles, contract, hours scheduled this week and hours remaining. Filter to find exactly who you need - for example everyone certified as a shift lead who is free on Saturday and still under their contracted hours.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: [...ROLES],
          description: "Only people certified for this role.",
        },
        available_on: {
          type: "string",
          description:
            "Only people whose stated availability covers this date and who have no approved time off on it. Accepts YYYY-MM-DD or a weekday name.",
        },
        under_contracted_hours: {
          type: "boolean",
          description: "Only people currently scheduled below their contracted weekly hours.",
        },
        has_spare_capacity: {
          type: "boolean",
          description: "Only people who could take more hours without breaching their weekly cap.",
        },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const role = args.role ? resolveRole(String(args.role)) : null;
      const date = args.available_on
        ? resolveDateOrThrow(roster, String(args.available_on), today)
        : null;

      let people = Object.values(roster.staff);
      if (role) people = people.filter((p) => p.roles.includes(role));
      if (date) {
        people = people.filter((p) => {
          const dayShifts = Object.values(roster.shifts).filter((s) => s.date === date);
          const anyWindow = p.availability.some(
            (w) => w.weekday === new Date(date).getDay() || dayShifts.some((s) => fitsAvailability(p, s)),
          );
          const blocked = p.timeOff.some((t) => t.status === "approved" && t.date === date);
          return anyWindow && !blocked;
        });
      }
      if (args.under_contracted_hours) {
        people = people.filter(
          (p) => p.contract !== "casual" && weeklyHours(roster, p.id) < p.targetWeeklyHours,
        );
      }
      if (args.has_spare_capacity) {
        people = people.filter((p) => weeklyHours(roster, p.id) < p.maxWeeklyHours - 0.5);
      }

      if (people.length === 0) {
        return result("No staff match those filters. Relax one of them and try again.");
      }

      const rows = people
        .map((p) => {
          const hrs = weeklyHours(roster, p.id);
          const prefs = Object.entries(p.preferences)
            .filter(([, v]) => v)
            .map(([k, v]) => (typeof v === "number" ? `${k}=${v}` : k))
            .join(", ");
          return `- ${p.name} (${p.id}) | ${p.roles.map((r) => ROLE_LABEL[r]).join("/")} | ${p.contract.replace("_", "-")} | ${hrs.toFixed(1)}h of ${p.targetWeeklyHours}h target, cap ${p.maxWeeklyHours}h | ${roster.venue.currency}${p.hourlyRate}/h${p.isMinor ? " | UNDER 18" : ""}${prefs ? ` | prefers: ${prefs}` : ""}${p.notes ? ` | note: ${p.notes}` : ""}`;
        })
        .join("\n");

      return result(
        `${people.length} of ${Object.keys(roster.staff).length} staff match:\n${rows}`,
        people.map((p) => ({
          id: p.id,
          name: p.name,
          roles: p.roles,
          hours: weeklyHours(roster, p.id),
          target: p.targetWeeklyHours,
          max: p.maxWeeklyHours,
          rate: p.hourlyRate,
          isMinor: p.isMinor,
        })),
      );
    },
  },

  {
    name: "get_staff_details",
    title: "Staff details",
    description:
      "Everything about one person: certifications, contract, availability windows, time off, preferences, manager notes, every shift they are on this week, and their current hours and cost.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string", description: "Name or id, e.g. \"Marco\" or \"marco\"." },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster } = ctx();
      const p = resolveStaff(roster, String(args.staff));
      const mine = shiftsOf(roster, p.id);
      const hrs = weeklyHours(roster, p.id);
      const av = p.availability
        .map((w) => `${WEEKDAY_SHORT[w.weekday]} ${fmtTime(w.start)}-${fmtTime(w.end)}`)
        .join(", ");
      const off = p.timeOff.length
        ? p.timeOff
            .map(
              (t) =>
                `${fmtDateShort(t.date)}${t.start !== undefined ? ` ${fmtTime(t.start)}-${fmtTime(t.end!)}` : " (all day)"} - ${t.reason} [${t.status}]`,
            )
            .join("; ")
        : "none";
      const shiftLines = mine.length
        ? mine
            .map(
              (s) =>
                `  - ${fmtDateShort(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)} ${ROLE_LABEL[s.role]}${s.isClosing ? " (closing)" : s.isOpening ? " (opening)" : ""} [${s.id}]`,
            )
            .join("\n")
        : "  - none scheduled";

      const text = [
        `${p.name} (${p.id})`,
        `Certified for: ${p.roles.map((r) => ROLE_LABEL[r]).join(", ")}`,
        `Contract: ${p.contract.replace("_", "-")}, target ${p.targetWeeklyHours}h/week, hard cap ${p.maxWeeklyHours}h/week and ${p.maxDailyHours}h/day`,
        `Rest required between shifts: ${p.minRestHours}h. Max ${p.maxConsecutiveDays} consecutive days.`,
        p.isMinor ? "UNDER 18 - statutory curfew applies." : "",
        `Pay: ${roster.venue.currency}${p.hourlyRate}/h. Scheduled ${hrs.toFixed(1)}h this week across ${mine.length} shifts, on ${workedDates(roster, p.id).length} days.`,
        `Availability: ${av || "none stated"}`,
        `Time off: ${off}`,
        `Preferences: ${JSON.stringify(p.preferences)}`,
        p.notes ? `Manager note: ${p.notes}` : "",
        `Shifts this week:\n${shiftLines}`,
      ]
        .filter(Boolean)
        .join("\n");

      return result(text, { ...p, scheduledHours: hrs, shiftIds: mine.map((s) => s.id) });
    },
  },

  {
    name: "list_shifts",
    title: "List shifts",
    description:
      "List shifts with who is on them. Filter by date, role, whether they still need people, or who is working them.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "A single date (YYYY-MM-DD or weekday name)." },
        role: { type: "string", enum: [...ROLES] },
        unfilled_only: {
          type: "boolean",
          description: "Only shifts with fewer people assigned than their required headcount.",
        },
        staff: { type: "string", description: "Only shifts this person is assigned to." },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      let shifts = Object.values(roster.shifts);
      if (args.date) {
        const date = resolveDateOrThrow(roster, String(args.date), today);
        shifts = shifts.filter((s) => s.date === date);
      }
      if (args.role) {
        const role = resolveRole(String(args.role));
        shifts = shifts.filter((s) => s.role === role);
      }
      if (args.unfilled_only) shifts = shifts.filter((s) => s.assigned.length < s.headcount);
      if (args.staff) {
        const p = resolveStaff(roster, String(args.staff));
        shifts = shifts.filter((s) => s.assigned.includes(p.id));
      }
      shifts.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);

      if (shifts.length === 0) return result("No shifts match those filters.");
      return result(
        `${shifts.length} shift${shifts.length === 1 ? "" : "s"}:\n${shifts.map((s) => `- ${describeShift(roster, s.id)}`).join("\n")}`,
        shifts,
      );
    },
  },

  {
    name: "get_shift_details",
    title: "Shift details",
    description:
      "Full detail for one shift, including who is on it, how many are still needed, and the hours and cost it represents.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: {
          type: "string",
          description: 'Disambiguator: "opening", "closing", "morning", "evening", or a time like "16:30".',
        },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const shift = resolveShift(roster, args, today);
      const hrs = durationHours(shift.start, shift.end);
      const cost = shift.assigned.reduce(
        (n, id) => n + hrs * (roster.staff[id]?.hourlyRate ?? 0),
        0,
      );
      const people = shift.assigned
        .map((id) => {
          const p = roster.staff[id];
          return p ? `  - ${p.name} (${p.id}), ${p.roles.map((r) => ROLE_LABEL[r]).join("/")}` : `  - ${id}`;
        })
        .join("\n");
      const text = [
        describeShift(roster, shift.id),
        `Length: ${hrs.toFixed(1)}h. Wage cost as staffed: ${money(roster, cost)}.`,
        shift.assigned.length ? `Assigned:\n${people}` : "Nobody assigned yet.",
        shift.assigned.length < shift.headcount
          ? `Still needs ${shift.headcount - shift.assigned.length} more.`
          : "Fully staffed.",
        shift.notes ? `Notes: ${shift.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return result(text, shift);
    },
  },

  {
    name: "find_cover",
    title: "Find cover for a shift",
    description:
      "Rank everyone who could take a shift, with the reasoning. Eligible people come back scored, with their projected hours, overtime and marginal cost. Set include_blocked to also see who CANNOT take it and exactly which rule stops them - use that to explain a refusal to the manager instead of guessing.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string", description: 'e.g. "opening", "closing", "16:30".' },
        include_blocked: {
          type: "boolean",
          description: "Also list ineligible people and the hard rule that blocks each of them.",
          default: false,
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Names or ids to leave out, e.g. someone who has called in sick.",
        },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const shift = resolveShift(roster, args, today);
      const excluded = new Set(
        ((args.exclude as string[]) ?? []).map((r) => resolveStaff(roster, r).id),
      );
      const includeBlocked = Boolean(args.include_blocked);
      const ranked = rankCandidates(roster, shift.id, { includeIneligible: includeBlocked }).filter(
        (c) => !excluded.has(c.staffId),
      );
      const eligible = ranked.filter((c) => c.blockers.length === 0);
      const blocked = ranked.filter((c) => c.blockers.length > 0);

      const parts = [
        `Cover options for ${describeShift(roster, shift.id)}`,
        `${eligible.length} eligible:`,
        describeCandidates(eligible),
      ];
      if (includeBlocked && blocked.length) {
        parts.push(
          `${blocked.length} blocked:`,
          blocked
            .map((c) => `- ${c.name} (${c.staffId}) - ${c.blockers.map((b) => b.message).join(" ")}`)
            .join("\n"),
        );
      }
      return result(parts.join("\n"), { shiftId: shift.id, eligible, blocked });
    },
  },

  {
    name: "validate_schedule",
    title: "Validate the schedule",
    description:
      "Run the venue's full rule engine over the schedule as it currently stands, including any changes you have staged but not yet had approved. Returns every breach in plain English with the rule that produced it. Always call this after making changes so you can tell the manager whether the week is legal - never assert compliance without checking.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["all", "hard", "soft"],
          default: "all",
          description: "Hard breaches are statutory or contractual. Soft ones are fairness, cost and preference issues.",
        },
        staff: { type: "string", description: "Only breaches involving this person." },
      },
    },
    execute(args) {
      const { roster } = ctx();
      let violations = validateAll(roster);
      const severity = String(args.severity ?? "all");
      if (severity === "hard") violations = violations.filter((v) => v.severity === "hard");
      if (severity === "soft") violations = violations.filter((v) => v.severity === "soft");
      if (args.staff) {
        const p = resolveStaff(roster, String(args.staff));
        violations = violations.filter((v) => v.staffId === p.id);
      }
      return result(describeViolations(violations, 20), violations);
    },
  },

  {
    name: "get_coverage_gaps",
    title: "Coverage gaps",
    description:
      "Every shift that still needs people, oldest first, with how many are missing. This is the work list for filling a rota.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: { date: { type: "string", description: "Restrict to one date." } },
    },
    execute(args) {
      const { roster, today } = ctx();
      let gaps = coverageGaps(roster);
      if (args.date) {
        const date = resolveDateOrThrow(roster, String(args.date), today);
        gaps = gaps.filter((g) => g.date === date);
      }
      if (gaps.length === 0) return result("No coverage gaps - every shift is fully staffed.");
      const total = gaps.reduce((n, g) => n + g.missing, 0);
      const lines = gaps
        .map(
          (g) =>
            `- ${fmtDateShort(g.date)} ${fmtTime(g.start)}-${fmtTime(g.end)} ${ROLE_LABEL[g.role]}: ${g.assigned}/${g.required}, need ${g.missing} more [${g.shiftId}]`,
        )
        .join("\n");
      return result(
        `${total} unfilled slot${total === 1 ? "" : "s"} across ${gaps.length} shift${gaps.length === 1 ? "" : "s"}:\n${lines}`,
        gaps,
      );
    },
  },

  {
    name: "get_labor_cost",
    title: "Labor cost",
    description:
      "Wage cost for the week against budget, broken down per person and per day, with overtime priced at the venue's multiplier. Use this before proposing changes that add hours.",
    group: "read",
    annotations: readOnly,
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const r = costReport(roster);
      const perStaff = r.perStaff
        .filter((s) => s.hours > 0)
        .map(
          (s) =>
            `- ${s.name}: ${s.hours.toFixed(1)}h = ${money(roster, s.totalCost)}${s.overtimeHours > 0 ? ` (incl. ${s.overtimeHours.toFixed(1)}h overtime at ${roster.venue.overtimeMultiplier}x = ${money(roster, s.overtimeCost)})` : ""}`,
        )
        .join("\n");
      const perDay = r.perDay
        .map((d) => `- ${fmtDateShort(d.date)}: ${d.hours.toFixed(1)}h, ${money(roster, d.cost)}`)
        .join("\n");
      const text = [
        `Projected wage cost ${money(roster, r.total)} against a ${money(roster, r.budget)} budget - ${Math.round(r.utilisation * 100)}% of budget${r.overBudgetBy > 0 ? `, over by ${money(roster, r.overBudgetBy)}` : `, ${money(roster, r.budget - r.total)} to spare`}.`,
        `Overtime: ${r.overtimeHours.toFixed(1)}h worth ${money(roster, r.overtimeCost)}.`,
        `Per person:\n${perStaff}`,
        `Per day:\n${perDay}`,
      ].join("\n");
      return result(text, r);
    },
  },

  {
    name: "get_fairness_report",
    title: "Fairness report",
    description:
      "How the week is distributed: hours against contract, shift counts, and who is carrying the weekends and the closes. Managers get this wrong by hand and staff notice. Use it to justify a rebalance.",
    group: "read",
    annotations: readOnly,
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const r = fairnessReport(roster);
      const rows = r.rows
        .map(
          (x) =>
            `- ${x.name}: ${x.hours.toFixed(1)}h of ${x.targetWeeklyHours}h (${Math.round(x.loadIndex * 100)}%), ${x.shifts} shifts, ${x.weekendShifts} weekend, ${x.closingShifts} closing, ${x.openingShifts} opening`,
        )
        .join("\n");
      const text = [
        `Load inequality index ${r.loadInequality} (0 is perfectly even).`,
        `Weekend spread ${r.weekendSpread} shifts, closing spread ${r.closingSpread} shifts.`,
        rows,
        r.notes.length ? `Flags:\n${r.notes.map((n) => `- ${n}`).join("\n")}` : "No fairness flags.",
      ].join("\n");
      return result(text, r);
    },
  },

  {
    name: "list_rules",
    title: "List scheduling rules",
    description:
      "The venue's rule set: which rules are hard (statutory or contractual, never negotiable) versus soft (fairness, cost, preference), whether each is enabled, and any tunable value. Read this before you propose relaxing anything.",
    group: "read",
    annotations: readOnly,
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const lines = Object.values(roster.rules)
        .map(
          (r) =>
            `- ${r.id} | ${r.severity}${r.statutory ? " (statutory - cannot be switched off)" : ""} | ${r.enabled ? "enabled" : "DISABLED"}${r.param !== undefined ? ` | ${r.paramLabel}: ${r.paramUnit === "time" ? fmtTime(r.param) : r.param}${r.paramUnit && r.paramUnit !== "time" ? ` ${r.paramUnit}` : ""}` : ""}\n    ${r.description}`,
        )
        .join("\n");
      return result(`${Object.keys(roster.rules).length} rules:\n${lines}`, Object.values(roster.rules));
    },
  },

  {
    name: "get_week_grid",
    title: "Week at a glance",
    description:
      "A compact day-by-day text grid of the whole week: every shift, who is on it, and where the holes are. One call instead of seven list_shifts calls when you need the whole picture.",
    group: "read",
    annotations: readOnly,
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const lines: string[] = [];
      for (const date of weekDates(roster.weekStart)) {
        const dayShifts = Object.values(roster.shifts)
          .filter((s) => s.date === date)
          .sort((a, b) => a.start - b.start);
        const dayHours = dayShifts.reduce(
          (n, s) => n + durationHours(s.start, s.end) * s.assigned.length,
          0,
        );
        lines.push(
          `${fmtDateShort(date)}${isWeekend(date) ? " (weekend)" : ""} - ${dayHours.toFixed(1)} staffed hours`,
        );
        for (const s of dayShifts) {
          const names = s.assigned.map((id) => roster.staff[id]?.name.split(" ")[0] ?? id);
          const short = s.headcount - s.assigned.length;
          lines.push(
            `  ${fmtTime(s.start)}-${fmtTime(s.end)} ${ROLE_LABEL[s.role].padEnd(10)} ${names.join(", ") || "-"}${short > 0 ? `  << ${short} SHORT` : ""}`,
          );
        }
      }
      return result(lines.join("\n"));
    },
  },

  {
    name: "explain_assignment",
    title: "Explain an assignment",
    description:
      "Explain why one person on one shift is or is not a good fit: their hours, cost, overtime, rest window either side, and any rule they brush against. Use this when a manager asks you to justify a placement.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string" },
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string" },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const p = resolveStaff(roster, String(args.staff));
      const shift = resolveShift(roster, args, today);
      const on = shift.assigned.includes(p.id);
      const hrs = durationHours(shift.start, shift.end);
      const before = weeklyHours(roster, p.id);
      const violations = validateAll(roster).filter(
        (v) => v.staffId === p.id && v.shiftIds.includes(shift.id),
      );

      if (on) {
        const text = [
          `${p.name} IS on ${describeShift(roster, shift.id)}.`,
          `That shift is ${hrs.toFixed(1)}h of their ${before.toFixed(1)}h week (target ${p.targetWeeklyHours}h, cap ${p.maxWeeklyHours}h), costing ${money(roster, hrs * p.hourlyRate)}.`,
          violations.length
            ? `Rules it touches:\n${violations.map((v) => `- [${v.severity}] ${v.message}`).join("\n")}`
            : "It breaches no rules.",
          p.notes ? `Manager note on file: ${p.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        return result(text, { assigned: true, violations });
      }

      const [candidate] = rankCandidates(roster, shift.id, { includeIneligible: true }).filter(
        (c) => c.staffId === p.id,
      );
      if (!candidate) {
        return result(`${p.name} is not on that shift and could not be evaluated for it.`);
      }
      const text = [
        `${p.name} is NOT on ${describeShift(roster, shift.id)}.`,
        candidate.blockers.length
          ? `They cannot take it:\n${candidate.blockers.map((b) => `- ${b.message}`).join("\n")}`
          : `They could take it - fit score ${candidate.score}, would take them to ${candidate.projectedWeeklyHours.toFixed(1)}h${candidate.overtimeHours > 0 ? ` including ${candidate.overtimeHours.toFixed(1)}h overtime` : " with no overtime"}, costing ${money(roster, candidate.costForShift)}.`,
        candidate.reasons.length ? `In favour: ${candidate.reasons.join("; ")}.` : "",
        candidate.concerns.length
          ? `Against: ${candidate.concerns.map((c) => c.message).join(" ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      return result(text, { assigned: false, candidate });
    },
  },

  {
    name: "list_time_off_requests",
    title: "Time off requests",
    description:
      "Every time off request on file with its status. Pending requests are the ones nobody has actioned yet - they are the usual cause of a rota falling apart at the last minute.",
    group: "read",
    annotations: readOnly,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "pending", "approved", "declined"], default: "all" },
      },
    },
    execute(args) {
      const { roster } = ctx();
      const status = String(args.status ?? "all");
      const rows: string[] = [];
      const structured: unknown[] = [];
      for (const p of Object.values(roster.staff)) {
        for (const t of p.timeOff) {
          if (status !== "all" && t.status !== status) continue;
          const clash = Object.values(roster.shifts).filter(
            (s) => s.assigned.includes(p.id) && timeOffConflict({ ...p, timeOff: [{ ...t, status: "approved" }] }, s),
          );
          rows.push(
            `- ${p.name} (${p.id}) | ${fmtDateShort(t.date)}${t.start !== undefined ? ` ${fmtTime(t.start)}-${fmtTime(t.end!)}` : " all day"} | ${t.reason} | ${t.status.toUpperCase()}${clash.length ? ` | CLASHES with ${clash.length} scheduled shift(s): ${clash.map((s) => s.id).join(", ")}` : ""}`,
          );
          structured.push({ staffId: p.id, ...t, clashingShiftIds: clash.map((s) => s.id) });
        }
      }
      if (rows.length === 0) return result(`No ${status === "all" ? "" : status + " "}time off requests on file.`);
      return result(`${rows.length} request(s):\n${rows.join("\n")}`, structured);
    },
  },
];
