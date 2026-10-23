import { Suspense, type ReactNode } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { MeProvider } from "@/components/auth/MeProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // AuthProvider lives inside the boundary so the auth gate and its provider
    // hydrate in the same pass (a provider outside a lazily hydrated boundary
    // would already hold client values when the boundary hydrates).
    <Suspense fallback={<ScreenSkeleton />}>
      <AuthProvider>
        <RequireAuth>
          <MeProvider>
            <AppShell>{children}</AppShell>
          </MeProvider>
        </RequireAuth>
      </AuthProvider>
    </Suspense>
  );
}
