/**
 * Generates TOOLS.md from the actual tool definitions.
 *
 * Hand-written API docs drift. This reads the same objects the app registers
 * with `document.modelContext`, so the reference cannot disagree with the code.
 *
 *   npm run tools:doc
 */
import { writeFileSync } from "node:fs";
import { allKnownTools } from "../src/webmcp/registry";
import type { JsonSchema } from "../src/webmcp/schema";

const GROUP_ORDER = ["read", "write", "view", "meta"] as const;

const GROUP_HEADING: Record<string, string> = {
  read: "Read tools",
  write: "Write tools — these stage, they never commit",
  view: "View tools — steering the manager's screen",
  meta: "Meta tools",
};

const GROUP_BLURB: Record<string, string> = {
  read:
    "Every one is annotated `readOnlyHint: true`. These are how the agent learns the state of the week, and how it checks its own work: the answers come from the venue's own rule engine, not from the model's reasoning about labour law.",
  write:
    "Each of these appends reversible `Edit`s to an open proposal. None of them changes the published rota. There is no `commit`, `approve` or `publish` tool anywhere in the imperative surface — that is the point of the project, not an oversight.",
  view:
    "The tools a backend MCP server structurally cannot have. The agent and the manager are looking at the same pixels, so the agent can put the right week on screen and light up the shifts it is talking about.",
  meta: "Proposal bookkeeping and provenance.",
};

function renderType(schema: JsonSchema): string {
  if (schema.enum) return schema.enum.map((e) => `\`${JSON.stringify(e)}\``).join(" \\| ");
  if (schema.type === "array") {
    return `array of ${schema.items?.type ?? "any"}`;
  }
  return schema.type ?? "any";
}

function renderParams(schema: JsonSchema | undefined): string {
  const properties = schema?.properties ?? {};
  const names = Object.keys(properties);
  if (names.length === 0) return "_No parameters._\n";
  const required = new Set(schema?.required ?? []);
  const rows = names.map((name) => {
    const property = properties[name];
    const bits = [
      `\`${name}\``,
      renderType(property),
      required.has(name) ? "**yes**" : "no",
      [
        property.description ?? "",
        property.default !== undefined ? `Default \`${JSON.stringify(property.default)}\`.` : "",
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\|/g, "\\|"),
    ];
    return `| ${bits.join(" | ")} |`;
  });
  return ["| Parameter | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

const tools = allKnownTools();
const lines: string[] = [];

lines.push("# Rota's WebMCP tool surface");
lines.push("");
lines.push(
  "> Generated from the source by `npm run tools:doc`. Do not edit by hand — edit the tool definitions in [`src/webmcp/`](src/webmcp/) instead.",
);
lines.push("");
lines.push(
  `Rota registers **${tools.length} imperative tools** plus **one declarative tool** synthesised from an HTML \`<form>\`. Not all of them are registered at once: several appear only while something is selected or a proposal is open, and every appearance or withdrawal fires \`toolchange\`.`,
);
lines.push("");

lines.push("## At a glance");
lines.push("");
lines.push("| Tool | Group | Read-only | Registered |");
lines.push("| --- | --- | --- | --- |");
for (const group of GROUP_ORDER) {
  for (const tool of tools.filter((t) => t.group === group)) {
    lines.push(
      `| [\`${tool.name}\`](#${tool.name.replace(/_/g, "_")}) | ${group} | ${tool.annotations?.readOnlyHint ? "yes" : "no"} | ${tool.contextual ? "contextual" : "always"} |`,
    );
  }
}
lines.push("| `publish_schedule` | declarative | no | always |");
lines.push("");

for (const group of GROUP_ORDER) {
  const inGroup = tools.filter((t) => t.group === group);
  if (inGroup.length === 0) continue;
  lines.push(`## ${GROUP_HEADING[group]}`);
  lines.push("");
  lines.push(GROUP_BLURB[group]);
  lines.push("");
  for (const tool of inGroup) {
    lines.push(`### \`${tool.name}\``);
    lines.push("");
    const badges = [
      tool.annotations?.readOnlyHint ? "`readOnlyHint: true`" : "mutating (stages only)",
      tool.contextual ? `**${tool.contextual}**` : null,
    ].filter(Boolean);
    lines.push(badges.join(" · "));
    lines.push("");
    lines.push(tool.description);
    lines.push("");
    lines.push(renderParams(tool.inputSchema));
    lines.push("");
  }
}

lines.push("## The declarative tool");
lines.push("");
lines.push(
  "Publishing the rota is not an imperative tool. It is an HTML `<form>` carrying the [declarative API](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md) attributes, and its input schema is compiled from the form's own controls:",
);
lines.push("");
lines.push("```html");
lines.push('<form');
lines.push('  id="publish-form"');
lines.push('  toolname="publish_schedule"');
lines.push('  tooldescription="Fills in the rota publishing form for the currently displayed week…"');
lines.push('>');
lines.push('  <textarea name="message" toolparamdescription="A short note sent to the team…"></textarea>');
lines.push('  <select name="notify" toolparamdescription="Who receives the notification…">…</select>');
lines.push('  <input type="checkbox" name="acknowledged" required');
lines.push('         toolparamdescription="The manager confirms they have reviewed the rota." />');
lines.push('  <button type="submit">Publish to the team</button>');
lines.push("</form>");
lines.push("```");
lines.push("");
lines.push(
  "Note what is **absent**: `toolautosubmit`. Per the spec, that means an agent may fill this form but may not submit it — the browser focuses the submit button and waits for a human. So the single most consequential action in the app, telling fourteen people when they are working, is reachable by an agent only as far as the button.",
);
lines.push("");
lines.push("## Deliberate omissions");
lines.push("");
lines.push(
  "There is no tool to commit a proposal, approve a change, publish a rota, disable a statutory rule, or delete a person. Some of those are missing because they are dangerous; the first three are missing because they are the human's job. `set_rule` will refuse to switch off a statutory rule even if asked directly, and says why.",
);
lines.push("");

writeFileSync("TOOLS.md", lines.join("\n"), "utf8");
console.log(`TOOLS.md written: ${tools.length} imperative tools + 1 declarative`);
