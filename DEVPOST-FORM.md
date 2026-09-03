# Devpost submission form — field by field

Every value below is within the limit Devpost shows for that field. Character
counts were checked, not eyeballed.

Submission: https://devpost.com/submit-to/31011-the-webmcp-challenge

---

## Step 2 · Project overview

### Project name  *(60 max)*

```
Rota — agent-collaborative shift scheduling
```

*43 characters.* If the em-dash pastes badly, use a plain hyphen.

### Elevator pitch  *(200 max)*

```
An AI agent builds your staff rota in a dozen tool calls. It cannot change one person's Saturday without you pressing Approve — there is no commit tool anywhere in the 36-tool surface.
```

*184 characters.*

### Thumbnail

Optional, and Devpost will fall back to the video. If you want one, screenshot
the app at https://webmcp-eta.vercel.app/ with the review drawer open and crop
it to 3:2.

---

## Step 3 · Project details

### About the project

Paste this whole block. Devpost renders the headings.

```
## What it does

Rota is a shift-scheduling studio for a fourteen-person café. A manager and an AI agent work the same roster at the same time, in the same tab, looking at the same grid.

You open it to next week's rota half-finished — 73% covered, fifteen unfilled slots, and one rule breach that is invisible to the eye: Marco closes at 21:30 on Wednesday and opens at 06:30 on Thursday. Nine hours of rest where eleven are legally required. Both shifts look perfectly reasonable on their own, which is exactly why every real rota has one.

Say *"finish the rota, keep it fair, and don't push anyone into overtime"* and the agent makes about five tool calls: it reads the gaps, runs the venue's own constraint solver, stages fourteen assignments, re-validates against fifteen scheduling rules, prices it at £1,384 of added wages, and then **stops**. It tells you the fifteenth slot cannot be filled legally and names the constraint that blocks every remaining person.

Nothing on the calendar has changed. The proposals render *in place* as dashed ghosts on the shifts they affect, and a review drawer shows every edit as a line you can untick, the net effect on coverage, breaches and cost, and an honest warning about what your approval would leave unfixed.

Then you press Approve. Or you don't.

## The idea

The interesting question about agents on the web is not "can an agent do the task". It is "how does an agent do a task that a human can still check, amend and take responsibility for".

A shift rota is a good place to ask that, because a rota is a promise to fourteen people about their week. Getting it wrong means somebody's childcare falls through. It is precisely the kind of work you want an agent to grind through, and precisely the kind you would never let it publish unsupervised.

So Rota is built around one constraint: **the agent has no tool that commits anything.** Not a guardrail added afterwards — an architectural fact. Across a 36-tool surface there is no `commit`, no `approve`, no `publish`. Write tools append reversible edits to a proposal; approval exists only in the UI.

And publishing — the one action that actually tells fourteen people when they are working — is a **declarative** WebMCP form deliberately missing `toolautosubmit`, which per the spec means an agent may fill it in but the browser will only focus the submit button and wait for a person.

The whole thesis of the project is expressed in one absent HTML attribute.

## Why WebMCP, specifically

This could not be a backend MCP server, for four concrete reasons:

1. **The state is in the tab.** The roster, the staff records, the rule engine and the solver are all client-side. A backend integration would have to replicate the manager's live working state — half of which is uncommitted and exists only as a pending proposal.

2. **The rules must not be hallucinated.** The agent never reasons about labour law. It calls `validate_schedule` and quotes what the page's own engine returns. When `assign_staff` refuses, the refusal is a fact the manager can act on: *"Liam Doyle is not certified as Baker"*. Reusing the page's existing client-side logic is what WebMCP is for, and here it is load-bearing for correctness.

3. **The agent and the human need shared visual context.** When the agent says "Thursday is the problem", it calls `highlight` and puts Thursday on the manager's screen, ringed in amber, with a caption. No backend integration can move the user's eyes.

4. **Tools that only exist right now.** Select a shift and two selection-scoped tools appear. Stage a proposal and `revise_proposal` appears. Deselect and they are withdrawn, each transition firing `toolchange`. A flat, static, backend tool list structurally cannot offer this — a page knows what the user is looking at.

## How it improves the human-agent experience

- **Proposals, not actions.** Every agent write is staged, and the diff renders on the calendar, so you review a change against the thing it changes rather than reading a list and imagining the result.
- **Partial consent.** Fourteen proposed changes, fourteen checkboxes. Take twelve, drop two.
- **Honest failure.** The agent reports what it could *not* do and why, quoting the rule. "Everyone available is over their consecutive-day limit, and Tom is the only other keyholder" beats "I couldn't find cover".
- **Provenance.** Every tool call is logged with arguments, result, timing, whether it was read-only, the edits it produced, and *who called it* — the in-page panel, a native browser agent, or you. Exportable as JSON.
- **Undo across approvals.** Edits carry forward and backward patches, so an approved batch is still reversible.
- **It works for everyone.** Rota ships a spec-shaped polyfill for `document.modelContext`, so the live URL is fully functional on stock Chrome, Firefox or Safari with no origin trial and no API key. Under ChatGPT Desktop or Chrome 149+ the native implementation takes over and an external agent drives the same tools.

## How we built it

Static TypeScript, React and Vite. No backend, no database, no telemetry — the roster never leaves the tab, which is what makes the client-side integration honest rather than decorative.

The **engine** is plain TypeScript with no React and no DOM: fifteen rules split into statutory hard rules (rest periods, availability, certification, hour caps, consecutive days, under-18 curfew) and fairness/cost/preference soft rules. Candidate ranking works by simulate-and-revalidate — to score someone for a shift, apply the assignment to a copy of the roster and re-run the real validator — so the ranker can never disagree with the rule engine. The solver is most-constrained-first greedy plus two bounded local-search passes, fast enough to run inside a tool call.

The **WebMCP layer** holds the polyfill, the declarative `<form>` → tool synthesiser, a JSON Schema subset with argument coercion, and the instrumented registry.

The **staging layer** models every change as an `Edit` with forward and backward patches. Two assignments to the same shift would clobber each other if patches were applied blindly, so `applyEdits` rebases each patch against the roster as it actually stands when the edit lands.

Both agent modes go through `getTools()` and `executeTool()` — the in-page agent holds no references to its own tool functions, so our own UI exercises the exact code path an external agent takes.

## What we learned

Three findings that changed the code more than any prompt tuning did.

**Tools should return prose.** The text half of a result is what the model reasons over and quotes back to the user. Writing every result as something a person would be happy to read aloud improved answer quality markedly. `find_cover` returns *"Mei Lin — score 88, no overtime incurred, prefers evenings"*, not a scored tuple.

**Coerce arguments, don't reject them.** Models send `"3"` for an integer, `"Thursday"` for a date, a bare string where an array is declared. Rejecting that is technically correct and practically useless — the agent burns a turn apologising. Rota coerces what is unambiguously coercible and reports what it did, so the adjustment lands in the provenance ledger instead of happening invisibly.

**Errors should be results, not exceptions.** A model that receives *"Marco is not certified as Baker"* recovers next turn. One that receives a rejected promise usually gives up. Every failure becomes an `isError` result carrying a sentence that names the valid options.

The sharpest bug was ours, not the spec's. The derived "roster as proposed" value was rebuilt on every call, and since it is used as a state selector compared by reference, staging a proposal triggered an infinite render loop that tore down the React tree and silently unregistered all 32 tools. It only surfaced under a real browser test, which is why there is one.

## Challenges

Making the demo data *honest*. The first seeded roster had 31 hard breaches and 65% coverage, which reads as sloppy rather than realistic — and worse, total shift demand exceeded the sum of everyone's contracted hours, so the solver structurally could not finish and filled zero slots. Getting to a week that is plausibly half-done, genuinely fixable, and still leaves exactly one honestly-impossible slot took several rounds of measuring capacity against demand role by role.

## Accomplishments we're proud of

The correctness work is tested rather than asserted: 28 headless engine checks, 33 browser checks and 35 agent-prompt checks, all passing against the live deployment. Those assert real properties — that candidates the ranker calls eligible really are eligible under re-validation, that the solver never increases hard breaches, that `minimise_cost` is never more expensive than `balanced`, that absence cover never backfills with the absent person, and that the declarative form fills but refuses to submit.

## What's next

Multi-week and multi-site rosters; shift-swap requests from staff as a second, lower-trust tool surface; and cross-origin federation, where an author-provided agent in an iframe reaches the venue's tools through `exposedTo` while a consent ledger shows the manager exactly what crossed the boundary.
```

