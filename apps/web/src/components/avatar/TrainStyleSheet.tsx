"use client";

import { Camera, Check, Film, RotateCcw, Sparkles, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Recorder } from "@/components/recorder/Recorder";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { FilePicker, UploadProgress, useUploader } from "@/components/uploader/FilePicker";
import { errorMessage } from "@/lib/api";
import { FOOTAGE_CLIP_SECONDS, MAX_FOOTAGE_SECONDS, MIN_FOOTAGE_SECONDS, TRAIN_STYLE_CREDITS } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { isTraining, jobErrorMessage } from "@/lib/identity-jobs";
import { measureDuration, minutesLabel } from "@/lib/media";
import type { FootageOut, IdentityJob, IdentityOut } from "@/lib/types";

/** What this session knows about a clip beyond what the API lists: its file name and a browser-measured length. */
interface LocalClipInfo {
  name?: string;
  seconds?: number | null;
}

function clipLabel(clip: FootageOut, local: LocalClipInfo | undefined, index: number): string {
  if (local?.name) return local.name;
  const base = clip.key.split("/").pop() ?? "";
  return base || `Clip ${index + 1}`;
}

export interface TrainStyleSheetProps {
  open: boolean;
  identity: IdentityOut;
  /** Newest train_style job, for live progress. */
  job?: IdentityJob;
  onClose: () => void;
  onIdentity: (i: IdentityOut) => void;
  /** Called after training was queued: refetch jobs and the avatar. */
  onStarted: () => void;
}

