import { useMemo, useState } from "react";
import { coverageGaps, validateAll } from "../engine/evaluate";
import { fmtDateShort, weekDates } from "../engine/time";
import { previewRoster, useStore } from "../store/store";
import { Badge, Button, Icon, ICONS, SectionTitle, cx } from "./bits";

/**
 * Publishing is a declarative WebMCP tool, not an imperative one.
 *
 * The form below carries `toolname` / `tooldescription` / `toolparamdescription`
 * attributes, so the browser (or Rota's polyfill) synthesises a tool from the
 * form's own controls. What it deliberately does NOT carry is
 * `toolautosubmit` -- which, per the spec, means an agent may fill this form
 * but the browser will only focus the submit button and leave the press to the
 * human.
 *
 * So the most consequential action in the app -- telling twelve people when
 * they are working -- is reachable by an agent only as far as the button. That
 * is the whole argument of this project expressed in one HTML attribute.
 */
export function PublishPanel() {
  const roster = useStore(previewRoster);
  const committed = useStore((s) => s.roster);
  const proposal = useStore((s) => s.proposal);
  const publish = useStore((s) => s.publish);
  const publishedAt = useStore((s) => s.publishedAt);
  const weekStart = useStore((s) => s.weekStart);
  const [receipt, setReceipt] = useState<string | null>(null);

  const dates = weekDates(weekStart);
  const weekShifts = useMemo(
    () => Object.values(committed.shifts).filter((s) => dates.includes(s.date)),
    [committed.shifts, dates],
  );
  const gaps = useMemo(() => coverageGaps(roster).reduce((n, g) => n + g.missing, 0), [roster]);
  const hard = useMemo(
    () => validateAll(roster).filter((v) => v.severity === "hard").length,
    [roster],
  );
  const pending = proposal?.edits.filter((e) => e.accepted).length ?? 0;
  const draftCount = weekShifts.filter((s) => s.status === "draft").length;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    publish(weekShifts.map((s) => s.id));
    const audience = String(data.get("notify") ?? "everyone");
    setReceipt(
      `Published ${weekShifts.length} shifts for the week of ${fmtDateShort(weekStart)} to ${audience}${data.get("message") ? ` with your note attached` : ""}. You pressed this button, not the agent.`,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <SectionTitle>Publish</SectionTitle>

      <div className="space-y-2.5 px-4 pb-4">
        <div className="rounded-apple border border-hairline bg-raised p-3">
          <p className="text-[12px] font-medium text-label">
            Week of {fmtDateShort(weekStart)} — {weekShifts.length} shifts
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={draftCount > 0 ? "warn" : "good"}>
              {draftCount > 0 ? `${draftCount} draft` : "all published"}
            </Badge>
            <Badge tone={gaps > 0 ? "warn" : "good"}>{gaps} unfilled</Badge>
            <Badge tone={hard > 0 ? "bad" : "good"}>{hard} hard breaches</Badge>
            {pending > 0 && <Badge tone="agent">{pending} unapproved</Badge>}
          </div>
          {pending > 0 && (
            <p className="mt-2 text-[10.5px] leading-relaxed text-purple">
              There are {pending} proposed changes still waiting on you. Approve or discard them
              first — publishing sends the approved draft, not the proposal.
            </p>
          )}
        </div>

        <div className="rounded-apple border border-hairline bg-inset p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-label">
            <span className="text-green">
              <Icon path={ICONS.layers} size={13} />
            </span>
            Declarative WebMCP tool
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-label-2">
            This form is exposed as the tool{" "}
            <code className="font-mono text-label">publish_schedule</code>, its input schema
            compiled from the fields below. It has no{" "}
            <code className="font-mono text-label">toolautosubmit</code> attribute, so an agent can
            fill it in and then must stop: the browser focuses Publish and waits for you.
          </p>
        </div>

        {/* The declarative tool. No toolautosubmit, on purpose. */}
        <form
          id="publish-form"
          toolname="publish_schedule"
          tooldescription="Fills in the rota publishing form for the currently displayed week: the note that goes out to staff, who gets notified, and the acknowledgement checkbox. Use this once the manager has approved the changes they want. You cannot submit it."
          onSubmit={onSubmit}
          className="space-y-3 rounded-apple border border-hairline bg-raised p-3.5 data-[agent-filled=true]:agent-filled"
        >
          <label className="block">
            <span className="text-[10px] font-semibold tracking-wider text-label-3 uppercase">
              Note to staff
            </span>
            <textarea
              name="message"
              rows={3}
              toolparamdescription="A short note sent to the team alongside the rota, e.g. explaining a change of cover."
              placeholder="Thanks all — Thursday cover has changed, see below."
              className="mt-1 w-full resize-none rounded-md border border-hairline bg-inset px-2.5 py-2 text-[12px] outline-none focus:border-accent/60"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold tracking-wider text-label-3 uppercase">
              Notify
            </span>
            <select
              name="notify"
              defaultValue="everyone"
              toolparamdescription="Who receives the notification: everyone on the rota, only the shift leads, or nobody."
              className="mt-1 w-full rounded-md border border-hairline bg-inset px-2.5 py-2 text-[12px] outline-none focus:border-accent/60"
            >
              <option value="everyone">Everyone on the rota</option>
              <option value="leads">Shift leads only</option>
              <option value="nobody">Nobody — publish quietly</option>
            </select>
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="acknowledged"
              required
              toolparamdescription="The manager confirms they have reviewed the rota. Must be true to submit."
              className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="text-[11px] leading-snug text-label-2">
              I have reviewed this rota and I am happy for the team to see it.
            </span>
          </label>

          <Button type="submit" variant="primary" size="lg" className="w-full">
            <Icon path={ICONS.send} size={14} />
            Publish to the team
          </Button>

          <p className="text-center text-[10px] text-label-3">
            Only a human press works here.
          </p>
        </form>

        {receipt && (
          <div className="rise rounded-apple border border-hairline bg-green-soft p-3">
            <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed font-medium text-green">
              <span className="mt-px">
                <Icon path={ICONS.check} size={13} />
              </span>
              {receipt}
            </p>
          </div>
        )}

        {publishedAt && !receipt && (
          <p className="text-center text-[10.5px] text-label-3">
            Last published {new Date(publishedAt).toLocaleTimeString("en-GB")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Small header pill showing whether the visible week is published. */
export function PublishStatus() {
  const committed = useStore((s) => s.roster);
  const weekStart = useStore((s) => s.weekStart);
  const dates = weekDates(weekStart);
  const weekShifts = Object.values(committed.shifts).filter((s) => dates.includes(s.date));
  const drafts = weekShifts.filter((s) => s.status === "draft").length;
  return (
    <span
      className={cx(
        "rounded-md px-2 py-0.5 text-[10.5px] font-medium",
        drafts > 0 ? "bg-inset text-label-2" : "bg-green-soft text-green",
      )}
    >
      {drafts > 0 ? "Draft" : "Published"}
    </span>
  );
}
