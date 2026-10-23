"use client";

import { Copy, Link2, MessageCircle, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { Toggle } from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { copyText, useHref } from "@/lib/hooks";
import type { VideoOut } from "@/lib/types";

export function shareUrlFor(video: VideoOut, href: string): string | null {
  if (!video.share_token) return null;
  try {
    return `${new URL(href).origin}/s/${video.share_token}`;
  } catch {
    return video.share_url ?? null;
  }
}

export function ShareSheet({ open, onClose, video, onVideo }: { open: boolean; onClose: () => void; video: VideoOut; onVideo: (v: VideoOut) => void }) {
  const { toast } = useToast();
  const href = useHref();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"toggle" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = video.share_enabled ? shareUrlFor(video, href) : null;

  async function setEnabled(enabled: boolean) {
    setBusy("toggle");
    setError(null);
    try {
      onVideo(await api.videos.share(video.id, { enabled }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword(value: string) {
    setBusy("password");
    setError(null);
    try {
      onVideo(await api.videos.share(video.id, { enabled: true, password: value }));
      setPassword("");
      toast(value ? "Password set." : "Password removed.", "success");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    toast((await copyText(url)) ? "Link copied." : "Could not copy. Long-press the link to copy it.", "info");
  }

  async function nativeShare() {
    if (!url) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: video.title, text: video.summary ?? video.title, url });
        return;
      } catch {
        // Cancelled or unsupported: fall back to copying.
      }
    }
    await copy();
  }

  const whatsapp = url ? `https://wa.me/?text=${encodeURIComponent(`${video.title} ${url}`)}` : null;

  return (
    <Sheet open={open} onClose={onClose} title="Share" description="Anyone with the link can watch. Add a password to limit it.">
      <div className="space-y-4 pt-1">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Toggle
          checked={video.share_enabled}
          onChange={setEnabled}
          label="Share link"
          description={video.share_enabled ? `${video.views} ${video.views === 1 ? "view" : "views"} so far` : "Off. Nobody can open the link."}
          disabled={busy === "toggle" || video.status !== "succeeded"}
          note={video.status !== "succeeded" ? "Available once the render has finished." : undefined}
        />

        {url ? (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <Link2 size={16} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 select-all truncate text-sm">{url}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" onClick={copy} icon={<Copy size={16} />}>
                Copy
              </Button>
              <Button variant="secondary" onClick={nativeShare} icon={<Share2 size={16} />}>
                Share
              </Button>
              <a
                href={whatsapp ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 text-base font-semibold hover:bg-line"
              >
                <MessageCircle size={16} /> WhatsApp
              </a>
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <Input
                label={video.share_has_password ? "Change password" : "Password (optional)"}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={100}
                placeholder={video.share_has_password ? "A password is set" : "Leave empty for no password"}
              />
              <div className="flex gap-2">
                <Button variant="secondary" full disabled={!password.trim()} loading={busy === "password"} onClick={() => savePassword(password.trim())}>
                  Save password
                </Button>
                {video.share_has_password ? (
                  <Button variant="ghost" onClick={() => savePassword("")} disabled={busy === "password"}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
