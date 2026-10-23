import type { ReactNode } from "react";

/**
 * Fixed action area at the bottom of the viewport on phones (above the tab
 * bar when it is visible). On desktop it docks right of the side nav.
 */
export function PinnedBar({ children, aboveTabs = true, className = "" }: { children: ReactNode; aboveTabs?: boolean; className?: string }) {
  return (
    <div
      className={`pinned ${className}`}
      style={{
        bottom: aboveTabs ? "calc(var(--tabbar-h) + var(--safe-bottom))" : 0,
        paddingBottom: aboveTabs ? 12 : "calc(12px + var(--safe-bottom))",
      }}
    >
      <div className="mx-auto w-full max-w-3xl px-4 pt-3">{children}</div>
    </div>
  );
}

/** Reserve space under scrolling content so the pinned bar never covers it. */
export function PinnedSpacer({ size = 88 }: { size?: number }) {
  return <div aria-hidden style={{ height: size }} />;
}
