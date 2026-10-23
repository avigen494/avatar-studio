"use client";

import fixWebmDuration from "fix-webm-duration";
import { Camera, Check, Mic, RotateCcw, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { extensionFor, pickRecorderMime } from "@/lib/api";

export interface Clip {
  blob: Blob;
  url: string;
  mimeType: string;
  durationS: number;
  filename: string;
}

export interface RecorderProps {
  kind: "video" | "audio";
  maxSeconds: number;
  /** Teleprompter text. Scrolls over the whole recording. */
  script?: string;
  onConfirm: (clip: Clip) => void;
  /** Shows an "Upload instead" button that calls this. */
  onUploadInstead?: () => void;
  confirmLabel?: string;
}

type Phase = "requesting" | "ready" | "countdown" | "recording" | "review" | "denied" | "unsupported";

function permissionMessage(e: unknown, kind: "video" | "audio"): string {
  const name = e instanceof Error ? e.name : "";
  const thing = kind === "video" ? "camera and microphone" : "microphone";
  if (name === "NotAllowedError" || name === "SecurityError")
    return `Access to your ${thing} was blocked. Allow it in your browser settings, or upload a file instead.`;
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${thing} was found on this device. You can upload a file instead.`;
  if (name === "NotReadableError") return `Your ${thing} is being used by another app. Close it and try again.`;
  return `Could not start your ${thing}. You can upload a file instead.`;
}

/**
 * Camera-app style recorder: live preview, 3-2-1 countdown, countdown ring,
 * auto-stop at maxSeconds, teleprompter overlay, review and re-record.
 */
export function Recorder({ kind, maxSeconds, script, onConfirm, onUploadInstead, confirmLabel = "Use this recording" }: RecorderProps) {
  const [phase, setPhase] = useState<Phase>("requesting");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);

  const liveRef = useRef<HTMLVideoElement>(null);
  const promptBoxRef = useRef<HTMLDivElement>(null);
  const promptTextRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const analyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null>(null);

  // Ask for the camera/mic once. All state updates happen after awaits.
  useEffect(() => {
    let cancelled = false;
    let local: MediaStream | null = null;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setPhase("unsupported");
        setError("This browser cannot record. Use Chrome, Safari or Edge, or upload a file instead.");
        return;
      }
      try {
        const preferred: MediaStreamConstraints =
          kind === "video"
            ? { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: true }
            : { audio: true };
        try {
          local = await navigator.mediaDevices.getUserMedia(preferred);
        } catch (first) {
          // Desktops with one external camera often reject facingMode; ask again plainly.
          const name = first instanceof Error ? first.name : "";
          if (kind !== "video" || (name !== "OverconstrainedError" && name !== "NotFoundError")) throw first;
          local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        if (cancelled) {
          local.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(local);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setPhase("denied");
        setError(permissionMessage(e, kind));
      }
    })();
    return () => {
      cancelled = true;
      local?.getTracks().forEach((t) => t.stop());
    };
  }, [kind]);

  // Attach the live stream to the preview element whenever it is on screen.
  useEffect(() => {
    const v = liveRef.current;
    if (!v || !stream) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
  }, [stream, phase]);

  // Release object URLs when the clip changes or the recorder unmounts.
  useEffect(() => {
    const url = clip?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [clip]);

  // Stop timers on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      analyserRef.current?.ctx.close().catch(() => {});
    };
  }, []);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
  }, []);

  const beginRecording = useCallback(() => {
    if (!stream) return;
    const mimeType = pickRecorderMime(kind);
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      setError("Recording is not supported in this browser. Upload a file instead.");
      setPhase("ready");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onstop = async () => {
      const type = (recorder.mimeType || mimeType || (kind === "video" ? "video/webm" : "audio/webm")).split(";")[0];
      let blob = new Blob(chunksRef.current, { type });
      const durationS = Math.min(maxSeconds, (performance.now() - startedAtRef.current) / 1000);
      if (type.endsWith("/webm")) {
        // Browsers write WebM without a duration; players and ffprobe then
        // report 0 s. Patch the header so the clip measures correctly.
        try {
          blob = await fixWebmDuration(blob, Math.round(durationS * 1000), { logger: false });
        } catch {
          // Keep the original blob if patching fails.
        }
      }
      const url = URL.createObjectURL(blob);
      setClip({ blob, url, mimeType: type, durationS, filename: `${kind === "video" ? "recording" : "voice-sample"}.${extensionFor(type)}` });
      setPhase("review");
      setLevel(0);
    };
    recorderRef.current = recorder;

    // Simple input level meter so people can see the mic is working.
    try {
      const Ctx = window.AudioContext;
      if (Ctx && !analyserRef.current) {
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        analyserRef.current = { ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) };
      }
    } catch {
      // Level meter is optional.
    }

    startedAtRef.current = performance.now();
    recorder.start(250);
    setElapsed(0);
    setPhase("recording");

    const tick = () => {
      const t = (performance.now() - startedAtRef.current) / 1000;
      setElapsed(Math.min(maxSeconds, t));
      // Teleprompter: text starts fully visible at the bottom of its box and
      // leaves through the top exactly when the recording ends.
      const box = promptBoxRef.current;
      const text = promptTextRef.current;
      if (box && text) {
        const boxH = box.clientHeight;
        const textH = text.scrollHeight;
        const startY = Math.max(0, boxH - textH);
        const endY = -textH;
        const p = Math.min(1, t / maxSeconds);
        text.style.transform = `translateY(${startY + (endY - startY) * p}px)`;
      }
      const a = analyserRef.current;
      if (a) {
        a.analyser.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) {
          const d = (a.data[i] - 128) / 128;
          sum += d * d;
        }
        setLevel(Math.min(1, Math.sqrt(sum / a.data.length) * 4));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    stopTimerRef.current = setTimeout(stopRecording, maxSeconds * 1000);
  }, [kind, maxSeconds, stream, stopRecording]);

  const start = useCallback(() => {
    setError(null);
    setCount(3);
    setPhase("countdown");
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        beginRecording();
      } else {
        setCount(n);
      }
    }, 1000);
  }, [beginRecording]);

  const reRecord = useCallback(() => {
    setClip(null);
    setElapsed(0);
    setPhase("ready");
  }, []);

  const remaining = Math.max(0, Math.ceil(maxSeconds - elapsed));
  const isVideo = kind === "video";

  return (
    <div className="space-y-4">
      <div
        className={[
          "relative mx-auto w-full overflow-hidden rounded-2xl bg-black text-white",
          isVideo ? "aspect-[9/16] max-w-[min(100%,calc(62dvh*9/16))]" : "aspect-[4/3] max-w-md",
        ].join(" ")}
      >
        {/* Live preview (video) or mic panel (audio) */}
        {phase !== "review" && isVideo ? (
          <video
            ref={liveRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
        ) : null}
        {phase !== "review" && !isVideo ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <span
              className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-white/10 transition-transform"
              style={{ transform: `scale(${1 + level * 0.6})` }}
            >
              <Mic size={40} />
            </span>
            {phase === "recording" ? <span className="text-sm opacity-80">Listening</span> : null}
          </div>
        ) : null}

        {/* Review playback */}
        {phase === "review" && clip ? (
          isVideo ? (
            <video src={clip.url} controls playsInline className="absolute inset-0 h-full w-full object-contain bg-black" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
              <Check size={40} className="text-accent" />
              <p className="text-sm opacity-80">{Math.round(clip.durationS)} seconds recorded</p>
              <audio src={clip.url} controls className="w-full" />
            </div>
          )
        ) : null}

        {/* Skeleton while asking for permission */}
        {phase === "requesting" ? <div className="skeleton absolute inset-0 rounded-none opacity-40" aria-hidden /> : null}

        {/* Countdown 3-2-1 */}
        {phase === "countdown" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40" aria-live="assertive">
            <span className="text-[96px] font-bold leading-none">{count}</span>
          </div>
        ) : null}

        {/* Teleprompter overlay while recording */}
        {phase === "recording" && script ? (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-black/50" aria-hidden>
            <div ref={promptBoxRef} className="absolute inset-x-0 top-16 bottom-[24%] overflow-hidden px-5">
              <div ref={promptTextRef} className="teleprompter will-change-transform">
                {script}
              </div>
            </div>
          </div>
        ) : null}

        {/* Countdown ring + remaining seconds */}
        {phase === "recording" ? (
          <div className="absolute left-3 top-3 flex items-center gap-2" role="timer" aria-live="off" aria-label={`${remaining} seconds left`}>
            <Ring fraction={elapsed / maxSeconds} />
            <span className="rounded-full bg-black/50 px-2 py-0.5 text-sm font-semibold tabular-nums">{remaining}s</span>
          </div>
        ) : null}

        {/* Static script preview before recording */}
        {phase === "ready" && script ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
            <p className="text-xs uppercase tracking-wide opacity-70">Read this while recording</p>
            <p className="mt-1 text-[15px] font-medium leading-snug">{script}</p>
          </div>
        ) : null}

        {/* Stop control inside the frame, bottom centre */}
        {phase === "recording" ? (
          <div className="absolute inset-x-0 bottom-4 flex justify-center">
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop recording"
              className="inline-flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-red-600"
            >
              <Square size={22} fill="currentColor" />
            </button>
          </div>
        ) : null}
      </div>

      {error ? <Notice tone={phase === "denied" || phase === "unsupported" ? "amber" : "red"}>{error}</Notice> : null}

      {/* Actions */}
      {phase === "ready" ? (
        <div className="space-y-2">
          <Button size="lg" full onClick={start} icon={isVideo ? <Camera size={20} /> : <Mic size={20} />}>
            {isVideo ? `Record ${maxSeconds} seconds` : `Record ${maxSeconds} seconds`}
          </Button>
          {onUploadInstead ? (
            <Button size="md" full variant="ghost" onClick={onUploadInstead} icon={<Upload size={18} />}>
              Upload instead
            </Button>
          ) : null}
        </div>
      ) : null}
      {(phase === "denied" || phase === "unsupported") && onUploadInstead ? (
        <Button size="lg" full onClick={onUploadInstead} icon={<Upload size={18} />}>
          Upload a file instead
        </Button>
      ) : null}
      {phase === "requesting" ? (
        <p className="text-center text-sm text-muted">Allow the {isVideo ? "camera and microphone" : "microphone"} when your browser asks.</p>
      ) : null}
      {phase === "review" && clip ? (
        <div className="space-y-2">
          <Button size="lg" full onClick={() => onConfirm(clip)} icon={<Check size={20} />}>
            {confirmLabel}
          </Button>
          <Button size="md" full variant="secondary" onClick={reRecord} icon={<RotateCcw size={18} />}>
            Record again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Ring({ fraction }: { fraction: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r={r} stroke="rgba(255,255,255,0.3)" strokeWidth="4" fill="rgba(0,0,0,0.4)" />
      <circle
        cx="20"
        cy="20"
        r={r}
        stroke="#ef4444"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - f)}
        transform="rotate(-90 20 20)"
      />
      <circle cx="20" cy="20" r="5" fill="#ef4444" />
    </svg>
  );
}
