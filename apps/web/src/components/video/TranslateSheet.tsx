"use client";

import { Languages } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Select } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonText } from "@/components/ui/Skeleton";
import { errorMessage, isApiError } from "@/lib/api";
import { TRANSLATE_CREDITS_PER_MINUTE } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { languageLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { useIsAdmin } from "@/lib/admin";
import type { TranslateMode, VideoOut } from "@/lib/types";

const MODES: { value: TranslateMode; label: string; hint: string }[] = [
  { value: "audio_only", label: "Audio only", hint: "New voice track, video re-rendered." },
  { value: "lip_sync", label: "Lip-sync", hint: "Keeps your real footage, mouth redrawn." },
];

function isActive(v: VideoOut) {
  return v.status === "queued" || v.status === "rendering";
}

/** Credits for one translation of this video: 6 per minute of the source, at least 1. */
export function translationCredits(video: VideoOut): number {
  const seconds = video.duration_s ?? video.estimated_seconds;
  return Math.max(1, Math.round((seconds / 60) * TRANSLATE_CREDITS_PER_MINUTE));
}

/**
 * Translate a finished video into one or more languages. Each language becomes a
 * normal video with kind "translation"; the list at the end polls them.
 */
export function TranslateSheet({ open, onClose, video, onQueued }: { open: boolean; onClose: () => void; video: VideoOut; onQueued: () => void }) {
  const languages = useApi(() => api.translate.languages(), ["translate-languages"], { enabled: open });
  const identity = useApi(() => api.identities.get(video.identity_id), ["identity", video.identity_id], { enabled: open });
  const voices = useApi(() => api.voices.list(), ["voices"], { enabled: open });
  const admin = useIsAdmin();
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<TranslateMode>("audio_only");
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<VideoOut[] | null>(null);

  const hasFootage = Boolean(identity.data?.reference_url);
  const indian = (languages.data ?? []).filter((l) => l.indian);
  const others = (languages.data ?? []).filter((l) => !l.indian);
  const perLanguage = translationCredits(video);

  function toggle(code: string) {
    setError(null);
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  }

  async function submit() {
    if (picked.length === 0) {
      setError("Pick at least one language.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.videos.translate(video.id, { languages: picked, mode, voice_id: voiceId || null, generate: true });
      setQueued(out.videos);
      onQueued();
    } catch (e) {
      setError(translateError(e, admin.isAdmin));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    onClose();
    // Reset for the next time (after the close animation is irrelevant: the sheet unmounts).
    setQueued(null);
    setPicked([]);
    setError(null);
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Translate"
      description={queued ? undefined : "One new video per language, with the same avatar and look. Credits are charged only when each render succeeds."}
      locked={busy}
      footer={
        queued ? (
          <Button size="lg" full onClick={close}>
            Done
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-semibold tabular-nums" aria-live="polite">
              ~{perLanguage} {perLanguage === 1 ? "credit" : "credits"} per language ({TRANSLATE_CREDITS_PER_MINUTE} per minute)
              {picked.length > 1 ? ` · ${picked.length} languages ≈ ${perLanguage * picked.length} credits` : ""}
            </p>
            <Button size="lg" full loading={busy} disabled={picked.length === 0 || (mode === "lip_sync" && !hasFootage)} onClick={submit} icon={<Languages size={18} />}>
              {picked.length > 1 ? `Translate into ${picked.length} languages` : "Translate"}
            </Button>
          </div>
        )
      }
    >
      {queued ? (
        <QueuedList initial={queued} />
      ) : (
        <div className="space-y-5 pt-1">
          {/* Languages */}
          <div className="space-y-2">
            <span className="block text-sm font-semibold text-muted">Languages</span>
            {languages.loading ? <SkeletonText lines={2} /> : null}
            {languages.error ? <Notice tone="red">{errorMessage(languages.error)}</Notice> : null}
            {languages.data ? (
              <>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Indian languages">
                  {indian.map((l) => (
                    <LanguageChip key={l.code} code={l.code} name={l.name} source={video.language} picked={picked.includes(l.code)} onToggle={toggle} />
                  ))}
                </div>
                <div className="flex items-center gap-3 py-1" aria-hidden>
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-xs text-muted">More languages</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Other languages">
                  {others.map((l) => (
                    <LanguageChip key={l.code} code={l.code} name={l.name} source={video.language} picked={picked.includes(l.code)} onToggle={toggle} />
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {/* Mode */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-muted">Mode</legend>
            {MODES.map((m) => {
              const disabled = m.value === "lip_sync" && identity.data !== undefined && !hasFootage;
              const active = mode === m.value;
              return (
                <label
                  key={m.value}
                  className={[
                    "flex items-start gap-3 rounded-xl border p-3",
                    active ? "border-accent bg-accent-soft" : "border-line",
                    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  ].join(" ")}
                >
                  <input type="radio" name="translate-mode" className="mt-1 accent-accent" checked={active} disabled={disabled} onChange={() => setMode(m.value)} />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold">{m.label}</span>
                    <span className="block text-sm text-muted">{m.hint}</span>
                    {disabled ? <span className="block text-xs text-muted">Needs a real-footage recording. This avatar only has photos or designed looks.</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {/* Voice */}
          <Select label="Voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} hint="Same voice keeps the speaker; pick a native voice if you have one.">
            <option value="">Same voice as the original</option>
            {(voices.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {languageLabel(v.language)}
              </option>
            ))}
          </Select>

          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      )}
    </Sheet>
  );
}

function LanguageChip({ code, name, source, picked, onToggle }: { code: string; name: string; source: string; picked: boolean; onToggle: (code: string) => void }) {
  const same = code === source;
  return (
    <Chip active={picked} disabled={same} onClick={() => onToggle(code)} title={same ? "The video is already in this language" : undefined}>
      {name}
    </Chip>
  );
}

/** The videos just queued; polls every 2 s until none is rendering. */
function QueuedList({ initial }: { initial: VideoOut[] }) {
  const ids = initial.map((v) => v.id);
  const q = useApi(() => Promise.all(ids.map((id) => api.videos.get(id))), ["translate-queued", ids.join(",")], {
    pollWhile: (list) => list.some(isActive),
    pollMs: 2000,
  });
  const list = q.data ?? initial;
  const rendering = list.filter(isActive).length;
  return (
    <div className="space-y-3 pt-1" aria-live="polite">
      <p className="text-sm text-muted">
        {rendering > 0
          ? `${list.length} ${list.length === 1 ? "video is" : "videos are"} rendering. You can close this; they appear under Versions.`
          : "All done. Open each version below."}
      </p>
      <ul className="space-y-2">
        {list.map((v) => (
          <li key={v.id}>
            <Link href={`/videos/${v.id}`} className="flex min-h-14 items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-semibold">{languageLabel(v.language)}</span>
                <span className="block truncate text-sm text-muted">{v.status === "failed" ? v.error_message || "Did not finish" : v.title}</span>
              </span>
              <StatusPill status={v.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function translateError(e: unknown, isAdmin: boolean): string {
  if (isApiError(e)) {
    if (e.status === 402) {
      const needed = e.extra["needed"];
      const available = e.extra["available"];
      const base =
        typeof needed === "number" && typeof available === "number" ? `Not enough credits: this needs ${needed} and you have ${available}.` : e.message;
      return `${base} The drafts were kept; add credits in Settings → Plan & credits and generate them from there.`;
    }
    if (e.status === 422 && e.blockers.length) return e.blockers[0];
    if (e.status === 503) {
      return isAdmin
        ? `${e.message} Connect Claude in Settings → Connections to translate scripts.`
        : `${e.message} Ask the platform admin to connect the translation assistant.`;
    }
  }
  return errorMessage(e);
}