export function TrainStyleSheet({ open, identity, job, onClose, onIdentity, onStarted }: TrainStyleSheetProps) {
  const { me, refetch: refetchMe } = useMe();
  const { toast } = useToast();
  const uploader = useUploader();
  const [local, setLocal] = useState<Record<string, LocalClipInfo>>({});
  const [mode, setMode] = useState<"list" | "record">("list");
  const [saving, setSaving] = useState<"measure" | "attach" | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [confirmAnyway, setConfirmAnyway] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referenceSeconds = identity.reference_duration_s ?? 0;
  const clips = identity.footage ?? [];
  // The API measures each clip; the browser measurement is only a fallback while a clip's seconds are null.
  const secondsOf = (c: FootageOut): number | null => c.seconds ?? local[c.key]?.seconds ?? null;
  const fallbackSeconds = clips.reduce((sum, c) => sum + (c.seconds === null || c.seconds === undefined ? (local[c.key]?.seconds ?? 0) : 0), 0);
  const apiTotal = identity.footage_seconds_total ?? (clips.length || referenceSeconds ? referenceSeconds + clips.reduce((sum, c) => sum + (c.seconds ?? 0), 0) : 0);
  const total = apiTotal + fallbackSeconds;
  const unknownClips = clips.filter((c) => secondsOf(c) === null).length;
  const meetsMin = total >= MIN_FOOTAGE_SECONDS;
  const overMax = total > MAX_FOOTAGE_SECONDS;
  const training = isTraining(identity);
  const consentOk = identity.consent_status === "verified";
  const hasFootage = Boolean(identity.reference_url) || identity.footage_count > 0;
  const canStart = !training && consentOk && hasFootage && (meetsMin || confirmAnyway) && !starting;
  const balance = me?.credits;
  const working = uploader.busy || saving !== null;

  async function addClip(blob: Blob, filename: string, contentType: string, seconds: number | null) {
    setError(null);
    let length = seconds;
    if (length === null) {
      setSaving("measure");
      length = await measureDuration(blob);
      setSaving(null);
    }
    const key = await uploader.upload({ purpose: "footage", file: blob, filename, contentType, identityId: identity.id });
    if (!key) return;
    setSaving("attach");
    try {
      const updated = await api.identities.addFootage(identity.id, key);
      setLocal((m) => ({ ...m, [key]: { name: filename, seconds: length } }));
      onIdentity(updated);
      setMode("list");
      const added = updated.footage?.find((c) => c.key === key)?.seconds ?? length;
      toast(added ? `Clip added (${minutesLabel(added)}).` : "Clip added.", "success");
    } catch (e) {
      setError(errorMessage(e, "Could not add that clip."));
    } finally {
      setSaving(null);
    }
  }

  async function removeClip(clip: FootageOut) {
    setRemoving(clip.key);
    try {
      onIdentity(await api.identities.removeFootage(identity.id, clip.key));
      setLocal((m) => {
        const next = { ...m };
        delete next[clip.key];
        return next;
      });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRemoving(null);
    }
  }

  async function start() {
    if (!canStart) return;
    setStarting(true);
    setError(null);
    try {
      const started = await api.identities.trainStyle(identity.id);
      toast(started.message, "success");
      setConfirmAnyway(false);
      refetchMe();
      onStarted();
    } catch (e) {
      setError(jobErrorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  const startLabel = identity.style_status === "failed" ? "Try again" : identity.style_status === "ready" ? "Train again" : "Start training";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Train my style"
      description="One-time. Teaches the avatar how you move, gesture and hold yourself, from real footage."
      full
      locked={working || starting}
      footer={
        mode === "record" ? undefined : (
          <div className="space-y-2">
            {error ? <Notice tone="red">{error}</Notice> : null}
            {!meetsMin && !training && hasFootage ? (
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={confirmAnyway} onChange={(e) => setConfirmAnyway(e.target.checked)} />
                <span>
                  Start anyway. With under {minutesLabel(MIN_FOOTAGE_SECONDS)} of footage the training fails and nothing is charged.
                </span>
              </label>
            ) : null}
            <p className="text-sm font-semibold tabular-nums">
              {TRAIN_STYLE_CREDITS} credits, charged only when training finishes
              {typeof balance === "number" ? <span className="font-normal text-muted"> · you have {balance}</span> : null}
            </p>
            <Button size="lg" full onClick={start} disabled={!canStart} loading={starting} icon={<Sparkles size={20} />} variant={identity.style_status === "ready" ? "secondary" : "primary"}>
              {training ? "Training…" : startLabel}
            </Button>
          </div>
        )
      }
    >
      {mode === "record" ? (
        <div className="space-y-3 pt-1">
          <p className="text-sm text-muted">Talk to the camera the way you do in your videos: hands, smiles, pauses. Up to {FOOTAGE_CLIP_SECONDS} seconds per clip.</p>
          <Recorder
            kind="video"
            maxSeconds={FOOTAGE_CLIP_SECONDS}
            confirmLabel="Add this clip"
            onConfirm={(clip) => addClip(clip.blob, clip.filename, clip.mimeType, clip.durationS)}
            onUploadInstead={() => setMode("list")}
          />
          <Button variant="ghost" full onClick={() => setMode("list")}>
            Back
          </Button>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <StatusBlock identity={identity} job={job} />

          <ul className="space-y-1.5 text-sm text-muted">
            <li className="flex gap-2">
              <Check size={16} className="mt-0.5 shrink-0 text-accent" /> One-time per avatar. {TRAIN_STYLE_CREDITS} credits, charged only when training finishes.
            </li>
            <li className="flex gap-2">
              <Check size={16} className="mt-0.5 shrink-0 text-accent" /> Needs {minutesLabel(MIN_FOOTAGE_SECONDS)} to {minutesLabel(MAX_FOOTAGE_SECONDS)} of footage in total. Your consent recording counts.
            </li>
            <li className="flex gap-2">
              <Check size={16} className="mt-0.5 shrink-0 text-accent" /> Record 30–60 s clips or upload videos of yourself talking. Good light, face in view.
            </li>
          </ul>

          <div className="space-y-2 rounded-2xl border border-line p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">Footage</span>
              <span className={`text-sm font-semibold tabular-nums ${meetsMin ? "text-green" : "text-fg"}`}>
                {minutesLabel(total)} of {minutesLabel(MIN_FOOTAGE_SECONDS)} minimum
              </span>
            </div>
            <ProgressBar value={(total / MIN_FOOTAGE_SECONDS) * 100} tone={overMax ? "amber" : meetsMin ? "green" : "accent"} label="Footage toward the minimum" />
            <p className="text-xs text-muted">
              {referenceSeconds ? `Consent recording ${minutesLabel(referenceSeconds)}` : "No consent recording yet"}
              {clips.length ? ` · ${clips.length} ${clips.length === 1 ? "clip" : "clips"} added` : ""}
              {unknownClips ? ` · ${unknownClips} ${unknownClips === 1 ? "clip" : "clips"} of unknown length` : ""}
              {overMax ? ` · over ${minutesLabel(MAX_FOOTAGE_SECONDS)}; the extra is ignored` : ""}
            </p>
          </div>

          {!consentOk ? <Notice tone="amber">Verify the consent recording first. Training only runs for verified avatars.</Notice> : null}

          {working ? (
            <UploadProgress progress={uploader.progress} label={saving === "measure" ? "Reading the clip" : saving === "attach" ? "Saving" : "Uploading"} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={<Camera size={18} />} onClick={() => setMode("record")} disabled={training}>
                Record a clip
              </Button>
              <FilePicker accept="video/*" variant="secondary" icon={<Upload size={18} />} disabled={training} onFile={(f) => addClip(f, f.name, f.type || "video/mp4", null)}>
                Upload a video
              </FilePicker>
            </div>
          )}
          {uploader.error ? <Notice tone="red">{uploader.error}</Notice> : null}

          {clips.length > 0 ? (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {clips.map((c, i) => {
                const label = clipLabel(c, local[c.key], i);
                const seconds = secondsOf(c);
                return (
                  <li key={c.key} className="flex items-center gap-3 px-3 py-2">
                    <Film size={18} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted">
                        {seconds ? minutesLabel(seconds) : "Length unknown"}
                        {c.url ? (
                          <>
                            {" · "}
                            <a href={c.url} target="_blank" rel="noreferrer" className="font-semibold text-accent">
                              Play
                            </a>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      disabled={removing === c.key || training}
                      onClick={() => removeClip(c)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function StatusBlock({ identity, job }: { identity: IdentityOut; job?: IdentityJob }) {
  switch (identity.style_status) {
    case "queued":
      return (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Training queued</span>
            <span className="text-muted">Waiting for a machine</span>
          </div>
          <ProgressBar value={0} indeterminate label="Training" />
          <p className="text-xs text-muted">You can close this. We keep training and show the result here.</p>
        </div>
      );
    case "training":
      return (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">{job?.stage || "Training"}</span>
            <span className="tabular-nums text-muted">{job ? `${job.progress}%` : ""}</span>
          </div>
          <ProgressBar value={job?.progress ?? 0} indeterminate={!job} label="Training" />
          <p className="text-xs text-muted">You can close this. We keep training and show the result here.</p>
        </div>
      );
    case "ready":
      return (
        <Notice tone="green">
          <p className="font-semibold">Style trained{identity.style_trained_at ? ` on ${formatDate(identity.style_trained_at)}` : ""}</p>
          <p>
            {identity.style_footage_seconds ? `Learned from ${minutesLabel(identity.style_footage_seconds)} of footage. ` : ""}
            Videos made with this avatar use it automatically. Add more footage and train again any time.
          </p>
        </Notice>
      );
    case "failed":
      return (
        <Notice tone="red">
          <p className="flex items-center gap-1.5 font-semibold">
            <RotateCcw size={14} /> Training did not finish
          </p>
          <p>{identity.style_error || "Something went wrong on our side. Nothing was charged."}</p>
        </Notice>
      );
    default:
      return null;
  }
}
