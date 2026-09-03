# YouTube upload — copy and paste

> **Published:** https://youtu.be/f9kQxR2vo8Y — title used: *"Rota: agent-collaborative shift scheduling built on WebMCP"*.
> Confirm in YouTube Studio that visibility reads **Public**, not Unlisted: the challenge
> rules ask for a publicly viewable video, and oEmbed cannot tell the two apart.

The file: **`media/rota-demo.mp4`** — 1:54, 1920×1128, H.264 + AAC, 8.7 MB.

## Settings

| Field | Value |
| --- | --- |
| Visibility | **Public** — the rules require a publicly viewable video, so do not leave it Unlisted |
| Audience | "No, it's not made for kids" |
| Language | English |
| Category | Science & Technology |
| Comments | Leave on |

---

## Title

```
Rota — an AI agent builds your staff rota. You approve it. | WebMCP Challenge
```

Alternative, if you prefer leading with the technology:

```
Rota: agent-collaborative shift scheduling built on WebMCP
```

---

## Description

```
Rota is a shift-scheduling studio where a manager and an AI agent work the same roster at the same time, in the same browser tab, built on WebMCP.

The agent can read the whole week, rank cover options against the venue's own rule engine, and propose an entire rota in a dozen tool calls. It cannot change a single person's Saturday without the manager pressing Approve.

That constraint is the architecture, not a disclaimer. There is no commit, no approve and no publish anywhere in the 36-tool surface — and publishing is a declarative WebMCP form deliberately missing the toolautosubmit attribute, so the browser lets the agent fill it in and then hands the submit button to a human.

Try it live: https://webmcp-eta.vercel.app/
Source: https://github.com/shaikhmubin02/rota-webmcp

No sign-up and no API key needed. Rota ships a polyfill for document.modelContext, so it works in any browser today — and under ChatGPT Desktop or Chrome 149+ the native implementation takes over and an external agent drives the same tools.

CHAPTERS
0:00 The problem you cannot see
0:18 The agent finds it
0:31 It proposes a week — and stops
0:54 Review and consent
1:08 Approve, then fix the breach
1:24 One missing HTML attribute

WHAT IT DOES
The week opens three-quarters finished, with one rule breach that is invisible to the eye: Marco closes at 21:30 on Wednesday and opens at 06:30 on Thursday. Nine hours of rest where eleven are legally required. Both shifts look perfectly reasonable on their own, which is why every real rota has one.

Ask the agent to finish the rota and it runs the venue's constraint solver, stages fourteen assignments worth £1,384 of extra wages, re-checks the result against fifteen scheduling rules, and then tells you the fifteenth slot cannot be filled legally and names the constraint that blocks every remaining person.

Nothing on the calendar has changed. Proposals render in place as dashed cards on the shifts they affect, and the review drawer shows every edit as a line you can untick, with the net effect on coverage, breaches and cost.

WHY WEBMCP SPECIFICALLY
- The roster, the rule engine and the solver are all client-side. A backend MCP server would have to replicate the manager's live, half-uncommitted working state.
- The agent never reasons about labour law. It calls validate_schedule and quotes what the page's own engine returns.
- Because the tools run inside the page, the agent can put the problem on your screen — highlighting the two shifts it means.
- Selecting a shift registers tools that only exist while it is selected, and withdraws them when it is not. A flat backend tool list cannot do that.

BUILT WITH
TypeScript, React, Vite, Tailwind, WebMCP (document.modelContext), and no backend at all.

Built for the OpenAI WebMCP Challenge, September 2026.
#WebMCP #AIAgents #OpenAI #WebDev
```

---

## Why the chapters stop at 1:24

YouTube requires every chapter to be at least ten seconds long, and the closing beat runs 1:47–1:54. Listing it would break chapters entirely, so the last chapter absorbs it.

## After uploading

1. Paste the URL into the Devpost submission form.
2. Add it to [DEVPOST.md](DEVPOST.md) under "Try it".
3. Add it to the top of [README.md](README.md) next to the live link.
4. Watch it through once on YouTube after processing finishes — confirm the audio is present and that 1080p is available before you submit.
