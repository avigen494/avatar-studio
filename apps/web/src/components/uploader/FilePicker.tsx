"use client";

import { Upload } from "lucide-react";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { uploadFile, type UploadOptions } from "@/lib/api";

export interface FilePickerProps extends Omit<ButtonProps, "onChange" | "children"> {
  accept: string;
  /** "user" opens the front camera on phones. */
  capture?: "user" | "environment";
  onFile: (file: File) => void;
  children: ReactNode;
}

/** A button that opens the file chooser. No drag-and-drop needed on a phone. */
export function FilePicker({ accept, capture, onFile, children, icon, ...btn }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        capture={capture}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button icon={icon ?? <Upload size={18} />} onClick={() => inputRef.current?.click()} {...btn}>
        {children}
      </Button>
    </>
  );
}

export interface UploaderState {
  busy: boolean;
  /** 0..1 while uploading, null otherwise. */
  progress: number | null;
  error: string | null;
  upload: (o: Omit<UploadOptions, "onProgress" | "signal">) => Promise<string | null>;
  cancel: () => void;
  reset: () => void;
}

/** Presign + PUT with progress state for the UI. */
export function useUploader(): UploaderState {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const upload = useCallback<UploaderState["upload"]>(async (o) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const key = await uploadFile({ ...o, signal: ctrl.signal, onProgress: (f) => setProgress(f) });
      return key;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
      setError(e instanceof Error ? e.message : "The upload did not finish. Try again.");
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setError(null), []);

  return { busy, progress, error, upload, cancel, reset };
}

export function UploadProgress({ progress, label = "Uploading" }: { progress: number | null; label?: string }) {
  const pct = progress === null ? 0 : Math.round(progress * 100);
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <ProgressBar value={pct} label={label} />
    </div>
  );
}
