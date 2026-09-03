import type { ReactNode } from "react";
import type { Role, RuleSeverity, StaffMember } from "../types";
import { ROLE_LABEL } from "../types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Avatars use a single hue per person at a fixed, restrained saturation. */
export function Avatar({
  person,
  size = 24,
  ring,
}: {
  person: StaffMember;
  size?: number;
  ring?: boolean;
}) {
  const initials = person.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        ring && "ring-2 ring-accent ring-offset-1 ring-offset-raised",
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        letterSpacing: "0.01em",
        background: `oklch(0.7 0.09 ${person.avatarHue})`,
        color: `oklch(0.28 0.06 ${person.avatarHue})`,
      }}
    >
      {initials}
    </span>
  );
}

const ROLE_TONE: Record<Role, string> = {
  barista: "bg-blue-soft text-blue",
  baker: "bg-orange-soft text-orange",
  shift_lead: "bg-green-soft text-green",
  cashier: "bg-purple-soft text-purple",
};

export function RoleChip({ role, short }: { role: Role; short?: boolean }) {
  return (
    <span
      className={cx(
        "rounded-md px-1.5 py-px text-[10px] font-semibold tracking-[0.02em]",
        ROLE_TONE[role],
      )}
    >
      {short ? ROLE_LABEL[role].split(" ")[0] : ROLE_LABEL[role]}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: RuleSeverity }) {
  return (
    <span
      className={cx(
        "mt-1 inline-block size-[6px] shrink-0 rounded-full",
        severity === "hard" ? "bg-red" : "bg-orange",
      )}
    />
  );
}

const BADGE_TONES = {
  neutral: "bg-inset text-label-2",
  good: "bg-green-soft text-green",
  warn: "bg-orange-soft text-orange",
  bad: "bg-red-soft text-red",
  agent: "bg-purple-soft text-purple",
  info: "bg-blue-soft text-blue",
};

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

const BUTTON_VARIANTS = {
  /* Apple's filled pill: solid accent, white label, no border. */
  primary:
    "bg-accent text-accent-label hover:bg-accent-hover font-medium shadow-sm disabled:bg-inset disabled:text-label-3 disabled:shadow-none",
  /* Bordered, the default macOS push button. */
  ghost: "bg-raised text-label border border-hairline hover:bg-hover shadow-sm",
  /* Borderless, for toolbars. */
  subtle: "bg-transparent text-label-2 hover:bg-hover hover:text-label",
  danger: "bg-transparent text-red hover:bg-red-soft",
  tinted: "bg-accent-soft text-accent hover:brightness-95 font-medium",
};

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  title,
  type = "button",
  className,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
        size === "sm" ? "px-2.5 py-1 text-xs" : size === "lg" ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-[13px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Meter({
  value,
  max,
  tone = "accent",
  label,
}: {
  value: number;
  max: number;
  tone?: "accent" | "green" | "orange";
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = value > max + 0.01;
  const colors = { accent: "bg-fill-blue", green: "bg-fill-green", orange: "bg-fill-orange" };
  return (
    <div
      className="h-[5px] w-full overflow-hidden rounded-full bg-inset"
      role="meter"
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500",
          over ? "bg-fill-red" : colors[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** iOS segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** iOS switch. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200",
        checked ? "bg-green" : "bg-inset",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className="absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(16px)" : "none" }}
      />
    </button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
      <h2 className="text-[11px] font-semibold tracking-[0.06em] text-label-3 uppercase">
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-xs text-label-3">{children}</p>;
}

export function Icon({ path, size = 15 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

export const ICONS = {
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18M6 6l12 12",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronDown: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  alert: "M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z",
  sparkle: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Zm7 11 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z",
  undo: "M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8",
  redo: "M21 7v6h-6M21 13a9 9 0 1 1-3-7.7L21 8",
  key: "M15.5 7.5a4 4 0 1 1-5.66 5.66L3 20v-3h3v-3h3l.84-.84A4 4 0 0 1 15.5 7.5Z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  stop: "M7 7h10v10H7z",
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  scale: "M12 3v18M8 7H3l2.5 6h5L8 7Zm13 0h-5l2.5 6h5L21 7Z",
  users:
    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v6l4 2",
  book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 1 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15Z",
  tool: "M14.7 6.3a4 4 0 0 1 5 5L9 22l-5-5L14.7 6.3Zm0 0L19 2l3 3-4.3 4.3",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  reset: "M21 12a9 9 0 1 1-3-6.7M21 3v6h-6",
  plug: "M9 2v6m6-6v6M5 8h14v3a7 7 0 0 1-14 0V8Zm7 10v4",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 18v-2M3 12h2m18 0h-2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  calendar: "M8 2v4m8-4v4M3 10h18M5 6h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
  wand: "M15 4V2m0 20v-2M4 15H2m20 0h-2M6.3 6.3 4.9 4.9m12.8 12.8 1.4 1.4M3 21 21 3",
};
