"use client";

import { Copy, LogOut, Mail, Plus, Trash2, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Input, Select } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SkeletonList, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, isApiError } from "@/lib/api";
import { setWorkspaceId } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { formatDate, roleLabel } from "@/lib/format";
import { copyText, useApi } from "@/lib/hooks";
import type { InviteOut, InviteRole, MemberOut, Role } from "@/lib/types";

const INVITE_ROLES: { value: InviteRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Everything except billing ownership: members, avatars, plan." },
  { value: "editor", label: "Editor", hint: "Makes videos with the avatars they are allowed to use." },
  { value: "viewer", label: "Viewer", hint: "Watches and downloads videos. Cannot spend credits." },
];

const ALL_ROLES: Role[] = ["owner", "admin", "editor", "viewer"];

export function TeamScreen() {
  const { me, refetch: refetchMe } = useMe();
  const { toast } = useToast();
  const router = useRouter();
  const role = me?.workspace.role ?? null;
  const isAdmin = role === "owner" || role === "admin";
  const seats = useApi(() => api.workspace.seats(), ["seats"]);
  const members = useApi(() => api.workspace.members(), ["members"]);
  const invites = useApi(() => api.workspace.invites(), ["invites"], { enabled: isAdmin });
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removing, setRemoving] = useState<MemberOut | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seatNotice, setSeatNotice] = useState<string | null>(null);
  // Taken once per visit; an invite that expires while the page is open still copies until a reload.

  if (!me) {
    return (
      <div className="space-y-4">
        <SkeletonText lines={1} />
        <SkeletonList count={3} />
      </div>
    );
  }

  const pending = (invites.data ?? []).filter((i) => !i.accepted_at);
  const used = seats.data ? seats.data.members + seats.data.pending_invites : null;

  function refreshCounts() {
    seats.refetch();
  }

  async function changeRole(m: MemberOut, next: Role) {
    setBusy(`role:${m.user.id}`);
    try {
      const res = await api.workspace.setRole(m.user.id, next);
      members.setData((list) => list?.map((x) => (x.user.id === m.user.id ? { ...x, role: res.role } : x)));
      toast(`${m.user.name || m.user.email} is now ${roleLabel(res.role).toLowerCase()}.`, "success");
      if (m.user.id === me?.user.id) refetchMe();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(m: MemberOut) {
    setBusy(`remove:${m.user.id}`);
    try {
      await api.workspace.removeMember(m.user.id);
      members.setData((list) => list?.filter((x) => x.user.id !== m.user.id));
      setRemoving(null);
      refreshCounts();
      toast(`${m.user.name || m.user.email} was removed.`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    setBusy("leave");
    try {
      await api.workspace.leave();
      setWorkspaceId(null);
      router.push("/");
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(null);
    }
  }

  async function revoke(inv: InviteOut) {
    setBusy(`revoke:${inv.id}`);
    try {
      await api.workspace.revokeInvite(inv.id);
      invites.setData((list) => list?.filter((x) => x.id !== inv.id));
      refreshCounts();
      toast("Invite revoked.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(inv: InviteOut) {
    toast((await copyText(inv.link)) ? "Invite link copied." : "Could not copy. Long-press the link to copy it.", "info");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle={`${me.workspace.name} · you are ${roleLabel(role).toLowerCase()}`} />

      <Card className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-base font-semibold">Seats</p>
          {seats.data ? (
            <p className="text-sm text-muted">
              <span className="font-semibold text-fg">{used}</span> of {seats.data.limit} {seats.data.limit === 1 ? "seat" : "seats"}
            </p>
          ) : (
            <span className="skeleton inline-block h-4 w-24" aria-hidden />
          )}
        </div>
        {seats.data ? <ProgressBar value={(100 * (used ?? 0)) / Math.max(1, seats.data.limit)} label="Seats used" tone={used !== null && used >= seats.data.limit ? "amber" : "accent"} /> : null}
        <p className="text-xs text-muted">
          {seats.data ? (
            seats.data.plan === "team" ? (
              <>
                Pending invites hold a seat. Add seats under{" "}
                <Link href="/settings/plan" className="font-semibold text-accent">
                  Plan & credits
                </Link>
                .
              </>
            ) : (
              <>
                The {roleLabel(seats.data.plan)} plan includes {seats.data.limit} {seats.data.limit === 1 ? "member" : "members"}. Team includes 15 seats and roles.
              </>
            )
          ) : null}
        </p>
      </Card>

      {isAdmin ? (
        <InviteForm
          onInvited={(inv) => {
            invites.setData((list) => [inv, ...(list ?? [])]);
            refreshCounts();
            setSeatNotice(null);
          }}
          onSeatLimit={setSeatNotice}
        />
      ) : null}
      {seatNotice ? (
        <Notice tone="amber">
          {seatNotice}{" "}
          <Link href="/settings/plan" className="font-semibold underline">
            Open Plan & credits
          </Link>
        </Notice>
      ) : null}

      <section>
        <h2 className="mb-2 text-lg font-bold">Members</h2>
        <Card className="divide-y divide-line p-0">
          {members.loading ? (
            <div className="p-4">
              <SkeletonText lines={2} />
            </div>
          ) : null}
          {members.error ? (
            <div className="p-4">
              <Notice tone="red">{errorMessage(members.error)}</Notice>
            </div>
          ) : null}
          {members.data?.map((m) => {
            const self = m.user.id === me.user.id;
            return (
              <div key={m.user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <MemberAvatar name={m.user.name} email={m.user.email} src={m.user.avatar_url} />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-base font-semibold">
                    {m.user.name || m.user.email}
                    {self ? <span className="ml-1 text-xs font-medium text-muted">(you)</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted">{m.user.email}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {isAdmin ? (
                    <select
                      aria-label={`Role for ${m.user.name || m.user.email}`}
                      value={m.role}
                      disabled={busy === `role:${m.user.id}`}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      className="min-h-10 rounded-xl border border-line bg-surface px-3 py-2 text-sm text-fg focus:border-accent disabled:opacity-60"
                    >
                      {ALL_ROLES.map((r) => (
                        <option key={r} value={r} disabled={r === "owner" && role !== "owner"}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge>{roleLabel(m.role)}</Badge>
                  )}
                  {isAdmin && !self ? (
                    <button
                      type="button"
                      aria-label={`Remove ${m.user.name || m.user.email}`}
                      onClick={() => setRemoving(m)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </Card>
        {isAdmin && role !== "owner" ? <p className="mt-1 text-xs text-muted">Only an owner can make someone an owner.</p> : null}
      </section>

      {isAdmin ? (
        <section>
          <h2 className="mb-2 text-lg font-bold">Pending invites</h2>
          <Card className="divide-y divide-line p-0">
            {invites.loading ? (
              <div className="p-4">
                <SkeletonText lines={2} />
              </div>
            ) : null}
            {invites.error ? (
              <div className="p-4">
                <Notice tone="red">{errorMessage(invites.error)}</Notice>
              </div>
            ) : null}
            {invites.data && pending.length === 0 ? <p className="p-4 text-sm text-muted">No open invites. Invite someone above and send them the link.</p> : null}
            {pending.map((inv) => {
              const expired = Boolean(inv.expired);
              return (
                <div key={inv.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                      <Mail size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold">{inv.email}</p>
                      <p className="text-xs text-muted">
                        {roleLabel(inv.role)} · {expired ? "expired" : `expires ${formatDate(inv.expires_at)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!expired ? (
                      <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => copyLink(inv)}>
                        Copy link
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" icon={<X size={14} />} loading={busy === `revoke:${inv.id}`} onClick={() => revoke(inv)}>
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
          <p className="mt-1 text-xs text-muted">Links work for 7 days and only for the email they were sent to. Send them by WhatsApp or email.</p>
        </section>
      ) : null}

      {me.workspaces.length > 1 || role !== "owner" ? (
        <div className="pt-2">
          <Button variant="danger" full icon={<LogOut size={18} />} onClick={() => setLeaveOpen(true)}>
            Leave this workspace
          </Button>
        </div>
      ) : null}

      <ConfirmSheet
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && removeMember(removing)}
        busy={Boolean(removing) && busy === `remove:${removing?.user.id}`}
        tone="danger"
        title={`Remove ${removing?.user.name || removing?.user.email}?`}
        confirmLabel="Remove"
        body="They lose access to this workspace right away. Their videos stay in the workspace."
      />
      <ConfirmSheet
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onConfirm={leave}
        busy={busy === "leave"}
        tone="danger"
        title={`Leave ${me.workspace.name}?`}
        confirmLabel="Leave"
        body="You will need a new invite to come back. If you are the only owner, make someone else an owner first."
      />
    </div>
  );
}

function InviteForm({ onInvited, onSeatLimit }: { onInvited: (inv: InviteOut) => void; onSeatLimit: (message: string) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<InviteOut | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const inv = await api.workspace.invite({ email: v, role });
      onInvited(inv);
      setLast(inv);
      setEmail("");
      toast(`Invite created for ${inv.email}.`, "success");
    } catch (err) {
      if (isApiError(err) && err.status === 402) onSeatLimit(err.message);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">Invite someone</h2>
        <p className="text-sm text-muted">They get a link that works for 7 days. {INVITE_ROLES.find((r) => r.value === role)?.hint}</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <Input label="Email" type="email" inputMode="email" autoComplete="off" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as InviteRole)} containerClassName="sm:w-36">
            {INVITE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" full loading={busy} icon={<Plus size={18} />}>
          Invite
        </Button>
      </form>
      {last ? (
        <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          <p className="text-sm font-semibold">Send this link to {last.email}</p>
          <p className="break-all font-mono text-xs text-muted">{last.link}</p>
          <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={async () => toast((await copyText(last.link)) ? "Invite link copied." : "Could not copy. Long-press the link to copy it.", "info")}>
            Copy link
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function MemberAvatar({ name, email, src, size = 40 }: { name: string; email: string; src?: string | null; size?: number }) {
  const initial = (name || email).trim().charAt(0).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-sm font-bold text-accent" style={{ width: size, height: size }} aria-hidden>
      {src ? <Image src={src} alt="" fill sizes={`${size}px`} unoptimized className="object-cover" /> : initial || <UserRound size={18} />}
    </span>
  );
}
