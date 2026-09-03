import { ROLES, ROLE_LABEL } from "../types";
import { coverageGaps, rankCandidates, validateAll } from "../engine/evaluate";
import { shiftsOf, weeklyHours } from "../engine/rules";
import { solve } from "../engine/solver";
import { addDays, fmtDateShort, fmtTime, startOfWeek } from "../engine/time";
import { assignEdit, unassignEdit } from "../store/edits";
import { useStore } from "../store/store";
import { ctx, editContext, stageEdits, type RotaTool } from "./ctx";
import { resolveDateOrThrow, resolveStaff } from "./resolve";
import { describeCandidates, describeShift, errorResult, money, result } from "./result";

/**
 * Tools that steer the manager's screen rather than the data.
 *
 * This is the part of WebMCP that a backend integration structurally cannot do.
 * The agent and the human are looking at the same pixels, so when the agent
 * says "Thursday is the problem", it can *put Thursday on the screen* and light
 * up the two shifts it means. The conversation and the interface stay in sync
 * instead of the manager hunting for what the agent is describing.
 */
export const viewTools: RotaTool[] = [
  {
    name: "focus_view",
    title: "Move the manager's view",
    description:
      "Change what the manager is looking at: switch between the week grid, the per-person view and the cost view, jump to a date, and select a shift or a person. Use it so the manager is looking at whatever you are talking about. Selecting a shift or a person also unlocks extra tools scoped to that selection.",
    group: "view",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["week", "staff", "cost"],
          description: "week is the calendar grid, staff is per-person rows, cost is the budget breakdown.",
        },
        date: { type: "string", description: "Jump to the week containing this date." },
        select_shift_id: { type: "string" },
        select_staff: { type: "string", description: "Name or id." },
        clear_selection: { type: "boolean" },
      },
    },
    execute(args) {
      const state = useStore.getState();
      const { roster, today } = ctx();
      const done: string[] = [];

      if (args.view) {
        state.setView(args.view as "week" | "staff" | "cost");
        done.push(`switched to the ${args.view} view`);
      }
      if (args.date) {
        const date = resolveDateOrThrow(roster, String(args.date), today);
        state.setWeekStart(startOfWeek(date));
        done.push(`jumped to the week of ${fmtDateShort(startOfWeek(date))}`);
      }
      if (args.clear_selection) {
        state.select({});
        done.push("cleared the selection");
      }
      const selection: { shiftId?: string; staffId?: string } = {};
      if (args.select_shift_id) {
        const shift = roster.shifts[String(args.select_shift_id)];
        if (!shift) return errorResult(`No shift with id "${String(args.select_shift_id)}".`);
        selection.shiftId = shift.id;
        done.push(`selected ${describeShift(roster, shift.id)}`);
      }
      if (args.select_staff) {
        const person = resolveStaff(roster, String(args.select_staff));
        selection.staffId = person.id;
        done.push(`selected ${person.name}`);
      }
      if (selection.shiftId || selection.staffId) {
        state.select({ ...state.selection, ...selection });
      }

      if (done.length === 0) {
        return result(
          "Nothing to change. Pass at least one of view, date, select_shift_id or select_staff.",
        );
      }
      return result(
        `Done - ${done.join(", ")}. The manager can now see it on screen.${selection.shiftId || selection.staffId ? " Selection-scoped tools are now available; check your tool list." : ""}`,
      );
    },
  },

  {
    name: "highlight",
    title: "Highlight things on screen",
    description:
      "Draw the manager's eye to specific shifts, people or days, with a short caption explaining why. Call this whenever you name something in your reply - it is the difference between telling the manager there is a problem on Thursday and showing them.",
    group: "view",
    inputSchema: {
      type: "object",
      properties: {
        staff: { type: "array", items: { type: "string" }, description: "Names or ids." },
        shift_ids: { type: "array", items: { type: "string" } },
        dates: { type: "array", items: { type: "string" } },
        note: {
          type: "string",
          description: "One short line shown as a caption, e.g. \"only 9h rest between these two\".",
        },
      },
    },
    execute(args) {
      const state = useStore.getState();
      const { roster, today } = ctx();
      const staffIds = ((args.staff as string[]) ?? []).map((r) => resolveStaff(roster, r).id);
      const shiftIds = ((args.shift_ids as string[]) ?? []).filter((id) => roster.shifts[id]);
      const dates = ((args.dates as string[]) ?? []).map((d) => resolveDateOrThrow(roster, d, today));

      if (!staffIds.length && !shiftIds.length && !dates.length) {
        state.setHighlight(null);
        return result("Cleared the highlight.");
      }
      state.setHighlight({
        staffIds,
        shiftIds,
        dates,
        note: args.note as string | undefined,
      });
      return result(
        `Highlighted ${[
          staffIds.length ? `${staffIds.length} person(s)` : "",
          shiftIds.length ? `${shiftIds.length} shift(s)` : "",
          dates.length ? `${dates.length} day(s)` : "",
        ]
          .filter(Boolean)
          .join(", ")} on the manager's screen.`,
      );
    },
  },

  {
    name: "request_approval",
    title: "Ask the manager to review",
    description:
      "Open the review drawer so the manager can see every change you have staged, tick or untick individual ones, and approve or discard. Call this when your proposal is complete. You cannot approve on their behalf - there is no tool for that, by design - so end your turn here and tell them what you have proposed and what it costs.",
    group: "meta",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One or two sentences the manager reads at the top of the drawer.",
        },
      },
    },
    execute(args) {
      const state = useStore.getState();
      const proposal = state.proposal;
      if (!proposal || proposal.edits.length === 0) {
        return result(
          "There is nothing staged, so there is nothing to approve. Stage some changes first.",
        );
      }
      if (args.summary) {
        useStore.setState({ proposal: { ...proposal, intent: String(args.summary) } });
      }
      state.setPanel("agent");
      window.dispatchEvent(new CustomEvent("rota:open-review"));
      const accepted = proposal.edits.filter((e) => e.accepted).length;
      return result(
        `Review drawer is open with ${accepted} change${accepted === 1 ? "" : "s"} ticked out of ${proposal.edits.length} staged. Waiting on the manager - approval is theirs alone. Summarise for them now: what you changed, what it costs, and anything you could not solve.`,
        { awaitingHuman: true, staged: proposal.edits.length, accepted },
      );
    },
  },

  {
    name: "describe_pending_changes",
    title: "Describe what is staged",
    description:
      "Read back your own pending proposal: every staged change, which are ticked, and the net effect on coverage, cost and rule breaches if the manager approves it. Use this to check your work before calling request_approval.",
    group: "meta",
    contextual: "Only registered while a proposal is open.",
    inputSchema: { type: "object", properties: {} },
    execute() {
      const state = useStore.getState();
      const proposal = state.proposal;
      if (!proposal || proposal.edits.length === 0) return result("Nothing is staged.");

      const before = validateAll(state.roster);
      const after = validateAll(ctx().roster);
      const hardBefore = before.filter((v) => v.severity === "hard").length;
      const hardAfter = after.filter((v) => v.severity === "hard").length;
      const gapsBefore = coverageGaps(state.roster).reduce((n, g) => n + g.missing, 0);
      const gapsAfter = coverageGaps(ctx().roster).reduce((n, g) => n + g.missing, 0);

      const lines = proposal.edits.map(
        (e, i) => `${i + 1}. [${e.accepted ? "x" : " "}] ${e.summary} (by ${e.author})`,
      );
      return result(
        [
          `${proposal.edits.length} staged change(s)${proposal.intent ? ` for: ${proposal.intent}` : ""}:`,
          lines.join("\n"),
          `Net effect if approved: open slots ${gapsBefore} -> ${gapsAfter}, hard breaches ${hardBefore} -> ${hardAfter}, soft issues ${before.length - hardBefore} -> ${after.length - hardAfter}.`,
        ].join("\n"),
        { edits: proposal.edits.map((e) => ({ id: e.id, summary: e.summary, accepted: e.accepted })) },
      );
    },
  },

  {
    name: "get_change_history",
    title: "Change history and provenance",
    description:
      "Who changed what, and which tool call caused it. Every tool invocation on this page is recorded with its arguments, its result and the edits it produced. Use it to answer questions like why someone ended up on a shift.",
    group: "meta",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", default: 15, minimum: 1, maximum: 100 } },
    },
    execute(args) {
      const { ledger } = useStore.getState();
      const limit = Number(args.limit ?? 15);
      if (ledger.length === 0) return result("No tool calls recorded yet in this session.");
      const lines = ledger
        .slice(0, limit)
        .map(
          (e) =>
            `- ${new Date(e.at).toLocaleTimeString("en-GB")} ${e.toolName} by ${e.caller} (${e.origin})${e.readOnly ? " [read-only]" : ""}${e.editIds.length ? ` -> staged ${e.editIds.length} edit(s)` : ""}${e.ok ? "" : " [FAILED]"}`,
        )
        .join("\n");
      return result(`${ledger.length} tool call(s) this session. Most recent first:\n${lines}`);
    },
  },
];

