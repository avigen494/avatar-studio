"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { SkeletonCard, SkeletonList, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { useIsAdmin } from "@/lib/admin";
import { apiBlob, errorMessage } from "@/lib/api";
import { LAB_PHOTO_ENGINES, LAB_TEST_SCRIPT } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { downloadBlob, useApi } from "@/lib/hooks";
import { blindOrder, clipLabel, goldenIntroSeen, isActiveTrial, markGoldenIntroSeen, rupees, trialName } from "@/lib/lab";
import { loadPublicConfig } from "@/lib/public-config";
import type { Aspect, TrialOut } from "@/lib/types";
import { GoldenSet } from "./GoldenSet";
import { LabInputs, type LabInputState } from "./LabInputs";
import { ScoreSheet } from "./ScoreSheet";
import { SummaryTable } from "./SummaryTable";
import { TrialCard } from "./TrialCard";

const NO_TRIALS: TrialOut[] = [];

const INITIAL_INPUTS: LabInputState = {
  script: LAB_TEST_SCRIPT,
  voiceId: null,
  look: null,
  clip: null,
  benchmark: null,
  aspect: "9:16" as Aspect,
  steps: 20,
};

export function LabScreen() {
  const admin = useIsAdmin();
  const { toast } = useToast();
  const enabled = admin.isAdmin;

  const engines = useApi(() => api.lab.engines(), ["lab-engines"], { enabled });
  const voices = useApi(() => api.voices.list(), ["voices"], { enabled });
  const trials = useApi(() => api.lab.trials(), ["lab-trials"], {
    enabled,
    pollWhile: (list) => list.some(isActiveTrial),
    pollMs: 3000,
  });
  const summary = useApi(() => api.lab.summary(), ["lab-summary"], { enabled });
  // Golden set report: polls while any rerun is still queued or running.
  const golden = useApi(() => api.lab.golden(), ["lab-golden"], {
    enabled,
    pollWhile: (r) => r.rows.some((row) => row.pending_reruns > 0),
    pollMs: 5000,
  });

  const [rawInputs, setInputs] = useState<LabInputState>(INITIAL_INPUTS);
  const [inputsOpen, setInputsOpen] = useState(true);
  // null = the person has not touched the ticks yet; derive a sensible default.
  const [pickedEngines, setPickedEngines] = useState<Set<string> | null>(null);
  const [running, setRunning] = useState(false);
  const [addingBenchmark, setAddingBenchmark] = useState(false);
  const [blind, setBlind] = useState(false);
  const [scoring, setScoring] = useState<TrialOut | null>(null);
  const [deleting, setDeleting] = useState<TrialOut | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [busyTrial, setBusyTrial] = useState<{ id: string; what: "rerun" | "delete" | "golden" } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  /** Trial waiting for the one-time "what is the golden set" confirmation. */
  const [goldenIntro, setGoldenIntro] = useState<TrialOut | null>(null);
  const [rerunningGolden, setRerunningGolden] = useState(false);

  // Default voice (the workspace default, else the first) until one is picked.
  const defaultVoiceId = useMemo(() => {
    const vs = voices.data ?? [];
    return (vs.find((x) => x.is_default) ?? vs[0])?.id ?? null;
  }, [voices.data]);
  const inputs = useMemo<LabInputState>(
    () => (rawInputs.voiceId ? rawInputs : { ...rawInputs, voiceId: defaultVoiceId }),
    [rawInputs, defaultVoiceId],
  );

  // Sensible default ticks: the real photo engines on RunPod, only the mock otherwise.
  const selected = useMemo<Set<string>>(() => {
    if (pickedEngines) return pickedEngines;
    if (!engines.data) return new Set();
    return engines.data.backend === "runpod" ? new Set<string>([...LAB_PHOTO_ENGINES]) : new Set<string>(["mock"]);
  }, [pickedEngines, engines.data]);

  // When a trial finishes (poll sees a status change) the summary and the golden report change too.
  const statusKey = (trials.data ?? []).map((t) => `${t.id}:${t.status}`).join(",");
  const lastStatusKey = useRef(statusKey);
  const refetchSummary = summary.refetch;
  const refetchGolden = golden.refetch;
  useEffect(() => {
    if (lastStatusKey.current === statusKey) return;
    lastStatusKey.current = statusKey;
    refetchSummary();
    refetchGolden();
  }, [statusKey, refetchSummary, refetchGolden]);

  const list = useMemo(() => trials.data ?? NO_TRIALS, [trials.data]);
  const shown = useMemo(() => (blind ? blindOrder(list) : list), [blind, list]);
  const blindLabels = useMemo(() => {
    const map = new Map<string, string>();
    blindOrder(list).forEach((t, i) => map.set(t.id, clipLabel(i)));
    return map;
  }, [list]);

  function patchInputs(patch: Partial<LabInputState>) {
    setInputs((i) => ({ ...i, ...patch }));
  }

  function toggleEngine(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPickedEngines(n);
  }

  function upsert(updated: TrialOut) {
    trials.setData((prev) => {
      const items = prev ?? [];
      return items.some((t) => t.id === updated.id) ? items.map((t) => (t.id === updated.id ? updated : t)) : [updated, ...items];
    });
  }

  async function runSelected() {
    if (!engines.data) return;
    const hasClip = Boolean(inputs.clip);
    const ids = engines.data.engines
      .map((e) => e.id)
      .filter((id) => selected.has(id) && id !== "heygen_v" && !(["infinitetalk_v2v", "latentsync"].includes(id) && !hasClip));
    if (ids.length === 0) return;
    setRunning(true);
    let ok = 0;
    const when = new Date();
    for (const engine of ids) {
      try {
        const t = await api.lab.createTrial({
          name: trialName(engine, when),
          engine,
          script: inputs.script.trim(),
          voice_id: inputs.voiceId,
          look_key: inputs.look?.key ?? null,
          reference_key: inputs.clip?.key ?? null,
          aspect: inputs.aspect,
          steps: inputs.steps,
        });
        upsert(t);
        ok += 1;
      } catch (e) {
        toast(`${engine}: ${errorMessage(e)}`, "error");
      }
    }
    setRunning(false);
    if (ok > 0) {
      toast(ok === 1 ? "1 trial queued." : `${ok} trials queued.`, "success");
      setInputsOpen(false);
      trials.refetch();
    }
  }

  async function addBenchmark() {
    if (!inputs.benchmark) return;
    setAddingBenchmark(true);
    try {
      const t = await api.lab.createTrial({ name: trialName("heygen_v"), engine: "heygen_v", benchmark_key: inputs.benchmark.key });
      upsert(t);
      toast("HeyGen benchmark added.", "success");
      trials.refetch();
      summary.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setAddingBenchmark(false);
    }
  }

  async function rerun(t: TrialOut) {
    setBusyTrial({ id: t.id, what: "rerun" });
    try {
      upsert(await api.lab.rerun(t.id));
      trials.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyTrial(null);
    }
  }

  async function setGolden(t: TrialOut, isGolden: boolean) {
    setBusyTrial({ id: t.id, what: "golden" });
    try {
      upsert(await api.lab.setGolden(t.id, isGolden));
      toast(isGolden ? "Added to the golden set." : "Removed from the golden set.", "success");
      golden.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyTrial(null);
    }
  }

  function toggleGolden(t: TrialOut) {
    if (!t.is_golden && !goldenIntroSeen()) {
      setGoldenIntro(t);
      return;
    }
    void setGolden(t, !t.is_golden);
  }

  async function confirmGoldenIntro() {
    if (!goldenIntro) return;
    const t = goldenIntro;
    markGoldenIntroSeen();
    setGoldenIntro(null);
    await setGolden(t, true);
  }

  async function rerunGolden() {
    setRerunningGolden(true);
    try {
      const made = await api.lab.rerunGolden();
      made.forEach(upsert);
      toast(made.length === 1 ? "1 golden rerun queued." : `${made.length} golden reruns queued.`, "success");
      trials.refetch();
      golden.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setRerunningGolden(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const id = deleting.id;
    setActionBusy(true);
    try {
      await api.lab.remove(id);
      trials.setData((prev) => prev?.filter((t) => t.id !== id));
      setDeleting(null);
      summary.refetch();
      toast("Trial deleted.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function confirmAdopt() {
    if (!adopting) return;
    setActionBusy(true);
    try {
      await api.lab.adopt(adopting);
      toast(`${adopting} is now the photo-mode default.`, "success");
      setAdopting(null);
      summary.refetch();
      engines.refetch();
      void loadPublicConfig(true);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function exportResults() {
    try {
      downloadBlob(await apiBlob("/lab/results.md"), "STAGE0_RESULTS.md");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (!admin.known) {
    return (
      <div className="space-y-4">
        <SkeletonText lines={1} />
        <SkeletonList count={3} />
      </div>
    );
  }
  if (!admin.isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader title="Engine Lab" />
        <Notice tone="amber">Only the platform admin can use the Engine Lab.</Notice>
      </div>
    );
  }

  const scoringTitle = scoring ? (blind ? (blindLabels.get(scoring.id) ?? "clip") : scoring.engine_label) : "";
  const adoptLabel = adopting ? (summary.data?.rows.find((r) => r.engine === adopting)?.engine_label ?? adopting) : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Engine Lab" subtitle="Stage 0: run one script through every engine, score the clips blind, adopt the winner." />

      {engines.loading ? <SkeletonText lines={2} /> : null}
      {engines.error ? <Notice tone="red">{errorMessage(engines.error)}</Notice> : null}
      {engines.data ? (
        <div className="space-y-2">
          {engines.data.note ? <Notice tone="amber">{engines.data.note}</Notice> : null}
          <p className="text-sm text-muted">
            GPU <span className="font-semibold text-fg">{engines.data.gpu || "not set"}</span> · {rupees(engines.data.gpu_price_inr_per_hour, 0)}/hour · backend{" "}
            <span className="font-semibold text-fg">{engines.data.backend}</span>
          </p>
        </div>
      ) : null}

      <LabInputs
        open={inputsOpen}
        onToggle={() => setInputsOpen((o) => !o)}
        value={inputs}
        onChange={patchInputs}
        voices={voices.data ?? []}
        onVoicesAdded={(added) => {
          voices.setData((list) => {
            const ids = new Set((list ?? []).map((v) => v.id));
            return [...(list ?? []), ...added.filter((v) => !ids.has(v.id))];
          });
          voices.refetch();
        }}
        engines={engines.data?.engines ?? []}
        enginesLoading={engines.loading}
        selected={selected}
        onToggleEngine={toggleEngine}
        onRun={runSelected}
        running={running}
        onAddBenchmark={addBenchmark}
        addingBenchmark={addingBenchmark}
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Trials</h2>
            <p className="text-sm text-muted">{list.length === 0 ? "Nothing run yet." : `${list.length} ${list.length === 1 ? "trial" : "trials"}`}</p>
          </div>
        </div>
        {list.length > 0 ? (
          <Card className="py-1">
            <Toggle checked={blind} onChange={setBlind} label="Blind mode" description="Hides engine names and shuffles the clips so the panel scores without bias." />
          </Card>
        ) : null}
        {trials.loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : null}
        {trials.error ? <Notice tone="red">{errorMessage(trials.error)}</Notice> : null}
        {!trials.loading && list.length === 0 ? (
          <EmptyState title="No trials yet" body="Fill in the inputs above, tick the engines and press Run selected." />
        ) : null}
        {list.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => (
              <TrialCard
                key={t.id}
                trial={t}
                blindLabel={blind ? (blindLabels.get(t.id) ?? "Clip ?") : null}
                onScore={() => setScoring(t)}
                onRerun={() => rerun(t)}
                onDelete={() => setDeleting(t)}
                onGolden={() => toggleGolden(t)}
                busy={busyTrial?.id === t.id ? busyTrial.what : null}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Summary</h2>
            <p className="text-sm text-muted">Averages across every scored trial per engine.</p>
          </div>
          <div className="space-y-1">
            <Button variant="secondary" size="sm" icon={<Download size={16} />} onClick={exportResults} className="w-full sm:w-auto">
              Export results
            </Button>
            <p className="text-xs text-muted">Save it to docs/STAGE0_RESULTS.md in the repo.</p>
          </div>
        </div>
        {summary.loading ? <SkeletonText lines={3} /> : null}
        {summary.error ? <Notice tone="red">{errorMessage(summary.error)}</Notice> : null}
        {summary.data ? <SummaryTable summary={summary.data} onAdopt={(e) => setAdopting(e)} adopting={false} /> : null}
      </section>

      <GoldenSet report={golden.data} loading={golden.loading} error={golden.error} onRerun={rerunGolden} rerunning={rerunningGolden} />

      <ScoreSheet
        key={scoring?.id ?? "none"}
        trial={scoring}
        title={scoringTitle}
        onClose={() => setScoring(null)}
        onSaved={(t) => {
          upsert(t);
          summary.refetch();
        }}
      />

      <ConfirmSheet
        open={deleting !== null}
        onClose={() => (actionBusy ? undefined : setDeleting(null))}
        onConfirm={confirmDelete}
        title="Delete this trial?"
        body={deleting ? `${deleting.engine_label} · ${deleting.name}. Its video and scores go too.` : null}
        confirmLabel="Delete"
        tone="danger"
        busy={actionBusy}
      />

      <ConfirmSheet
        open={goldenIntro !== null}
        onClose={() => setGoldenIntro(null)}
        onConfirm={confirmGoldenIntro}
        title="Add this trial to the golden set?"
        body="Golden trials are your regression set. After any engine or settings change, press Rerun golden set: each one renders again with the same seed and the report below compares quality, time and cost against the original. The star removes a trial from the set again."
        confirmLabel="Mark as golden"
      />

      <ConfirmSheet
        open={adopting !== null}
        onClose={() => (actionBusy ? undefined : setAdopting(null))}
        onConfirm={confirmAdopt}
        title={`Adopt ${adoptLabel} as the default?`}
        body="Every new photo-mode video will render with this engine. You can change it again here or in Connections → RunPod."
        confirmLabel="Adopt"
        busy={actionBusy}
      />
    </div>
  );
}
