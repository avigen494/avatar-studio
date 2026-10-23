"use client";

import { Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { RENDER_STAGES } from "@/lib/constants";
import { formatEta } from "@/lib/format";
import type { VideoOut } from "@/lib/types";

function stageCopy(video: VideoOut): string {
  switch (video.stage) {
    case "Queued":
      return "Waiting for a free machine";
    case "Voice":
      return "Making the voice";
    case "Avatar":
      return "Animating your avatar";
    case "Sharpen":
      return `Sharpening to ${video.quality === "4k" ? "4K" : video.quality}`;
    case "Captions":
      return "Adding captions";
    case "Cancelling":
      return "Stopping the render";
    case "Done":
      return "Finishing up";
    default:
      return video.stage || "Working";
  }
}

export function RenderProgress({ video, onCancel, cancelling }: { video: VideoOut; onCancel: () => void; cancelling: boolean }) {
  const idx = (RENDER_STAGES as readonly string[]).indexOf(video.stage);
  const current = video.stage === "Done" ? RENDER_STAGES.length : idx;
  const isCancelling = video.stage === "Cancelling" || cancelling;
  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface p-4" aria-live="polite">
      <div>
        <p className="text-lg font-bold">{isCancelling ? "Stopping" : stageCopy(video)}</p>
        <p className="text-sm text-muted">{video.status === "queued" ? "Starts as soon as a machine is free." : formatEta(video.eta_seconds)}</p>
      </div>

      <ProgressBar value={video.progress} label="Render progress" indeterminate={video.status === "queued" && video.progress === 0} />

      <ol className="grid grid-cols-4 gap-2" aria-label="Stages">
        {RENDER_STAGES.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s} className="flex flex-col items-center gap-1.5 text-center">
              <span
                className={[
                  "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold",
                  state === "done"
                    ? "border-accent bg-accent text-on-accent"
                    : state === "active"
                      ? "border-accent text-accent animate-pulse"
                      : "border-line text-muted",
                ].join(" ")}
                aria-hidden
              >
                {state === "done" ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-xs ${state === "todo" ? "text-muted" : "font-semibold"}`}>
                {s}
                <span className="sr-only">{state === "done" ? " done" : state === "active" ? " in progress" : " not started"}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
        <strong className="font-semibold">{video.estimated_credits} credits on success</strong>, nothing if it fails. You can leave this page; the render keeps going.
      </p>

      <Button variant="secondary" full onClick={onCancel} disabled={isCancelling} loading={cancelling} icon={<XCircle size={18} />}>
        {isCancelling ? "Stopping" : "Cancel (no charge)"}
      </Button>
    </div>
  );
}
