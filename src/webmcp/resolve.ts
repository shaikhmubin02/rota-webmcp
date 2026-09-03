import type { ISODate, Role, Shift, StaffMember } from "../types";
import { ROLES, ROLE_LABEL } from "../types";
import type { Roster } from "../engine/rules";
import { parseTime, resolveDate, weekDates } from "../engine/time";

/**
 * Agents refer to things the way people do: "Marco", "Thursday", "the closing
 * shift". Tools that only accept opaque ids force the model to make an extra
 * lookup call for every action, and it will sometimes guess instead.
 *
 * These resolvers accept the loose form and return the exact entity, or a
 * precise error naming the valid options -- which is far more useful to a model
 * than "not found".
 */

export class ResolveError extends Error {}

export function resolveStaff(roster: Roster, ref: string): StaffMember {
  const list = Object.values(roster.staff);
  const needle = ref.trim().toLowerCase();
  if (!needle) throw new ResolveError("No staff member was named.");

  const byId = list.find((p) => p.id.toLowerCase() === needle);
  if (byId) return byId;

  const exact = list.filter((p) => p.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];

  const first = list.filter((p) => p.name.toLowerCase().split(" ")[0] === needle);
  if (first.length === 1) return first[0];

  const partial = list.filter((p) => p.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];

  if (partial.length > 1) {
    throw new ResolveError(
      `"${ref}" matches several people: ${partial.map((p) => p.name).join(", ")}. Use a full name or id.`,
    );
  }
  throw new ResolveError(
    `No staff member matches "${ref}". The team is: ${list.map((p) => `${p.name} (${p.id})`).join(", ")}.`,
  );
}

export function resolveStaffList(roster: Roster, refs: string[] | undefined): StaffMember[] {
  return (refs ?? []).map((r) => resolveStaff(roster, r));
}

export function resolveRole(ref: string): Role {
  const needle = ref.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const direct = ROLES.find((r) => r === needle);
  if (direct) return direct;
  const byLabel = ROLES.find((r) => ROLE_LABEL[r].toLowerCase().replace(/\s+/g, "_") === needle);
  if (byLabel) return byLabel;
  const loose = ROLES.find((r) => r.includes(needle) || needle.includes(r));
  if (loose) return loose;
  throw new ResolveError(`Unknown role "${ref}". Valid roles: ${ROLES.join(", ")}.`);
}

export function resolveDateOrThrow(roster: Roster, ref: string, today: ISODate): ISODate {
  const date = resolveDate(ref, roster.weekStart, today);
  if (!date) {
    throw new ResolveError(
      `Could not read "${ref}" as a date. Use YYYY-MM-DD or a weekday name. The roster week runs ${weekDates(roster.weekStart)[0]} to ${weekDates(roster.weekStart)[6]}.`,
    );
  }
  return date;
}

export interface ShiftRef {
  shift_id?: string;
  date?: string;
  role?: string;
  /** `"opening" | "closing" | "morning" | "afternoon" | "evening"` or a clock time. */
  when?: string;
}

/**
 * Finds exactly one shift from a loose reference. If the reference is ambiguous
 * the error lists every candidate with its id, so the agent's next call is
 * guaranteed to succeed.
 */
export function resolveShift(roster: Roster, ref: ShiftRef, today: ISODate): Shift {
  if (ref.shift_id) {
    const direct = roster.shifts[ref.shift_id];
    if (direct) return direct;
    throw new ResolveError(`No shift with id "${ref.shift_id}".`);
  }

  let candidates = Object.values(roster.shifts);

  if (ref.date) {
    const date = resolveDateOrThrow(roster, ref.date, today);
    candidates = candidates.filter((s) => s.date === date);
    if (candidates.length === 0) throw new ResolveError(`There are no shifts on ${date}.`);
  }

  if (ref.role) {
    const role = resolveRole(ref.role);
    const filtered = candidates.filter((s) => s.role === role);
    if (filtered.length === 0) {
      throw new ResolveError(
        `No ${ROLE_LABEL[role]} shift matches. Available: ${describeCandidates(candidates)}.`,
      );
    }
    candidates = filtered;
  }

  if (ref.when) {
    const filtered = filterByWhen(candidates, ref.when);
    if (filtered.length === 0) {
      throw new ResolveError(
        `No shift matches "${ref.when}". Available: ${describeCandidates(candidates)}.`,
      );
    }
    candidates = filtered;
  }

  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new ResolveError("No shift matches that description.");
  throw new ResolveError(
    `That matches ${candidates.length} shifts. Pass shift_id for one of: ${describeCandidates(candidates)}.`,
  );
}

function filterByWhen(candidates: Shift[], when: string): Shift[] {
  const w = when.trim().toLowerCase();
  if (w === "opening" || w === "open" || w === "early") return candidates.filter((s) => s.isOpening);
  if (w === "closing" || w === "close" || w === "late") return candidates.filter((s) => s.isClosing);
  if (w === "morning") return candidates.filter((s) => s.start < 12 * 60);
  if (w === "afternoon") {
    return candidates.filter((s) => s.start >= 11 * 60 && s.start < 17 * 60);
  }
  if (w === "evening" || w === "night") return candidates.filter((s) => s.start >= 15 * 60);
  const minutes = parseTime(w);
  if (minutes !== null) {
    const exact = candidates.filter((s) => s.start === minutes);
    if (exact.length) return exact;
    return candidates.filter((s) => Math.abs(s.start - minutes) <= 60);
  }
  const byLabel = candidates.filter((s) => (s.label ?? "").toLowerCase().includes(w));
  return byLabel;
}

function describeCandidates(candidates: Shift[]): string {
  return candidates
    .slice(0, 8)
    .map((s) => `${s.id} (${s.label ?? ROLE_LABEL[s.role]})`)
    .join(", ");
}

/** Resolves a set of dates from either `dates`, a single `date`, or the week. */
export function resolveDates(
  roster: Roster,
  args: { date?: string; dates?: string[] },
  today: ISODate,
): ISODate[] {
  if (args.dates?.length) return args.dates.map((d) => resolveDateOrThrow(roster, d, today));
  if (args.date) return [resolveDateOrThrow(roster, args.date, today)];
  return weekDates(roster.weekStart);
}
