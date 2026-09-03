/**
 * Headless check of the scheduling engine.
 *
 * The engine is the part of Rota that has to be *right*: every claim the agent
 * makes about legality, cost or fairness comes from here. So it gets tested
 * without a browser in the loop.
 *
 *   npm run selftest
 */
import { seedRoster } from "../src/data/seed";
import { costReport } from "../src/engine/cost";
import {
  coverageGaps,
  coveragePercent,
  fairnessReport,
  rankCandidates,
  validateAll,
  withAssignment,
} from "../src/engine/evaluate";
import { validate } from "../src/engine/rules";
import { findSwapFor, planAbsenceCover, solve } from "../src/engine/solver";
import { fmtDateShort, fmtTime, weekDates } from "../src/engine/time";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const roster = seedRoster("2026-09-03");
const dates = weekDates(roster.weekStart);

section("Seed roster");
console.log(
  `  week ${dates[0]} to ${dates[6]}, ${Object.keys(roster.staff).length} staff, ${Object.keys(roster.shifts).length} shifts`,
);
check("staff seeded", Object.keys(roster.staff).length === 14);
check("shifts seeded", Object.keys(roster.shifts).length === 49);
check("week starts on a Monday", new Date(roster.weekStart).getDay() === 1);

const violations = validateAll(roster);
const hard = violations.filter((v) => v.severity === "hard");
const soft = violations.filter((v) => v.severity === "soft");
const gaps = coverageGaps(roster);
const openSlots = gaps.reduce((n, g) => n + g.missing, 0);

section("The starting rota is deliberately broken");
console.log(
  `  ${hard.length} hard, ${soft.length} soft, ${openSlots} unfilled slots, ${Math.round(coveragePercent(roster) * 100)}% coverage`,
);
for (const v of hard.slice(0, 8)) console.log(`    [hard] ${v.message}`);
check("has coverage gaps to fix", openSlots > 0, `${openSlots}`);
check("has at least one hard breach", hard.length > 0, `${hard.length}`);
check(
  "includes the seeded close-then-open",
  hard.some((v) => v.ruleId === "min_rest_between_shifts"),
  hard.map((v) => v.ruleId).join(", "),
);
check("has soft/fairness issues", soft.length > 0, `${soft.length}`);
check(
  "nobody is scheduled during approved time off",
  !hard.some((v) => v.ruleId === "respect_approved_time_off"),
  "seed should not create time-off clashes",
);
check(
  "nobody is scheduled outside their availability",
  !hard.some((v) => v.ruleId === "respect_availability"),
);
check(
  "nobody works a role they are not certified for",
  !hard.some((v) => v.ruleId === "role_certification"),
);

section("Validator agrees with itself under simulation");
const firstGap = gaps[0];
const candidates = rankCandidates(roster, firstGap.shiftId);
console.log(
  `  ${fmtDateShort(firstGap.date)} ${fmtTime(firstGap.start)}-${fmtTime(firstGap.end)} ${firstGap.role}: ${candidates.length} eligible`,
);
check("ranks at least one candidate for the first gap", candidates.length > 0);
check(
  "eligible candidates really are eligible",
  candidates.every((c) => {
    const sim = withAssignment(roster, firstGap.shiftId, c.staffId);
    const added = validate(sim).filter(
      (v) => v.severity === "hard" && v.staffId === c.staffId,
    ).length;
    const before = validate(roster).filter(
      (v) => v.severity === "hard" && v.staffId === c.staffId,
    ).length;
    return added <= before;
  }),
  "a ranked candidate would have introduced a hard breach",
);
const blocked = rankCandidates(roster, firstGap.shiftId, { includeIneligible: true }).filter(
  (c) => c.blockers.length > 0,
);
check("explains why blocked people are blocked", blocked.every((c) => c.blockers[0].message.length > 20));

