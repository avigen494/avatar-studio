"use client";

import { AlertTriangle, Mic, Play, Plus, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { LookPicker } from "@/components/avatar/LookPicker";
import { PinnedBar, PinnedSpacer } from "@/components/layout/PinnedBar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { inputClass } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
import { Toggle } from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { AddVoiceSheet } from "@/components/voice/AddVoiceSheet";
import { useVoicePlayer, VoiceRow } from "@/components/voice/VoiceRow";
import { errorMessage, isApiError } from "@/lib/api";
import { ASPECTS, ENGINES, EXPRESSIONS, GAZES, GESTURES, LANGUAGES, QUALITIES } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { formatSeconds } from "@/lib/format";
import { useApi, useDebouncedValue, useMediaQuery } from "@/lib/hooks";
import type { Aspect, EngineMode, EstimateIn, EstimateOut, IdentityOut, Language, Motion, Quality, VideoCreate, VideoOut, VoiceOut } from "@/lib/types";
import { ScriptHelperHint } from "./HelpMeWrite";
import { ScriptHelperSheet, type AppliedPlan } from "./ScriptHelperSheet";

interface Initial {
  video: VideoOut | null;
  script: string;
  projectId: string | null;
}

/** Loads avatars, voices and (optionally) the draft in ?v=, then mounts the form once. */
export function CreateScreen() {
  const params = useSearchParams();
  const [start] = useState(() => ({
    v: params.get("v"),
    script: params.get("script") ?? "",
    project: params.get("project"),
  }));
  const identities = useApi(() => api.identities.list(), ["identities"]);
  const voices = useApi(() => api.voices.list(), ["voices"]);
  const video = useApi(() => api.videos.get(start.v as string), ["video-initial", start.v], { enabled: Boolean(start.v) });

  if (identities.loading || voices.loading || (start.v && video.loading)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <SkeletonCard />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-12 w-full rounded-2xl" />
      </div>
    );
  }
  const err = identities.error ?? voices.error ?? (start.v ? video.error : undefined);
  if (err) return <Notice tone="red">{errorMessage(err)}</Notice>;

  return (
    <CreateForm
      key={start.v ?? "new"}
      identities={identities.data ?? []}
      voices={voices.data ?? []}
      onVoicesAdded={(added) => {
        // Show them at once, then confirm with the server (default flag, order).
        voices.setData((list) => {
          const ids = new Set((list ?? []).map((v) => v.id));
          return [...(list ?? []), ...added.filter((v) => !ids.has(v.id))];
        });
        voices.refetch();
      }}
      initial={{ video: video.data ?? null, script: start.script, projectId: start.project }}
    />
  );
}

const DEFAULT_MOTION: Motion = { expression: "calm", gesture: "none", gaze: "camera" };

function isPreviewing(v: VideoOut | null | undefined) {
  return Boolean(v && (v.preview_status === "queued" || v.preview_status === "rendering"));
}

