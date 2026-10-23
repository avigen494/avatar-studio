"use client";

import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import { setDevEmail } from "@/lib/auth";
import { AuthContext, type AuthState } from "@/lib/auth-context";
import { useAuthSnapshot, useIsClient } from "@/lib/hooks";
import { clerkKeyFor, usePublicConfig } from "@/lib/public-config";

export { AuthContext, useAuth, type AuthState } from "@/lib/auth-context";

// Clerk's runtime is only downloaded when the API says the auth mode is "clerk".
const ClerkAuth = dynamic(() => import("./ClerkAuth"), { ssr: false });

/**
 * Picks dev or Clerk auth from GET /config/public at runtime. Until that
 * answers, children see `ready: false` and keep showing their skeletons.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { config, loaded } = usePublicConfig();
  const key = clerkKeyFor(config);
  if (!loaded) return <PendingAuth>{children}</PendingAuth>;
  if (config.auth_mode === "clerk" && key) return <ClerkAuth publishableKey={key}>{children}</ClerkAuth>;
  return <DevAuth>{children}</DevAuth>;
}

const PENDING: AuthState = { mode: "dev", ready: false, signedIn: false, email: null, signOut: () => {} };

function PendingAuth({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={PENDING}>{children}</AuthContext.Provider>;
}

function DevAuth({ children }: { children: ReactNode }) {
  const snap = useAuthSnapshot();
  const isClient = useIsClient();
  const email = snap.split("|")[0] || null;
  const value = useMemo<AuthState>(
    () => ({
      mode: "dev",
      ready: isClient,
      signedIn: Boolean(email),
      email,
      signOut: () => setDevEmail(null),
    }),
    [email, isClient],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
