"use client";

import { BarChart3, Bell, ChevronRight, Code2, CreditCard, Download, FlaskConical, ImageIcon, LogOut, Plug, Plus, Table, Trash2, Users, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useMe } from "@/components/auth/MeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { Input, inputClass } from "@/components/ui/Field";
import { SkeletonList, SkeletonText } from "@/components/ui/Skeleton";
import { Toggle } from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";
import { FilePicker, useUploader } from "@/components/uploader/FilePicker";
import { useIsAdmin } from "@/lib/admin";
import { apiBlob, errorMessage, isLocalApi } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDate, inr, titleCase } from "@/lib/format";
import { downloadBlob, useApi } from "@/lib/hooks";
import type { CaptionStyle, GlossaryEntry, NotifyPrefs, WorkspaceOut } from "@/lib/types";

export default function SettingsPage() {
  const { me, loading, setMe, refetch } = useMe();
  const auth = useAuth();
  const { toast } = useToast();
  const members = useApi(() => api.workspace.members(), ["members"]);
  const credits = useApi(() => api.credits.get(), ["credits"]);
  const ledger = useApi(() => api.credits.ledger(100), ["ledger"]);
  const platform = useIsAdmin();
  const [savingLabel, setSavingLabel] = useState(false);
  const [granting, setGranting] = useState(false);

  if (loading || !me) {
    return (
      <div className="space-y-4">
        <SkeletonText lines={1} />
        <SkeletonList count={4} />
      </div>
    );
  }
  const ws = me.workspace;
  const isAdmin = ws.role === "owner" || ws.role === "admin";
  const free = ws.plan === "free";

  function applyWorkspace(updated: WorkspaceOut) {
    setMe((prev) => (prev ? { ...prev, workspace: { ...updated, role: prev.workspace.role } } : prev));
  }

  async function toggleAiLabel(v: boolean) {
    setSavingLabel(true);
    try {
      applyWorkspace(await api.workspace.patch({ ai_label_enabled: v }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSavingLabel(false);
    }
  }

  async function grant() {
    setGranting(true);
    try {
      await api.credits.devGrant(100);
      credits.refetch();
      ledger.refetch();
      refetch();
      toast("100 test credits added.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setGranting(false);
    }
  }

  async function downloadCsv() {
    try {
      downloadBlob(await apiBlob("/credits/ledger.csv"), "usage-ledger.csv");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      {platform.isAdmin ? (
        <Section title="Platform" description="Only the platform admin sees this.">
          <LinkRow href="/settings/connections" icon={<Plug size={20} />} label="Connections" body="API keys for voices, Claude, RunPod, storage and sign-in" />
          <LinkRow href="/settings/lab" icon={<FlaskConical size={20} />} label="Engine Lab" body="Stage 0 bake-off: compare avatar engines, score blind, adopt a default" />
          <LinkRow href="/settings/usage" icon={<BarChart3 size={20} />} label="Usage" body="Videos, success rate, cost per minute, paying workspaces" />
        </Section>
      ) : null}

      <Section title="Account">
        <Row label="Name" value={me.user.name || "—"} />
        <Row label="Email" value={me.user.email} />
        <Button variant="ghost" size="sm" icon={<LogOut size={16} />} onClick={() => auth.signOut()}>
          Sign out
        </Button>
      </Section>

      <Section title="Notifications" description="A WhatsApp message when a render finishes or fails.">
        <NotificationsEditor isPlatformAdmin={platform.isAdmin} />
      </Section>

      <Section title="Workspace">
        <WorkspaceName key={ws.id} name={ws.name} canEdit={isAdmin} onSaved={applyWorkspace} />
        <Row label="Plan" value={<Badge tone="accent">{titleCase(ws.plan)}</Badge>} />
        {me.workspaces.length > 1 ? <p className="text-xs text-muted">You belong to {me.workspaces.length} workspaces. Switch with the control in the header (phone) or side bar.</p> : null}
        <Toggle
          checked={ws.ai_label_enabled}
          onChange={toggleAiLabel}
          label="AI-assisted label"
          description="Shows an “AI-assisted” badge on your videos and share pages."
          disabled={free || !isAdmin || savingLabel}
          note={free ? "Always on for the Free plan. Upgrade to turn it off." : !isAdmin ? "Only owners and admins can change this." : undefined}
        />
        <Toggle
          checked={ws.watermark_enabled}
          onChange={() => {}}
          label="Watermark"
          description="“Made with Avatar Studio” on downloads and the share page."
          disabled
          note={free ? "Part of the Free plan." : "Off on paid plans."}
        />
      </Section>

      <Section
        title="Team"
        action={
          isAdmin ? (
            <Button size="sm" variant="secondary" href="/settings/team" icon={<Plus size={14} />}>
              Invite
            </Button>
          ) : undefined
        }
      >
        <LinkRow
          href="/settings/team"
          icon={<Users size={20} />}
          label="Members, roles and invites"
          body={members.data ? `${members.data.length} ${members.data.length === 1 ? "member" : "members"} · owner, admin, editor, viewer` : "Owner, admin, editor, viewer"}
        />
        {members.loading ? <SkeletonText lines={2} /> : null}
        {members.data?.slice(0, 5).map((m) => (
          <Row key={m.user.id} label={m.user.name || m.user.email} hint={m.user.name ? m.user.email : undefined} value={<Badge>{titleCase(m.role)}</Badge>} />
        ))}
        {members.data && members.data.length > 5 ? <p className="text-xs text-muted">And {members.data.length - 5} more under Team.</p> : null}
      </Section>

      <Section title="Brand kit" description="Your logo and colour on every video you make.">
        <BrandKitEditor key={ws.id} workspace={ws} canEdit={isAdmin} onSaved={applyWorkspace} />
      </Section>

      <Section title="Glossary" description="Words the voice should say a certain way: names, brands, abbreviations. Captions keep the original spelling.">
        <GlossaryEditor key={ws.id} initial={ws.glossary} canEdit={isAdmin} onSaved={applyWorkspace} />
      </Section>

      <Section title="Developers" description="Generate videos from n8n, Zapier or your own code.">
        <LinkRow href="/settings/developers" icon={<Code2 size={20} />} label="API keys & webhooks" body="Scoped keys, signed webhooks with retries and replay, quick-start snippets" />
        <LinkRow href="/batch" icon={<Table size={20} />} label="Batch from CSV" body="Up to 100 personalised videos from one spreadsheet" />
      </Section>

      <Section title="Plan & credits" id="credits">
        {credits.loading ? (
          <SkeletonText lines={2} />
        ) : credits.data ? (
          <>
            <p className="text-3xl font-bold tabular-nums">
              {credits.data.balance} <span className="text-base font-medium text-muted">credits</span>
            </p>
            <p className="text-sm text-muted">
              1 credit = {inr(credits.data.price_per_credit_inr)} · free previews up to {credits.data.free_preview_seconds} s · charged only when a video succeeds.
            </p>
          </>
        ) : null}
        <LinkRow href="/settings/plan" icon={<CreditCard size={20} />} label="Plan & credits" body={`${titleCase(ws.plan)} plan · change plan, top up, extra seats, invoices`} />
        {isLocalApi && isAdmin ? (
          <Button variant="secondary" size="sm" loading={granting} onClick={grant}>
            Add 100 test credits
          </Button>
        ) : null}
      </Section>

      <Section
        title="Usage ledger"
        action={
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={downloadCsv}>
            Download CSV
          </Button>
        }
      >
        {ledger.loading ? <SkeletonText lines={4} /> : null}
        {ledger.error ? <Notice tone="red">{errorMessage(ledger.error)}</Notice> : null}
        {ledger.data && ledger.data.length === 0 ? <p className="text-sm text-muted">Nothing yet. Successful renders and top-ups appear here.</p> : null}
        {ledger.data && ledger.data.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">What</th>
                  <th className="py-2 pr-3 text-right font-semibold">Credits</th>
                </tr>
              </thead>
              <tbody>
                {ledger.data.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{formatDate(e.created_at, true)}</td>
                    <td className="py-2 pr-3">
                      <span className="block">{e.note || titleCase(e.kind)}</span>
                      <span className="block text-xs text-muted">{titleCase(e.kind)}</span>
                    </td>
                    <td className={`py-2 text-right font-semibold tabular-nums ${e.amount < 0 ? "text-red" : "text-green"}`}>
                      {e.amount > 0 ? "+" : ""}
                      {e.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({ title, description, action, children, id }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      <Card className="space-y-3">{children}</Card>
    </section>
  );
}

function LinkRow({ href, icon, label, body }: { href: string; icon: React.ReactNode; label: string; body: string }) {
  return (
    <Link href={href} className="-mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 py-1 hover:bg-surface-2">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{label}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
      <ChevronRight className="shrink-0 text-muted" />
    </Link>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <div className="min-w-0">
        <p className="truncate text-base">{label}</p>
        {hint ? <p className="truncate text-xs text-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0 text-sm text-muted">{value}</div>
    </div>
  );
}

function WorkspaceName({ name, canEdit, onSaved }: { name: string; canEdit: boolean; onSaved: (w: WorkspaceOut) => void }) {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const dirty = value.trim() !== name && value.trim().length > 0;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    try {
      onSaved(await api.workspace.patch({ name: value.trim() }));
      toast("Workspace renamed.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="flex items-end gap-2">
      <Input label="Workspace name" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} disabled={!canEdit} containerClassName="flex-1" />
      {canEdit ? (
        <Button type="submit" variant="secondary" disabled={!dirty} loading={busy}>
          Save
        </Button>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* v3: WhatsApp notifications (GET/PUT /me/notifications)               */
/* ------------------------------------------------------------------ */

/** E.164 with the country code: +919876543210. */
const E164 = /^\+[1-9]\d{7,14}$/;

function NotificationsEditor({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const prefs = useApi(() => api.notifications.get(), ["notifications"]);
  if (prefs.loading) return <SkeletonText lines={3} />;
  if (prefs.error || !prefs.data) return <Notice tone="red">{errorMessage(prefs.error, "Notification settings could not be loaded.")}</Notice>;
  return <NotificationsForm key={`${prefs.data.phone ?? ""}:${prefs.data.notify_whatsapp}`} initial={prefs.data} isPlatformAdmin={isPlatformAdmin} onSaved={(p) => prefs.setData(p)} />;
}

function NotificationsForm({ initial, isPlatformAdmin, onSaved }: { initial: NotifyPrefs; isPlatformAdmin: boolean; onSaved: (p: NotifyPrefs) => void }) {
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initial.notify_whatsapp);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const cleaned = phone.replace(/[\s()-]/g, "");
  const valid = E164.test(cleaned);
  const empty = cleaned.length === 0;
  const wantsWhatsapp = whatsapp && valid;
  const dirty = (empty ? null : cleaned) !== (initial.phone ?? null) || wantsWhatsapp !== initial.notify_whatsapp;
  const phoneError = !empty && !valid ? "Use the international format with the country code, like +919876543210." : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!empty && !valid) return;
    setBusy(true);
    try {
      onSaved(await api.notifications.set({ phone: empty ? null : cleaned, notify_whatsapp: wantsWhatsapp }));
      toast("Notification settings saved.", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <Input
        label="WhatsApp number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+919876543210"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        maxLength={20}
        hint="Start with + and your country code (+91 for India)."
        error={phoneError}
      />
      <Toggle
        checked={wantsWhatsapp}
        onChange={setWhatsapp}
        label={
          <span className="inline-flex items-center gap-2">
            <Bell size={16} /> WhatsApp messages
          </span>
        }
        description="One message when a render finishes or fails."
        disabled={!valid}
        note="Enter a valid number first."
      />
      <p className="text-xs text-muted">We send one message when a render finishes or fails. Standard WhatsApp rules apply.</p>
      {isPlatformAdmin ? (
        <Notice tone="neutral">
          WhatsApp is not connected on this server yet; messages will start once an admin connects it in{" "}
          <Link href="/settings/connections#whatsapp" className="font-semibold text-accent">
            Connections
          </Link>
          .
        </Notice>
      ) : null}
      <Button type="submit" variant="secondary" size="sm" disabled={!dirty || Boolean(phoneError)} loading={busy}>
        Save
      </Button>
    </form>
  );
}

const DEFAULT_COLOR = "#0f766e";
const HEX = /^#[0-9a-fA-F]{6}$/;

function BrandKitEditor({ workspace, canEdit, onSaved }: { workspace: WorkspaceOut; canEdit: boolean; onSaved: (w: WorkspaceOut) => void }) {
  const kit = workspace.brand_kit ?? {};
  const initialColor = typeof kit.primary_color === "string" && HEX.test(kit.primary_color) ? kit.primary_color.toLowerCase() : DEFAULT_COLOR;
  const initialCaption: CaptionStyle = kit.caption_style === "brand" ? "brand" : "default";
  const initialShowLogo = Boolean(kit.show_logo);
  const [hex, setHex] = useState(initialColor);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(initialCaption);
  const [showLogo, setShowLogo] = useState(initialShowLogo);
  const [logoBusy, setLogoBusy] = useState<"upload" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);
  const uploader = useUploader();
  const { toast } = useToast();
  const free = workspace.plan === "free";
  const logoUrl = workspace.brand_logo_url ?? null;
  const hasLogo = Boolean(kit.logo_key);

  const validHex = HEX.test(hex);
  const color = validHex ? hex.toLowerCase() : initialColor;
  const dirty = color !== initialColor || captionStyle !== initialCaption || showLogo !== initialShowLogo;

  async function save() {
    if (!validHex) {
      toast("The colour must look like #14b8a6.", "error");
      return;
    }
    setBusy(true);
    try {
      onSaved(await api.workspace.patch({ brand_kit: { primary_color: color, caption_style: captionStyle, show_logo: showLogo } }));
      toast("Brand kit saved.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy("upload");
    try {
      const key = await uploader.upload({ purpose: "brand", file, filename: file.name, contentType: file.type || "image/png" });
      if (!key) return;
      onSaved(await api.workspace.patch({ brand_kit: { logo_key: key } }));
      toast("Logo saved.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLogoBusy(null);
    }
  }

  async function removeLogo() {
    setLogoBusy("remove");
    try {
      onSaved(await api.workspace.patch({ brand_kit: { logo_key: null, show_logo: false } }));
      setShowLogo(false);
      toast("Logo removed.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLogoBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
          {logoUrl ? <Image src={logoUrl} alt="Your logo" fill sizes="64px" unoptimized className="object-contain p-1" /> : <ImageIcon className="text-muted" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-muted">Logo</p>
          <p className="text-sm">{hasLogo ? "PNG with a transparent background looks best." : "No logo yet. PNG, JPG, SVG or WebP."}</p>
          {uploader.error ? <p className="text-sm text-red">{uploader.error}</p> : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 flex-col gap-1.5">
            <FilePicker accept="image/png,image/jpeg,image/svg+xml,image/webp" size="sm" variant="secondary" loading={logoBusy === "upload"} disabled={logoBusy !== null} onFile={uploadLogo}>
              {hasLogo ? "Replace" : "Upload"}
            </FilePicker>
            {hasLogo ? (
              <Button size="sm" variant="ghost" icon={<X size={14} />} loading={logoBusy === "remove"} disabled={logoBusy !== null} onClick={removeLogo}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Colour */}
      <div className="space-y-1.5">
        <label htmlFor="brand-color" className="block text-sm font-semibold text-muted">
          Primary colour
        </label>
        <div className="flex items-center gap-2">
          <input
            id="brand-color"
            type="color"
            value={color}
            onChange={(e) => setHex(e.target.value)}
            disabled={!canEdit}
            className="h-12 w-14 cursor-pointer rounded-xl border border-line bg-surface p-1"
          />
          <input
            aria-label="Primary colour as hex"
            value={hex}
            onChange={(e) => setHex(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
            disabled={!canEdit}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!validHex || undefined}
            className={`${inputClass} font-mono uppercase ${validHex ? "" : "border-red"}`}
          />
        </div>
        {!validHex ? <p className="text-xs text-red">Use six hex digits, like #14B8A6.</p> : null}
      </div>

      {/* Caption style */}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-semibold text-muted">Caption colour</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "default", label: "Default white", swatch: "#ffffff" },
              { value: "brand", label: "Brand colour", swatch: color },
            ] as const
          ).map((o) => {
            const active = captionStyle === o.value;
            return (
              <label
                key={o.value}
                className={[
                  "flex cursor-pointer items-center gap-2 rounded-xl border p-2.5",
                  active ? "border-accent bg-accent-soft" : "border-line",
                  canEdit ? "" : "cursor-not-allowed opacity-60",
                ].join(" ")}
              >
                <input type="radio" name="caption-style" className="sr-only" checked={active} disabled={!canEdit} onChange={() => setCaptionStyle(o.value)} />
                <span className="inline-flex h-8 w-12 shrink-0 items-center justify-center rounded-md bg-black text-[11px] font-bold" style={{ color: o.swatch }} aria-hidden>
                  Abc
                </span>
                <span className="text-sm font-medium">{o.label}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">Burned-in captions use this colour. The SRT file is unaffected.</p>
      </fieldset>

      {/* Logo on videos */}
      <Toggle
        checked={showLogo}
        onChange={setShowLogo}
        label="Show logo on videos"
        description="Burned in at the bottom-right of every video."
        disabled={!canEdit || !hasLogo}
        note={!hasLogo ? "Upload a logo first." : undefined}
      />
      <p className="-mt-2 text-xs text-muted">
        {free ? "On the Free plan videos carry the Avatar Studio watermark instead; your logo appears once you upgrade." : "Paid plan: your logo replaces the watermark."}
      </p>

      {canEdit ? (
        <Button variant="secondary" disabled={!dirty || !validHex} loading={busy} onClick={save}>
          Save brand kit
        </Button>
      ) : null}
    </div>
  );
}

function GlossaryEditor({ initial, canEdit, onSaved }: { initial: GlossaryEntry[]; canEdit: boolean; onSaved: (w: WorkspaceOut) => void }) {
  const [rows, setRows] = useState<GlossaryEntry[]>(() =>
    (initial ?? []).map((g) => ({ ...g, term: String(g.term ?? ""), pronunciation: String(g.pronunciation ?? "") })),
  );
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const clean = rows.filter((r) => r.term.trim() && r.pronunciation.trim()).map((r) => ({ term: r.term.trim(), pronunciation: r.pronunciation.trim() }));
  const incomplete = rows.some((r) => Boolean(r.term.trim()) !== Boolean(r.pronunciation.trim()));
  const dirty = JSON.stringify(clean) !== JSON.stringify((initial ?? []).map((g) => ({ term: String(g.term ?? ""), pronunciation: String(g.pronunciation ?? "") })));

  async function save() {
    setBusy(true);
    try {
      const updated = await api.workspace.patch({ glossary: clean });
      onSaved(updated);
      setRows(updated.glossary.map((g) => ({ ...g, term: String(g.term ?? ""), pronunciation: String(g.pronunciation ?? "") })));
      toast("Glossary saved.", "success");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Example: “IYA” is spoken as “eye-why-ay”. The voice reads the right column; captions keep the original spelling.
      </p>
      {rows.length === 0 ? <p className="text-sm text-muted">No terms yet.</p> : null}
      {rows.length > 0 ? (
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Term</span>
          <span>Spoken as</span>
          <span className="w-10" />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            aria-label={`Term ${i + 1}`}
            value={r.term}
            placeholder="IYA"
            maxLength={80}
            disabled={!canEdit}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, term: e.target.value } : x)))}
            className={inputClass}
          />
          <input
            aria-label={`Spoken as ${i + 1}`}
            value={r.pronunciation}
            placeholder="eye-why-ay"
            maxLength={120}
            disabled={!canEdit}
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, pronunciation: e.target.value } : x)))}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={`Remove ${r.term || "row"}`}
            disabled={!canEdit}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="inline-flex h-12 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface-2 disabled:opacity-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      {canEdit ? (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setRows([...rows, { term: "", pronunciation: "" }])}>
            Add term
          </Button>
          <Button size="sm" disabled={!dirty} loading={busy} onClick={save}>
            Save glossary
          </Button>
        </div>
      ) : null}
      {incomplete ? <p className="text-xs text-amber">Rows need both a term and how to say it; half-filled rows are not saved.</p> : null}
    </div>
  );
}
