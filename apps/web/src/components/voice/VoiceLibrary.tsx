"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { LANGUAGES } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { languageLabel, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { Language, LibraryVoiceOut, VoiceOut } from "@/lib/types";
import { engineName, PlayButton, type VoicePlayer } from "./VoiceRow";

export interface VoiceLibraryProps {
  myVoices: VoiceOut[];
  player: VoicePlayer;
  onAdopted: (voice: VoiceOut) => void;
  onVoice?: (voice: VoiceOut) => void;
}

/** Engine-provided voices. Adopt one, then play it inline. */
export function VoiceLibrary({ myVoices, player, onAdopted, onVoice }: VoiceLibraryProps) {
  const [language, setLanguage] = useState<Language | "">("");
  const [gender, setGender] = useState<string>("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const { toast } = useToast();
  const lib = useApi(() => api.voices.library(language), ["library", language]);

  const genders = Array.from(new Set((lib.data ?? []).map((v) => (v.gender || "").toLowerCase()).filter(Boolean)));
  const rows = (lib.data ?? []).filter((v) => !gender || (v.gender || "").toLowerCase() === gender);

  function adoptedFor(v: LibraryVoiceOut): VoiceOut | undefined {
    // VoiceOut does not expose external_voice_id, so match on engine + name.
    return myVoices.find((m) => m.engine === v.engine && m.name === v.name && m.source === "library");
  }

  async function adopt(v: LibraryVoiceOut) {
    const id = `${v.engine}:${v.external_voice_id}`;
    setAddingId(id);
    try {
      const voice = await api.voices.adopt({
        engine: v.engine,
        external_voice_id: v.external_voice_id,
        name: v.name,
        language: (["en", "hi", "hinglish"].includes(v.language) ? v.language : "en") as Language,
        gender: v.gender ?? null,
        style: v.style ?? null,
      });
      onAdopted(voice);
      toast(`${voice.name} added to your voices.`, "success");
    } catch (e) {
      toast(errorMessage(e, "Could not add that voice."), "error");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="rail" role="radiogroup" aria-label="Language">
          <Chip role="radio" active={language === ""} onClick={() => setLanguage("")}>
            All languages
          </Chip>
          {LANGUAGES.map((l) => (
            <Chip key={l.value} role="radio" active={language === l.value} onClick={() => setLanguage(l.value)}>
              {l.label}
            </Chip>
          ))}
        </div>
        {genders.length > 1 ? (
          <div className="rail" role="radiogroup" aria-label="Gender">
            <Chip role="radio" active={gender === ""} onClick={() => setGender("")}>
              Any gender
            </Chip>
            {genders.map((g) => (
              <Chip key={g} role="radio" active={gender === g} onClick={() => setGender(g)}>
                {titleCase(g)}
              </Chip>
            ))}
          </div>
        ) : null}
      </div>

      {lib.error ? <Notice tone="red">{errorMessage(lib.error)}</Notice> : null}
      {lib.loading ? (
        <SkeletonList count={4} />
      ) : rows.length === 0 ? (
        <EmptyState title="No voices match" body="Try another language, or clone your own voice." />
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => {
            const adopted = adoptedFor(v);
            const id = `${v.engine}:${v.external_voice_id}`;
            return (
              <li key={id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                {adopted ? (
                  <PlayButton voice={adopted} player={player} onVoice={onVoice} />
                ) : (
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted" aria-hidden>
                    <Plus size={20} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold">{v.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{engineName(v.engine)}</Badge>
                    <Badge>{languageLabel(v.language)}</Badge>
                    {v.gender ? <Badge>{titleCase(v.gender)}</Badge> : null}
                    {v.style ? <Badge>{titleCase(v.style)}</Badge> : null}
                  </div>
                </div>
                {adopted ? (
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-green">
                    <Check size={16} /> Added
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" loading={addingId === id} onClick={() => adopt(v)}>
                    Add
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
