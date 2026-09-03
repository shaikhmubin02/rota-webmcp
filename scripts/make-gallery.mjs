/**
 * Builds the Devpost image gallery from the app screenshots.
 *
 * The screenshots are 3456x2080 (1.66:1) and Devpost wants 3:2, so they are
 * letterboxed rather than cropped -- cropping to 3:2 would cut 336px of width,
 * which eats into the staff rail on one side and the agent panel on the other,
 * and those are the two things worth showing.
 *
 *   node scripts/make-gallery.mjs
 *
 * Output: media/gallery/01..08-*.jpg at 1500x1000.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

const OUT = "media/gallery";

/** Order matters: this is the sequence a judge scrolls through. */
const SHOTS = [
  ["01-week-light.png", "01-the-broken-week", "#f5f5f7"],
  ["04-highlight-light.png", "02-agent-points-at-the-problem", "#f5f5f7"],
  ["02-proposal-light.png", "03-proposals-staged-in-place", "#f5f5f7"],
  ["03-review-light.png", "04-the-review-drawer", "#f5f5f7"],
  ["05-tools-light.png", "05-live-webmcp-tool-inspector", "#f5f5f7"],
  ["06-ledger-light.png", "06-provenance-ledger", "#f5f5f7"],
  ["07-people-light.png", "07-fairness-per-person", "#f5f5f7"],
  ["08-cost-light.png", "08-labour-cost-against-budget", "#f5f5f7"],
  ["01-week-dark.png", "09-dark-appearance", "#000000"],
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let made = 0;
for (const [src, name, bg] of SHOTS) {
  const input = `docs/${src}`;
  if (!existsSync(input)) {
    console.warn(`  ! missing ${input}, skipping`);
    continue;
  }
  const output = `${OUT}/${name}.jpg`;
  execFileSync(
    ffmpegPath,
    [
      "-y",
      "-i", input,
      // Fit inside 1500x1000, then pad out to exactly 3:2 on the venue's own
      // background colour so the letterboxing is invisible.
      "-vf",
      `scale=1500:1000:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=1500:1000:(ow-iw)/2:(oh-ih)/2:color=${bg}`,
      "-q:v", "3",
      output,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  made += 1;
  console.log(`  ${output}`);
}
console.log(`\n${made} gallery images in ${OUT}/`);
