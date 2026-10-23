"use client";

import { Mic } from "lucide-react";
import { useState } from "react";
import { Recorder } from "@/components/recorder/Recorder";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { ChipGroup } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Field";
import { FilePicker, UploadProgress, useUploader } from "@/components/uploader/FilePicker";
import { errorMessage } from "@/lib/api";
import { LANGUAGES, VOICE_SAMPLE_SCRIPT } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import type { Language, VoiceOut } from "@/lib/types";

export function CloneVoice({ defaultName = "My voice", onDone }: { defaultName?: string; onDone: (voice: VoiceOut) => void }) {
  const [name, setName] = useState(defaultName);
  const [language, setLanguage] = useState<Language>("en");
  const [step, setStep] = useState<"details" | "record" | "upload">("details");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploader = useUploader();

  async function send(blob: Blob, filename: string, contentType: string) {
    setError(null);
    const key = await uploader.upload({ purpose: "voice_sample", file: blob, filename, contentType });
    if (!key) return;
    setSaving(true);
    try {
      const voice = await api.voices.clone({ name: name.trim() || "My voice", sample_key: key, language });
      onDone(voice);
    } catch (e) {
      setError(errorMessage(e, "Could not clone the voice. Try a clearer recording."));
    } finally {
      setSaving(false);
    }
  }

  if (uploader.busy || saving) {
    return (
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        {uploader.busy ? <UploadProgress progress={uploader.progress} label="Uploading your sample" /> : <p className="text-base font-medium">Cloning your voice</p>}
        <p className="text-sm text-muted">This takes under a minute. You can play the result right after.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error || uploader.error ? <Notice tone="red">{error ?? uploader.error}</Notice> : null}
      {step === "details" ? (
        <>
          <Input label="Voice name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="off" />
          <ChipGroup label="Main language" options={LANGUAGES} value={language} onChange={setLanguage} />
          <div className="space-y-2 pt-2">
            <Button size="lg" full icon={<Mic size={20} />} onClick={() => setStep("record")}>
              Record 30 seconds
            </Button>
            <Button variant="secondary" full onClick={() => setStep("upload")}>
              Upload an audio file
            </Button>
          </div>
        </>
      ) : null}
      {step === "record" ? (
        <Recorder
          kind="audio"
          maxSeconds={30}
          script={VOICE_SAMPLE_SCRIPT}
          confirmLabel="Clone this voice"
          onConfirm={(clip) => send(clip.blob, clip.filename, clip.mimeType)}
          onUploadInstead={() => setStep("upload")}
        />
      ) : null}
      {step === "upload" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">30 to 90 seconds of clear speech, one speaker, no music. MP3, WAV, M4A or a phone video all work.</p>
          <FilePicker accept="audio/*,video/*" size="lg" full onFile={(f) => send(f, f.name, f.type || "audio/mpeg")}>
            Choose a file
          </FilePicker>
          <Button variant="ghost" full onClick={() => setStep("record")}>
            Record instead
          </Button>
        </div>
      ) : null}
    </div>
  );
}
