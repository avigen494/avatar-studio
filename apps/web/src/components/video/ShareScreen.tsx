"use client";

import { Eye, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { errorMessage, isApiError } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDuration } from "@/lib/format";
import { REACTIONS, type ReactionEmoji, type ShareMeta, type ShareView } from "@/lib/types";

function readMine(token: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`as_react_${token}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeMine(token: string, mine: Set<string>) {
  try {
    window.localStorage.setItem(`as_react_${token}`, JSON.stringify(Array.from(mine)));
  } catch {
    // Storage blocked: reactions still work, we just cannot remember them.
  }
}

/** Public share page: no sign-in, no app chrome, one fetch for meta and one to unlock. */
export function ShareScreen() {
  const { token } = useParams<{ token: string }>();
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [view, setView] = useState<ShareView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await api.share.meta(token);
        if (cancelled) return;
        setMeta(m);
        setMine(readMine(token));
        if (!m.needs_password) {
          const v = await api.share.view(token);
          if (!cancelled) setView(v);
        }
      } catch (e) {
        if (!cancelled) setError(isApiError(e) && e.status === 404 ? "This video is not available. The link may have been turned off." : errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setUnlocking(true);
    setPasswordError(null);
    try {
      setView(await api.share.view(token, password));
    } catch (err) {
      setPasswordError(isApiError(err) && err.status === 401 ? "That password is not right." : errorMessage(err));
    } finally {
      setUnlocking(false);
    }
  }

  async function react(emoji: ReactionEmoji) {
    if (!view) return;
    const had = mine.has(emoji);
    const nextMine = new Set(mine);
    if (had) nextMine.delete(emoji);
    else nextMine.add(emoji);
    setMine(nextMine);
    writeMine(token, nextMine);
    setView({ ...view, reactions: { ...view.reactions, [emoji]: Math.max(0, (view.reactions[emoji] ?? 0) + (had ? -1 : 1)) } });
    try {
      const counts = await api.share.react(token, emoji);
      setView((v) => (v ? { ...v, reactions: counts } : v));
    } catch {
      setMine(mine);
      writeMine(token, mine);
      setView((v) => (v ? { ...v, reactions: view.reactions } : v));
    }
  }

  const title = view?.title ?? meta?.title;
  const creator = view?.creator ?? meta?.creator;
  const summary = view?.summary ?? meta?.summary;
  const aiLabelled = view?.ai_labelled ?? meta?.ai_labelled ?? false;
  const watermarked = view?.watermarked ?? meta?.watermarked ?? false;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4" style={{ paddingTop: "calc(12px + var(--safe-top))" }}>
      <main className="flex-1 space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}

        {!error && !meta ? (
          <div className="skeleton aspect-[9/16] max-h-[70dvh] w-full rounded-2xl" aria-busy aria-label="Loading video" />
        ) : null}

        {meta && !view ? (
          meta.needs_password ? (
            <form onSubmit={unlock} className="space-y-4 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-base font-semibold">
                <Lock size={18} /> This video needs a password
              </div>
              <Input label="Password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} error={passwordError} autoFocus />
              <Button type="submit" size="lg" full loading={unlocking}>
                Watch
              </Button>
            </form>
          ) : (
            <div className="skeleton aspect-[9/16] max-h-[70dvh] w-full rounded-2xl" aria-busy aria-label="Loading video" />
          )
        ) : null}

        {view ? (
          <div className={`overflow-hidden rounded-2xl bg-black ${view.aspect === "16:9" ? "aspect-video" : view.aspect === "1:1" ? "aspect-square" : "aspect-[9/16] max-h-[70dvh]"}`}>
            <video
              src={view.captioned_url ?? view.video_url}
              poster={view.thumbnail_url ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
            />
          </div>
        ) : null}

        {title ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {aiLabelled ? (
                <Badge tone="accent">
                  <Sparkles size={12} /> AI-assisted
                </Badge>
              ) : null}
              {view ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <Eye size={14} /> {view.views} {view.views === 1 ? "view" : "views"}
                </span>
              ) : null}
              {view?.duration_s ? <span className="text-xs text-muted">· {formatDuration(view.duration_s)}</span> : null}
            </div>
            <h1 className="text-2xl font-bold leading-tight tracking-tight">{title}</h1>
            {creator ? <p className="text-sm text-muted">by {creator}</p> : null}
            {summary ? <p className="pt-1 text-[15px]">{summary}</p> : null}
          </div>
        ) : null}

        {view ? (
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Reactions">
            {REACTIONS.map((emoji) => {
              const on = mine.has(emoji);
              const n = view.reactions[emoji] ?? 0;
              return (
                <button
                  key={emoji}
                  type="button"
                  aria-pressed={on}
                  aria-label={`React ${emoji}${n ? `, ${n}` : ""}`}
                  onClick={() => react(emoji)}
                  className={[
                    "flex min-h-14 flex-col items-center justify-center rounded-xl border text-xl",
                    on ? "border-accent bg-accent-soft" : "border-line bg-surface",
                  ].join(" ")}
                >
                  <span aria-hidden>{emoji}</span>
                  <span className="text-xs font-semibold tabular-nums text-muted">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {view?.transcript ? (
          <div className="rounded-2xl border border-line bg-surface">
            <button
              type="button"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((s) => !s)}
              className="flex min-h-12 w-full items-center justify-between px-4 text-base font-semibold"
            >
              Transcript
              <span className="text-sm text-muted">{showTranscript ? "Hide" : "Show"}</span>
            </button>
            {showTranscript ? <p className="whitespace-pre-wrap px-4 pb-4 text-[15px] leading-relaxed">{view.transcript}</p> : null}
          </div>
        ) : null}
      </main>

      <footer className="py-6 text-center text-xs text-muted safe-pb">
        {watermarked ? (
          <Link href="/" className="font-semibold">
            Made with Avatar Studio
          </Link>
        ) : (
          <span>Avatar Studio</span>
        )}
      </footer>
    </div>
  );
}
