"use client";

import { KeyRound, Library, Mic } from "lucide-react";
import { useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import type { VoiceOut } from "@/lib/types";
import { CloneVoice } from "./CloneVoice";
import { ImportKey } from "./ImportKey";
import { VoiceLibrary } from "./VoiceLibrary";
import { useVoicePlayer } from "./VoiceRow";

type Tab = "library" | "clone" | "key";

export interface AddVoiceSheetProps {
  open: boolean;
  onClose: () => void;
  myVoices: VoiceOut[];
  /**
   * New voices, in order. The first adopted voice of a workspace becomes its
   * default on the API side; callers also select the first one returned.
   */
  onAdded: (voices: VoiceOut[]) => void;
  /** Keep the sheet open after the library adds one (to add several). Default: close. */
  stayOpen?: boolean;
}

/**
 * One sheet to get a voice from anywhere: the engine library (adopt), a clone
 * of your own, or an ElevenLabs key. Used by Create and the Engine Lab when the
 * workspace has no voice yet, and by their "Add more…" entries.
 */
export function AddVoiceSheet({ open, onClose, myVoices, onAdded, stayOpen = false }: AddVoiceSheetProps) {
  const [tab, setTab] = useState<Tab>("library");
  const player = useVoicePlayer();
  const { toast } = useToast();

  function added(list: VoiceOut[], message?: string) {
    if (list.length === 0) return;
    onAdded(list);
    if (message) toast(message, "success");
    if (!stayOpen) onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={myVoices.length === 0 ? "Add a voice" : "Add more voices"}
      description={myVoices.length === 0 ? "Every video needs a voice. Pick one from the library, clone your own, or bring your ElevenLabs voices." : undefined}
      full
    >
      <div className="space-y-4 pt-1">
        <div className="rail" role="tablist" aria-label="Where the voice comes from">
          <Chip role="radio" active={tab === "library"} onClick={() => setTab("library")} icon={<Library size={16} />}>
            Pick a voice
          </Chip>
          <Chip role="radio" active={tab === "clone"} onClick={() => setTab("clone")} icon={<Mic size={16} />}>
            Clone my voice
          </Chip>
          <Chip role="radio" active={tab === "key"} onClick={() => setTab("key")} icon={<KeyRound size={16} />}>
            ElevenLabs key
          </Chip>
        </div>

        {tab === "library" ? (
          <VoiceLibrary myVoices={myVoices} player={player} onAdopted={(v) => added([v])} />
        ) : tab === "clone" ? (
          <CloneVoice onDone={(v) => added([v], "Voice cloned. Tap play to hear it.")} />
        ) : (
          <ImportKey
            onDone={(imported) => {
              const ids = new Set(myVoices.map((x) => x.id));
              const fresh = imported.filter((x) => !ids.has(x.id));
              if (fresh.length === 0) {
                toast("Those voices are already in your workspace.", "info");
                onClose();
                return;
              }
              added(fresh, `${fresh.length} ${fresh.length === 1 ? "voice" : "voices"} imported.`);
            }}
          />
        )}
      </div>
    </Sheet>
  );
}
