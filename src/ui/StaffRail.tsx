import { useMemo, useState } from "react";
import { ROLES, ROLE_LABEL } from "../types";
import { fairnessReport, validateAll } from "../engine/evaluate";
import { weeklyHours } from "../engine/rules";
import { previewRoster, useStore } from "../store/store";
import { Avatar, Badge, Icon, ICONS, Meter, RoleChip, cx } from "./bits";

export function StaffRail() {
  const roster = useStore(previewRoster);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const highlight = useStore((s) => s.highlight);
  const [filter, setFilter] = useState<"all" | (typeof ROLES)[number]>("all");

  const report = useMemo(() => fairnessReport(roster), [roster]);
  const violations = useMemo(() => validateAll(roster), [roster]);
  const litStaff = new Set(highlight?.staffIds ?? []);

  const people = Object.values(roster.staff)
    .filter((p) => filter === "all" || p.roles.includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <div className="flex flex-wrap gap-1">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All {Object.keys(roster.staff).length}
          </FilterPill>
          {ROLES.map((role) => (
            <FilterPill key={role} active={filter === role} onClick={() => setFilter(role)}>
              {ROLE_LABEL[role]}
            </FilterPill>
          ))}
        </div>
      </div>

      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {people.map((person) => {
          const hours = weeklyHours(roster, person.id);
          const row = report.rows.find((r) => r.staffId === person.id);
          const mine = violations.filter((v) => v.staffId === person.id);
          const hard = mine.filter((v) => v.severity === "hard").length;
          const soft = mine.length - hard;
          const selected = selection.staffId === person.id;

          return (
            <li key={person.id}>
              <div
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/rota-staff", person.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => select({ ...selection, staffId: selected ? undefined : person.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    select({ ...selection, staffId: selected ? undefined : person.id });
                  }
                }}
                className={cx(
                  "w-full cursor-grab rounded-apple border p-2.5 text-left transition-all duration-150 active:cursor-grabbing",
                  selected
                    ? "border-accent/40 bg-accent-soft"
                    : "border-hairline bg-raised hover:bg-hover",
                  litStaff.has(person.id) && "lit bg-orange-soft",
                )}
              >
                <div className="flex items-center gap-2">
                  <Avatar person={person} size={28} ring={selected} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-[13px] font-medium text-label">{person.name}</p>
                      {person.isMinor && <Badge tone="warn">17</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {person.roles.slice(0, 2).map((role) => (
                        <RoleChip key={role} role={role} short />
                      ))}
                      <span className="text-[10px] text-label-3">
                        {person.contract.replace("_", "-")}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cx(
                        "text-[13px] font-semibold tabular-nums",
                        hours > person.maxWeeklyHours
                          ? "text-red"
                          : hours > person.targetWeeklyHours
                            ? "text-orange"
                            : "text-label",
                      )}
                    >
                      {hours.toFixed(1)}
                      <span className="text-[10px] font-normal text-label-3">
                        /{person.targetWeeklyHours}h
                      </span>
                    </p>
                    {(hard > 0 || soft > 0) && (
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px]">
                        {hard > 0 && <span className="font-semibold text-red">{hard} hard</span>}
                        {soft > 0 && <span className="text-orange">{soft} soft</span>}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-2">
                  <Meter
                    value={hours}
                    max={person.targetWeeklyHours}
                    tone={hours >= person.targetWeeklyHours * 0.85 ? "green" : "orange"}
                    label={`${person.name}: ${hours.toFixed(1)} of ${person.targetWeeklyHours} contracted hours`}
                  />
                </div>

                {row && (
                  <div className="mt-1.5 flex items-center gap-2.5 text-[10px] tabular-nums text-label-3">
                    <span>{row.shifts} shifts</span>
                    <span>{row.weekendShifts} wknd</span>
                    <span>{row.closingShifts} close</span>
                    {person.timeOff.some((t) => t.status === "pending") && (
                      <span className="ml-auto flex items-center gap-1 font-medium text-orange">
                        <Icon path={ICONS.clock} size={10} />
                        request
                      </span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-accent text-accent-label" : "bg-inset text-label-2 hover:text-label",
      )}
    >
      {children}
    </button>
  );
}
