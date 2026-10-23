import type { Metadata } from "next";
import { Suspense } from "react";
import { ShareScreen } from "@/components/video/ShareScreen";
import { API_URL } from "@/lib/api";

interface Props {
  params: Promise<{ token: string }>;
}

/** Title and description for link previews (WhatsApp, iMessage). Falls back fast if the API is slow. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  try {
    const res = await fetch(`${API_URL}/share/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!res.ok) return { title: "Video", robots: { index: false } };
    const meta = (await res.json()) as { title?: string; creator?: string; summary?: string | null };
    return {
      title: meta.title ? `${meta.title} by ${meta.creator ?? "a creator"}` : "Video",
      description: meta.summary ?? `A video by ${meta.creator ?? "a creator"} on Avatar Studio.`,
      robots: { index: false },
    };
  } catch {
    return { title: "Video", robots: { index: false } };
  }
}

export default function SharePage() {
  return (
    <Suspense fallback={<ShareSkeleton />}>
      <ShareScreen />
    </Suspense>
  );
}

function ShareSkeleton() {
  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-4" aria-busy aria-label="Loading">
      <div className="skeleton aspect-[9/16] max-h-[70dvh] w-full rounded-2xl" />
      <div className="skeleton h-7 w-2/3" />
      <div className="skeleton h-4 w-1/3" />
    </div>
  );
}
