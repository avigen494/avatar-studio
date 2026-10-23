"use client";

import { useId } from "react";
import { formatDate } from "@/lib/format";
import type { UsageDay } from "@/lib/types";

/** 0 → 0, 7 → 8, 23 → 25, 140 → 150: a clean top tick. */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const unit = n / pow;
  const step = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return step * pow;
}

/** Last `days` calendar days (UTC, like the API), zero-filled from the sparse list. */
export function fillDays(days: number, data: UsageDay[]): UsageDay[] {
  const byDate = new Map(data.map((d) => [d.date, d]));
  const last = [...data.map((d) => d.date), new Date().toISOString().slice(0, 10)].sort().pop() as string;
  const end = new Date(`${last}T00:00:00Z`);
  const out: UsageDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, videos: 0, succeeded: 0 });
  }
  return out;
}

/** Column with a 4px rounded top and a square base. */
function column(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * Videos per day: all videos (lighter teal) with the succeeded share drawn over
 * them (teal). One hue, two steps, validated for both themes; legend + a table
 * view so identity never rests on colour alone.
 */
export function DailyChart({ days, data }: { days: number; data: UsageDay[] }) {
  const id = useId();
  const series = fillDays(days, data);
  const W = 640;
  const H = 180;
  const pad = { top: 12, right: 8, bottom: 24, left: 28 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.map((d) => d.videos)));
  const slot = innerW / series.length;
  const gap = Math.max(2, slot * 0.25);
  const barW = Math.min(24, slot - gap);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(series.length / 4);
  const total = series.reduce((n, d) => n + d.videos, 0);
  const ok = series.reduce((n, d) => n + d.succeeded, 0);

  return (
    <figure className="space-y-2" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-semibold">Videos per day</span>
        <span className="flex items-center gap-3 text-xs text-muted" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-1)" }} aria-hidden /> Succeeded ({ok})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--viz-1-soft)" }} aria-hidden /> All videos ({total})
          </span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-describedby={`${id}-table`} className="block h-44 w-full">
        <title>Videos per day over the last {days} days, succeeded against all</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={pad.left - 6} y={y(t)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const hTotal = (d.videos / max) * innerH;
          const hOk = (d.succeeded / max) * innerH;
          const label = formatDate(`${d.date}T00:00:00Z`);
          return (
            <g key={d.date}>
              <path d={column(x, y(d.videos), barW, hTotal)} fill="var(--viz-1-soft)" />
              <path d={column(x, y(d.succeeded), barW, hOk)} fill="var(--viz-1)" />
              {/* Hit target wider than the bar; the native title is the tooltip. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent">
                <title>
                  {label}: {d.videos} {d.videos === 1 ? "video" : "videos"}, {d.succeeded} succeeded
                </title>
              </rect>
              {i % labelEvery === 0 || i === series.length - 1 ? (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
      </svg>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Show as a table</summary>
        <div className="-mx-4 mt-2 max-h-60 overflow-auto px-4">
          <table id={`${id}-table`} className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1 pr-3 font-semibold">Day</th>
                <th className="py-1 pr-3 text-right font-semibold">Videos</th>
                <th className="py-1 text-right font-semibold">Succeeded</th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((d) => d.videos > 0)
                .map((d) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1 pr-3 text-muted">{formatDate(`${d.date}T00:00:00Z`)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{d.videos}</td>
                    <td className="py-1 text-right tabular-nums">{d.succeeded}</td>
                  </tr>
                ))}
              {total === 0 ? (
                <tr className="border-t border-line">
                  <td colSpan={3} className="py-2 text-muted">
                    No videos in this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
