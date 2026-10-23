"use client";

import { Camera, Check, Image as ImageIcon, Lock, Pencil, Plus, Sparkles, Star, Trash2, Video, Wand2 } from "lucide-react";
import Image from "next/image";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { ReferenceCapture } from "@/components/recorder/ReferenceCapture";
import { Badge, IdentityPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, Notice, SectionTitle } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { FilePicker, UploadProgress, useUploader } from "@/components/uploader/FilePicker";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { isActiveJob, isTraining, latestJob, useIdentityJobs } from "@/lib/identity-jobs";
import { minutesLabel } from "@/lib/media";
import type { IdentityOut, LookOut } from "@/lib/types";
import { AccessSheet, LockedBadge } from "./AccessSheet";
import { AiBadge, CandidateGrid, DesignWithAI, GeneratingTiles } from "./DesignWithAI";
import { Avatar, identityThumb, StyleTrainedBadge } from "./IdentityCard";
import { CameraAnglesForm, LookPromptForm } from "./LookGenerator";
import { TrainStyleSheet } from "./TrainStyleSheet";

function consentCopy(i: IdentityOut): { tone: "green" | "amber" | "red" | "neutral"; title: string; body: string } {
  if (i.kind === "designed") return { tone: "neutral", title: "Designed avatar", body: "No real person is involved, so no consent recording is needed." };
  switch (i.consent_status) {
    case "verified":
      return { tone: "green", title: "Consent verified", body: `Your recording${i.reference_duration_s ? ` (${Math.round(i.reference_duration_s)} s)` : ""} shows you giving permission. This avatar can make videos.` };
    case "pending":
      return { tone: "amber", title: "Checking your recording", body: "We check that the clip shows you reading the consent line. This usually takes under two minutes." };
    case "rejected":
      return { tone: "red", title: "We could not verify the recording", body: i.consent_notes || "Record it again with your face clearly in view while reading the consent line." };
    default:
      return { tone: "neutral", title: "No recording yet", body: "Record 15 seconds with the consent line to unlock real-footage videos. Until then this avatar can only use photo mode." };
  }
}

function lookKindLabel(kind: string): string {
  if (kind === "video") return "Video";
  if (kind === "generated") return "Made with AI";
  return "Photo";
}

function styleButtonLabel(i: IdentityOut): string {
  switch (i.style_status) {
    case "queued":
    case "training":
      return "Training your style…";
    case "ready":
      return "Style trained · manage";
    case "failed":
      return "Style training failed · retry";
    default:
      return "Train my style (one-time)";
  }
}

type SheetName = "add" | "rerecord" | "rename" | "train" | "generate" | "design" | "access";

