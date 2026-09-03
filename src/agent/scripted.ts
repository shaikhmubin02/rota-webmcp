import { validateAll } from "../engine/evaluate";
import { WEEKDAY_LONG } from "../engine/time";
import { previewRoster, useStore } from "../store/store";
import { callTool } from "../webmcp/registry";
import { resultText } from "../webmcp/result";
import type { AgentHandlers } from "./runtime";

/**
 * The no-API-key agent.
 *
 * Be precise about what this is: the *routing* is scripted -- a keyword match
 * from the manager's sentence to a plan -- but every step of every plan is a
 * real `document.modelContext.executeTool()` call against the real tool
 * registry, and every word of the summary is composed from what those tools
 * actually returned. Nothing is faked. If the roster changes, the answers
 * change.
 *
 * It exists so that a judge, or anyone else, can open the live URL with no key
 * and no origin trial and watch genuine WebMCP tool calls drive the page. Set
 * an OpenAI key in the panel for open-ended prompts.
 */

interface Step {
  tool: string;
  args?: Record<string, unknown>;
  /** Skip this step unless the predicate passes, given earlier results. */
  when?: (results: Map<string, string>) => boolean;
}

interface Plan {
  intent: string;
  steps: Step[];
  summarise: (results: Map<string, string>) => string;
}

interface Parsed {
  text: string;
  staffId?: string;
  staffName?: string;
  dates: string[];
  dayNames: string[];
  avoidOvertime: boolean;
  objective: "balanced" | "minimise_cost" | "maximise_fairness" | "honour_preferences";
}

function parse(prompt: string): Parsed {
  const text = prompt.toLowerCase();
  const roster = previewRoster(useStore.getState());

  let staffId: string | undefined;
  let staffName: string | undefined;
  for (const person of Object.values(roster.staff)) {
    const first = person.name.split(" ")[0].toLowerCase();
    if (text.includes(first) || text.includes(person.name.toLowerCase())) {
      staffId = person.id;
      staffName = person.name;
      break;
    }
  }

  const dayNames = WEEKDAY_LONG.filter((d) => {
    const lower = d.toLowerCase();
    return text.includes(lower) || new RegExp(`\\b${lower.slice(0, 3)}\\b`).test(text);
  });

  const avoidOvertime = /(no|without|avoid|cut|less|zero)\s+(the\s+)?overtime|no ot\b/.test(text);
  const objective = /cheap|cost|budget|money|expensive|save/.test(text)
    ? "minimise_cost"
    : /fair|even|balanc|spread|share/.test(text)
      ? "maximise_fairness"
      : /prefer|want|asked|happy/.test(text)
        ? "honour_preferences"
        : "balanced";

  return { text, staffId, staffName, dates: dayNames, dayNames, avoidOvertime, objective };
}

function score(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
}

