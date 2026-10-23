"use client";

import { ArrowDown, ArrowUp, Minus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { SkeletonText } from "@/components/ui/Skeleton";
import { errorMessage } from "@/lib/api";
import { num, rupees } from "@/lib/lab";
import { qualityMethodName } from "@/lib/quality";
import type { GoldenReportOut, GoldenRow } from "@/lib/types";

type Tone = "green" | "amber" | "red" | "neutral";

/** Quality: a rise is good, a small dip is within tolerance (the API allows 0.05), a bigger one is a regression. */
function qualityTone(delta: number | null): Tone {
  if (delta === null) return "neutral";
  if (delta >= 0) return "green";
  if (delta > -0.05) return "amber";
  return "red";
}

/** Wall time: faster or equal is good, up to half as slow again is tolerated, more is a regression. */
function wallTone(delta: number | null, base: number | null): Tone {
  if (delta === null || base === null || base <= 0) return "neutral";
  if (delta <= 0) return "green";
  if (delta <= base * 0.5) return "amber";
  return "red";
}

const TONE_TEXT: Record<Tone, string> = {
  green: "text-green",
  amber: "text-amber",
  red: "text-red",
  neutral: "text-muted",
};

function verdictPill(row: GoldenRow): { tone: Tone | "accent"; label: string } {
  if (row.pending_reruns > 0) return { tone: "accent", label: row.pending_reruns === 1 ? "Rerunning…" : `${row.pending_reruns} reruns in progress` };
  if (row.verdict === "ok") return { tone: "green", label: "OK" };
  if (row.verdict === "not rerun yet") return { tone: "neutral", label: "Not rerun yet" };
  if (row.verdict.startsWith("worse")) return { tone: "red", label: row.verdict.replace(/^worse:\s*/, "Worse: ") };
  return { tone: "neutral", label: row.verdict };
}

/** A signed delta with an arrow, so the direction never relies on colour alone. */
function Delta({ value, tone, digits, unit = "" }: { value: number | null; tone: Tone; digits: number; unit?: string }) {
  if (value === null) return <span className="text-muted">–</span>;
  const Icon = value > 0 ? ArrowUp : value < 0 ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
      <Icon size={12} aria-hidden />
      {value > 0 ? "+" : ""}
      {value.toFixed(digits)}
      {unit}
    </span>
  );
}

function qualityCell(row: GoldenRow) {
  const g = row.golden.quality_score;
  const l = row.latest?.quality_score ?? null;
  const method = row.latest?.quality_method ?? row.golden.quality_method;
  return { g, l, method, tone: qualityTone(row.quality_delta) };
}

export function GoldenSet({
  report,
  loading,
  error,
  onRerun,
  rerunning,
}: {
  report: GoldenReportOut | undefined;
  loading: boolean;
  error: unknown;
  onRerun: () => void;
  rerunning: boolean;
}) {
  const count = report?.count ?? 0;
  const pending = (report?.rows ?? []).reduce((n, r) => n + r.pending_reruns, 0);
  const canRerun = count > 0 && pending === 0 && !rerunning;

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">Golden set</h2>
          <p className="text-sm text-muted">Rerun after any engine or settings change. A regression means quality dropped or time rose by half.</p>
        </div>
        <div className="space-y-1">
          <Button variant="secondary" size="sm" icon={<RotateCcw size={16} />} onClick={onRerun} disabled={!canRerun} loading={rerunning} className="w-full sm:w-auto">
            Rerun golden set
          </Button>
          {count === 0 ? <p className="text-xs text-muted">Mark a finished trial as golden first (the star on its card).</p> : null}
          {pending > 0 ? <p className="text-xs text-muted">Reruns in progress; the table updates on its own.</p> : null}
        </div>
      </div>

      {loading ? <SkeletonText lines={2} /> : null}
      {error ? <Notice tone="red">{errorMessage(error)}</Notice> : null}

      {report && count > 0 ? (
        <>
          <p className="text-sm text-muted">
            {count} golden {count === 1 ? "trial" : "trials"}
            {report.regressions > 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-red">
                  {report.regressions} {report.regressions === 1 ? "regression" : "regressions"}
                </span>
              </>
            ) : (
              " · no regressions"
            )}
          </p>

          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <Th>Trial</Th>
                  <Th>Engine</Th>
                  <Th right>Quality golden → latest</Th>
                  <Th right>Wall s</Th>
                  <Th right>₹/min golden → latest</Th>
                  <Th>Verdict</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => {
                  const q = qualityCell(row);
                  const pill = verdictPill(row);
                  return (
                    <tr key={row.golden.id} className="border-t border-line">
                      <Td>
                        <span className="block max-w-[220px] truncate font-semibold">{row.golden.name}</span>
                        {row.golden.seed !== null ? <span className="text-xs text-muted">Seed {row.golden.seed}</span> : null}
                      </Td>
                      <Td>
                        {row.golden.engine_label}
                        {row.latest?.engine_version ? <span className="block text-xs text-muted">{row.latest.engine_version}</span> : null}
                      </Td>
                      <Td right>
                        <span className="tabular-nums">
                          {num(q.g, 2)} → {num(q.l, 2)}
                        </span>{" "}
                        <Delta value={row.quality_delta} tone={q.tone} digits={2} />
                        {q.g !== null || q.l !== null ? <span className="block text-xs text-muted">{qualityMethodName(q.method)}</span> : null}
                      </Td>
                      <Td right>
                        <span className="tabular-nums">
                          {num(row.golden.wall_seconds, 0)} → {num(row.latest?.wall_seconds ?? null, 0)}
                        </span>{" "}
                        <Delta value={row.wall_delta_s} tone={wallTone(row.wall_delta_s, row.golden.wall_seconds)} digits={0} unit=" s" />
                      </Td>
                      <Td right>
                        <span className="tabular-nums">
                          {rupees(row.cost_per_minute.golden, 1)} → {rupees(row.cost_per_minute.latest, 1)}
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={pill.tone}>{pill.label}</Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Phone: stacked */}
          <div className="space-y-2 md:hidden">
            {report.rows.map((row) => {
              const q = qualityCell(row);
              const pill = verdictPill(row);
              return (
                <Card key={row.golden.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold">{row.golden.name}</p>
                      <p className="text-xs text-muted">
                        {row.golden.engine_label}
                        {row.golden.seed !== null ? ` · seed ${row.golden.seed}` : ""}
                        {row.latest?.engine_version ? ` · ${row.latest.engine_version}` : ""}
                      </p>
                    </div>
                    <Badge tone={pill.tone}>{pill.label}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <Cell label={`Quality (${qualityMethodName(q.method)})`}>
                      <span className="tabular-nums">
                        {num(q.g, 2)} → {num(q.l, 2)}
                      </span>{" "}
                      <Delta value={row.quality_delta} tone={q.tone} digits={2} />
                    </Cell>
                    <Cell label="Wall seconds">
                      <span className="tabular-nums">
                        {num(row.golden.wall_seconds, 0)} → {num(row.latest?.wall_seconds ?? null, 0)}
                      </span>{" "}
                      <Delta value={row.wall_delta_s} tone={wallTone(row.wall_delta_s, row.golden.wall_seconds)} digits={0} unit=" s" />
                    </Cell>
                    <Cell label="₹/min golden → latest">
                      <span className="tabular-nums">
                        {rupees(row.cost_per_minute.golden, 1)} → {rupees(row.cost_per_minute.latest, 1)}
                      </span>
                    </Cell>
                  </dl>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2 align-top ${right ? "text-right" : ""}`}>{children}</td>;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
