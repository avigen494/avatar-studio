"use client";

import { ClerkProvider, useAuth as useClerkAuth, useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useMemo, type ReactNode } from "react";
import { setTokenGetter } from "@/lib/auth";
import { AuthContext, type AuthState } from "@/lib/auth-context";

export default function ClerkAuth({ publishableKey, children }: { publishableKey: string; children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useClerkAuth();
  const { user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [getToken]);

  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const value = useMemo<AuthState>(
    () => ({
      mode: "clerk",
      ready: isLoaded,
      signedIn: Boolean(isSignedIn),
      email,
      signOut: () => clerk.signOut({ redirectUrl: "/sign-in" }),
    }),
    [isLoaded, isSignedIn, email, clerk],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
