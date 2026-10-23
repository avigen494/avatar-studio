"use client";

import { api } from "./endpoints";
import { useApi } from "./hooks";

export interface AdminState {
  /** True only once GET /admin/whoami has said so. */
  isAdmin: boolean;
  /** False until the check has answered (or failed). */
  known: boolean;
  loading: boolean;
  error: unknown;
}

/** Is the signed-in person the platform admin? Admin-only links stay hidden until this says yes. */
export function useIsAdmin(): AdminState {
  const q = useApi(() => api.admin.whoami(), ["whoami"]);
  return {
    isAdmin: q.data?.is_admin === true,
    known: q.data !== undefined || q.error !== undefined,
    loading: q.loading,
    error: q.error,
  };
}
