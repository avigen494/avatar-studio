"use client";

import { AlertTriangle, Copy, KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, isApiError } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { copyText, useApi } from "@/lib/hooks";
import type { ApiKeyOut, ApiScope } from "@/lib/types";

const SCOPES: { value: ApiScope; label: string; hint: string }[] = [
  { value: "read", label: "Read", hint: "List and fetch videos, avatars, voices." },
  { value: "write", label: "Write", hint: "Create drafts, generate, cancel, batch." },
];

export function ApiKeysSection() {
  const { toast } = useToast();
  const keys = useApi(() => api.developer.keys(), ["api-keys"]);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<ApiKeyOut | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyOut | null>(null);
  const [busy, setBusy] = useState(false);

  const live = (keys.data ?? []).filter((k) => !k.revoked_at);

  async function revoke(k: ApiKeyOut) {
    setBusy(true);
    try {
      await api.developer.revokeKey(k.id);
      keys.setData((list) => list?.map((x) => (x.id === k.id ? { ...x, revoked_at: new Date().toISOString() } : x)));
      setRevoking(null);
      toast(`Key “${k.name}” revoked. Requests with it stop working now.`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">API keys</h2>
          <p className="text-sm text-muted">A key acts as an editor of this workspace, limited by its scopes.</p>
        </div>
        <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
          Create key
        </Button>
      </div>

      {created?.key ? (
        <Card className="mb-3 space-y-2 border-amber">
          <p className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle size={18} className="text-amber" /> Copy this key now
          </p>
          <p className="text-sm text-muted">This is the only time the full key is shown. Store it in your secrets manager, not in a chat.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">{created.key}</code>
            <Button
              variant="primary"
              size="sm"
              icon={<Copy size={14} />}
              onClick={async () => toast((await copyText(created.key as string)) ? "Key copied." : "Could not copy. Select the key and copy it.", "info")}
            >
              Copy
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
            I have saved it
          </Button>
        </Card>
      ) : null}

      <Card className="divide-y divide-line p-0">
        {keys.loading ? (
          <div className="p-4">
            <SkeletonText lines={2} />
          </div>
        ) : null}
        {keys.error ? (
          <div className="p-4">
            <Notice tone="red">{errorMessage(keys.error)}</Notice>
          </div>
        ) : null}
        {keys.data && live.length === 0 ? <p className="p-4 text-sm text-muted">No keys yet. Create one to call the API from n8n, Zapier or your code.</p> : null}
        {live.map((k) => (
          <div key={k.id} className="flex items-center gap-3 px-4 py-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg">
              <KeyRound size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{k.name}</p>
              <p className="truncate text-xs text-muted">
                <span className="font-mono">{k.prefix}…</span> · created {formatDate(k.created_at)} · {k.last_used_at ? `last used ${formatDate(k.last_used_at, true)}` : "never used"}
              </p>
              <div className="mt-1 flex gap-1">
                {k.scopes.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>
              Revoke
            </Button>
          </div>
        ))}
      </Card>

      <CreateKeySheet
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(k) => {
          keys.setData((list) => [k, ...(list ?? [])]);
          setCreated(k);
          setOpen(false);
        }}
      />
      <ConfirmSheet
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke(revoking)}
        busy={busy}
        tone="danger"
        title={`Revoke “${revoking?.name}”?`}
        confirmLabel="Revoke key"
        body="Anything using this key stops working immediately. This cannot be undone; create a new key instead."
      />
    </section>
  );
}

function CreateKeySheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (k: ApiKeyOut) => void }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiScope[]>(["read", "write"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  function toggle(s: ApiScope) {
    setScopes((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name the key after what uses it, like “n8n production”.");
      return;
    }
    if (scopes.length === 0) {
      setError("Pick at least one scope.");
      return;
    }
    setBusy(true);
    setError(null);
    setPlanError(null);
    try {
      const k = await api.developer.createKey({ name: name.trim(), scopes });
      onCreated(k);
      setName("");
      setScopes(["read", "write"]);
    } catch (err) {
      if (isApiError(err) && err.status === 402) setPlanError(err.message);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Create API key" description="The full key is shown once, right after you create it.">
      <form onSubmit={submit} className="space-y-4 pt-1">
        {planError ? (
          <Notice tone="amber">
            {planError}{" "}
            <Link href="/settings/plan" className="font-semibold underline">
              See plans
            </Link>
          </Notice>
        ) : null}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder="n8n production" error={error} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-muted">Scopes</legend>
          {SCOPES.map((s) => {
            const checked = scopes.includes(s.value);
            return (
              <label key={s.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${checked ? "border-accent bg-accent-soft" : "border-line"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(s.value)} className="mt-0.5 h-5 w-5 accent-[var(--accent)]" />
                <span>
                  <span className="block text-base font-semibold">{s.label}</span>
                  <span className="block text-sm text-muted">{s.hint}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <Button type="submit" full loading={busy}>
          Create key
        </Button>
      </form>
    </Sheet>
  );
}
