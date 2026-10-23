import type { Metadata } from "next";
import { Suspense } from "react";
import { PlanScreen } from "@/components/billing/PlanScreen";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Plan & credits" };

export default function PlanPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <PlanScreen />
    </Suspense>
  );
}
