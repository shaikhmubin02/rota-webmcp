import type { Edit, EditKind, Rule, Shift, StaffMember, StatePatch } from "../types";
import { ROLE_LABEL } from "../types";
import type { Roster } from "../engine/rules";
import { fmtDateShort, fmtTime } from "../engine/time";

let editCounter = 0;
export function nextEditId(): string {
  editCounter += 1;
  return `e${editCounter}-${Date.now().toString(36)}`;
}

export interface EditContext {
  sourceCallId: string;
  author: string;
}

function base(
  kind: EditKind,
  summary: string,
  ctx: EditContext,
  forward: StatePatch,
  backward: StatePatch,
  touches: Partial<Edit["touches"]> = {},
): Edit {
  return {
    id: nextEditId(),
    kind,
    summary,
    sourceCallId: ctx.sourceCallId,
    author: ctx.author,
    createdAt: Date.now(),
    forward,
    backward,
    touches: { staffIds: [], shiftIds: [], dates: [], ...touches },
    accepted: true,
  };
}

export function shiftTitle(shift: Shift): string {
  return `${fmtDateShort(shift.date)} ${fmtTime(shift.start)}-${fmtTime(shift.end)} ${ROLE_LABEL[shift.role]}`;
}

export function assignEdit(
  roster: Roster,
  shiftId: string,
  staffId: string,
  ctx: EditContext,
): Edit | null {
  const shift = roster.shifts[shiftId];
  const person = roster.staff[staffId];
  if (!shift || !person || shift.assigned.includes(staffId)) return null;
  return base(
    "assign",
    `Add ${person.name} to ${shiftTitle(shift)}`,
    ctx,
    { shifts: { [shiftId]: { ...shift, assigned: [...shift.assigned, staffId] } } },
    { shifts: { [shiftId]: shift } },
    { staffIds: [staffId], shiftIds: [shiftId], dates: [shift.date] },
  );
}

export function unassignEdit(
  roster: Roster,
  shiftId: string,
  staffId: string,
  ctx: EditContext,
  reason?: string,
): Edit | null {
  const shift = roster.shifts[shiftId];
  const person = roster.staff[staffId];
  if (!shift || !person || !shift.assigned.includes(staffId)) return null;
  return base(
    "unassign",
    `Remove ${person.name} from ${shiftTitle(shift)}${reason ? ` (${reason})` : ""}`,
    ctx,
    {
      shifts: {
        [shiftId]: { ...shift, assigned: shift.assigned.filter((id) => id !== staffId) },
      },
    },
    { shifts: { [shiftId]: shift } },
    { staffIds: [staffId], shiftIds: [shiftId], dates: [shift.date] },
  );
}

export function createShiftEdit(_roster: Roster, shift: Shift, ctx: EditContext): Edit {
  return base(
    "create_shift",
    `Create ${shiftTitle(shift)} for ${shift.headcount}`,
    ctx,
    { shifts: { [shift.id]: shift } },
    { shifts: { [shift.id]: null } },
    { shiftIds: [shift.id], dates: [shift.date] },
  );
}

export function deleteShiftEdit(roster: Roster, shiftId: string, ctx: EditContext): Edit | null {
  const shift = roster.shifts[shiftId];
  if (!shift) return null;
  return base(
    "delete_shift",
    `Delete ${shiftTitle(shift)}`,
    ctx,
    { shifts: { [shiftId]: null } },
    { shifts: { [shiftId]: shift } },
    { shiftIds: [shiftId], dates: [shift.date], staffIds: shift.assigned },
  );
}

export function updateShiftEdit(
  roster: Roster,
  shiftId: string,
  changes: Partial<Shift>,
  ctx: EditContext,
): Edit | null {
  const shift = roster.shifts[shiftId];
  if (!shift) return null;
  const next = { ...shift, ...changes };
  const described = Object.entries(changes)
    .map(([k, v]) => {
      if (k === "start" || k === "end") return `${k} to ${fmtTime(v as number)}`;
      if (k === "headcount") return `headcount to ${v}`;
      if (k === "role") return `role to ${ROLE_LABEL[v as Shift["role"]]}`;
      return `${k} to ${String(v)}`;
    })
    .join(", ");
  return base(
    "update_shift",
    `Change ${shiftTitle(shift)}: ${described}`,
    ctx,
    { shifts: { [shiftId]: next } },
    { shifts: { [shiftId]: shift } },
    { shiftIds: [shiftId], dates: [shift.date], staffIds: shift.assigned },
  );
}

