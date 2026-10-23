"use client";

import { useId, type ReactNode } from "react";

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  note,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Shown under the label when disabled (why it cannot be changed). */
  note?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-base font-medium">
          {label}
        </label>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
        {disabled && note ? <p className="text-xs text-muted">{note}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-accent" : "bg-line",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-7" : "translate-x-1",
          ].join(" ")}
          aria-hidden
        />
      </button>
    </div>
  );
}
