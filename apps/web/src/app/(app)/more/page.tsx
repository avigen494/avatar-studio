"use client";

import { BarChart3, ChevronRight, Code2, CreditCard, FlaskConical, FolderOpen, LogOut, Plug, Settings, Sparkles, Table, Users } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMe } from "@/components/auth/MeProvider";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { useIsAdmin } from "@/lib/admin";

const LINKS = [
  { href: "/projects", label: "Projects", body: "Folders, search and credits per project", icon: FolderOpen },
  { href: "/batch", label: "Batch from CSV", body: "Up to 100 personalised videos from one spreadsheet", icon: Table },
  { href: "/settings/plan", label: "Plan & credits", body: "Change plan, top up, extra seats, invoices", icon: CreditCard },
  { href: "/settings/team", label: "Team", body: "Members, roles and invites", icon: Users },
  { href: "/settings/developers", label: "Developers", body: "API keys, webhooks, quick start", icon: Code2 },
  { href: "/settings", label: "Settings", body: "Account, workspace, brand kit, glossary", icon: Settings },
  { href: "/onboarding", label: "Set-up guide", body: "Record, choose a voice, make a video", icon: Sparkles },
];

const ADMIN_LINKS = [
  { href: "/settings/connections", label: "Connections", body: "API keys for voices, Claude, RunPod, storage, sign-in", icon: Plug },
  { href: "/settings/lab", label: "Engine Lab", body: "Compare avatar engines and adopt a default", icon: FlaskConical },
  { href: "/settings/usage", label: "Usage", body: "Videos, success rate, cost per minute, paying workspaces", icon: BarChart3 },
];

export default function MorePage() {
  const { me } = useMe();
  const auth = useAuth();
  const admin = useIsAdmin();
  const links = admin.isAdmin ? [...LINKS, ...ADMIN_LINKS] : LINKS;
  return (
    <div className="space-y-6">
      <PageHeader title="More" subtitle={me ? `${me.user.name || me.user.email} · ${me.workspace.name}` : undefined} />
      <Card className="divide-y divide-line p-0">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-fg">
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{l.label}</span>
                <span className="block text-sm text-muted">{l.body}</span>
              </span>
              <ChevronRight className="text-muted" />
            </Link>
          );
        })}
      </Card>
      <Button variant="secondary" full icon={<LogOut size={18} />} onClick={() => auth.signOut()}>
        Sign out
      </Button>
    </div>
  );
}
