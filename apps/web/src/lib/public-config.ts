"use client";

/*
  Runtime public config: GET /config/public, fetched once per page load and
  kept in a small module store so the sign-in page, the auth provider and any
  component can read it with usePublicConfig(). When the API cannot be reached
  the build-time env (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) decides the auth mode.
*/

import { useSyncExternalStore } from "react";
import { API_URL } from "./api";
import { CLERK_KEY, envAuthMode, setAuthMode } from "./auth";
import type { PublicConfig } from "./types";

export const FALLBACK_CONFIG: PublicConfig = {
  auth_mode: envAuthMode,
  clerk_publishable_key: CLERK_KEY,
  api_base_url: API_URL,
  avatar_engine: "unknown",
  voice_engines: [],
  // Unknown: do not hide features on the strength of a failed fetch.
  script_helper: true,
  look_generator: false,
};

export interface PublicConfigState {
  config: PublicConfig;
  /** True once the fetch has answered (or failed). */
  loaded: boolean;
  /** True when the API could not be reached and the env fallback is in use. */
  fallback: boolean;
}

const SERVER_STATE: PublicConfigState = { config: FALLBACK_CONFIG, loaded: false, fallback: false };
let state: PublicConfigState = SERVER_STATE;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function normalize(raw: Partial<PublicConfig> | null | undefined): PublicConfig {
  return {
    auth_mode: raw?.auth_mode === "clerk" ? "clerk" : "dev",
    clerk_publishable_key: typeof raw?.clerk_publishable_key === "string" ? raw.clerk_publishable_key : "",
    api_base_url: typeof raw?.api_base_url === "string" ? raw.api_base_url : API_URL,
    avatar_engine: typeof raw?.avatar_engine === "string" ? raw.avatar_engine : "mock",
    voice_engines: Array.isArray(raw?.voice_engines) ? raw.voice_engines.map(String) : [],
    script_helper: Boolean(raw?.script_helper),
    look_generator: Boolean(raw?.look_generator),
  };
}

/** Fetch the config (once; `force` refetches after an admin saves a connection). */
export function loadPublicConfig(force = false): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (inflight && !force) return inflight;
  if (state.loaded && !force) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch(`${API_URL}/config/public`, {
        headers: { Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Config request failed (${res.status}).`);
      const config = normalize((await res.json()) as Partial<PublicConfig>);
      state = { config, loaded: true, fallback: false };
    } catch {
      state = { config: FALLBACK_CONFIG, loaded: true, fallback: true };
    } finally {
      inflight = null;
      // Set the mode before anyone re-renders so the first request after this
      // already carries the right headers.
      setAuthMode(state.config.auth_mode);
      emit();
    }
  })();
  return inflight;
}

export function usePublicConfigState(): PublicConfigState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}

/** The runtime config plus `loaded`, `fallback` and a `refetch()` for after settings change. */
export function usePublicConfig(): PublicConfigState & { refetch: () => Promise<void> } {
  const s = usePublicConfigState();
  return { ...s, refetch: () => loadPublicConfig(true) };
}

/** The Clerk key to use: the API's value first, the build-time env as a fallback. */
export function clerkKeyFor(config: PublicConfig): string {
  return config.clerk_publishable_key || CLERK_KEY;
}
