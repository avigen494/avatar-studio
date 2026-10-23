"use client";

import { BookOpen, Copy, ExternalLink, Table } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/components/auth/MeProvider";
import { Button } from "@/components/ui/Button";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { API_URL } from "@/lib/api";
import { copyText } from "@/lib/hooks";
import { usePublicConfig } from "@/lib/public-config";
import { ApiKeysSection } from "./ApiKeysSection";
import { WebhooksSection } from "./WebhooksSection";

export function DevelopersScreen() {
  const { me } = useMe();
  const isAdmin = me?.workspace.role === "owner" || me?.workspace.role === "admin";
  return (
    <div className="space-y-6">
      <PageHeader title="Developers" subtitle="Make videos from n8n, Zapier or your own code. Keys and webhooks belong to this workspace." />
      {!me ? <SkeletonList count={3} /> : null}
      {me && !isAdmin ? <Notice tone="amber">Only owners and admins can manage API keys and webhooks. Ask an admin of {me.workspace.name}.</Notice> : null}
      {me && isAdmin ? (
        <>
          <QuickStart />
          <ApiKeysSection />
          <WebhooksSection />
        </>
      ) : null}
    </div>
  );
}

/** The curl snippets from docs/API.md with this API's host filled in. */
function QuickStart() {
  const { config } = usePublicConfig();
  const host = (config.api_base_url || API_URL).replace(/\/+$/, "");
  const snippets: { title: string; body: string }[] = [
    {
      title: "1. Create a draft (Idempotency-Key makes retries safe)",
      body: `curl -X POST ${host}/videos \\
  -H "Authorization: Bearer ask_live_XXXX" -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"identity_id":"<avatar id>","voice_id":"<voice id>","script":"Hi Priya, your order is on its way.","aspect":"9:16","language":"en"}'`,
    },
    {
      title: "2. Queue the render (credits are charged only on success)",
      body: `curl -X POST ${host}/videos/<id>/generate -H "Authorization: Bearer ask_live_XXXX"`,
    },
    {
      title: "3. Poll, or wait for the webhook",
      body: `curl ${host}/videos/<id> -H "Authorization: Bearer ask_live_XXXX"`,
    },
    {
      title: "Batch (up to 100)",
      body: `curl -X POST ${host}/videos/batch -H "Authorization: Bearer ask_live_XXXX" -H "Content-Type: application/json" \\
  -d '{"identity_id":"<avatar>","voice_id":"<voice>","generate":true,
       "items":[{"script":"Hi Aman…","title":"Aman","idempotency_key":"lead-1"},{"script":"Hi Neha…","title":"Neha","idempotency_key":"lead-2"}]}'`,
    },
  ];
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">Quick start</h2>
      <Card className="space-y-4">
        <p className="text-sm text-muted">
          Keys look like <code className="rounded bg-surface-2 px-1 font-mono text-xs">ask_live_…</code> and are sent as a bearer token. Scopes: <strong>read</strong> (list and fetch) and{" "}
          <strong>write</strong> (create, generate, cancel). Useful ids: <code className="font-mono text-xs">GET /identities</code>, <code className="font-mono text-xs">GET /voices</code>,{" "}
          <code className="font-mono text-xs">POST /videos/estimate</code>.
        </p>
        {snippets.map((s) => (
          <Snippet key={s.title} title={s.title} body={s.body} />
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(`${host}/docs`, "_blank", "noopener")}>
            Interactive API docs
          </Button>
          <Button variant="secondary" size="sm" href="/batch" icon={<Table size={14} />}>
            Batch from CSV
          </Button>
        </div>
        <p className="flex items-start gap-2 text-xs text-muted">
          <BookOpen size={14} className="mt-0.5 shrink-0" />
          <span>
            n8n and Zapier: an HTTP Request node with the bearer header for POST /videos and POST /videos/{"{id}"}/generate, and a Webhook trigger for video.succeeded. The output_url in the
            payload is a signed link valid for one hour. Limits: 100 items per batch, 10 webhooks per workspace, scripts up to 20,000 characters.{" "}
            <Link href="/settings/plan" className="font-semibold text-accent">
              API access is included in Pro and Team.
            </Link>
          </span>
        </p>
      </Card>
    </section>
  );
}

export function Snippet({ title, body }: { title?: string; body: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1">
      {title ? <p className="text-sm font-semibold">{title}</p> : null}
      <div className="relative">
        <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 pr-12 font-mono text-xs leading-relaxed">
          <code>{body}</code>
        </pre>
        <button
          type="button"
          aria-label="Copy"
          title="Copy"
          onClick={async () => toast((await copyText(body)) ? "Copied." : "Could not copy.", "info")}
          className="absolute right-1.5 top-1.5 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted hover:text-fg"
        >
          <Copy size={16} />
        </button>
      </div>
    </div>
  );
}
