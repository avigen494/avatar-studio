"use client";

/**
 * Length of a video or audio file in seconds, read in the browser. WebM files
 * recorded by browsers often report Infinity until the player seeks to the
 * end, so that is tried once. Resolves null when it cannot be measured.
 */
export function measureDuration(file: Blob, timeoutMs = 8000): Promise<number | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let done = false;
    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      v.load();
      resolve(d !== null && Number.isFinite(d) && d > 0 ? d : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        finish(v.duration);
        return;
      }
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        finish(v.duration);
      };
      v.currentTime = 1e101;
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

export function minutesLabel(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
