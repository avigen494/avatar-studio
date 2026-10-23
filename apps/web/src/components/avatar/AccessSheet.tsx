"use client";

import { Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { MemberAvatar } from "@/components/team/TeamScreen";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { roleLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { IdentityOut } from "@/lib/types";

/** Shown on the identity card and avatar header when only some members may use the avatar. */
export function LockedBadge({ count }: { count?: number }) {
  return (
    <Badge tone="amber" title="Only some members can make videos with this avatar">
      <Lock size={12} /> {count ? `${count} ${count === 1 ? "person" : "people"}` : "Restricted"}
    </Badge>
  );
}

/**
 * Who may make videos with this avatar. Owners and admins always can; an empty
 * list means every editor in the workspace. PUT /identities/{id}/access.
 */
export function AccessSheet({ open, identity, onClose, onSaved }: { open: boolean; identity: IdentityOut; onClose: () => void; onSaved: (i: IdentityOut) => void }) {
  if (!open) return null;
  return <AccessSheetBody identity={identity} onClose={onClose} onSaved={onSaved} />;
}

function AccessSheetBody({ identity, onClose, onSaved }: { identity: IdentityOut; onClose: () => void; onSaved: (i: IdentityOut) => void }) {
  const { me } = useMe();
  const { toast } = useToast();
  const members = useApi(() => api.workspace.members(), ["members"]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(identity.allowed_user_ids ?? []));
  const [busy, setBusy] = useState(false);

  const everyone = selected.size === 0;
  const eligible = (members.data ?? []).filter((m) => m.role === "editor" || m.role === "viewer");
  const admins = (members.data ?? []).filter((m) => m.role === "owner" || m.role === "admin");

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(userIds: string[]) {
    setBusy(true);
    try {
      const updated = await api.identities.setAccess(identity.id, { user_ids: userIds });
      onSaved(updated);
      toast(userIds.length === 0 ? "Everyone in the workspace can use this avatar." : `Only ${userIds.length} ${userIds.length === 1 ? "person" : "people"} can use this avatar.`, "success");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Who can use this avatar"
      description="Tick the people allowed to make videos with it. Owners and admins always can."
      locked={busy}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button size="lg" full loading={busy} onClick={() => save(Array.from(selected))} className="sm:flex-1" icon={everyone ? <LockOpen size={18} /> : <Lock size={18} />}>
            {everyone ? "Allow everyone" : `Allow ${selected.size} ${selected.size === 1 ? "person" : "people"}`}
          </Button>
          {!everyone ? (
            <Button size="lg" variant="secondary" full disabled={busy} onClick={() => setSelected(new Set())} className="sm:flex-1">
              Clear
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-3 pt-1">
        <Notice tone={everyone ? "neutral" : "amber"}>{everyone ? "Right now every editor in the workspace can use this avatar." : "Only the ticked people (plus owners and admins) can use this avatar."}</Notice>
        {members.loading ? <SkeletonText lines={3} /> : null}
        {members.error ? <Notice tone="red">{errorMessage(members.error)}</Notice> : null}
        {members.data && eligible.length === 0 ? <p className="text-sm text-muted">No editors or viewers yet. Invite people under Settings → Team; owners and admins always have access.</p> : null}
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {eligible.map((m) => {
            const checked = selected.has(m.user.id);
            return (
              <li key={m.user.id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={checked} onChange={() => toggle(m.user.id)} className="h-5 w-5 accent-[var(--accent)]" />
                  <MemberAvatar name={m.user.name} email={m.user.email} src={m.user.avatar_url} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">
                      {m.user.name || m.user.email}
                      {m.user.id === me?.user.id ? <span className="ml-1 text-xs font-medium text-muted">(you)</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">{m.user.email}</span>
                  </span>
                  <Badge>{roleLabel(m.role)}</Badge>
                </label>
              </li>
            );
          })}
        </ul>
        {admins.length > 0 ? (
          <p className="text-xs text-muted">
            Always allowed: {admins.map((m) => m.user.name || m.user.email).join(", ")}.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
