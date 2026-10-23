"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { errorMessage } from "@/lib/api";
import { setWorkspaceId } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { roleLabel } from "@/lib/format";

/**
 * Switch between the workspaces the person belongs to, or start a new one.
 * Switching stores the id (sent as X-Workspace-Id) and reloads so every
 * screen starts fresh in the new workspace.
 */
export function WorkspaceSwitcher({ variant }: { variant: "header" | "side" }) {
  const { me } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!me) {
    return variant === "side" ? <span className="skeleton block h-10 w-full" aria-hidden /> : null;
  }

  function choose(id: string) {
    if (id === me?.workspace.id) {
      setOpen(false);
      return;
    }
    setWorkspaceId(id);
    window.location.reload();
  }

  const trigger =
    variant === "header" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Workspace: ${me.workspace.name}. Switch workspace.`}
        title={me.workspace.name}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
      >
        <ChevronsUpDown size={20} />
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Workspace: ${me.workspace.name}. Switch workspace.`}
        className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-fg">{me.workspace.name}</span>
          <span className="block text-xs text-muted">
            {roleLabel(me.workspace.role).toLowerCase()} · {me.workspace.plan} plan
          </span>
        </span>
        <ChevronsUpDown size={16} className="shrink-0 text-muted" />
      </button>
    );

  return (
    <>
      {trigger}
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setCreating(false);
        }}
        title="Workspaces"
        description="Each workspace has its own avatars, credits and members."
      >
        <div className="space-y-3 pt-1">
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {me.workspaces.map((w) => {
              const active = w.id === me.workspace.id;
              return (
                <li key={w.id}>
                  <button type="button" onClick={() => choose(w.id)} aria-current={active ? "true" : undefined} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2">
                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${active ? "bg-accent text-on-accent" : "bg-surface-2 text-fg"}`} aria-hidden>
                      {w.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold">{w.name}</span>
                      <span className="block text-xs text-muted">
                        {roleLabel(w.role)} · {w.plan} plan
                      </span>
                    </span>
                    {active ? <Check size={18} className="text-accent" aria-label="Current" /> : <Badge>Open</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
          {creating ? (
            <NewWorkspaceForm
              onBack={() => setCreating(false)}
              onCreated={(id) => {
                setWorkspaceId(id);
                setOpen(false);
                router.push("/");
              }}
            />
          ) : (
            <Button variant="secondary" full icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              New workspace
            </Button>
          )}
        </div>
      </Sheet>
    </>
  );
}

function NewWorkspaceForm({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the workspace a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ws = await api.workspace.create({ name: name.trim() });
      onCreated(ws.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="space-y-3 rounded-2xl border border-line p-3">
      <Input label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus placeholder="Client name, brand, team…" error={error} hint="You become its owner. It starts on the Free plan with its own credits." />
      <div className="flex gap-2">
        <Button type="submit" loading={busy} className="flex-1">
          Create
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}