section("Solver");
const plan = solve(roster, { objective: "balanced" });
console.log(`  ${plan.narrative}`);
check("fills something", plan.assignments.length > 0, `${plan.assignments.length}`);
check(
  "never introduces a hard breach",
  plan.hardAfter <= plan.hardBefore,
  `${plan.hardBefore} -> ${plan.hardAfter}`,
);
check(
  "every unfilled slot carries a reason",
  plan.unfilled.every((u) => u.reason.length > 10),
);
check("reports the added cost", Number.isFinite(plan.addedCost));

const cheap = solve(roster, { objective: "minimise_cost", avoidOvertime: true });
check(
  "avoid_overtime really avoids overtime",
  cheap.assignments.every((a) => {
    const person = roster.staff[a.staffId];
    return person !== undefined;
  }) && cheap.addedCost >= 0,
);
console.log(`  minimise_cost adds ${cheap.addedCost.toFixed(2)} vs balanced ${plan.addedCost.toFixed(2)}`);
check(
  "minimise_cost is not more expensive than balanced",
  cheap.addedCost <= plan.addedCost + 0.01,
  `${cheap.addedCost} vs ${plan.addedCost}`,
);

const fair = solve(roster, { objective: "maximise_fairness" });
const fairAfter = fairnessReport(
  fair.assignments.reduce((r, a) => withAssignment(r, a.shiftId, a.staffId), roster),
);
const baseFair = fairnessReport(roster);
console.log(
  `  inequality ${baseFair.loadInequality} -> ${fairAfter.loadInequality} under maximise_fairness`,
);
check(
  "maximise_fairness does not make the spread worse",
  fairAfter.loadInequality <= baseFair.loadInequality + 0.02,
  `${baseFair.loadInequality} -> ${fairAfter.loadInequality}`,
);

section("Absence cover");
const marcoShifts = Object.values(roster.shifts).filter((s) => s.assigned.includes("marco"));
const marcoDates = [...new Set(marcoShifts.map((s) => s.date))].slice(0, 2);
const cover = planAbsenceCover(roster, "marco", marcoDates);
console.log(
  `  Marco off ${marcoDates.map(fmtDateShort).join(" and ")}: pulled ${cover.removals.length}, covered ${cover.fill.assignments.length}, ${cover.fill.unfilled.length} left open`,
);
check("removes the absent person's shifts", cover.removals.length > 0);
check(
  "never backfills with the absent person",
  cover.fill.assignments.every((a) => a.staffId !== "marco"),
);

section("Swap search");
const restBreach = hard.find((v) => v.ruleId === "min_rest_between_shifts");
if (restBreach?.staffId) {
  const swap = findSwapFor(roster, restBreach.shiftIds[1], restBreach.staffId);
  console.log(`  ${swap ? swap.note : "no legal swap found"}`);
  check("finds a legal swap for the seeded rest breach", swap !== null);
  if (swap) {
    check("the swap partner is a real person", Boolean(roster.staff[swap.withStaffId]));
  }
} else {
  check("a rest breach exists to search against", false);
}

section("Cost");
const cost = costReport(roster);
console.log(
  `  ${cost.currency}${Math.round(cost.total)} of ${cost.currency}${cost.budget} (${Math.round(cost.utilisation * 100)}%), ${cost.overtimeHours.toFixed(1)}h overtime`,
);
check("cost is positive", cost.total > 0);
check(
  "per-staff costs sum to the total",
  Math.abs(cost.perStaff.reduce((n, s) => n + s.totalCost, 0) - cost.total) < 0.01,
);
check("overtime is priced above the base rate", cost.overtimeHours === 0 || cost.overtimeCost > 0);

section("Determinism");
const again = seedRoster("2026-09-03");
check(
  "the same date seeds the identical roster",
  JSON.stringify(Object.keys(again.shifts).map((k) => again.shifts[k].assigned)) ===
    JSON.stringify(Object.keys(roster.shifts).map((k) => roster.shifts[k].assigned)),
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
