import type { Metadata } from "next";
import { Suspense } from "react";
import { ScreenSkeleton } from "@/components/ui/Skeleton";
import { VideoScreen } from "@/components/video/VideoScreen";

export const metadata: Metadata = { title: "Video" };

export default function VideoPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <VideoScreen />
    </Suspense>
  );
}
