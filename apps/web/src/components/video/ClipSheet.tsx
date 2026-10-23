"use client";

import { Minus, Plus, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sheet } from "@/components/ui/Sheet";
import { errorMessage, isApiError } from "@/lib/api";
import { CLIP_LENGTH_PRESETS, CLIP_MAX_COUNT } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import type { ClipStartOut, JobStatusOut, VideoOut } from "@/lib/types";

function jobActive(j: JobStatusOut) {
  return j.status === "queued" || j.status === "running";
}

/** 1 credit per started minute of the source video. */
export function clipCredits(video: VideoOut): number {
  const seconds = video.duration_s ?? video.estimated_seconds;
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * Cut a finished video into short clips. The API answers with a job; this sheet
 * polls it every 2 s and the clips appear under Versions (kind "clip").
 */
export function ClipSheet({ open, onClose, video, onDone }: { open: boolean; onClose: () => void; video: VideoOut; onDone: () => void }) {
  const [count, setCount] = useState(3);
  const [min, setMin] = useState(15);
  const [max, setMax] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ClipStartOut | null>(null);

  const rangeError = min < 3 ? "Clips need at least 3 seconds." : max <= min ? "The longest clip must be longer than the shortest." : max > 180 ? "Keep clips under 3 minutes." : null;
  const cost = clipCredits(video);

  async function start() {
    if (rangeError) return;
    setBusy(true);
    setError(null);
    try {
      setJob(await api.videos.clip(video.id, { count, min_seconds: min, max_seconds: max }));
    } catch (e) {
      setError(clipError(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    onClose();
    setJob(null);
    setError(null);
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Clip"
      description={job ? undefined : "Find the strongest moments and cut them into short vertical clips."}
      locked={busy}
      footer={
        job ? (
          <Button size="lg" full variant="secondary" onClick={close}>
            Close
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold tabular-nums">
              1 credit per source minute · this video: {cost} {cost === 1 ? "credit" : "credits"}
            </p>
            <Button size="lg" full loading={busy} disabled={Boolean(rangeError)} onClick={start} icon={<Scissors size={18} />}>
              Start
            </Button>
          </div>
        )
      }
    >
      {job ? (
        <ClipProgress job={job} onDone={onDone} />
      ) : (
        <div className="space-y-5 pt-1">
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-muted">How many clips</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Fewer clips"
                disabled={count <= 1}
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line text-fg disabled:opacity-50"
              >
                <Minus size={18} />
              </button>
              <p className="min-w-16 flex-1 text-center text-2xl font-bold tabular-nums" aria-live="polite">
                {count}
              </p>
              <button
                type="button"
                aria-label="More clips"
                disabled={count >= CLIP_MAX_COUNT}
                onClick={() => setCount((c) => Math.min(CLIP_MAX_COUNT, c + 1))}
                className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line text-fg disabled:opacity-50"
              >
                <Plus size={18} />
              </button>
            </div>
            <p className="text-xs text-muted">Up to {CLIP_MAX_COUNT}. Short videos may give fewer clips than asked.</p>
          </div>

          <div className="space-y-2">
            <span className="block text-sm font-semibold text-muted">Clip length</span>
            <div className="rail" role="group" aria-label="Length presets">
              {CLIP_LENGTH_PRESETS.map((p) => (
                <Chip
                  key={p.label}
                  active={min === p.min && max === p.max}
                  onClick={() => {
                    setMin(p.min);
                    setMax(p.max);
                  }}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input label="Shortest (s)" type="number" inputMode="numeric" min={3} max={180} value={min} onChange={(e) => setMin(Number(e.target.value))} />
              <Input label="Longest (s)" type="number" inputMode="numeric" min={5} max={180} value={max} onChange={(e) => setMax(Number(e.target.value))} error={rangeError} />
            </div>
          </div>

          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      )}
    </Sheet>
  );
}

function ClipProgress({ job, onDone }: { job: ClipStartOut; onDone: () => void }) {
  const q = useApi(() => api.jobs.status(job.job_id), ["clip-job", job.job_id], { pollWhile: jobActive, pollMs: 2000 });
  const status = q.data;
  const finished = status?.status === "succeeded";
  // Refresh Versions once when the job finishes (read through a ref so an inline callback does not re-run it).
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    if (finished) onDoneRef.current();
  }, [finished]);
  const clips = status?.result?.clip_ids?.length ?? 0;
  return (
    <div className="space-y-4 pt-1" aria-live="polite">
      {q.error ? <Notice tone="red">{errorMessage(q.error)}</Notice> : null}
      {!status || jobActive(status) ? (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{status?.stage || "Starting"}</span>
            <span className="tabular-nums text-muted">{status ? `${Math.round(status.progress)}%` : ""}</span>
          </div>
          <ProgressBar value={status?.progress ?? 0} label="Clip progress" indeterminate={!status || (status.status === "queued" && status.progress === 0)} />
          <p className="text-sm text-muted">{job.message} You can close this; the clips appear under Versions when they are ready.</p>
        </>
      ) : status.status === "succeeded" ? (
        <Notice tone="green">
          <p className="font-semibold">
            {clips > 0 ? `${clips} ${clips === 1 ? "clip is" : "clips are"} ready.` : "Done."}
          </p>
          <p>Find them under Versions on this page, each with an Open link.</p>
        </Notice>
      ) : (
        <Notice tone="red">
          <p className="font-semibold">Clipping did not finish.</p>
          <p>{status.error || "Something went wrong on our side. Nothing was charged."}</p>
        </Notice>
      )}
    </div>
  );
}

function clipError(e: unknown): string {
  if (isApiError(e) && e.status === 402) {
    const needed = e.extra["needed"];
    const available = e.extra["available"];
    if (typeof needed === "number" && typeof available === "number") return `Not enough credits: this needs ${needed} and you have ${available}.`;
  }
  // 409 not_ready and the engine messages (script needed, ElevenLabs not connected) are shown as the API phrases them.
  return errorMessage(e);
}
