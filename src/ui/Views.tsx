import { useMemo } from "react";
import { ROLE_LABEL } from "../types";
import { costReport } from "../engine/cost";
import { fairnessReport, validateAll } from "../engine/evaluate";
import { shiftsOf } from "../engine/rules";
import { durationHours, fmtDateShort, fmtTime, isWeekend, weekDates } from "../engine/time";
import { previewRoster, useStore } from "../store/store";
import { Avatar, Badge, Icon, ICONS, Meter, RoleChip, cx } from "./bits";

/** Per-person rows across the week: the view a manager checks fairness on. */
export function StaffView() {
  const roster = useStore(previewRoster);
  const weekStart = useStore((s) => s.weekStart);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const highlight = useStore((s) => s.highlight);
  const dates = weekDates(weekStart);
  const report = useMemo(() => fairnessReport(roster), [roster]);
  const violations = useMemo(() => validateAll(roster), [roster]);
  const litStaff = new Set(highlight?.staffIds ?? []);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
      <table className="w-full border-separate border-spacing-y-1">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="w-52 rounded-l-apple material px-3 py-2 text-left text-[10px] font-semibold tracking-wider text-label-3 uppercase">
              Staff
            </th>
            {dates.map((date) => (
              <th
                key={date}
                className={cx(
                  "material px-2 py-2 text-left text-[10px] font-semibold tracking-wider uppercase",
                  isWeekend(date) ? "text-accent" : "text-label-3",
                )}
              >
                {fmtDateShort(date).replace(/ \d+ \w+$/, "")}
              </th>
            ))}
            <th className="w-36 rounded-r-apple material px-3 py-2 text-right text-[10px] font-semibold tracking-wider text-label-3 uppercase">
              Load
            </th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const person = roster.staff[row.staffId];
            if (!person) return null;
            const mine = shiftsOf(roster, person.id);
            const hard = violations.filter(
              (v) => v.staffId === person.id && v.severity === "hard",
            ).length;
            const selected = selection.staffId === person.id;

            return (
              <tr
                key={person.id}
                onClick={() => select({ ...selection, staffId: selected ? undefined : person.id })}
                className={cx(
                  "cursor-pointer",
                  litStaff.has(person.id) && "[&>td]:bg-orange-soft",
                  selected && "[&>td]:bg-accent-soft",
                )}
              >
                <td className="rounded-l-apple border-y border-l border-hairline bg-raised px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Avatar person={person} size={26} ring={selected} />
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-medium text-label">{person.name}</p>
                      <div className="flex items-center gap-1">
                        {person.roles.slice(0, 2).map((r) => (
                          <RoleChip key={r} role={r} short />
                        ))}
                      </div>
                    </div>
                    {hard > 0 && (
                      <span className="ml-auto text-red">
                        <Icon path={ICONS.alert} size={12} />
                      </span>
                    )}
                  </div>
                </td>

                {dates.map((date) => {
                  const day = mine.filter((s) => s.date === date);
                  const off = person.timeOff.find((t) => t.date === date);
                  return (
                    <td
                      key={date}
                      className="border-y border-hairline bg-raised px-1.5 py-1.5 align-top"
                    >
                      {day.length === 0 ? (
                        off ? (
                          <span
                            className={cx(
                              "block rounded px-1 py-0.5 text-center text-[9.5px] font-medium",
                              off.status === "approved"
                                ? "bg-inset text-label-3"
                                : "bg-orange-soft text-orange",
                            )}
                          >
                            {off.status === "approved" ? "off" : "req"}
                          </span>
                        ) : (
                          <span className="block text-center text-[10px] text-label-3">·</span>
                        )
                      ) : (
                        <div className="space-y-0.5">
                          {day.map((s) => (
                            <div
                              key={s.id}
                              className="rounded bg-inset px-1 py-0.5 text-[9.5px] leading-tight tabular-nums text-label"
                              title={`${ROLE_LABEL[s.role]} ${fmtTime(s.start)}–${fmtTime(s.end)}`}
                            >
                              {fmtTime(s.start).slice(0, 5)}–{fmtTime(s.end).slice(0, 5)}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}

                <td className="rounded-r-apple border-y border-r border-hairline bg-raised px-3 py-2">
                  <p className="text-right text-[12.5px] font-semibold tabular-nums text-label">
                    {row.hours.toFixed(1)}
                    <span className="text-[10px] font-normal text-label-3">
                      /{row.targetWeeklyHours}h
                    </span>
                  </p>
                  <div className="mt-1">
                    <Meter
                      value={row.hours}
                      max={row.targetWeeklyHours}
                      tone={row.loadIndex >= 0.85 ? "green" : "orange"}
                      label={`${person.name} load`}
                    />
                  </div>
                  <p className="mt-1 text-right text-[9.5px] tabular-nums text-label-3">
                    {row.weekendShifts} wknd · {row.closingShifts} close
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {report.notes.length > 0 && (
        <div className="mt-3 rounded-apple border border-hairline bg-orange-soft p-3">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-orange">
            <Icon path={ICONS.scale} size={13} />
            Fairness flags · inequality index {report.loadInequality}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {report.notes.map((note, i) => (
              <li key={i} className="text-[11px] leading-snug text-orange">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Where the money goes. */
export function CostView() {
  const roster = useStore(previewRoster);
  const committed = useStore((s) => s.roster);
  const report = useMemo(() => costReport(roster), [roster]);
  const before = useMemo(() => costReport(committed), [committed]);
  const cur = roster.venue.currency;
  const delta = report.total - before.total;
  const maxDay = Math.max(1, ...report.perDay.map((d) => d.cost));

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
      <div className="grid grid-cols-4 gap-2.5">
        <Stat
          label="Projected"
          value={`${cur}${Math.round(report.total).toLocaleString("en")}`}
          sub={delta !== 0 ? `${delta > 0 ? "+" : ""}${cur}${Math.round(delta)} proposed` : "unchanged"}
          tone={report.total > report.budget ? "bad" : "good"}
        />
        <Stat
          label="Budget"
          value={`${cur}${report.budget.toLocaleString("en")}`}
          sub={`${Math.round(report.utilisation * 100)}% used`}
        />
        <Stat
          label="Overtime"
          value={`${report.overtimeHours.toFixed(1)}h`}
          sub={`${cur}${Math.round(report.overtimeCost)} at ${roster.venue.overtimeMultiplier}×`}
          tone={report.overtimeHours > 0 ? "warn" : "good"}
        />
        <Stat
          label={report.overBudgetBy > 0 ? "Over by" : "Headroom"}
          value={`${cur}${Math.round(report.overBudgetBy > 0 ? report.overBudgetBy : report.budget - report.total).toLocaleString("en")}`}
          tone={report.overBudgetBy > 0 ? "bad" : "good"}
        />
      </div>

      <section className="rounded-apple-lg border border-hairline bg-raised p-3.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-label-3 uppercase">
          Cost by day
        </h3>
        <div className="mt-3 flex h-32 items-end gap-2">
          {report.perDay.map((day) => (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <span className="text-[9.5px] tabular-nums text-label-3">
                {cur}
                {Math.round(day.cost)}
              </span>
              <div
                className={cx(
                  "w-full rounded-t transition-[height] duration-500",
                  isWeekend(day.date) ? "bg-accent" : "bg-accent/45",
                )}
                style={{ height: `${(day.cost / maxDay) * 100}%` }}
                title={`${fmtDateShort(day.date)}: ${cur}${Math.round(day.cost)} over ${day.hours.toFixed(1)}h`}
              />
              <span className="text-[9.5px] text-label-3">
                {fmtDateShort(day.date).split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-apple-lg border border-hairline bg-raised">
        <h3 className="border-b border-hairline px-3.5 py-2.5 text-[11px] font-semibold tracking-wider text-label-3 uppercase">
          Cost by person
        </h3>
        <ul>
          {report.perStaff.map((row) => {
            const person = roster.staff[row.staffId];
            if (!person) return null;
            return (
              <li
                key={row.staffId}
                className="flex items-center gap-3 border-b border-hairline px-3.5 py-2 last:border-0"
              >
                <Avatar person={person} size={24} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-label">
                  {person.name}
                </span>
                <span className="w-16 text-right text-[11px] tabular-nums text-label-2">
                  {row.hours.toFixed(1)}h
                </span>
                {row.overtimeHours > 0 ? (
                  <Badge tone="warn">{row.overtimeHours.toFixed(1)}h OT</Badge>
                ) : (
                  <span className="w-[52px]" />
                )}
                <span className="w-20 text-right text-[12.5px] font-semibold tabular-nums text-label">
                  {cur}
                  {Math.round(row.totalCost)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tones = {
    neutral: "text-label",
    good: "text-green",
    warn: "text-orange",
    bad: "text-red",
  };
  return (
    <div className="rounded-apple-lg border border-hairline bg-raised p-3">
      <p className="text-[10px] font-semibold tracking-wider text-label-3 uppercase">{label}</p>
      <p className={cx("mt-1 text-[22px] font-semibold tracking-tight tabular-nums", tones[tone])}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10.5px] text-label-2">{sub}</p>}
    </div>
  );
}

/** Detail sheet for the current selection, shown under the calendar. */
export function SelectionDetail() {
  const roster = useStore(previewRoster);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const shift = selection.shiftId ? roster.shifts[selection.shiftId] : undefined;
  const person = selection.staffId ? roster.staff[selection.staffId] : undefined;
  if (!shift && !person) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-hairline bg-inset px-4 py-2 text-[11px]">
      <Badge tone="agent">selection active</Badge>
      {shift && (
        <span className="text-label-2">
          <strong className="font-medium text-label">
            {fmtDateShort(shift.date)} {fmtTime(shift.start)}–{fmtTime(shift.end)}{" "}
            {ROLE_LABEL[shift.role]}
          </strong>{" "}
          · {shift.assigned.length}/{shift.headcount} ·{" "}
          {durationHours(shift.start, shift.end).toFixed(1)}h
        </span>
      )}
      {person && (
        <span className="text-label-2">
          <strong className="font-medium text-label">{person.name}</strong> ·{" "}
          {person.roles.map((r) => ROLE_LABEL[r]).join("/")}
        </span>
      )}
      <span className="ml-auto text-label-3">
        Selection-scoped tools are registered — see the WebMCP tab
      </span>
      <button
        onClick={() => select({})}
        className="text-label-3 hover:text-label"
        aria-label="Clear selection"
      >
        <Icon path={ICONS.x} size={12} />
      </button>
    </div>
  );
}
