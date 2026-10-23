"use client";

import { Check, Copy, FileText, Minus, Plus, Receipt, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMe } from "@/components/auth/MeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Notice, PageHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { SkeletonList, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { Toggle } from "@/components/ui/Toggle";
import { errorMessage, isApiError, isLocalApi } from "@/lib/api";
import { chargeAmount, detailsForCheckout, monthlyPrice, openRazorpay, PLAN_RANK, readBillingDetails, seatPrice, type BillingDetails } from "@/lib/billing";
import { api } from "@/lib/endpoints";
import { formatDate, longDate, money, titleCase } from "@/lib/format";
import { copyText, useApi } from "@/lib/hooks";
import type { BillingOut, CheckoutIn, CheckoutOut, Currency, PaymentOut, PlanOut } from "@/lib/types";
import { BillingDetailsSheet, MockPaySheet, type MockPayment } from "./BillingSheets";

type CheckoutRequest = Omit<CheckoutIn, "buyer_name" | "gstin" | "address">;

export function PlanScreen() {
  const { me, refetch: refetchMe } = useMe();
  const { toast } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const billing = useApi(() => api.billing.get(), ["billing"]);
  const refetchBilling = billing.refetch;
  const [currency, setCurrency] = useState<Currency>("INR");
  const [yearly, setYearly] = useState(false);
  const [details, setDetails] = useState<BillingDetails>(readBillingDetails);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mock, setMock] = useState<MockPayment | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  /** The cancel answer (with the end date); GET /billing also keeps the cancelled subscription until it ends. */
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const paidHandled = useRef(false);

  const isAdmin = me?.workspace.role === "owner" || me?.workspace.role === "admin";

  // Back from a redirect provider (Stripe): thank, refetch, clean the URL.
  useEffect(() => {
    if (params.get("paid") !== "1" || paidHandled.current) return;
    paidHandled.current = true;
    toast("Payment received. Your plan is updating.", "success");
    refetchBilling();
    refetchMe();
    router.replace("/settings/plan");
  }, [params, toast, refetchBilling, refetchMe, router]);

  function afterPaid(message: string) {
    toast(message, "success");
    billing.refetch();
    refetchMe();
  }

  async function startCheckout(id: string, req: CheckoutRequest, label: string, amountHint: number) {
    setBusy(id);
    try {
      const intent = await api.billing.checkout({ ...req, ...detailsForCheckout(details) });
      await runIntent(intent, label, amountHint);
    } catch (e) {
      // Choosing the plan that was cancelled but has not ended: keep it instead of paying again.
      if (isApiError(e) && e.status === 409 && e.code === "resume_instead") {
        await resumePlan();
        return;
      }
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function resumePlan() {
    setBusy("resume");
    try {
      const res = await api.billing.resume();
      setCancelMessage(null);
      toast(res.message || "Your plan continues as before.", "success");
      billing.refetch();
      refetchMe();
    } catch (e) {
      // 409 cannot_resume carries the reason.
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function runIntent(intent: CheckoutOut, label: string, amountHint: number) {
    const amount = intent.amount ?? amountHint;
    const cur = intent.currency ?? currency;
    if (intent.mode === "redirect") {
      if (!intent.redirect_url) throw new Error("The payment page did not open. Try again.");
      window.location.assign(intent.redirect_url);
      return;
    }
    if (intent.mode === "razorpay_checkout") {
      const res = await openRazorpay(intent, label);
      if (!res) return; // closed the window; nothing charged
      await api.billing.confirm({ provider: "razorpay", payload: { ...res } });
      afterPaid("Payment received. Thank you.");
      return;
    }
    setMock({ intent, label, amount, currency: cur });
  }

  async function confirmMock(m: MockPayment) {
    const payload: Record<string, unknown> = { amount: m.amount, currency: m.currency };
    if (m.intent.provider_subscription_id) payload.provider_subscription_id = m.intent.provider_subscription_id;
    else payload.provider_order_id = m.intent.provider_order_id;
    await api.billing.confirm({ provider: "mock", payload });
    setMock(null);
    afterPaid("Test payment confirmed. Credits added.");
  }

  async function cancelPlan() {
    setBusy("cancel");
    try {
      const res = await api.billing.cancel();
      setCancelOpen(false);
      setCancelMessage(res.message);
      toast(res.message, "success");
      billing.refetch();
      refetchMe();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function changeSeats(next: number) {
    setBusy("seats");
    try {
      await api.billing.seats(next);
      toast(next === 0 ? "Extra seats removed." : `${next} extra ${next === 1 ? "seat" : "seats"} on your plan.`, "success");
      billing.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function grant() {
    setGranting(true);
    try {
      await api.credits.devGrant(100);
      afterPaid("100 test credits added.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setGranting(false);
    }
  }

  async function copyInvoiceLink(p: PaymentOut) {
    if (!p.invoice_url) return;
    const ok = await copyText(p.invoice_url);
    toast(ok ? "Invoice link copied. It opens without signing in, for a limited time." : "Could not copy. Long-press the invoice link instead.", ok ? "success" : "error");
  }

  const data = billing.data;
  if (billing.loading || !me) {
    return (
      <div className="space-y-4">
        <SkeletonText lines={1} />
        <SkeletonList count={3} />
      </div>
    );
  }
  if (billing.error || !data) return <Notice tone="red">{errorMessage(billing.error, "Billing could not be loaded.")}</Notice>;

  const showUsd = data.providers.stripe || data.providers.mock;
  const cur: Currency = showUsd ? currency : "INR";
  const sub = data.subscription;
  const teamPlan = data.plans.find((p) => p.id === "team");
  const onTeam = data.plan === "team" && sub?.status === "active";
  const topupAmount = cur === "USD" ? data.topup.usd : data.topup.inr;

  return (
    <div className="space-y-6">
      <PageHeader title="Plan & credits" subtitle="Credits are charged only when a video succeeds. Change or cancel any time." />

      {data.price_change_notice ? <Notice tone="amber">{data.price_change_notice}</Notice> : null}
      {!isAdmin ? <Notice tone="neutral">Only owners and admins can change the plan or buy credits. You can see everything here.</Notice> : null}

      <CurrentPlanCard data={data} isAdmin={isAdmin} busy={busy} cancelMessage={cancelMessage} onCancel={() => setCancelOpen(true)} onResume={resumePlan} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">Plans</h2>
          {showUsd ? (
            <div className="flex gap-1.5" role="radiogroup" aria-label="Currency">
              <Chip role="radio" active={cur === "INR"} onClick={() => setCurrency("INR")} className="min-h-9 px-3 text-sm">
                ₹ INR
              </Chip>
              <Chip role="radio" active={cur === "USD"} onClick={() => setCurrency("USD")} className="min-h-9 px-3 text-sm">
                $ USD
              </Chip>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              currency={cur}
              yearly={yearly && p.id === "creator"}
              onYearly={p.id === "creator" ? setYearly : undefined}
              currentPlan={data.plan}
              canBuy={isAdmin}
              busy={busy === `plan:${p.id}`}
              onChoose={() => {
                const y = yearly && p.id === "creator" && cur === "INR" && p.inr_year_month !== null;
                startCheckout(`plan:${p.id}`, { kind: "plan", plan: p.id, currency: cur, yearly: y }, `${p.name} plan${y ? " · yearly" : ""}`, chargeAmount(p, cur, y));
              }}
            />
          ))}
        </div>
        <p className="text-xs text-muted">
          {cur === "INR" ? "Prices include 18% GST; invoice issued for every payment. " : "USD prices are charged by card; an invoice is issued for every payment. "}
          Monthly credits arrive at the start of each billing period.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-bold">Top up</h2>
            <p className="text-sm text-muted">
              {data.topup.credits} credits for {money(topupAmount, cur)}. They never expire on Pro and Team.
            </p>
          </div>
          <div className="mt-auto space-y-2">
            <Button
              variant="secondary"
              full
              disabled={!data.topup.available || !isAdmin}
              loading={busy === "topup"}
              icon={<Plus size={18} />}
              onClick={() => startCheckout("topup", { kind: "topup", currency: cur }, `${data.topup.credits} credits`, topupAmount)}
            >
              Buy {data.topup.credits} credits
            </Button>
            {!data.topup.available ? <p className="text-xs text-muted">Top-ups are available on paid plans. Pick a plan first.</p> : null}
            {isLocalApi && isAdmin ? (
              <Button variant="ghost" size="sm" full loading={granting} onClick={grant}>
                Add 100 test credits
              </Button>
            ) : null}
          </div>
        </Card>

        {teamPlan && onTeam ? (
          <SeatsCard key={data.seats_extra} plan={teamPlan} currency={cur} included={data.seats_included} extra={data.seats_extra} busy={busy === "seats"} canBuy={isAdmin} onChange={changeSeats} />
        ) : (
          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-bold">Billing details</h2>
              <p className="text-sm text-muted">Name, GSTIN and address printed on your invoices.</p>
            </div>
            <div className="mt-auto">
              <BillingDetailsSummary details={details} onEdit={() => setDetailsOpen(true)} />
            </div>
          </Card>
        )}
      </section>

      {teamPlan && onTeam ? (
        <Card className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold">Billing details</p>
            <p className="truncate text-sm text-muted">{details.buyer_name || details.gstin || details.address ? [details.buyer_name, details.gstin].filter(Boolean).join(" · ") : "Not set"}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setDetailsOpen(true)}>
            Edit
          </Button>
        </Card>
      ) : null}

      <InvoicesTable payments={data.payments} onCopy={copyInvoiceLink} />

      <MockPaySheet payment={mock} onClose={() => setMock(null)} onConfirm={confirmMock} />
      <BillingDetailsSheet
        open={detailsOpen}
        initial={details}
        onClose={() => setDetailsOpen(false)}
        onSaved={(d) => {
          setDetails(d);
          setDetailsOpen(false);
          toast("Billing details saved on this device.", "success");
        }}
      />
      <ConfirmSheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={cancelPlan}
        busy={busy === "cancel"}
        tone="danger"
        title="Cancel your plan?"
        confirmLabel="Cancel plan"
        body={
          <>
            Your plan stays active until {sub?.current_period_end ? longDate(new Date(sub.current_period_end)) : "the end of this period"}, then returns to Free. Credits you already have
            keep working.
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CurrentPlanCard({
  data,
  isAdmin,
  busy,
  cancelMessage,
  onCancel,
  onResume,
}: {
  data: BillingOut;
  isAdmin: boolean;
  busy: string | null;
  cancelMessage: string | null;
  onCancel: () => void;
  onResume: () => void;
}) {
  const sub = data.subscription;
  // A cancelled plan stays in `subscription` (status cancelled or cancel_at_period_end) until plan_ends_at.
  const ending = data.plan !== "free" && (!sub || sub.status === "cancelled" || sub.cancel_at_period_end);
  const cancelled = Boolean(sub) && ending;
  const active = sub && (sub.status === "active" || sub.status === "past_due");
  const endsAt = data.plan_ends_at ?? sub?.current_period_end ?? null;
  const end = endsAt ? longDate(new Date(endsAt)) : null;
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Current plan</p>
          <p className="text-2xl font-bold">{data.plan_name}</p>
        </div>
        <Badge tone={data.plan === "free" ? "neutral" : ending ? "amber" : "accent"}>{data.plan === "free" ? "Free" : sub?.status === "past_due" ? "Payment due" : ending ? "Ending" : "Active"}</Badge>
      </div>
      <p className="text-3xl font-bold tabular-nums">
        {data.credits} <span className="text-base font-medium text-muted">credits</span>
      </p>
      {sub?.status === "past_due" ? <Notice tone="amber">The last payment did not go through. Renders keep working while credits last; update your payment to continue.</Notice> : null}
      {cancelMessage ? <Notice tone="amber">{cancelMessage}</Notice> : null}
      {sub && cancelled ? (
        <p className="text-sm text-muted">
          Ends on {end ?? "the end of this period"}. Credits you already have keep working; after that the workspace returns to Free.
        </p>
      ) : !sub && ending ? (
        <p className="text-sm text-muted">Returns to Free at the end of the current billing period. Credits you already have keep working.</p>
      ) : sub && active && end ? (
        <p className="text-sm text-muted">
          Renews on {end}
          {sub.yearly ? " · billed yearly" : ""}
          {sub.seats > 0 ? ` · ${sub.seats} extra ${sub.seats === 1 ? "seat" : "seats"}` : ""}
        </p>
      ) : data.plan === "free" ? (
        <p className="text-sm text-muted">30 credits a month, 720p with a watermark. Pick a plan below to remove the watermark and get more minutes.</p>
      ) : null}
      {sub && active && !cancelled && isAdmin ? (
        <Button variant="ghost" size="sm" onClick={onCancel} loading={busy === "cancel"}>
          Cancel plan
        </Button>
      ) : null}
      {sub && cancelled && isAdmin ? (
        <Button variant="secondary" size="sm" icon={<RotateCcw size={16} />} onClick={onResume} loading={busy === "resume"}>
          Resume plan
        </Button>
      ) : null}
    </Card>
  );
}

function PlanCard({
  plan,
  currency,
  yearly,
  onYearly,
  currentPlan,
  canBuy,
  busy,
  onChoose,
}: {
  plan: PlanOut;
  currency: Currency;
  yearly: boolean;
  onYearly?: (v: boolean) => void;
  currentPlan: string;
  canBuy: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const canYearly = Boolean(onYearly) && currency === "INR" && plan.inr_year_month !== null;
  const useYearly = canYearly && yearly;
  const perMonth = monthlyPrice(plan, currency, useYearly);
  const isCurrent = plan.current || plan.id === currentPlan;
  const isFree = plan.id === "free";
  const downgrade = (PLAN_RANK[plan.id] ?? 0) < (PLAN_RANK[currentPlan] ?? 0);
  return (
    <Card className={`flex flex-col gap-3 ${isCurrent ? "border-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{plan.name}</p>
          <p className="text-sm text-muted">
            {plan.credits_month} credits · about {plan.minutes_estimate} min a month
          </p>
        </div>
        {isCurrent ? <Badge tone="accent">Current</Badge> : null}
      </div>
      <p className="text-3xl font-bold tabular-nums">
        {money(perMonth, currency)}
        <span className="text-base font-medium text-muted"> / month</span>
      </p>
      {canYearly && onYearly ? (
        <Toggle
          checked={yearly}
          onChange={onYearly}
          label={<span className="text-sm">Pay yearly</span>}
          description={`${money(plan.inr_year_month as number, "INR")}/month, billed ${money((plan.inr_year_month as number) * 12, "INR")} once a year`}
        />
      ) : null}
      {plan.id === "team" ? (
        <p className="text-sm text-muted">
          +{money(seatPrice(plan, currency), currency)} per extra seat, per month. {plan.max_members} seats included.
        </p>
      ) : null}
      <ul className="space-y-1 text-sm">
        {plan.includes.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
        <li className="flex items-start gap-2">
          <Check size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>
            {plan.max_avatars} {plan.max_avatars === 1 ? "avatar" : "avatars"} · up to {plan.max_quality}
          </span>
        </li>
      </ul>
      <div className="mt-auto pt-1">
        {isFree ? (
          <Button variant="secondary" full disabled>
            {isCurrent ? "Current" : "Cancel your plan to return here"}
          </Button>
        ) : (
          <Button variant={isCurrent ? "secondary" : "primary"} full disabled={isCurrent || !canBuy} loading={busy} onClick={onChoose}>
            {isCurrent ? "Current" : downgrade ? "Switch" : "Choose"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function SeatsCard({
  plan,
  currency,
  included,
  extra,
  busy,
  canBuy,
  onChange,
}: {
  plan: PlanOut;
  currency: Currency;
  included: number;
  extra: number;
  busy: boolean;
  canBuy: boolean;
  onChange: (next: number) => void;
}) {
  const [value, setValue] = useState(extra);
  const price = seatPrice(plan, currency);
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">Extra seats</h2>
        <p className="text-sm text-muted">
          {included} seats included. Each extra seat is {money(price, currency)} a month on the same bill.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Fewer seats"
          disabled={value <= 0 || !canBuy}
          onClick={() => setValue((v) => Math.max(0, v - 1))}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line text-fg disabled:opacity-50"
        >
          <Minus size={18} />
        </button>
        <p className="min-w-16 flex-1 text-center text-2xl font-bold tabular-nums" aria-live="polite">
          {value}
        </p>
        <button
          type="button"
          aria-label="More seats"
          disabled={value >= 200 || !canBuy}
          onClick={() => setValue((v) => Math.min(200, v + 1))}
          className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-line text-fg disabled:opacity-50"
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="mt-auto space-y-1">
        <Button variant="secondary" full disabled={value === extra || !canBuy} loading={busy} onClick={() => onChange(value)}>
          {value === extra ? `${extra} extra ${extra === 1 ? "seat" : "seats"}` : `Update to ${value} extra ${value === 1 ? "seat" : "seats"}`}
        </Button>
        <p className="text-center text-xs text-muted">
          {included + value} seats in total · {money(price * value, currency)} a month extra
        </p>
      </div>
    </Card>
  );
}

function BillingDetailsSummary({ details, onEdit }: { details: BillingDetails; onEdit: () => void }) {
  const set = details.buyer_name || details.gstin || details.address;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 text-sm">
        {set ? (
          <>
            <p className="truncate font-medium">{details.buyer_name || "No name"}</p>
            <p className="truncate text-muted">{[details.gstin, details.address].filter(Boolean).join(" · ") || "No GSTIN"}</p>
          </>
        ) : (
          <p className="text-muted">Not set. Your account name and email are used.</p>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={onEdit}>
        {set ? "Edit" : "Add"}
      </Button>
    </div>
  );
}

function InvoicesTable({ payments, onCopy }: { payments: PaymentOut[]; onCopy: (p: PaymentOut) => void }) {
  const paid = payments.filter((p) => p.status === "paid");
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-3">
        <h2 className="text-lg font-bold">Invoices</h2>
      </div>
      <Card>
        {paid.length === 0 ? (
          <p className="text-sm text-muted">No payments yet. Every payment gets a GST invoice you can print or save as PDF.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-2 pr-3 text-right font-semibold">Credits</th>
                  <th className="py-2 font-semibold">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {paid.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">{formatDate(p.paid_at ?? p.created_at)}</td>
                    <td className="py-2 pr-3">
                      <span className="block">{p.description}</span>
                      <span className="block text-xs text-muted">
                        {titleCase(p.kind)} · {titleCase(p.provider)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{money(p.amount, p.currency)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-green">{p.credits > 0 ? `+${p.credits}` : "—"}</td>
                    <td className="py-2">
                      {p.invoice_url ? (
                        <span className="inline-flex items-center gap-1">
                          <a href={p.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap font-semibold text-accent">
                            <FileText size={14} /> {p.invoice_number ?? "Open"}
                          </a>
                          <button
                            type="button"
                            onClick={() => onCopy(p)}
                            aria-label={`Copy link to invoice ${p.invoice_number ?? ""}`.trim()}
                            title="Copy link"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2"
                          >
                            <Copy size={14} />
                          </button>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted">
        <Receipt size={12} /> Need the usage ledger instead? It is under{" "}
        <Link href="/settings" className="font-semibold text-accent">
          Settings
        </Link>
        .
      </p>
    </section>
  );
}
