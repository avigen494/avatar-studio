"use client";

import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { errorMessage } from "@/lib/api";
import { writeBillingDetails, type BillingDetails } from "@/lib/billing";
import { money } from "@/lib/format";
import type { CheckoutOut } from "@/lib/types";

export interface MockPayment {
  intent: CheckoutOut;
  label: string;
  amount: number;
  currency: string;
}

/** Dev payments: confirms instantly through POST /billing/confirm with the mock payload. */
export function MockPaySheet({
  payment,
  onClose,
  onConfirm,
}: {
  payment: MockPayment | null;
  onClose: () => void;
  onConfirm: (m: MockPayment) => Promise<void>;
}) {
  if (!payment) return null;
  const key =
    payment.intent.provider_subscription_id ??
    payment.intent.provider_order_id ??
    payment.label;
  return (
    <MockPayBody
      key={key}
      payment={payment}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function MockPayBody({
  payment,
  onClose,
  onConfirm,
}: {
  payment: MockPayment;
  onClose: () => void;
  onConfirm: (m: MockPayment) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(payment);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Test payment"
      description="No payment provider is connected, so this build confirms payments instantly. No money moves."
      locked={busy}
      footer={
        <Button size="lg" full loading={busy} onClick={pay}>
          Pay {money(payment.amount, payment.currency)} (test)
        </Button>
      }
    >
      {
        <div className="space-y-3 pt-1">
          <div className="rounded-xl bg-surface-2 p-3">
            <p className="text-sm text-muted">You are buying</p>
            <p className="text-lg font-bold">{payment.label}</p>
            <p className="text-sm text-muted">
              {money(payment.amount, payment.currency)}
              {payment.currency === "INR" ? " including 18% GST" : ""}
            </p>
          </div>
          {error ? <Notice tone="red">{error}</Notice> : null}
          <p className="flex items-start gap-2 text-xs text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" /> In production
            this is the Razorpay (UPI, cards) or Stripe window. The platform
            admin connects a provider under Settings → Connections.
          </p>
        </div>
      }
    </Sheet>
  );
}

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Buyer name, GSTIN and address for the invoice; kept in this browser only. */
export function BillingDetailsSheet({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: BillingDetails;
  onClose: () => void;
  onSaved: (d: BillingDetails) => void;
}) {
  if (!open) return null;
  return (
    <BillingDetailsBody initial={initial} onClose={onClose} onSaved={onSaved} />
  );
}

function BillingDetailsBody({
  initial,
  onClose,
  onSaved,
}: {
  initial: BillingDetails;
  onClose: () => void;
  onSaved: (d: BillingDetails) => void;
}) {
  const [form, setForm] = useState<BillingDetails>(initial);
  const [error, setError] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    const gstin = form.gstin.trim().toUpperCase();
    if (gstin && !GSTIN.test(gstin)) {
      setError("A GSTIN has 15 characters, like 27ABCDE1234F1Z5.");
      return;
    }
    const clean: BillingDetails = {
      buyer_name: form.buyer_name.trim(),
      gstin,
      address: form.address.trim(),
    };
    writeBillingDetails(clean);
    onSaved(clean);
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title="Billing details"
      description="Printed on your invoices. Saved on this device and sent with each payment."
    >
      <form onSubmit={submit} className="space-y-4 pt-1">
        <Input
          label="Name or company"
          value={form.buyer_name}
          onChange={(e) => setForm({ ...form, buyer_name: e.target.value })}
          maxLength={120}
          placeholder="Your name or company"
          autoComplete="organization"
        />
        <Input
          label="GSTIN (optional)"
          value={form.gstin}
          onChange={(e) =>
            setForm({ ...form, gstin: e.target.value.toUpperCase() })
          }
          maxLength={15}
          placeholder="27ABCDE1234F1Z5"
          error={error}
          hint="Add it to claim input credit on the 18% GST."
          className="font-mono uppercase"
          spellCheck={false}
        />
        <Textarea
          label="Address (optional)"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          maxLength={300}
          placeholder="Street, city, state, PIN"
          className="min-h-20"
        />
        <Button type="submit" full>
          Save details
        </Button>
      </form>
    </Sheet>
  );
}
