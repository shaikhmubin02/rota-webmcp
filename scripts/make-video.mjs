/**
 * Builds the demo video.
 *
 * Reads the voiceover clips from media/, measures how long each one actually
 * is, drives the live app through the demo on a timeline derived from those
 * measurements, screen-records the browser, and muxes the audio in.
 *
 *   node scripts/make-video.mjs [--url <url>] [--dry]
 *
 * Expects either media/beat1..beat7.(mp3|wav|m4a|ogg) -- preferred, because it
 * gives an exact start time for every beat -- or a single media/voiceover.*,
 * in which case the beats are apportioned by word count.
 *
 * Output: media/rota-demo.mp4
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import puppeteer from "puppeteer-core";

const run = promisify(execFile);

// Puppeteer's screencast shells out to `ffmpeg` on PATH.
process.env.PATH = `${dirname(ffmpegPath)};${process.env.PATH}`;

const args = process.argv.slice(2);
const URL_ARG = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;
const URL = URL_ARG ?? "https://webmcp-eta.vercel.app/";
const DRY = args.includes("--dry");
// Shrinks every beat to a few seconds, for checking the pipeline end to end
// without sitting through a full three-minute take.
const FAST = args.includes("--fast");
const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const MEDIA = "media";
const FRAME_DIR = join(MEDIA, "_frames");
const OUT = join(MEDIA, "rota-demo.mp4");

const WIDTH = 1600;
const HEIGHT = 940;

/* -- audio ----------------------------------------------------------------- */

const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".opus"];
/** Where voiceover clips might live. */
const AUDIO_DIRS = ["audio", MEDIA, "."];

/**
 * Finds a clip by beat number, accepting the naming people actually use:
 * `b-1`, `beat1`, `beat-1`, `block1`, or just `1`, in any of the usual folders.
 */
function findBeatAudio(n) {
  const stems = [`b-${n}`, `b${n}`, `beat${n}`, `beat-${n}`, `block${n}`, `block-${n}`, `${n}`];
  for (const dir of AUDIO_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir);
    for (const stem of stems) {
      for (const ext of AUDIO_EXT) {
        const hit = files.find((f) => f.toLowerCase() === `${stem}${ext}`);
        if (hit) return join(dir, hit);
      }
    }
  }
  return null;
}

function findAudio(stem) {
  for (const dir of AUDIO_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir);
    for (const ext of AUDIO_EXT) {
      const hit = files.find((f) => f.toLowerCase() === `${stem}${ext}`);
      if (hit) return join(dir, hit);
    }
  }
  return null;
}

