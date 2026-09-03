import type { RuleId, Shift, TimeOff } from "../types";
import { ROLES, ROLE_LABEL } from "../types";
import { coverageGaps, rankCandidates, validateAll } from "../engine/evaluate";
import { findSwapFor, planAbsenceCover, solve, type Objective } from "../engine/solver";
import { fmtDateShort, fmtTime, parseTime } from "../engine/time";
import { useStore } from "../store/store";
import {
  assignEdit,
  createShiftEdit,
  deleteShiftEdit,
  ruleEdit,
  timeOffEdit,
  unassignEdit,
  updateShiftEdit,
} from "../store/edits";
import { ctx, editContext, stageEdits, type RotaTool } from "./ctx";
import { ResolveError, resolveDateOrThrow, resolveDates, resolveRole, resolveShift, resolveStaff } from "./resolve";
import { describeShift, errorResult, money, result } from "./result";

/**
 * Write tools stage `Edit`s onto the open proposal. They never touch the
 * committed roster.
 *
 * There is deliberately no `commit_changes`, `approve_proposal` or
 * `publish_schedule` tool in this file, and there never will be. Approval is
 * the one action reserved for the human, so it is reachable only from the UI.
 * An agent can propose an entire week's rota in twelve tool calls and still
 * cannot change a single person's Saturday without the manager clicking
 * Approve.
 */

const OBJECTIVES: Objective[] = [
  "balanced",
  "minimise_cost",
  "maximise_fairness",
  "honour_preferences",
];

function staged(count: number, extra = ""): string {
  if (count === 0) return `Nothing to change.${extra ? " " + extra : ""}`;
  return `Staged ${count} change${count === 1 ? "" : "s"} for the manager to review.${extra ? " " + extra : ""} Nothing is committed until they approve it.`;
}

/** Appends the post-change rule check so the agent always sees consequences. */
function withRuleCheck(text: string): string {
  const { roster } = ctx();
  const violations = validateAll(roster);
  const hard = violations.filter((v) => v.severity === "hard");
  return [
    text,
    hard.length
      ? `Rule check on the proposed schedule: ${hard.length} hard breach${hard.length === 1 ? "" : "es"} remain.\n${hard.slice(0, 5).map((v) => `- ${v.message}`).join("\n")}`
      : "Rule check on the proposed schedule: no hard breaches.",
  ].join("\n");
}

