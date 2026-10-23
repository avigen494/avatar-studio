"use client";

import { ClerkProvider, SignIn } from "@clerk/nextjs";

export default function ClerkSignIn({ publishableKey, next }: { publishableKey: string; next: string }) {
  return (
    <ClerkProvider publishableKey={publishableKey} signInUrl="/sign-in" signInFallbackRedirectUrl={next} signUpFallbackRedirectUrl={next}>
      <div className="flex min-h-dvh items-center justify-center px-4 py-8">
        <SignIn routing="hash" forceRedirectUrl={next} />
      </div>
    </ClerkProvider>
  );
}
