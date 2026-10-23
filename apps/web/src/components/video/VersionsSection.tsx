"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Card, SectionTitle } from "@/components/ui/Card";
import { formatDuration, languageLabel } from "@/lib/format";
import type { VideoOut } from "@/lib/types";
import { Thumb } from "./VideoCard";

export function isActiveVideo(v: VideoOut) {
  return v.status === "queued" || v.status === "rendering";
}

export function kindLabel(kind: string | null | undefined): string {
  if (kind === "translation") return "Translation";
  if (kind === "clip") return "Clip";
  return "Video";
}

/**
 * Translations and clips made from this video (GET /videos/{id}/derived).
 * Renders nothing until there is at least one.
 */
export function VersionsSection({ items }: { items: VideoOut[] }) {
  if (items.length === 0) return null;
  const translations = items.filter((v) => v.kind === "translation");
  const clips = items.filter((v) => v.kind === "clip");
  const other = items.filter((v) => v.kind !== "translation" && v.kind !== "clip");
  return (
    <section aria-label="Versions" className="space-y-3">
      <SectionTitle>Versions</SectionTitle>
      {translations.length > 0 ? <Group title="Translations" items={translations} /> : null}
      {clips.length > 0 ? <Group title="Clips" items={clips} /> : null}
      {other.length > 0 ? <Group title="Other" items={other} /> : null}
    </section>
  );
}

function Group({ title, items }: { title: string; items: VideoOut[] }) {
  return (
    <Card className="p-0">
      <h3 className="px-4 pt-3 text-sm font-semibold text-muted">{title}</h3>
      <ul className="divide-y divide-line">
        {items.map((v) => (
          <li key={v.id}>
            <Link href={`/videos/${v.id}`} className="flex min-h-16 items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
              <Thumb src={v.thumbnail_url} alt="" size={48} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={v.kind === "clip" ? "neutral" : "accent"}>{kindLabel(v.kind)}</Badge>
                  <span className="text-sm font-semibold">{v.kind === "clip" ? v.title || "Clip" : languageLabel(v.language)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {v.kind === "clip" ? `${languageLabel(v.language)}${v.duration_s ? ` · ${formatDuration(v.duration_s)}` : ""}` : v.title}
                  {v.status === "failed" && v.error_message ? ` · ${v.error_message}` : ""}
                </span>
                <span className="mt-1 block">
                  <StatusPill status={v.status} />
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-accent">
                Open <ChevronRight size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
