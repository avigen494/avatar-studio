"use client";

import { ChevronLeft, Ellipsis, FolderOpen, Home, Mic, Plus, Settings, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ComponentType, type ReactNode } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { ScreenSkeleton } from "@/components/ui/Skeleton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

const TABS: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/avatars", label: "Avatars", icon: UserRound },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/voices", label: "Voices", icon: Mic },
  { href: "/more", label: "More", icon: Ellipsis },
];

const SIDE: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/create", label: "Create", icon: Plus },
  { href: "/avatars", label: "Avatars", icon: UserRound },
  { href: "/voices", label: "Voices", icon: Mic },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/more") return pathname === "/more";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hideTabs = pathname.startsWith("/create") || pathname.startsWith("/onboarding");

  return (
    <div className="min-h-dvh lg:pl-64">
      <SideNav pathname={pathname} />
      <MobileHeader pathname={pathname} />
      <main
        className="mx-auto w-full max-w-3xl px-4 pt-3 lg:pt-8"
        style={{ paddingBottom: hideTabs ? "var(--safe-bottom)" : "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
      >
        <Suspense fallback={<ScreenSkeleton />}>{children}</Suspense>
      </main>
      {hideTabs ? null : <TabBar pathname={pathname} />}
    </div>
  );
}

function CreditsPill() {
  const { me, loading } = useMe();
  if (loading || !me) return <span className="skeleton inline-block h-8 w-20 rounded-full" aria-hidden />;
  return (
    <Link
      href="/settings/plan"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm font-semibold"
      aria-label={`${me.credits} credits. Open plan and credits.`}
    >
      <Sparkles size={16} className="text-accent" aria-hidden />
      {me.credits} credits
    </Link>
  );
}

function MobileHeader({ pathname }: { pathname: string }) {
  const atHome = pathname === "/";
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:hidden"
      style={{ paddingTop: "var(--safe-top)", minHeight: "calc(52px + var(--safe-top))" }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {!atHome ? (
          <Link href="/" aria-label="Back to home" className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-full">
            <ChevronLeft size={24} />
          </Link>
        ) : null}
        <Link href="/" className="truncate text-base font-bold tracking-tight">
          Avatar Studio
        </Link>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <WorkspaceSwitcher variant="header" />
        <CreditsPill />
      </div>
    </header>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5" style={{ height: "var(--tabbar-h)" }}>
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          const Icon = t.icon;
          const center = t.href === "/create";
          return (
            <li key={t.href} className="flex items-stretch">
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                aria-label={center ? "Create video" : undefined}
                className={[
                  "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold",
                  active ? "text-accent" : "text-muted",
                ].join(" ")}
              >
                {center ? (
                  <span className="-mt-5 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg">
                    <Icon size={28} strokeWidth={2.5} />
                  </span>
                ) : (
                  <Icon size={24} strokeWidth={active ? 2.5 : 2} />
                )}
                <span className={center ? "sr-only" : ""}>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SideNav({ pathname }: { pathname: string }) {
  const { me } = useMe();
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-lg font-bold tracking-tight">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-on-accent">
          <Sparkles size={18} />
        </span>
        Avatar Studio
      </Link>
      <nav aria-label="Main">
        <ul className="space-y-1">
          {SIDE.map((t) => {
            const active = isActive(pathname, t.href);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium",
                    active ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-2",
                  ].join(" ")}
                >
                  <Icon size={20} />
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto space-y-2 px-2 text-sm text-muted">
        <WorkspaceSwitcher variant="side" />
        {me ? (
          <Link href="/settings/plan" className="block rounded-lg px-0.5 hover:text-fg">
            <span className="font-semibold text-fg">{me.credits}</span> credits · Plan & credits
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
