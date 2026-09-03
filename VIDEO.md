# Demo video — voiceover script

Record the **audio first**, straight through, then cut screen footage to match.

Requirements: under 3:00, public on YouTube, **must have audio**.

- **Read only the `>` blockquote lines.** Everything else is a note for you.
- Target **2:40** of narration, leaving 20 seconds of headroom.
- **405 words.** At 145 words/minute that lands at **2:47**; at 155 it's 2:36. Don't go slower than ~140 or you'll breach the limit.
- Every number below is the real on-screen figure, verified against the live app. If you re-run the demo they will be identical — the roster is seeded deterministically.

## Pronunciation

| Written | Say |
| --- | --- |
| `toolautosubmit` | "tool auto submit" |
| `document.modelContext` | "document dot model context" |
| WebMCP | "web M-C-P" |
| rota | "ROH-ta" |
| £1,384 | "thirteen hundred and eighty-four pounds" |
| £5,235 | "five thousand two hundred and thirty-five" |

## Recording tips

- Pause **one full second** at each `[beat]` marker. It gives you clean edit points to hang footage on.
- Read the em-dashes as short breaths, not full stops.
- The three lines marked **↓ land this one** are the argument of the whole project. Slow down about 15% on those.
- If you fluff a line, pause two seconds and take the whole paragraph again — don't patch mid-sentence.

---

## Beat 1 · The problem (0:00–0:20)

*On screen: the week grid, untouched. Cursor drifting across Wednesday and Thursday.*

> This is next week's rota for a coffee shop with fourteen staff. Three-quarters finished, with a problem in it you cannot see.
>
> Marco closes Wednesday at half past nine, and opens Thursday at half past six. Nine hours between shifts. Eleven are legally required.
>
> Both shifts look perfectly reasonable on their own. That's why every real rota has one.

`[beat]`

---

## Beat 2 · The agent finds it (0:20–0:48)

*On screen: type "Review next week's rota and tell me what is broken. Show me the worst problem." Let the tool cards stream in. Then the amber highlight.*

> So I'll ask.
>
> It isn't reasoning about employment law — it's calling the page's own rule engine and quoting the answer back. Fifteen rules, all owned by the page.
>
> And because these tools run inside the page, it can do what a server-side integration cannot: put the problem on my screen. That amber ring is the agent pointing.

`[beat]`

---

## Beat 3 · It proposes a week, then stops (0:48–1:28)

*On screen: type "Finish the rota. Fill every open shift, keep it fair, and don't push anyone into overtime." Let the purple dashed cards appear across the grid.*

> Now the real work. Fifteen empty slots. It runs the venue's solver and stages fourteen assignments — thirteen hundred and eighty-four pounds of extra wages.
>
> **↓ land this one**
> Look at what hasn't happened. Nothing here has changed. Every dashed purple card is a proposal, drawn on the shift it would affect — so I'm reviewing the change against the thing it changes, instead of reading a list and imagining the result.
>
> And it's honest about the one it couldn't do. Sunday's closing lead is impossible — Liam's seventeen, and nobody else left is a certified lead.

`[beat]`

---

## Beat 4 · Consent (1:28–1:58)

*On screen: click Review. Let the four stat tiles land — Unfilled 1 (−14), Breaches 1, Soft 9 (−2), Cost £5,235 (+£1,384). Hover an edit so the grid highlights behind the drawer. Untick one, re-tick it.*

> Coverage, breaches, fairness, cost — before and after.
>
> Notice breaches is still one. Filling empty slots doesn't fix Marco's rest period, and it isn't pretending otherwise.
>
> Fourteen changes, fourteen checkboxes. I can take twelve and drop two.

`[beat]`

---

## Beat 5 · Approve, and fix the real breach (1:58–2:20)

*On screen: click Approve 14 changes. Then type "Fix the close-then-open" and let the swap land.*

> Approving is me.
>
> **↓ land this one**
> The agent has no tool that commits anything. No approve, no publish, anywhere in the thirty-six tools it can see. That isn't a guardrail bolted on afterwards — there is simply no code path.
>
> Now the rest breach. It finds a two-way swap: Sofia takes Thursday morning, Marco moves across, nobody loses a shift.

`[beat]`

---

## Beat 6 · The missing attribute (2:20–2:42)

*On screen: Publish tab. Type "Draft the publish note for the team explaining the Thursday change." Show the textarea, dropdown and checkbox filling themselves, then the Publish button taking focus with a purple ring. Hold on the focused button.*

> Publishing is a declarative WebMCP tool: an ordinary HTML form, compiled into a tool schema.
>
> What it doesn't have is tool auto submit. Per the spec, an agent can fill this in — then it must stop. The browser focuses the button and waits.
>
> **↓ land this one**
> So the one action that actually tells fourteen people when they're working is reachable by an agent as far as the button, and no further. The whole argument of this project is one missing HTML attribute.

*Press Publish.*

`[beat]`

---

## Beat 7 · Close (2:42–2:52)

*On screen: the WebMCP tab — registered tools, the polyfill badge.*

> Thirty-six tools, and a polyfill so it works in any browser today.
>
> The agent does the grind. I stay in charge.

---

# Screen recording notes

Do this pass **after** the audio is cut, so you can match the pace.

## Before you start

- [ ] Open https://webmcp-eta.vercel.app/ in a clean window, 1728×1040 or larger.
- [ ] Press the reset icon (top right). The week should read **15 unfilled · 1 rule breach · 11 soft** and 73% coverage. If it doesn't, reset again.
- [ ] Light appearance. Dark works too — pick one and stay in it.
- [ ] Browser zoom 110% if you're recording at 1080p, so the type survives compression.
- [ ] Agent panel on **Scripted**. No key needed and it can't rate-limit mid-take. Use **OpenAI** mode instead if you have a key and a solid connection — the prompts work in both.
- [ ] Notifications off. Close the review drawer if it's open.

## Prompts to type, in order

1. `Review next week's rota and tell me what is broken. Show me the worst problem.`
2. `Finish the rota. Fill every open shift, keep it fair, and don't push anyone into overtime.`
3. *(click Review, then Approve 14 changes)*
4. `Fix the close-then-open`
5. `Draft the publish note for the team explaining the Thursday change.`
6. *(press Publish)*

## Spare shots, if a beat runs short

- **Select any shift, then flip to the WebMCP tab.** Two tools have appeared that weren't there before — `selected_shift_cover_options` and `fill_selected_shift`. Strong eight-second beat for the "a page knows what you're looking at" point.
- **The Ledger tab** after a few calls: every invocation with its arguments, timing and caller.
- **Click a tool-call card open** in the agent panel to show the arguments and the returned text.

## If a take goes wrong

Press the reset icon. It restores the original broken week, clears the ledger and the conversation, and is deterministic — every run starts from an identical roster, so takes will always cut together.
