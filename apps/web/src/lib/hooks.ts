"use client";

import { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isAbort } from "./api";
import { devAuthSnapshot, serverAuthSnapshot, subscribeAuth } from "./auth";
import { AuthContext } from "./auth-context";
import { MeContext } from "./me-context";

/* ------------------------------------------------------------------ */
/* Data fetching                                                        */
/* ------------------------------------------------------------------ */

interface ApiState<T> {
  key: string;
  tick: number;
  data?: T;
  error?: unknown;
}

export interface UseApiOptions<T> {
  enabled?: boolean;
  /** Public endpoints: fetch even when nobody is signed in. */
  anonymous?: boolean;
  /** The GET /me call itself: does not wait for the account bootstrap. */
  bootstrap?: boolean;
  /** Keep re-fetching every `pollMs` while this returns true for the current data. */
  pollWhile?: (data: T) => boolean;
  pollMs?: number;
}

export interface UseApiResult<T> {
  data: T | undefined;
  /** Last result even if the inputs changed since (for smooth estimate lines). */
  stale: T | undefined;
  error: unknown;
  /** True until the first result for the current inputs arrives. */
  loading: boolean;
  /** True while a refetch or poll is in flight (data stays on screen). */
  refreshing: boolean;
  refetch: () => void;
  setData: (updater: T | undefined | ((prev: T | undefined) => T | undefined)) => void;
}

/**
 * Small fetch hook: no cache, no library. Loading is derived from whether the
 * stored result matches the current inputs, so no state is set synchronously in
 * effects. Polling is decided from whatever data is current (fetched or set
 * locally) and driven by a timer that bumps the fetch tick. Requests wait until
 * the person is signed in and re-run when the account or workspace changes.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[], opts: UseApiOptions<T> = {}): UseApiResult<T> {
  const auth = useContext(AuthContext);
  const { bootstrapped } = useContext(MeContext);
  const authSnap = useAuthSnapshot();
  const key = JSON.stringify(opts.anonymous ? deps : [auth.email, authSnap, ...deps]);
  const wanted = opts.enabled ?? true;
  const enabled =
    wanted && (Boolean(opts.anonymous) || (auth.ready && auth.signedIn && (Boolean(opts.bootstrap) || bootstrapped)));
  const [state, setState] = useState<ApiState<T>>({ key: "\u0000", tick: -1 });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  const optsRef = useRef(opts);

  useEffect(() => {
    fetcherRef.current = fetcher;
    optsRef.current = opts;
  });

  // Fetch whenever the inputs or the tick change.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetcherRef.current();
        if (!cancelled) setState({ key, tick, data });
      } catch (error) {
        if (cancelled || isAbort(error)) return;
        setState((prev) => ({ key, tick, error, data: prev.key === key ? prev.data : undefined }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, tick, enabled]);

  const fresh = state.key === key;
  const settled = fresh && state.tick === tick;

  // Poll: once a result is in and still "active", schedule the next fetch.
  useEffect(() => {
    if (!enabled || !settled || state.data === undefined) return;
    const o = optsRef.current;
    if (!o.pollWhile || !o.pollWhile(state.data)) return;
    const t = setTimeout(() => setTick((n) => n + 1), o.pollMs ?? 2000);
    return () => clearTimeout(t);
  }, [enabled, settled, state]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback<UseApiResult<T>["setData"]>(
    (updater) =>
      setState((prev) => ({
        key,
        tick: prev.key === key ? prev.tick : -1,
        error: undefined,
        data:
          typeof updater === "function"
            ? (updater as (p: T | undefined) => T | undefined)(prev.key === key ? prev.data : undefined)
            : updater,
      })),
    [key],
  );

  return {
    data: fresh ? state.data : undefined,
    stale: state.data,
    error: fresh ? state.error : undefined,
    // Wanted but not yet runnable (auth still loading) counts as loading so
    // pages show skeletons, never a false empty state.
    loading: wanted && !fresh,
    refreshing: enabled && fresh && state.tick !== tick,
    refetch,
    setData,
  };
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                      */
/* ------------------------------------------------------------------ */

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const noopSubscribe = () => () => {};

export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function subscribeHref(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener("hashchange", cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener("hashchange", cb);
  };
}

/** The current page URL ("" during server render). */
export function useHref(): string {
  return useSyncExternalStore(
    subscribeHref,
    () => window.location.href,
    () => "",
  );
}

/** Re-renders when the dev email or selected workspace changes. */
export function useAuthSnapshot(): string {
  return useSyncExternalStore(subscribeAuth, devAuthSnapshot, serverAuthSnapshot);
}

/** Runs an async action with busy/error state for buttons. */
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const run = useCallback(async (...args: Args): Promise<R | undefined> => {
    setBusy(true);
    setError(undefined);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error, clearError: () => setError(undefined) };
}

/** Copy text to the clipboard; resolves true when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
