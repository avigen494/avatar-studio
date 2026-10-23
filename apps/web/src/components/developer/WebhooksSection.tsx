"use client";

import {
  Copy,
  Eye,
  EyeOff,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Input } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { copyText, useApi } from "@/lib/hooks";
import type { DeliveryOut, WebhookIn, WebhookOut } from "@/lib/types";
import { Snippet } from "./DevelopersScreen";

const VERIFY_SNIPPET = `import hmac, hashlib, time
def verify(secret, raw_body: bytes, header: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300: return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])`;

export function WebhooksSection() {
  const { toast } = useToast();
  const hooks = useApi(() => api.developer.webhooks(), ["webhooks"]);
  const events = useApi(() => api.developer.events(), ["webhook-events"]);
  const [editing, setEditing] = useState<WebhookOut | "new" | null>(null);
  const [deleting, setDeleting] = useState<WebhookOut | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookOut | null>(null);
  const [testResult, setTestResult] = useState<Record<string, DeliveryOut>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function replace(w: WebhookOut) {
    hooks.setData((list) => list?.map((x) => (x.id === w.id ? w : x)));
  }

  async function setActive(w: WebhookOut, active: boolean) {
    setBusy(`active:${w.id}`);
    try {
      replace(
        await api.developer.updateWebhook(w.id, {
          url: w.url,
          events: w.events,
          description: w.description,
          active,
        }),
      );
      toast(
        active
          ? "Webhook resumed."
          : "Webhook paused. Deliveries wait until you resume it.",
        "success",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(w: WebhookOut) {
    setBusy(`test:${w.id}`);
    try {
      const d = await api.developer.testWebhook(w.id);
      setTestResult((m) => ({ ...m, [w.id]: d }));
      toast(
        d.status === "delivered"
          ? `Delivered: HTTP ${d.last_status_code}.`
          : `Not delivered: ${d.last_error || "no answer"}.`,
        d.status === "delivered" ? "success" : "error",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(w: WebhookOut) {
    setBusy(`delete:${w.id}`);
    try {
      await api.developer.removeWebhook(w.id);
      hooks.setData((list) => list?.filter((x) => x.id !== w.id));
      setDeleting(null);
      toast("Webhook removed.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Webhooks</h2>
          <p className="text-sm text-muted">
            A signed JSON POST for each event. Return any 2xx quickly; retries
            at 1 min, 5 min, 30 min, 2 h, 12 h.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} />}
          onClick={() => setEditing("new")}
        >
          Add webhook
        </Button>
      </div>

      <Card className="divide-y divide-line p-0">
        {hooks.loading ? (
          <div className="p-4">
            <SkeletonText lines={2} />
          </div>
        ) : null}
        {hooks.error ? (
          <div className="p-4">
            <Notice tone="red">{errorMessage(hooks.error)}</Notice>
          </div>
        ) : null}
        {hooks.data && hooks.data.length === 0 ? (
          <p className="p-4 text-sm text-muted">
            No webhooks yet. Add one to hear about finished videos without
            polling.
          </p>
        ) : null}
        {hooks.data?.map((w) => (
          <div key={w.id} className="space-y-3 px-4 py-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg">
                <WebhookIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-all text-base font-semibold">{w.url}</p>
                <p className="text-xs text-muted">
                  {w.description ? `${w.description} · ` : ""}
                  {w.events.length === 0
                    ? "all events"
                    : `${w.events.length} ${w.events.length === 1 ? "event" : "events"}`}{" "}
                  · added {formatDate(w.created_at)}
                </p>
                {w.events.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e}>{e}</Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <Badge tone={w.active ? "green" : "neutral"}>
                {w.active ? "Active" : "Paused"}
              </Badge>
            </div>
            <SecretRow secret={w.secret} />
            <Toggle
              checked={w.active}
              onChange={(v) => setActive(w, v)}
              label={<span className="text-sm">Active</span>}
              disabled={busy === `active:${w.id}`}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<Send size={14} />}
                loading={busy === `test:${w.id}`}
                onClick={() => sendTest(w)}
              >
                Send test
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<History size={14} />}
                onClick={() => setDeliveriesFor(w)}
              >
                Deliveries
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Pencil size={14} />}
                onClick={() => setEditing(w)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                onClick={() => setDeleting(w)}
              >
                Remove
              </Button>
            </div>
            {testResult[w.id] ? <DeliveryResult d={testResult[w.id]} /> : null}
          </div>
        ))}
      </Card>

      <Card className="mt-3 space-y-2">
        <p className="text-base font-semibold">Verify a delivery</p>
        <p className="text-sm text-muted">
          Headers:{" "}
          <code className="font-mono text-xs">X-AvatarStudio-Event</code>,{" "}
          <code className="font-mono text-xs">X-AvatarStudio-Delivery</code>,{" "}
          <code className="font-mono text-xs">
            {events.data?.signature_header ?? "X-AvatarStudio-Signature"}:
            t=&lt;unix&gt;,v1=&lt;hex&gt;
          </code>
          . {events.data?.how_to_verify}
        </p>
        <Snippet body={VERIFY_SNIPPET} />
      </Card>

      {editing !== null ? (
        <WebhookSheet
          key={editing === "new" ? "new" : editing.id}
          hook={editing === "new" ? null : editing}
          events={events.data?.events ?? []}
          onClose={() => setEditing(null)}
          onSaved={(w, isNew) => {
            if (isNew) hooks.setData((list) => [...(list ?? []), w]);
            else replace(w);
            setEditing(null);
            toast(
              isNew
                ? "Webhook added. Send a test to check it."
                : "Webhook saved.",
              "success",
            );
          }}
        />
      ) : null}
      <ConfirmSheet
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove(deleting)}
        busy={Boolean(deleting) && busy === `delete:${deleting?.id}`}
        tone="danger"
        title="Remove this webhook?"
        confirmLabel="Remove"
        body={
          <span className="break-all">
            {deleting?.url}. Pending deliveries are marked failed.
          </span>
        }
      />
      {deliveriesFor ? (
        <DeliveriesSheet
          hook={deliveriesFor}
          onClose={() => setDeliveriesFor(null)}
        />
      ) : null}
    </section>
  );
}

function SecretRow({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 font-mono text-xs">
        {show ? secret : `${secret.slice(0, 6)}${"•".repeat(16)}`}
      </code>
      <button
        type="button"
        aria-label={show ? "Hide secret" : "Show secret"}
        onClick={() => setShow((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <button
        type="button"
        aria-label="Copy secret"
        onClick={async () =>
          toast(
            (await copyText(secret)) ? "Secret copied." : "Could not copy.",
            "info",
          )
        }
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
      >
        <Copy size={16} />
      </button>
    </div>
  );
}

function deliveryTone(status: string): "green" | "amber" | "red" | "neutral" {
  if (status === "delivered") return "green";
  if (status === "pending") return "amber";
  if (status === "failed") return "red";
  return "neutral";
}

function DeliveryResult({ d }: { d: DeliveryOut }) {
  return (
    <Notice tone={deliveryTone(d.status)}>
      <span className="font-semibold">test.ping</span> · {d.status}
      {d.last_status_code ? ` · HTTP ${d.last_status_code}` : ""} · {d.attempts}{" "}
      {d.attempts === 1 ? "attempt" : "attempts"}
      {d.last_error ? (
        <span className="block break-words text-xs">{d.last_error}</span>
      ) : null}
    </Notice>
  );
}

function WebhookSheet({
  hook,
  events,
  onClose,
  onSaved,
}: {
  hook: WebhookOut | null;
  events: string[];
  onClose: () => void;
  onSaved: (w: WebhookOut, isNew: boolean) => void;
}) {
  const [url, setUrl] = useState(hook?.url ?? "");
  const [description, setDescription] = useState(hook?.description ?? "");
  const [picked, setPicked] = useState<string[]>(hook?.events ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(e: string) {
    setPicked((list) =>
      list.includes(e) ? list.filter((x) => x !== e) : [...list, e],
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) {
      setError("Enter a full URL starting with https://");
      return;
    }
    setBusy(true);
    setError(null);
    const body: WebhookIn = {
      url: u,
      events: picked,
      description: description.trim(),
      active: hook?.active ?? true,
    };
    try {
      const saved = hook
        ? await api.developer.updateWebhook(hook.id, body)
        : await api.developer.createWebhook(body);
      onSaved(saved, !hook);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={hook ? "Edit webhook" : "Add webhook"}
      description="We POST JSON to this URL and sign it with the webhook's secret."
      full
    >
      <form onSubmit={submit} className="space-y-4 pt-1">
        <Input
          label="URL"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com/avatar-studio"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error}
          autoFocus={!hook}
        />
        <Input
          label="Description (optional)"
          placeholder="n8n · order videos"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-muted">Events</legend>
          <p className="text-xs text-muted">
            Leave all unticked to receive every event.
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {events.map((ev) => {
              const checked = picked.includes(ev);
              return (
                <label
                  key={ev}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 ${checked ? "border-accent bg-accent-soft" : "border-line"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(ev)}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                  <span className="font-mono text-sm">{ev}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit" full loading={busy}>
          {hook ? "Save" : "Add webhook"}
        </Button>
      </form>
    </Sheet>
  );
}

function DeliveriesSheet({
  hook,
  onClose,
}: {
  hook: WebhookOut;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const list = useApi(
    () => api.developer.deliveries(hook.id),
    ["deliveries", hook.id],
    {
      pollWhile: (rows) => rows.some((d) => d.status === "pending"),
      pollMs: 4000,
    },
  );
  const [replaying, setReplaying] = useState<string | null>(null);
  const [openPayload, setOpenPayload] = useState<string | null>(null);

  async function replay(d: DeliveryOut) {
    setReplaying(d.id);
    try {
      const updated = await api.developer.replay(d.id);
      list.setData((rows) =>
        rows?.map((x) => (x.id === updated.id ? updated : x)),
      );
      toast(
        updated.status === "delivered"
          ? `Delivered: HTTP ${updated.last_status_code}.`
          : `Still not delivered: ${updated.last_error || "no answer"}.`,
        updated.status === "delivered" ? "success" : "error",
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setReplaying(null);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Deliveries"
      description={hook.url}
      full
    >
      <div className="space-y-2 pt-1">
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} />}
            loading={list.refreshing}
            onClick={() => list.refetch()}
          >
            Refresh
          </Button>
        </div>
        {list.loading ? <SkeletonText lines={3} /> : null}
        {list.error ? (
          <Notice tone="red">{errorMessage(list.error)}</Notice>
        ) : null}
        {list.data && list.data.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing delivered yet. Send a test, or wait for a video to finish.
          </p>
        ) : null}
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {list.data?.map((d) => (
            <li key={d.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">
                  {d.event}
                </span>
                <Badge tone={deliveryTone(d.status)}>{d.status}</Badge>
              </div>
              <p className="text-xs text-muted">
                {formatDate(d.created_at, true)} · {d.attempts}{" "}
                {d.attempts === 1 ? "attempt" : "attempts"}
                {d.last_status_code ? ` · HTTP ${d.last_status_code}` : ""}
                {d.delivered_at
                  ? ` · delivered ${formatDate(d.delivered_at, true)}`
                  : d.next_attempt_at && d.status === "pending"
                    ? ` · next try ${formatDate(d.next_attempt_at, true)}`
                    : ""}
              </p>
              {d.last_error ? (
                <p className="break-words text-xs text-red">{d.last_error}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw size={14} />}
                  loading={replaying === d.id}
                  onClick={() => replay(d)}
                >
                  Replay
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setOpenPayload(openPayload === d.id ? null : d.id)
                  }
                >
                  {openPayload === d.id ? "Hide payload" : "Payload"}
                </Button>
              </div>
              {openPayload === d.id ? (
                <Snippet body={JSON.stringify(d.payload, null, 2)} />
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
