/**
 * Captures the screenshots used in the README and the submission.
 *
 *   node scripts/shots.mjs [url]
 */
import puppeteer from "puppeteer-core";

const URL = process.argv[2] ?? "http://localhost:5178/";
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});

async function shot(name, { theme, prepare, width = 1728, height = 1040 }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem("rota.theme", t);
  }, theme);
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForSelector("#publish-form");
  await new Promise((r) => setTimeout(r, 400));
  if (prepare) await prepare(page);
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `docs/${name}.png` });
  console.log(`docs/${name}.png`);
  await page.close();
}

const call = (name, args = {}) => async (page) =>
  page.evaluate(
    async (n, a) => {
      const tools = await document.modelContext.getTools();
      const tool = tools.find((t) => t.name === n);
      if (!tool) throw new Error(`missing tool ${n}`);
      return (await document.modelContext.executeTool(tool, a)).content[0].text;
    },
    name,
    args,
  );

// 1. The broken week, untouched.
await shot("01-week-light", { theme: "light" });
await shot("01-week-dark", { theme: "dark" });

// 2. A staged proposal, rendered in place on the grid.
await shot("02-proposal-light", {
  theme: "light",
  prepare: async (page) => {
    await call("fill_open_shifts", { objective: "balanced" })(page);
  },
});

// 3. The review drawer: the consent surface.
await shot("03-review-light", {
  theme: "light",
  prepare: async (page) => {
    await call("fill_open_shifts", { objective: "balanced" })(page);
    await call("request_approval", { summary: "Fill every open shift for next week" })(page);
    await new Promise((r) => setTimeout(r, 300));
  },
});

// 4. The agent pointing at a problem on the manager's screen.
await shot("04-highlight-light", {
  theme: "light",
  prepare: async (page) => {
    await call("validate_schedule", { severity: "hard" })(page);
    await call("highlight", {
      staff: ["Marco"],
      dates: ["wednesday", "thursday"],
      note: "only 9h rest between closing Wednesday and opening Thursday",
    })(page);
  },
});

// 5. The live tool inspector.
await shot("05-tools-light", {
  theme: "light",
  prepare: async (page) => {
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) =>
        t.textContent?.includes("WebMCP"),
      );
      tab?.click();
    });
  },
});

// 6. Provenance ledger after a few calls.
await shot("06-ledger-light", {
  theme: "light",
  prepare: async (page) => {
    await call("get_schedule_overview")(page);
    await call("validate_schedule", { severity: "hard" })(page);
    await call("get_fairness_report")(page);
    await call("fill_open_shifts", { objective: "maximise_fairness" })(page);
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) =>
        t.textContent?.includes("Ledger"),
      );
      tab?.click();
    });
  },
});

// 7. Per-person fairness view.
await shot("07-people-light", {
  theme: "light",
  prepare: async (page) => {
    await call("focus_view", { view: "staff" })(page);
  },
});

// 8. Cost view.
await shot("08-cost-light", {
  theme: "light",
  prepare: async (page) => {
    await call("fill_open_shifts", { objective: "balanced" })(page);
    await call("focus_view", { view: "cost" })(page);
  },
});

await browser.close();
