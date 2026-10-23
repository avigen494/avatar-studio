"use client";

import { Check, ChevronRight, Mic, Plus, UserRound, Video } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/components/auth/MeProvider";
import { Avatar, identityThumb } from "@/components/avatar/IdentityCard";
import { PinnedBar, PinnedSpacer } from "@/components/layout/PinnedBar";
import { Badge, IdentityPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui/Card";
import { SkeletonCard, SkeletonList } from "@/components/ui/Skeleton";
import { VideoCard } from "@/components/video/VideoCard";
import { engineName } from "@/components/voice/VoiceRow";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { languageLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function HomePage() {
  const { me, loading: meLoading } = useMe();
  const identities = useApi(() => api.identities.list(), ["identities"]);
  const voices = useApi(() => api.voices.list(), ["voices"]);
  const videos = useApi(() => api.videos.list({ limit: 8 }), ["videos", "recent"], {
    pollWhile: (v) => v.items.some((x) => x.status === "queued" || x.status === "rendering"),
    pollMs: 4000,
  });

  const firstName = me?.user.name?.split(" ")[0] || "";
  const identity = identities.data?.find((i) => i.status === "ready") ?? identities.data?.[0];
  const voice = voices.data?.find((v) => v.is_default) ?? voices.data?.[0];
  const onboarding = me?.onboarding;
  const showChecklist = Boolean(onboarding && !onboarding.complete);

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Hi, ${firstName}` : "Home"}
        subtitle={me ? `${me.workspace.name} · ${me.workspace.plan} plan` : undefined}
        right={
          <div className="hidden lg:block">
            <Button href="/create" icon={<Plus size={20} />}>
              Create video
            </Button>
          </div>
        }
      />

      {videos.error ? <Notice tone="red">{errorMessage(videos.error)}</Notice> : null}

      {showChecklist && onboarding ? (
        <Card className="space-y-3">
          <div>
            <h2 className="text-lg font-bold">Three steps to your first video</h2>
            <p className="text-sm text-muted">Takes about five minutes. You can make a video while your recording is checked.</p>
          </div>
          <ol className="space-y-2">
            <ChecklistItem done={onboarding.avatar_ready} href="/onboarding?step=1" label="Record your 15-second clip" />
            <ChecklistItem done={onboarding.has_voice} href="/onboarding?step=2" label="Choose or clone your voice" />
            <ChecklistItem done={onboarding.has_finished_video} href="/onboarding?step=3" label="Make your first video" />
          </ol>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {identities.loading || meLoading ? (
          <SkeletonCard />
        ) : identity ? (
          <Link href={`/avatars/${identity.id}`} className="block min-w-0">
            <Card className="flex items-center gap-3">
              <Avatar src={identityThumb(identity)} alt="" size={56} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-muted">Your avatar</p>
                <p className="truncate text-base font-semibold">{identity.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <IdentityPill status={identity.status} consent={identity.consent_status} />
                  {identity.looks.length ? <Badge>{identity.looks.length} {identity.looks.length === 1 ? "look" : "looks"}</Badge> : null}
                </div>
              </div>
              <ChevronRight className="text-muted" />
            </Card>
          </Link>
        ) : (
          <Link href="/onboarding?step=1" className="block min-w-0">
            <Card className="flex items-center gap-3">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <UserRound />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Set up your avatar</p>
                <p className="text-sm text-muted">Record 15 seconds or add a photo.</p>
              </div>
              <ChevronRight className="text-muted" />
            </Card>
          </Link>
        )}

        {voices.loading ? (
          <SkeletonCard />
        ) : voice ? (
          <Link href="/voices" className="block min-w-0">
            <Card className="flex items-center gap-3">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-fg">
                <Mic />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-muted">Your voice</p>
                <p className="truncate text-base font-semibold">{voice.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{engineName(voice.engine)}</Badge>
                  <Badge>{languageLabel(voice.language)}</Badge>
                </div>
              </div>
              <ChevronRight className="text-muted" />
            </Card>
          </Link>
        ) : (
          <Link href="/onboarding?step=2" className="block min-w-0">
            <Card className="flex items-center gap-3">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Mic />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Add a voice</p>
                <p className="text-sm text-muted">Clone yours or pick one from the library.</p>
              </div>
              <ChevronRight className="text-muted" />
            </Card>
          </Link>
        )}
      </div>

      <section>
        <SectionTitle
          right={
            <Link href="/projects" className="text-sm font-semibold text-accent">
              All videos
            </Link>
          }
        >
          Recent videos
        </SectionTitle>
        {videos.loading ? (
          <SkeletonList count={3} />
        ) : videos.data && videos.data.items.length > 0 ? (
          <ul className="space-y-2">
            {videos.data.items.map((v) => (
              <li key={v.id}>
                <VideoCard video={v} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<Video size={32} />}
            title="No videos yet"
            body="Paste a script, pick a look and a voice, and preview it free before you spend a credit."
            action={
              <Button href="/create" variant="secondary">
                Create your first video
              </Button>
            }
          />
        )}
      </section>

      <PinnedSpacer size={72} />
      <PinnedBar className="lg:hidden">
        <Button href="/create" size="lg" full icon={<Plus size={22} />}>
          Create video
        </Button>
      </PinnedBar>
    </div>
  );
}

function ChecklistItem({ done, href, label }: { done: boolean; href: string; label: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-12 items-center gap-3 rounded-xl px-2 hover:bg-surface-2">
        <span
          className={[
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
            done ? "border-green bg-green-soft text-green" : "border-line text-muted",
          ].join(" ")}
          aria-hidden
        >
          {done ? <Check size={16} strokeWidth={3} /> : null}
        </span>
        <span className={`flex-1 text-base ${done ? "text-muted line-through" : "font-medium"}`}>{label}</span>
        {!done ? <ChevronRight className="text-muted" size={20} /> : null}
        <span className="sr-only">{done ? "Done" : "Not done yet"}</span>
      </Link>
    </li>
  );
}
