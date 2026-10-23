"use client";

import { RotateCcw, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SCORE_CRITERIA } from "@/lib/constants";
import { formatDuration } from "@/lib/format";
import { isActiveTrial, num, rupees } from "@/lib/lab";
import { qualityHint, qualityLabel } from "@/lib/quality";
import type { TrialOut } from "@/lib/types";

function statusPill(status: string): { tone: "green" | "accent" | "red" | "neutral"; label: string } {
  switch (status) {
    case "succeeded":
      return { tone: "green", label: "Ready" };
    case "running":
      return { tone: "accent", label: "Rendering" };
    case "queued":
      return { tone: "accent", label: "Waiting" };
    case "failed":
      return { tone: "red", label: "Failed" };
    default:
      return { tone: "neutral", label: status };
  }
}

export function TrialCard({
  trial,
  blindLabel,
  onScore,
  onRerun,
  onDelete,
  onGolden,
  busy,
}: {
  trial: TrialOut;
  /** "Clip A" in blind mode; null shows the engine and the numbers. */
  blindLabel: string | null;
  onScore: () => void;
  onRerun: () => void;
  onDelete: () => void;
  /** Toggle the golden (regression baseline) flag. Shown on finished, non-benchmark trials. */
  onGolden?: () => void;
  busy?: "rerun" | "delete" | "golden" | null;
}) {
  const blind = blindLabel !== null;
  const active = isActiveTrial(trial);
  const pill = statusPill(trial.status);
  const title = blind ? blindLabel : trial.engine_label;
  const panel = trial.averages.panel ?? null;
  const quality = qualityLabel(trial.quality_score, trial.quality_method);
  const canGolden = Boolean(onGolden) && trial.status === "succeeded" && !trial.is_benchmark;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3" aria-label={title}>
      <div className="relative overflow-hidden rounded-xl bg-black">
        {trial.status === "succeeded" && trial.output_url ? (
          <video
            src={trial.output_url}
            poster={trial.thumbnail_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="h-72 w-full object-contain"
            aria-label={`${title} video`}
          />
        ) : (
          <div className="flex h-72 w-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/80">
            {trial.look_url && !blind ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={trial.look_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
            ) : null}
            {active ? (
              <>
                <span className="relative font-semibold">Rendering…</span>
                <ProgressBar value={0} indeterminate label="Rendering" className="relative max-w-[200px]" />
              </>
            ) : trial.status === "failed" ? (
              <span className="relative font-semibold">Did not finish</span>
            ) : (
              <span className="relative">No video yet</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{title}</p>
          {!blind ? <p className="truncate text-xs text-muted">{trial.name}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {!blind && trial.is_benchmark ? <Badge tone="amber">Benchmark</Badge> : null}
          {!blind && trial.is_golden ? <Badge tone="amber">Golden</Badge> : null}
          {!blind && trial.golden_of ? <Badge title="Rerun of a golden trial, same seed">Golden rerun</Badge> : null}
          <Badge tone={pill.tone}>{pill.label}</Badge>
          {!blind && canGolden ? (
            <IconButton
              label={trial.is_golden ? "Remove from the golden set" : "Mark as golden"}
              title={trial.is_golden ? "Remove from the golden set" : "Mark as golden (regression baseline)"}
              aria-pressed={trial.is_golden}
              onClick={onGolden}
              disabled={busy === "golden"}
              className={trial.is_golden ? "text-amber" : "text-muted"}
            >
              <Star size={18} fill={trial.is_golden ? "currentColor" : "none"} />
            </IconButton>
          ) : null}
        </div>
      </div>

      {!blind ? (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
          <Metric label="Length" value={trial.duration_s ? formatDuration(trial.duration_s) : "–"} />
          <Metric label="Wall" value={trial.wall_seconds !== null ? `${num(trial.wall_seconds, 0)} s` : "–"} />
          <Metric label="GPU" value={trial.gpu_seconds !== null ? `${num(trial.gpu_seconds, 0)} s` : "–"} />
          <Metric label="Cost" value={rupees(trial.cost_inr)} />
          <Metric label="Per min" value={trial.cost_per_minute_inr !== null ? `${rupees(trial.cost_per_minute_inr, 1)}/min` : "–"} />
          <Metric label="Steps" value={trial.is_benchmark ? "–" : String(trial.steps)} />
        </dl>
      ) : (
        <p className="text-sm text-muted">Length {trial.duration_s ? formatDuration(trial.duration_s) : "–"}</p>
      )}

      {quality ? (
        <p className="text-xs text-muted" title={qualityHint(trial.quality_method)}>
          <span className="font-semibold text-fg">Quality</span> {quality}
          {!blind && trial.seed !== null ? ` · seed ${trial.seed}` : ""}
          {!blind && trial.engine_version ? ` · ${trial.engine_version}` : ""}
        </p>
      ) : null}

      {trial.error && !blind ? (
        <p role="alert" className="break-words text-sm text-red">
          {trial.error}
        </p>
      ) : null}

      <div className="space-y-1">
        {trial.scores.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {trial.scores.map((s) => (
                <Badge key={String(s.rater)}>
                  {String(s.rater)} · {num((s.lipsync + s.motion + s.identity + s.overall) / 4, 1)}
                  {s.guessed_heygen ? " · HeyGen?" : ""}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted">
              {SCORE_CRITERIA.map((c) => `${c.short} ${num(trial.averages[c.key] ?? null, 1)}`).join(" · ")}
              {panel !== null ? ` · Panel ${num(panel, 2)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted">No scores yet.</p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" icon={<Star size={16} />} onClick={onScore} disabled={trial.status !== "succeeded"} className="flex-1">
          Score
        </Button>
        {!trial.is_benchmark && !active ? (
          <Button size="sm" variant="secondary" icon={<RotateCcw size={16} />} onClick={onRerun} loading={busy === "rerun"}>
            Rerun
          </Button>
        ) : null}
        <IconButton label="Delete trial" onClick={onDelete} disabled={busy === "delete"} className="text-red">
          <Trash2 size={18} />
        </IconButton>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