### Built With  *(tags — type each, press Enter)*

```
typescript
react
vite
tailwindcss
webmcp
model-context-protocol
openai
javascript
html
css
github-pages
vercel
```

### "Try it out" links

```
https://webmcp-eta.vercel.app/
https://github.com/shaikhmubin02/rota-webmcp
```

---

## Step 4 · Additional info

### Video demo link

```
https://youtu.be/f9kQxR2vo8Y
```

### If it asks which sponsor tools you used

Google Chrome (WebMCP origin trial target), OpenAI (the bring-your-own-key
agent mode uses the Chat Completions API), and Vercel (hosting).

### If it asks about testing instructions

```
No sign-up and no API key are needed. Open https://webmcp-eta.vercel.app/ and click any suggested prompt in the Agent panel on the right — start with "Audit the week", then "Finish the rota".

The app ships a polyfill for document.modelContext, so every WebMCP tool works on stock Chrome, Firefox or Safari. The toolbar badge says whether you are on the polyfill or a native implementation.

In ChatGPT Desktop, or Chrome 149+ / Edge 150+ with the WebMCP origin trial, document.modelContext is native and an external agent can discover and drive the same 36 tools directly.

For open-ended prompts, paste an OpenAI key into the panel (the key icon). It stays in localStorage — there is no backend to send it to.

The WebMCP tab lists every registered tool with its JSON Schema and lets you invoke any of them by hand. The Ledger tab shows every call that has been made, with arguments and results.
```

---

## Before you hit Submit

- [ ] YouTube visibility is **Public** (not Unlisted).
- [ ] Repo is public: https://github.com/shaikhmubin02/rota-webmcp
- [ ] Live URL loads for a logged-out visitor: https://webmcp-eta.vercel.app/
- [ ] Use Devpost's **Preview** button and read it once as a judge would.
- [ ] Check the eligibility question honestly — the rules exclude residents of
      certain countries and require legal age of majority.
