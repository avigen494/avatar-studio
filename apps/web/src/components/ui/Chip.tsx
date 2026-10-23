"use client";

import type { ReactNode } from "react";
import { Tag } from "./Badge";

export interface ChipProps {
  active?: boolean;
  disabled?: boolean;
  tag?: string;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  role?: "radio" | "button";
  className?: string;
  title?: string;
}

export function Chip({ active = false, disabled = false, tag, onClick, children, icon, role = "button", className = "", title }: ChipProps) {
  const isDisabled = disabled || Boolean(tag);
  const state = role === "radio" ? { "aria-checked": active } : { "aria-pressed": active };
  return (
    <button
      type="button"
      role={role}
      title={title}
      {...state}
      disabled={isDisabled}
      onClick={onClick}
      className={[
        "inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[15px] font-medium transition-colors",
        active ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-fg hover:bg-surface-2",
        isDisabled ? "opacity-50 cursor-not-allowed" : "",
        className,
      ].join(" ")}
    >
      {icon}
      <span>{children}</span>
      {tag ? <Tag>{tag}</Tag> : null}
    </button>
  );
}

export interface ChipGroupProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  hint?: string;
  trailing?: ReactNode;
}

/** A labelled row of radio chips that scrolls horizontally on small screens. */
export function ChipGroup<T extends string>({ label, options, value, onChange, hint, trailing }: ChipGroupProps<T>) {
  const selected = options.find((o) => o.value === value);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-muted">{label}</span>
        {trailing}
      </div>
      <div className="rail" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <Chip key={o.value} role="radio" active={o.value === value} onClick={() => onChange(o.value)} title={o.hint}>
            {o.label}
          </Chip>
        ))}
      </div>
      {hint ?? selected?.hint ? <p className="text-xs text-muted">{hint ?? selected?.hint}</p> : null}
    </div>
  );
}
