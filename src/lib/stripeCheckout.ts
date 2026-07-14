import { apiBaseUrl } from "@/lib/apiBase";
import type { SoftwareSale } from "@/types";

export type StripeCheckoutSessionResponse = {
  ok: boolean;
  id: string;
  url: string;
  quote?: {
    estimatedMonthly: number;
    standardEstimatedMonthly: number;
  };
  error?: string;
  message?: string;
};

export type StripeCheckoutSessionSummary = {
  id: string;
  status: string | null;
  paymentStatus: string | null;
  mode: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  customerEmail: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  subscriptionTermStartedAt: string | null;
  subscriptionTermEndsAt: string | null;
};

export async function createSoftwareSaleStripeCheckoutSession(
  sale: SoftwareSale,
  options: { master?: boolean; successUrl?: string; cancelUrl?: string } = {}
): Promise<StripeCheckoutSessionResponse> {
  const path = options.master
    ? "/stripe/software-sales/master-checkout-session"
    : "/stripe/software-sales/checkout-session";
  return postStripe<StripeCheckoutSessionResponse>(path, softwareSalePayload(sale, options));
}

export async function createSoftwareSalePacketStripeCheckoutSession(
  options: { saleId?: string; signingPacketId: string; successUrl?: string; cancelUrl?: string }
): Promise<StripeCheckoutSessionResponse> {
  return postStripe<StripeCheckoutSessionResponse>("/stripe/software-sales/packet-checkout-session", {
    saleId: options.saleId,
    signingPacketId: options.signingPacketId,
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
  });
}

export async function getSoftwareSaleStripeCheckoutSession(
  sessionId: string
): Promise<{ ok: boolean; session?: StripeCheckoutSessionSummary; error?: string; message?: string }> {
  const res = await fetch(`${apiBaseUrl()}/stripe/software-sales/checkout-session/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  return (await res.json().catch(() => ({ ok: false, error: `${res.status} ${res.statusText}` }))) as {
    ok: boolean;
    session?: StripeCheckoutSessionSummary;
    error?: string;
    message?: string;
  };
}

async function postStripe<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: stripeHeaders(),
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) {
    return {
      ok: false,
      error: `${res.status} ${res.statusText}`,
    } as T;
  }
  return json;
}

function softwareSalePayload(
  sale: SoftwareSale,
  options: { successUrl?: string; cancelUrl?: string }
): Record<string, unknown> {
  return {
    saleId: sale.id,
    signingPacketId: sale.signingPacketId,
    agencyName: sale.agencyName,
    contactName: sale.contactName,
    email: sale.email,
    phone: sale.phone,
    website: sale.website,
    product: sale.product,
    tier: sale.tier,
    seats: sale.seats,
    websiteAppAddOn: sale.websiteAppAddOn,
    termMonths: sale.termMonths,
    customMonthlyPriceUsd: sale.customMonthlyPriceUsd,
    customMonthlyPriceReason: sale.customMonthlyPriceReason,
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
  };
}

function stripeHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (typeof window === "undefined") return headers;
  const token =
    window.localStorage.getItem("quotex.authToken") ||
    window.localStorage.getItem("quotex.jwt") ||
    "";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
