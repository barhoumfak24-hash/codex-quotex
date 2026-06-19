import { WEBSITE_APP_ADD_ON_OPTIONS } from "@/lib/tiers";
import type { SoftwareSale, SoftwareSaleSignedAgreement } from "@/types";

export type CommunicationResult = {
  ok: boolean;
  result?: {
    id?: string;
    sid?: string;
    status: "sent" | "demo_queued" | "opted_out" | "failed";
    provider: "sendgrid" | "resend" | "twilio" | "demo";
    configured: boolean;
    error?: string;
  };
  error?: string;
};

export type SigningDocument = {
  title: string;
  version?: string;
};

export function softwareSaleAgencyCode(sale: Pick<SoftwareSale, "agencyName" | "id">) {
  const agencyPrefix = sale.agencyName
    .replace(/[^a-z]/gi, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "Q");
  const recordSuffix = sale.id.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase() || "2026";
  return `${agencyPrefix}-${recordSuffix}`;
}

export async function sendSoftwareSaleSigningEmail(input: {
  agencyName: string;
  contactName: string;
  email: string;
  phone?: string;
  signingLink: string;
  documents: SigningDocument[];
}): Promise<CommunicationResult> {
  return postCommunication("/communications/software-sale/signing-email", input);
}

export async function sendSoftwareSaleSigningSms(input: {
  agencyName: string;
  contactName: string;
  email: string;
  phone?: string;
  signingLink: string;
  documents: SigningDocument[];
}): Promise<CommunicationResult> {
  return postCommunication("/communications/software-sale/signing-sms", input);
}

export async function sendSoftwareSaleInvoiceEmail(sale: SoftwareSale): Promise<CommunicationResult> {
  return postCommunication("/communications/software-sale/invoice-email", {
    saleId: sale.id,
    agencyName: sale.agencyName,
    contactName: sale.contactName,
    email: sale.email,
    phone: sale.phone,
    agencyCode: softwareSaleAgencyCode(sale),
    seats: sale.seats,
    estimatedMonthly: sale.estimatedMonthly,
    setupFee: sale.setupFee,
    websiteAppAddOnLabel: WEBSITE_APP_ADD_ON_OPTIONS[sale.websiteAppAddOn ?? "none"].label,
    websiteAppAddOnMonthly: sale.websiteAppAddOnMonthly ?? 0,
    termMonths: sale.termMonths ?? 12,
    termDiscountPercent: sale.termDiscountPercent ?? 0,
    termDiscountMonthly: sale.termDiscountMonthly ?? 0,
    monthlyBeforeTermDiscount: sale.monthlyBeforeTermDiscount,
    signedAgreements: cleanSignedAgreements(sale.signedAgreements),
  });
}

async function postCommunication(path: string, payload: Record<string, unknown>): Promise<CommunicationResult> {
  const base = apiBaseUrl();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as CommunicationResult | null;
    if (!json) return { ok: false, error: `${res.status} ${res.statusText}` };
    return json;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The communications API could not be reached.",
    };
  }
}

function apiBaseUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return String((import.meta as any)?.env?.VITE_API_BASE_URL || "/api").replace(/\/+$/, "");
  } catch {
    return "/api";
  }
}

function cleanSignedAgreements(agreements?: SoftwareSaleSignedAgreement[]) {
  return (agreements ?? []).map((agreement) => ({
    title: agreement.title,
    signedAt: agreement.signedAt,
    signedByName: agreement.signedByName,
    signedByEmail: agreement.signedByEmail,
    version: agreement.version,
  }));
}
