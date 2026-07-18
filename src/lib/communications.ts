import { SOFTWARE_PRODUCT_OPTIONS, WEBSITE_APP_ADD_ON_OPTIONS, normalizeSoftwareProduct } from "@/lib/tiers";
import { apiBaseUrl } from "@/lib/apiBase";
import { revealProtectedAgencyCode } from "@/lib/credentials";
import { provisionAgencyForCompletedSale } from "@/lib/softwareSaleProvisioning";
import type { SoftwareSale, SoftwareSaleSignedAgreement } from "@/types";
import { currentServerSessionToken } from "@/lib/serverSession";

export type CommunicationResult = {
  ok: boolean;
  result?: {
    id?: string;
    sid?: string;
    status: "sent" | "opted_out" | "failed";
    provider: "sendgrid" | "resend" | "smtp" | "twilio" | "unconfigured";
    configured: boolean;
    error?: string;
  };
  error?: string;
};

export type SigningDocument = {
  title: string;
  version?: string;
};

export function softwareSaleAgencyCode(sale: SoftwareSale) {
  const agency = provisionAgencyForCompletedSale(sale);
  const code = revealProtectedAgencyCode(agency);
  if (!code) {
    throw new Error(`Unable to reveal agency code for ${sale.agencyName}.`);
  }
  return code;
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
    website: sale.website,
    agencyCode: softwareSaleAgencyCode(sale),
    productLabel: SOFTWARE_PRODUCT_OPTIONS[normalizeSoftwareProduct(sale.product)].label,
    seats: sale.seats,
    estimatedMonthly: sale.estimatedMonthly,
    setupFee: sale.setupFee,
    websiteAppAddOnLabel: WEBSITE_APP_ADD_ON_OPTIONS[sale.websiteAppAddOn ?? "none"].label,
    websiteAppAddOnMonthly: sale.websiteAppAddOnMonthly ?? 0,
    paymentMode: sale.paymentMode,
    source: sale.source,
    stripeCheckoutSessionId: sale.stripeCheckoutSessionId,
    termMonths: sale.termMonths ?? 12,
    termDiscountPercent: sale.termDiscountPercent ?? 0,
    termDiscountMonthly: sale.termDiscountMonthly ?? 0,
    monthlyBeforeTermDiscount: sale.monthlyBeforeTermDiscount,
    standardEstimatedMonthly: sale.standardEstimatedMonthly,
    customMonthlyPriceUsd: sale.customMonthlyPriceUsd,
    customMonthlyPriceReason: sale.customMonthlyPriceReason,
    signedByName: sale.signedByName,
    signedByEmail: sale.signedByEmail,
    signedAt: sale.signedAt,
    signedAgreements: cleanSignedAgreements(sale.signedAgreements),
  });
}

export function softwareSaleInvoicePatchFromResult(result: CommunicationResult): Partial<SoftwareSale> {
  const status = result.result?.status;
  const sent = result.ok && status === "sent";
  return {
    invoiceEmailStatus: status === "sent" || status === "failed" ? status : "failed",
    invoiceEmailProvider: result.result?.provider,
    invoiceEmailSentAt: sent ? new Date().toISOString() : undefined,
    invoiceEmailError: sent ? undefined : result.result?.error ?? result.error ?? "Invoice email could not be sent.",
  };
}

async function postCommunication(path: string, payload: Record<string, unknown>): Promise<CommunicationResult> {
  const base = apiBaseUrl();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: communicationAuthHeaders(),
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

function communicationAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (typeof window === "undefined") return headers;
  const token = currentServerSessionToken() ?? "";
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
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
