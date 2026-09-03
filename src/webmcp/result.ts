import type { Candidate, Violation } from "../types";
import { ROLE_LABEL } from "../types";
import type { Roster } from "../engine/rules";
import { fmtDateShort, fmtTime } from "../engine/time";

/**
 * Tool results follow the MCP content-block shape the WebMCP explainer uses,
 * with a `structuredContent` sibling for agents that would rather parse than
 * read prose.
 *
 * The text half matters more than it looks. It is what the model actually
 * reasons over and what it quotes back to the manager, so every result here is
 * written as something a person would be happy to read out loud -- not a JSON
 * dump the model has to translate.
 */
export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export function result(text: string, structuredContent?: unknown): ToolResult {
  return structuredContent === undefined
    ? { content: [{ type: "text", text }] }
    : { content: [{ type: "text", text }], structuredContent };
}

export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export function resultText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  const maybe = value as ToolResult;
  if (Array.isArray(maybe?.content)) {
    return maybe.content
      .filter((c) => c?.type === "text")
      .map((c) => c.text)
      .join("\n");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* -- formatters ------------------------------------------------------------ */

export function money(roster: Roster, n: number): string {
  return `${roster.venue.currency}${Math.round(n).toLocaleString("en")}`;
}

export function describeViolations(violations: Violation[], limit = 12): string {
  if (violations.length === 0) return "No rule violations.";
  const hard = violations.filter((v) => v.severity === "hard");
  const soft = violations.filter((v) => v.severity === "soft");
  const lines: string[] = [];
  lines.push(
    `${hard.length} hard breach${hard.length === 1 ? "" : "es"} and ${soft.length} soft issue${soft.length === 1 ? "" : "s"}.`,
  );
  for (const v of violations.slice(0, limit)) {
    lines.push(`- [${v.severity}] ${v.message} (rule: ${v.ruleId})`);
  }
  if (violations.length > limit) lines.push(`- ...and ${violations.length - limit} more.`);
  return lines.join("\n");
}

export function describeCandidates(candidates: Candidate[], limit = 6): string {
  if (candidates.length === 0) return "Nobody can legally take this shift.";
  return candidates
    .slice(0, limit)
    .map((c) => {
      const bits: string[] = [`score ${c.score}`];
      if (c.overtimeHours > 0) bits.push(`${c.overtimeHours.toFixed(1)}h overtime`);
      bits.push(`costs ${c.costForShift.toFixed(2)}`);
      if (c.reasons.length) bits.push(c.reasons.join("; "));
      const concerns = c.concerns.length
        ? `\n    concerns: ${c.concerns.map((x) => x.message).join(" ")}`
        : "";
      return `- ${c.name} (${c.staffId}) - ${bits.join(", ")}${concerns}`;
    })
    .join("\n");
}

export function describeShift(roster: Roster, shiftId: string): string {
  const s = roster.shifts[shiftId];
  if (!s) return `unknown shift ${shiftId}`;
  const names = s.assigned.map((id) => roster.staff[id]?.name ?? id);
  const tags = [s.isOpening ? "opening" : null, s.isClosing ? "closing" : null]
    .filter(Boolean)
    .join("/");
  return `${s.id} | ${fmtDateShort(s.date)} ${fmtTime(s.start)}-${fmtTime(s.end)} | ${ROLE_LABEL[s.role]}${tags ? ` (${tags})` : ""} | ${s.assigned.length}/${s.headcount} filled${names.length ? `: ${names.join(", ")}` : ""} | ${s.status}`;
}
