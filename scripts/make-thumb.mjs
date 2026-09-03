/**
 * Renders the Devpost / social thumbnail.
 *
 * Composed as HTML and screenshotted rather than assembled in ffmpeg, because
 * Devpost's gallery card is small and a shrunken app screenshot is illegible
 * there -- the headline has to carry it.
 *
 *   node scripts/make-thumb.mjs
 *
 * Output: media/rota-thumbnail.png (1500x1000, 3:2) and a .jpg alongside.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import puppeteer from "puppeteer-core";

process.env.PATH = `${dirname(ffmpegPath)};${process.env.PATH}`;

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SOURCE = resolve("media/_thumb/thumb.html");
const PNG = "media/rota-thumbnail.png";
const JPG = "media/rota-thumbnail.jpg";

if (!existsSync(SOURCE)) throw new Error(`Missing ${SOURCE}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
  args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none"],
});
const page = await browser.newPage();
// 2x so the downscale to 1500x1000 lands crisp.
await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });
await page.goto(`file:///${SOURCE.replace(/\\/g, "/")}`, { waitUntil: "networkidle0" });
await page.evaluateHandle("document.fonts.ready");
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: PNG, clip: { x: 0, y: 0, width: 1500, height: 1000 } });
await browser.close();

// Devpost caps uploads at 5 MB; a JPEG is the safe option.
execFileSync(
  ffmpegPath,
  ["-y", "-i", PNG, "-vf", "scale=1500:1000:flags=lanczos", "-q:v", "3", JPG],
  { stdio: ["ignore", "ignore", "pipe"] },
);

console.log(`${PNG}\n${JPG}`);
