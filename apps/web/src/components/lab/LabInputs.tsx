"use client";

import { ChevronDown, Play, Plus, Square, Upload, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { FilePicker, useUploader } from "@/components/uploader/FilePicker";
import { AddVoiceSheet } from "@/components/voice/AddVoiceSheet";
import { useVoicePlayer } from "@/components/voice/VoiceRow";
import { ASPECTS, LAB_CLIP_ENGINES, LAB_RUN_ENGINES } from "@/lib/constants";
import type { PresignPurpose } from "@/lib/types";
import type { Aspect, LabEngine, VoiceOut } from "@/lib/types";

/** Sentinel option at the end of the voice select that opens the Add voice sheet. */
const ADD_VOICE = "__add_voice__";

export interface UploadedFile {
  key: string;
  name: string;
}

export interface LabInputState {
  script: string;
  voiceId: string | null;
  look: UploadedFile | null;
  clip: UploadedFile | null;
  benchmark: UploadedFile | null;
  aspect: Aspect;
  steps: number;
}

export function LabInputs({
  open,
  onToggle,
  value,
  onChange,
  voices,
  onVoicesAdded,
  engines,
  enginesLoading,
  selected,
  onToggleEngine,
  onRun,
  running,
  onAddBenchmark,
  addingBenchmark,
}: {
  open: boolean;
  onToggle: () => void;
  value: LabInputState;
  onChange: (patch: Partial<LabInputState>) => void;
  voices: VoiceOut[];
  /** New voices from the "Add a voice" sheet; the caller refreshes its list and selects the first. */
  onVoicesAdded: (voices: VoiceOut[]) => void;
  engines: LabEngine[];
  enginesLoading: boolean;
  selected: Set<string>;
  onToggleEngine: (id: string) => void;
  onRun: () => void;
  running: boolean;
  onAddBenchmark: () => void;
  addingBenchmark: boolean;
}) {
  const player = useVoicePlayer();
  const [addVoice, setAddVoice] = useState(false);
  const voice = voices.find((v) => v.id === value.voiceId) ?? null;
  const runnable = engines.filter((e) => (LAB_RUN_ENGINES as readonly string[]).includes(e.id));
  const hasClip = Boolean(value.clip);
  const hasSource = Boolean(value.look || value.clip);
  const scriptOk = value.script.trim().length > 0;
  const chosen = runnable.filter((e) => selected.has(e.id) && (!(LAB_CLIP_ENGINES as readonly string[]).includes(e.id) || hasClip));
  const canRun = scriptOk && Boolean(value.voiceId) && hasSource && chosen.length > 0 && !running;
  const blocker = !scriptOk
    ? "Add the test script."
    : !value.voiceId
      ? "Pick a voice."
      : !hasSource
        ? "Upload a photo (or a real clip)."
        : chosen.length === 0
          ? "Tick at least one engine."
          : null;
  const panelId = useId();

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span>
          <span className="block text-lg font-bold">Inputs</span>
          <span className="block text-sm text-muted">Same script, voice and photo for every engine.</span>
        </span>
        <ChevronDown size={22} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open ? (
        <div id={panelId} className="space-y-5 border-t border-line px-4 pb-4 pt-4">
          <Textarea
            label="Test script"
            value={value.script}
            onChange={(e) => onChange({ script: e.target.value })}
            rows={6}
            maxLength={5000}
            hint={`${value.script.trim() ? value.script.trim().split(/\s+/).length : 0} words · about ${Math.round((value.script.trim().split(/\s+/).filter(Boolean).length / 150) * 60)} s`}
          />

          <div className="space-y-2">
            {voices.length === 0 ? (
              <div className="space-y-1.5">
                <span className="block text-sm font-semibold text-muted">Voice</span>
                <Button variant="secondary" full icon={<Plus size={18} />} onClick={() => setAddVoice(true)}>
                  Add a voice
                </Button>
                <p className="text-xs text-muted">No voices in this workspace yet. Pick one from the library, clone your own, or import your ElevenLabs voices.</p>
              </div>
            ) : (
              <Select
                label="Voice"
                value={value.voiceId ?? ""}
                onChange={(e) => {
                  if (e.target.value === ADD_VOICE) {
                    setAddVoice(true);
                    return;
                  }
                  onChange({ voiceId: e.target.value || null });
                }}
              >
                <option value="">Choose a voice</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.engine}
                  </option>
                ))}
                <option value={ADD_VOICE}>Add more…</option>
              </Select>
            )}
            {voice ? (
              <div className="rail">
                <Chip
                  onClick={() => player.toggle(voice)}
                  icon={player.playingId === voice.id ? <Square size={14} /> : <Play size={14} />}
                  disabled={player.loadingId === voice.id}
                >
                  {player.playingId === voice.id ? "Stop" : "Hear it"}
                </Chip>
              </div>
            ) : null}
            <AddVoiceSheet
              open={addVoice}
              onClose={() => setAddVoice(false)}
              myVoices={voices}
              onAdded={(added) => {
                onVoicesAdded(added);
                onChange({ voiceId: added[0].id });
              }}
            />
          </div>

          <UploadField
            label="Photo"
            hint="One clear, front-facing photo. Used by the photo engines."
            accept="image/jpeg,image/png,image/webp"
            purpose="look"
            fallbackType="image/jpeg"
            file={value.look}
            onFile={(f) => onChange({ look: f })}
          />
          <UploadField
            label="Real clip (optional)"
            hint="A short video of the person. Unlocks the real-footage and mouth-only engines."
            accept="video/mp4,video/quicktime,video/webm"
            purpose="reference"
            fallbackType="video/mp4"
            file={value.clip}
            onFile={(f) => onChange({ clip: f })}
          />
          <UploadField
            label="HeyGen benchmark (optional)"
            hint="The same script rendered by HeyGen, as an mp4. It joins the grid as one more clip to score."
            accept="video/mp4"
            purpose="reference"
            fallbackType="video/mp4"
            file={value.benchmark}
            onFile={(f) => onChange({ benchmark: f })}
          />

          <ChipGroup label="Aspect" options={ASPECTS} value={value.aspect} onChange={(aspect) => onChange({ aspect })} />

          <Input
            label="Steps"
            type="number"
            inputMode="numeric"
            min={4}
            max={60}
            value={value.steps}
            onChange={(e) => onChange({ steps: Math.max(4, Math.min(60, Number(e.target.value) || 20)) })}
            hint="Sampling steps for the diffusion engines. 20 is the Stage 0 default."
            containerClassName="max-w-[160px]"
          />

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-muted">Run</legend>
            {enginesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-6 w-1/2" />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {runnable.map((e) => {
                  const needsClip = (LAB_CLIP_ENGINES as readonly string[]).includes(e.id);
                  const disabled = needsClip && !hasClip;
                  return (
                    <label
                      key={e.id}
                      className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 ${
                        disabled ? "cursor-not-allowed border-line opacity-50" : selected.has(e.id) ? "border-accent bg-accent-soft" : "border-line"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[var(--accent)]"
                        checked={selected.has(e.id) && !disabled}
                        disabled={disabled}
                        onChange={() => onToggleEngine(e.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{e.label}</span>
                        <span className="block text-xs text-muted">
                          {e.runs_on === "local" ? "Runs on this machine" : "Runs on the GPU"}
                          {disabled ? " · upload a real clip first" : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="lg" onClick={onRun} disabled={!canRun} loading={running} className="w-full sm:w-auto">
                Run selected{chosen.length ? ` (${chosen.length})` : ""}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={onAddBenchmark}
                disabled={!value.benchmark || addingBenchmark}
                loading={addingBenchmark}
                className="w-full sm:w-auto"
              >
                Add HeyGen benchmark
              </Button>
            </div>
            {blocker ? <p className="text-xs text-muted">{blocker}</p> : <p className="text-xs text-muted">One trial per ticked engine. Trials never use credits.</p>}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function UploadField({
  label,
  hint,
  accept,
  purpose,
  fallbackType,
  file,
  onFile,
}: {
  label: ReactNode;
  hint?: string;
  accept: string;
  purpose: PresignPurpose;
  fallbackType: string;
  file: UploadedFile | null;
  onFile: (f: UploadedFile | null) => void;
}) {
  const uploader = useUploader();
  async function pick(f: File) {
    const key = await uploader.upload({ purpose, file: f, filename: f.name, contentType: f.type || fallbackType });
    if (key) onFile({ key, name: f.name });
  }
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-semibold text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <FilePicker accept={accept} size="sm" variant="secondary" loading={uploader.busy} onFile={pick} icon={<Upload size={16} />}>
          {file ? "Replace" : "Upload"}
        </FilePicker>
        <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : <span className="text-muted">Nothing uploaded yet</span>}</span>
        {file ? (
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            onClick={() => onFile(null)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      {uploader.busy ? <ProgressBar value={(uploader.progress ?? 0) * 100} label={`Uploading ${label}`} /> : null}
      {uploader.error ? <p className="text-sm text-red">{uploader.error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
