"use client";

import { Plus, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { IdentityOut, LookOut } from "@/lib/types";
import { Avatar, identityThumb } from "./IdentityCard";

export function LookTile({
  look,
  active,
  onClick,
  size = 72,
}: {
  look: Pick<LookOut, "id" | "name" | "thumbnail_url" | "media_url" | "kind">;
  active: boolean;
  onClick: () => void;
  size?: number;
}) {
  const src = look.thumbnail_url || (look.kind === "photo" ? look.media_url : null);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-[84px] flex-col items-center gap-1 text-center"
      title={look.name}
    >
      <span
        className={[
          "relative block overflow-hidden rounded-xl bg-surface-2 ring-offset-2 ring-offset-surface",
          active ? "ring-[3px] ring-accent" : "ring-1 ring-line",
        ].join(" ")}
        style={{ width: size, height: Math.round(size * 1.3) }}
      >
        {src ? (
          <Image src={src} alt="" fill sizes={`${size}px`} unoptimized className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">
            <UserRound size={28} />
          </span>
        )}
      </span>
      <span className={`w-full truncate text-xs ${active ? "font-semibold text-accent" : "text-muted"}`}>{look.name}</span>
    </button>
  );
}

export interface LookPickerProps {
  identities: IdentityOut[];
  identityId: string | null;
  lookId: string | null;
  onIdentity: (id: string) => void;
  onLook: (id: string | null) => void;
  /** Small informational element next to the "Look" label (e.g. "Style on"). */
  trailing?: ReactNode;
}

/** Horizontal thumbnails: avatars (when more than one) then that avatar's looks. */
export function LookPicker({ identities, identityId, lookId, onIdentity, onLook, trailing }: LookPickerProps) {
  const identity = identities.find((i) => i.id === identityId) ?? null;
  return (
    <div className="space-y-3">
      {identities.length > 1 ? (
        <div className="rail" role="radiogroup" aria-label="Avatar">
          {identities.map((i) => {
            const active = i.id === identityId;
            return (
              <button
                key={i.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onIdentity(i.id);
                  onLook(null);
                }}
                className={[
                  "flex min-h-11 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm font-medium",
                  active ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface",
                ].join(" ")}
              >
                <Avatar src={identityThumb(i)} alt="" size={32} rounded="rounded-full" />
                <span className="max-w-[120px] truncate">{i.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-baseline justify-between">
        <span className="flex items-center text-sm font-semibold text-muted">
          Look{identity ? ` · ${identity.name}` : ""}
          {trailing}
        </span>
        {identity ? (
          <Link href={`/avatars/${identity.id}`} className="text-sm font-semibold text-accent">
            Manage
          </Link>
        ) : null}
      </div>
      <div className="rail" role="radiogroup" aria-label="Look">
        {identity && identity.looks.length > 0 ? (
          identity.looks.map((l) => <LookTile key={l.id} look={l} active={(lookId ?? identity.looks.find((x) => x.is_default)?.id ?? identity.looks[0]?.id) === l.id} onClick={() => onLook(l.id)} />)
        ) : identity ? (
          <LookTile
            look={{ id: "reference", name: "Recording", thumbnail_url: identity.thumbnail_url ?? null, media_url: null, kind: "video" }}
            active
            onClick={() => onLook(null)}
          />
        ) : null}
        {identity ? (
          <Link
            href={`/avatars/${identity.id}?add=1`}
            className="flex w-[84px] flex-col items-center gap-1 text-center"
            aria-label="Add a look"
          >
            <span className="flex items-center justify-center rounded-xl border border-dashed border-line text-muted" style={{ width: 72, height: 94 }}>
              <Plus />
            </span>
            <span className="text-xs text-muted">Add look</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
