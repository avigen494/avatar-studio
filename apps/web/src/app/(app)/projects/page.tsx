"use client";

import { Ellipsis, FolderOpen, FolderPlus, Search, Table, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, inputClass } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { VideoCard } from "@/components/video/VideoCard";
import { errorMessage } from "@/lib/api";
import { STATUS_FILTERS } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { useApi, useDebouncedValue } from "@/lib/hooks";
import type { ProjectOut, VideoOut } from "@/lib/types";

export default function ProjectsPage() {
  const projects = useApi(() => api.projects.list(), ["projects"]);
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query.trim(), 300);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<ProjectOut | null>(null);
  const [renaming, setRenaming] = useState<ProjectOut | null>(null);

  const list = projects.data ?? [];
  const current = list.find((p) => p.id === selected) ?? null;

  async function remove(p: ProjectOut) {
    if (!window.confirm(`Delete the project "${p.name}"? Its videos are kept and simply leave the folder.`)) return;
    try {
      await api.projects.remove(p.id);
      projects.setData((l) => (l ?? []).filter((x) => x.id !== p.id));
      if (selected === p.id) setSelected(null);
      setMenu(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        subtitle="Folders for your videos, with credits used per folder."
        right={
          <div className="flex gap-2">
            <Button variant="secondary" href="/batch" icon={<Table size={18} />}>
              Batch
            </Button>
            <Button variant="secondary" icon={<FolderPlus size={18} />} onClick={() => setCreating(true)}>
              New
            </Button>
          </div>
        }
      />

      {projects.error ? <Notice tone="red">{errorMessage(projects.error)}</Notice> : null}
      {projects.loading ? (
        <SkeletonList count={2} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FolderOpen size={28} />}
          title="No projects yet"
          body="Projects keep client work or campaigns together. Videos can live without one."
          action={
            <Button variant="secondary" onClick={() => setCreating(true)} icon={<FolderPlus size={18} />}>
              Create a project
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {list.map((p) => {
            const active = p.id === selected;
            return (
              <li key={p.id} className={`flex items-center gap-2 rounded-2xl border bg-surface p-2 pl-3 ${active ? "border-accent" : "border-line"}`}>
                <button type="button" onClick={() => setSelected(active ? null : p.id)} aria-pressed={active} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
                  <FolderOpen size={20} className={active ? "text-accent" : "text-muted"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">{p.name}</span>
                    <span className="block text-sm text-muted">
                      {p.video_count} {p.video_count === 1 ? "video" : "videos"} · {p.credits_used} credits
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Options for ${p.name}`}
                  onClick={() => setMenu(p)}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
                >
                  <Ellipsis size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section className="space-y-3">
        <SectionTitle
          right={
            current ? (
              <button type="button" onClick={() => setSelected(null)} className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
                <X size={14} /> All videos
              </button>
            ) : null
          }
        >
          {current ? `Videos in ${current.name}` : "All videos"}
        </SectionTitle>
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles and scripts"
            aria-label="Search videos"
            className={`${inputClass} pl-10`}
          />
        </div>
        <div className="rail" role="radiogroup" aria-label="Status">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.value} role="radio" active={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <VideoResults key={`${selected ?? ""}|${status}|${q}`} projectId={selected} status={status} q={q} />
      </section>

      <Sheet open={creating} onClose={() => setCreating(false)} title="New project">
        <ProjectForm
          submitLabel="Create"
          onSubmit={async (name) => {
            const p = await api.projects.create(name);
            projects.setData((l) => [p, ...(l ?? [])]);
            setCreating(false);
          }}
        />
      </Sheet>

      <Sheet open={Boolean(menu)} onClose={() => setMenu(null)} title={menu?.name}>
        {menu ? (
          <div className="space-y-2 pt-1">
            <Button
              variant="secondary"
              full
              onClick={() => {
                setRenaming(menu);
                setMenu(null);
              }}
            >
              Rename
            </Button>
            <Button variant="danger" full onClick={() => remove(menu)}>
              Delete project
            </Button>
          </div>
        ) : null}
      </Sheet>

      {renaming ? (
        <Sheet open onClose={() => setRenaming(null)} title="Rename project">
          <ProjectForm
            initial={renaming.name}
            submitLabel="Save"
            onSubmit={async (name) => {
              const p = await api.projects.rename(renaming.id, name);
              projects.setData((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, name: p.name } : x)));
              setRenaming(null);
            }}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

function ProjectForm({ initial = "", submitLabel, onSubmit }: { initial?: string; submitLabel: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the project a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4 pt-1">
      <Input label="Project name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus error={error} placeholder="Client name, campaign, course…" />
      <Button type="submit" full loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** Keyed by the filter set so "load more" pages reset when filters change. */
function VideoResults({ projectId, status, q }: { projectId: string | null; status: string; q: string }) {
  const first = useApi(() => api.videos.list({ project_id: projectId ?? undefined, status: status || undefined, q: q || undefined, limit: 30 }), [
    "videos",
    projectId,
    status,
    q,
  ]);
  const [more, setMore] = useState<VideoOut[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toast } = useToast();

  const nextCursor = cursor === undefined ? first.data?.next_cursor : cursor;
  const items = [...(first.data?.items ?? []), ...more];

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.videos.list({ project_id: projectId ?? undefined, status: status || undefined, q: q || undefined, cursor: nextCursor, limit: 30 });
      setMore((m) => [...m, ...page.items]);
      setCursor(page.next_cursor ?? null);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoadingMore(false);
    }
  }

  if (first.loading) return <SkeletonList count={3} />;
  if (first.error) return <Notice tone="red">{errorMessage(first.error)}</Notice>;
  if (items.length === 0) return <EmptyState title="No videos match" body={q ? "Try a different word." : "Videos you make will show up here."} />;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {items.map((v) => (
          <li key={v.id}>
            <VideoCard video={v} />
          </li>
        ))}
      </ul>
      {nextCursor ? (
        <Button variant="secondary" full loading={loadingMore} onClick={loadMore}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
