"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { isApiError } from "@/lib/api";
import { getWorkspaceId, setWorkspaceId } from "@/lib/auth";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import { MeContext, type MeState } from "@/lib/me-context";
import { useAuth } from "./AuthProvider";

export { useMe } from "@/lib/me-context";

export function MeProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const q = useApi(() => api.me(), ["me"], { enabled: auth.ready && auth.signedIn, bootstrap: true });
  const bootstrapped = q.data !== undefined || q.error !== undefined;

  // A remembered workspace the person no longer belongs to (left it, was removed,
  // or another dev account signed in on this browser): forget it and fall back
  // to their default workspace instead of showing an error.
  useEffect(() => {
    if (isApiError(q.error) && q.error.code === "not_a_member" && getWorkspaceId()) setWorkspaceId(null);
  }, [q.error]);
  const value = useMemo<MeState>(
    () => ({ me: q.data, loading: q.loading, error: q.error, bootstrapped, refetch: q.refetch, setMe: q.setData }),
    [q.data, q.loading, q.error, bootstrapped, q.refetch, q.setData],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
