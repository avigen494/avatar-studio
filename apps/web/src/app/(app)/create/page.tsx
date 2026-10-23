import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenSkeleton } from "@/components/ui/Skeleton";
import { CreateScreen } from "@/components/video/CreateScreen";

export const metadata: Metadata = { title: "Create" };

export default function CreatePage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CreateScreen />
    </Suspense>
  );
}
