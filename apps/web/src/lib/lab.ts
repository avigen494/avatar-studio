import type { TrialOut } from "./types";

/** Small string hash (FNV-1a) so blind mode shuffles the same way for everyone. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic order for blind scoring, seeded by each trial id. */
export function blindOrder<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => hashString(a.id) - hashString(b.id) || a.id.localeCompare(b.id));
}

/** "Clip A", "Clip B", … "Clip Z", "Clip AA", … */
export function clipLabel(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Clip ${s}`;
}

export function isActiveTrial(t: TrialOut): boolean {
  return t.status === "queued" || t.status === "running";
}

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return v.toFixed(digits);
}

export function rupees(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: digits })}`;
}

export function trialName(engine: string, when = new Date()): string {
  const stamp = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(when);
  return `${engine} · ${stamp}`;
}

export const RATER_KEY = "as_lab_rater";
/** Set once the golden-set explainer has been confirmed, so the star toggles directly after that. */
export const GOLDEN_INTRO_KEY = "as_lab_golden_intro";

export function goldenIntroSeen(): boolean {
  try {
    return window.localStorage.getItem(GOLDEN_INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

export function markGoldenIntroSeen() {
  try {
    window.localStorage.setItem(GOLDEN_INTRO_KEY, "1");
  } catch {
    // Blocked storage: the explainer just shows again next time.
  }
}

export function readRater(): string {
  try {
    return window.localStorage.getItem(RATER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeRater(name: string) {
  try {
    window.localStorage.setItem(RATER_KEY, name);
  } catch {
    // Blocked storage: the name just is not remembered.
  }
}
