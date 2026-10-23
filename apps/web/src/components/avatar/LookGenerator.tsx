"use client";

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CAMERA_ANGLE_CREDITS, LOOK_DEFAULTS, NEW_LOOK_CREDITS } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import { jobErrorMessage } from "@/lib/identity-jobs";
import type { IdentityOut, JobStartOut, LookPackEntry, LookPackOut } from "@/lib/types";
import { LookGeneratorHint } from "./LookGeneratorHint";

interface Fields {
  outfit: string;
  setting: string;
  lighting: string;
  framing: string;
}

export interface GeneratorProps {
  identity: IdentityOut;
  /** The look to start from; the default look (or the recording) when omitted. */
  sourceLookId?: string | null;
  onStarted: (job: JobStartOut) => void;
}

/** Cost line shown before every generate button. */
export function CostLine({ credits, what }: { credits: number; what: string }) {
  const { me } = useMe();
  return (
    <p className="text-sm font-semibold tabular-nums">
      {credits} credits · {what}
      <span className="font-normal text-muted">
        {" "}
        · charged only on success{typeof me?.credits === "number" ? ` · you have ${me.credits}` : ""}
      </span>
    </p>
  );
}

/** "New look from prompt": describe it, or pick an entry from a look pack. */
export function LookPromptForm({ identity, sourceLookId, onStarted }: GeneratorProps) {
  const { toast } = useToast();
  const { refetch: refetchMe } = useMe();
  const [sub, setSub] = useState<"describe" | "packs">("describe");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Fields>({ ...LOOK_DEFAULTS });
  const [pack, setPack] = useState<{ id: string; index: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const packs = useApi(() => api.identities.lookPacks(), ["look-packs"]);

  function edit(patch: Partial<Fields>) {
    setFields((f) => ({ ...f, ...patch }));
    // Edited by hand: send the fields, not the pack entry.
    setPack(null);
  }

  function pick(p: LookPackOut, index: number, entry: LookPackEntry) {
    setFields({ outfit: entry.outfit, setting: entry.setting, lighting: entry.lighting, framing: entry.framing });
    setName(entry.name);
    setPack({ id: p.id, index, name: entry.name });
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const job = await api.identities.generateLooks(identity.id, {
        mode: "look",
        name: name.trim() || null,
        ...fields,
        source_look_id: sourceLookId ?? null,
        pack_id: pack?.id ?? null,
        pack_index: pack?.index ?? null,
      });
      toast(job.message, "success");
      refetchMe();
      onStarted(job);
    } catch (e) {
      setError(jobErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rail" role="tablist" aria-label="How to describe the look">
        <Chip role="radio" active={sub === "describe"} onClick={() => setSub("describe")}>
          Describe it
        </Chip>
        <Chip role="radio" active={sub === "packs"} onClick={() => setSub("packs")}>
          Look packs
        </Chip>
      </div>

      {sub === "describe" ? (
        <div className="space-y-3">
          {pack ? (
            <Notice tone="accent">
              Filled from the “{pack.name}” pack look. Edit any field to make it your own.
            </Notice>
          ) : null}
          <Input label="Outfit" value={fields.outfit} onChange={(e) => edit({ outfit: e.target.value })} maxLength={200} placeholder={LOOK_DEFAULTS.outfit} />
          <Input label="Setting" value={fields.setting} onChange={(e) => edit({ setting: e.target.value })} maxLength={200} placeholder={LOOK_DEFAULTS.setting} />
          <Input label="Lighting" value={fields.lighting} onChange={(e) => edit({ lighting: e.target.value })} maxLength={120} placeholder={LOOK_DEFAULTS.lighting} />
          <Input label="Framing" value={fields.framing} onChange={(e) => edit({ framing: e.target.value })} maxLength={120} placeholder={LOOK_DEFAULTS.framing} />
        </div>
      ) : (
        <PackList packs={packs.data} loading={packs.loading} selected={pack} onPick={pick} />
      )}

      <Input label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Blue kurta, studio…" hint="The three variants are numbered after this name." />

      {error ? <Notice tone="red">{error}</Notice> : null}
      <CostLine credits={NEW_LOOK_CREDITS} what="3 variants" />
      <Button full size="lg" icon={<Sparkles size={18} />} loading={busy} onClick={generate}>
        Generate
      </Button>
      <LookGeneratorHint />
    </div>
  );
}

function PackList({
  packs,
  loading,
  selected,
  onPick,
}: {
  packs: LookPackOut[] | undefined;
  loading: boolean;
  selected: { id: string; index: number } | null;
  onPick: (p: LookPackOut, index: number, entry: LookPackEntry) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
    );
  }
  if (!packs || packs.length === 0) return <p className="text-sm text-muted">No look packs yet.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Ready-made looks for Indian creator niches. Tap one to fill the fields.</p>
      {packs.map((p) => (
        <section key={p.id}>
          <h3 className="text-sm font-semibold">
            {p.name} <span className="font-normal text-muted">· {p.niche}</span>
          </h3>
          <ul className="mt-1.5 grid gap-2 sm:grid-cols-3">
            {p.looks.map((entry, i) => {
              const active = selected?.id === p.id && selected.index === i;
              return (
                <li key={entry.name}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onPick(p, i, entry)}
                    className={[
                      "flex w-full items-start gap-2 rounded-2xl border p-3 text-left transition-colors",
                      active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-surface-2",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{entry.name}</span>
                      <span className="block text-xs text-muted">
                        {entry.outfit} · {entry.setting}
                      </span>
                    </span>
                    {active ? <Check size={16} className="mt-0.5 shrink-0 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Camera angles": three angles of the same look. */
export function CameraAnglesForm({ identity, sourceLookId, onStarted }: GeneratorProps) {
  const { toast } = useToast();
  const { refetch: refetchMe } = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const job = await api.identities.generateLooks(identity.id, { mode: "camera_angles", source_look_id: sourceLookId ?? null });
      toast(job.message, "success");
      refetchMe();
      onStarted(job);
    } catch (e) {
      setError(jobErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Three new angles of this look with the same outfit, background and lighting: a close-up from the left, an eye-level medium shot, and a right three-quarter view. Switch
        between them in a video to keep it lively.
      </p>
      <ul className="grid grid-cols-3 gap-2 text-center text-xs text-muted">
        {["Close-up · left", "Eye level · centre", "Medium · right"].map((a) => (
          <li key={a} className="rounded-xl border border-line px-2 py-3">
            {a}
          </li>
        ))}
      </ul>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <CostLine credits={CAMERA_ANGLE_CREDITS} what="3 angles" />
      <Button full size="lg" icon={<Sparkles size={18} />} loading={busy} onClick={generate}>
        Generate
      </Button>
      <LookGeneratorHint />
    </div>
  );
}
