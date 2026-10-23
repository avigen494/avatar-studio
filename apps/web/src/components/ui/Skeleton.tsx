export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-4" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-line bg-surface p-4 ${className}`} aria-busy>
      <div className="flex items-center gap-3">
        <div className="skeleton h-14 w-14 rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-2/3" />
          <div className="skeleton h-3 w-1/3" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Screen-level skeleton used by Suspense fallbacks. */
export function ScreenSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4" aria-busy aria-label="Loading">
      <div className="skeleton h-8 w-1/2" />
      <SkeletonCard />
      <SkeletonCard />
      <div className="skeleton h-40 w-full rounded-2xl" />
    </div>
  );
}
