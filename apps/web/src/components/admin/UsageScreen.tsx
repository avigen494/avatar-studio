"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useIsAdmin } from "@/lib/admin";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { compact, money, percent, titleCase } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { rupees } from "@/lib/lab";
import type { AdminUsageOut, UsageWorkspaceRow } from "@/lib/types";
import { DailyChart } from "./DailyChart";

const RANGES = [7, 30, 90] as const;

export function UsageScreen() {
  const admin = useIsAdmin();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const usage = useApi(() => api.admin.usage(days), ["admin-usage", days], { enabled: admin.isAdmin });
  const rows = useMemo(() => [...(usage.data?.per_workspace ?? [])].sort((a, b) => b.credits_charged - a.credits_charged || b.videos - a.videos), [usage.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usage"
        subtitle="Platform-wide numbers for the whole Avatar Studio: renders, cost per minute and who is paying."
        right={
          admin.isAdmin ? (
            <div className="flex gap-1.5" role="radiogroup" aria-label="Period">
              {RANGES.map((d) => (
                <Chip key={d} role="radio" active={days === d} onClick={() => setDays(d)} className="min-h-9 px-3 text-sm">
                  {d} d
                </Chip>
              ))}
            </div>
          ) : undefined
        }
      />

      {!admin.known ? <SkeletonList count={3} /> : null}
      {admin.known && !admin.isAdmin ? <Notice tone="amber">Only the platform admin can see usage.</Notice> : null}

      {admin.isAdmin ? (
        <>
          {usage.loading && !usage.stale ? <SkeletonList count={4} /> : null}
          {usage.error ? <Notice tone="red">{errorMessage(usage.error)}</Notice> : null}
          {usage.data ?? usage.stale ? <Dashboard data={(usage.data ?? usage.stale) as AdminUsageOut} rows={rows} days={days} refreshing={usage.refreshing || usage.loading} /> : null}
        </>
      ) : null}
    </div>
  );
}

function Dashboard({ data, rows, days, refreshing }: { data: AdminUsageOut; rows: UsageWorkspaceRow[]; days: number; refreshing: boolean }) {
  const v = data.videos;
  const cost = data.cost_per_minute_inr;
  const ws = data.workspaces;
  const successRate = v.total > 0 ? v.succeeded / v.total : null;
  const p95Ok = cost.p95 !== null && cost.p95 <= cost.target_p95;
  const payingOk = ws.paying >= ws.target_paying;
  const revenue = Object.entries(data.revenue).filter(([, amt]) => typeof amt === "number");

  return (
    <div className={`space-y-6 transition-opacity ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing || undefined}>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="Key numbers">
        <Tile label="Videos" value={compact(v.total)} sub={`${v.succeeded} succeeded · ${v.failed} failed · ${v.cancelled} cancelled`} />
        <Tile label="Success rate" value={percent(successRate)} sub={v.total > 0 ? `${percent(v.failure_rate, 1)} failed of ${v.total}` : "No renders in this period"} />
        <Tile label="Minutes rendered" value={compact(v.minutes, 1)} sub={`last ${days} days`} />
        <Tile label="Credits charged" value={compact(v.credits_charged)} sub="charged on success only" />
        <Tile
          label="Paying workspaces"
          value={`${ws.paying}`}
          sub={`of ${ws.total} · target ${ws.target_paying}`}
          state={payingOk ? "good" : "watch"}
          meter={{ value: ws.paying, max: ws.target_paying }}
          footer={Object.entries(ws.by_plan)
            .sort((a, b) => b[1] - a[1])
            .map(([plan, n]) => `${titleCase(plan)} ${n}`)
            .join(" · ")}
        />
        <Tile
          label="p95 cost per minute"
          value={cost.p95 === null ? "–" : rupees(cost.p95, 2)}
          sub={`target ${rupees(cost.target_p95, 0)} · p50 ${cost.p50 === null ? "–" : rupees(cost.p50, 2)} · ${cost.samples} ${cost.samples === 1 ? "sample" : "samples"}`}
          state={cost.p95 === null ? undefined : p95Ok ? "good" : "watch"}
          footer={cost.note ?? undefined}
        />
      </section>

      <Card className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-muted">Revenue</span>
        {revenue.length === 0 ? <span className="text-sm text-muted">No paid invoices in this period.</span> : null}
        {revenue.map(([cur, amt]) => (
          <span key={cur} className="text-lg font-bold">
            {money(amt as number, cur)} <span className="text-sm font-medium text-muted">{cur}</span>
          </span>
        ))}
        <span className="ml-auto text-xs text-muted">GPU {rupees(cost.gpu_price_inr_per_hour, 0)}/h · {data.engine_trials} engine {data.engine_trials === 1 ? "trial" : "trials"}</span>
      </Card>

      <Card>
        <DailyChart days={days} data={data.daily} />
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Per workspace</h2>
        <p className="text-sm text-muted">Sorted by credits charged in the period. Balance is the current credit balance.</p>
        {rows.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No workspaces yet.</p>
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden p-0 sm:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-4 py-2 font-semibold">Workspace</th>
                      <th className="py-2 pr-3 font-semibold">Plan</th>
                      <th className="py-2 pr-3 text-right font-semibold">Videos</th>
                      <th className="py-2 pr-3 text-right font-semibold">Succeeded</th>
                      <th className="py-2 pr-3 text-right font-semibold">Failed</th>
                      <th className="py-2 pr-3 text-right font-semibold">Minutes</th>
                      <th className="py-2 pr-3 text-right font-semibold">Credits</th>
                      <th className="py-2 pr-3 text-right font-semibold">Members</th>
                      <th className="py-2 pr-4 text-right font-semibold">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-4 py-2 font-semibold">
                          <div className="max-w-[180px] truncate" title={r.name}>
                            {r.name}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge tone={r.plan === "free" ? "neutral" : "accent"}>{titleCase(r.plan)}</Badge>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.videos}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.succeeded}</td>
                        <td className={`py-2 pr-3 text-right tabular-nums ${r.failed > 0 ? "text-red" : ""}`}>{r.failed}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.minutes.toFixed(1)}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{r.credits_charged}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.members}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted">{r.balance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {/* Phone cards */}
            <ul className="space-y-2 sm:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <Card className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-base font-semibold">{r.name}</p>
                      <Badge tone={r.plan === "free" ? "neutral" : "accent"}>{titleCase(r.plan)}</Badge>
                    </div>
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
                      <Stat k="Videos" v={`${r.videos}`} />
                      <Stat k="Succeeded" v={`${r.succeeded}`} />
                      <Stat k="Failed" v={`${r.failed}`} warn={r.failed > 0} />
                      <Stat k="Minutes" v={r.minutes.toFixed(1)} />
                      <Stat k="Credits" v={`${r.credits_charged}`} strong />
                      <Stat k="Balance" v={`${r.balance}`} />
                    </dl>
                    <p className="text-xs text-muted">
                      {r.members} {r.members === 1 ? "member" : "members"}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tile({
  label,
  value,
  sub,
  state,
  meter,
  footer,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  /** good = on target, watch = below/above target. Shown as icon + label, never colour alone. */
  state?: "good" | "watch";
  meter?: { value: number; max: number };
  footer?: string;
}) {
  return (
    <Card className="flex flex-col gap-1.5 p-3 sm:p-4">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2xl font-bold sm:text-3xl">{value}</p>
        {state ? (
          <Badge tone={state === "good" ? "green" : "amber"}>
            {state === "good" ? <Check size={12} strokeWidth={3} /> : <AlertTriangle size={12} />}
            {state === "good" ? "On target" : "Off target"}
          </Badge>
        ) : null}
      </div>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
      {meter ? (
        <div
          role="meter"
          aria-label={`${label}: ${meter.value} of ${meter.max}`}
          aria-valuemin={0}
          aria-valuemax={meter.max}
          aria-valuenow={Math.min(meter.value, meter.max)}
          className="mt-1 h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--viz-1-soft)" }}
        >
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (meter.value / Math.max(1, meter.max)) * 100)}%`, background: "var(--viz-1)" }} />
        </div>
      ) : null}
      {footer ? <p className="mt-auto pt-1 text-xs text-muted">{footer}</p> : null}
    </Card>
  );
}

function Stat({ k, v, strong = false, warn = false }: { k: string; v: string; strong?: boolean; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""} ${warn ? "text-red" : ""}`}>{v}</dd>
    </div>
  );
}
