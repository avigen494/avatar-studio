import { authHeaders } from "./auth";
import type { ApiErrorBody, PresignIn, PresignOut } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
export const isLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(API_URL);

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    const extra: Record<string, unknown> = { ...body };
    delete extra.code;
    delete extra.message;
    this.extra = extra;
  }

  /** Blockers returned by 422 "blocked" responses. */
  get blockers(): string[] {
    const b = this.extra["blockers"];
    return Array.isArray(b) ? b.map(String) : [];
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export function errorMessage(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Skip auth headers (public share endpoints). */
  anonymous?: boolean;
}

function buildUrl(path: string, query?: Query) {
  const url = new URL(path.startsWith("http") ? path : API_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = { code: "error", message: `Request failed (${res.status}).` };
  try {
    const data = (await res.json()) as { error?: ApiErrorBody; detail?: unknown };
    if (data && typeof data === "object" && data.error && typeof data.error.message === "string") {
      body = data.error;
    } else if (typeof data?.detail === "string") {
      body = { code: "error", message: data.detail };
    }
  } catch {
    // Non-JSON error body; keep the fallback.
  }
  if (res.status === 401 && body.code === "error") body = { code: "not_signed_in", message: "Sign in to continue." };
  return new ApiError(res.status, body);
}

export async function apiFetch<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  if (!opts.anonymous) Object.assign(headers, await authHeaders());
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body,
      signal: opts.signal,
      credentials: "omit",
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError(0, { code: "network", message: "Could not reach the server. Check your connection and try again." });
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/** Fetch an authenticated file (CSV ledger) and return it as a Blob. */
export async function apiBlob(path: string, query?: Query): Promise<Blob> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { headers, credentials: "omit" });
  } catch {
    throw new ApiError(0, { code: "network", message: "Could not reach the server. Check your connection and try again." });
  }
  if (!res.ok) throw await parseError(res);
  return res.blob();
}

/** POST a multipart form (CSV batch). Values that are null/undefined are left out. */
export async function apiForm<T>(path: string, fields: Record<string, string | boolean | number | Blob | null | undefined>, filename?: string): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (v instanceof Blob) form.append(k, v, filename ?? (v instanceof File ? v.name : k));
    else form.append(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json", ...(await authHeaders()) };
  let res: Response;
  try {
    res = await fetch(buildUrl(path), { method: "POST", headers, body: form, credentials: "omit" });
  } catch {
    throw new ApiError(0, { code: "network", message: "Could not reach the server. Check your connection and try again." });
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export interface UploadOptions {
  purpose: PresignIn["purpose"];
  file: Blob;
  filename: string;
  contentType?: string;
  identityId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Presign, then PUT the bytes straight to storage (local API or R2). Returns the storage key. */
export async function uploadFile(o: UploadOptions): Promise<string> {
  const contentType = (o.contentType || o.file.type || "application/octet-stream").split(";")[0];
  const presign = await apiFetch<PresignOut>("/uploads/presign", {
    body: {
      purpose: o.purpose,
      filename: o.filename,
      content_type: contentType,
      identity_id: o.identityId ?? null,
      size_bytes: o.file.size,
    } satisfies PresignIn,
  });
  await putWithProgress(presign, o.file, o.onProgress, o.signal);
  return presign.key;
}

function putWithProgress(p: PresignOut, file: Blob, onProgress?: (f: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(p.method || "PUT", p.url, true);
    for (const [k, v] of Object.entries(p.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new ApiError(xhr.status, { code: "upload_failed", message: "The upload did not finish. Try again." }));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(0, { code: "network", message: "The upload did not finish. Check your connection and try again." }));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (signal) {
      if (signal.aborted) xhr.abort();
      else signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** Pick a MediaRecorder type the browser supports; Safari gives video/mp4, others video/webm. */
export function pickRecorderMime(kind: "video" | "audio"): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates =
    kind === "video"
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function extensionFor(mime: string): string {
  const base = mime.split(";")[0];
  if (base === "video/mp4" || base === "audio/mp4") return base.startsWith("video") ? "mp4" : "m4a";
  if (base === "video/webm" || base === "audio/webm") return "webm";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/wav") return "wav";
  if (base === "audio/mpeg") return "mp3";
  return base.split("/")[1] || "bin";
}
