"use client";

import { Ellipsis, KeyRound, Mic } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, PageHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { CloneVoice } from "@/components/voice/CloneVoice";
import { ImportKey } from "@/components/voice/ImportKey";
import { VoiceLibrary } from "@/components/voice/VoiceLibrary";
import { useVoicePlayer, VoiceRow } from "@/components/voice/VoiceRow";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import type { VoiceOut } from "@/lib/types";

export default function VoicesPage() {
  const { me } = useMe();
  const voices = useApi(() => api.voices.list(), ["voices"]);
  const player = useVoicePlayer();
  const { toast } = useToast();
  const [tab, setTab] = useState<"mine" | "library">("mine");
  const [sheet, setSheet] = useState<"clone" | "key" | null>(null);
  const [menuVoice, setMenuVoice] = useState<VoiceOut | null>(null);
  const [renaming, setRenaming] = useState<VoiceOut | null>(null);

  const list = voices.data ?? [];
  const replace = (v: VoiceOut) => voices.setData((l) => (l ?? []).map((x) => (x.id === v.id ? v : x)));

  async function setDefault(v: VoiceOut) {
    try {
      const updated = await api.voices.patch(v.id, { is_default: true });
      voices.setData((l) => (l ?? []).map((x) => ({ ...x, is_default: x.id === updated.id })));
      toast(`${updated.name} is now your default voice.`, "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function remove(v: VoiceOut) {
    if (!window.confirm(`Remove ${v.name} from your voices?`)) return;
    try {
      await api.voices.remove(v.id);
      voices.setData((l) => (l ?? []).filter((x) => x.id !== v.id));
      setMenuVoice(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Voices" subtitle="Tap play to hear any voice. The default is used for new videos." />

      <div className="rail" role="tablist" aria-label="Voices">
        <Chip role="radio" active={tab === "mine"} onClick={() => setTab("mine")}>
          My voices{list.length ? ` (${list.length})` : ""}
        </Chip>
        <Chip role="radio" active={tab === "library"} onClick={() => setTab("library")}>
          Library
        </Chip>
      </div>

      {tab === "mine" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={<Mic size={18} />} onClick={() => setSheet("clone")}>
              Clone my voice
            </Button>
            <Button variant="secondary" icon={<KeyRound size={18} />} onClick={() => setSheet("key")}>
              ElevenLabs key
            </Button>
          </div>
          {voices.error ? <Notice tone="red">{errorMessage(voices.error)}</Notice> : null}
          {voices.loading ? (
            <SkeletonList />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Mic size={28} />}
              title="No voices yet"
              body="Clone your own voice, pick one from the library, or import your ElevenLabs voices."
              action={
                <Button variant="secondary" onClick={() => setTab("library")}>
                  Browse the library
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {list.map((v) => (
                <li key={v.id}>
                  <VoiceRow
                    voice={v}
                    player={player}
                    onVoice={replace}
                    actions={
                      <div className="flex items-center gap-1">
                        {!v.is_default ? (
                          <Button size="sm" variant="secondary" onClick={() => setDefault(v)}>
                            Set default
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`More options for ${v.name}`}
                          onClick={() => setMenuVoice(v)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                        >
                          <Ellipsis size={20} />
                        </button>
                      </div>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <VoiceLibrary myVoices={list} player={player} onAdopted={(v) => voices.setData((l) => [...(l ?? []), v])} onVoice={replace} />
      )}

      <Sheet open={sheet === "clone"} onClose={() => setSheet(null)} title="Clone my voice" full>
        <CloneVoice
          defaultName={me?.user.name ? `${me.user.name.split(" ")[0]}'s voice` : "My voice"}
          onDone={(v) => {
            voices.setData((l) => [v, ...(l ?? [])]);
            setSheet(null);
            toast("Voice cloned. Tap play to hear it.", "success");
          }}
        />
      </Sheet>
      <Sheet open={sheet === "key"} onClose={() => setSheet(null)} title="Use my ElevenLabs key">
        <ImportKey
          onDone={(imported) => {
            voices.setData((l) => {
              const ids = new Set((l ?? []).map((x) => x.id));
              return [...(l ?? []), ...imported.filter((x) => !ids.has(x.id))];
            });
            setSheet(null);
            toast(`${imported.length} ${imported.length === 1 ? "voice" : "voices"} imported.`, "success");
          }}
        />
      </Sheet>

      <Sheet open={Boolean(menuVoice)} onClose={() => setMenuVoice(null)} title={menuVoice?.name}>
        {menuVoice ? (
          <div className="space-y-2 pt-1">
            <Button
              variant="secondary"
              full
              onClick={() => {
                setRenaming(menuVoice);
                setMenuVoice(null);
              }}
            >
              Rename
            </Button>
            {!menuVoice.is_default ? (
              <Button
                variant="secondary"
                full
                onClick={() => {
                  setDefault(menuVoice);
                  setMenuVoice(null);
                }}
              >
                Set as default
              </Button>
            ) : null}
            <Button variant="danger" full onClick={() => remove(menuVoice)}>
              Remove voice
            </Button>
          </div>
        ) : null}
      </Sheet>

      {renaming ? (
        <RenameVoice
          voice={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(v) => {
            replace(v);
            setRenaming(null);
          }}
        />
      ) : null}
    </div>
  );
}

function RenameVoice({ voice, onClose, onSaved }: { voice: VoiceOut; onClose: () => void; onSaved: (v: VoiceOut) => void }) {
  const [name, setName] = useState(voice.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      onSaved(await api.voices.patch(voice.id, { name: name.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title="Rename voice">
      <form onSubmit={submit} className="space-y-4 pt-1">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus error={error} />
        <Button type="submit" full loading={busy}>
          Save
        </Button>
      </form>
    </Sheet>
  );
}
