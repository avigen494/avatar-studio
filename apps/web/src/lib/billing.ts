/*
  Billing helpers for /settings/plan: plan prices from GET /billing, the
  Razorpay Checkout.js loader and the buyer details kept in localStorage.
*/

import type { CheckoutOut, Currency, PlanOut } from "./types";

export const BILLING_DETAILS_KEY = "as_billing_details";

export interface BillingDetails {
  buyer_name: string;
  gstin: string;
  address: string;
}

export const EMPTY_DETAILS: BillingDetails = { buyer_name: "", gstin: "", address: "" };

export function readBillingDetails(): BillingDetails {
  if (typeof window === "undefined") return EMPTY_DETAILS;
  try {
    const raw = window.localStorage.getItem(BILLING_DETAILS_KEY);
    if (!raw) return EMPTY_DETAILS;
    const parsed = JSON.parse(raw) as Partial<BillingDetails>;
    return {
      buyer_name: typeof parsed.buyer_name === "string" ? parsed.buyer_name : "",
      gstin: typeof parsed.gstin === "string" ? parsed.gstin : "",
      address: typeof parsed.address === "string" ? parsed.address : "",
    };
  } catch {
    return EMPTY_DETAILS;
  }
}

export function writeBillingDetails(d: BillingDetails) {
  try {
    window.localStorage.setItem(BILLING_DETAILS_KEY, JSON.stringify(d));
  } catch {
    // Private mode: the details are still sent with this checkout.
  }
}

/** Fields to send with POST /billing/checkout; empty strings become null. */
export function detailsForCheckout(d: BillingDetails): { buyer_name: string | null; gstin: string | null; address: string | null } {
  return {
    buyer_name: d.buyer_name.trim() || null,
    gstin: d.gstin.trim().toUpperCase() || null,
    address: d.address.trim() || null,
  };
}

/** Monthly price in the smallest unit for the currency (the yearly Creator price is per month, billed for 12). */
export function monthlyPrice(plan: PlanOut, currency: Currency, yearly: boolean): number {
  if (currency === "USD") return plan.usd_month;
  return yearly && plan.inr_year_month !== null ? plan.inr_year_month : plan.inr_month;
}

/** What is charged at checkout: 12 months for the yearly Creator option, one month otherwise. */
export function chargeAmount(plan: PlanOut, currency: Currency, yearly: boolean, seats = 0): number {
  const base = monthlyPrice(plan, currency, yearly);
  const seat = currency === "USD" ? plan.seat_usd_month : plan.seat_inr_month;
  return yearly && plan.inr_year_month !== null && currency === "INR" ? base * 12 : base + seats * seat;
}

export function seatPrice(plan: PlanOut, currency: Currency): number {
  return currency === "USD" ? plan.seat_usd_month : plan.seat_inr_month;
}

export const PLAN_RANK: Record<string, number> = { free: 0, creator: 1, pro: 2, team: 3 };

/* ------------------------------------------------------------------ */
/* Razorpay Checkout.js                                                 */
/* ------------------------------------------------------------------ */

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id?: string;
  subscription_id?: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string };
  theme?: { color?: string };
  handler: (res: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (res: unknown) => void) => void;
}

type RazorpayCtor = new (opts: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayLoading: Promise<RazorpayCtor> | null = null;

/** Loads Checkout.js once per page and resolves with the constructor. */
export function loadRazorpay(): Promise<RazorpayCtor> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve(window.Razorpay);
  if (razorpayLoading) return razorpayLoading;
  razorpayLoading = new Promise<RazorpayCtor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const done = () => (window.Razorpay ? resolve(window.Razorpay) : reject(new Error("Razorpay did not load.")));
    script.addEventListener("load", done, { once: true });
    script.addEventListener(
      "error",
      () => {
        razorpayLoading = null;
        reject(new Error("Could not load Razorpay. Check your connection and try again."));
      },
      { once: true },
    );
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return razorpayLoading;
}

/** Opens Razorpay for a checkout intent. Resolves with the success payload, or null when the person closes it. */
export async function openRazorpay(intent: CheckoutOut, description: string): Promise<RazorpaySuccess | null> {
  const Razorpay = await loadRazorpay();
  if (!intent.public_key) throw new Error("Razorpay is not fully set up (missing key id). Ask the platform admin.");
  return new Promise((resolve, reject) => {
    const rz = new Razorpay({
      key: intent.public_key as string,
      order_id: intent.provider_order_id ?? undefined,
      subscription_id: intent.provider_subscription_id ?? undefined,
      name: "Avatar Studio",
      description,
      prefill: { name: intent.prefill?.name ?? undefined, email: intent.prefill?.email ?? undefined },
      theme: { color: "#0f766e" },
      handler: (res) => resolve(res),
      modal: { ondismiss: () => resolve(null) },
    });
    rz.on("payment.failed", (res) => {
      const r = res as { error?: { description?: string } };
      reject(new Error(r?.error?.description || "The payment did not go through. Nothing was charged."));
    });
    rz.open();
  });
}
