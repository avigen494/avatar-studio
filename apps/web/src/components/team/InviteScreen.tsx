"use client";

import { Sparkles, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, isApiError } from "@/lib/api";
import { setWorkspaceId } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { roleLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";

/** Public page for /invite/[token]. Reads the invite without signing in; accepting needs an account. */
export function InviteScreen() {
  return (
    <AuthProvider>
      <InviteBody />
    </AuthProvider>
  );
}

function InviteBody() {
  const { token } = useParams<{ token: string }>();
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const meta = useApi(() => api.invites.meta(token), ["invite", token], { anonymous: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const signInHref = `/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const ws = await api.invites.accept(token);
      setWorkspaceId(ws.id);
      toast(`You joined ${ws.name}.`, "success");
      router.replace("/");
    } catch (e) {
      setError(isApiError(e) ? { code: e.code, message: e.message } : { code: "error", message: errorMessage(e) });
      setBusy(false);
    }
  }

  async function switchAccount() {
    await auth.signOut();
    router.push(signInHref);
  }

  const m = meta.data;
  const notFound = isApiError(meta.error) && meta.error.status === 404;

  return (
    <div className="flex min-h-dvh flex-col px-4" style={{ paddingTop: "calc(24px + var(--safe-top))" }}>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6">
        <div className="space-y-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
            <Sparkles size={24} />
          </span>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">You are invited</h1>
        </div>

        {meta.loading ? <SkeletonText lines={3} /> : null}
        {notFound ? <Notice tone="red">This invite link is not valid. Ask the person who invited you for a new one.</Notice> : null}
        {meta.error && !notFound ? <Notice tone="red">{errorMessage(meta.error)}</Notice> : null}

        {m ? (
          <>
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-fg">
                  <Users size={22} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{m.workspace || "A workspace"}</p>
                  <p className="text-sm text-muted">{m.invited_by ? `Invited by ${m.invited_by}` : "Invitation to join"}</p>
                </div>
              </div>
              <p className="text-sm">
                Role: <Badge tone="accent">{roleLabel(m.role)}</Badge>
              </p>
              <p className="text-sm text-muted">For {m.email}</p>
            </div>

            {m.accepted ? (
              <Notice tone="neutral">This invite was already used. If that was you, sign in and open the workspace from the switcher.</Notice>
            ) : m.expired ? (
              <Notice tone="amber">This invite has expired. Ask {m.invited_by || "the person who invited you"} for a new one.</Notice>
            ) : !auth.ready ? (
              <SkeletonText lines={1} />
            ) : !auth.signedIn ? (
              <div className="space-y-2">
                <Button size="lg" full href={signInHref}>
                  Sign in to accept
                </Button>
                <p className="text-center text-xs text-muted">Sign in with {m.email}; you will come straight back here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {error ? (
                  <Notice tone={error.code === "wrong_account" ? "amber" : "red"}>
                    {error.message}
                    {error.code === "wrong_account" ? (
                      <>
                        {" "}
                        <button type="button" onClick={switchAccount} className="font-semibold underline">
                          Switch account
                        </button>
                      </>
                    ) : null}
                  </Notice>
                ) : null}
                {auth.email && auth.email.toLowerCase() !== m.email.toLowerCase() && !error ? (
                  <Notice tone="amber">
                    You are signed in as {auth.email}, but this invite is for {m.email}.{" "}
                    <button type="button" onClick={switchAccount} className="font-semibold underline">
                      Switch account
                    </button>
                  </Notice>
                ) : null}
                <Button size="lg" full loading={busy} onClick={accept}>
                  Accept and join
                </Button>
                {auth.email ? <p className="text-center text-xs text-muted">Signed in as {auth.email}</p> : null}
              </div>
            )}
          </>
        ) : null}

        {m?.accepted || m?.expired || notFound ? (
          <Button variant="secondary" full href="/">
            Go to Avatar Studio
          </Button>
        ) : null}
      </div>
      <p className="py-6 text-center text-xs text-muted safe-pb">Avatar Studio · invites work for 7 days and only for the email they were sent to.</p>
    </div>
  );
}
