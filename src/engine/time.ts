import type { ISODate, Minutes } from "../types";

export const MIN_PER_DAY = 1440;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `510` → `"08:30"`. Handles past-midnight values (`1500` → `"01:00 (+1)"`). */
export function fmtTime(m: Minutes): string {
  const wrapped = m % MIN_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  const suffix = m >= MIN_PER_DAY ? " (+1)" : "";
  return `${pad2(h)}:${pad2(mm)}${suffix}`;
}

/** `"08:30"` → `510`. Also accepts `"8:30"`, `"8am"`, `"8 pm"`, `"20:00"`. */
export function parseTime(input: string): Minutes | null {
  const s = input.trim().toLowerCase();
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") h += 12;
    return h * 60 + Number(ampm[2] ?? 0);
  }
  const hhmm = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (hhmm) return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  const bare = /^(\d{1,2})$/.exec(s);
  if (bare) return Number(bare[1]) * 60;
  return null;
}

export function durationHours(start: Minutes, end: Minutes): number {
  return (end - start) / 60;
}

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromISODate(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function weekdayOf(s: ISODate): number {
  return fromISODate(s).getDay();
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function isWeekend(s: ISODate): boolean {
  const w = weekdayOf(s);
  return w === 0 || w === 6;
}

/** Monday-start week containing `s`. */
export function startOfWeek(s: ISODate): ISODate {
  const w = weekdayOf(s);
  const back = w === 0 ? 6 : w - 1;
  return addDays(s, -back);
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** `"Mon 8 Sep"` */
export function fmtDateShort(s: ISODate): string {
  const d = fromISODate(s);
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en", { month: "short" })}`;
}

/** `"Monday 8 September"` */
export function fmtDateLong(s: ISODate): string {
  const d = fromISODate(s);
  return `${WEEKDAY_LONG[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en", { month: "long" })}`;
}

/** Absolute minute index, so cross-midnight comparisons work. */
export function absMinutes(date: ISODate, m: Minutes): number {
  return Math.round(fromISODate(date).getTime() / 60000) + m;
}

export function overlaps(
  aDate: ISODate,
  aStart: Minutes,
  aEnd: Minutes,
  bDate: ISODate,
  bStart: Minutes,
  bEnd: Minutes,
): boolean {
  const a0 = absMinutes(aDate, aStart);
  const a1 = absMinutes(aDate, aEnd);
  const b0 = absMinutes(bDate, bStart);
  const b1 = absMinutes(bDate, bEnd);
  return a0 < b1 && b0 < a1;
}

/**
 * Resolves a natural-language-ish date reference against the roster week.
 * Accepts `"2026-09-10"`, `"thursday"`, `"thu"`, `"today"`, `"tomorrow"`.
 * Agents reliably produce one of these forms, so tools accept all of them.
 */
export function resolveDate(input: string, weekStart: ISODate, today: ISODate): ISODate | null {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === "today") return today;
  if (s === "tomorrow") return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  const idx = WEEKDAY_LONG.findIndex(
    (w) => w.toLowerCase() === s || w.toLowerCase().slice(0, 3) === s,
  );
  if (idx >= 0) return weekDates(weekStart).find((d) => weekdayOf(d) === idx) ?? null;
  return null;
}
