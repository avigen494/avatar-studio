"use client";

import { Sparkles, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge, IdentityPill } from "@/components/ui/Badge";
import type { IdentityOut } from "@/lib/types";
import { LockedBadge } from "./AccessSheet";

export function identityThumb(i: IdentityOut): string | null {
  return i.thumbnail_url || i.looks.find((l) => l.is_default)?.thumbnail_url || i.looks[0]?.thumbnail_url || i.looks[0]?.media_url || null;
}

export function Avatar({ src, alt, size = 56, rounded = "rounded-xl" }: { src: string | null; alt: string; size?: number; rounded?: string }) {
  return (
    <div className={`relative shrink-0 overflow-hidden bg-surface-2 ${rounded}`} style={{ width: size, height: size }}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={`${size}px`} unoptimized className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <UserRound size={Math.round(size * 0.45)} />
        </div>
      )}
    </div>
  );
}

/** Shown once style training has finished for this avatar. */
export function StyleTrainedBadge() {
  return (
    <Badge tone="accent">
      <Sparkles size={12} /> Style trained
    </Badge>
  );
}

/** Square card for the 2-up grid on /avatars. */
export function IdentityCard({ identity }: { identity: IdentityOut }) {
  const src = identityThumb(identity);
  return (
    <Link href={`/avatars/${identity.id}`} className="block overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="relative aspect-square w-full bg-surface-2">
        {src ? (
          <Image src={src} alt="" fill sizes="(min-width: 640px) 240px, 45vw" unoptimized className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <UserRound size={48} />
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-base font-semibold">{identity.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <IdentityPill status={identity.status} consent={identity.consent_status} />
          {identity.style_status === "ready" ? <StyleTrainedBadge /> : null}
          {(identity.allowed_user_ids ?? []).length > 0 ? <LockedBadge /> : null}
          <span className="text-xs text-muted">
            {identity.looks.length} {identity.looks.length === 1 ? "look" : "looks"}
          </span>
        </div>
      </div>
    </Link>
  );
}
