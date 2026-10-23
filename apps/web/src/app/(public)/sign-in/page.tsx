import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/auth/SignInScreen";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <SignInScreen />
    </Suspense>
  );
}
