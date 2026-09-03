import type { ISODate } from "../types";
import type { Roster } from "../engine/rules";

export interface RosterDiff {
  /** shiftId -> staffIds the proposal would add. */
  added: Map<string, Set<string>>;
  /** shiftId -> staffIds the proposal would remove. */
  removed: Map<string, Set<string>>;
  createdShiftIds: Set<string>;
  deletedShiftIds: Set<string>;
  changedShiftIds: Set<string>;
  touchedDates: Set<ISODate>;
  touchedStaffIds: Set<string>;
}

/**
 * Compares the committed roster with the proposed one so the grid can render
 * pending changes in place -- ghosted additions, struck-through removals --
 * instead of making the manager read a list and imagine the result.
 */
export function diffRosters(committed: Roster, proposed: Roster): RosterDiff {
  const added = new Map<string, Set<string>>();
  const removed = new Map<string, Set<string>>();
  const createdShiftIds = new Set<string>();
  const deletedShiftIds = new Set<string>();
  const changedShiftIds = new Set<string>();
  const touchedDates = new Set<ISODate>();
  const touchedStaffIds = new Set<string>();

  for (const [id, shift] of Object.entries(proposed.shifts)) {
    const before = committed.shifts[id];
    if (!before) {
      createdShiftIds.add(id);
      touchedDates.add(shift.date);
      continue;
    }
    const beforeSet = new Set(before.assigned);
    const afterSet = new Set(shift.assigned);
    const plus = shift.assigned.filter((s) => !beforeSet.has(s));
    const minus = before.assigned.filter((s) => !afterSet.has(s));
    if (plus.length) {
      added.set(id, new Set(plus));
      plus.forEach((s) => touchedStaffIds.add(s));
    }
    if (minus.length) {
      removed.set(id, new Set(minus));
      minus.forEach((s) => touchedStaffIds.add(s));
    }
    if (
      before.start !== shift.start ||
      before.end !== shift.end ||
      before.headcount !== shift.headcount ||
      before.role !== shift.role
    ) {
      changedShiftIds.add(id);
    }
    if (plus.length || minus.length || changedShiftIds.has(id)) touchedDates.add(shift.date);
  }

  for (const [id, shift] of Object.entries(committed.shifts)) {
    if (!proposed.shifts[id]) {
      deletedShiftIds.add(id);
      touchedDates.add(shift.date);
      shift.assigned.forEach((s) => touchedStaffIds.add(s));
    }
  }

  return {
    added,
    removed,
    createdShiftIds,
    deletedShiftIds,
    changedShiftIds,
    touchedDates,
    touchedStaffIds,
  };
}

export function isEmptyDiff(diff: RosterDiff): boolean {
  return (
    diff.added.size === 0 &&
    diff.removed.size === 0 &&
    diff.createdShiftIds.size === 0 &&
    diff.deletedShiftIds.size === 0 &&
    diff.changedShiftIds.size === 0
  );
}
