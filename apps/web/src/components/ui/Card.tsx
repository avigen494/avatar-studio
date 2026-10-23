import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-4 py-8 text-center">
      {icon ? <div className="mb-3 text-muted">{icon}</div> : null}
      <p className="text-base font-semibold">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "amber" | "red" | "green" | "accent";
  children: ReactNode;
  className?: string;
}) {
  const map = {
    neutral: "bg-surface-2 text-fg",
    amber: "bg-amber-soft text-amber",
    red: "bg-red-soft text-red",
    green: "bg-green-soft text-green",
    accent: "bg-accent-soft text-accent",
  } as const;
  return (
    <div role={tone === "red" ? "alert" : undefined} className={`rounded-xl px-3 py-2.5 text-sm ${map[tone]} ${className}`}>
      {children}
    </div>
  );
}
