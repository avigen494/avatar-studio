"use client";

import { Camera } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { FilePicker, UploadProgress, useUploader } from "@/components/uploader/FilePicker";
import { errorMessage } from "@/lib/api";
import { CONSENT_SCRIPT } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { longDate } from "@/lib/format";
import type { IdentityOut } from "@/lib/types";
import { Recorder } from "./Recorder";

export interface ReferenceCaptureProps {
  identity: IdentityOut;
  /** The name spoken in the consent line. */
  personName: string;
  onDone: (identity: IdentityOut) => void;
  initialMode?: "record" | "upload";
}

/**
 * Record (or upload) the 15-second reference clip, upload it, attach it to
 * the avatar. The teleprompter script doubles as the consent recording.
 */
export function ReferenceCapture({ identity, personName, onDone, initialMode = "record" }: ReferenceCaptureProps) {
  const [mode, setMode] = useState<"record" | "upload">(initialMode);
  const [dateText] = useState(() => longDate(new Date()));
  const [confirmedRead, setConfirmedRead] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploader = useUploader();
  const script = CONSENT_SCRIPT(personName || "there", dateText);

  async function send(blob: Blob, filename: string, contentType: string) {
    setError(null);
    const key = await uploader.upload({ purpose: "reference", file: blob, filename, contentType, identityId: identity.id });
    if (!key) return;
    setSaving(true);
    try {
      const updated = await api.identities.reference(identity.id, { key, consent_text_read: true });
      onDone(updated);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (uploader.busy || saving) {
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-4">
        {uploader.busy ? <UploadProgress progress={uploader.progress} label="Uploading your recording" /> : <p className="text-base font-medium">Saving your recording</p>}
        <p className="text-sm text-muted">Keep this page open. This usually takes a few seconds.</p>
        {uploader.busy ? (
          <Button variant="ghost" full onClick={uploader.cancel}>
            Cancel upload
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error || uploader.error ? <Notice tone="red">{error ?? uploader.error}</Notice> : null}
      {mode === "record" ? (
        <Recorder
          kind="video"
          maxSeconds={15}
          script={script}
          onConfirm={(clip) => send(clip.blob, clip.filename, clip.mimeType)}
          onUploadInstead={() => setMode("upload")}
        />
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-sm font-semibold text-muted">The clip must show you saying this line</p>
            <p className="mt-1 text-[15px] leading-snug">{script}</p>
            <p className="mt-3 text-xs text-muted">15 seconds, face to camera, good light, no music. Phone video is fine.</p>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-[var(--accent)]"
              checked={confirmedRead}
              onChange={(e) => setConfirmedRead(e.target.checked)}
            />
            <span className="text-sm">I am the person in this clip and I say the consent line in it.</span>
          </label>
          <FilePicker
            accept="video/*"
            size="lg"
            full
            disabled={!confirmedRead}
            onFile={(f) => send(f, f.name, f.type || "video/mp4")}
          >
            Choose a video
          </FilePicker>
          <Button variant="ghost" full icon={<Camera size={18} />} onClick={() => setMode("record")}>
            Record with the camera instead
          </Button>
        </div>
      )}
    </div>
  );
}
