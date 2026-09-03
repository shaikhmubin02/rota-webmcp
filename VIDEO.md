# Demo video script — 3:00 max

Requirements: under three minutes, public on YouTube, **must have audio**.

## Before you record

- [ ] Open https://webmcp-eta.vercel.app/ in a clean window, 1728×1040 or larger.
- [ ] Hit the reset icon (top right) so the week is the original broken one — 73% coverage, 15 unfilled, 2 rule breaches.
- [ ] Light appearance (default). Dark also looks fine; pick one and stay in it.
- [ ] Zoom the browser to 110% if your recording is 1080p, so the type is legible after compression.
- [ ] Agent panel open, **Scripted** mode selected. It needs no key and cannot rate-limit mid-take. If you have an OpenAI key and a good connection, do the run in **OpenAI** mode instead — it is more impressive and the prompts below are written to work in either.
- [ ] Close the review drawer if it is open.
- [ ] Turn off notifications.

Total runtime target: **2:45**, leaving headroom.

---

## 0:00–0:20 · The problem, on screen

**Show:** the week grid, untouched. Slowly move the cursor across Thursday and Friday.

> "This is next week's rota for a coffee shop with fourteen staff. It's Friday afternoon, it's three-quarters finished, and there's a problem in it that you cannot see."
>
> "Marco closes on Wednesday night at half nine, and opens on Thursday morning at half six. Nine hours between shifts. Eleven are legally required. Both of those shifts look completely reasonable on their own — which is why every real rota has one of these in it."

**Point at:** the red "2 rule breaches" chip in the strip.

---

## 0:20–0:50 · The agent finds it, and points at it

**Type:** `Review next week's rota and tell me what is broken. Show me the worst problem.`

**Show:** the tool-call cards streaming in. Let `validate_schedule` land, then the grid lighting up.

> "The agent isn't reasoning about labour law here. It's calling the page's own rule engine and quoting the answer back."

**When the amber highlight and caption appear:**

> "And because these tools run *inside the page*, it can do something a backend integration simply cannot: it puts the problem on my screen. That amber ring is the agent pointing."

**Click one tool-call card open** to show arguments and the returned text.

> "Every call is inspectable. Arguments, result, timing."

---

## 0:50–1:35 · It proposes a whole week — and stops

**Type:** `Finish the rota. Fill every open shift, keep it fair, and don't push anyone into overtime.`

**Show:** the calls landing one by one. Then the purple dashed ghosts appearing across the grid.

> "Fifteen open slots. It's running the venue's constraint solver, and staging fourteen assignments."
>
> "Look at what it's *not* doing. Nothing on this calendar has actually changed. Every one of those dashed purple cards is a proposal, rendered on the shift it would affect — so I'm reviewing the change against the thing it changes, not reading a list and imagining the result."

**Point at:** the one slot still marked unfilled.

> "And it's honest about the fourteenth. It'll tell me the Sunday close can't be filled legally, and name the constraint that blocks every remaining person. That's much more useful than 'I couldn't find cover'."

---

## 1:35–2:10 · The consent surface

**Click:** Review.

**Show:** the drawer. Let the four stat tiles land: Unfilled 1 (−14), Breaches, Soft, Cost £5,235 (+£1,384).

> "Coverage, rule breaches, fairness, and what it costs — before and after. Fourteen changes, fourteen checkboxes, so I can take twelve and drop two."

**Hover one edit** so the grid highlights behind the drawer.

> "Each one says which tool call produced it and which agent made that call."

**Untick one edit**, show a stat tile move, then re-tick it.

**Click:** Approve 14 changes.

> "That's me. The agent has no tool that commits anything — there is no `approve` and no `publish` in the thirty-six tools it can see. Not a guardrail bolted on. There's simply no code path."

---

## 2:10–2:40 · The attribute that makes the point

**Switch to:** the Publish tab.

**Type:** `Draft the publish note for the team explaining the Thursday change.`

**Show:** the form filling itself in — textarea, dropdown, checkbox — and the Publish button taking focus with a purple ring.

> "Publishing is a declarative WebMCP tool. It's an HTML form with `toolname` and `tooldescription`, and the browser compiles the input schema out of the fields."
>
> "What it doesn't have is `toolautosubmit`. Per the spec, that means an agent can fill this form in and then it has to stop — the browser focuses the submit button and waits for a human."

**Pause on the focused button.**

> "So the one action that actually tells fourteen people when they're working is reachable by an agent as far as the button, and no further. The whole argument of this project is one missing HTML attribute."

**Press Publish.**

---

## 2:40–2:55 · Close

**Show:** the WebMCP tab briefly — the 30-odd registered tools, the polyfill badge.

> "Thirty-six imperative tools, one declarative. It ships a polyfill for `document.modelContext`, so this works on any browser today — and under ChatGPT Desktop or Chrome 149 the native implementation takes over and an external agent drives exactly the same tools."
>
> "The agent does the grind. I stay in charge."

---

## Shots worth grabbing if you have time

- **Select a shift**, then flip to the WebMCP tab: two new tools have appeared. Say *"the page knows what I'm looking at, so it offers tools that only make sense right now — a static backend tool list can't do that."* Strong 8-second beat if the video runs short.
- **The Ledger tab** after a few calls, showing caller attribution.
- **`Marco called in sick for Thursday and Friday`** — the cascade is satisfying, but it competes with the "finish the rota" beat. Pick one.

## If a take goes wrong

Hit the reset icon in the toolbar. It restores the original broken week, clears the ledger and the conversation, and is deterministic — every run starts from an identical roster.