async function durationOf(file) {
  const { stdout } = await run(ffmpegPath, ["-i", file, "-hide_banner"], {
    encoding: "utf8",
  }).catch((e) => ({ stdout: String(e.stderr ?? "") }));
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stdout);
  if (!m) throw new Error(`Could not read the duration of ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Word counts per beat, used to apportion a single combined audio file. */
const BEAT_WORDS = [47, 43, 59, 28, 46, 62, 22];

async function loadAudio() {
  const perBeat = [];
  for (let i = 1; i <= 7; i++) perBeat.push(findBeatAudio(i));

  if (perBeat.every(Boolean)) {
    const durations = [];
    for (const f of perBeat) durations.push(await durationOf(f));
    return { mode: "beats", files: perBeat, durations };
  }

  const single = findAudio("voiceover") ?? findAudio("narration") ?? findAudio("audio");
  if (single) {
    const total = await durationOf(single);
    const words = BEAT_WORDS.reduce((a, b) => a + b, 0);
    return {
      mode: "single",
      files: [single],
      durations: BEAT_WORDS.map((w) => (w / words) * total),
      total,
    };
  }

  const found = perBeat.filter(Boolean).length;
  throw new Error(
    found > 0
      ? `Only found ${found} of 7 beat clips in ${MEDIA}/. Add the rest, or drop a single media/voiceover.mp3.`
      : `No audio found. Put beat1..beat7 (or a single voiceover file) in ${MEDIA}/. See VOICEOVER.txt.`,
  );
}

/* -- a visible cursor ------------------------------------------------------ */

/**
 * The screencast captures page content only, never the OS pointer, so clicks
 * would otherwise appear to happen by magic. This injects a cursor into the
 * page and moves it along with the synthetic input.
 */
async function installCursor(page) {
  await page.evaluate(() => {
    const dot = document.createElement("div");
    dot.id = "__cursor";
    Object.assign(dot.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "22px",
      height: "22px",
      borderRadius: "50%",
      background: "rgba(0,113,227,0.28)",
      border: "2px solid rgba(0,113,227,0.9)",
      boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      transform: "translate(-50%,-50%)",
      pointerEvents: "none",
      zIndex: "2147483647",
      transition: "transform 0.09s linear",
      willChange: "left, top",
    });
    document.body.appendChild(dot);
    const ring = document.createElement("style");
    ring.textContent =
      "@keyframes __tap{0%{box-shadow:0 0 0 0 rgba(0,113,227,.5)}100%{box-shadow:0 0 0 26px rgba(0,113,227,0)}}" +
      "#__cursor.__tapping{animation:__tap .45s ease-out}";
    document.head.appendChild(ring);
  });
}

async function setCursor(page, x, y) {
  await page.evaluate(
    (cx, cy) => {
      const dot = document.getElementById("__cursor");
      if (dot) {
        dot.style.left = `${cx}px`;
        dot.style.top = `${cy}px`;
      }
    },
    x,
    y,
  );
}

async function tapCursor(page) {
  await page.evaluate(() => {
    const dot = document.getElementById("__cursor");
    if (!dot) return;
    dot.classList.remove("__tapping");
    void dot.offsetWidth;
    dot.classList.add("__tapping");
  });
}

/** Glides the cursor to an element's centre, then clicks it. */
async function moveAndClick(page, selectorOrFn, { steps = 18, settle = 220 } = {}) {
  const box = await page.evaluate((arg) => {
    // Both forms arrive as strings, so tell them apart by shape: an arrow
    // function source starts with a paren, a CSS selector never does.
    const isFunctionSource = arg.trimStart().startsWith("(");
    const el = isFunctionSource
      ? // eslint-disable-next-line no-new-func
        new Function(`return (${arg})()`)()
      : document.querySelector(arg);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selectorOrFn);
  if (!box) {
    console.warn(`  ! target not found, skipping: ${String(selectorOrFn).slice(0, 60)}`);
    return false;
  }

  const from = await page.evaluate(() => {
    const dot = document.getElementById("__cursor");
    return { x: parseFloat(dot?.style.left || "800"), y: parseFloat(dot?.style.top || "500") };
  });

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Ease-in-out so the glide reads as intentional rather than robotic.
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await setCursor(page, from.x + (box.x - from.x) * e, from.y + (box.y - from.y) * e);
    await sleep(16);
  }
  await tapCursor(page);
  await sleep(120);
  await page.mouse.click(box.x, box.y);
  await sleep(settle);
  return true;
}

/* -- capture --------------------------------------------------------------- */

/**
 * Records the page by driving CDP's screencast directly.
 *
 * Puppeteer's own `page.screencast()` pipes frames into an ffmpeg child on
 * stdin, and in testing that pipe died about fifty seconds into a three-minute
 * run, taking the rest of the recording with it and throwing an uncatchable
 * `write EOF` from an internal socket.
 *
 * Capturing frames ourselves is both more robust and more accurate. CDP only
 * emits a frame when the page actually changes, so a fixed frame rate would
 * drift badly across the long static stretches while the narrator is talking.
 * Each frame carries a timestamp, so we keep them and let ffmpeg's concat
 * demuxer hold each one for exactly as long as it was on screen. The result is
 * in wall-clock step with the voiceover.
 */
async function startRecorder(page, dir) {
  mkdirSync(dir, { recursive: true });
  const client = await page.createCDPSession();
  const frames = [];
  let index = 0;

  client.on("Page.screencastFrame", (frame) => {
    const file = join(dir, `f${String(index++).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    frames.push({ file, t: frame.metadata.timestamp });
    client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 2000,
    maxHeight: 1400,
    everyNthFrame: 1,
  });

  return {
    frames,
    async stop() {
      await client.send("Page.stopScreencast").catch(() => {});
      await sleep(300);
      await client.detach().catch(() => {});
    },
  };
}

