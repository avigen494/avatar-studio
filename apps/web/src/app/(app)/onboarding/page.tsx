import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Set up" };

export default function OnboardingPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <OnboardingScreen />
    </Suspense>
  );
}
