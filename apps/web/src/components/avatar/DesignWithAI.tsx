"use client";

import { Check, Sparkles, Star, Wand2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { ChipGroup } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DESIGN_AGES, DESIGN_CREDITS, DESIGN_GENDERS, DESIGN_ORIENTATIONS, DESIGN_POSES, DESIGN_STYLES } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { jobErrorMessage } from "@/lib/identity-jobs";
import type { DesignIn, IdentityOut, JobStartOut, LookOut } from "@/lib/types";
import { CostLine } from "./LookGenerator";
import { LookGeneratorHint } from "./LookGeneratorHint";

const DEFAULT_DESIGN: DesignIn = {
  age: "adult",
  gender: "person",
  ethnicity: "Indian",
  description: "",
  orientation: "portrait",
  pose: "upper body",
  style: "Realistic",
};

/** The "Design with AI" form for designed avatars: 3 candidates for 2 credits. */
export function DesignWithAI({ identity, onStarted, compact = false }: { identity: IdentityOut; onStarted: (job: JobStartOut) => void; compact?: boolean }) {
  const { toast } = useToast();
  const { refetch: refetchMe } = useMe();
  const [form, setForm] = useState<DesignIn>(DEFAULT_DESIGN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const job = await api.identities.design(identity.id, { ...form, ethnicity: form.ethnicity.trim() || "Indian", description: form.description.trim() });
      toast(job.message, "success");
      refetchMe();
      onStarted(job);
    } catch (e) {
      setError(jobErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      {!compact ? (
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Wand2 size={22} />
          </span>
          <div>
            <h2 className="text-lg font-bold leading-tight">Design with AI</h2>
            <p className="text-sm text-muted">Describe the presenter. You get three candidates; pick one as the face of this avatar.</p>
          </div>
        </div>
      ) : null}
      <ChipGroup label="Who" options={DESIGN_GENDERS} value={form.gender} onChange={(gender) => setForm({ ...form, gender })} />
      <ChipGroup label="Age" options={DESIGN_AGES} value={form.age} onChange={(age) => setForm({ ...form, age })} />
      <Input label="Ethnicity" value={form.ethnicity} onChange={(e) => setForm({ ...form, ethnicity: e.target.value })} maxLength={60} placeholder="Indian" />
      <Textarea
        label="Details (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        maxLength={300}
        placeholder="Short hair, round glasses, warm smile, navy kurta, bookshelf behind…"
        className="min-h-20"
      />
      <ChipGroup label="Orientation" options={DESIGN_ORIENTATIONS} value={form.orientation} onChange={(orientation) => setForm({ ...form, orientation })} />
      <ChipGroup label="Pose" options={DESIGN_POSES} value={form.pose} onChange={(pose) => setForm({ ...form, pose })} />
      <ChipGroup label="Style" options={DESIGN_STYLES} value={form.style} onChange={(style) => setForm({ ...form, style })} />
      {error ? <Notice tone="red">{error}</Notice> : null}
      <CostLine credits={DESIGN_CREDITS} what="3 candidates" />
      <Button full size="lg" icon={<Sparkles size={18} />} loading={busy} onClick={generate}>
        Generate
      </Button>
      <LookGeneratorHint />
    </>
  );

  return compact ? <div className="space-y-4">{body}</div> : <Card className="space-y-4">{body}</Card>;
}

/** Three shimmering tiles while a generate_look job runs. */
export function GeneratingTiles({ label = "Making your looks…", progress }: { label?: string; progress?: number }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <li key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <Skeleton className="aspect-[4/5] w-full rounded-none" />
            <div className="p-2.5">
              <Skeleton className="h-4 w-2/3" />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 font-semibold">
          <Sparkles size={16} className="text-accent" /> {label}
        </span>
        {typeof progress === "number" ? <span className="tabular-nums text-muted">{progress}%</span> : null}
      </div>
      <ProgressBar value={progress ?? 0} indeterminate={typeof progress !== "number"} label={label} />
    </div>
  );
}

/** Small "AI" corner mark for generated looks. */
export function AiBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${className}`} title="Made with AI">
      <Sparkles size={10} /> AI
    </span>
  );
}

/** Candidate looks of a designed avatar with a "Use this" button on each. */
export function CandidateGrid({
  identity,
  onIdentity,
  onOpen,
}: {
  identity: IdentityOut;
  onIdentity: (i: IdentityOut) => void;
  onOpen?: (look: LookOut) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function use(look: LookOut) {
    setBusy(look.id);
    try {
      onIdentity(await api.identities.defaultLook(identity.id, look.id));
      toast(`“${look.name}” is now the face of ${identity.name}.`, "success");
    } catch (e) {
      toast(jobErrorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {identity.looks.map((l) => {
        const src = l.thumbnail_url || (l.kind !== "video" ? l.media_url : null);
        return (
          <li key={l.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <button type="button" onClick={() => onOpen?.(l)} className="relative block aspect-[4/5] w-full bg-surface-2 text-left" aria-label={`Open ${l.name}`}>
              {src ? <Image src={src} alt="" fill sizes="(min-width: 640px) 240px, 45vw" unoptimized className="object-cover" /> : null}
              {l.is_default ? (
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">
                  <Star size={12} fill="currentColor" /> Default
                </span>
              ) : null}
              {l.kind === "generated" ? <AiBadge className="absolute right-2 top-2" /> : null}
            </button>
            <div className="space-y-1.5 p-2.5">
              <p className="truncate text-sm font-semibold">{l.name}</p>
              {l.is_default ? (
                <p className="flex items-center gap-1 text-xs font-semibold text-green">
                  <Check size={14} /> In use
                </p>
              ) : (
                <Button size="sm" variant="secondary" full loading={busy === l.id} onClick={() => use(l)}>
                  Use this
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
