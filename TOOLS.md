# Rota's WebMCP tool surface

> Generated from the source by `npm run tools:doc`. Do not edit by hand — edit the tool definitions in [`src/webmcp/`](src/webmcp/) instead.

Rota registers **36 imperative tools** plus **one declarative tool** synthesised from an HTML `<form>`. Not all of them are registered at once: several appear only while something is selected or a proposal is open, and every appearance or withdrawal fires `toolchange`.

## At a glance

| Tool | Group | Read-only | Registered |
| --- | --- | --- | --- |
| [`get_schedule_overview`](#get_schedule_overview) | read | yes | always |
| [`list_staff`](#list_staff) | read | yes | always |
| [`get_staff_details`](#get_staff_details) | read | yes | always |
| [`list_shifts`](#list_shifts) | read | yes | always |
| [`get_shift_details`](#get_shift_details) | read | yes | always |
| [`find_cover`](#find_cover) | read | yes | always |
| [`validate_schedule`](#validate_schedule) | read | yes | always |
| [`get_coverage_gaps`](#get_coverage_gaps) | read | yes | always |
| [`get_labor_cost`](#get_labor_cost) | read | yes | always |
| [`get_fairness_report`](#get_fairness_report) | read | yes | always |
| [`list_rules`](#list_rules) | read | yes | always |
| [`get_week_grid`](#get_week_grid) | read | yes | always |
| [`explain_assignment`](#explain_assignment) | read | yes | always |
| [`list_time_off_requests`](#list_time_off_requests) | read | yes | always |
| [`assign_staff`](#assign_staff) | write | no | always |
| [`unassign_staff`](#unassign_staff) | write | no | always |
| [`swap_assignments`](#swap_assignments) | write | no | always |
| [`suggest_swap_for`](#suggest_swap_for) | write | no | always |
| [`fill_open_shifts`](#fill_open_shifts) | write | no | always |
| [`cover_absence`](#cover_absence) | write | no | always |
| [`create_shift`](#create_shift) | write | no | always |
| [`update_shift`](#update_shift) | write | no | always |
| [`delete_shift`](#delete_shift) | write | no | always |
| [`record_time_off`](#record_time_off) | write | no | always |
| [`set_rule`](#set_rule) | write | no | always |
| [`clear_week`](#clear_week) | write | no | always |
| [`fill_selected_shift`](#fill_selected_shift) | write | no | contextual |
| [`rebalance_selected_staff`](#rebalance_selected_staff) | write | no | contextual |
| [`focus_view`](#focus_view) | view | no | always |
| [`highlight`](#highlight) | view | no | always |
| [`selected_shift_cover_options`](#selected_shift_cover_options) | view | yes | contextual |
| [`selected_staff_week`](#selected_staff_week) | view | yes | contextual |
| [`jump_to_next_week`](#jump_to_next_week) | view | no | always |
| [`request_approval`](#request_approval) | meta | no | always |
| [`get_change_history`](#get_change_history) | meta | yes | always |
| [`review_time_off_requests`](#review_time_off_requests) | meta | yes | contextual |
| `publish_schedule` | declarative | no | always |

## Read tools

Every one is annotated `readOnlyHint: true`. These are how the agent learns the state of the week, and how it checks its own work: the answers come from the venue's own rule engine, not from the model's reasoning about labour law.

### `get_schedule_overview`

`readOnlyHint: true`

Get the headline state of the roster week: coverage percentage, number of open slots, rule breaches by severity, projected wage cost against budget, and overtime. Call this first when you do not yet know the state of the schedule.

_No parameters._


### `list_staff`

`readOnlyHint: true`

List the team with their roles, contract, hours scheduled this week and hours remaining. Filter to find exactly who you need - for example everyone certified as a shift lead who is free on Saturday and still under their contracted hours.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no | Only people certified for this role. |
| `available_on` | string | no | Only people whose stated availability covers this date and who have no approved time off on it. Accepts YYYY-MM-DD or a weekday name. |
| `under_contracted_hours` | boolean | no | Only people currently scheduled below their contracted weekly hours. |
| `has_spare_capacity` | boolean | no | Only people who could take more hours without breaching their weekly cap. |

### `get_staff_details`

`readOnlyHint: true`

Everything about one person: certifications, contract, availability windows, time off, preferences, manager notes, every shift they are on this week, and their current hours and cost.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** | Name or id, e.g. "Marco" or "marco". |

### `list_shifts`

`readOnlyHint: true`

List shifts with who is on them. Filter by date, role, whether they still need people, or who is working them.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | A single date (YYYY-MM-DD or weekday name). |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `unfilled_only` | boolean | no | Only shifts with fewer people assigned than their required headcount. |
| `staff` | string | no | Only shifts this person is assigned to. |

### `get_shift_details`

`readOnlyHint: true`

Full detail for one shift, including who is on it, how many are still needed, and the hours and cost it represents.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no | Disambiguator: "opening", "closing", "morning", "evening", or a time like "16:30". |

### `find_cover`

`readOnlyHint: true`

Rank everyone who could take a shift, with the reasoning. Eligible people come back scored, with their projected hours, overtime and marginal cost. Set include_blocked to also see who CANNOT take it and exactly which rule stops them - use that to explain a refusal to the manager instead of guessing.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no | e.g. "opening", "closing", "16:30". |
| `include_blocked` | boolean | no | Also list ineligible people and the hard rule that blocks each of them. Default `false`. |
| `exclude` | array of string | no | Names or ids to leave out, e.g. someone who has called in sick. |

### `validate_schedule`

`readOnlyHint: true`

Run the venue's full rule engine over the schedule as it currently stands, including any changes you have staged but not yet had approved. Returns every breach in plain English with the rule that produced it. Always call this after making changes so you can tell the manager whether the week is legal - never assert compliance without checking.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `severity` | `"all"` \| `"hard"` \| `"soft"` | no | Hard breaches are statutory or contractual. Soft ones are fairness, cost and preference issues. Default `"all"`. |
| `staff` | string | no | Only breaches involving this person. |

### `get_coverage_gaps`

`readOnlyHint: true`

Every shift that still needs people, oldest first, with how many are missing. This is the work list for filling a rota.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | no | Restrict to one date. |

### `get_labor_cost`

`readOnlyHint: true`

Wage cost for the week against budget, broken down per person and per day, with overtime priced at the venue's multiplier. Use this before proposing changes that add hours.

_No parameters._


### `get_fairness_report`

`readOnlyHint: true`

How the week is distributed: hours against contract, shift counts, and who is carrying the weekends and the closes. Managers get this wrong by hand and staff notice. Use it to justify a rebalance.

_No parameters._


### `list_rules`

`readOnlyHint: true`

The venue's rule set: which rules are hard (statutory or contractual, never negotiable) versus soft (fairness, cost, preference), whether each is enabled, and any tunable value. Read this before you propose relaxing anything.

_No parameters._


### `get_week_grid`

`readOnlyHint: true`

A compact day-by-day text grid of the whole week: every shift, who is on it, and where the holes are. One call instead of seven list_shifts calls when you need the whole picture.

_No parameters._


### `explain_assignment`

`readOnlyHint: true`

Explain why one person on one shift is or is not a good fit: their hours, cost, overtime, rest window either side, and any rule they brush against. Use this when a manager asks you to justify a placement.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** |  |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no |  |

### `list_time_off_requests`

`readOnlyHint: true`

Every time off request on file with its status. Pending requests are the ones nobody has actioned yet - they are the usual cause of a rota falling apart at the last minute.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | `"all"` \| `"pending"` \| `"approved"` \| `"declined"` | no | Default `"all"`. |

## Write tools — these stage, they never commit

Each of these appends reversible `Edit`s to an open proposal. None of them changes the published rota. There is no `commit`, `approve` or `publish` tool anywhere in the imperative surface — that is the point of the project, not an oversight.

### `assign_staff`

mutating (stages only)

Propose putting a person on a shift. Checks every hard rule first and refuses with the specific reason if it would be illegal - so a refusal from this tool is a fact you can quote to the manager, not a guess. Use force only when the manager has explicitly accepted the breach.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** | Name or id. |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no | e.g. "opening", "closing", "16:30". |
| `force` | boolean | no | Stage the assignment even if it breaches a hard rule. Only after the manager has said so in as many words. Default `false`. |

### `unassign_staff`

mutating (stages only)

Propose taking a person off a shift. Reports the coverage hole this opens up.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** |  |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no |  |
| `reason` | string | no | Shown to the manager in the review list. |

### `swap_assignments`

mutating (stages only)

Propose swapping two people between two shifts, checking that both halves of the swap are legal. If you only know one side, use suggest_swap_for instead and let the page find the partner.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff_a` | string | **yes** |  |
| `shift_a_id` | string | **yes** |  |
| `staff_b` | string | **yes** |  |
| `shift_b_id` | string | **yes** |  |

### `suggest_swap_for`

mutating (stages only)

Given a person on a shift that is causing a problem, search the week for a two-way swap that clears the breach, and stage it if one exists. This is the fix for a close-then-open: nobody needs removing, two people just trade.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** |  |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no |  |
| `stage` | boolean | no | Stage the swap for approval. Set false to only report what is possible. Default `true`. |

### `fill_open_shifts`

mutating (stages only)

The heavy lifter. Runs the venue's scheduling solver over every unfilled slot and stages a complete set of assignments for approval. Honours every hard rule by construction, and optimises the soft ones according to the objective you choose. Tell it who is unavailable and whether overtime is allowed. Returns what it could not fill and precisely why.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `objective` | `"balanced"` \| `"minimise_cost"` \| `"maximise_fairness"` \| `"honour_preferences"` | no | balanced spreads the pain; minimise_cost avoids overtime and expensive staff; maximise_fairness evens out weekends, closes and hours; honour_preferences leans on stated preferences. Default `"balanced"`. |
| `avoid_overtime` | boolean | no | Refuse any assignment that would push someone past their contracted hours. Default `false`. |
| `dates` | array of string | no | Restrict to these dates. Defaults to the whole week. |
| `roles` | array of string | no |  |
| `exclude_staff` | array of string | no | Names or ids to keep off the rota entirely, e.g. someone off sick. |
| `only_staff` | array of string | no | Restrict the solver to these people only. |

### `cover_absence`

mutating (stages only)

Someone has called in sick or dropped out. Removes them from every shift on the given dates and stages replacements for all of it in one go, excluding them from the backfill. This is the single most common emergency in a rota and the thing managers most often get wrong under time pressure.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** | Who is absent. |
| `dates` | array of string | no | Dates they cannot work. Accepts YYYY-MM-DD or weekday names. |
| `date` | string | no | Shorthand for a single date. |
| `reason` | string | no | Default `"called in sick"`. |
| `record_time_off` | boolean | no | Also record approved time off so the absence is on file, not just unassigned. Default `true`. |
| `avoid_overtime` | boolean | no | Default `false`. |
| `objective` | `"balanced"` \| `"minimise_cost"` \| `"maximise_fairness"` \| `"honour_preferences"` | no | Default `"balanced"`. |

### `create_shift`

mutating (stages only)

Add a new shift to the week - a second baker for a busy Saturday, or an extra pair of hands for an event.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `date` | string | **yes** |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | **yes** |  |
| `start` | string | **yes** | Start time, e.g. "07:00" or "7am". |
| `end` | string | **yes** | End time, e.g. "15:30". |
| `headcount` | integer | no | Default `1`. |
| `label` | string | no | Short name, e.g. "Event bar". |
| `notes` | string | no |  |

### `update_shift`

mutating (stages only)

Change a shift's times, required headcount, role or notes. Reports anyone who no longer fits as a result.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no |  |
| `new_start` | string | no |  |
| `new_end` | string | no |  |
| `new_headcount` | integer | no |  |
| `new_role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `notes` | string | no |  |

### `delete_shift`

mutating (stages only)

Remove a shift from the week entirely - for example a slot the venue has decided not to staff. Anyone on it is released.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `shift_id` | string | no |  |
| `date` | string | no |  |
| `role` | `"barista"` \| `"baker"` \| `"shift_lead"` \| `"cashier"` | no |  |
| `when` | string | no |  |

### `record_time_off`

mutating (stages only)

Put time off on file for someone, or approve a pending request. Approving time off that clashes with a shift they are already on does not silently unassign them - it reports the clash so you can cover it deliberately with cover_absence.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | string | **yes** |  |
| `date` | string | **yes** |  |
| `status` | `"approved"` \| `"pending"` \| `"declined"` | no | Default `"approved"`. |
| `reason` | string | no | Default `"personal"`. |
| `start` | string | no | Optional start time for part-day leave. |
| `end` | string | no | Optional end time for part-day leave. |

### `set_rule`

mutating (stages only)

Enable, disable or retune a soft rule - for example widening the acceptable weekend spread, or relaxing the contracted-hours floor. Statutory rules such as rest periods, the under-18 curfew and time off cannot be switched off by a tool at all; if a manager asks, explain that and offer to change the schedule instead.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `rule_id` | string | **yes** | From list_rules. |
| `enabled` | boolean | no |  |
| `param` | number | no | New value for the rule's tunable knob. |

### `clear_week`

mutating (stages only)

Strip every assignment from the week so it can be rebuilt from scratch. Destructive, so confirm with the manager in words before calling it, and remember it still only stages - they will see the whole week greyed out for approval.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `confirm` | boolean | **yes** | Must be true. Set it only after the manager has agreed out loud. |
| `dates` | array of string | no |  |

### `fill_selected_shift`

mutating (stages only) · **Registered only while a shift is selected.**

Stage the best available people for every open slot on the shift the manager has selected. Use this for a single-shift fix rather than running the whole-week solver.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `avoid_overtime` | boolean | no | Default `false`. |
| `exclude` | array of string | no |  |

### `rebalance_selected_staff`

mutating (stages only) · **Registered only while a person is selected.**

Bring the selected person's hours towards their contract: stage extra shifts if they are short, or hand shifts to someone else if they are overloaded. Every move is checked against the rules and staged for approval.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `direction` | `"auto"` \| `"more_hours"` \| `"fewer_hours"` | no | auto works out which way they need to move from their contract. Default `"auto"`. |
| `max_changes` | integer | no | Default `3`. |

## View tools — steering the manager's screen

The tools a backend MCP server structurally cannot have. The agent and the manager are looking at the same pixels, so the agent can put the right week on screen and light up the shifts it is talking about.

### `focus_view`

mutating (stages only)

Change what the manager is looking at: switch between the week grid, the per-person view and the cost view, jump to a date, and select a shift or a person. Use it so the manager is looking at whatever you are talking about. Selecting a shift or a person also unlocks extra tools scoped to that selection.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `view` | `"week"` \| `"staff"` \| `"cost"` | no | week is the calendar grid, staff is per-person rows, cost is the budget breakdown. |
| `date` | string | no | Jump to the week containing this date. |
| `select_shift_id` | string | no |  |
| `select_staff` | string | no | Name or id. |
| `clear_selection` | boolean | no |  |

### `highlight`

mutating (stages only)

Draw the manager's eye to specific shifts, people or days, with a short caption explaining why. Call this whenever you name something in your reply - it is the difference between telling the manager there is a problem on Thursday and showing them.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `staff` | array of string | no | Names or ids. |
| `shift_ids` | array of string | no |  |
| `dates` | array of string | no |  |
| `note` | string | no | One short line shown as a caption, e.g. "only 9h rest between these two". |

### `selected_shift_cover_options`

`readOnlyHint: true` · **Registered only while a shift is selected.**

Rank everyone who can take the shift the manager currently has selected, with blockers for those who cannot. No arguments needed - it follows the selection on screen.

_No parameters._


### `selected_staff_week`

`readOnlyHint: true` · **Registered only while a person is selected.**

Summarise the week for the person the manager currently has selected: hours against contract, cost, every shift, and any rule they are close to breaching.

_No parameters._


### `jump_to_next_week`

mutating (stages only)

Move the manager's view to the following week and report its state.

_No parameters._


## Meta tools

Proposal bookkeeping and provenance.

### `request_approval`

mutating (stages only)

Open the review drawer so the manager can see every change you have staged, tick or untick individual ones, and approve or discard. Call this when your proposal is complete. You cannot approve on their behalf - there is no tool for that, by design - so end your turn here and tell them what you have proposed and what it costs.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `summary` | string | no | One or two sentences the manager reads at the top of the drawer. |

### `get_change_history`

`readOnlyHint: true`

Who changed what, and which tool call caused it. Every tool invocation on this page is recorded with its arguments, its result and the edits it produced. Use it to answer questions like why someone ended up on a shift.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | integer | no | Default `15`. |

### `review_time_off_requests`

`readOnlyHint: true` · **Registered only while at least one time off request is pending.**

There are unactioned time off requests. Walk the manager through each one: who asked, for when, and what approving it would cost in coverage. Approving is a write action, so it stages like anything else.

_No parameters._


## The declarative tool

Publishing the rota is not an imperative tool. It is an HTML `<form>` carrying the [declarative API](https://github.com/webmachinelearning/webmcp/blob/main/declarative-api-explainer.md) attributes, and its input schema is compiled from the form's own controls:

```html
<form
  id="publish-form"
  toolname="publish_schedule"
  tooldescription="Fills in the rota publishing form for the currently displayed week…"
>
  <textarea name="message" toolparamdescription="A short note sent to the team…"></textarea>
  <select name="notify" toolparamdescription="Who receives the notification…">…</select>
  <input type="checkbox" name="acknowledged" required
         toolparamdescription="The manager confirms they have reviewed the rota." />
  <button type="submit">Publish to the team</button>
</form>
```

Note what is **absent**: `toolautosubmit`. Per the spec, that means an agent may fill this form but may not submit it — the browser focuses the submit button and waits for a human. So the single most consequential action in the app, telling fourteen people when they are working, is reachable by an agent only as far as the button.

## Deliberate omissions

There is no tool to commit a proposal, approve a change, publish a rota, disable a statutory rule, or delete a person. Some of those are missing because they are dangerous; the first three are missing because they are the human's job. `set_rule` will refuse to switch off a statutory rule even if asked directly, and says why.
