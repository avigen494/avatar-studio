import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "green" | "amber" | "red";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
};

export function Badge({ tone = "neutral", children, className = "", title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Small version tag for features that are not in this release. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1 inline-flex items-center rounded-md border border-line px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-muted">
      {children}
    </span>
  );
}

export function videoStatusTone(status: string): { tone: Tone; label: string } {
  switch (status) {
    case "succeeded":
      return { tone: "green", label: "Ready" };
    case "rendering":
      return { tone: "accent", label: "Rendering" };
    case "queued":
      return { tone: "accent", label: "Waiting" };
    case "failed":
      return { tone: "red", label: "Failed" };
    case "cancelled":
      return { tone: "neutral", label: "Cancelled" };
    case "draft":
    default:
      return { tone: "neutral", label: "Draft" };
  }
}

export function StatusPill({ status }: { status: string }) {
  const { tone, label } = videoStatusTone(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function identityStatusTone(status: string, consent: string): { tone: Tone; label: string } {
  if (status === "failed" || consent === "rejected") return { tone: "red", label: "Needs a new recording" };
  if (status === "verifying" || consent === "pending") return { tone: "amber", label: "Verifying" };
  if (status === "ready" && consent === "verified") return { tone: "green", label: "Ready" };
  if (status === "ready") return { tone: "accent", label: "Photo mode" };
  return { tone: "neutral", label: "Not set up" };
}

export function IdentityPill({ status, consent }: { status: string; consent: string }) {
  const { tone, label } = identityStatusTone(status, consent);
  return <Badge tone={tone}>{label}</Badge>;
}