/* -- selection-scoped tools ------------------------------------------------ */

/**
 * Tools that only exist while something is selected.
 *
 * A backend MCP server has one flat, static tool list. A page knows what the
 * user is looking at, so it can offer tools that make sense only right now --
 * and withdraw them when they stop making sense. Every appearance and
 * disappearance fires `toolchange`, which is how the agent finds out.
 */
export function contextualTools(selection: { shiftId?: string; staffId?: string }): RotaTool[] {
  const tools: RotaTool[] = [];

  if (selection.shiftId) {
    const shiftId = selection.shiftId;
    tools.push(
      {
        name: "selected_shift_cover_options",
        title: "Cover options for the selected shift",
        description:
          "Rank everyone who can take the shift the manager currently has selected, with blockers for those who cannot. No arguments needed - it follows the selection on screen.",
        group: "view",
        contextual: "Registered only while a shift is selected.",
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object", properties: {} },
        execute() {
          const { roster } = ctx();
          const shift = roster.shifts[shiftId];
          if (!shift) return errorResult("The selected shift no longer exists.");
          const ranked = rankCandidates(roster, shiftId, { includeIneligible: true });
          const eligible = ranked.filter((c) => c.blockers.length === 0);
          const blocked = ranked.filter((c) => c.blockers.length > 0);
          return result(
            [
              `Selected: ${describeShift(roster, shiftId)}`,
              `${eligible.length} can take it:`,
              describeCandidates(eligible),
              blocked.length
                ? `${blocked.length} cannot:\n${blocked.map((c) => `- ${c.name}: ${c.blockers[0].message}`).join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            { shiftId, eligible, blocked },
          );
        },
      },
      {
        name: "fill_selected_shift",
        title: "Fill the selected shift",
        description:
          "Stage the best available people for every open slot on the shift the manager has selected. Use this for a single-shift fix rather than running the whole-week solver.",
        group: "write",
        contextual: "Registered only while a shift is selected.",
        inputSchema: {
          type: "object",
          properties: {
            avoid_overtime: { type: "boolean", default: false },
            exclude: { type: "array", items: { type: "string" } },
          },
        },
        execute(args) {
          const { roster } = ctx();
          const shift = roster.shifts[shiftId];
          if (!shift) return errorResult("The selected shift no longer exists.");
          const plan = solve(roster, {
            dates: [shift.date],
            avoidOvertime: Boolean(args.avoid_overtime),
            excludeStaff: ((args.exclude as string[]) ?? []).map((r) => resolveStaff(roster, r).id),
          });
          const mine = plan.assignments.filter((a) => a.shiftId === shiftId);
          if (mine.length === 0) {
            const blocked = rankCandidates(roster, shiftId, { includeIneligible: true }).filter(
              (c) => c.blockers.length,
            );
            return result(
              `Could not fill it. ${blocked.length ? `Everyone available is blocked: ${blocked.slice(0, 3).map((c) => `${c.name} (${c.blockers[0].message})`).join("; ")}` : "There is nobody left who fits."}`,
            );
          }
          const edits = [];
          for (const a of mine) {
            edits.push(
              ...stageEdits(
                [assignEdit(ctx().roster, a.shiftId, a.staffId, editContext())],
                "Fill selected shift",
              ),
            );
          }
          return result(
            `Staged ${edits.length} assignment(s) for ${describeShift(roster, shiftId)}: ${mine.map((a) => a.staffName).join(", ")}. Pending the manager's approval.`,
            { editIds: edits.map((e) => e.id) },
          );
        },
      },
    );
  }

  if (selection.staffId) {
    const staffId = selection.staffId;
    tools.push(
      {
        name: "selected_staff_week",
        title: "The selected person's week",
        description:
          "Summarise the week for the person the manager currently has selected: hours against contract, cost, every shift, and any rule they are close to breaching.",
        group: "view",
        contextual: "Registered only while a person is selected.",
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object", properties: {} },
        execute() {
          const { roster } = ctx();
          const person = roster.staff[staffId];
          if (!person) return errorResult("The selected person no longer exists.");
          const mine = shiftsOf(roster, staffId);
          const hrs = weeklyHours(roster, staffId);
          const violations = validateAll(roster).filter((v) => v.staffId === staffId);
          return result(
            [
              `${person.name}: ${hrs.toFixed(1)}h of a ${person.targetWeeklyHours}h contract (cap ${person.maxWeeklyHours}h), ${mine.length} shifts, ${money(roster, hrs * person.hourlyRate)} of wages.`,
              mine
                .map(
                  (s) =>
                    `- ${fmtDateShort(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)} ${ROLE_LABEL[s.role]} [${s.id}]`,
                )
                .join("\n") || "- no shifts",
              violations.length
                ? `Rules:\n${violations.map((v) => `- [${v.severity}] ${v.message}`).join("\n")}`
                : "No rule issues.",
            ].join("\n"),
          );
        },
      },
      {
        name: "rebalance_selected_staff",
        title: "Rebalance the selected person",
        description:
          "Bring the selected person's hours towards their contract: stage extra shifts if they are short, or hand shifts to someone else if they are overloaded. Every move is checked against the rules and staged for approval.",
        group: "write",
        contextual: "Registered only while a person is selected.",
        inputSchema: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              enum: ["auto", "more_hours", "fewer_hours"],
              default: "auto",
              description: "auto works out which way they need to move from their contract.",
            },
            max_changes: { type: "integer", default: 3, minimum: 1, maximum: 10 },
          },
        },
        execute(args) {
          const { roster } = ctx();
          const person = roster.staff[staffId];
          if (!person) return errorResult("The selected person no longer exists.");
          const hrs = weeklyHours(roster, staffId);
          const maxChanges = Number(args.max_changes ?? 3);
          const dir =
            args.direction && args.direction !== "auto"
              ? String(args.direction)
              : hrs < person.targetWeeklyHours
                ? "more_hours"
                : "fewer_hours";

          const edits = [];
          if (dir === "more_hours") {
            const gaps = coverageGaps(roster);
            for (const gap of gaps) {
              if (edits.length >= maxChanges) break;
              const candidate = rankCandidates(ctx().roster, gap.shiftId).find(
                (c) => c.staffId === staffId,
              );
              if (!candidate) continue;
              edits.push(
                ...stageEdits(
                  [assignEdit(ctx().roster, gap.shiftId, staffId, editContext())],
                  `Give ${person.name} more hours`,
                ),
              );
            }
            if (edits.length === 0) {
              return result(
                `${person.name} is at ${hrs.toFixed(1)}h of ${person.targetWeeklyHours}h, but there is no open slot they can legally take. Their availability is the binding constraint - check get_staff_details.`,
              );
            }
          } else {
            const mine = shiftsOf(roster, staffId);
            for (const shift of mine) {
              if (edits.length >= maxChanges) break;
              const replacement = rankCandidates(ctx().roster, shift.id).find(
                (c) => c.staffId !== staffId && c.blockers.length === 0,
              );
              if (!replacement) continue;
              edits.push(
                ...stageEdits(
                  [unassignEdit(ctx().roster, shift.id, staffId, editContext(), "rebalance")],
                  `Reduce ${person.name}'s hours`,
                ),
              );
              edits.push(
                ...stageEdits([assignEdit(ctx().roster, shift.id, replacement.staffId, editContext())]),
              );
            }
            if (edits.length === 0) {
              return result(
                `${person.name} is at ${hrs.toFixed(1)}h but nobody else can legally take any of their shifts, so there is nothing to hand over.`,
              );
            }
          }
          const after = weeklyHours(ctx().roster, staffId);
          return result(
            `Staged ${edits.length} change(s). ${person.name} would move from ${hrs.toFixed(1)}h to ${after.toFixed(1)}h against a ${person.targetWeeklyHours}h contract. Pending approval.`,
            { editIds: edits.map((e) => e.id) },
          );
        },
      },
    );
  }

  return tools;
}

