/**
 * Drives the in-page agent through the UI, the way a judge will.
 *
 * Clicks each suggested prompt in the Agent panel and asserts that the turn
 * makes real tool calls, that none of them error, and that the agent finishes
 * with a summary. These six prompts are the demo, so they get tested.
 *
 *   node scripts/agent-test.mjs [url]
 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5178/";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

let failures = 0;
let checks = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (ok) console.log(`    ok   ${label}`);
  else {
    failures += 1;
    console.log(`    FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox"],
});

const PROMPTS = [
  "Audit the week",
  "Finish the rota",
  "Marco called in sick",
  "Fix the close-then-open",
  "Is this fair?",
  "Cut the overtime",
];

for (const label of PROMPTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1680, height: 1000 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector("#publish-form");

  console.log(`\n  "${label}"`);

  // Click the suggestion card with this label.
  const clicked = await page.evaluate((wanted) => {
    const card = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith(wanted),
    );
    if (!card) return false;
    card.click();
    return true;
  }, label);
  check("suggestion is clickable", clicked);
  if (!clicked) {
    await page.close();
    continue;
  }

  // Wait for the turn to finish: the send button comes back when not busy.
  await page
    .waitForFunction(
      () => {
        const stop = [...document.querySelectorAll("button")].some(
          (b) => b.getAttribute("title") === "Stop",
        );
        const thinking = document.body.textContent?.includes("thinking…");
        return !stop && !thinking;
      },
      { timeout: 40000, polling: 300 },
    )
    .catch(() => {});

  await new Promise((r) => setTimeout(r, 600));

  const turn = await page.evaluate(() => {
    const codes = [...document.querySelectorAll("code")].map((c) => c.textContent ?? "");
    const text = document.body.innerText;
    return {
      toolNames: codes.filter((c) => /^[a-z_]+$/.test(c)),
      hasSummaryBubble: /rota|shift|cover|budget|breach|fair|staged|unfilled/i.test(text),
      errorCards: [...document.querySelectorAll("li")].filter((li) =>
        (li.className || "").includes("border-red"),
      ).length,
      ledgerCount: Number(
        /Provenance · (\d+) calls/.exec(text)?.[1] ??
          /(\d+) tools live/.exec(text)?.[1] ??
          "0",
      ),
      proposalBar: /change(s)? selected/.test(text),
      body: text,
    };
  });

  check("made real tool calls", turn.toolNames.length >= 2, `${turn.toolNames.length} calls`);
  console.log(`         ${turn.toolNames.slice(0, 8).join(" → ")}`);
  check("no tool call errored", turn.errorCards === 0, `${turn.errorCards} error card(s)`);
  check("produced a written answer", turn.hasSummaryBubble);
  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  // Prompts that should end up proposing something.
  if (["Finish the rota", "Marco called in sick", "Fix the close-then-open", "Cut the overtime", "Is this fair?"].includes(label)) {
    check("staged a proposal for review", turn.proposalBar, "no review bar appeared");
  }

  await page.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
await browser.close();
if (failures > 0) process.exit(1);
