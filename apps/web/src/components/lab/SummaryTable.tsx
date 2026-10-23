"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SCORE_CRITERIA } from "@/lib/constants";
import { num, rupees } from "@/lib/lab";
import type { SummaryOut, SummaryRow } from "@/lib/types";

export function SummaryTable({ summary, onAdopt, adopting }: { summary: SummaryOut; onAdopt: (engine: string) => void; adopting: boolean }) {
  const rec = summary.recommended_photo_engine;
  const recRow = summary.rows.find((r) => r.engine === rec) ?? null;
  const showAdopt = Boolean(rec && rec !== summary.current_default);

  if (summary.rows.length === 0) {
    return <p className="text-sm text-muted">Run a few trials and score them; the table fills in here.</p>;
  }

  return (
    <div className="space-y-3">
      {/* Desktop table */}
      <Card className="hidden overflow-x-auto p-0 md:block">
        <table className="w-full min-w-[840px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <Th>Engine</Th>
              <Th right>Trials</Th>
              <Th right>Scores</Th>
              {SCORE_CRITERIA.map((c) => (
                <Th key={c.key} right>
                  {c.short}
                </Th>
              ))}
              <Th right>Panel</Th>
              <Th right>₹/min</Th>
              <Th right>Wall s/min</Th>
              <Th right>HeyGen?</Th>
              <Th>Verdict</Th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <RowDesktop key={r.engine} row={r} recommended={r.engine === rec} isDefault={r.engine === summary.current_default} />
            ))}
          </tbody>
        </table>
      </Card>

      {/* Phone: stacked */}
      <div className="space-y-2 md:hidden">
        {summary.rows.map((r) => (
          <RowStacked key={r.engine} row={r} recommended={r.engine === rec} isDefault={r.engine === summary.current_default} />
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {showAdopt && recRow ? (
          <Button onClick={() => onAdopt(recRow.engine)} loading={adopting} className="w-full sm:w-auto">
            Adopt {recRow.engine_label} as default
          </Button>
        ) : null}
        <p className="text-xs text-muted">
          Photo-mode default right now: <span className="font-semibold text-fg">{summary.current_default}</span>
          {rec && rec === summary.current_default ? " (also the recommended engine)." : rec ? "." : ". No photo engine has scores yet."}
        </p>
      </div>
    </div>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
}

function Td({ children, right = false, className = "" }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-3 py-2 ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>;
}

function RowDesktop({ row, recommended, isDefault }: { row: SummaryRow; recommended: boolean; isDefault: boolean }) {
  return (
    <tr className={`border-t border-line ${recommended ? "bg-accent-soft" : ""}`}>
      <Td>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold">{row.engine_label}</span>
          {recommended ? <Badge tone="accent">Recommended</Badge> : null}
          {isDefault ? <Badge tone="green">Current default</Badge> : null}
        </span>
      </Td>
      <Td right>{row.trials}</Td>
      <Td right>{row.scored}</Td>
      {SCORE_CRITERIA.map((c) => (
        <Td key={c.key} right>
          {num(row.avg[c.key] ?? null, 2)}
        </Td>
      ))}
      <Td right className="font-semibold">
        {num(row.panel_avg, 2)}
      </Td>
      <Td right>{row.cost_per_minute_inr !== null ? rupees(row.cost_per_minute_inr, 1) : "–"}</Td>
      <Td right>{num(row.wall_seconds_per_minute, 0)}</Td>
      <Td right>{row.guessed_heygen}</Td>
      <Td>{row.verdict}</Td>
    </tr>
  );
}

function RowStacked({ row, recommended, isDefault }: { row: SummaryRow; recommended: boolean; isDefault: boolean }) {
  return (
    <Card className={`space-y-2 ${recommended ? "border-accent bg-accent-soft" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-base font-bold">{row.engine_label}</span>
        {recommended ? <Badge tone="accent">Recommended</Badge> : null}
        {isDefault ? <Badge tone="green">Current default</Badge> : null}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 text-sm">
        <Cell label="Trials" value={String(row.trials)} />
        <Cell label="Scores" value={String(row.scored)} />
        <Cell label="Panel" value={num(row.panel_avg, 2)} />
        {SCORE_CRITERIA.map((c) => (
          <Cell key={c.key} label={c.short} value={num(row.avg[c.key] ?? null, 2)} />
        ))}
        <Cell label="HeyGen?" value={String(row.guessed_heygen)} />
        <Cell label="₹/min" value={row.cost_per_minute_inr !== null ? rupees(row.cost_per_minute_inr, 1) : "–"} />
        <Cell label="Wall s/min" value={num(row.wall_seconds_per_minute, 0)} />
      </dl>
      <p className="text-sm">
        <span className="text-muted">Verdict: </span>
        {row.verdict}
      </p>
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="truncate font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
