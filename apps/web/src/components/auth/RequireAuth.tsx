"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ScreenSkeleton } from "@/components/ui/Skeleton";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.ready && !auth.signedIn) {
      const pathname = window.location.pathname + window.location.search;
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      router.replace(`/sign-in${next}`);
    }
  }, [auth.ready, auth.signedIn, router]);

  // Before we know (server render, first client pass) the pages render their
  // own skeletons; requests only start once the person is signed in.
  if (auth.ready && !auth.signedIn) return <ScreenSkeleton />;
  return <>{children}</>;
}
