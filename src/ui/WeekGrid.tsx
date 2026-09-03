import { useMemo } from "react";
import type { Shift, Violation } from "../types";
import { ROLE_LABEL } from "../types";
import { coveragePercent, validateAll } from "../engine/evaluate";
import { durationHours, fmtDateShort, fmtTime, isWeekend, weekDates } from "../engine/time";
import { diffRosters } from "../store/diff";
import { assignEdit, unassignEdit } from "../store/edits";
import { previewRoster, useStore } from "../store/store";
import { Avatar, Badge, Icon, ICONS, Meter, RoleChip, cx } from "./bits";

export function WeekGrid() {
  const committed = useStore((s) => s.roster);
  const proposed = useStore(previewRoster);
  const weekStart = useStore((s) => s.weekStart);
  const selection = useStore((s) => s.selection);
  const highlight = useStore((s) => s.highlight);
  const select = useStore((s) => s.select);
  const commitDirect = useStore((s) => s.commitDirect);

  const diff = useMemo(() => diffRosters(committed, proposed), [committed, proposed]);
  const violations = useMemo(() => validateAll(proposed), [proposed]);
  const byShift = useMemo(() => {
    const map = new Map<string, Violation[]>();
    for (const v of violations) {
      for (const id of v.shiftIds) map.set(id, [...(map.get(id) ?? []), v]);
    }
    return map;
  }, [violations]);

  const dates = weekDates(weekStart);
  const litShifts = new Set(highlight?.shiftIds ?? []);
  const litDates = new Set(highlight?.dates ?? []);
  const litStaff = new Set(highlight?.staffIds ?? []);

  const dropStaff = (shiftId: string, staffId: string) => {
    const edit = assignEdit(proposed, shiftId, staffId, {
      sourceCallId: "direct",
      author: "manager",
    });
    if (edit) commitDirect([edit]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-2 overflow-y-auto px-3 pb-3">
        {dates.map((date) => {
          const dayShifts = Object.values(proposed.shifts)
            .filter((s) => s.date === date)
            .sort((a, b) => a.start - b.start);
          const deleted = [...diff.deletedShiftIds]
            .map((id) => committed.shifts[id])
            .filter((s) => s && s.date === date);
          const required = dayShifts.reduce((n, s) => n + s.headcount, 0);
          const filled = dayShifts.reduce((n, s) => n + Math.min(s.assigned.length, s.headcount), 0);
          const hours = dayShifts.reduce(
            (n, s) => n + durationHours(s.start, s.end) * s.assigned.length,
            0,
          );

          return (
            <section
              key={date}
              aria-label={fmtDateShort(date)}
              className={cx(
                "flex min-w-0 flex-col rounded-apple-lg transition-colors",
                litDates.has(date) && "lit bg-orange-soft",
              )}
            >
              <header className="sticky top-0 z-10 mb-2 rounded-apple-lg border border-hairline material px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-1.5">
                  <h3
                    className={cx(
                      "text-[13px] font-semibold",
                      isWeekend(date) ? "text-accent" : "text-label",
                    )}
                  >
                    {fmtDateShort(date)}
                  </h3>
                  <span className="shrink-0 text-[10px] tabular-nums text-label-3">
                    {hours.toFixed(0)}h
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter
                    value={filled}
                    max={required}
                    tone={filled === required ? "green" : "orange"}
                    label={`${filled} of ${required} slots filled on ${date}`}
                  />
                </div>
                <p className="mt-1 text-[10px] tabular-nums text-label-3">
                  {filled}/{required} staffed
                </p>
              </header>

              <div className="flex flex-col gap-1.5">
                {dayShifts.map((shift) => (
                  <ShiftCard
                    key={shift.id}
                    shift={shift}
                    selected={selection.shiftId === shift.id}
                    lit={litShifts.has(shift.id)}
                    isNew={diff.createdShiftIds.has(shift.id)}
                    changed={diff.changedShiftIds.has(shift.id)}
                    added={diff.added.get(shift.id)}
                    removed={diff.removed.get(shift.id)}
                    litStaff={litStaff}
                    violations={byShift.get(shift.id) ?? []}
                    onSelect={() => select({ ...selection, shiftId: shift.id })}
                    onSelectStaff={(staffId) => select({ ...selection, staffId })}
                    onDropStaff={(staffId) => dropStaff(shift.id, staffId)}
                    onRemoveStaff={(staffId) => {
                      const edit = unassignEdit(proposed, shift.id, staffId, {
                        sourceCallId: "direct",
                        author: "manager",
                      });
                      if (edit) commitDirect([edit]);
                    }}
                  />
                ))}
                {deleted.map((shift) => (
                  <div
                    key={shift.id}
                    className="proposed-remove rounded-apple border p-2 text-[11px] text-label-2"
                  >
                    <span className="strike">
                      {fmtTime(shift.start)}–{fmtTime(shift.end)} {ROLE_LABEL[shift.role]}
                    </span>
                    <p className="mt-0.5 text-[10px] text-red">proposed for deletion</p>
                  </div>
                ))}
                {dayShifts.length === 0 && deleted.length === 0 && (
                  <p className="rounded-apple border border-dashed border-hairline px-2 py-6 text-center text-[11px] text-label-3">
                    closed
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {highlight?.note && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <p className="rise flex items-center gap-2 rounded-full border border-hairline material-thick px-3.5 py-1.5 text-xs font-medium text-label shadow-float">
            <span className="text-purple">
              <Icon path={ICONS.sparkle} size={13} />
            </span>
            {highlight.note}
          </p>
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-3 border-t border-hairline px-4 py-2 text-[11px] text-label-2">
        <span className="tabular-nums">
          {Math.round(coveragePercent(proposed) * 100)}% coverage
        </span>
        <span className="h-3 w-px bg-hairline" />
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-dashed border-purple bg-purple-soft" />
          proposed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm border border-dashed border-red bg-red-soft" />
          being removed
        </span>
        <span className="ml-auto text-label-3">Drag a name from the left onto a shift</span>
      </footer>
    </div>
  );
}

function ShiftCard({
  shift,
  selected,
  lit,
  isNew,
  changed,
  added,
  removed,
  litStaff,
  violations,
  onSelect,
  onSelectStaff,
  onDropStaff,
  onRemoveStaff,
}: {
  shift: Shift;
  selected: boolean;
  lit: boolean;
  isNew: boolean;
  changed: boolean;
  added?: Set<string>;
  removed?: Set<string>;
  litStaff: Set<string>;
  violations: Violation[];
  onSelect: () => void;
  onSelectStaff: (staffId: string) => void;
  onDropStaff: (staffId: string) => void;
  onRemoveStaff: (staffId: string) => void;
}) {
  const roster = useStore(previewRoster);
  const committed = useStore((s) => s.roster);
  const short = shift.headcount - shift.assigned.length;
  const hard = violations.filter((v) => v.severity === "hard" && v.ruleId !== "coverage_met");
  const soft = violations.filter((v) => v.severity === "soft");
  const removedList = [...(removed ?? [])];

  return (
    <article
      onClick={onSelect}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/rota-staff")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const staffId = e.dataTransfer.getData("text/rota-staff");
        if (staffId) {
          e.preventDefault();
          onDropStaff(staffId);
        }
      }}
      className={cx(
        "group cursor-pointer rounded-apple border bg-raised p-2 transition-all duration-150 hover:shadow-card",
        "border-hairline",
        isNew && "proposed",
        changed && "proposed",
        lit && "lit",
        selected && "ring-2 ring-accent",
        hard.length > 0 && !isNew && "border-red/50",
        hard.length === 0 && short > 0 && !isNew && "border-orange/35",
      )}
      aria-label={`${fmtTime(shift.start)} to ${fmtTime(shift.end)} ${ROLE_LABEL[shift.role]}, ${shift.assigned.length} of ${shift.headcount} staffed`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold tabular-nums text-label">
          {fmtTime(shift.start)}–{fmtTime(shift.end)}
        </span>
        {hard.length > 0 && (
          <span className="text-red" title={hard.map((v) => v.message).join("\n")}>
            <Icon path={ICONS.alert} size={12} />
          </span>
        )}
        {hard.length === 0 && soft.length > 0 && (
          <span className="text-orange" title={soft.map((v) => v.message).join("\n")}>
            <Icon path={ICONS.alert} size={12} />
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1">
        <RoleChip role={shift.role} short />
        {shift.isClosing && <span className="text-[9px] text-label-3">close</span>}
        {shift.isOpening && <span className="text-[9px] text-label-3">open</span>}
        {shift.status === "published" && (
          <span className="ml-auto text-green" title="Published to staff">
            <Icon path={ICONS.check} size={11} />
          </span>
        )}
      </div>

      <ul className="mt-1.5 flex flex-col gap-1">
        {shift.assigned.map((staffId) => {
          const person = roster.staff[staffId];
          if (!person) return null;
          const isAdded = added?.has(staffId);
          return (
            <li
              key={staffId}
              className={cx(
                "flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[11px]",
                isAdded && "proposed border",
                litStaff.has(staffId) && "bg-orange-soft",
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectStaff(staffId);
                }}
                className="flex min-w-0 items-center gap-1.5 text-left"
              >
                <Avatar person={person} size={16} />
                <span className="truncate text-label">{person.name.split(" ")[0]}</span>
              </button>
              {isAdded && <span className="ml-auto text-[9px] font-semibold text-purple">new</span>}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveStaff(staffId);
                }}
                aria-label={`Remove ${person.name} from this shift`}
                className={cx(
                  "ml-auto text-label-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red",
                  isAdded && "ml-1",
                )}
              >
                <Icon path={ICONS.x} size={11} />
              </button>
            </li>
          );
        })}

        {removedList.map((staffId) => {
          const person = committed.staff[staffId] ?? roster.staff[staffId];
          if (!person) return null;
          return (
            <li
              key={`rm-${staffId}`}
              className="proposed-remove flex items-center gap-1.5 rounded-md border px-1 py-0.5 text-[11px]"
            >
              <Avatar person={person} size={16} />
              <span className="strike truncate">{person.name.split(" ")[0]}</span>
              <span className="ml-auto text-[9px] font-semibold text-red">off</span>
            </li>
          );
        })}

        {Array.from({ length: Math.max(0, short) }).map((_, i) => (
          <li
            key={`gap-${i}`}
            className="flex items-center gap-1.5 rounded-md border border-dashed border-orange/50 bg-orange-soft px-1 py-0.5 text-[10px] font-medium text-orange"
          >
            <Icon path={ICONS.plus} size={11} />
            unfilled
          </li>
        ))}
      </ul>
    </article>
  );
}

export function ViolationsStrip() {
  const proposed = useStore(previewRoster);
  const setHighlight = useStore((s) => s.setHighlight);
  const select = useStore((s) => s.select);
  const violations = useMemo(() => validateAll(proposed), [proposed]);
  const unfilled = violations.filter((v) => v.ruleId === "coverage_met");
  const hard = violations.filter((v) => v.severity === "hard" && v.ruleId !== "coverage_met");
  const soft = violations.filter((v) => v.severity === "soft");
  // Unfilled slots first, then real breaches, then soft issues -- the order a
  // manager actually works in.
  const ranked = [...hard, ...unfilled, ...soft];

  if (violations.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-hairline bg-green-soft px-4 py-2 text-xs font-medium text-green">
        <Icon path={ICONS.check} size={14} />
        Every rule satisfied — this week is legal, covered and evenly spread.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto border-b border-hairline bg-raised px-4 py-2">
      <Badge tone={unfilled.length ? "warn" : "good"}>
        {unfilled.length} unfilled
      </Badge>
      <Badge tone={hard.length ? "bad" : "good"}>
        {hard.length} rule {hard.length === 1 ? "breach" : "breaches"}
      </Badge>
      <Badge tone={soft.length ? "warn" : "good"}>{soft.length} soft</Badge>
      <span className="h-3.5 w-px shrink-0 bg-hairline" />
      <div className="flex min-w-0 items-center gap-1.5">
        {ranked.slice(0, 4).map((v, i) => (
          <button
            key={`${v.ruleId}-${i}`}
            onClick={() => {
              setHighlight({
                staffIds: v.staffId ? [v.staffId] : [],
                shiftIds: v.shiftIds,
                dates: v.date ? [v.date] : [],
                note: v.message.slice(0, 100),
              });
              if (v.shiftIds[0]) select({ shiftId: v.shiftIds[0] });
            }}
            title={v.message}
            className={cx(
              "max-w-[26ch] shrink-0 truncate rounded-md px-2 py-1 text-[11px] transition-colors hover:brightness-95",
              v.severity === "hard" && v.ruleId !== "coverage_met"
                ? "bg-red-soft text-red"
                : "bg-orange-soft text-orange",
            )}
          >
            {v.message}
          </button>
        ))}
        {ranked.length > 4 && (
          <span className="shrink-0 text-[11px] text-label-3">+{ranked.length - 4} more</span>
        )}
      </div>
    </div>
  );
}