/**
 * Writes an ffmpeg concat list holding each frame for its real duration, then
 * pads or trims the final frame so the video is exactly `targetSeconds` long.
 *
 * The padding matters. CDP stops emitting frames the moment the page stops
 * changing, so the last beat -- a static shot held while the narrator finishes
 * -- produces no frames at all. Without padding, the video ends ten seconds
 * early and `-shortest` truncates the end of the narration.
 *
 * Anchoring the total to the audio length also absorbs any accumulated drift,
 * and it does so on the closing frame, which is static anyway.
 */
function writeConcatList(frames, listPath, targetSeconds) {
  if (frames.length === 0) throw new Error("No frames were captured.");

  const durations = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + 0.08;
    // No tight upper clamp: a still shot legitimately lasts many seconds, and
    // clamping those compresses the whole timeline.
    durations.push(Math.max(0.016, Math.min(60, next - frames[i].t)));
  }

  const captured = durations.reduce((a, b) => a + b, 0);
  const slack = targetSeconds - captured;
  durations[durations.length - 1] = Math.max(0.05, durations[durations.length - 1] + slack);

  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    // Paths are relative to the list file, which lives beside the frames.
    lines.push(`file '${frames[i].file.split(/[\\/]/).pop()}'`);
    lines.push(`duration ${durations[i].toFixed(4)}`);
  }
  // The concat demuxer ignores the final duration unless the last file repeats.
  lines.push(`file '${frames[frames.length - 1].file.split(/[\\/]/).pop()}'`);
  writeFileSync(listPath, lines.join("\n"), "utf8");

  console.log(
    `Captured ${frames.length} frames spanning ${captured.toFixed(1)}s; ` +
      `${slack >= 0 ? "held the last frame for an extra " : "trimmed the last frame by "}` +
      `${Math.abs(slack).toFixed(1)}s to match ${targetSeconds.toFixed(1)}s of audio.`,
  );
  return targetSeconds;
}

/* -- helpers --------------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typePrompt(page, text, { delay = 26 } = {}) {
  const sel = 'textarea[aria-label="Message the scheduling agent"]';
  await moveAndClick(page, sel, { settle: 120 });
  await page.type(sel, text, { delay });
  await sleep(320);
  await page.keyboard.press("Enter");
}

async function waitForAgentIdle(page, timeout = 30000) {
  await page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll("button")].some(
          (b) => b.getAttribute("title") === "Stop",
        ) && !document.body.textContent?.includes("thinking…"),
      { timeout, polling: 250 },
    )
    .catch(() => console.warn("  ! agent still busy at timeout"));
}

const clickByText = (tag, text, scope = "") =>
  `() => [...document.querySelectorAll('${scope}${scope ? " " : ""}${tag}')].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}))`;

const dialogOpen = (page) =>
  page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));

/* -- the timeline ---------------------------------------------------------- */

/**
 * Each beat is a function that performs its on-screen actions. The runner
 * gives it the beat's real audio duration and pads whatever time is left, so
 * the picture always stays in step with the voice.
 */