export function timeOffEdit(
  roster: Roster,
  staffId: string,
  entry: StaffMember["timeOff"][number],
  ctx: EditContext,
): Edit | null {
  const person = roster.staff[staffId];
  if (!person) return null;
  const existing = person.timeOff.filter((t) => t.id !== entry.id);
  const verb = person.timeOff.some((t) => t.id === entry.id) ? "Update" : "Record";
  return base(
    "time_off",
    `${verb} ${entry.status} time off for ${person.name} on ${fmtDateShort(entry.date)} (${entry.reason})`,
    ctx,
    { staff: { [staffId]: { ...person, timeOff: [...existing, entry] } } },
    { staff: { [staffId]: person } },
    { staffIds: [staffId], dates: [entry.date] },
  );
}

export function ruleEdit(
  roster: Roster,
  ruleId: Rule["id"],
  changes: Partial<Rule>,
  ctx: EditContext,
): Edit | null {
  const rule = roster.rules[ruleId];
  if (!rule) return null;
  const described =
    changes.enabled !== undefined
      ? `${changes.enabled ? "Enable" : "Disable"} rule "${rule.label}"`
      : `Set "${rule.label}" ${rule.paramLabel ?? "value"} to ${String(changes.param)}`;
  return base(
    "rule",
    described,
    ctx,
    { rules: { [ruleId]: changes } },
    { rules: { [ruleId]: { enabled: rule.enabled, param: rule.param } } },
  );
}

/* -- patch application ----------------------------------------------------- */

export function applyPatch(roster: Roster, patch: StatePatch): Roster {
  let next = roster;
  if (patch.shifts) {
    const shifts = { ...next.shifts };
    for (const [id, value] of Object.entries(patch.shifts)) {
      if (value === null) delete shifts[id];
      else shifts[id] = value;
    }
    next = { ...next, shifts };
  }
  if (patch.staff) {
    const staff = { ...next.staff };
    for (const [id, value] of Object.entries(patch.staff)) {
      if (value === null) delete staff[id];
      else staff[id] = value;
    }
    next = { ...next, staff };
  }
  if (patch.rules) {
    const rules = { ...next.rules };
    for (const [id, value] of Object.entries(patch.rules)) {
      const key = id as Rule["id"];
      if (rules[key]) rules[key] = { ...rules[key], ...value };
    }
    next = { ...next, rules };
  }
  return next;
}

/**
 * Applies a list of edits in order.
 *
 * Edits carry whole-object snapshots rather than field deltas, so a later edit
 * built against the pre-edit roster would clobber an earlier one -- for example
 * two `assign` edits to the same shift. `rebase` re-derives each patch against
 * the roster as it actually stands when the edit lands.
 */
export function applyEdits(roster: Roster, edits: Edit[], direction: "forward" | "backward" = "forward"): Roster {
  let next = roster;
  const ordered = direction === "forward" ? edits : [...edits].reverse();
  for (const edit of ordered) {
    next = applyPatch(next, rebase(next, edit, direction));
  }
  return next;
}

function rebase(roster: Roster, edit: Edit, direction: "forward" | "backward"): StatePatch {
  const patch = direction === "forward" ? edit.forward : edit.backward;
  if (!patch.shifts || edit.kind === "create_shift" || edit.kind === "delete_shift") return patch;

  // For assignment edits, replay the intent against the live roster instead of
  // restoring a stale `assigned` array.
  if (edit.kind === "assign" || edit.kind === "unassign") {
    const shifts: Record<string, Shift | null> = {};
    for (const [id, snapshot] of Object.entries(patch.shifts)) {
      const live = roster.shifts[id];
      if (!live || snapshot === null) {
        shifts[id] = snapshot;
        continue;
      }
      const staffId = edit.touches.staffIds[0];
      const adding =
        (edit.kind === "assign" && direction === "forward") ||
        (edit.kind === "unassign" && direction === "backward");
      const assigned = adding
        ? live.assigned.includes(staffId)
          ? live.assigned
          : [...live.assigned, staffId]
        : live.assigned.filter((x) => x !== staffId);
      shifts[id] = { ...live, assigned };
    }
    return { ...patch, shifts };
  }

  return patch;
}
