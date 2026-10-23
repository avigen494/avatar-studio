"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Tag } from "./Badge";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Version tag ("v2", "v3", "Soon"): shows the tag and disables the button. */
  tag?: string;
  full?: boolean;
  icon?: ReactNode;
  href?: string;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong",
  secondary: "bg-surface-2 text-fg hover:bg-line",
  ghost: "bg-transparent text-fg hover:bg-surface-2",
  danger: "bg-red-soft text-red hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "min-h-10 px-3 text-sm rounded-lg",
  md: "min-h-12 px-4 text-base rounded-xl",
  lg: "min-h-14 px-5 text-[17px] rounded-2xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", full = false, extra = "") {
  return [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:pointer-events-none",
    variants[variant],
    sizes[size],
    full ? "w-full" : "",
    extra,
  ].join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  tag,
  full = false,
  icon,
  href,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading || Boolean(tag);
  const cls = buttonClass(variant, size, full, className);
  const content = (
    <>
      {loading ? <BusyDots /> : icon}
      <span>{children}</span>
      {tag ? <Tag>{tag}</Tag> : null}
    </>
  );
  if (href && !isDisabled) {
    return (
      <Link href={href} className={cls}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} disabled={isDisabled} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
}

function BusyDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
    </span>
  );
}

/** Icon-only button with a required label for screen readers. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-fg hover:bg-surface-2 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