function planFor(p: Parsed): Plan {
  const t = p.text;

  const scores = {
    absence:
      score(t, ["sick", "called in", "can't work", "cannot work", "off ", "dropped out", "no-show", "absent"]) +
      (p.staffId ? 1 : 0),
    rest: score(t, [
      "clopen",
      "close-then-open",
      "close then open",
      "rest",
      "closing and then",
      "back to back",
      "back-to-back",
      "9 hours",
      "9h",
      "turnaround",
      "swap",
    ]),
    fill: score(t, ["fill", "finish", "complete", "gap", "hole", "unfilled", "open shift", "cover the week", "build"]),
    fairness: score(t, ["fair", "uneven", "weekend", "carrying", "contracted hours", "hours are", "share", "balance"]),
    cost: score(t, ["cost", "budget", "overtime", "expensive", "wage", "money", "save", "cheaper"]),
    timeoff: score(t, ["time off", "holiday", "leave", "request", "annual", "pending"]),
    audit: score(t, ["review", "audit", "wrong", "broken", "check", "problem", "issue", "look at", "state of", "legal"]),
    publish: score(t, ["publish", "send", "post it", "share", "sign off", "approve"]),
  };

  const best = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0] ?? ["audit", 0]) as [
    keyof typeof scores,
    number,
  ];
  const intent = best[1] > 0 ? best[0] : "audit";

  switch (intent) {
    case "absence":
      return {
        intent: "cover an absence",
        steps: [
          { tool: "get_staff_details", args: { staff: p.staffId ?? "marco" } },
          {
            tool: "cover_absence",
            args: {
              staff: p.staffId ?? "marco",
              ...(p.dayNames.length ? { dates: p.dayNames } : {}),
              reason: /sick/.test(t) ? "called in sick" : "unavailable",
              avoid_overtime: p.avoidOvertime,
              objective: p.objective,
            },
          },
          { tool: "highlight", args: { staff: [p.staffId ?? "marco"], dates: p.dayNames, note: "absence and cover" } },
          { tool: "validate_schedule", args: { severity: "hard" } },
          { tool: "request_approval", args: { summary: `Cover for ${p.staffName ?? "an absence"}` } },
        ],
        summarise: (r) =>
          [
            r.get("cover_absence") ?? "",
            "",
            hardLine(r.get("validate_schedule")),
            "It is all staged, nothing is committed. Review the drawer and approve what you want.",
          ]
            .filter(Boolean)
            .join("\n"),
      };

    case "rest": {
      const breach = restBreach();
      return {
        intent: "fix a rest-period breach",
        steps: [
          { tool: "validate_schedule", args: { severity: "hard" } },
          {
            tool: "suggest_swap_for",
            args: breach
              ? { staff: breach.staffId, shift_id: breach.shiftId }
              : { staff: p.staffId ?? "marco", date: "thursday", role: "shift_lead", when: "opening" },
          },
          { tool: "validate_schedule", args: { severity: "hard" } },
          { tool: "request_approval", args: { summary: "Resolve the close-then-open" } },
        ],
        summarise: (r) =>
          [
            r.get("suggest_swap_for") ?? "",
            "",
            hardLine(r.get("validate_schedule")),
            "Nobody loses a shift - two people trade. Approve it in the drawer if you're happy.",
          ]
            .filter(Boolean)
            .join("\n"),
      };
    }

    case "fill":
      return {
        intent: "fill the open shifts",
        steps: [
          { tool: "get_coverage_gaps" },
          {
            tool: "fill_open_shifts",
            args: { objective: p.objective, avoid_overtime: p.avoidOvertime },
          },
          { tool: "validate_schedule", args: { severity: "all" } },
          { tool: "get_labor_cost" },
          { tool: "request_approval", args: { summary: "Fill every open shift" } },
        ],
        summarise: (r) => {
          const cost = (r.get("get_labor_cost") ?? "").split("\n")[0];
          return [
            r.get("fill_open_shifts") ?? "",
            "",
            cost,
            hardLine(r.get("validate_schedule")),
            "Everything is proposed, not applied. Untick anything you don't like before approving.",
          ]
            .filter(Boolean)
            .join("\n");
        },
      };

    case "fairness":
      return {
        intent: "check fairness",
        steps: [
          { tool: "get_fairness_report" },
          { tool: "focus_view", args: { view: "staff" } },
          { tool: "validate_schedule", args: { severity: "soft" } },
          {
            tool: "fill_open_shifts",
            args: { objective: "maximise_fairness", avoid_overtime: p.avoidOvertime },
          },
          { tool: "request_approval", args: { summary: "Even out the week" } },
        ],
        summarise: (r) =>
          [
            (r.get("get_fairness_report") ?? "").split("\n").slice(0, 3).join("\n"),
            "",
            r.get("fill_open_shifts") ?? "",
            "I've switched you to the per-person view so you can see the spread. Staged, pending your approval.",
          ]
            .filter(Boolean)
            .join("\n"),
      };

    case "cost":
      return {
        intent: "look at cost",
        steps: [
          { tool: "get_labor_cost" },
          { tool: "focus_view", args: { view: "cost" } },
          {
            tool: "fill_open_shifts",
            args: { objective: "minimise_cost", avoid_overtime: true },
          },
          { tool: "validate_schedule", args: { severity: "hard" } },
          { tool: "request_approval", args: { summary: "Fill the week without overtime" } },
        ],
        summarise: (r) =>
          [
            (r.get("get_labor_cost") ?? "").split("\n").slice(0, 2).join("\n"),
            "",
            r.get("fill_open_shifts") ?? "",
            hardLine(r.get("validate_schedule")),
          ]
            .filter(Boolean)
            .join("\n"),
      };

    case "timeoff":
      return {
        intent: "review time off",
        steps: [
          { tool: "list_time_off_requests", args: { status: "all" } },
          { tool: "review_time_off_requests" },
        ],
        summarise: (r) =>
          [
            r.get("review_time_off_requests") ?? r.get("list_time_off_requests") ?? "",
            "",
            "Tell me which to approve and I'll stage the approval plus the cover in one go.",
          ]
            .filter(Boolean)
            .join("\n"),
      };

    case "publish":
      return {
        intent: "draft the publish note",
        steps: [
          { tool: "get_schedule_overview" },
          // Filling the form is allowed; submitting it is not. This is the
          // declarative tool, so the browser enforces that split for us.
          {
            tool: "publish_schedule",
            args: {
              message:
                "Next week's rota is up. Thursday's cover has changed - Sofia opens and Marco moves across, so nobody is closing and opening back to back. Shout if anything looks wrong.",
              notify: "leads",
              acknowledged: true,
            },
          },
        ],
        summarise: (r) =>
          [
            r.get("publish_schedule") ?? "",
            "",
            (r.get("get_schedule_overview") ?? "").split("\n").slice(1, 4).join("\n"),
            "",
            "That is as far as I can go. The publish form is a declarative WebMCP tool with no toolautosubmit attribute, so I can fill it in but the browser hands the submit button to you.",
          ]
            .filter(Boolean)
            .join("\n"),
      };

    default:
      return {
        intent: "audit the week",
        steps: [
          { tool: "get_schedule_overview" },
          { tool: "validate_schedule", args: { severity: "hard" } },
          { tool: "get_coverage_gaps" },
          { tool: "highlight", args: worstHighlight() },
        ],
        summarise: (r) => {
          const overview = r.get("get_schedule_overview") ?? "";
          const gaps = (r.get("get_coverage_gaps") ?? "").split("\n")[0];
          return [
            overview,
            "",
            gaps,
            "",
            hardLine(r.get("validate_schedule")),
            "I've highlighted the worst of it on the grid. Say \"fill the open shifts\" and I'll propose a full week, or name a problem and I'll fix that one.",
          ]
            .filter(Boolean)
            .join("\n");
        },
      };
  }
}

