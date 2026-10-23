"use client";

import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Field";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { FilePicker } from "@/components/uploader/FilePicker";
import { errorMessage, isApiError } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { downloadBlob, useApi } from "@/lib/hooks";
import type { BatchOut } from "@/lib/types";

const SAMPLE_CSV = `script,title,language,aspect,quality,idempotency_key
"Hi Priya, your order is on its way. It should reach you by Thursday.",Priya,en,9:16,720p,lead-1
"Hi Aman, thanks for joining the course. Your first lesson is live now.",Aman,en,9:16,720p,lead-2
"Namaste Neha, aapka demo kal shaam 6 baje hai. Milte hain!",Neha,hinglish,9:16,720p,lead-3
`;

const COLUMNS = "script (required), title, language, aspect, quality, identity_id, voice_id, idempotency_key, expression, gesture, gaze";

function rowTone(status: string): "green" | "amber" | "red" | "neutral" {
  if (status === "queued") return "green";
  if (status === "draft" || status === "created") return "neutral";
  if (status === "blocked" || status === "failed") return "red";
  return "amber";
}

export function BatchScreen() {
  const { me, refetch: refetchMe } = useMe();
  const { toast } = useToast();
  const identities = useApi(() => api.identities.list(), ["identities"]);
  const voices = useApi(() => api.voices.list(), ["voices"]);
  const projects = useApi(() => api.projects.list(), ["projects"]);
  const [identityId, setIdentityId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [generate, setGenerate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [result, setResult] = useState<BatchOut | null>(null);

  const usable = (identities.data ?? []).filter((i) => i.can_render || i.status === "ready");
  const readyVoices = (voices.data ?? []).filter((v) => v.status !== "failed");
  const chosenIdentity = identityId || usable.find((i) => i.status === "ready")?.id || usable[0]?.id || "";
  const chosenVoice = voiceId || readyVoices.find((v) => v.is_default)?.id || readyVoices[0]?.id || "";
  const loadingLists = identities.loading || voices.loading || projects.loading;

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await api.videos.batchCsv({ file, identity_id: chosenIdentity || null, voice_id: chosenVoice || null, project_id: projectId || null, generate });
      setResult(out);
      refetchMe();
      toast(generate ? `${out.queued} of ${out.created} videos queued.` : `${out.created} drafts created.`, out.failed ? "info" : "success");
    } catch (e) {
      setError({ status: isApiError(e) ? e.status : 0, message: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  function downloadSample() {
    downloadBlob(new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" }), "avatar-studio-batch-sample.csv");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Batch from CSV" subtitle="One row per video, up to 100. Credits for the whole batch are checked first; if they are short, nothing is queued and the drafts are kept." />

      <Card className="space-y-4">
        {loadingLists ? <SkeletonText lines={3} /> : null}
        {!loadingLists && usable.length === 0 ? (
          <Notice tone="amber">
            No avatar can render yet.{" "}
            <Link href="/avatars" className="font-semibold underline">
              Set one up first
            </Link>
            .
          </Notice>
        ) : null}
        {!loadingLists ? (
          <>
            <Select label="Avatar" value={chosenIdentity} onChange={(e) => setIdentityId(e.target.value)} hint="Used for rows without an identity_id column.">
              {usable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
            <Select label="Voice" value={chosenVoice} onChange={(e) => setVoiceId(e.target.value)} hint="Used for rows without a voice_id column.">
              {readyVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.is_default ? " (default)" : ""}
                </option>
              ))}
            </Select>
            <Select label="Project (optional)" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        <Toggle
          checked={generate}
          onChange={setGenerate}
          label="Generate now"
          description={generate ? "Every row is queued right away and charged when it succeeds." : "Off: rows become drafts you can check and generate one by one."}
        />

        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted">CSV file</p>
          {file ? (
            <div className="flex items-center gap-3 rounded-xl border border-line p-3">
              <FileSpreadsheet size={22} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{file.name}</p>
                <p className="text-xs text-muted">{Math.max(1, Math.round(file.size / 1024))} KB</p>
              </div>
              <button type="button" aria-label="Remove file" onClick={() => setFile(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
                <X size={18} />
              </button>
            </div>
          ) : (
            <FilePicker accept=".csv,text/csv,text/plain" variant="secondary" full size="lg" onFile={setFile}>
              Choose a CSV
            </FilePicker>
          )}
          <p className="text-xs text-muted">Columns: {COLUMNS}. Column names are case-insensitive.</p>
          <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={downloadSample}>
            Download a sample CSV
          </Button>
        </div>

        {error ? (
          <Notice tone={error.status === 402 ? "amber" : "red"}>
            {error.message}
            {error.status === 402 ? (
              <>
                {" "}
                <Link href="/settings/plan" className="font-semibold underline">
                  Plan & credits
                </Link>
              </>
            ) : null}
          </Notice>
        ) : null}

        <Button size="lg" full icon={<Upload size={20} />} loading={busy} disabled={!file || !chosenIdentity || !chosenVoice} onClick={submit}>
          {generate ? "Upload and generate" : "Upload as drafts"}
        </Button>
        {me ? <p className="text-center text-xs text-muted">You have {me.credits} credits.</p> : null}
      </Card>

      {result ? <BatchResult result={result} /> : null}
    </div>
  );
}

function BatchResult({ result }: { result: BatchOut }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Created" value={result.created} />
        <Stat label="Queued" value={result.queued} />
        <Stat label="Failed" value={result.failed} tone={result.failed ? "red" : undefined} />
        <Stat label="Credits" value={result.total_credits} hint={`${result.balance_after} left after`} />
      </div>
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Error</th>
                <th className="py-2 pr-4 text-right font-semibold">Credits</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.index} className="border-t border-line">
                  <td className="px-4 py-2 tabular-nums text-muted">{r.index + 1}</td>
                  <td className="py-2 pr-3">
                    {r.video_id ? (
                      <Link href={`/videos/${r.video_id}`} className="inline-flex items-center gap-1.5 font-semibold text-accent">
                        <Badge tone={rowTone(r.status)}>{r.status}</Badge> Open
                      </Link>
                    ) : (
                      <Badge tone={rowTone(r.status)}>{r.status}</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted">{r.error || "—"}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.estimated_credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted">
        Drafts and queued videos are under{" "}
        <Link href="/projects" className="font-semibold text-accent">
          Projects
        </Link>
        .
      </p>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: "red" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone === "red" && value > 0 ? "text-red" : ""}`}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
