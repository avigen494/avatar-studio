"use client";

import { Clapperboard } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { StatusPill } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { VideoOut } from "@/lib/types";

export function Thumb({ src, alt, size = 56, className = "" }: { src?: string | null; alt: string; size?: number; className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl bg-surface-2 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden={alt === ""}
    >
      {src ? (
        <Image src={src} alt={alt} fill sizes={`${size}px`} unoptimized className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <Clapperboard size={Math.round(size * 0.4)} />
        </div>
      )}
    </div>
  );
}

export function creditsLine(v: VideoOut): string {
  if (v.status === "succeeded") return `${v.charged_credits} credits used`;
  if (v.status === "failed" || v.status === "cancelled") return "Not charged";
  return `${v.estimated_credits} credits when done`;
}

export function VideoCard({ video, trailing }: { video: VideoOut; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <Link href={`/videos/${video.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Thumb src={video.thumbnail_url} alt="" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{video.title || "Untitled video"}</p>
          <p className="truncate text-sm text-muted">
            {formatDate(video.created_at)} · {creditsLine(video)}
          </p>
          <div className="mt-1">
            <StatusPill status={video.status} />
          </div>
        </div>
      </Link>
      {trailing}
    </div>
  );
}
