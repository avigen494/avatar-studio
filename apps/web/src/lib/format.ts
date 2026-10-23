export function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "–";
  const total = Math.round(s);
  if (total < 90) return `~${total} s`;
  const m = Math.floor(total / 60);
  const r = total % 60;
  return r ? `~${m} min ${r} s` : `~${m} min`;
}

export function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "";
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const r = total % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Working out how long this will take";
  if (seconds <= 45) return "Less than a minute left";
  const m = Math.max(1, Math.round(seconds / 60));
  return m === 1 ? "About 1 minute left" : `About ${m} minutes left`;
}

export function credits(n: number): string {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

export function longDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(d);
}

export function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

export const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish",
  // Translation targets (GET /translate/languages)
  ta: "Tamil",
  te: "Telugu",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ar: "Arabic",
  id: "Indonesian",
};

export function languageLabel(code: string | null | undefined): string {
  return LANGUAGE_LABEL[code ?? ""] ?? (code || "");
}

export function engineLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "photo":
      return "Photo";
    case "real_footage":
      return "Real footage";
    case "mouth_only":
      return "Mouth-only";
    case "auto":
      return "Auto";
    default:
      return mode || "";
  }
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Money from the API's smallest unit (paise / cents). Whole amounts drop the decimals: ₹999, $12, ₹1,249.50. */
export function money(minor: number, currency: string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  const opts: Intl.NumberFormatOptions = { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 };
  if (currency === "USD") return `$${major.toLocaleString("en-US", opts)}`;
  return `₹${major.toLocaleString("en-IN", opts)}`;
}

export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "editor":
      return "Editor";
    case "viewer":
      return "Viewer";
    default:
      return titleCase(role || "");
  }
}

/** Compact counts for KPI tiles: 1,284 · 12.9K · 1.2M. */
export function compact(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(digits)}K`;
  return Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function percent(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "–";
  return `${(fraction * 100).toFixed(digits)}%`;
}