function buildBeats(page) {
  return [
    {
      name: "1 · the problem",
      async run() {
        // Drift across the middle of the week, then rest on the breach chip.
        for (const x of [430, 560, 700, 830]) {
          await setCursor(page, x, 300);
          await sleep(260);
        }
        await moveAndClick(page, clickByText("button", "Marco Rossi gets only"), { settle: 400 });
        await sleep(600);
      },
    },
    {
      name: "2 · the agent finds it",
      async run() {
        await typePrompt(
          page,
          "Review next week's rota and tell me what is broken. Show me the worst problem.",
        );
        await waitForAgentIdle(page);
        await sleep(500);
      },
    },
    {
      name: "3 · it proposes a week",
      async run() {
        await typePrompt(
          page,
          "Finish the rota. Fill every open shift, keep it fair, and don't push anyone into overtime.",
        );
        await waitForAgentIdle(page);
        await sleep(700);
      },
    },
    {
      name: "4 · consent",
      async run() {
        await moveAndClick(page, '[data-testid="open-review"]', { settle: 700 });
        // Hover a couple of edits so the grid lights up behind the drawer.
        await sleep(400);
        for (const n of [1, 3]) {
          const ok = await page.evaluate((idx) => {
            const items = document.querySelectorAll('[role="dialog"] ol li label');
            const el = items[idx];
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.left + 60, y: r.top + r.height / 2 };
          }, n);
          if (ok) {
            await setCursor(page, ok.x, ok.y);
            await page.mouse.move(ok.x, ok.y);
            await sleep(700);
          }
        }
        // Untick one, then put it back.
        const box = await page.evaluate(() => {
          const cb = document.querySelector('[role="dialog"] ol li input[type="checkbox"]');
          if (!cb) return null;
          const r = cb.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (box) {
          await setCursor(page, box.x, box.y);
          await tapCursor(page);
          await page.mouse.click(box.x, box.y);
          await sleep(900);
          await tapCursor(page);
          await page.mouse.click(box.x, box.y);
          await sleep(500);
        }
      },
    },
    {
      name: "5 · approve, then fix the breach",
      async run() {
        // Make sure the drawer is actually open before reaching for Approve:
        // an earlier click can land on the modal backdrop and dismiss it.
        if (!(await dialogOpen(page))) {
          console.warn("    ! drawer was closed; reopening");
          await moveAndClick(page, '[data-testid="open-review"]', { settle: 700 });
        }
        await moveAndClick(page, '[data-testid="approve-proposal"]', { settle: 900 });
        if (await dialogOpen(page)) {
          console.warn("    ! drawer still open after Approve; retrying");
          await moveAndClick(page, '[data-testid="approve-proposal"]', { settle: 900 });
        }
        await sleep(500);
        await typePrompt(page, "Fix the close-then-open");
        await waitForAgentIdle(page);
        await sleep(400);
      },
    },
    {
      name: "6 · the missing attribute",
      async run() {
        // Beat 5 ends with the swap staged and the drawer open, which is the
        // right picture for that narration -- but the modal swallows every
        // click, so it has to be cleared before this beat can do anything.
        if (await dialogOpen(page)) {
          await moveAndClick(page, '[data-testid="approve-proposal"]', { settle: 800 });
        }
        await typePrompt(
          page,
          "Draft the publish note for the team explaining the Thursday change.",
        );
        await waitForAgentIdle(page);
        // Filling the declarative form fires rota:form-filled, which switches
        // the panel to Publish and focuses the submit button by itself.
        await sleep(1400);
        await moveAndClick(page, "#publish-form button[type=submit]", { settle: 1000 });
      },
    },
    {
      name: "7 · close",
      async run() {
        await moveAndClick(page, clickByText('[role="tab"]', "WebMCP"), { settle: 700 });
        await sleep(1200);
      },
    },
  ];
}

/* -- main ------------------------------------------------------------------ */

if (!existsSync(MEDIA)) mkdirSync(MEDIA);

const audio = await loadAudio();
console.log(
  `Audio: ${audio.mode === "beats" ? "7 per-beat clips" : "single file"} — ${audio.durations
    .map((d) => d.toFixed(1) + "s")
    .join(", ")}`,
);
const totalAudio = audio.durations.reduce((a, b) => a + b, 0);
console.log(
  `Total narration: ${Math.floor(totalAudio / 60)}:${String(Math.round(totalAudio % 60)).padStart(2, "0")}`,
);
if (totalAudio > 178) {
  console.warn(
    `  ! ${totalAudio.toFixed(1)}s is close to or over the 180s limit. Re-generate a little faster, or this script will speed the audio slightly to fit.`,
  );
}
if (DRY) {
  console.log("--dry: stopping before recording.");
  process.exit(0);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  defaultViewport: null,
  args: [
    "--no-sandbox",
    `--window-size=${WIDTH},${HEIGHT + 120}`,
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--disable-features=Translate",
    "--disable-infobars",
  ],
});