function CreateForm({ identities, voices, onVoicesAdded, initial }: { identities: IdentityOut[]; voices: VoiceOut[]; onVoicesAdded: (v: VoiceOut[]) => void; initial: Initial }) {
  const router = useRouter();
  const { toast } = useToast();
  const { me, refetch: refetchMe } = useMe();
  const isPhone = useMediaQuery("(max-width: 639px)");
  const v0 = initial.video;

  const [draftId, setDraftId] = useState<string | null>(v0?.id ?? null);
  const [script, setScript] = useState(v0?.script ?? initial.script);
  /** Set by the Video Agent plan; otherwise the API names the video from the script. */
  const [title, setTitle] = useState<string | null>(null);
  const [identityPick, setIdentityPick] = useState<string | null>(v0?.identity_id ?? null);
  const [lookPick, setLookPick] = useState<string | null>(v0?.look_id ?? null);
  const [voicePick, setVoicePick] = useState<string | null>(v0?.voice_id ?? null);
  const [language, setLanguage] = useState<Language>((v0?.language as Language) ?? "en");
  const [engine, setEngine] = useState<EngineMode>((v0?.engine_mode as EngineMode) ?? "auto");
  const [motion, setMotion] = useState<Motion>({ ...DEFAULT_MOTION, ...(v0?.motion ?? {}) } as Motion);
  const [aspect, setAspect] = useState<Aspect>((v0?.aspect as Aspect) ?? "9:16");
  const [quality, setQuality] = useState<Quality>((v0?.quality as Quality) ?? "720p");
  const [captions, setCaptions] = useState<boolean>(v0?.captions ?? true);
  const [projectId] = useState<string | null>(v0?.project_id ?? initial.projectId);

  const [scriptSheet, setScriptSheet] = useState(false);
  const [helperSheet, setHelperSheet] = useState(false);
  const [voiceSheet, setVoiceSheet] = useState(false);
  const [addVoice, setAddVoice] = useState(false);
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);
  const [serverBlockers, setServerBlockers] = useState<string[]>([]);
  const [previewVideo, setPreviewVideo] = useState<VideoOut | null>(v0);
  const [previewRun, setPreviewRun] = useState(0);
  const player = useVoicePlayer();

  // Derived defaults: never set state from effects.
  const identityId = identityPick ?? identities.find((i) => i.status === "ready")?.id ?? identities[0]?.id ?? null;
  const identity = identities.find((i) => i.id === identityId) ?? null;
  const lookId = lookPick && identity?.looks.some((l) => l.id === lookPick) ? lookPick : null;
  const voiceId = voicePick ?? voices.find((v) => v.is_default)?.id ?? voices[0]?.id ?? null;
  const voice = voices.find((v) => v.id === voiceId) ?? null;
  const trimmed = script.trim();

  // Live estimate, debounced 400 ms.
  const estimateInput = useMemo<EstimateIn>(
    () => ({ script: trimmed, language, engine_mode: engine, quality, identity_id: identityId }),
    [trimmed, language, engine, quality, identityId],
  );
  const debounced = useDebouncedValue(estimateInput, 400);
  const estimate = useApi((): Promise<EstimateOut> => api.videos.estimate(debounced), ["estimate", debounced], {
    enabled: debounced.script.length > 0,
  });
  const est = estimate.data;
  const estStale = estimate.stale;
  const estimating = trimmed.length > 0 && (estimate.loading || debounced.script !== trimmed || debounced.identity_id !== identityId);

  // Preview polling (2 s) while the free preview renders.
  const previewPoll = useApi(() => api.videos.get(previewVideo?.id as string), ["preview-poll", previewVideo?.id, previewRun], {
    enabled: isPreviewing(previewVideo),
    pollWhile: (v) => isPreviewing(v),
    pollMs: 2000,
  });
  const currentPreview = previewPoll.data ?? previewVideo;

  const blockers = serverBlockers.length ? serverBlockers : (est?.blockers ?? []);
  const canAct = Boolean(identityId && voiceId && trimmed && est && !estimating && blockers.length === 0 && !busy);

  function body(): VideoCreate {
    return {
      identity_id: identityId as string,
      voice_id: voiceId as string,
      script: trimmed,
      ...(title ? { title } : {}),
      look_id: lookId,
      project_id: projectId,
      language,
      engine_mode: engine,
      motion,
      aspect,
      quality,
      captions,
    };
  }

  async function saveDraft(): Promise<VideoOut> {
    const b = body();
    if (draftId) {
      try {
        return await api.videos.patch(draftId, b);
      } catch (e) {
        // A finished or busy video cannot be patched in place: fall through to a fresh draft.
        if (!(isApiError(e) && (e.status === 409 || e.status === 404))) throw e;
      }
    }
    const created = await api.videos.create(b);
    setDraftId(created.id);
    window.history.replaceState(window.history.state, "", `/create?v=${created.id}`);
    return created;
  }

  function handleError(e: unknown) {
    if (isApiError(e) && e.status === 422 && e.code === "blocked") {
      setServerBlockers(e.blockers.length ? e.blockers : [e.message]);
      return;
    }
    if (isApiError(e) && e.status === 402) {
      const needed = e.extra["needed"];
      const available = e.extra["available"];
      toast(
        typeof needed === "number" && typeof available === "number"
          ? `Not enough credits: this needs ${needed}, you have ${available}.`
          : e.message,
        "error",
      );
      refetchMe();
      return;
    }
    toast(errorMessage(e), "error");
  }

  async function onPreview() {
    if (!canAct) return;
    setBusy("preview");
    setServerBlockers([]);
    try {
      const draft = await saveDraft();
      const started = await api.videos.preview(draft.id);
      setPreviewVideo(started);
      setPreviewRun((n) => n + 1);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(null);
    }
  }

  async function onGenerate() {
    if (!canAct) return;
    setBusy("generate");
    setServerBlockers([]);
    try {
      const draft = await saveDraft();
      const queued = await api.videos.generate(draft.id);
      router.push(`/videos/${queued.id}`);
    } catch (e) {
      if (isApiError(e) && e.status === 409 && draftId) {
        router.push(`/videos/${draftId}`);
        return;
      }
      handleError(e);
      setBusy(null);
    }
  }

  const noAvatar = identities.length === 0;
  const noVoice = voices.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">Create</h1>
        {draftId ? <Badge>Draft saved</Badge> : null}
      </div>

      {noAvatar ? (
        <Notice tone="amber">
          Set up your avatar first.{" "}
          <Link href="/onboarding?step=1" className="font-semibold underline">
            Open set-up
          </Link>
        </Notice>
      ) : noVoice ? (
        <Notice tone="amber">
          Add a voice first.{" "}
          <button type="button" onClick={() => setAddVoice(true)} className="font-semibold underline">
            Add a voice
          </button>
        </Notice>
      ) : null}

      <Card className="space-y-6">
        {/* Free preview */}
        {currentPreview && currentPreview.preview_status !== "none" ? (
          <PreviewBlock video={currentPreview} onRetry={onPreview} busy={busy === "preview"} />
        ) : null}

        <LookPicker
          identities={identities}
          identityId={identityId}
          lookId={lookId}
          onIdentity={(id) => {
            setIdentityPick(id);
            setServerBlockers([]);
          }}
          onLook={setLookPick}
          trailing={
            identity?.style_status === "ready" ? (
              <Badge tone="accent" className="ml-2" title="This avatar's trained style is applied to every video.">
                <Sparkles size={12} /> Style on
              </Badge>
            ) : null
          }
        />

        {/* Script */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="script" className="text-sm font-semibold text-muted">
              Script
            </label>
            <span className="text-xs text-muted">{trimmed ? `${trimmed.split(/\s+/).length} words` : ""}</span>
          </div>
          {isPhone ? (
            <button
              type="button"
              id="script"
              onClick={() => setScriptSheet(true)}
              className={`${inputClass} min-h-28 whitespace-pre-wrap text-left leading-relaxed ${trimmed ? "" : "text-muted/70"}`}
            >
              {trimmed ? script : "Paste or type what you want to say…"}
            </button>
          ) : (
            <textarea
              id="script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste or type what you want to say…"
              rows={6}
              maxLength={20000}
              className={`${inputClass} min-h-36 resize-y leading-relaxed`}
            />
          )}
          <div className="rail">
            <Chip onClick={() => setHelperSheet(true)} icon={<Wand2 size={16} />}>
              Help me write
            </Chip>
            <Chip tag="Soon" icon={<Mic size={16} />}>
              Record audio
            </Chip>
          </div>
          <ScriptHelperHint />
        </div>

        {/* Voice */}
        <div className="space-y-2">
          <span className="block text-sm font-semibold text-muted">Voice</span>
          <div className="rail">
            {noVoice ? (
              <Chip active onClick={() => setAddVoice(true)} icon={<Plus size={16} />}>
                Add a voice
              </Chip>
            ) : (
              <>
                <Chip active onClick={() => setVoiceSheet(true)} icon={<Mic size={16} />}>
                  {voice ? voice.name : "Choose a voice"}
                </Chip>
                {voice ? (
                  <Chip onClick={() => player.toggle(voice)} icon={<Play size={16} />}>
                    {player.playingId === voice.id ? "Stop" : "Hear it"}
                  </Chip>
                ) : null}
                <Chip onClick={() => setAddVoice(true)} icon={<Plus size={16} />}>
                  Add more…
                </Chip>
              </>
            )}
          </div>
          {noVoice ? <p className="text-xs text-muted">Pick one from the library, clone your own, or import your ElevenLabs voices.</p> : null}
        </div>

        <ChipGroup label="Language" options={LANGUAGES} value={language} onChange={setLanguage} />
        <ChipGroup label="Engine" options={ENGINES} value={engine} onChange={setEngine} />
        <ChipGroup label="Expression" options={EXPRESSIONS} value={motion.expression} onChange={(expression) => setMotion({ ...motion, expression })} />
        <ChipGroup label="Gesture" options={GESTURES} value={motion.gesture} onChange={(gesture) => setMotion({ ...motion, gesture })} />
        <ChipGroup label="Gaze" options={GAZES} value={motion.gaze} onChange={(gaze) => setMotion({ ...motion, gaze })} />
        <ChipGroup label="Aspect" options={ASPECTS} value={aspect} onChange={setAspect} />
        <ChipGroup label="Quality" options={QUALITIES} value={quality} onChange={setQuality} />
        <Toggle checked={captions} onChange={setCaptions} label="Captions" description="Burned-in captions plus an SRT file." />
      </Card>

      <PinnedSpacer size={148} />
      <PinnedBar aboveTabs={false}>
        <EstimateLine
          hasScript={trimmed.length > 0}
          estimating={estimating}
          estimate={est ?? estStale}
          blockers={blockers}
          balance={me?.credits}
        />
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" size="lg" onClick={onPreview} disabled={!canAct} loading={busy === "preview"} icon={<Play size={18} />}>
            Preview (free)
          </Button>
          <Button size="lg" full onClick={onGenerate} disabled={!canAct} loading={busy === "generate"} icon={<Sparkles size={18} />}>
            Generate
          </Button>
        </div>
      </PinnedBar>

      {/* Full-screen script editor on phones */}
      <Sheet
        open={scriptSheet}
        onClose={() => setScriptSheet(false)}
        title="Script"
        full
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{trimmed ? `${trimmed.split(/\s+/).length} words · ${formatSeconds(estStale?.seconds ?? est?.seconds)}` : "Short sentences read best."}</span>
            <Button onClick={() => setScriptSheet(false)}>Done</Button>
          </div>
        }
      >
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder="Paste or type what you want to say…"
          maxLength={20000}
          autoFocus
          className="block h-full min-h-[50dvh] w-full resize-none border-0 bg-transparent p-0 text-[17px] leading-relaxed outline-none placeholder:text-muted/70"
        />
        <div className="rail mt-3">
          <Chip onClick={() => setHelperSheet(true)} icon={<Wand2 size={16} />}>
            Help me write
          </Chip>
          <Chip tag="Soon" icon={<Mic size={16} />}>
            Record audio
          </Chip>
        </div>
        <div className="mt-2">
          <ScriptHelperHint />
        </div>
      </Sheet>

      <ScriptHelperSheet
        open={helperSheet}
        onClose={() => setHelperSheet(false)}
        language={language}
        identityId={identityId}
        voiceId={voiceId}
        onScript={setScript}
        onPlan={(p: AppliedPlan) => {
          setScript(p.script);
          setTitle(p.title.trim() || null);
          if (p.aspect) setAspect(p.aspect);
          setServerBlockers([]);
        }}
      />

      <Sheet open={voiceSheet} onClose={() => setVoiceSheet(false)} title="Voice">
        <div className="space-y-2 pt-1">
          {voices.map((v) => (
            <VoiceRow key={v.id} voice={v} player={player} selected={v.id === voiceId} onSelect={() => {
              setVoicePick(v.id);
              setVoiceSheet(false);
            }} />
          ))}
          <button
            type="button"
            onClick={() => {
              setVoiceSheet(false);
              setAddVoice(true);
            }}
            className="block w-full pt-2 text-center text-sm font-semibold text-accent"
          >
            Add more…
          </button>
        </div>
      </Sheet>

      <AddVoiceSheet
        open={addVoice}
        onClose={() => setAddVoice(false)}
        myVoices={voices}
        onAdded={(added) => {
          onVoicesAdded(added);
          // Select the new voice so the estimate line and Generate react at once.
          setVoicePick(added[0].id);
          setServerBlockers([]);
        }}
      />
    </div>
  );
}

