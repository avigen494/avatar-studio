"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { SCORE_CRITERIA } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { readRater, writeRater } from "@/lib/lab";
import type { ScoreIn, TrialOut } from "@/lib/types";

type Criterion = (typeof SCORE_CRITERIA)[number]["key"];
type Marks = Record<Criterion, number | null>;

const EMPTY: Marks = { lipsync: null, motion: null, identity: null, overall: null };

function marksFor(trial: TrialOut, rater: string): { marks: Marks; heygen: boolean } {
  const mine = trial.scores.find((s) => String(s.rater) === rater);
  if (!mine) return { marks: EMPTY, heygen: false };
  return {
    marks: { lipsync: mine.lipsync, motion: mine.motion, identity: mine.identity, overall: mine.overall },
    heygen: Boolean(mine.guessed_heygen),
  };
}

/** One rater's 1–5 marks for one clip. Re-saving as the same rater replaces the earlier score. */
export function ScoreSheet({
  trial,
  title,
  onClose,
  onSaved,
}: {
  trial: TrialOut | null;
  title: string;
  onClose: () => void;
  onSaved: (t: TrialOut) => void;
}) {
  const { toast } = useToast();
  const [rater, setRater] = useState<string>(() => readRater());
  const [marks, setMarks] = useState<Marks>(() => (trial ? marksFor(trial, readRater()).marks : EMPTY));
  const [heygen, setHeygen] = useState<boolean>(() => (trial ? marksFor(trial, readRater()).heygen : false));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeRater(name: string) {
    setRater(name);
    if (trial) {
      const m = marksFor(trial, name.trim());
      if (m.marks !== EMPTY) {
        setMarks(m.marks);
        setHeygen(m.heygen);
      }
    }
  }

  const complete = SCORE_CRITERIA.every((c) => marks[c.key] !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trial) return;
    const name = rater.trim();
    if (!name) {
      setError("Add your name so the panel knows whose score this is.");
      return;
    }
    if (!complete) {
      setError("Give every line a mark from 1 to 5.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const body: ScoreIn = {
        rater: name.slice(0, 40),
        lipsync: marks.lipsync as number,
        motion: marks.motion as number,
        identity: marks.identity as number,
        overall: marks.overall as number,
        guessed_heygen: heygen,
      };
      const updated = await api.lab.score(trial.id, body);
      writeRater(body.rater);
      onSaved(updated);
      toast("Score saved.", "success");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={trial !== null}
      onClose={onClose}
      title={`Score ${title}`}
      description="1 = poor, 5 = as good as the real thing. Watch the clip with sound before you mark it."
      footer={
        <Button size="lg" full loading={busy} onClick={submit} disabled={!trial}>
          Save score
        </Button>
      }
    >
      <form onSubmit={submit} className="space-y-5 pt-1">
        <Input label="Your name" value={rater} onChange={(e) => changeRater(e.target.value)} maxLength={40} placeholder="e.g. Avinash" autoComplete="name" />
        {SCORE_CRITERIA.map((c) => (
          <Segmented key={c.key} label={c.label} value={marks[c.key]} onChange={(v) => setMarks((m) => ({ ...m, [c.key]: v }))} />
        ))}
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line px-3">
          <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={heygen} onChange={(e) => setHeygen(e.target.checked)} />
          <span className="text-base font-medium">I think this is the real HeyGen</span>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

function Segmented({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-semibold text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(n)}
              className={`min-h-12 rounded-xl border text-base font-semibold tabular-nums ${
                active ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-fg hover:bg-surface-2"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