const page = (await browser.pages())[0];
await page.setViewport({ width: WIDTH, height: HEIGHT });
await page.evaluateOnNewDocument(() => localStorage.setItem("rota.theme", "light"));
await page.goto(URL, { waitUntil: "networkidle2" });
await page.waitForSelector("#publish-form");
await installCursor(page);
await setCursor(page, WIDTH / 2, HEIGHT / 2);
await sleep(1200);

const beats = buildBeats(page);
rmSync(FRAME_DIR, { recursive: true, force: true });
const recorder = await startRecorder(page, FRAME_DIR);
const startedAt = Date.now();
const marks = [];

for (let i = 0; i < beats.length; i++) {
  const target = (FAST ? 5 : audio.durations[i]) * 1000;
  const beatStart = Date.now();
  marks.push({ beat: beats[i].name, at: (beatStart - startedAt) / 1000 });
  console.log(`  beat ${i + 1}: ${beats[i].name} — ${(target / 1000).toFixed(1)}s budget`);
  try {
    await beats[i].run();
  } catch (error) {
    console.warn(`    ! beat ${i + 1} failed: ${error.message}`);
  }
  const spent = Date.now() - beatStart;
  if (spent < target) {
    await sleep(target - spent);
  } else {
    console.warn(`    ! ran ${((spent - target) / 1000).toFixed(1)}s over budget`);
  }
}

await sleep(500);
await recorder.stop();
const videoSeconds = (Date.now() - startedAt) / 1000;
await browser.close();

const listFile = join(FRAME_DIR, "frames.txt");
// Anchor the picture to the narration, not to how long the driver happened
// to take. `videoSeconds` is only reported for reference.
console.log(`Drove the demo in ${videoSeconds.toFixed(1)}s.`);
writeConcatList(recorder.frames, listFile, totalAudio);

/* -- mux ------------------------------------------------------------------- */

let audioInput = audio.files[0];
if (audio.mode === "beats") {
  const listFile = join(MEDIA, "_concat.txt");
  writeFileSync(
    listFile,
    // Absolute paths: the concat demuxer resolves relative entries against the
    // list file's own directory, and the clips may live in a different folder.
    audio.files.map((f) => `file '${resolve(f).replace(/\\/g, "/")}'`).join("\n"),
    "utf8",
  );
  audioInput = join(MEDIA, "_voice.m4a");
  execFileSync(
    ffmpegPath,
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "192k", audioInput],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  console.log(`Concatenated 7 clips into ${audioInput}`);
}

// If the narration overruns three minutes, nudge it faster rather than
// shipping something the rules disqualify.
const finalAudioDuration = await durationOf(audioInput);
const filters = [];
if (finalAudioDuration > 177) {
  const tempo = Math.min(1.15, finalAudioDuration / 174);
  filters.push(`atempo=${tempo.toFixed(4)}`);
  console.log(
    `Audio is ${finalAudioDuration.toFixed(1)}s; applying atempo=${tempo.toFixed(3)} to bring it under the limit.`,
  );
}

execFileSync(
  ffmpegPath,
  [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-i", audioInput,
    ...(filters.length ? ["-filter:a", filters.join(",")] : []),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    // Even dimensions, and 1080p-friendly.
    "-vf", "scale=1920:-2:flags=lanczos,fps=30",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    OUT,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

const finalDuration = await durationOf(OUT);
console.log(`\n${OUT}`);
console.log(
  `Duration: ${Math.floor(finalDuration / 60)}:${String(Math.round(finalDuration % 60)).padStart(2, "0")}${finalDuration > 180 ? "  ** OVER THE 3:00 LIMIT **" : "  (within the 3:00 limit)"}`,
);
console.log("\nBeat start times, for the YouTube description:");
for (const m of marks) {
  console.log(`  ${Math.floor(m.at / 60)}:${String(Math.round(m.at % 60)).padStart(2, "0")}  ${m.beat}`);
}
