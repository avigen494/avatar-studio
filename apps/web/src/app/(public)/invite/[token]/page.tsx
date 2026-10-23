import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteScreen } from "@/components/team/InviteScreen";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default function InvitePage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <InviteScreen />
    </Suspense>
  );
}
