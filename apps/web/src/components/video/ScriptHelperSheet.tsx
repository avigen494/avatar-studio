"use client";

import { Check, ListVideo, Wand2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { errorMessage, isApiError } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDuration, formatSeconds } from "@/lib/format";
import type { Aspect, Language, VideoPlanOut } from "@/lib/types";
import { ScriptHelperHint, useScriptHelper } from "./HelpMeWrite";

const LENGTHS = [30, 45, 60, 90, 120];
const PLAN_LENGTHS = [30, 60, 90, 120];

type Tab = "write" | "plan";

/** What "Use this script" hands back to the Create form. */
export interface AppliedPlan {
  script: string;
  title: string;
  aspect: Aspect | null;
}

/** The planner answers "9:16" or a word; both map to an aspect. */
export function aspectFromOrientation(o: string | null | undefined): Aspect | null {
  switch ((o ?? "").toLowerCase()) {
    case "9:16":
    case "portrait":
    case "vertical":
      return "9:16";
    case "16:9":
    case "landscape":
    case "horizontal":
      return "16:9";
    case "1:1":
    case "square":
      return "1:1";
    default:
      return null;
  }
}

export function ScriptHelperSheet({
  open,
  onClose,
  language,
  identityId,
  voiceId,
  onScript,
  onPlan,
}: {
  open: boolean;
  onClose: () => void;
  language: Language;
  identityId?: string | null;
  voiceId?: string | null;
  onScript: (script: string) => void;
  onPlan: (applied: AppliedPlan) => void;
}) {
  const [tab, setTab] = useState<Tab>("write");
  return (
    <Sheet open={open} onClose={onClose} title="Help me write" description={tab === "write" ? "Say what the video is for. You get a spoken script you can edit." : "Give a brief and a length. You get a scene-by-scene plan and the script."}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Helper">
        <TabButton active={tab === "write"} onClick={() => setTab("write")} icon={<Wand2 size={16} />}>
          Write a script
        </TabButton>
        <TabButton active={tab === "plan"} onClick={() => setTab("plan")} icon={<ListVideo size={16} />}>
          Plan a video
        </TabButton>
      </div>
      {tab === "write" ? (
        <WriteTab language={language} onScript={onScript} onClose={onClose} />
      ) : (
        <PlanTab identityId={identityId} voiceId={voiceId} onPlan={onPlan} onClose={onClose} />
      )}
    </Sheet>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors",
        active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */

function WriteTab({ language, onScript, onClose }: { language: Language; onScript: (s: string) => void; onClose: () => void }) {
  const helper = useScriptHelper();
  const [brief, setBrief] = useState("");
  const [audience, setAudience] = useState("creators and small business owners in India");
  const [seconds, setSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (brief.trim().length < 3) {
      setError("Tell us what the video is about, in a sentence or two.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api.ai.script({ brief: brief.trim(), audience: audience.trim() || undefined, language, target_seconds: seconds });
      setWarnings(out.guardrails.map((g) => g.message));
      onScript(out.script);
      if (out.guardrails.length === 0) onClose();
    } catch (err) {
      setError(errorMessage(err, "The writing helper is not available right now. You can still type your script."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" role="tabpanel">
      <Textarea
        label="What is the video about?"
        placeholder="Example: Announce my Saturday webinar on starting a YouTube channel. Mention it is free and seats are limited to 100."
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        maxLength={4000}
        rows={4}
        error={error}
      />
      <Input label="Who is it for?" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} />
      <div className="space-y-2">
        <span className="block text-sm font-semibold text-muted">Length</span>
        <div className="rail" role="radiogroup" aria-label="Length">
          {LENGTHS.map((s) => (
            <Chip key={s} role="radio" active={seconds === s} onClick={() => setSeconds(s)}>
              {s} s
            </Chip>
          ))}
        </div>
      </div>
      {warnings.length > 0 ? <Notice tone="amber">The script was added, but check this before you render: {warnings.join(" ")}</Notice> : null}
      <ScriptHelperHint />
      <Button type="submit" size="lg" full loading={busy} disabled={!helper.enabled} icon={<Wand2 size={18} />}>
        Write the script
      </Button>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function PlanTab({ identityId, voiceId, onPlan, onClose }: { identityId?: string | null; voiceId?: string | null; onPlan: (a: AppliedPlan) => void; onClose: () => void }) {
  const helper = useScriptHelper();
  const [brief, setBrief] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VideoPlanOut | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (brief.trim().length < 3) {
      setError("Describe the video in a sentence or two.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.ai.plan({ brief: brief.trim(), target_seconds: seconds, identity_id: identityId ?? null, voice_id: voiceId ?? null }));
    } catch (err) {
      if (isApiError(err) && err.status === 503) {
        setError(
          helper.isAdmin
            ? "The planner needs Claude. Connect it in Settings → Connections to plan videos."
            : "The planner is not available yet: Claude is not connected on this server (platform admin only).",
        );
      } else {
        setError(errorMessage(err, "The planner is not available right now."));
      }
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!result) return;
    onPlan({ script: result.script, title: result.plan.title, aspect: aspectFromOrientation(result.plan.orientation) });
    onClose();
  }

  return (
    <div className="space-y-4" role="tabpanel">
      <form onSubmit={submit} className="space-y-4">
        <Textarea
          label="Brief"
          placeholder="Example: A 60-second explainer on why small shops should accept UPI, ending with a call to visit our site."
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={4000}
          rows={3}
          error={error}
        />
        <div className="space-y-2">
          <span className="block text-sm font-semibold text-muted">Length</span>
          <div className="rail" role="radiogroup" aria-label="Length">
            {PLAN_LENGTHS.map((s) => (
              <Chip key={s} role="radio" active={seconds === s} onClick={() => setSeconds(s)}>
                {s} s
              </Chip>
            ))}
          </div>
        </div>
        {error && helper.isAdmin && !helper.enabled ? (
          <p className="text-xs text-muted">
            <Link href="/settings/connections" className="font-semibold text-accent">
              Open Settings → Connections
            </Link>
          </p>
        ) : null}
        <Button type="submit" size="lg" full variant={result ? "secondary" : "primary"} loading={busy} icon={<ListVideo size={18} />}>
          {result ? "Plan again" : "Plan the video"}
        </Button>
      </form>

      {result ? (
        <div className="space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-bold">{result.plan.title}</h3>
            <span className="text-xs text-muted">
              {result.plan.scenes.length} scenes · {formatSeconds(result.seconds)} spoken
              {aspectFromOrientation(result.plan.orientation) ? ` · ${aspectFromOrientation(result.plan.orientation)}` : ""}
            </span>
          </div>
          <ol className="space-y-2">
            {result.plan.scenes.map((s, i) => (
              <li key={`${i}-${s.name}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold tabular-nums">{i + 1}</span>
                  <span className="font-semibold">{s.name}</span>
                  <Badge tone={s.type === "B" ? "neutral" : "accent"} title={s.type === "B" ? "B-roll: cutaway footage" : "A-roll: presenter on camera"}>
                    {s.type}-roll
                  </Badge>
                  <span className="ml-auto text-xs tabular-nums text-muted">
                    {formatDuration(s.start_s)}–{formatDuration(s.end_s)}
                  </span>
                </div>
                {s.visual ? <p className="mt-1 text-sm text-muted">{s.visual}</p> : null}
                {s.voiceover ? <p className="mt-1 text-[15px] leading-relaxed">{s.voiceover}</p> : null}
              </li>
            ))}
          </ol>
          <Button size="lg" full onClick={apply} icon={<Check size={18} />}>
            Use this script
          </Button>
          <p className="text-xs text-muted">Fills the script and title and sets the aspect to match the plan. Scene editing is not in this release.</p>
        </div>
      ) : null}
    </div>
  );
}
