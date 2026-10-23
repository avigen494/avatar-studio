"use client";

import { Captions, Copy, CornerLeftUp, Download, FileText, FolderInput, Languages, Pencil, RotateCcw, ScanFace, Scissors, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Badge, StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { engineLabel, formatDate, formatDuration, languageLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isGateFailure, qualityHint, qualityLabel } from "@/lib/quality";
import type { VideoOut } from "@/lib/types";
import { ClipSheet } from "./ClipSheet";
import { RenderProgress } from "./RenderProgress";
import { ShareSheet } from "./ShareSheet";
import { TranslateSheet } from "./TranslateSheet";
import { isActiveVideo, kindLabel, VersionsSection } from "./VersionsSection";

function isActive(v: VideoOut) {
  return v.status === "queued" || v.status === "rendering" || v.preview_status === "queued" || v.preview_status === "rendering";
}

/** The media endpoint honours ?dl=<name> to send the file as a download. */
function downloadUrl(url: string | null | undefined, name: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.set("dl", name);
    return u.toString();
  } catch {
    return url;
  }
}

function safeName(title: string) {
  return (title.replace(/[^\w\- ]+/g, "").trim() || "video").slice(0, 60);
}

export function VideoScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const { refetch: refetchMe, me } = useMe();
  const q = useApi(() => api.videos.get(id), ["video", id], { pollWhile: isActive, pollMs: 2000 });
  const video = q.data;
  // v3: translations and clips made from this video. Polls while one is rendering.
  const derived = useApi(() => api.videos.derived(id), ["derived", id], {
    enabled: video?.status === "succeeded",
    pollWhile: (list) => list.some(isActiveVideo),
    pollMs: 3000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"share" | "download" | "more" | "project" | "translate" | "clip" | null>(null);

  async function act(name: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(name);
    try {
      await fn();
      after?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (q.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="aspect-[9/16] max-h-[55dvh] w-full rounded-2xl" />
        <Skeleton className="h-7 w-2/3" />
        <SkeletonText lines={2} />
      </div>
    );
  }
  if (q.error || !video) return <Notice tone="red">{errorMessage(q.error, "That video could not be loaded.")}</Notice>;

  const rendering = video.status === "queued" || video.status === "rendering";
  const done = video.status === "succeeded";
  const base = safeName(video.title);

  return (
    <div className="space-y-4">
      {/* Player / poster */}
      {done && video.output_url ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video
            key={video.output_captioned_url && video.captions ? "captioned" : "plain"}
            src={video.output_url}
            poster={video.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="mx-auto max-h-[62dvh] w-full object-contain"
          />
        </div>
      ) : video.preview_status === "ready" && video.preview_url && !rendering ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <video src={video.preview_url} poster={video.thumbnail_url ?? undefined} controls playsInline preload="metadata" className="mx-auto max-h-[50dvh] w-full object-contain" />
          <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">Preview · 480p</span>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={video.status} />
          {video.kind && video.kind !== "video" ? <Badge tone="accent">{kindLabel(video.kind)}</Badge> : null}
          {video.ai_labelled ? <Badge tone="accent">AI-assisted</Badge> : null}
          {video.watermarked ? <Badge tone="amber">Watermark on free plan</Badge> : null}
        </div>
        <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{video.title}</h1>
        <p className="text-sm text-muted">
          {formatDate(video.created_at, true)}
          {video.duration_s ? ` · ${formatDuration(video.duration_s)}` : ""} · {languageLabel(video.language)} · {engineLabel(video.resolved_engine ?? video.engine_mode)} ·{" "}
          {video.quality === "4k" ? "4K" : video.quality}
          {done ? ` · ${video.charged_credits} credits used` : ""}
          {done && video.share_enabled ? ` · ${video.views} ${video.views === 1 ? "view" : "views"}` : ""}
        </p>
        {video.source_video_id ? (
          <Link href={`/videos/${video.source_video_id}`} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent">
            <CornerLeftUp size={16} /> Open the original video
          </Link>
        ) : null}
      </div>

      {rendering ? (
        <RenderProgress
          video={video}
          cancelling={busy === "cancel"}
          onCancel={() => act("cancel", () => api.videos.cancel(video.id), () => q.refetch())}
        />
      ) : null}

      {video.status === "failed" ? (
        <Card className="space-y-3">
          <Notice tone="red">
            <p className="font-semibold">This render did not finish.</p>
            <p>{video.error_message || "Something went wrong on our side."}</p>
          </Notice>
          {isGateFailure(video.error_message) ? (
            <Notice tone="amber">
              <p className="font-semibold">Tips for a clearer reference</p>
              <p>Face the camera, even light, no sunglasses, one person in frame.</p>
              <Link href={`/avatars/${video.identity_id}`} className="mt-1 inline-flex min-h-9 items-center font-semibold underline">
                Open the avatar to re-record
              </Link>
            </Notice>
          ) : null}
          <p className="text-sm font-medium">You were not charged.</p>
          <div className="flex gap-2">
            <Button
              full
              icon={<RotateCcw size={18} />}
              loading={busy === "retry"}
              onClick={() =>
                act("retry", () => api.videos.generate(video.id), () => {
                  q.refetch();
                  refetchMe();
                })
              }
            >
              Try again
            </Button>
            <Button variant="secondary" href={`/create?v=${video.id}`} icon={<Pencil size={18} />}>
              Edit
            </Button>
          </div>
        </Card>
      ) : null}

      {video.status === "cancelled" ? (
        <Card className="space-y-3">
          <p className="text-base">Render cancelled. You were not charged.</p>
          <div className="flex gap-2">
            <Button full icon={<RotateCcw size={18} />} loading={busy === "retry"} onClick={() => act("retry", () => api.videos.generate(video.id), () => q.refetch())}>
              Start again
            </Button>
            <Button variant="secondary" href={`/create?v=${video.id}`} icon={<Pencil size={18} />}>
              Edit
            </Button>
          </div>
        </Card>
      ) : null}

      {video.status === "draft" ? (
        <Card className="space-y-3">
          <p className="text-base">This video has not been made yet. Open it in Create to see the estimate and generate it.</p>
          <Button full href={`/create?v=${video.id}`} icon={<Pencil size={18} />}>
            Open in Create
          </Button>
        </Card>
      ) : null}

      {done ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setSheet("download")} icon={<Download size={18} />}>
              Download
            </Button>
            <Button onClick={() => setSheet("share")} icon={<Share2 size={18} />}>
              Share
            </Button>
          </div>

          <Card className="space-y-2 p-3">
            <Button
              variant="secondary"
              full
              icon={<Copy size={18} />}
              loading={busy === "duplicate"}
              onClick={() =>
                act("duplicate", async () => {
                  const copy = await api.videos.duplicate(video.id);
                  router.push(`/create?v=${copy.id}`);
                })
              }
            >
              Make another with this script
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSheet("translate")} icon={<Languages size={18} />}>
                Translate
              </Button>
              <Button variant="secondary" onClick={() => setSheet("clip")} icon={<Scissors size={18} />}>
                Clip
              </Button>
            </div>
          </Card>

          <ConsistencyRow video={video} />

          {video.transcript ? (
            <details className="group rounded-2xl border border-line bg-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-base font-semibold">
                <span className="inline-flex items-center gap-2">
                  <FileText size={18} /> Transcript
                </span>
                <span className="text-sm text-muted group-open:hidden">Show</span>
                <span className="hidden text-sm text-muted group-open:inline">Hide</span>
              </summary>
              <p className="whitespace-pre-wrap px-4 pb-4 text-[15px] leading-relaxed">{video.transcript}</p>
            </details>
          ) : null}

          <VersionsSection items={derived.data ?? []} />
        </>
      ) : null}

      {!rendering ? (
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => setSheet("project")} icon={<FolderInput size={16} />}>
            Move to project
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} />}
            loading={busy === "delete"}
            onClick={() => {
              if (!window.confirm("Delete this video? This cannot be undone.")) return;
              act("delete", () => api.videos.remove(video.id), () => router.replace("/"));
            }}
          >
            Delete
          </Button>
          <Link href={`/create?v=${video.id}`} className="ml-auto inline-flex min-h-10 items-center gap-1 px-2 text-sm font-semibold text-accent">
            <Pencil size={16} /> Edit script
          </Link>
        </div>
      ) : null}

      <ShareSheet open={sheet === "share"} onClose={() => setSheet(null)} video={video} onVideo={(v) => q.setData(v)} />

      <Sheet open={sheet === "download"} onClose={() => setSheet(null)} title="Download" description={me?.workspace.watermark_enabled ? "Free plan files carry a small watermark." : undefined}>
        <ul className="space-y-2 pt-1">
          <DownloadRow href={downloadUrl(video.output_url, `${base}.mp4`)} icon={<Download size={18} />} label="MP4" hint="Clean video" />
          <DownloadRow href={downloadUrl(video.output_captioned_url, `${base}-captions.mp4`)} icon={<Captions size={18} />} label="MP4 with captions" hint="Captions burned in" />
          <DownloadRow href={downloadUrl(video.srt_url, `${base}.srt`)} icon={<FileText size={18} />} label="SRT" hint="Caption file for editors" />
        </ul>
      </Sheet>

      {sheet === "project" ? <ProjectSheet video={video} onClose={() => setSheet(null)} onVideo={(v) => q.setData(v)} /> : null}

      <TranslateSheet open={sheet === "translate"} onClose={() => setSheet(null)} video={video} onQueued={() => derived.refetch()} />
      <ClipSheet open={sheet === "clip"} onClose={() => setSheet(null)} video={video} onDone={() => derived.refetch()} />
    </div>
  );
}

