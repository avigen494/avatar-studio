"use client";

import { useEffect, useRef } from "react";
import { errorMessage, isApiError } from "./api";
import { api } from "./endpoints";
import { useApi } from "./hooks";
import type { IdentityJob, IdentityOut } from "./types";

export function isActiveJob(j: IdentityJob): boolean {
  return j.status === "queued" || j.status === "running";
}

/** Newest job of a type (the API returns newest first). */
export function latestJob(jobs: IdentityJob[], type: IdentityJob["type"]): IdentityJob | undefined {
  return jobs.find((j) => j.type === type);
}

export function isTraining(i: IdentityOut): boolean {
  return i.style_status === "queued" || i.style_status === "training";
}

/**
 * Polls GET /identities/{id}/jobs every 3 s while a training or look job is
 * running and calls `onChange` whenever the set of running jobs changes, so the
 * page can refetch the avatar (new looks, new style status) exactly then.
 */
export function useIdentityJobs(identityId: string, onChange: () => void) {
  const q = useApi(() => api.identities.jobs(identityId), ["identity-jobs", identityId], {
    pollWhile: (jobs) => jobs.some(isActiveJob),
    pollMs: 3000,
  });
  const jobs = q.data ?? [];
  const active = jobs.filter(isActiveJob);
  const activeKey = active.map((j) => j.id).join(",");
  const prevKey = useRef<string | null>(null);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    if (prevKey.current !== null && prevKey.current !== activeKey) cb.current();
    prevKey.current = activeKey;
  }, [activeKey]);
  return { jobs, active, loading: q.loading, refetch: q.refetch };
}

/** Plain-English copy for the errors train-style, looks/generate and design return. */
export function jobErrorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.status === 402) {
      const needed = e.extra["needed"];
      const available = e.extra["available"];
      if (typeof needed === "number" && typeof available === "number") {
        return `Not enough credits: this needs ${needed} and you have ${available}. Add credits in Settings → Plan & credits.`;
      }
    }
    if (e.status === 422 && e.blockers.length) return e.blockers[0];
  }
  return errorMessage(e);
}
