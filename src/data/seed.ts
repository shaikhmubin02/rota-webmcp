import type { AvailabilityWindow, ISODate, Role, Shift, StaffMember, Venue } from "../types";
import { DEFAULT_RULES, rulesRecord } from "../engine/rules";
import type { Roster } from "../engine/rules";
import { isEligible, withAssignment } from "../engine/evaluate";
import { addDays, startOfWeek, toISODate, weekDates, weekdayOf } from "../engine/time";

export const VENUE: Venue = {
  name: "Meridian Coffee",
  timezone: "Europe/London",
  weeklyLaborBudget: 5000,
  currency: "£",
  overtimeMultiplier: 1.5,
};

const h = (n: number) => n * 60;

/** `av(1, 6, 15)` = Monday 06:00-15:00. Weekday: 0=Sun. */
function av(weekday: number, from: number, to: number): AvailabilityWindow {
  return { weekday, start: h(from), end: h(to) };
}

/** Same window every day in `days`. */
function avDays(days: number[], from: number, to: number): AvailabilityWindow[] {
  return days.map((d) => av(d, from, to));
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKEND = [0, 6];

export function seedStaff(weekStart: ISODate): StaffMember[] {
  const d = (n: number) => addDays(weekStart, n);
  return [
    {
      id: "aisha",
      name: "Aisha Rahman",
      roles: ["shift_lead", "barista"],
      contract: "full_time",
      hourlyRate: 17.5,
      targetWeeklyHours: 38,
      maxWeeklyHours: 45,
      maxDailyHours: 10,
      minRestHours: 11,
      maxConsecutiveDays: 6,
      isMinor: false,
      availability: [...avDays(WEEKDAYS, 6, 22), av(6, 6, 23), av(0, 7, 23)],
      timeOff: [],
      preferences: { prefersMornings: true },
      notes: "Assistant manager. Keys holder, so she can open or close.",
      seniority: 5,
      avatarHue: 158,
    },
    {
      id: "diego",
      name: "Diego Alvarez",
      roles: ["baker"],
      contract: "full_time",
      hourlyRate: 16.8,
      targetWeeklyHours: 40,
      maxWeeklyHours: 48,
      maxDailyHours: 10,
      minRestHours: 11,
      maxConsecutiveDays: 6,
      isMinor: false,
      availability: avDays(ALL_DAYS, 4, 13),
      timeOff: [],
      preferences: { prefersMornings: true, avoidsClosing: true },
      notes: "Head baker. Only works the early bake; cannot cover front of house.",
      seniority: 4,
      avatarHue: 32,
    },
    {
      id: "priya",
      name: "Priya Nair",
      roles: ["barista", "cashier"],
      contract: "part_time",
      hourlyRate: 13.2,
      targetWeeklyHours: 24,
      maxWeeklyHours: 30,
      maxDailyHours: 8,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: [...avDays(WEEKDAYS, 6, 16), av(6, 7, 16)],
      timeOff: [],
      preferences: { prefersMornings: true, avoidsClosing: true, maxShiftsPerWeek: 4 },
      notes: "School pickup at 16:30 every weekday - hard stop.",
      seniority: 3,
      avatarHue: 291,
    },
    {
      id: "tom",
      name: "Tom Okafor",
      roles: ["barista", "shift_lead"],
      contract: "full_time",
      hourlyRate: 16.9,
      targetWeeklyHours: 38,
      maxWeeklyHours: 44,
      maxDailyHours: 10,
      minRestHours: 11,
      maxConsecutiveDays: 6,
      isMinor: false,
      availability: avDays(ALL_DAYS, 12, 23),
      timeOff: [],
      preferences: { prefersEvenings: true },
      notes: "Second keys holder. Prefers the late half of the day.",
      seniority: 4,
      avatarHue: 205,
    },
    {
      id: "mei",
      name: "Mei Lin",
      roles: ["barista"],
      contract: "part_time",
      hourlyRate: 12.9,
      targetWeeklyHours: 20,
      maxWeeklyHours: 26,
      maxDailyHours: 9,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: [...avDays([3, 4, 5], 15, 23), ...avDays(WEEKEND, 7, 23)],
      timeOff: [
        { id: "to-mei-1", date: d(4), start: h(17), end: h(23), reason: "university exam", status: "approved" },
      ],
      preferences: { prefersEvenings: true },
      notes: "Final-year student. Weekends are her main availability.",
      seniority: 2,
      avatarHue: 340,
    },
    {
      id: "jonas",
      name: "Jonas Berg",
      roles: ["cashier", "barista"],
      contract: "part_time",
      hourlyRate: 12.6,
      targetWeeklyHours: 22,
      maxWeeklyHours: 28,
      maxDailyHours: 8,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: avDays(WEEKDAYS, 7, 20),
      timeOff: [],
      preferences: { avoidsWeekends: true },
      notes: "Coaches a junior football team at weekends.",
      seniority: 2,
      avatarHue: 220,
    },
    {
      id: "sofia",
      name: "Sofia Costa",
      roles: ["barista", "baker", "shift_lead"],
      contract: "full_time",
      hourlyRate: 15.4,
      targetWeeklyHours: 36,
      maxWeeklyHours: 44,
      maxDailyHours: 10,
      minRestHours: 11,
      maxConsecutiveDays: 6,
      isMinor: false,
      availability: avDays(ALL_DAYS, 5, 18),
      timeOff: [],
      preferences: {},
      notes: "The only person besides Diego who can run the bake, and a keys holder for the early half of the day.",
      seniority: 3,
      avatarHue: 12,
    },
    {
      id: "liam",
      name: "Liam Doyle",
      roles: ["barista"],
      contract: "casual",
      hourlyRate: 12.4,
      targetWeeklyHours: 12,
      maxWeeklyHours: 20,
      maxDailyHours: 8,
      minRestHours: 12,
      maxConsecutiveDays: 5,
      isMinor: true,
      availability: [...avDays([4, 5], 16, 22), ...avDays(WEEKEND, 9, 22)],
      timeOff: [],
      preferences: {},
      notes: "17 years old - statutory curfew applies, so he cannot work the late weekend close.",
      seniority: 1,
      avatarHue: 96,
    },
    {
      id: "nadia",
      name: "Nadia Hassan",
      roles: ["shift_lead", "cashier"],
      contract: "part_time",
      hourlyRate: 15.9,
      targetWeeklyHours: 26,
      maxWeeklyHours: 32,
      maxDailyHours: 9,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: avDays(ALL_DAYS, 8, 22),
      timeOff: [
        { id: "to-nadia-1", date: d(5), reason: "family wedding", status: "pending" },
      ],
      preferences: { avoidsClosing: true },
      notes: "Third keys holder. Has a pending Saturday request nobody has actioned.",
      seniority: 3,
      avatarHue: 264,
    },
    {
      id: "ravi",
      name: "Ravi Patel",
      roles: ["barista", "cashier"],
      contract: "part_time",
      hourlyRate: 12.8,
      targetWeeklyHours: 20,
      maxWeeklyHours: 28,
      maxDailyHours: 8,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: avDays(ALL_DAYS, 9, 23),
      timeOff: [],
      preferences: {},
      notes: "Newest hire. Keeps getting missed when the rota is built by hand.",
      seniority: 1,
      avatarHue: 45,
    },
    {
      id: "grace",
      name: "Grace Kim",
      roles: ["baker", "barista"],
      contract: "part_time",
      hourlyRate: 14.6,
      targetWeeklyHours: 24,
      maxWeeklyHours: 30,
      maxDailyHours: 9,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: avDays([1, 2, 3, 4, 5, 6], 5, 15),
      timeOff: [
        { id: "to-grace-1", date: d(3), reason: "hospital appointment", status: "approved" },
      ],
      preferences: { prefersMornings: true },
      notes: "",
      seniority: 2,
      avatarHue: 178,
    },
    {
      id: "yusuf",
      name: "Yusuf Demir",
      roles: ["barista"],
      contract: "casual",
      hourlyRate: 12.5,
      targetWeeklyHours: 12,
      maxWeeklyHours: 24,
      maxDailyHours: 9,
      minRestHours: 11,
      maxConsecutiveDays: 4,
      isMinor: false,
      availability: [...avDays(WEEKEND, 8, 23), av(5, 16, 23)],
      timeOff: [],
      preferences: { prefersEvenings: true },
      notes: "Weekend and Friday-night cover. Studies during the week.",
      seniority: 1,
      avatarHue: 62,
    },
    {
      id: "ana",
      name: "Ana Silva",
      roles: ["cashier", "barista"],
      contract: "part_time",
      hourlyRate: 12.7,
      targetWeeklyHours: 16,
      maxWeeklyHours: 24,
      maxDailyHours: 8,
      minRestHours: 11,
      maxConsecutiveDays: 5,
      isMinor: false,
      availability: avDays(ALL_DAYS, 9, 22),
      timeOff: [],
      preferences: {},
      notes: "Happy to work any day, which makes her the safety valve for Sundays.",
      seniority: 2,
      avatarHue: 314,
    },
    {
      id: "marco",
      name: "Marco Rossi",
      roles: ["barista", "shift_lead"],
      contract: "full_time",
      hourlyRate: 17.1,
      targetWeeklyHours: 40,
      maxWeeklyHours: 46,
      maxDailyHours: 10,
      minRestHours: 11,
      maxConsecutiveDays: 6,
      isMinor: false,
      availability: avDays(ALL_DAYS, 6, 23),
      timeOff: [],
      preferences: {},
      notes: "Will say yes to anything, which is exactly why he ends up over-scheduled.",
      seniority: 4,
      avatarHue: 8,
    },
  ];
}

/* -- shift template -------------------------------------------------------- */

interface ShiftTemplate {
  label: string;
  role: Role;
  start: number;
  end: number;
  headcount: number;
  isOpening?: boolean;
  isClosing?: boolean;
  /** Weekdays this template applies to. Defaults to all. */
  days?: number[];
}

/**
 * Trading pattern for the week. Sized so that a fully legal week is reachable
 * but not comfortable: total demand sits a little above the sum of everyone's
 * contracted hours, so covering the whole week costs some overtime. That is
 * what makes "fill it without overtime" an interesting instruction rather than
 * a formality.
 */
const TEMPLATES: ShiftTemplate[] = [
  // Weekdays.
  { label: "Bake", role: "baker", start: h(5), end: h(11), headcount: 1, isOpening: true, days: WEEKDAYS },
  { label: "Open bar", role: "barista", start: h(6.5), end: h(11.5), headcount: 1, isOpening: true, days: WEEKDAYS },
  { label: "Open lead", role: "shift_lead", start: h(6.5), end: h(14.5), headcount: 1, isOpening: true, days: WEEKDAYS },
  { label: "Till", role: "cashier", start: h(9), end: h(15), headcount: 1, days: WEEKDAYS },
  { label: "Mid bar", role: "barista", start: h(11), end: h(16.5), headcount: 2, days: WEEKDAYS },
  { label: "Close lead", role: "shift_lead", start: h(14), end: h(21.5), headcount: 1, isClosing: true, days: WEEKDAYS },
  { label: "Close bar", role: "barista", start: h(16.5), end: h(21.5), headcount: 1, isClosing: true, days: WEEKDAYS },

  // Weekends open later, trade later, and are busier through the middle.
  { label: "Bake", role: "baker", start: h(5), end: h(11), headcount: 1, isOpening: true, days: WEEKEND },
  { label: "Open bar", role: "barista", start: h(8), end: h(13), headcount: 1, isOpening: true, days: WEEKEND },
  { label: "Open lead", role: "shift_lead", start: h(8), end: h(15), headcount: 1, isOpening: true, days: WEEKEND },
  { label: "Till", role: "cashier", start: h(10), end: h(16), headcount: 1, days: WEEKEND },
  { label: "Mid bar", role: "barista", start: h(12), end: h(17), headcount: 2, days: WEEKEND },
  { label: "Close lead", role: "shift_lead", start: h(15), end: h(22.5), headcount: 1, isClosing: true, days: WEEKEND },
  { label: "Close bar", role: "barista", start: h(16.5), end: h(22.5), headcount: 1, isClosing: true, days: WEEKEND },
];

export function seedShifts(weekStart: ISODate): Shift[] {
  const shifts: Shift[] = [];
  for (const date of weekDates(weekStart)) {
    const wd = weekdayOf(date);
    for (const t of TEMPLATES) {
      if (t.days && !t.days.includes(wd)) continue;
      shifts.push({
        id: `${date}-${t.role}-${t.start}`,
        date,
        start: t.start,
        end: t.end,
        role: t.role,
        headcount: t.headcount,
        assigned: [],
        status: "draft",
        isOpening: Boolean(t.isOpening),
        isClosing: Boolean(t.isClosing),
        label: t.label,
      });
    }
  }
  return shifts;
}

/* -- the deliberately imperfect starting roster ---------------------------- */

/** Tiny deterministic PRNG so every judge sees exactly the same broken rota. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Builds the week a real manager would have half-finished on a Friday
 * afternoon: mostly filled, but with genuine coverage gaps, a close-then-open
 * that slipped through, one person starved of hours and a lopsided weekend.
 *
 * The flaws are seeded on purpose. Rota's whole argument is that an agent
 * should find and fix them with you, so the demo has to start from a mess.
 */
export function seedRoster(today: ISODate = toISODate(new Date())): Roster {
  const weekStart = startOfWeek(addDays(today, 7));
  const staff = seedStaff(weekStart);
  const shifts = seedShifts(weekStart);

  let roster: Roster = {
    venue: VENUE,
    staff: Object.fromEntries(staff.map((s) => [s.id, s])),
    shifts: Object.fromEntries(shifts.map((s) => [s.id, s])),
    rules: rulesRecord(DEFAULT_RULES),
    weekStart,
  };

  const rnd = lcg(20260903);
  const rotation = [
    "aisha", "diego", "marco", "sofia", "tom", "priya", "grace",
    "jonas", "nadia", "mei", "liam", "ravi", "yusuf", "ana",
  ];
  let cursor = 0;

  // A hand-built rota fails at the back end of the week. The manager works
  // forwards from Monday, gets through Thursday properly, starts losing the
  // thread on Friday, and never really finishes the weekend -- which is also
  // the hardest part to staff. Leaving the gaps *there*, rather than scattering
  // them uniformly, is both more realistic and more useful: the capacity to
  // fill them is still free, so the solver has genuine work to do.
  const skipRate: Record<number, number> = {
    1: 0.05, // Mon
    2: 0.05,
    3: 0.08,
    4: 0.08,
    5: 0.3, // Fri — attention going
    6: 0.45, // Sat — barely started
    0: 0.5, // Sun — abandoned
  };

  for (const shift of Object.values(roster.shifts).sort(
    (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
  )) {
    for (let slot = 0; slot < shift.headcount; slot++) {
      if (rnd() < (skipRate[weekdayOf(shift.date)] ?? 0.1)) continue;
      let placed = false;
      // Two passes: people whose primary role is this role, then anyone else.
      for (const primaryOnly of [true, false]) {
        for (let attempt = 0; attempt < rotation.length && !placed; attempt++) {
          const id = rotation[(cursor + attempt) % rotation.length];
          const person = roster.staff[id];
          if (primaryOnly && person.roles[0] !== shift.role) continue;
          // Ravi is the person a hand-built rota always forgets, which is how
          // he ends up well short of his contracted hours.
          if (id === "ravi" && rnd() < 0.8) continue;
          if (isEligible(roster, shift.id, id)) {
            roster = withAssignment(roster, shift.id, id);
            cursor = (cursor + attempt + 1) % rotation.length;
            placed = true;
          }
        }
        if (placed) break;
      }
    }
  }

  return injectClopening(roster, weekStart);
}

/**
 * Forces the classic mistake: Marco closes on Wednesday night and opens on
 * Thursday morning. Nine hours between shifts where eleven are required.
 *
 * It is done as a surgical edit -- clear him off both days first, then place
 * exactly these two shifts -- so the roster contains this one clean, legible
 * breach rather than a pile of collateral ones. The point of the demo is that
 * an agent finds the subtle error a human eye slides over, and that only reads
 * if the error is genuinely subtle.
 */
function injectClopening(roster: Roster, weekStart: ISODate): Roster {
  const wed = addDays(weekStart, 2);
  const thu = addDays(weekStart, 3);
  const wedClose = Object.values(roster.shifts).find(
    (s) => s.date === wed && s.role === "shift_lead" && s.isClosing,
  );
  const thuOpen = Object.values(roster.shifts).find(
    (s) => s.date === thu && s.role === "shift_lead" && s.isOpening,
  );
  if (!wedClose || !thuOpen) return roster;

  const shifts = { ...roster.shifts };

  // Clear Marco off both days so the only thing he works is the close and the
  // open, and backfill anyone he displaces where somebody else fits.
  for (const shift of Object.values(shifts)) {
    if ((shift.date === wed || shift.date === thu) && shift.assigned.includes("marco")) {
      shifts[shift.id] = { ...shift, assigned: shift.assigned.filter((x) => x !== "marco") };
    }
  }

  const place = (shiftId: string) => {
    const shift = shifts[shiftId];
    const others = shift.assigned.filter((x) => x !== "marco");
    // Marco takes a slot; the last person in loses theirs.
    const keep = others.slice(0, Math.max(0, shift.headcount - 1));
    shifts[shiftId] = { ...shift, assigned: [...keep, "marco"] };
  };
  place(wedClose.id);
  place(thuOpen.id);

  let next: Roster = { ...roster, shifts };

  // Backfill only the shifts Marco was just placed into, so displacing someone
  // does not silently open a third gap. Every other gap in the week is there on
  // purpose and must stay.
  for (const shiftId of [wedClose.id, thuOpen.id]) {
    const shift = next.shifts[shiftId];
    if (shift.assigned.length >= shift.headcount) continue;
    const candidate = Object.keys(next.staff).find(
      (id) => id !== "marco" && isEligible(next, shiftId, id),
    );
    if (candidate) next = withAssignment(next, shiftId, candidate);
  }

  return next;
}
