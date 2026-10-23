"use client";

import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import type { VoiceOut } from "@/lib/types";

export function ImportKey({ onDone }: { onDone: (voices: VoiceOut[]) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const k = key.trim();
    if (k.length < 10) {
      setError("Paste the full API key from your ElevenLabs account.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const voices = await api.voices.importKey(k);
      onDone(voices);
    } catch (err) {
      setError(errorMessage(err, "ElevenLabs did not accept that key."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted">
        Your voices stay in your ElevenLabs account and get billed there. We store the key encrypted and use it only for your renders.
      </p>
      <Input
        label="ElevenLabs API key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="sk_…"
        error={error}
      />
      {error ? null : <Notice>Find it under Profile → API keys on elevenlabs.io.</Notice>}
      <Button type="submit" size="lg" full loading={busy} icon={<KeyRound size={18} />}>
        Import my voices
      </Button>
    </form>
  );
}