/** Registered only while somebody has an unactioned time off request. */
export function timeOffTool(): RotaTool {
  return {
    name: "review_time_off_requests",
    title: "Review pending time off",
    description:
      "There are unactioned time off requests. Walk the manager through each one: who asked, for when, and what approving it would cost in coverage. Approving is a write action, so it stages like anything else.",
    group: "meta",
    contextual: "Registered only while at least one time off request is pending.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    execute() {
      const { roster } = ctx();
      const rows: string[] = [];
      for (const person of Object.values(roster.staff)) {
        for (const t of person.timeOff) {
          if (t.status !== "pending") continue;
          const clashing = Object.values(roster.shifts).filter(
            (s) => s.date === t.date && s.assigned.includes(person.id),
          );
          const coverable = clashing.filter(
            (s) => rankCandidates(roster, s.id).filter((c) => c.staffId !== person.id).length > 0,
          );
          rows.push(
            `- ${person.name} wants ${fmtDateShort(t.date)} off (${t.reason}). They are on ${clashing.length} shift(s) that day; ${coverable.length} of those have someone else who could cover. Shift ids: ${clashing.map((s) => s.id).join(", ") || "none"}.`,
          );
        }
      }
      if (rows.length === 0) return result("No pending time off requests.");
      return result(
        `${rows.length} pending request(s):\n${rows.join("\n")}\nTo action one, call record_time_off with the new status, then cover_absence if it is approved.`,
      );
    },
  };
}

/** Registered only while the roster still has unfilled slots next week. */
export function nextWeekTool(): RotaTool {
  return {
    name: "jump_to_next_week",
    title: "Jump to next week",
    description: "Move the manager's view to the following week and report its state.",
    group: "view",
    inputSchema: { type: "object", properties: {} },
    execute() {
      const state = useStore.getState();
      const next = addDays(state.weekStart, 7);
      state.setWeekStart(next);
      return result(`Moved to the week of ${fmtDateShort(next)}.`);
    },
  };
}

export const ALL_ROLE_NAMES = ROLES;
