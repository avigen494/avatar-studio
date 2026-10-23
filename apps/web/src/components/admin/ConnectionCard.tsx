"use client";

import { CheckCircle2, Eye, EyeOff, ExternalLink, XCircle } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice } from "@/components/ui/Card";
import { inputClass, Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { api } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { loadPublicConfig } from "@/lib/public-config";
import type { ConnectionField, ConnectionOut } from "@/lib/types";

interface TestResult {
  ok: boolean;
  message: string;
  at: string;
}

type Status = { label: string; tone: "green" | "neutral" | "accent" };

/** Connected / Not connected / Using .env, from `connected` and where the values come from. */
export function connectionStatus(svc: ConnectionOut): Status {
  if (!svc.connected) return { label: "Not connected", tone: "neutral" };
  const set = svc.fields.filter((f) => f.is_set);
  const fromDb = set.some((f) => f.source === "db");
  if (!fromDb && set.some((f) => f.source === "env")) return { label: "Using .env", tone: "accent" };
  return { label: "Connected", tone: "green" };
}

function initialValues(fields: ConnectionField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.key] = f.value ?? "";
  return out;
}

function initialTest(svc: ConnectionOut): TestResult | null {
  if (svc.last_test_ok === null || svc.last_test_ok === undefined || !svc.last_test_message) return null;
  return { ok: svc.last_test_ok, message: svc.last_test_message, at: svc.last_tested_at ?? "" };
}

/** Save then test, except R2 while the storage backend is still local (nothing to test). */
function shouldAutoTest(svc: ConnectionOut, values: Record<string, string>): boolean {
  if (svc.id === "r2" && (values["storage_backend"] ?? "local") !== "r2") return false;
  return true;
}

export function ConnectionCard({ svc, onSaved }: { svc: ConnectionOut; onSaved: (s: ConnectionOut) => void }) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(svc.fields));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(() => initialTest(svc));
  const status = connectionStatus(svc);

  const dirty = useMemo(() => svc.fields.some((f) => (values[f.key] ?? "") !== (f.value ?? "")), [svc.fields, values]);

  async function runTest(): Promise<boolean> {
    setTesting(true);
    try {
      const r = await api.admin.test(svc.id);
      setTest({ ok: r.ok, message: r.message, at: new Date().toISOString() });
      return r.ok;
    } catch (e) {
      setTest({ ok: false, message: errorMessage(e), at: new Date().toISOString() });
      return false;
    } finally {
      setTesting(false);
      void loadPublicConfig(true);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const f of svc.fields) body[f.key] = values[f.key] ?? "";
      const updated = await api.admin.save(svc.id, { values: body });
      onSaved(updated);
      setValues(initialValues(updated.fields));
      toast(`${svc.name} saved.`, "success");
      void loadPublicConfig(true);
      if (shouldAutoTest(updated, initialValues(updated.fields))) await runTest();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" aria-labelledby={`conn-${svc.id}`}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`conn-${svc.id}`} className="text-lg font-bold">
            {svc.name}
          </h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="text-sm text-muted">{svc.purpose}</p>
        <p className="text-sm">
          <span className="text-muted">Required for: </span>
          {svc.required_for}
        </p>
        <a href={svc.docs_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
          Get a key
          <ExternalLink size={14} aria-hidden />
        </a>
      </header>

      {svc.warning ? <Notice tone="amber">{svc.warning}</Notice> : null}

      <div className="space-y-3">
        {svc.fields.map((f) => (
          <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
        ))}
      </div>

      {test ? (
        <div
          role="status"
          className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${test.ok ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}
        >
          {test.ok ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden /> : <XCircle size={18} className="mt-0.5 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="block break-words">{test.message}</span>
            {test.at ? <span className="block text-xs opacity-80">Tested {formatDate(test.at, true)}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={save} disabled={!dirty} loading={saving} className="w-full sm:w-auto">
          Save
        </Button>
        <Button variant="secondary" onClick={runTest} loading={testing} disabled={saving} className="w-full sm:w-auto">
          Test
        </Button>
      </div>
    </Card>
  );
}

function FieldInput({ field, value, onChange }: { field: ConnectionField; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const sourceNote =
    field.source === "env" ? "From the server's .env" : field.source === "default" ? "Default value" : field.source === "db" ? "Saved here" : undefined;
  const hint = [field.help, sourceNote].filter(Boolean).join(" · ");

  if (field.choices && field.choices.length > 0) {
    return (
      <Select label={field.label} hint={hint || undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        {!field.choices.includes(value) ? <option value={value}>{value || "—"}</option> : null}
        {field.choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>
    );
  }

  if (field.secret) {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-semibold text-muted">
          {field.label}
        </label>
        <div className="relative">
          <input
            id={id}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || undefined}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hint ? `${id}-hint` : undefined}
            className={`${inputClass} pr-12 font-mono`}
          />
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide value" : "Show value"}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-xl text-muted hover:text-fg"
          >
            {shown ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted">
            {hint}
            {field.is_set ? " · Leave the masked value as it is to keep the saved key; clear it to remove." : ""}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-muted">
        {field.label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || undefined}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={inputClass}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
