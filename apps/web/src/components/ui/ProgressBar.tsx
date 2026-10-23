export function ProgressBar({
  value,
  label,
  tone = "accent",
  className = "",
  indeterminate = false,
}: {
  value: number;
  label?: string;
  tone?: "accent" | "amber" | "red" | "green";
  className?: string;
  indeterminate?: boolean;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const color = { accent: "bg-accent", amber: "bg-amber", red: "bg-red", green: "bg-green" }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : v}
      aria-label={label}
      className={`h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      <div
        className={`h-full rounded-full ${color} transition-[width] duration-500 ${indeterminate ? "w-1/3 animate-pulse" : ""}`}
        style={indeterminate ? undefined : { width: `${v}%` }}
      />
    </div>
  );
}