/** Quality-gate result for a finished render: score + method, attempts when the gate retried, and the pinned seed. */
function ConsistencyRow({ video }: { video: VideoOut }) {
  const label = qualityLabel(video.quality_score, video.quality_method);
  const attempts = video.render_attempts ?? 0;
  const seed = video.render_seed ?? null;
  if (!label && attempts <= 1 && seed === null) return null;
  return (
    <Card className="space-y-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <ScanFace size={16} aria-hidden /> Consistency
        </span>
        {label ? (
          <Badge tone={video.quality_method === "face_match" ? "green" : "neutral"} title={qualityHint(video.quality_method)}>
            {label}
          </Badge>
        ) : null}
        {attempts > 1 ? <Badge tone="amber">Attempt {attempts} of {attempts}</Badge> : null}
      </div>
      {label ? <p className="text-xs text-muted">{qualityHint(video.quality_method)}</p> : null}
      {seed !== null ? (
        <p className="text-xs text-muted">
          Seed {seed} · pinned per avatar{video.engine_version ? ` · ${video.engine_version}` : ""}
        </p>
      ) : null}
    </Card>
  );
}

function DownloadRow({ href, icon, label, hint }: { href: string | null; icon: React.ReactNode; label: string; hint: string }) {
  const inner = (
    <>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{label}</span>
        <span className="block text-sm text-muted">{href ? hint : "Not available for this video"}</span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <a href={href} download className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-surface-2">
          {inner}
        </a>
      ) : (
        <div className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 opacity-50" aria-disabled>
          {inner}
        </div>
      )}
    </li>
  );
}

function ProjectSheet({ video, onClose, onVideo }: { video: VideoOut; onClose: () => void; onVideo: (v: VideoOut) => void }) {
  const projects = useApi(() => api.projects.list(), ["projects"]);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function move(projectId: string | null) {
    setBusy(projectId ?? "none");
    try {
      onVideo(await api.videos.patch(video.id, { project_id: projectId }));
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Move to project">
      <div className="space-y-2 pt-1">
        {projects.loading ? <SkeletonText lines={3} /> : null}
        {projects.data?.length === 0 ? (
          <p className="text-sm text-muted">
            No projects yet.{" "}
            <Link href="/projects" className="font-semibold text-accent">
              Create one
            </Link>
            .
          </p>
        ) : null}
        {projects.data?.map((p) => (
          <Button key={p.id} variant={p.id === video.project_id ? "primary" : "secondary"} full loading={busy === p.id} onClick={() => move(p.id)}>
            {p.name}
          </Button>
        ))}
        {video.project_id ? (
          <Button variant="ghost" full loading={busy === "none"} onClick={() => move(null)}>
            Remove from project
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
