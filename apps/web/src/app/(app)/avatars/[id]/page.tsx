import type { Metadata } from "next";
import { Suspense } from "react";
import { AvatarScreen } from "@/components/avatar/AvatarScreen";
import { ScreenSkeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Avatar" };

export default function AvatarPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <AvatarScreen />
    </Suspense>
  );
}
