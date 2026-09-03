/**
 * Browser smoke test.
 *
 * Drives the running app through a real Chrome and asserts the things that
 * only break in a browser: that the polyfill installs, that tools register,
 * that `getTools()` / `executeTool()` round-trip, that a write tool stages an
 * edit rather than committing one, that `toolchange` fires when the selection
 * changes, and that the declarative publish form is synthesised into a tool.
 *
 *   node scripts/smoke.mjs [url]
 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5178/";
const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let failures = 0;
let checks = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 1000 });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForSelector("#publish-form", { timeout: 15000 });

console.log("\nWebMCP surface");
const api = await page.evaluate(() => ({
  hasModelContext: typeof document.modelContext === "object",
  hasRegister: typeof document.modelContext?.registerTool === "function",
  hasGetTools: typeof document.modelContext?.getTools === "function",
  hasExecute: typeof document.modelContext?.executeTool === "function",
  isEventTarget: typeof document.modelContext?.addEventListener === "function",
}));
check("document.modelContext exists", api.hasModelContext);
check("registerTool present", api.hasRegister);
check("getTools present", api.hasGetTools);
check("executeTool present", api.hasExecute);
check("modelContext is an EventTarget", api.isEventTarget);

const tools = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  return list.map((t) => ({
    name: t.name,
    hasDescription: typeof t.description === "string" && t.description.length > 30,
    hasSchema: Boolean(t.inputSchema),
    origin: t.origin,
    readOnly: Boolean(t.annotations?.readOnlyHint),
  }));
});
console.log(`  ${tools.length} tools registered`);
check("registers a substantial tool set", tools.length >= 20, `${tools.length}`);
check("every tool has a real description", tools.every((t) => t.hasDescription));
check("every tool reports an origin", tools.every((t) => t.origin.startsWith("http")));
check(
  "read tools are annotated readOnlyHint",
  tools.find((t) => t.name === "validate_schedule")?.readOnly === true,
);
check(
  "write tools are not annotated readOnlyHint",
  tools.find((t) => t.name === "assign_staff")?.readOnly === false,
);
check(
  "the declarative form became a tool",
  tools.some((t) => t.name === "publish_schedule"),
  tools.map((t) => t.name).join(","),
);
check(
  "no tool that commits or approves is exposed",
  !tools.some((t) => /^(commit|approve|apply)_/.test(t.name)),
  tools.filter((t) => /^(commit|approve|apply)_/.test(t.name)).map((t) => t.name).join(","),
);

console.log("\nRead tool round-trip");
const overview = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const tool = list.find((t) => t.name === "get_schedule_overview");
  const out = await document.modelContext.executeTool(tool, {});
  return out.content[0].text;
});
console.log(`  ${overview.split("\n")[0]}`);
check("get_schedule_overview returns prose", overview.includes("Meridian Coffee"));
check("overview reports coverage", /Coverage: \d+%/.test(overview));
check("overview reports cost against budget", overview.includes("budget"));

console.log("\nArgument coercion");
const coerced = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const tool = list.find((t) => t.name === "get_change_history");
  // A model would plausibly send the number as a string.
  const out = await document.modelContext.executeTool(tool, { limit: "3" });
  return out.content.map((c) => c.text).join("\n");
});
check("coerces a stringified number", !/Invalid arguments/.test(coerced), coerced.slice(0, 120));

console.log("\nFuzzy reference resolution");
const fuzzy = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const tool = list.find((t) => t.name === "get_staff_details");
  const good = await document.modelContext.executeTool(tool, { staff: "Marco" });
  const bad = await document.modelContext.executeTool(tool, { staff: "Nobody McNobody" });
  return {
    good: good.content[0].text,
    bad: bad.content[0].text,
  };
});
check("resolves a first name", fuzzy.good.startsWith("Marco Rossi"));
check(
  "an unknown name returns the valid options rather than throwing",
  fuzzy.bad.includes("No staff member matches") && fuzzy.bad.includes("Aisha"),
  fuzzy.bad.slice(0, 160),
);

console.log("\nWrites stage, they do not commit");
const staging = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const gapsTool = list.find((t) => t.name === "get_coverage_gaps");
  const before = (await document.modelContext.executeTool(gapsTool, {})).content[0].text;
  const fill = list.find((t) => t.name === "fill_open_shifts");
  const out = await document.modelContext.executeTool(fill, { objective: "balanced" });
  const after = (await document.modelContext.executeTool(gapsTool, {})).content[0].text;
  return { before, result: out.content[0].text, after };
});
check("fill_open_shifts stages a plan", /Filled \d+ open slot/.test(staging.result), staging.result.slice(0, 200));
check(
  "it says nothing is committed",
  /not committed|approve/i.test(staging.result),
);
check(
  "subsequent read tools see the staged state",
  staging.before !== staging.after,
  "the proposal was invisible to later reads",
);

const proposalUi = await page.evaluate(() => {
  const bar = [...document.querySelectorAll("p")].find((p) =>
    /change(s)? selected/.test(p.textContent ?? ""),
  );
  return bar?.textContent ?? null;
});
check("the review bar appears in the UI", proposalUi !== null, "no proposal bar rendered");
console.log(`  "${proposalUi}"`);

console.log("\nRefusals are specific");
const refusal = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const shifts = await document.modelContext.executeTool(
    list.find((t) => t.name === "list_shifts"),
    { role: "baker" },
  );
  const id = /\[?([\d-]+-baker-\d+)/.exec(shifts.content[0].text)?.[1];
  const out = await document.modelContext.executeTool(
    list.find((t) => t.name === "assign_staff"),
    { staff: "Liam", shift_id: id },
  );
  return out.content[0].text;
});
check(
  "refuses an uncertified assignment with the rule that blocks it",
  /Refused/.test(refusal) && /certified/.test(refusal),
  refusal.slice(0, 200),
);

console.log("\ntoolchange and contextual tools");
const contextual = await page.evaluate(async () => {
  const before = (await document.modelContext.getTools()).map((t) => t.name);
  let fired = 0;
  const onChange = () => (fired += 1);
  document.modelContext.addEventListener("toolchange", onChange);

  const focus = (await document.modelContext.getTools()).find((t) => t.name === "focus_view");
  const shifts = await document.modelContext.executeTool(
    (await document.modelContext.getTools()).find((t) => t.name === "list_shifts"),
    { role: "shift_lead" },
  );
  const id = /([\d-]+-shift_lead-\d+)/.exec(shifts.content[0].text)?.[1];
  await document.modelContext.executeTool(focus, { select_shift_id: id });
  await new Promise((r) => setTimeout(r, 400));

  const after = (await document.modelContext.getTools()).map((t) => t.name);
  document.modelContext.removeEventListener("toolchange", onChange);
  return { before, after, fired, added: after.filter((n) => !before.includes(n)) };
});
check("toolchange fired", contextual.fired > 0, `${contextual.fired}`);
check(
  "selecting a shift registers selection-scoped tools",
  contextual.added.includes("selected_shift_cover_options") &&
    contextual.added.includes("fill_selected_shift"),
  `added: ${contextual.added.join(", ")}`,
);

console.log("\nThe declarative form fills but does not submit");
const declarative = await page.evaluate(async () => {
  const list = await document.modelContext.getTools();
  const tool = list.find((t) => t.name === "publish_schedule");
  const schema = tool.inputSchema;
  const out = await document.modelContext.executeTool(tool, {
    message: "Thursday cover has changed.",
    notify: "leads",
    acknowledged: true,
  });
  const form = document.querySelector("#publish-form");
  await new Promise((r) => setTimeout(r, 300));
  return {
    schemaKeys: Object.keys(schema.properties ?? {}),
    text: out.content[0].text,
    messageValue: form.querySelector('[name="message"]').value,
    notifyValue: form.querySelector('[name="notify"]').value,
    checked: form.querySelector('[name="acknowledged"]').checked,
    submitFocused:
      document.activeElement === form.querySelector('button[type="submit"]'),
    published: document.body.textContent.includes("Published 49 shifts"),
  };
});
check(
  "schema was synthesised from the form controls",
  ["message", "notify", "acknowledged"].every((k) => declarative.schemaKeys.includes(k)),
  declarative.schemaKeys.join(","),
);
check("the agent filled the textarea", declarative.messageValue.includes("Thursday cover"));
check("the agent filled the select", declarative.notifyValue === "leads");
check("the agent ticked the checkbox", declarative.checked === true);
check("it reports that it did NOT submit", /NOT submitted/.test(declarative.text));
check("the submit button is focused for the human", declarative.submitFocused);
check("nothing was actually published", declarative.published === false);

console.log("\nConsole hygiene");
const realErrors = consoleErrors.filter(
  (e) => !/favicon|Download the React DevTools/i.test(e),
);
check("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "docs/screenshot-week.png", fullPage: false });
console.log("\n  screenshot written to docs/screenshot-week.png");

console.log(`\n${checks - failures}/${checks} checks passed`);
await browser.close();
if (failures > 0) process.exit(1);
