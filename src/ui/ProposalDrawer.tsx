import { useEffect, useMemo, useState } from "react";
import { coverageGaps, validateAll } from "../engine/evaluate";
import { costReport } from "../engine/cost";
import { applyEdits } from "../store/edits";
import { previewRoster, useStore } from "../store/store";
import { Button, Icon, ICONS, cx } from "./bits";

/**
 * The consent surface.
 *
 * Every agent write lands here first. The manager sees each change as a line
 * they can untick, the net effect on coverage, cost and legality, and two
 * buttons. Approve is the only path from proposal to schedule, and it exists
 * only in this component -- no tool can reach it.
 */
export function ProposalBar() {
  const proposal = useStore((s) => s.proposal);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openDrawer = () => setOpen(true);
    window.addEventListener("rota:open-review", openDrawer);
    return () => window.removeEventListener("rota:open-review", openDrawer);
  }, []);

  useEffect(() => {
    if (!proposal) setOpen(false);
  }, [proposal]);

  if (!proposal || proposal.edits.length === 0) return null;

  const accepted = proposal.edits.filter((e) => e.accepted).length;
  const byAuthor = [...new Set(proposal.edits.map((e) => e.author))];

  return (
    <>
      <div className="rise pointer-events-auto absolute inset-x-0 bottom-0 z-40 border-t border-hairline material-thick px-4 py-2.5 shadow-float">
        <div className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-purple-soft text-purple">
            <Icon path={ICONS.sparkle} size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-label">
              {proposal.intent ?? "Proposed changes"}
            </p>
            <p className="truncate text-[11px] text-label-2">
              {accepted} of {proposal.edits.length} change{proposal.edits.length === 1 ? "" : "s"}{" "}
              selected · proposed by {byAuthor.join(", ")} · nothing applied yet
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)} testId="open-review">
            Review
          </Button>
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={accepted === 0}>
            <Icon path={ICONS.check} size={13} />
            Approve {accepted}
          </Button>
        </div>
      </div>
      {open && <ReviewDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function ReviewDrawer({ onClose }: { onClose: () => void }) {
  const proposal = useStore((s) => s.proposal);
  const committed = useStore((s) => s.roster);
  const toggleEdit = useStore((s) => s.toggleEdit);
  const commitProposal = useStore((s) => s.commitProposal);
  const discardProposal = useStore((s) => s.discardProposal);
  const setHighlight = useStore((s) => s.setHighlight);
  const preview = useStore(previewRoster);

  const stats = useMemo(() => {
    const before = validateAll(committed);
    const after = validateAll(preview);
    const costBefore = costReport(committed);
    const costAfter = costReport(preview);
    // "Unfilled" and "hard breach" are counted separately here, matching the
    // summary strip: an empty slot is unfinished work, a rule breach is not.
    const isBreach = (v: { severity: string; ruleId: string }) =>
      v.severity === "hard" && v.ruleId !== "coverage_met";
    return {
      hardBefore: before.filter(isBreach).length,
      hardAfter: after.filter(isBreach).length,
      softBefore: before.filter((v) => v.severity === "soft").length,
      softAfter: after.filter((v) => v.severity === "soft").length,
      gapsBefore: coverageGaps(committed).reduce((n, g) => n + g.missing, 0),
      gapsAfter: coverageGaps(preview).reduce((n, g) => n + g.missing, 0),
      costBefore: costBefore.total,
      costAfter: costAfter.total,
      currency: committed.venue.currency,
    };
  }, [committed, preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!proposal) return null;
  const accepted = proposal.edits.filter((e) => e.accepted);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Review proposed changes">
      <button
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close review"
        tabIndex={-1}
      />
      <div className="rise relative flex h-full w-full max-w-[480px] flex-col border-l border-hairline bg-base shadow-float">
        <header className="shrink-0 border-b border-hairline px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-label">
                Review changes
              </h2>
              <p className="mt-0.5 text-[12px] text-label-2">
                {proposal.intent ?? "Proposed by the agent"}
              </p>
            </div>
            <Button variant="subtle" size="sm" onClick={onClose} ariaLabel="Close">
              <Icon path={ICONS.x} size={14} />
            </Button>
          </div>

          <dl className="mt-3.5 grid grid-cols-4 gap-2">
            <Delta label="Unfilled" from={stats.gapsBefore} to={stats.gapsAfter} lowerIsBetter />
            <Delta label="Breaches" from={stats.hardBefore} to={stats.hardAfter} lowerIsBetter />
            <Delta label="Soft" from={stats.softBefore} to={stats.softAfter} lowerIsBetter />
            <Delta
              label="Cost"
              from={Math.round(stats.costBefore)}
              to={Math.round(stats.costAfter)}
              prefix={stats.currency}
              lowerIsBetter
              neutral
            />
          </dl>
        </header>

        <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-4">
          {proposal.edits.map((edit, i) => (
            <li key={edit.id}>
              <label
                onMouseEnter={() =>
                  setHighlight({
                    staffIds: edit.touches.staffIds,
                    shiftIds: edit.touches.shiftIds,
                    dates: edit.touches.dates,
                    note: edit.summary,
                  })
                }
                className={cx(
                  "flex cursor-pointer items-start gap-2.5 rounded-apple border p-2.5 transition-colors",
                  edit.accepted
                    ? "border-hairline bg-raised"
                    : "border-dashed border-hairline bg-transparent opacity-55",
                )}
              >
                <input
                  type="checkbox"
                  checked={edit.accepted}
                  onChange={() => toggleEdit(edit.id)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                  aria-label={`Include: ${edit.summary}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-snug text-label">{edit.summary}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-label-3">
                    <span className="tabular-nums">{i + 1}</span>
                    <span>·</span>
                    <span className="font-mono">{edit.kind}</span>
                    <span>·</span>
                    <span>{edit.author}</span>
                    {edit.sourceCallId !== "direct" && (
                      <>
                        <span>·</span>
                        <span className="font-mono">call {edit.sourceCallId}</span>
                      </>
                    )}
                  </p>
                </div>
              </label>
            </li>
          ))}
        </ol>

        <footer className="shrink-0 space-y-2.5 border-t border-hairline px-5 py-4">
          <p className="text-[11px] leading-relaxed text-label-2">
            {accepted.length === 0
              ? "Nothing selected. Tick at least one change to approve."
              : `Approving applies ${accepted.length} change${accepted.length === 1 ? "" : "s"} to the draft rota. It stays a draft until you publish, and you can undo it.`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              disabled={accepted.length === 0}
              onClick={() => {
                commitProposal();
                onClose();
              }}
              className="flex-1"
              testId="approve-proposal"
            >
              <Icon path={ICONS.check} size={15} />
              Approve {accepted.length} change{accepted.length === 1 ? "" : "s"}
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={() => {
                discardProposal();
                onClose();
              }}
            >
              Discard all
            </Button>
          </div>
          <PreviewNote proposal={proposal} />
        </footer>
      </div>
    </div>
  );
}

function PreviewNote({ proposal }: { proposal: NonNullable<ReturnType<typeof useStore.getState>["proposal"]> }) {
  const committed = useStore((s) => s.roster);
  const wouldBe = useMemo(
    () => applyEdits(committed, proposal.edits.filter((e) => e.accepted), "forward"),
    [committed, proposal],
  );
  const all = validateAll(wouldBe);
  const hard = all.filter((v) => v.severity === "hard" && v.ruleId !== "coverage_met");
  const unfilled = all.filter((v) => v.ruleId === "coverage_met");

  if (hard.length === 0) {
    return (
      <div className="space-y-1">
        <p className="flex items-start gap-1.5 text-[11px] font-medium text-green">
          <Icon path={ICONS.check} size={12} />
          With these changes the week breaches no rules.
        </p>
        {unfilled.length > 0 && (
          <p className="text-[10.5px] leading-snug text-orange">
            {unfilled.length} slot{unfilled.length === 1 ? "" : "s"} would still be unfilled.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-apple bg-red-soft p-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-red">
        <Icon path={ICONS.alert} size={12} />
        {hard.length} hard breach{hard.length === 1 ? "" : "es"} would remain
      </p>
      <ul className="space-y-0.5">
        {hard.slice(0, 3).map((v, i) => (
          <li key={i} className="text-[10.5px] leading-snug text-red">
            {v.message}
          </li>
        ))}
      </ul>
      {unfilled.length > 0 && (
        <p className="text-[10.5px] leading-snug text-orange">
          Plus {unfilled.length} slot{unfilled.length === 1 ? "" : "s"} still unfilled.
        </p>
      )}
    </div>
  );
}

function Delta({
  label,
  from,
  to,
  prefix = "",
  lowerIsBetter,
  neutral,
}: {
  label: string;
  from: number;
  to: number;
  prefix?: string;
  lowerIsBetter?: boolean;
  neutral?: boolean;
}) {
  const changed = from !== to;
  const better = lowerIsBetter ? to < from : to > from;
  const tone = !changed || neutral ? "neutral" : better ? "good" : "bad";
  return (
    <div className="rounded-apple border border-hairline bg-raised px-2 py-1.5">
      <dt className="text-[9px] font-semibold tracking-wider text-label-3 uppercase">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[15px] font-semibold tabular-nums text-label">
          {prefix}
          {to}
        </span>
        {changed && (
          <span
            className={cx(
              "text-[10px] font-medium tabular-nums",
              tone === "good" ? "text-green" : tone === "bad" ? "text-red" : "text-label-3",
            )}
          >
            {to > from ? "+" : ""}
            {to - from}
          </span>
        )}
      </dd>
    </div>
  );
}

/** Small persistent reminder that the agent has no commit authority. */
export function ConsentNotice() {
  return (
    <div className="flex items-start gap-2 border-t border-hairline bg-inset px-4 py-2.5">
      <span className="mt-px text-label-3">
        <Icon path={ICONS.eye} size={13} />
      </span>
      <p className="text-[10.5px] leading-relaxed text-label-2">
        The agent has <strong className="font-semibold text-label">no tool that commits</strong>{" "}
        anything. It reads, it ranks, it proposes. Approving and publishing are yours alone.
      </p>
    </div>
  );
}
