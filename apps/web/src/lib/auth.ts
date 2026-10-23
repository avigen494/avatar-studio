/*
  Auth plumbing shared by the API helper and the providers.

  The mode comes from GET /config/public at runtime (see public-config.ts).
  DEV mode (default): the sign-in page stores an email; every request sends
  X-Dev-User-Email. CLERK mode: a bridge component registers Clerk's
  getToken() here and requests send Authorization: Bearer <token>.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is only the fallback when that fetch fails.
*/

import type { AuthMode } from "./types";

export const CLERK_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
/** Build-time guess, used until /config/public answers or when it cannot be reached. */
export const envAuthMode: AuthMode = CLERK_KEY.length > 0 ? "clerk" : "dev";

let authMode: AuthMode = envAuthMode;

export function getAuthMode(): AuthMode {
  return authMode;
}

/** Called by the public-config store once the API has said which mode to use. */
export function setAuthMode(mode: AuthMode) {
  if (mode === authMode) return;
  authMode = mode;
  emit();
}

export const DEV_EMAIL_KEY = "as_dev_email";
export const WORKSPACE_KEY = "as_workspace_id";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeAuth(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string | null) {
  if (typeof document === "undefined") return;
  if (value === null) {
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  } else {
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax`;
  }
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the cookie still carries the value.
  }
}

export function getDevEmail(): string | null {
  return readStorage(DEV_EMAIL_KEY) || readCookie(DEV_EMAIL_KEY);
}

export function setDevEmail(email: string | null) {
  const v = email ? email.trim().toLowerCase() : null;
  writeStorage(DEV_EMAIL_KEY, v);
  writeCookie(DEV_EMAIL_KEY, v);
  emit();
}

export function getWorkspaceId(): string | null {
  return readStorage(WORKSPACE_KEY);
}

export function setWorkspaceId(id: string | null) {
  writeStorage(WORKSPACE_KEY, id);
  emit();
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;

export function setTokenGetter(fn: TokenGetter | null) {
  tokenGetter = fn;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  if (authMode === "clerk") {
    const token = tokenGetter ? await tokenGetter() : null;
    if (token) h["Authorization"] = `Bearer ${token}`;
  } else {
    const email = getDevEmail();
    if (email) h["X-Dev-User-Email"] = email;
  }
  const ws = getWorkspaceId();
  if (ws) h["X-Workspace-Id"] = ws;
  return h;
}

/** Snapshot used by useSyncExternalStore: a stable string so React can compare. */
export function devAuthSnapshot(): string {
  return `${getDevEmail() ?? ""}|${getWorkspaceId() ?? ""}|${authMode}`;
}

export function serverAuthSnapshot(): string {
  return "";
}
