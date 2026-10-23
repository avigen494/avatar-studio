"use client";

import { useMemo } from "react";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { SkeletonList, SkeletonText } from "@/components/ui/Skeleton";
import { useIsAdmin } from "@/lib/admin";
import { errorMessage } from "@/lib/api";
import { CONNECTION_ORDER } from "@/lib/constants";
import { api } from "@/lib/endpoints";
import { useApi } from "@/lib/hooks";
import { usePublicConfig } from "@/lib/public-config";
import type { ConnectionOut } from "@/lib/types";
import { ConnectionCard } from "./ConnectionCard";

export function ConnectionsScreen() {
  const admin = useIsAdmin();
  const list = useApi(() => api.admin.connections(), ["connections"], { enabled: admin.isAdmin });

  const ordered = useMemo(() => {
    const items = list.data ?? [];
    const rank = (id: string) => {
      const i = (CONNECTION_ORDER as readonly string[]).indexOf(id);
      return i === -1 ? CONNECTION_ORDER.length : i;
    };
    return [...items].sort((a, b) => rank(a.id) - rank(b.id));
  }, [list.data]);

  function onSaved(updated: ConnectionOut) {
    list.setData((prev) => prev?.map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Connections" subtitle="Keys for the services behind voices, scripts, renders, storage and sign-in. Saved on the server, never in the browser." />

      <Overview />

      {!admin.known ? <SkeletonList count={3} /> : null}
      {admin.known && !admin.isAdmin ? <Notice tone="amber">Only the platform admin can change connections.</Notice> : null}

      {admin.isAdmin ? (
        <>
          {list.loading ? <SkeletonList count={4} /> : null}
          {list.error ? <Notice tone="red">{errorMessage(list.error)}</Notice> : null}
          <div className="space-y-4">
            {ordered.map((svc) => (
              <ConnectionCard key={svc.id} svc={svc} onSaved={onSaved} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Four tiles showing what is live right now, from GET /config/public. */
function Overview() {
  const { config, loaded, fallback } = usePublicConfig();
  if (!loaded) {
    return (
      <Card>
        <SkeletonText lines={2} />
      </Card>
    );
  }
  const tiles: { label: string; value: string; on: boolean }[] = [
    {
      label: "Voice engines",
      value: config.voice_engines.length ? config.voice_engines.map(prettyEngine).join(", ") : "mock",
      on: config.voice_engines.length > 0,
    },
    { label: "Render engine", value: config.avatar_engine, on: config.avatar_engine === "runpod" },
    { label: "Script helper", value: config.script_helper ? "on" : "off", on: config.script_helper },
    { label: "Sign-in", value: config.auth_mode, on: config.auth_mode === "clerk" },
  ];
  return (
    <section aria-label="Live right now" className="space-y-2">
      <h2 className="text-base font-semibold text-muted">Live right now</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t.label}</p>
            <p className="mt-1 flex items-center gap-2 text-base font-bold">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${t.on ? "bg-green" : "bg-line"}`} aria-hidden />
              <span className="truncate">{t.value}</span>
            </p>
          </div>
        ))}
      </div>
      {fallback ? <p className="text-xs text-muted">Could not reach the server for the live config; showing the build-time defaults.</p> : null}
    </section>
  );
}

function prettyEngine(id: string): string {
  switch (id) {
    case "elevenlabs":
      return "ElevenLabs";
    case "sarvam":
      return "Sarvam";
    default:
      return id;
  }
}
