"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { languageLabel } from "@/lib/format";
import type { Language, VoiceOut } from "@/lib/types";

export function engineName(engine: string): string {
  switch (engine) {
    case "elevenlabs":
      return "ElevenLabs";
    case "sarvam":
      return "Sarvam";
    case "chatterbox":
      return "Chatterbox";
    case "mock":
      return "Test engine";
    default:
      return engine.charAt(0).toUpperCase() + engine.slice(1);
  }
}

// One audio element for the whole app: only one voice sample plays at a time.
let sharedAudio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
}
function stopAudio() {
  sharedAudio?.pause();
}

export interface VoicePlayer {
  playingId: string | null;
  loadingId: string | null;
  /** Play (or stop) a voice. Fetches a sample through POST /voices/{id}/preview when needed. */
  toggle: (voice: VoiceOut, opts?: { text?: string; language?: Language; onVoice?: (v: VoiceOut) => void }) => void;
  stop: () => void;
}

/** One shared audio element for a list of voices; inline play, no hover needed. */
export function useVoicePlayer(): VoicePlayer {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => stopAudio, []);

  const stop = useCallback(() => {
    stopAudio();
    setPlayingId(null);
  }, []);

  const toggle = useCallback<VoicePlayer["toggle"]>(
    async (voice, opts) => {
      if (playingId === voice.id) {
        stop();
        return;
      }
      stopAudio();
      let url = voice.sample_url ?? null;
      if (!url || opts?.text) {
        setLoadingId(voice.id);
        try {
          const updated = await api.voices.preview(voice.id, { text: opts?.text, language: opts?.language });
          url = updated.sample_url ?? null;
          opts?.onVoice?.(updated);
        } catch (e) {
          toast(errorMessage(e, "Could not play that voice."), "error");
          setLoadingId(null);
          return;
        }
        setLoadingId(null);
      }
      if (!url) {
        toast("This voice has no sample yet.", "error");
        return;
      }
      const audio = getAudio();
      audio.src = url;
      audio.onended = () => setPlayingId(null);
      audio.onerror = () => {
        setPlayingId(null);
        toast("Could not play that sample.", "error");
      };
      try {
        await audio.play();
        setPlayingId(voice.id);
      } catch {
        setPlayingId(null);
        toast("Tap play again to hear the voice.", "info");
      }
    },
    [playingId, stop, toast],
  );

  return { playingId, loadingId, toggle, stop };
}

export function PlayButton({ voice, player, onVoice }: { voice: VoiceOut; player: VoicePlayer; onVoice?: (v: VoiceOut) => void }) {
  const playing = player.playingId === voice.id;
  const loading = player.loadingId === voice.id;
  return (
    <button
      type="button"
      aria-label={playing ? `Stop ${voice.name}` : `Play ${voice.name}`}
      aria-pressed={playing}
      disabled={loading}
      onClick={() => player.toggle(voice, { onVoice })}
      className={[
        "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
        playing ? "bg-accent text-on-accent" : "bg-surface-2 text-fg",
        loading ? "animate-pulse" : "",
      ].join(" ")}
    >
      {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
    </button>
  );
}

export function VoiceRow({
  voice,
  player,
  onVoice,
  actions,
  selected,
  onSelect,
}: {
  voice: VoiceOut;
  player: VoicePlayer;
  onVoice?: (v: VoiceOut) => void;
  actions?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const body = (
    <div className="min-w-0 flex-1">
      <p className="truncate text-base font-semibold">{voice.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral">{engineName(voice.engine)}</Badge>
        <Badge tone="neutral">{languageLabel(voice.language)}</Badge>
        {voice.source === "clone" ? <Badge tone="accent">Cloned</Badge> : null}
        {voice.has_byo_key ? <Badge tone="neutral">Your key</Badge> : null}
        {voice.is_default ? <Badge tone="green">Default</Badge> : null}
        {voice.status && voice.status !== "ready" ? <Badge tone="amber">{voice.status}</Badge> : null}
      </div>
    </div>
  );
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-2xl border bg-surface p-3",
        selected ? "border-accent ring-2 ring-accent/30" : "border-line",
      ].join(" ")}
    >
      <PlayButton voice={voice} player={player} onVoice={onVoice} />
      {onSelect ? (
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" aria-pressed={selected}>
          {body}
        </button>
      ) : (
        body
      )}
      {actions}
    </div>
  );
}
