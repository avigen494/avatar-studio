"use client";

import { ArrowRight, Camera, Check, Image as ImageIcon, KeyRound, Library, Mic, Smartphone, Wand2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { AvatarKindPicker } from "@/components/avatar/AvatarKindPicker";
import { CandidateGrid, DesignWithAI, GeneratingTiles } from "@/components/avatar/DesignWithAI";
import { Avatar, identityThumb } from "@/components/avatar/IdentityCard";
import { PinnedBar, PinnedSpacer } from "@/components/layout/PinnedBar";
import { QrCode } from "@/components/misc/QrCode";
import { ReferenceCapture } from "@/components/recorder/ReferenceCapture";
import { IdentityPill } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { FilePicker, UploadProgress, useUploader } from "@/components/uploader/FilePicker";
import { CloneVoice } from "@/components/voice/CloneVoice";
import { ImportKey } from "@/components/voice/ImportKey";
import { VoiceLibrary } from "@/components/voice/VoiceLibrary";
import { useVoicePlayer, VoiceRow } from "@/components/voice/VoiceRow";
import { errorMessage } from "@/lib/api";
import { STARTER_SCRIPT } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { useApi, useHref, useMediaQuery } from "@/lib/hooks";
import { isActiveJob, latestJob, useIdentityJobs } from "@/lib/identity-jobs";
import type { IdentityOut, VoiceOut } from "@/lib/types";

const STEPS = ["Avatar", "Voice", "First video"] as const;

export function OnboardingScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, refetch: refetchMe } = useMe();
  const identities = useApi(() => api.identities.list(), ["identities"], {
    pollWhile: (list) => list.some((i) => i.status === "verifying"),
    pollMs: 3000,
  });
  const voices = useApi(() => api.voices.list(), ["voices"]);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const href = useHref();

  const requested = Number(params.get("step"));
  const derived = !me ? 1 : !me.onboarding.avatar_ready ? 1 : !me.onboarding.has_voice ? 2 : 3;
  const step = requested >= 1 && requested <= 3 ? requested : derived;
  const go = (n: number) => {
    router.replace(`/onboarding?step=${n}`);
    refetchMe();
  };

  const identity = identities.data?.find((i) => i.kind === "real_person") ?? identities.data?.[0];
  const personName = me?.user.name || me?.user.email.split("@")[0] || "";

  return (
    <div className="lg:grid lg:grid-cols-[1fr_260px] lg:gap-8">
      <div className="space-y-5">
        <header className="space-y-3">
          <ol className="flex items-center gap-2" aria-label="Progress">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const state = n < step ? "done" : n === step ? "current" : "todo";
              return (
                <li key={label} className="flex flex-1 flex-col gap-1.5" aria-current={state === "current" ? "step" : undefined}>
                  <span className={`h-1.5 rounded-full ${state === "todo" ? "bg-line" : "bg-accent"}`} />
                  <span className={`text-xs font-semibold ${state === "current" ? "text-accent" : "text-muted"}`}>
                    {n}. {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </header>

        {step === 1 ? (
          <StepRecord
            identity={identity}
            loading={identities.loading}
            personName={personName}
            onIdentity={(i) => {
              identities.setData((list) => {
                const rest = (list ?? []).filter((x) => x.id !== i.id);
                return [i, ...rest];
              });
              refetchMe();
            }}
            onNext={() => go(2)}
          />
        ) : null}
        {step === 2 ? (
          <StepVoice
            voices={voices.data ?? []}
            loading={voices.loading}
            personName={personName}
            onVoices={(updater) => {
              voices.setData((list) => updater(list ?? []));
              refetchMe();
            }}
            onBack={() => go(1)}
            onNext={() => go(3)}
          />
        ) : null}
        {step === 3 ? (
          <StepFirstVideo identity={identity} voice={(voices.data ?? []).find((v) => v.is_default) ?? voices.data?.[0]} personName={personName} onBack={() => go(2)} />
        ) : null}
      </div>

      {isDesktop && href ? (
        <aside className="hidden lg:block">
          <Card className="space-y-3">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Smartphone size={18} /> Continue on your phone
            </div>
            <p className="text-sm text-muted">Scan to open this step on your phone and use its camera. Sign in with the same email.</p>
            <QrCode text={href} label="QR code for this page" />
          </Card>
        </aside>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1: record                                                       */
/* ------------------------------------------------------------------ */

type RecordView = "name" | "capture" | "verifying" | "photo" | "design" | "done";

function deriveView(identity: IdentityOut | undefined): RecordView {
  if (!identity) return "name";
  if (identity.kind === "designed") return identity.looks.length > 0 ? "done" : "design";
  if (identity.status === "verifying") return "verifying";
  if (identity.status === "ready" && identity.consent_status === "verified") return "done";
  return "capture";
}

function StepRecord({
  identity,
  loading,
  personName,
  onIdentity,
  onNext,
}: {
  identity: IdentityOut | undefined;
  loading: boolean;
  personName: string;
  onIdentity: (i: IdentityOut) => void;
  onNext: () => void;
}) {
  const [override, setOverride] = useState<RecordView | null>(null);
  const [name, setName] = useState(personName);
  const [kind, setKind] = useState<"real_person" | "designed">("real_person");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploader = useUploader();
  const [savingLook, setSavingLook] = useState(false);
  const { toast } = useToast();

  if (loading) return <SkeletonCard />;
  const view = override ?? deriveView(identity);
  const displayName = identity?.name || name || personName;

  async function createIdentity() {
    const n = (name || personName).trim();
    if (!n) {
      setError(kind === "designed" ? "Give the presenter a name." : "Tell us your name so the consent line can include it.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.identities.create({ name: n, kind });
      onIdentity(created);
      setOverride(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function addPhoto(file: File) {
    if (!identity) return;
    const key = await uploader.upload({ purpose: "look", file, filename: file.name, contentType: file.type || "image/jpeg", identityId: identity.id });
    if (!key) return;
    setSavingLook(true);
    try {
      await api.identities.addLook(identity.id, { key, name: "Photo", kind: "photo" });
      const fresh = await api.identities.get(identity.id);
      onIdentity(fresh);
      toast("Photo added. You can make a video in photo mode now.", "success");
      setOverride(null);
    } catch (e) {
      toast(errorMessage(e, "Could not add that photo."), "error");
    } finally {
      setSavingLook(false);
    }
  }

  return (
    <section className="space-y-4">
      <StepTitle
        title={
          view === "done"
            ? "Your avatar is ready"
            : view === "verifying"
              ? "Verifying your recording"
              : view === "design"
                ? "Design your presenter"
                : view === "name"
                  ? "Your avatar"
                  : "Record 15 seconds"
        }
        body={
          view === "name"
            ? "Record yourself in one short take, or design an AI presenter from a description."
            : view === "capture"
              ? "Look at the camera, smile, and read the line on screen. Good light, no music."
              : view === "photo"
                ? "A clear photo lets you make a video in photo mode while the clip is checked."
                : view === "design"
                  ? "Describe who should present your videos. You get three candidates and pick one."
                  : undefined
        }
      />

      {view === "name" ? (
        <Card className="space-y-4">
          <AvatarKindPicker value={kind} onChange={setKind} />
          <Input
            label={kind === "designed" ? "Presenter name" : "Your name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "designed" ? "Asha, Coach Dev, Studio host…" : "How you introduce yourself"}
            autoComplete={kind === "designed" ? "off" : "name"}
            maxLength={120}
            error={error}
          />
          <Button size="lg" full loading={creating} onClick={createIdentity} icon={kind === "designed" ? <Wand2 size={20} /> : <Camera size={20} />}>
            {kind === "designed" ? "Continue to design" : "Continue to the camera"}
          </Button>
        </Card>
      ) : null}

      {view === "design" && identity ? <StepDesign identity={identity} onIdentity={onIdentity} /> : null}

      {view === "capture" && identity ? (
        <div className="space-y-4">
          {identity.consent_status === "rejected" || identity.status === "failed" ? (
            <Notice tone="amber">
              <strong className="font-semibold">We could not verify the last clip.</strong>{" "}
              {identity.consent_notes || "Record it again with your face clearly in view while reading the consent line."}
            </Notice>
          ) : null}
          <ReferenceCapture
            identity={identity}
            personName={displayName}
            onDone={(i) => {
              onIdentity(i);
              setOverride(null);
            }}
          />
          <Button variant="ghost" full icon={<ImageIcon size={18} />} onClick={() => setOverride("photo")}>
            Use a photo instead for now
          </Button>
        </div>
      ) : null}

      {view === "verifying" && identity ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={identityThumb(identity)} alt="" size={56} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">{identity.name}</p>
              <IdentityPill status={identity.status} consent={identity.consent_status} />
            </div>
          </div>
          <ProgressBar value={0} indeterminate label="Verifying" />
          <p className="text-sm text-muted">
            We check that the clip shows you reading the consent line. This usually takes under two minutes. You can leave this page; we keep checking.
          </p>
          <div className="space-y-2">
            {identity.looks.length > 0 ? (
              <Button size="lg" full onClick={onNext} icon={<ArrowRight size={20} />}>
                Next: your voice
              </Button>
            ) : (
              <Button size="lg" full variant="secondary" icon={<ImageIcon size={18} />} onClick={() => setOverride("photo")}>
                Use a photo instead for now
              </Button>
            )}
            <Button variant="ghost" full onClick={() => setOverride("capture")}>
              Record again
            </Button>
          </div>
        </Card>
      ) : null}

      {view === "photo" && identity ? (
        <Card className="space-y-4">
          {uploader.busy || savingLook ? (
            <UploadProgress progress={uploader.progress} label={uploader.busy ? "Uploading your photo" : "Saving"} />
          ) : (
            <>
              {uploader.error ? <Notice tone="red">{uploader.error}</Notice> : null}
              <FilePicker accept="image/*" capture="user" size="lg" full icon={<Camera size={20} />} onFile={addPhoto}>
                Take a photo
              </FilePicker>
              <FilePicker accept="image/*" variant="secondary" full onFile={addPhoto}>
                Choose from your photos
              </FilePicker>
              <p className="text-xs text-muted">Face the light, plain background, shoulders in frame. Portrait works best for 9:16 videos.</p>
            </>
          )}
          <Button variant="ghost" full onClick={() => setOverride(null)}>
            Back
          </Button>
        </Card>
      ) : null}

      {view === "done" && identity ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar src={identityThumb(identity)} alt="" size={64} />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold">{identity.name}</p>
              <IdentityPill status={identity.status} consent={identity.consent_status} />
            </div>
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-green-soft text-green">
              <Check />
            </span>
          </div>
          {identity.kind === "designed" ? (
            <>
              <p className="text-sm text-muted">Pick the candidate you like best. You can design again or add more looks any time from Avatars.</p>
              <CandidateGrid identity={identity} onIdentity={onIdentity} />
            </>
          ) : (
            <p className="text-sm text-muted">Consent verified. Add more looks any time from Avatars.</p>
          )}
          <PinnedSpacer size={80} />
          <PinnedBar aboveTabs={false}>
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" onClick={() => setOverride(identity.kind === "designed" ? "design" : "capture")}>
                {identity.kind === "designed" ? "Design again" : "Record again"}
              </Button>
              <Button size="lg" full onClick={onNext} icon={<ArrowRight size={20} />}>
                Next: your voice
              </Button>
            </div>
          </PinnedBar>
        </Card>
      ) : null}
    </section>
  );
}

/** Design with AI inside onboarding: form, then skeleton tiles while the job runs. */
function StepDesign({ identity, onIdentity }: { identity: IdentityOut; onIdentity: (i: IdentityOut) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const { toast } = useToast();
  const jobs = useIdentityJobs(identity.id, async () => {
    try {
      onIdentity(await api.identities.get(identity.id));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
  const active = jobs.active.find((j) => j.type === "generate_look");
  const settled = pending !== null && jobs.jobs.some((j) => j.id === pending && !isActiveJob(j));
  const generating = Boolean(active) || (pending !== null && !settled);
  const last = latestJob(jobs.jobs, "generate_look");
  const failed = last && last.status === "failed" ? last : undefined;

  if (generating) {
    return (
      <Card>
        <GeneratingTiles label="Designing your presenter…" progress={active?.progress} />
      </Card>
    );
  }
  return (
    <Card className="space-y-4">
      {failed ? (
        <Notice tone="red">
          <p className="font-semibold">The design did not finish.</p>
          <p>{failed.error || "Something went wrong on our side. Nothing was charged."}</p>
        </Notice>
      ) : null}
      <DesignWithAI
        identity={identity}
        compact
        onStarted={(j) => {
          setPending(j.job_id);
          jobs.refetch();
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2: voice                                                        */
/* ------------------------------------------------------------------ */

function StepVoice({
  voices,
  loading,
  personName,
  onVoices,
  onBack,
  onNext,
}: {
  voices: VoiceOut[];
  loading: boolean;
  personName: string;
  onVoices: (updater: (list: VoiceOut[]) => VoiceOut[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [sheet, setSheet] = useState<"clone" | "library" | "key" | null>(null);
  const player = useVoicePlayer();
  const { toast } = useToast();

  const replaceVoice = (v: VoiceOut) => onVoices((list) => list.map((x) => (x.id === v.id ? v : x)));

  return (
    <section className="space-y-4">
      <StepTitle title="Your voice" body="Clone your own, pick one from the library, or bring your ElevenLabs voices. You can change this later." />

      <div className="grid gap-3 sm:grid-cols-3">
        <OptionCard icon={<Mic />} title="Clone my voice" body="Record 30 seconds or upload audio." onClick={() => setSheet("clone")} />
        <OptionCard icon={<Library />} title="Pick a voice" body="Ready-made English, Hindi and Hinglish voices." onClick={() => setSheet("library")} />
        <OptionCard icon={<KeyRound />} title="Use my ElevenLabs key" body="Import the voices from your account." onClick={() => setSheet("key")} />
      </div>

      {loading ? (
        <SkeletonCard />
      ) : voices.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted">Your voices · tap play to hear them</p>
          <ul className="space-y-2">
            {voices.map((v) => (
              <li key={v.id}>
                <VoiceRow
                  voice={v}
                  player={player}
                  onVoice={replaceVoice}
                  actions={
                    v.is_default ? null : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            const updated = await api.voices.patch(v.id, { is_default: true });
                            onVoices((list) => list.map((x) => ({ ...x, is_default: x.id === updated.id })));
                          } catch (e) {
                            toast(errorMessage(e), "error");
                          }
                        }}
                      >
                        Set default
                      </Button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PinnedSpacer size={80} />
      <PinnedBar aboveTabs={false}>
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" full disabled={voices.length === 0} onClick={onNext} icon={<ArrowRight size={20} />}>
            {voices.length === 0 ? "Add a voice to continue" : "Next: first video"}
          </Button>
        </div>
      </PinnedBar>

      <Sheet open={sheet === "clone"} onClose={() => setSheet(null)} title="Clone my voice" full>
        <CloneVoice
          defaultName={personName ? `${personName.split(" ")[0]}'s voice` : "My voice"}
          onDone={(v) => {
            onVoices((list) => [v, ...list]);
            setSheet(null);
            toast("Voice cloned. Tap play to hear it.", "success");
          }}
        />
      </Sheet>
      <Sheet open={sheet === "library"} onClose={() => setSheet(null)} title="Pick a voice" full>
        <VoiceLibrary myVoices={voices} player={player} onAdopted={(v) => onVoices((list) => [...list, v])} onVoice={replaceVoice} />
      </Sheet>
      <Sheet open={sheet === "key"} onClose={() => setSheet(null)} title="Use my ElevenLabs key">
        <ImportKey
          onDone={(imported) => {
            onVoices((list) => {
              const ids = new Set(list.map((x) => x.id));
              return [...list, ...imported.filter((x) => !ids.has(x.id))];
            });
            setSheet(null);
            toast(`${imported.length} ${imported.length === 1 ? "voice" : "voices"} imported.`, "success");
          }}
        />
      </Sheet>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3: first video                                                  */
/* ------------------------------------------------------------------ */

function StepFirstVideo({
  identity,
  voice,
  personName,
  onBack,
}: {
  identity: IdentityOut | undefined;
  voice: VoiceOut | undefined;
  personName: string;
  onBack: () => void;
}) {
  const name = identity?.name || personName || "there";
  const href = `/create?script=${encodeURIComponent(STARTER_SCRIPT(name))}`;
  return (
    <section className="space-y-4">
      <StepTitle title="Make your first video" body="We wrote a short starter script. Change a word or two, preview it free, then generate." />
      <Card className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar src={identity ? identityThumb(identity) : null} alt="" size={48} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">Avatar</p>
            <p className="truncate font-semibold">{identity?.name ?? "Not set up yet"}</p>
          </div>
          {identity ? <IdentityPill status={identity.status} consent={identity.consent_status} /> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2">
            <Mic size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted">Voice</p>
            <p className="truncate font-semibold">{voice?.name ?? "Not chosen yet"}</p>
          </div>
        </div>
        <blockquote className="rounded-xl bg-surface-2 p-3 text-[15px] leading-snug">{STARTER_SCRIPT(name)}</blockquote>
      </Card>
      <PinnedSpacer size={80} />
      <PinnedBar aboveTabs={false}>
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" full href={href} icon={<ArrowRight size={20} />}>
            Open the script in Create
          </Button>
        </div>
      </PinnedBar>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StepTitle({ title, body }: { title: string; body?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
      {body ? <p className="mt-1 text-sm text-muted">{body}</p> : null}
    </div>
  );
}

function OptionCard({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-left hover:border-accent sm:flex-col sm:items-start"
    >
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0">
        <span className="block text-base font-semibold">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
    </button>
  );
}