function EstimateLine({
  hasScript,
  estimating,
  estimate,
  blockers,
  balance,
}: {
  hasScript: boolean;
  estimating: boolean;
  estimate: EstimateOut | undefined;
  blockers: string[];
  balance: number | undefined;
}) {
  if (!hasScript) return <p className="text-sm text-muted">Type or paste a script to see the length and cost.</p>;
  if (!estimate) return <span className="skeleton block h-5 w-56" aria-label="Working out the estimate" />;
  const have = estimate.balance ?? balance ?? 0;
  const tone = blockers.length ? "red" : !estimate.can_afford ? "amber" : "neutral";
  const color = tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : "text-fg";
  return (
    <div aria-live="polite" className={estimating ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <p className={`text-[15px] font-semibold tabular-nums ${color}`}>
        {formatSeconds(estimate.seconds)} · {estimate.credits} credits · you have {have}
      </p>
      {blockers.length ? (
        <p className="mt-0.5 flex items-start gap-1 text-sm text-red">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {blockers[0]}
        </p>
      ) : !estimate.can_afford ? (
        <p className="mt-0.5 text-sm text-amber">Not enough credits for this video. Shorten the script or add credits in Settings.</p>
      ) : null}
    </div>
  );
}

function PreviewBlock({ video, onRetry, busy }: { video: VideoOut; onRetry: () => void; busy: boolean }) {
  if (video.preview_status === "ready" && video.preview_url) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          src={video.preview_url}
          poster={video.thumbnail_url ?? undefined}
          controls
          playsInline
          muted
          autoPlay
          preload="metadata"
          className="mx-auto max-h-[60dvh] w-full object-contain"
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">Preview · 480p · first 15 s</span>
      </div>
    );
  }
  if (video.preview_status === "failed") {
    return (
      <Notice tone="red">
        <p className="font-semibold">The preview did not finish.</p>
        <p>{video.error_message || "Something went wrong on our side. Nothing was charged."}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry} loading={busy}>
          Try the preview again
        </Button>
      </Notice>
    );
  }
  return (
    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">Making your free preview</span>
        <span className="text-muted">{video.preview_status === "queued" ? "Waiting for a machine" : "Rendering"}</span>
      </div>
      <ProgressBar value={0} indeterminate label="Preview progress" />
      <p className="text-xs text-muted">Usually under three minutes. No credits are used for previews.</p>
    </div>
  );
}