export function AvatarScreen() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();
  const { me } = useMe();
  const isWorkspaceAdmin = me?.workspace.role === "owner" || me?.workspace.role === "admin";
  const q = useApi(() => api.identities.get(id), ["identity", id], {
    pollWhile: (i) => i.status === "verifying" || isTraining(i),
    pollMs: 3000,
  });
  const jobs = useIdentityJobs(id, () => q.refetch());
  const identity = q.data;
  const [sheet, setSheet] = useState<SheetName | null>(() => (params.get("add") === "1" ? "add" : null));
  const [look, setLook] = useState<LookOut | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Job id we just queued, so the skeleton tiles show before the first jobs poll answers. */
  const [pendingLookJob, setPendingLookJob] = useState<string | null>(null);
  const [dismissedJob, setDismissedJob] = useState<string | null>(null);

  const activeLookJob = jobs.active.find((j) => j.type === "generate_look");
  const pendingSettled = pendingLookJob !== null && jobs.jobs.some((j) => j.id === pendingLookJob && !isActiveJob(j));
  const generating = Boolean(activeLookJob) || (pendingLookJob !== null && !pendingSettled);
  const lastLookJob = latestJob(jobs.jobs, "generate_look");
  const failedLookJob = lastLookJob && lastLookJob.status === "failed" && lastLookJob.id !== dismissedJob ? lastLookJob : undefined;
  const trainJob = latestJob(jobs.jobs, "train_style");

  function onJobStarted(jobId: string) {
    setPendingLookJob(jobId);
    setDismissedJob(null);
    setLook(null);
    setSheet(null);
    jobs.refetch();
  }

  async function act(name: string, fn: () => Promise<unknown>, after?: () => void) {
    setBusy(name);
    try {
      await fn();
      after?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (q.loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-16 rounded-xl" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  if (q.error || !identity) return <Notice tone="red">{errorMessage(q.error, "That avatar could not be loaded.")}</Notice>;

  const consent = consentCopy(identity);
  const isReal = identity.kind === "real_person";
  const isDesigned = identity.kind === "designed";
  const needsDesign = isDesigned && identity.looks.length === 0;
  const hasSource = identity.looks.some((l) => l.kind !== "video") || Boolean(identity.thumbnail_url || identity.reference_url);
  const styleReady = identity.style_status === "ready";
  const restricted = (identity.allowed_user_ids ?? []).length;

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <Avatar src={identityThumb(identity)} alt="" size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h1 className="truncate text-2xl font-bold leading-tight tracking-tight">{identity.name}</h1>
            <button type="button" aria-label="Rename" onClick={() => setSheet("rename")} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
              <Pencil size={16} />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <IdentityPill status={identity.status} consent={identity.consent_status} />
            {styleReady ? <StyleTrainedBadge /> : null}
            {restricted ? <LockedBadge count={restricted} /> : null}
            <span className="text-xs text-muted">Added {formatDate(identity.created_at)}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Button icon={<Plus size={18} />} onClick={() => setSheet("add")}>
          Add look
        </Button>
        {isReal ? (
          <Button variant="secondary" icon={<Camera size={18} />} onClick={() => setSheet("rerecord")}>
            {identity.reference_url ? "Re-record" : "Record 15 s"}
          </Button>
        ) : (
          <Button variant="secondary" icon={<Wand2 size={18} />} onClick={() => setSheet("design")} disabled={generating}>
            Design with AI
          </Button>
        )}
      </div>

      <Card className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-base font-semibold">{consent.title}</p>
          <Badge tone={consent.tone}>{isDesigned ? "Not needed" : identity.consent_status}</Badge>
        </div>
        <p className="text-sm text-muted">{consent.body}</p>
        {identity.status === "verifying" ? <ProgressBar value={0} indeterminate label="Verifying" /> : null}
        {identity.reference_url ? (
          <details className="pt-1">
            <summary className="cursor-pointer text-sm font-semibold text-accent">Watch the recording</summary>
            <video src={identity.reference_url} controls playsInline preload="none" className="mt-2 max-h-72 w-full rounded-xl bg-black" />
          </details>
        ) : null}
      </Card>

      {isReal ? (
        <div className="space-y-2">
          <Button
            variant={identity.style_status === "none" ? "primary" : "secondary"}
            full
            icon={<Sparkles size={18} />}
            onClick={() => setSheet("train")}
            className={identity.style_status === "none" ? "bg-accent-soft text-accent hover:bg-accent-soft" : ""}
          >
            {styleButtonLabel(identity)}
          </Button>
          {isTraining(identity) ? (
            <div className="space-y-1 px-1">
              <ProgressBar value={trainJob?.progress ?? 0} indeterminate={identity.style_status === "queued" || !trainJob} label="Style training" />
              <p className="text-xs text-muted">
                {identity.style_status === "queued" ? "Waiting for a machine." : `${trainJob?.stage || "Training"} · ${trainJob?.progress ?? 0}%`} 40 credits are charged only when it finishes.
              </p>
            </div>
          ) : styleReady ? (
            <p className="px-1 text-xs text-muted">
              Trained{identity.style_trained_at ? ` ${formatDate(identity.style_trained_at)}` : ""}
              {identity.style_footage_seconds ? ` from ${minutesLabel(identity.style_footage_seconds)} of footage` : ""}. Videos use your style automatically.
            </p>
          ) : identity.style_status === "failed" ? (
            <p className="px-1 text-xs text-red">{identity.style_error || "Training did not finish. Nothing was charged."}</p>
          ) : null}
        </div>
      ) : null}

      <section>
        <SectionTitle
          right={
            !needsDesign && hasSource && identity.looks.length > 0 ? (
              <button type="button" onClick={() => setSheet("generate")} className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent" disabled={generating}>
                <Sparkles size={16} /> Make with AI
              </button>
            ) : null
          }
        >
          Looks
        </SectionTitle>

        {failedLookJob ? (
          <Notice tone="red" className="mb-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">Those looks did not finish.</p>
                <p>{failedLookJob.error || "Something went wrong on our side. Nothing was charged."}</p>
              </div>
              <button type="button" onClick={() => setDismissedJob(failedLookJob.id)} className="shrink-0 text-sm font-semibold underline">
                Dismiss
              </button>
            </div>
          </Notice>
        ) : null}

        {generating ? (
          <div className="mb-3">
            <GeneratingTiles label={isDesigned && identity.looks.length === 0 ? "Designing your presenter…" : "Making your looks…"} progress={activeLookJob?.progress} />
          </div>
        ) : null}

        {needsDesign ? (
          generating ? null : (
            <DesignWithAI identity={identity} onStarted={(j) => onJobStarted(j.job_id)} />
          )
        ) : identity.looks.length === 0 ? (
          generating ? null : (
            <EmptyState
              icon={<ImageIcon size={28} />}
              title="No looks yet"
              body="A look is a photo or short video of this avatar: an outfit, a background, a mood."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="secondary" onClick={() => setSheet("add")} icon={<Plus size={18} />}>
                    Add a look
                  </Button>
                  {hasSource ? (
                    <Button variant="secondary" onClick={() => setSheet("generate")} icon={<Sparkles size={18} />}>
                      Make with AI
                    </Button>
                  ) : null}
                </div>
              }
            />
          )
        ) : isDesigned ? (
          <CandidateGrid identity={identity} onIdentity={(i) => q.setData(i)} onOpen={(l) => setLook(l)} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {identity.looks.map((l) => {
              const src = l.thumbnail_url || (l.kind !== "video" ? l.media_url : null);
              return (
                <li key={l.id}>
                  <button type="button" onClick={() => setLook(l)} className="block w-full overflow-hidden rounded-2xl border border-line bg-surface text-left">
                    <span className="relative block aspect-[4/5] w-full bg-surface-2">
                      {src ? (
                        <Image src={src} alt="" fill sizes="(min-width: 640px) 240px, 45vw" unoptimized className="object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted">
                          <Video size={32} />
                        </span>
                      )}
                      {l.is_default ? (
                        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">
                          <Star size={12} fill="currentColor" /> Default
                        </span>
                      ) : null}
                      {l.kind === "generated" ? <AiBadge className="absolute right-2 top-2" /> : null}
                    </span>
                    <span className="block truncate p-2.5 text-sm font-semibold">{l.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isWorkspaceAdmin ? (
        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">Access</p>
            <p className="text-sm text-muted">{restricted ? `Only ${restricted} ${restricted === 1 ? "person" : "people"} (plus owners and admins) can make videos with this avatar.` : "Every editor in the workspace can make videos with this avatar."}</p>
          </div>
          <Button variant="secondary" size="sm" icon={<Lock size={14} />} onClick={() => setSheet("access")}>
            {restricted ? "Change" : "Restrict"}
          </Button>
        </Card>
      ) : null}

      {identity.render_seed !== null && identity.render_seed !== undefined ? (
        <p className="px-1 text-xs text-muted">
          <span className="font-semibold">Render seed {identity.render_seed}</span> · Every render of this avatar starts from the same seed so videos look consistent.
        </p>
      ) : null}

      <div className="pt-4">
        <Button
          variant="danger"
          full
          icon={<Trash2 size={18} />}
          loading={busy === "delete"}
          onClick={() => {
            if (!window.confirm(`Delete ${identity.name}? Its recording, looks and style file are removed. This cannot be undone.`)) return;
            act("delete", () => api.identities.remove(identity.id), () => router.replace("/avatars"));
          }}
        >
          Delete avatar
        </Button>
      </div>

      {/* Look editor */}
      {look ? (
        <LookEditor
          identity={identity}
          look={identity.looks.find((l) => l.id === look.id) ?? look}
          onClose={() => setLook(null)}
          onIdentity={(i) => q.setData(i)}
          onLook={(updated) => q.setData((prev) => (prev ? { ...prev, looks: prev.looks.map((l) => (l.id === updated.id ? updated : l)) } : prev))}
          onDeleted={() => {
            setLook(null);
            q.refetch();
          }}
          onJobStarted={onJobStarted}
        />
      ) : null}

      <AddLookSheet open={sheet === "add"} identity={identity} onClose={() => setSheet(null)} onAdded={() => q.refetch()} />

      <Sheet open={sheet === "generate"} onClose={() => setSheet(null)} title="Make looks with AI" description="Starts from the default look, or from your recording." full>
        {sheet === "generate" ? <GenerateTabs identity={identity} onJobStarted={onJobStarted} /> : null}
      </Sheet>

      <Sheet open={sheet === "design"} onClose={() => setSheet(null)} title="Design with AI" description="Three new candidates. Pick one as the face of this avatar." full>
        {sheet === "design" ? <DesignWithAI identity={identity} compact onStarted={(j) => onJobStarted(j.job_id)} /> : null}
      </Sheet>

      {isReal ? (
        <TrainStyleSheet
          open={sheet === "train"}
          identity={identity}
          job={trainJob}
          onClose={() => setSheet(null)}
          onIdentity={(i) => q.setData(i)}
          onStarted={() => {
            jobs.refetch();
            q.refetch();
          }}
        />
      ) : null}

      <Sheet open={sheet === "rerecord"} onClose={() => setSheet(null)} title="Record 15 seconds" description="Read the consent line on screen. This replaces the previous recording." full>
        {sheet === "rerecord" ? (
          <ReferenceCapture
            identity={identity}
            personName={identity.name}
            onDone={(i) => {
              q.setData(i);
              q.refetch();
              setSheet(null);
              toast("Recording saved. We are checking it now.", "success");
            }}
          />
        ) : null}
      </Sheet>

      {isWorkspaceAdmin ? <AccessSheet open={sheet === "access"} identity={identity} onClose={() => setSheet(null)} onSaved={(i) => q.setData(i)} /> : null}

      <RenameSheet
        open={sheet === "rename"}
        name={identity.name}
        onClose={() => setSheet(null)}
        onSave={async (name) => {
          q.setData(await api.identities.patch(identity.id, name));
          setSheet(null);
        }}
      />
    </div>
  );
}

function GenerateTabs({ identity, onJobStarted }: { identity: IdentityOut; onJobStarted: (jobId: string) => void }) {
  const [tab, setTab] = useState<"prompt" | "angles">("prompt");
  return (
    <div className="space-y-4 pt-1">
      <div className="rail" role="tablist" aria-label="What to make">
        <Chip role="radio" active={tab === "prompt"} onClick={() => setTab("prompt")}>
          New look from prompt
        </Chip>
        <Chip role="radio" active={tab === "angles"} onClick={() => setTab("angles")}>
          Camera angles
        </Chip>
      </div>
      {tab === "prompt" ? (
        <LookPromptForm identity={identity} onStarted={(j) => onJobStarted(j.job_id)} />
      ) : (
        <CameraAnglesForm identity={identity} onStarted={(j) => onJobStarted(j.job_id)} />
      )}
    </div>
  );
}

function RenameSheet({ open, name, onClose, onSave }: { open: boolean; name: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSave(value.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Rename avatar">
      <form onSubmit={submit} className="space-y-4 pt-1">
        <Input label="Name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={120} autoFocus error={error} />
        <Button type="submit" full loading={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}

function AddLookSheet({ open, identity, onClose, onAdded }: { open: boolean; identity: IdentityOut; onClose: () => void; onAdded: () => void }) {
  const uploader = useUploader();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const { toast } = useToast();

  async function add(file: File, kind: "photo" | "video") {
    const key = await uploader.upload({ purpose: "look", file, filename: file.name, contentType: file.type || (kind === "photo" ? "image/jpeg" : "video/mp4"), identityId: identity.id });
    if (!key) return;
    setSaving(true);
    try {
      await api.identities.addLook(identity.id, { key, name: name.trim() || `Look ${identity.looks.length + 1}`, kind });
      toast("Look added.", "success");
      setName("");
      onAdded();
      onClose();
    } catch (e) {
      toast(errorMessage(e, "Could not add that look."), "error");
    } finally {
      setSaving(false);
    }
  }

  const working = uploader.busy || saving;
  return (
    <Sheet open={open} onClose={onClose} title="Add look" description="A photo or a short video of this avatar." locked={working}>
      <div className="space-y-4 pt-1">
        {working ? (
          <UploadProgress progress={uploader.progress} label={uploader.busy ? "Uploading" : "Saving"} />
        ) : (
          <>
            {uploader.error ? <Notice tone="red">{uploader.error}</Notice> : null}
            <Input label="Name (optional)" placeholder="Blue shirt, office, evening…" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <FilePicker accept="image/*" size="lg" full icon={<ImageIcon size={20} />} onFile={(f) => add(f, "photo")}>
              Upload a photo
            </FilePicker>
            <FilePicker accept="video/*" variant="secondary" full icon={<Video size={18} />} onFile={(f) => add(f, "video")}>
              Upload a video
            </FilePicker>
            <FilePicker accept="image/*" capture="user" variant="secondary" full icon={<Camera size={18} />} onFile={(f) => add(f, "photo")}>
              Take one with this phone
            </FilePicker>
            <p className="text-xs text-muted">Face the light, shoulders in frame, plain background. Portrait photos work best for 9:16.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function LookEditor({
  identity,
  look,
  onClose,
  onIdentity,
  onLook,
  onDeleted,
  onJobStarted,
}: {
  identity: IdentityOut;
  look: LookOut;
  onClose: () => void;
  onIdentity: (i: IdentityOut) => void;
  onLook: (l: LookOut) => void;
  onDeleted: () => void;
  onJobStarted: (jobId: string) => void;
}) {
  const [tab, setTab] = useState<"appearance" | "prompt" | "angles">("appearance");
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(look.name);
  const { toast } = useToast();
  const src = look.thumbnail_url || (look.kind !== "video" ? look.media_url : null);
  const isVideo = look.kind === "video";

  async function rename(e: FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === look.name) {
      setRenaming(false);
      return;
    }
    setBusy("rename");
    try {
      onLook(await api.identities.renameLook(identity.id, look.id, next));
      setRenaming(false);
      toast("Look renamed.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open onClose={onClose} title={look.name} description={`${lookKindLabel(look.kind)} · added ${formatDate(look.created_at)}`} full>
      <div className="space-y-4 pt-1">
        <div className="relative mx-auto aspect-[4/5] w-full max-w-[280px] overflow-hidden rounded-2xl bg-surface-2">
          {isVideo && look.media_url ? (
            <video src={look.media_url} poster={look.thumbnail_url ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : src ? (
            <Image src={src} alt={look.name} fill sizes="280px" unoptimized className="object-cover" />
          ) : null}
          {look.kind === "generated" ? <AiBadge className="absolute right-2 top-2" /> : null}
        </div>

        <div className="rail" role="tablist" aria-label="Look editor">
          <Chip role="radio" active={tab === "appearance"} onClick={() => setTab("appearance")}>
            Appearance
          </Chip>
          <Chip role="radio" active={tab === "prompt"} onClick={() => setTab("prompt")} disabled={isVideo} title={isVideo ? "Start from a photo look" : undefined}>
            New look from prompt
          </Chip>
          <Chip role="radio" active={tab === "angles"} onClick={() => setTab("angles")} disabled={isVideo} title={isVideo ? "Start from a photo look" : undefined}>
            Camera angles
          </Chip>
        </div>

        {tab === "appearance" ? (
          <div className="space-y-2">
            {renaming ? (
              <form onSubmit={rename} className="flex items-end gap-2">
                <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus containerClassName="flex-1" />
                <Button type="submit" variant="secondary" loading={busy === "rename"}>
                  Save
                </Button>
              </form>
            ) : (
              <Button variant="secondary" full icon={<Pencil size={18} />} onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
            <Button
              full
              variant={look.is_default ? "secondary" : "primary"}
              disabled={look.is_default}
              loading={busy === "default"}
              icon={look.is_default ? <Check size={18} /> : <Star size={18} />}
              onClick={async () => {
                setBusy("default");
                try {
                  onIdentity(await api.identities.defaultLook(identity.id, look.id));
                  toast("Default look updated.", "success");
                } catch (e) {
                  toast(errorMessage(e), "error");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {look.is_default ? "This is the default look" : "Use as default"}
            </Button>
            <Button
              variant="danger"
              full
              icon={<Trash2 size={18} />}
              loading={busy === "delete"}
              onClick={async () => {
                if (!window.confirm(`Delete the look "${look.name}"?`)) return;
                setBusy("delete");
                try {
                  await api.identities.removeLook(identity.id, look.id);
                  onDeleted();
                } catch (e) {
                  toast(errorMessage(e), "error");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Delete look
            </Button>
          </div>
        ) : tab === "prompt" ? (
          <LookPromptForm identity={identity} sourceLookId={look.id} onStarted={(j) => onJobStarted(j.job_id)} />
        ) : (
          <CameraAnglesForm identity={identity} sourceLookId={look.id} onStarted={(j) => onJobStarted(j.job_id)} />
        )}
      </div>
    </Sheet>
  );
}