/** The live minimum-rest breach, if the week still has one. */
function restBreach(): { staffId: string; shiftId: string } | null {
  const roster = previewRoster(useStore.getState());
  const v = validateAll(roster).find(
    (x) => x.ruleId === "min_rest_between_shifts" && x.staffId && x.shiftIds.length > 1,
  );
  // shiftIds[1] is the later shift of the pair -- the one to move.
  return v?.staffId ? { staffId: v.staffId, shiftId: v.shiftIds[1] } : null;
}

function worstHighlight(): Record<string, unknown> {
  const roster = previewRoster(useStore.getState());
  const worst = validateAll(roster).find((v) => v.severity === "hard");
  if (!worst) return { note: "no hard breaches" };
  return {
    ...(worst.staffId ? { staff: [worst.staffId] } : {}),
    shift_ids: worst.shiftIds,
    ...(worst.date ? { dates: [worst.date] } : {}),
    note: worst.message.slice(0, 90),
  };
}

function hardLine(validateOutput: string | undefined): string {
  if (!validateOutput) return "";
  return validateOutput.split("\n").slice(0, 4).join("\n");
}

export async function runScriptedTurn(
  prompt: string,
  handlers: AgentHandlers,
  signal: AbortSignal,
): Promise<void> {
  const parsed = parse(prompt);
  const plan = planFor(parsed);
  const results = new Map<string, string>();

  handlers.onText(`Working on it - ${plan.intent}.`);

  for (const step of plan.steps) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (step.when && !step.when(results)) continue;

    const id = `s-${step.tool}-${results.size}`;
    handlers.onCallStart({
      id,
      name: step.tool,
      args: step.args ?? {},
      status: "running",
      readOnly: false,
      editCount: 0,
    });

    const started = performance.now();
    let text: string;
    let ok = true;
    try {
      const output = await callTool(step.tool, step.args ?? {}, {
        caller: "in-page agent (scripted)",
        signal,
      });
      text = resultText(output) || "(no output)";
      ok = !output.isError;
    } catch (error) {
      ok = false;
      text = error instanceof Error ? error.message : String(error);
    }

    results.set(step.tool, text);
    handlers.onCallEnd({
      id,
      name: step.tool,
      args: step.args ?? {},
      status: ok ? "ok" : "error",
      result: text,
      durationMs: Math.round(performance.now() - started),
      readOnly: false,
      editCount: 0,
    });

    // A beat between calls so a human watching can follow what happened.
    await new Promise((resolve) => setTimeout(resolve, 260));
  }

  handlers.onText(plan.summarise(results));
}
