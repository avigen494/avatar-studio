"use client";

import { Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { ScreenSkeleton } from "@/components/ui/Skeleton";
import { setDevEmail } from "@/lib/auth";
import { clerkKeyFor, usePublicConfig } from "@/lib/public-config";
import { AuthProvider, useAuth } from "./AuthProvider";

const ClerkSignIn = dynamic(() => import("./ClerkSignIn"), { ssr: false });

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export function SignInScreen() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const { config, loaded, fallback } = usePublicConfig();
  const key = clerkKeyFor(config);
  if (!loaded) return <ScreenSkeleton />;
  if (config.auth_mode === "clerk" && key) return <ClerkSignIn publishableKey={key} next={next} />;
  return (
    <AuthProvider>
      <DevSignIn next={next} offline={fallback} clerkWithoutKey={config.auth_mode === "clerk"} />
    </AuthProvider>
  );
}

function DevSignIn({ next, offline, clerkWithoutKey }: { next: string; offline: boolean; clerkWithoutKey: boolean }) {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.ready && auth.signedIn) router.replace(next);
  }, [auth.ready, auth.signedIn, next, router]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setDevEmail(v);
    router.replace(next);
  }

  return (
    <div className="flex min-h-dvh flex-col px-4" style={{ paddingTop: "calc(24px + var(--safe-top))" }}>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
        <div className="space-y-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-on-accent">
            <Sparkles size={24} />
          </span>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Avatar Studio</h1>
          <p className="text-base text-muted">Make videos of yourself from your phone. You only pay when a video succeeds.</p>
        </div>
        {offline ? (
          <Notice tone="amber">Could not reach the server to check how sign-in is set up. Using the development sign-in for now.</Notice>
        ) : null}
        {clerkWithoutKey ? (
          <Notice tone="amber">The server is set to Clerk sign-in but has no publishable key yet. Add it in Settings → Connections → Clerk.</Notice>
        ) : null}
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            hint="No password needed on this build. Any email works."
          />
          <Button type="submit" size="lg" full>
            Continue
          </Button>
        </form>
      </div>
      <p className="py-6 text-center text-xs text-muted safe-pb">Development sign-in. The platform admin can switch to Clerk in Settings → Connections.</p>
    </div>
  );
}