export const writeTools: RotaTool[] = [
  {
    name: "assign_staff",
    title: "Assign someone to a shift",
    description:
      "Propose putting a person on a shift. Checks every hard rule first and refuses with the specific reason if it would be illegal - so a refusal from this tool is a fact you can quote to the manager, not a guess. Use force only when the manager has explicitly accepted the breach.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string", description: "Name or id." },
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string", description: 'e.g. "opening", "closing", "16:30".' },
        force: {
          type: "boolean",
          default: false,
          description:
            "Stage the assignment even if it breaches a hard rule. Only after the manager has said so in as many words.",
        },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const person = resolveStaff(roster, String(args.staff));
      const shift = resolveShift(roster, args, today);

      if (shift.assigned.includes(person.id)) {
        return result(`${person.name} is already on ${describeShift(roster, shift.id)}.`);
      }

      const [candidate] = rankCandidates(roster, shift.id, { includeIneligible: true }).filter(
        (c) => c.staffId === person.id,
      );
      const blockers = candidate?.blockers ?? [];
      if (blockers.length > 0 && !args.force) {
        return errorResult(
          [
            `Refused: putting ${person.name} on ${describeShift(roster, shift.id)} would breach ${blockers.length} hard rule${blockers.length === 1 ? "" : "s"}.`,
            ...blockers.map((b) => `- ${b.message} (rule: ${b.ruleId})`),
            "Find someone else with find_cover, or ask the manager whether they want to accept the breach and call again with force=true.",
          ].join("\n"),
        );
      }

      const edits = stageEdits(
        [assignEdit(roster, shift.id, person.id, editContext())],
        `Assign ${person.name}`,
      );
      const note = blockers.length
        ? ` FORCED past ${blockers.length} hard breach: ${blockers.map((b) => b.message).join(" ")}`
        : candidate?.concerns.length
          ? ` Note: ${candidate.concerns.map((c) => c.message).join(" ")}`
          : "";
      return result(
        withRuleCheck(
          `${staged(edits.length)} ${person.name} would work ${fmtDateShort(shift.date)} ${fmtTime(shift.start)}-${fmtTime(shift.end)} as ${ROLE_LABEL[shift.role]}, costing ${money(roster, candidate?.costForShift ?? 0)}.${note}`,
        ),
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "unassign_staff",
    title: "Remove someone from a shift",
    description: "Propose taking a person off a shift. Reports the coverage hole this opens up.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string" },
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string" },
        reason: { type: "string", description: "Shown to the manager in the review list." },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const person = resolveStaff(roster, String(args.staff));
      const shift = resolveShift(roster, args, today);
      if (!shift.assigned.includes(person.id)) {
        return errorResult(
          `${person.name} is not on ${describeShift(roster, shift.id)}, so there is nothing to remove.`,
        );
      }
      const edits = stageEdits(
        [unassignEdit(roster, shift.id, person.id, editContext(), args.reason as string | undefined)],
        `Remove ${person.name}`,
      );
      const after = ctx().roster.shifts[shift.id];
      const short = after ? after.headcount - after.assigned.length : 0;
      return result(
        withRuleCheck(
          `${staged(edits.length)} That shift now has ${after?.assigned.length ?? 0}/${after?.headcount ?? 0}${short > 0 ? ` - ${short} slot${short === 1 ? "" : "s"} open. Use find_cover or fill_open_shifts to backfill.` : "."}`,
        ),
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "swap_assignments",
    title: "Swap two people between shifts",
    description:
      "Propose swapping two people between two shifts, checking that both halves of the swap are legal. If you only know one side, use suggest_swap_for instead and let the page find the partner.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff_a: { type: "string" },
        shift_a_id: { type: "string" },
        staff_b: { type: "string" },
        shift_b_id: { type: "string" },
      },
      required: ["staff_a", "shift_a_id", "staff_b", "shift_b_id"],
    },
    execute(args) {
      const { roster } = ctx();
      const a = resolveStaff(roster, String(args.staff_a));
      const b = resolveStaff(roster, String(args.staff_b));
      const shiftA = roster.shifts[String(args.shift_a_id)];
      const shiftB = roster.shifts[String(args.shift_b_id)];
      if (!shiftA || !shiftB) throw new ResolveError("One of those shift ids does not exist.");
      if (!shiftA.assigned.includes(a.id)) {
        return errorResult(`${a.name} is not on ${shiftA.id}.`);
      }
      if (!shiftB.assigned.includes(b.id)) {
        return errorResult(`${b.name} is not on ${shiftB.id}.`);
      }

      const edits = stageEdits(
        [
          unassignEdit(roster, shiftA.id, a.id, editContext(), "swap"),
          unassignEdit(roster, shiftB.id, b.id, editContext(), "swap"),
        ],
        `Swap ${a.name} and ${b.name}`,
      );
      const mid = ctx().roster;
      edits.push(
        ...stageEdits([
          assignEdit(mid, shiftA.id, b.id, editContext()),
          assignEdit(mid, shiftB.id, a.id, editContext()),
        ]),
      );

      const violations = validateAll(ctx().roster).filter((v) => v.severity === "hard");
      return result(
        `${staged(edits.length)} ${b.name} takes ${shiftA.id} and ${a.name} takes ${shiftB.id}.\n${violations.length ? `Warning: the swap leaves ${violations.length} hard breach(es):\n${violations.slice(0, 4).map((v) => `- ${v.message}`).join("\n")}` : "The swap breaches no hard rules."}`,
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "suggest_swap_for",
    title: "Find a legal swap",
    description:
      "Given a person on a shift that is causing a problem, search the week for a two-way swap that clears the breach, and stage it if one exists. This is the fix for a close-then-open: nobody needs removing, two people just trade.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string" },
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string" },
        stage: {
          type: "boolean",
          default: true,
          description: "Stage the swap for approval. Set false to only report what is possible.",
        },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const person = resolveStaff(roster, String(args.staff));
      const shift = resolveShift(roster, args, today);
      const swap = findSwapFor(roster, shift.id, person.id);
      if (!swap) {
        return result(
          `No legal two-way swap exists for ${person.name} on ${describeShift(roster, shift.id)}. The alternatives are to remove them and backfill with fill_open_shifts, or to accept the breach.`,
        );
      }
      if (args.stage === false) {
        return result(
          `A swap is available: ${person.name} and ${swap.withStaffName} trade ${shift.id} for ${swap.withShiftId}. ${swap.note} Not staged, as requested.`,
        );
      }
      const partnerShift = roster.shifts[swap.withShiftId];
      const edits = stageEdits(
        [
          unassignEdit(roster, shift.id, person.id, editContext(), "swap"),
          unassignEdit(roster, partnerShift.id, swap.withStaffId, editContext(), "swap"),
        ],
        `Swap ${person.name} with ${swap.withStaffName}`,
      );
      const mid = ctx().roster;
      edits.push(
        ...stageEdits([
          assignEdit(mid, shift.id, swap.withStaffId, editContext()),
          assignEdit(mid, partnerShift.id, person.id, editContext()),
        ]),
      );
      return result(
        withRuleCheck(
          `${staged(edits.length)} ${swap.withStaffName} takes ${fmtDateShort(shift.date)} ${fmtTime(shift.start)}-${fmtTime(shift.end)} and ${person.name} moves to ${fmtDateShort(partnerShift.date)} ${fmtTime(partnerShift.start)}-${fmtTime(partnerShift.end)}. ${swap.note}`,
        ),
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "fill_open_shifts",
    title: "Fill the open shifts",
    description:
      "The heavy lifter. Runs the venue's scheduling solver over every unfilled slot and stages a complete set of assignments for approval. Honours every hard rule by construction, and optimises the soft ones according to the objective you choose. Tell it who is unavailable and whether overtime is allowed. Returns what it could not fill and precisely why.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          enum: [...OBJECTIVES],
          default: "balanced",
          description:
            "balanced spreads the pain; minimise_cost avoids overtime and expensive staff; maximise_fairness evens out weekends, closes and hours; honour_preferences leans on stated preferences.",
        },
        avoid_overtime: {
          type: "boolean",
          default: false,
          description: "Refuse any assignment that would push someone past their contracted hours.",
        },
        dates: {
          type: "array",
          items: { type: "string" },
          description: "Restrict to these dates. Defaults to the whole week.",
        },
        roles: { type: "array", items: { type: "string", enum: [...ROLES] } },
        exclude_staff: {
          type: "array",
          items: { type: "string" },
          description: "Names or ids to keep off the rota entirely, e.g. someone off sick.",
        },
        only_staff: {
          type: "array",
          items: { type: "string" },
          description: "Restrict the solver to these people only.",
        },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const objective = (args.objective as Objective) ?? "balanced";
      const plan = solve(roster, {
        objective,
        avoidOvertime: Boolean(args.avoid_overtime),
        dates: args.dates ? resolveDates(roster, { dates: args.dates as string[] }, today) : undefined,
        roles: args.roles ? (args.roles as string[]).map(resolveRole) : undefined,
        excludeStaff: ((args.exclude_staff as string[]) ?? []).map((r) => resolveStaff(roster, r).id),
        onlyStaff: ((args.only_staff as string[]) ?? []).map((r) => resolveStaff(roster, r).id),
      });

      if (plan.assignments.length === 0 && plan.unfilled.length === 0) {
        return result("Every shift in scope is already fully staffed. Nothing to fill.");
      }

      let working = roster;
      const allEdits = [];
      for (const a of plan.assignments) {
        const edit = assignEdit(working, a.shiftId, a.staffId, editContext());
        if (edit) {
          allEdits.push(...stageEdits([edit], `Fill open shifts (${objective})`));
          working = ctx().roster;
        }
      }

      const lines = plan.assignments.map(
        (a) =>
          `- ${a.staffName} -> ${fmtDateShort(a.date)} ${fmtTime(a.start)}-${fmtTime(a.end)} ${ROLE_LABEL[a.role]} (${money(roster, a.cost)}${a.reasons.length ? `; ${a.reasons.slice(0, 2).join(", ")}` : ""})`,
      );
      const unfilledLines = plan.unfilled.map(
        (u) =>
          `- ${fmtDateShort(u.date)} ${fmtTime(u.start)}-${fmtTime(u.end)} ${ROLE_LABEL[u.role]}: ${u.reason}${u.nearMisses.length ? ` Closest were ${u.nearMisses.map((n) => `${n.name} (${n.blockedBy})`).join("; ")}` : ""}`,
      );

      return result(
        [
          plan.narrative,
          allEdits.length ? `Staged:\n${lines.join("\n")}` : "",
          unfilledLines.length ? `Still open:\n${unfilledLines.join("\n")}` : "",
          `Rule breaches: ${plan.hardBefore} hard before, ${plan.hardAfter} after. Added wage cost ${money(roster, plan.addedCost)}.`,
          "Nothing is committed until the manager approves it.",
        ]
          .filter(Boolean)
          .join("\n"),
        { assignments: plan.assignments, unfilled: plan.unfilled, editIds: allEdits.map((e) => e.id) },
      );
    },
  },

  {
    name: "cover_absence",
    title: "Cover an absence",
    description:
      "Someone has called in sick or dropped out. Removes them from every shift on the given dates and stages replacements for all of it in one go, excluding them from the backfill. This is the single most common emergency in a rota and the thing managers most often get wrong under time pressure.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string", description: "Who is absent." },
        dates: {
          type: "array",
          items: { type: "string" },
          description: "Dates they cannot work. Accepts YYYY-MM-DD or weekday names.",
        },
        date: { type: "string", description: "Shorthand for a single date." },
        reason: { type: "string", default: "called in sick" },
        record_time_off: {
          type: "boolean",
          default: true,
          description: "Also record approved time off so the absence is on file, not just unassigned.",
        },
        avoid_overtime: { type: "boolean", default: false },
        objective: { type: "string", enum: [...OBJECTIVES], default: "balanced" },
      },
      required: ["staff"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const person = resolveStaff(roster, String(args.staff));
      const dates = resolveDates(roster, args as { date?: string; dates?: string[] }, today);
      const reason = String(args.reason ?? "called in sick");

      const plan = planAbsenceCover(roster, person.id, dates, {
        objective: (args.objective as Objective) ?? "balanced",
        avoidOvertime: Boolean(args.avoid_overtime),
      });

      if (plan.removals.length === 0) {
        return result(
          `${person.name} is not scheduled on ${dates.map(fmtDateShort).join(", ")}, so there is nothing to cover.`,
        );
      }

      const edits = [];
      for (const r of plan.removals) {
        edits.push(
          ...stageEdits(
            [unassignEdit(ctx().roster, r.shiftId, person.id, editContext(), reason)],
            `${person.name} ${reason}`,
          ),
        );
      }
      if (args.record_time_off !== false) {
        for (const date of dates) {
          const entry: TimeOff = {
            id: `to-${person.id}-${date}`,
            date,
            reason,
            status: "approved",
          };
          edits.push(...stageEdits([timeOffEdit(ctx().roster, person.id, entry, editContext())]));
        }
      }
      for (const a of plan.fill.assignments) {
        edits.push(...stageEdits([assignEdit(ctx().roster, a.shiftId, a.staffId, editContext())]));
      }

      const covered = plan.fill.assignments.map(
        (a) =>
          `- ${a.staffName} covers ${fmtDateShort(a.date)} ${fmtTime(a.start)}-${fmtTime(a.end)} ${ROLE_LABEL[a.role]} (${money(roster, a.cost)})`,
      );
      const gaps = plan.fill.unfilled.map(
        (u) =>
          `- ${fmtDateShort(u.date)} ${fmtTime(u.start)}-${fmtTime(u.end)} ${ROLE_LABEL[u.role]}: ${u.reason}${u.nearMisses.length ? ` Closest: ${u.nearMisses.map((n) => `${n.name} - ${n.blockedBy}`).join("; ")}` : ""}`,
      );

      return result(
        withRuleCheck(
          [
            `${person.name} is off on ${dates.map(fmtDateShort).join(", ")} (${reason}). Pulled them from ${plan.removals.length} shift${plan.removals.length === 1 ? "" : "s"} and staged cover for ${plan.fill.assignments.length}.`,
            covered.length ? covered.join("\n") : "",
            gaps.length ? `Could not cover:\n${gaps.join("\n")}` : "Everything is covered.",
            `Added wage cost ${money(roster, plan.fill.addedCost)}.`,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
        {
          removed: plan.removals,
          covered: plan.fill.assignments,
          uncovered: plan.fill.unfilled,
          editIds: edits.map((e) => e.id),
        },
      );
    },
  },

  {
    name: "create_shift",
    title: "Create a shift",
    description:
      "Add a new shift to the week - a second baker for a busy Saturday, or an extra pair of hands for an event.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        start: { type: "string", description: 'Start time, e.g. "07:00" or "7am".' },
        end: { type: "string", description: 'End time, e.g. "15:30".' },
        headcount: { type: "integer", default: 1, minimum: 1, maximum: 12 },
        label: { type: "string", description: 'Short name, e.g. "Event bar".' },
        notes: { type: "string" },
      },
      required: ["date", "role", "start", "end"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const date = resolveDateOrThrow(roster, String(args.date), today);
      const role = resolveRole(String(args.role));
      const start = parseTime(String(args.start));
      const end = parseTime(String(args.end));
      if (start === null || end === null) {
        return errorResult('Could not read the times. Use a 24-hour clock like "07:00" and "15:30".');
      }
      if (end <= start) return errorResult("The end time must be after the start time.");

      const shift: Shift = {
        id: `${date}-${role}-${start}-n${Math.random().toString(36).slice(2, 6)}`,
        date,
        start,
        end,
        role,
        headcount: Number(args.headcount ?? 1),
        assigned: [],
        status: "draft",
        isOpening: start <= 7 * 60,
        isClosing: end >= 20 * 60,
        label: (args.label as string) ?? "Extra",
        notes: args.notes as string | undefined,
      };

      const edits = stageEdits([createShiftEdit(roster, shift, editContext())], "Create shift");
      return result(
        `${staged(edits.length)} New shift ${shift.id}: ${fmtDateShort(date)} ${fmtTime(start)}-${fmtTime(end)} ${ROLE_LABEL[role]} for ${shift.headcount}. Nobody is on it yet - use fill_open_shifts or assign_staff.`,
        { shiftId: shift.id, editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "update_shift",
    title: "Change a shift",
    description:
      "Change a shift's times, required headcount, role or notes. Reports anyone who no longer fits as a result.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string" },
        new_start: { type: "string" },
        new_end: { type: "string" },
        new_headcount: { type: "integer", minimum: 0, maximum: 12 },
        new_role: { type: "string", enum: [...ROLES] },
        notes: { type: "string" },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const shift = resolveShift(roster, args, today);
      const changes: Partial<Shift> = {};
      if (args.new_start !== undefined) {
        const t = parseTime(String(args.new_start));
        if (t === null) return errorResult(`Could not read "${String(args.new_start)}" as a time.`);
        changes.start = t;
      }
      if (args.new_end !== undefined) {
        const t = parseTime(String(args.new_end));
        if (t === null) return errorResult(`Could not read "${String(args.new_end)}" as a time.`);
        changes.end = t;
      }
      if (args.new_headcount !== undefined) changes.headcount = Number(args.new_headcount);
      if (args.new_role !== undefined) changes.role = resolveRole(String(args.new_role));
      if (args.notes !== undefined) changes.notes = String(args.notes);
      if (Object.keys(changes).length === 0) {
        return errorResult("No changes were specified. Pass at least one new_* field.");
      }
      const end = changes.end ?? shift.end;
      const start = changes.start ?? shift.start;
      if (end <= start) return errorResult("The end time must be after the start time.");

      const edits = stageEdits([updateShiftEdit(roster, shift.id, changes, editContext())], "Change shift");
      return result(
        withRuleCheck(`${staged(edits.length)} ${describeShift(ctx().roster, shift.id)}`),
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "delete_shift",
    title: "Delete a shift",
    description:
      "Remove a shift from the week entirely - for example a slot the venue has decided not to staff. Anyone on it is released.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        shift_id: { type: "string" },
        date: { type: "string" },
        role: { type: "string", enum: [...ROLES] },
        when: { type: "string" },
      },
    },
    execute(args) {
      const { roster, today } = ctx();
      const shift = resolveShift(roster, args, today);
      const names = shift.assigned.map((id) => roster.staff[id]?.name ?? id);
      const edits = stageEdits([deleteShiftEdit(roster, shift.id, editContext())], "Delete shift");
      return result(
        `${staged(edits.length)} Deleting ${fmtDateShort(shift.date)} ${fmtTime(shift.start)}-${fmtTime(shift.end)} ${ROLE_LABEL[shift.role]}${names.length ? `, which releases ${names.join(" and ")}` : ""}.`,
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "record_time_off",
    title: "Record or approve time off",
    description:
      "Put time off on file for someone, or approve a pending request. Approving time off that clashes with a shift they are already on does not silently unassign them - it reports the clash so you can cover it deliberately with cover_absence.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "string" },
        date: { type: "string" },
        status: { type: "string", enum: ["approved", "pending", "declined"], default: "approved" },
        reason: { type: "string", default: "personal" },
        start: { type: "string", description: "Optional start time for part-day leave." },
        end: { type: "string", description: "Optional end time for part-day leave." },
      },
      required: ["staff", "date"],
    },
    execute(args) {
      const { roster, today } = ctx();
      const person = resolveStaff(roster, String(args.staff));
      const date = resolveDateOrThrow(roster, String(args.date), today);
      const existing = person.timeOff.find((t) => t.date === date);
      const start = args.start ? parseTime(String(args.start)) : null;
      const end = args.end ? parseTime(String(args.end)) : null;

      const entry: TimeOff = {
        id: existing?.id ?? `to-${person.id}-${date}`,
        date,
        reason: String(args.reason ?? existing?.reason ?? "personal"),
        status: (args.status as TimeOff["status"]) ?? "approved",
        ...(start !== null ? { start } : {}),
        ...(end !== null ? { end } : {}),
      };

      const edits = stageEdits([timeOffEdit(roster, person.id, entry, editContext())], "Record time off");
      const clashes = Object.values(roster.shifts).filter(
        (s) => s.date === date && s.assigned.includes(person.id),
      );
      return result(
        `${staged(edits.length)} ${person.name}: ${entry.status} time off on ${fmtDateShort(date)} (${entry.reason}).${clashes.length ? ` They are still assigned to ${clashes.length} shift(s) that day (${clashes.map((s) => s.id).join(", ")}) - call cover_absence to pull them off and backfill.` : ""}`,
        { editIds: edits.map((e) => e.id), clashingShiftIds: clashes.map((s) => s.id) },
      );
    },
  },

  {
    name: "set_rule",
    title: "Adjust a scheduling rule",
    description:
      "Enable, disable or retune a soft rule - for example widening the acceptable weekend spread, or relaxing the contracted-hours floor. Statutory rules such as rest periods, the under-18 curfew and time off cannot be switched off by a tool at all; if a manager asks, explain that and offer to change the schedule instead.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        rule_id: { type: "string", description: "From list_rules." },
        enabled: { type: "boolean" },
        param: { type: "number", description: "New value for the rule's tunable knob." },
      },
      required: ["rule_id"],
    },
    execute(args) {
      const { roster } = ctx();
      const ruleId = String(args.rule_id) as RuleId;
      const rule = roster.rules[ruleId];
      if (!rule) {
        return errorResult(
          `No rule "${ruleId}". Valid ids: ${Object.keys(roster.rules).join(", ")}.`,
        );
      }
      if (rule.statutory && args.enabled === false) {
        return errorResult(
          `"${rule.label}" is statutory and cannot be switched off - not by you, and not by the manager through this app. ${rule.description} If the schedule cannot satisfy it, the schedule has to change.`,
        );
      }
      const changes: Partial<typeof rule> = {};
      if (args.enabled !== undefined) changes.enabled = Boolean(args.enabled);
      if (args.param !== undefined) changes.param = Number(args.param);
      if (Object.keys(changes).length === 0) {
        return errorResult("Nothing to change. Pass enabled and/or param.");
      }
      const edits = stageEdits([ruleEdit(roster, ruleId, changes, editContext())], "Adjust rule");
      return result(
        withRuleCheck(`${staged(edits.length)} ${rule.label}: ${JSON.stringify(changes)}.`),
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "clear_week",
    title: "Clear all assignments",
    description:
      "Strip every assignment from the week so it can be rebuilt from scratch. Destructive, so confirm with the manager in words before calling it, and remember it still only stages - they will see the whole week greyed out for approval.",
    group: "write",
    inputSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description: "Must be true. Set it only after the manager has agreed out loud.",
        },
        dates: { type: "array", items: { type: "string" } },
      },
      required: ["confirm"],
    },
    execute(args) {
      if (!args.confirm) {
        return errorResult(
          "Not cleared. This wipes every assignment in scope - ask the manager to confirm, then call again with confirm=true.",
        );
      }
      const { roster, today } = ctx();
      const dates = resolveDates(roster, args as { dates?: string[] }, today);
      const edits = [];
      for (const shift of Object.values(roster.shifts)) {
        if (!dates.includes(shift.date)) continue;
        for (const staffId of shift.assigned) {
          edits.push(
            ...stageEdits(
              [unassignEdit(ctx().roster, shift.id, staffId, editContext(), "week cleared")],
              "Clear week",
            ),
          );
        }
      }
      const gaps = coverageGaps(ctx().roster).reduce((n, g) => n + g.missing, 0);
      return result(
        `${staged(edits.length)} All ${edits.length} assignment${edits.length === 1 ? "" : "s"} on ${dates.length} day${dates.length === 1 ? "" : "s"} are staged for removal, which would leave ${gaps} open slots.`,
        { editIds: edits.map((e) => e.id) },
      );
    },
  },

  {
    name: "revise_proposal",
    title: "Revise the pending proposal",
    description:
      "Change your own staged proposal before the manager reviews it: drop the edits that involve a particular person, or drop everything and start again. Use this when the manager pushes back mid-conversation, instead of stacking a correction on top of a mistake.",
    group: "write",
    contextual: "Only registered while a proposal is open.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["drop_all", "drop_involving_staff", "deselect_involving_staff"],
          description:
            "drop_all discards the whole proposal. drop_involving_staff removes just that person's edits. deselect_involving_staff leaves them visible but unticked so the manager can see what you changed your mind about.",
        },
        staff: { type: "string", description: "Required for the staff-scoped actions." },
      },
      required: ["action"],
    },
    execute(args) {
      const state = useStore.getState();
      const proposal = state.proposal;
      if (!proposal || proposal.edits.length === 0) {
        return result("There is no pending proposal to revise.");
      }
      const action = String(args.action);

      if (action === "drop_all") {
        const n = proposal.edits.length;
        state.discardProposal();
        return result(`Discarded the whole proposal - all ${n} staged change(s) are gone.`);
      }

      if (!args.staff) return errorResult("That action needs a staff name or id.");
      const person = resolveStaff(state.roster, String(args.staff));
      const matching = proposal.edits.filter((e) => e.touches.staffIds.includes(person.id));
      if (matching.length === 0) {
        return result(`No staged changes involve ${person.name}.`);
      }
      if (action === "deselect_involving_staff") {
        for (const e of matching) state.setEditAccepted(e.id, false);
        return result(
          `Unticked ${matching.length} staged change(s) involving ${person.name}. They are still listed for the manager, marked as withdrawn.`,
        );
      }
      useStore.setState({
        proposal: {
          ...proposal,
          edits: proposal.edits.filter((e) => !e.touches.staffIds.includes(person.id)),
        },
      });
      return result(`Dropped ${matching.length} staged change(s) involving ${person.name}.`);
    },
  },
];
