"use client";

import { Camera, Plus, UserRound, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { AvatarKindPicker } from "@/components/avatar/AvatarKindPicker";
import { IdentityCard } from "@/components/avatar/IdentityCard";
import { PinnedBar, PinnedSpacer } from "@/components/layout/PinnedBar";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, PageHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";

export default function AvatarsPage() {
  const router = useRouter();
  const { me } = useMe();
  const identities = useApi(() => api.identities.list(), ["identities"], {
    pollWhile: (list) => list.some((i) => i.status === "verifying"),
    pollMs: 3000,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"real_person" | "designed">("real_person");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = identities.data?.length ?? 0;
  const max = me?.workspace.max_avatars ?? 1;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give this avatar a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await api.identities.create({ name: name.trim(), kind });
      // Close the sheet before leaving: the router keeps this page around for back navigation.
      setOpen(false);
      // Designed presenters go straight to the Design with AI form on the avatar page.
      router.push(`/avatars/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Avatars"
        subtitle={me ? `${count} of ${max} on the ${me.workspace.plan} plan` : undefined}
        right={
          <div className="hidden lg:block">
            <Button icon={<Plus size={18} />} onClick={() => setOpen(true)}>
              New avatar
            </Button>
          </div>
        }
      />
      {identities.error ? <Notice tone="red">{errorMessage(identities.error)}</Notice> : null}
      {identities.loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/5] w-full rounded-2xl" />
          ))}
        </div>
      ) : count === 0 ? (
        <EmptyState
          icon={<UserRound size={32} />}
          title="No avatar yet"
          body="Record 15 seconds with the consent line, or start with a photo."
          action={
            <Button href="/onboarding?step=1" variant="secondary">
              Start set-up
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {identities.data!.map((i) => (
            <li key={i.id}>
              <IdentityCard identity={i} />
            </li>
          ))}
        </ul>
      )}

      <PinnedSpacer size={72} />
      <PinnedBar className="lg:hidden">
        <Button size="lg" full icon={<Plus size={20} />} onClick={() => setOpen(true)}>
          New avatar
        </Button>
      </PinnedBar>

      <Sheet open={open} onClose={() => setOpen(false)} title="New avatar">
        <form onSubmit={create} className="space-y-4 pt-1">
          {count >= max ? <Notice tone="amber">Your plan includes {max} {max === 1 ? "avatar" : "avatars"}. Upgrade to add more.</Notice> : null}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus error={error} />
          <AvatarKindPicker value={kind} onChange={setKind} />
          <Button type="submit" size="lg" full loading={busy} disabled={count >= max} icon={kind === "designed" ? <Wand2 size={18} /> : <Camera size={18} />}>
            {kind === "designed" ? "Create and design" : "Create avatar"}
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

