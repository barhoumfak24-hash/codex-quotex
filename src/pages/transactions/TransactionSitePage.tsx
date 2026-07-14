import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileText,
  Globe2,
  LockKeyhole,
  Minus,
  PenLine,
  Plus,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { QuotexMark } from "@/components/layout/Logo";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { apiBaseUrl } from "@/lib/apiBase";
import { getConfiguredPortalBaseUrl, joinUrl } from "@/lib/appSurface";
import {
  sendSoftwareSaleInvoiceEmail,
  softwareSaleAgencyCode,
  softwareSaleInvoicePatchFromResult,
} from "@/lib/communications";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";
import { provisionAgencyForCompletedSale } from "@/lib/softwareSaleProvisioning";
import {
  createSoftwareSalePacketStripeCheckoutSession,
  createSoftwareSaleStripeCheckoutSession,
  getSoftwareSaleStripeCheckoutSession,
} from "@/lib/stripeCheckout";
import type { StripeCheckoutSessionSummary } from "@/lib/stripeCheckout";
import {
  COMPANY_APP_MONTHLY_ADD_ON_USD,
  COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD,
  COMPANY_WEBSITE_MONTHLY_ADD_ON_USD,
  SOFTWARE_SETUP_FEE_USD,
  SOFTWARE_PRODUCT_OPTIONS,
  WEBSITE_APP_ADD_ON_OPTIONS,
  normalizeSoftwareUserCount,
  softwareProductSupportsWebsiteAppAddOns,
  softwareSeatMonthlyPrice,
  softwareUserMonthlySubtotal,
  websiteAppAddOnMonthlyUsd,
} from "@/lib/tiers";
import type {
  SoftwareProduct,
  SoftwareSale,
  SoftwareSaleSignedAgreement,
  SoftwareSaleWebsiteAppAddOn,
  SubscriptionTier,
} from "@/types";

const TRUST_POINTS = [
  "Transaction record routes to master billing",
  "Stripe Checkout handoff ready for production",
  "Pricing is based on selected users and add-ons",
];

export const REQUIRED_CHECKOUT_FORMS = [
  {
    id: "master-subscription-agreement",
    title: "Master software subscription agreement",
    version: "MSA-US-2026.06",
    summary: "Software access, user seats, permitted use, support scope, renewal, cancellation, and platform terms.",
    body: [
      "Customer subscribes to the Quotex Insurance software platform for the selected number of staff users and any selected website or Quotex app add-ons.",
      "Customer is responsible for authorized staff access, agency data entered into the platform, carrier credentials, and compliance with applicable insurance, privacy, payment, and communications laws.",
      "The quoting, carrier submission, and policy implementation features are intended strictly for use by properly licensed insurance agents or authorized agency staff acting under appropriate licensed supervision. Customer is responsible for limiting access to qualified users and for all actions taken by unlicensed, unauthorized, or improperly supervised users on the platform.",
      "Quotex is not responsible for insurance advice, coverage recommendations, carrier submissions, policy implementation, or other regulated insurance actions performed by unlicensed or unauthorized users, except to the extent prohibited by applicable law or the final counsel-approved agreement.",
      "Quotex provides the software workspace, provisioning support, and configured add-ons described in the final monthly plan. Carrier, email, payment, SMS, storage, and AI providers may require separate credentials or production approvals.",
      "The subscription renews monthly until cancelled under the final agreement. Fees are charged according to the signed payment authorization and final monthly plan.",
      "The selected term may be renewed at any time; renewal updates the active term for the next billing period according to the final production agreement.",
      "This template is structured for U.S. electronic signature workflows and must be finalized by counsel before production use.",
    ],
    signatureStatement:
      "I have reviewed and agree to the Master Software Subscription Agreement for the selected plan.",
  },
  {
    id: "electronic-records-consent",
    title: "Electronic records and signature consent",
    version: "ERS-US-2026.06",
    summary: "Consent to use electronic records and electronic signatures for this transaction and related checkout records.",
    body: [
      "Signer consents to receive, review, sign, retain, and access this transaction's records electronically.",
      "Signer confirms they can access and retain electronic records using a modern web browser, PDF-capable device, email account, and internet connection.",
      "Signer understands that typing a name, checking the authorization box, and pressing Sign this document is intended to create an electronic signature logically associated with that document.",
      "Signer may request paper copies or withdraw electronic-record consent according to the final production agreement and support procedures, subject to any lawful operational consequences disclosed in the final agreement.",
      "This consent is designed around U.S. ESIGN/UETA electronic-record concepts and must be reviewed by counsel before production use.",
    ],
    signatureStatement:
      "I consent to electronic records and electronic signatures for this checkout transaction.",
  },
  {
    id: "recurring-payment-authorization",
    title: "Recurring payment authorization",
    version: "RPA-US-2026.06",
    summary: "Authorization to charge the selected business card or bank account for the recurring monthly software plan.",
    body: [
      "Signer authorizes Quotex to charge the selected payment method for the final monthly software plan shown in checkout.",
      "The first month is charged at checkout. Recurring monthly charges continue until the subscription is cancelled or changed according to the final agreement.",
      "If the selected payment method fails, Quotex may request updated payment information, pause provisioning, or follow the remedies permitted by the final agreement.",
      "The authorization covers selected staff users and selected monthly website or Quotex app add-ons. Future changes to user slots or add-ons may adjust the recurring monthly amount after approval.",
      "This payment authorization is an operational checkout template and should be finalized by counsel and the payment processor before production use.",
    ],
    signatureStatement:
      "I authorize the selected recurring payment method for the final monthly plan.",
  },
  {
    id: "provisioning-order",
    title: "Implementation and provisioning order",
    version: "IPO-US-2026.06",
    summary: "Agency setup, portal provisioning, website and Quotex app add-ons, onboarding information, and launch handoff.",
    body: [
      "Quotex will queue the agency workspace, user-slot limits, agency code issuance, and selected website or Quotex app add-ons after payment clears.",
      "Customer is responsible for providing accurate agency, billing, website, carrier, and staff onboarding information.",
      "The website add-on, when selected, is a separate branded customer-facing website connected to the software workflows for quoting, portal access, documents, claims, billing visibility, and messages.",
      "The Quotex app add-on, when selected, activates the agency inside the universal Quotex client app so customers choose the agency at sign-in and enter the correct portal.",
      "Provisioning schedules, launch timing, custom-domain work, and third-party approvals depend on complete customer information and external provider timelines.",
      "This provisioning order records the commercial scope selected in checkout and should be finalized by counsel before production use.",
    ],
    signatureStatement:
      "I approve the implementation and provisioning order for the selected agency plan.",
  },
];

const QUICK_USER_COUNTS = [10, 25, 50];

const TERM_OPTIONS = [
  { months: 12, label: "12 months", discountPercent: 0 },
  { months: 24, label: "24 months", discountPercent: 5 },
  { months: 36, label: "36 months", discountPercent: 8 },
] as const;

export type PlanTermMonths = (typeof TERM_OPTIONS)[number]["months"];

type CheckoutSignatureState = {
  signerName: string;
  authorized: boolean;
  signedAt?: string;
};

export type RemoteCheckoutSignatureState = CheckoutSignatureState & {
  viewedAt?: string;
  signedByEmail?: string;
  signerUserAgent?: string;
};

export type RemoteCheckoutPaymentMethodEntry = {
  method: "card" | "bank";
  accountName: string;
  label: string;
  last4: string;
  enteredAt: string;
};

export type RemoteCheckoutPacket = {
  id: string;
  saleId?: string;
  agencyName: string;
  contactName: string;
  email: string;
  phone: string;
  website?: string;
  product?: SoftwareProduct;
  tier?: SubscriptionTier;
  seats: number;
  estimatedMonthly: number;
  setupFee?: number;
  websiteAppAddOn?: SoftwareSaleWebsiteAppAddOn;
  websiteAppAddOnMonthly?: number;
  termMonths: PlanTermMonths;
  termDiscountPercent: number;
  termDiscountMonthly?: number;
  monthlyBeforeTermDiscount?: number;
  standardEstimatedMonthly?: number;
  customMonthlyPriceUsd?: number;
  customMonthlyPriceReason?: string;
  addOnLabel: string;
  source?: SoftwareSale["source"];
  paymentMode?: SoftwareSale["paymentMode"];
  stripeCheckoutSessionId?: string;
  invoiceEmailSentAt?: string;
  invoiceEmailStatus?: SoftwareSale["invoiceEmailStatus"];
  invoiceEmailProvider?: SoftwareSale["invoiceEmailProvider"];
  invoiceEmailError?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  submittedByName?: string;
  submittedByEmail?: string;
  paymentMethodEntry?: RemoteCheckoutPaymentMethodEntry;
  signatures: Record<string, RemoteCheckoutSignatureState>;
};

function emptyCheckoutSignatures(): Record<string, CheckoutSignatureState> {
  return Object.fromEntries(
    REQUIRED_CHECKOUT_FORMS.map((requiredForm) => [
      requiredForm.id,
      { signerName: "", authorized: false },
    ])
  ) as Record<string, CheckoutSignatureState>;
}

export function emptyRemoteCheckoutSignatures(signerName = ""): Record<string, RemoteCheckoutSignatureState> {
  return Object.fromEntries(
    REQUIRED_CHECKOUT_FORMS.map((requiredForm) => [
      requiredForm.id,
      { signerName, authorized: false },
    ])
  ) as Record<string, RemoteCheckoutSignatureState>;
}

export const REMOTE_SIGNING_PACKET_PREFIX = "quotex_checkout_remote_sign_packet:";

export function remoteSigningPacketKey(packetId: string) {
  return `${REMOTE_SIGNING_PACKET_PREFIX}${packetId}`;
}

export function createRemoteSigningPacketId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `qtx-${Date.now()}-${random.replace(/[^a-z0-9-]/gi, "").slice(0, 18)}`;
}

export function readRemoteSigningPacket(packetId?: string | null): RemoteCheckoutPacket | null {
  if (!packetId || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(remoteSigningPacketKey(packetId));
    return raw ? (JSON.parse(raw) as RemoteCheckoutPacket) : null;
  } catch {
    return null;
  }
}

export function writeRemoteSigningPacket(packet: RemoteCheckoutPacket) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(remoteSigningPacketKey(packet.id), JSON.stringify(packet));
  } catch {
    // Demo storage can be disabled in private browsing; the direct signer page still renders from URL payload.
  }
}

export async function readSharedRemoteSigningPacket(packetId?: string | null): Promise<RemoteCheckoutPacket | null> {
  if (!packetId) return null;
  try {
    const res = await fetch(signingPacketApiUrl(packetId), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { found?: boolean; packet?: RemoteCheckoutPacket };
    if (!payload.found || !payload.packet || payload.packet.id !== packetId) return null;
    writeRemoteSigningPacket(payload.packet);
    return payload.packet;
  } catch {
    return null;
  }
}

export async function writeSharedRemoteSigningPacket(packet: RemoteCheckoutPacket): Promise<RemoteCheckoutPacket> {
  const res = await fetch(signingPacketApiUrl(packet.id), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ packet }),
  });
  if (!res.ok) throw new Error(`Signing packet sync failed: ${res.status}`);
  const payload = (await res.json().catch(() => null)) as { packet?: RemoteCheckoutPacket } | null;
  const nextPacket = payload?.packet?.id === packet.id ? payload.packet : packet;
  writeRemoteSigningPacket(nextPacket);
  return nextPacket;
}

function signingPacketApiUrl(packetId: string) {
  return `${apiBaseUrl()}/signing-packets/${encodeURIComponent(packetId)}`;
}

export function updateRemoteSigningPacketSignature(
  packetId: string | null,
  formId: string,
  patch: Partial<RemoteCheckoutSignatureState>
) {
  const packet = readRemoteSigningPacket(packetId);
  if (!packet) return;
  packet.signatures[formId] = {
    ...(packet.signatures[formId] ?? { signerName: packet.contactName, authorized: false }),
    ...patch,
  };
  packet.updatedAt = new Date().toISOString();
  writeRemoteSigningPacket(packet);
}

export function encodeRemotePacketPayload(packet: RemoteCheckoutPacket) {
  const payload = {
    id: packet.id,
    saleId: packet.saleId,
    agencyName: packet.agencyName,
    contactName: packet.contactName,
    email: packet.email,
    phone: packet.phone,
    website: packet.website,
    tier: packet.tier,
    seats: packet.seats,
    estimatedMonthly: packet.estimatedMonthly,
    setupFee: packet.setupFee,
    websiteAppAddOn: packet.websiteAppAddOn,
    websiteAppAddOnMonthly: packet.websiteAppAddOnMonthly,
    termMonths: packet.termMonths,
    termDiscountPercent: packet.termDiscountPercent,
    termDiscountMonthly: packet.termDiscountMonthly,
    monthlyBeforeTermDiscount: packet.monthlyBeforeTermDiscount,
    standardEstimatedMonthly: packet.standardEstimatedMonthly,
    customMonthlyPriceUsd: packet.customMonthlyPriceUsd,
    customMonthlyPriceReason: packet.customMonthlyPriceReason,
    addOnLabel: packet.addOnLabel,
    source: packet.source,
    paymentMode: packet.paymentMode,
    stripeCheckoutSessionId: packet.stripeCheckoutSessionId,
    invoiceEmailSentAt: packet.invoiceEmailSentAt,
    invoiceEmailStatus: packet.invoiceEmailStatus,
    invoiceEmailProvider: packet.invoiceEmailProvider,
    invoiceEmailError: packet.invoiceEmailError,
    createdAt: packet.createdAt,
    submittedAt: packet.submittedAt,
    submittedByName: packet.submittedByName,
    submittedByEmail: packet.submittedByEmail,
    paymentMethodEntry: packet.paymentMethodEntry,
  };
  try {
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  } catch {
    return "";
  }
}

export function decodeRemotePacketPayload(packetId: string, payload?: string | null): RemoteCheckoutPacket | null {
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(decodeURIComponent(escape(atob(padded)))) as Omit<
      RemoteCheckoutPacket,
      "updatedAt" | "signatures"
    >;
    return {
      ...parsed,
      id: parsed.id || packetId,
      updatedAt: parsed.createdAt || new Date().toISOString(),
      signatures: emptyRemoteCheckoutSignatures(parsed.contactName ?? ""),
    };
  } catch {
    return null;
  }
}

const darkInputClass =
  "w-full rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20";
const darkLabelClass = "mb-1 block text-xs font-medium uppercase tracking-wider text-white/55";
const darkSecondaryButtonClass =
  "btn border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]";

function signedAgreementsFromRemotePacket(packet: RemoteCheckoutPacket): SoftwareSaleSignedAgreement[] {
  return REQUIRED_CHECKOUT_FORMS.map((requiredForm) => {
    const signature = packet.signatures[requiredForm.id];
    return {
      id: requiredForm.id,
      title: requiredForm.title,
      summary: requiredForm.summary,
      version: requiredForm.version,
      viewedAt: signature?.viewedAt,
      signedAt: signature?.signedAt ?? new Date().toISOString(),
      signedByName: signature?.signerName?.trim() || packet.contactName,
      signedByEmail: signature?.signedByEmail || packet.email,
      signatureStatement: requiredForm.signatureStatement,
      electronicRecordConsent: requiredForm.id === "electronic-records-consent",
      signatureMethod: "typed_name_with_checkbox",
      signerUserAgent: signature?.signerUserAgent,
    };
  });
}

function billingTierForSeats(seats: number): SubscriptionTier {
  if (seats <= 10) return "minimum";
  if (seats <= 25) return "mid";
  return "ultra";
}

function paidSoftwareSalePatchFromStripeSession(
  session: StripeCheckoutSessionSummary,
  paidAt = new Date().toISOString()
): Partial<SoftwareSale> {
  return {
    status: "paid",
    paymentMode: "stripe_checkout",
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: session.customerId,
    stripeSubscriptionId: session.subscriptionId,
    stripePaymentStatus: session.paymentStatus ?? "paid",
    stripePaidAt: paidAt,
    stripeSubscriptionTermStartedAt: session.subscriptionTermStartedAt,
    stripeSubscriptionTermEndsAt: session.subscriptionTermEndsAt,
    stripeSubscriptionCancelAt: session.subscriptionTermEndsAt,
  };
}

async function finalizeSubmittedRemotePacket(packet: RemoteCheckoutPacket): Promise<{
  packet: RemoteCheckoutPacket;
  status: string;
}> {
  const signedAgreements = signedAgreementsFromRemotePacket(packet);
  const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
  const signedAt = signedAtValues[signedAtValues.length - 1];
  const signedAgreementNames = signedAgreements.map((agreement) => agreement.title);
  const existingSale = packet.saleId ? api.softwareSales.get(packet.saleId) : undefined;

  if (!existingSale) {
    await db.syncNow();
    return {
      packet,
      status: "Signed documents submitted. Quotex will open Stripe Checkout to start the recurring subscription.",
    };
  }

  const saleWithSignatures =
    api.softwareSales.update(existingSale.id, {
      status: "checkout_pending",
      paymentMode: "stripe_checkout",
      signingPacketId: packet.id,
      signedAgreementNames,
      signedAgreements,
      signedByName: signedAgreements[0]?.signedByName,
      signedByEmail: signedAgreements[0]?.signedByEmail,
      signedAt,
      signedPacketSubmittedAt: packet.submittedAt,
      signedPacketSubmittedByName: packet.submittedByName ?? signedAgreements[0]?.signedByName,
      signedPacketSubmittedByEmail: packet.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
    }) ?? existingSale;

  let nextPacket: RemoteCheckoutPacket = {
    ...packet,
    saleId: saleWithSignatures.id,
    invoiceEmailSentAt: saleWithSignatures.invoiceEmailSentAt,
    invoiceEmailStatus: saleWithSignatures.invoiceEmailStatus,
    invoiceEmailProvider: saleWithSignatures.invoiceEmailProvider,
    invoiceEmailError: saleWithSignatures.invoiceEmailError,
  };

  await db.syncNow();
  return {
    packet: nextPacket,
    status: "Signed documents submitted. Quotex will open Stripe Checkout to start the recurring subscription.",
  };
}

async function finalizePaidRemotePacket(
  packet: RemoteCheckoutPacket,
  session: StripeCheckoutSessionSummary
): Promise<{
  packet: RemoteCheckoutPacket;
  status: string;
}> {
  const signedAgreements = signedAgreementsFromRemotePacket(packet);
  const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
  const signedAt = signedAtValues[signedAtValues.length - 1];
  const signedAgreementNames = signedAgreements.map((agreement) => agreement.title);
  const resolvedSaleId = session.metadata?.saleId || session.clientReferenceId || packet.saleId || "";
  const existingSale = resolvedSaleId ? api.softwareSales.get(resolvedSaleId) : undefined;

  if (!existingSale) {
    const submitted = await finalizeSubmittedRemotePacket(packet);
    return {
      packet: submitted.packet,
      status:
        "Payment method was received and signed documents were submitted. Master billing needs the matching sale record to finish provisioning.",
    };
  }

  let completedSale =
    api.softwareSales.update(existingSale.id, {
      ...paidSoftwareSalePatchFromStripeSession(session, existingSale.stripePaidAt ?? new Date().toISOString()),
      signingPacketId: packet.id,
      signedAgreementNames,
      signedAgreements,
      signedByName: signedAgreements[0]?.signedByName,
      signedByEmail: signedAgreements[0]?.signedByEmail,
      signedAt,
      signedPacketSubmittedAt: packet.submittedAt,
      signedPacketSubmittedByName: packet.submittedByName ?? signedAgreements[0]?.signedByName,
      signedPacketSubmittedByEmail: packet.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
    }) ?? existingSale;

  const invoiceAlreadySent = completedSale.invoiceEmailStatus === "sent" || !!completedSale.invoiceEmailSentAt;
  if (!invoiceAlreadySent) {
    const result = await sendSoftwareSaleInvoiceEmail(completedSale);
    completedSale =
      api.softwareSales.update(completedSale.id, {
        status: result.ok && result.result?.status === "sent" ? "provisioning" : completedSale.status,
        ...softwareSaleInvoicePatchFromResult(result),
      }) ?? completedSale;
  }

  if (completedSale.invoiceEmailStatus === "sent" || completedSale.invoiceEmailSentAt) {
    provisionAgencyForCompletedSale(completedSale);
    completedSale = api.softwareSales.update(completedSale.id, { status: "closed" }) ?? completedSale;
  }

  const nextPacket: RemoteCheckoutPacket = {
    ...packet,
    saleId: completedSale.id,
    stripeCheckoutSessionId: session.id,
    invoiceEmailSentAt: completedSale.invoiceEmailSentAt,
    invoiceEmailStatus: completedSale.invoiceEmailStatus,
    invoiceEmailProvider: completedSale.invoiceEmailProvider,
    invoiceEmailError: completedSale.invoiceEmailError,
    updatedAt: new Date().toISOString(),
  };

  await db.syncNow();
  return {
    packet: nextPacket,
    status:
      completedSale.invoiceEmailStatus === "sent" || completedSale.invoiceEmailSentAt
        ? "Payment method received. Signed documents submitted, invoice sent, and agency provisioned."
        : "Payment method received. Signed documents submitted; invoice delivery needs attention in master billing.",
  };
}

function missingSignedRemoteCheckoutForms(packet: RemoteCheckoutPacket) {
  return REQUIRED_CHECKOUT_FORMS.filter((requiredForm) => {
    const signature = packet.signatures[requiredForm.id];
    return !(
      signature?.authorized === true &&
      signature.signerName.trim().length > 0 &&
      signature.signedAt
    );
  });
}

function firstRemoteCheckoutSignature(packet: RemoteCheckoutPacket) {
  return REQUIRED_CHECKOUT_FORMS.map((requiredForm) => packet.signatures[requiredForm.id]).find(
    (signature) => signature?.signedAt
  );
}

function effectiveRemotePacketMonthly(packet: RemoteCheckoutPacket) {
  if (Number.isFinite(packet.estimatedMonthly) && packet.estimatedMonthly > 0) return packet.estimatedMonthly;
  if (Number.isFinite(packet.standardEstimatedMonthly) && (packet.standardEstimatedMonthly ?? 0) > 0) {
    return packet.standardEstimatedMonthly ?? 0;
  }
  const seatMonthly = packet.seats * softwareSeatMonthlyPrice(packet.product ?? "full_platform");
  const addOnMonthly = packet.websiteAppAddOnMonthly ?? websiteAppAddOnMonthlyUsd(packet.websiteAppAddOn ?? "none");
  const monthlyBeforeDiscount =
    packet.monthlyBeforeTermDiscount && packet.monthlyBeforeTermDiscount > 0
      ? packet.monthlyBeforeTermDiscount
      : seatMonthly + addOnMonthly;
  return Math.max(0, monthlyBeforeDiscount - (packet.termDiscountMonthly ?? 0));
}

function addOnIcon(addOn: SoftwareSaleWebsiteAppAddOn) {
  if (addOn === "website") return <Globe2 className="h-4 w-4" />;
  if (addOn === "app") return <Smartphone className="h-4 w-4" />;
  if (addOn === "website_app") return <CheckCircle2 className="h-4 w-4" />;
  return <CreditCard className="h-4 w-4" />;
}

export function TransactionSitePage() {
  const [form, setForm] = useState({
    agencyName: "",
    contactName: "",
    email: "",
    phone: "",
    website: "",
    product: "full_platform" as SoftwareProduct,
    seats: "",
    websiteAppAddOn: "none" as SoftwareSaleWebsiteAppAddOn,
    notes: "",
  });
  const [submitted, setSubmitted] = useState<SoftwareSale | null>(null);
  const [invoiceDeliveryStatus, setInvoiceDeliveryStatus] = useState<string | null>(null);
  const [paymentFailureMessage, setPaymentFailureMessage] = useState<string | null>(null);
  const [stripeStarting, setStripeStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCreatedPlan, setHasCreatedPlan] = useState(false);
  const [isPaymentStep, setIsPaymentStep] = useState(false);
  const [termMonths, setTermMonths] = useState<PlanTermMonths>(12);
  const [checkoutSignatures, setCheckoutSignatures] = useState<Record<string, CheckoutSignatureState>>(
    () => emptyCheckoutSignatures()
  );
  const [viewedCheckoutForms, setViewedCheckoutForms] = useState<Record<string, string>>({});
  const [viewingCheckoutFormId, setViewingCheckoutFormId] = useState<string | null>(null);

  const parsedSeats = Number.parseInt(form.seats, 10);
  const hasValidBillingEmail = /^\S+@\S+\.\S+$/.test(form.email.trim());
  const hasCompletedBillingDetails =
    form.agencyName.trim() !== "" &&
    form.contactName.trim() !== "" &&
    hasValidBillingEmail &&
    form.phone.trim() !== "";
  const hasSelectedUsers = form.seats.trim() !== "" && Number.isFinite(parsedSeats) && parsedSeats > 0;
  const canCreatePlan = hasCompletedBillingDetails && hasSelectedUsers;
  const canShowFinalPlan = canCreatePlan && hasCreatedPlan;
  const isPlanReviewPage = canShowFinalPlan && !isPaymentStep;
  const isPaymentPage = canShowFinalPlan && isPaymentStep;
  const isPlanBuilderPage = !isPlanReviewPage && !isPaymentPage;
  const hasViewedAllCheckoutForms = REQUIRED_CHECKOUT_FORMS.every((requiredForm) =>
    !!viewedCheckoutForms[requiredForm.id]
  );
  const signedCheckoutFormCount = REQUIRED_CHECKOUT_FORMS.filter(
    (requiredForm) => !!checkoutSignatures[requiredForm.id]?.signedAt
  ).length;
  const hasSignedCheckoutForms = signedCheckoutFormCount === REQUIRED_CHECKOUT_FORMS.length;
  const viewingCheckoutForm = REQUIRED_CHECKOUT_FORMS.find((requiredForm) => requiredForm.id === viewingCheckoutFormId);
  const viewingCheckoutSignature = viewingCheckoutForm
    ? checkoutSignatures[viewingCheckoutForm.id] ?? { signerName: "", authorized: false }
    : undefined;
  const viewingCheckoutFormViewed = viewingCheckoutForm
    ? !!viewedCheckoutForms[viewingCheckoutForm.id]
    : false;
  const seats = hasSelectedUsers ? normalizeSoftwareUserCount(parsedSeats) : 0;
  const billingTier = billingTierForSeats(seats);
  const setupFee = SOFTWARE_SETUP_FEE_USD;
  const supportsWebsiteAppAddOns = softwareProductSupportsWebsiteAppAddOns(form.product);
  const effectiveWebsiteAppAddOn = supportsWebsiteAppAddOns ? form.websiteAppAddOn : "none";
  const productSeatPrice = softwareSeatMonthlyPrice(form.product);
  const userSubtotal = hasSelectedUsers ? softwareUserMonthlySubtotal(seats, form.product) : 0;
  const websiteAppAddOnMonthly = websiteAppAddOnMonthlyUsd(effectiveWebsiteAppAddOn);
  const websiteAppRetailMonthly =
    effectiveWebsiteAppAddOn === "website_app"
      ? COMPANY_WEBSITE_MONTHLY_ADD_ON_USD + COMPANY_APP_MONTHLY_ADD_ON_USD
      : websiteAppAddOnMonthly;
  const bundleDiscount =
    effectiveWebsiteAppAddOn === "website_app"
      ? COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD
      : 0;
  const undiscountedMonthly = userSubtotal + websiteAppRetailMonthly;
  const monthlyBeforeTermDiscount = hasSelectedUsers ? undiscountedMonthly - bundleDiscount : 0;
  const selectedTerm = TERM_OPTIONS.find((term) => term.months === termMonths) ?? TERM_OPTIONS[0];
  const termDiscountMonthly =
    selectedTerm.discountPercent > 0
      ? Math.round(monthlyBeforeTermDiscount * (selectedTerm.discountPercent / 100))
      : 0;
  const totalMonthlyDiscount = bundleDiscount + termDiscountMonthly;
  const estimatedMonthly = hasSelectedUsers ? monthlyBeforeTermDiscount - termDiscountMonthly : 0;
  const portalBaseUrl = getConfiguredPortalBaseUrl();
  const masterLoginHref = portalBaseUrl ? joinUrl(portalBaseUrl, "/master/login") : "/master/login";
  const employeeLoginHref = portalBaseUrl ? joinUrl(portalBaseUrl, "/employee/login") : "/employee/login";

  useEffect(() => {
    const previousBackground = document.body.style.background;
    const previousColorScheme = document.body.style.colorScheme;
    document.body.style.background = "#080807";
    document.body.style.colorScheme = "dark";
    return () => {
      document.body.style.background = previousBackground;
      document.body.style.colorScheme = previousColorScheme;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const saleId = params.get("sale_id");
    const stripeSuccess = params.get("stripe_success") === "1";
    const stripeCancelled = params.get("stripe_cancelled") === "1";

    if (stripeCancelled) {
      setPaymentFailureMessage("Stripe Checkout was cancelled before payment completed.");
      setIsPaymentStep(true);
      window.history.replaceState({}, "", "/checkout");
      return;
    }

    if (!stripeSuccess || !sessionId) return;
    const completedSessionId = sessionId;

    let cancelled = false;
    async function recoverCompletedStripeCheckout() {
      setPaymentFailureMessage(null);
      setInvoiceDeliveryStatus("Confirming Stripe payment...");
      try {
        const checkout = await getSoftwareSaleStripeCheckoutSession(completedSessionId);
        if (cancelled) return;
        if (!checkout.ok || !checkout.session) {
          setInvoiceDeliveryStatus(null);
          setPaymentFailureMessage(checkout.message || checkout.error || "Stripe Checkout could not be verified.");
          return;
        }
        const { session } = checkout;
        if (session.paymentStatus !== "paid" && session.status !== "complete") {
          setInvoiceDeliveryStatus(null);
          setPaymentFailureMessage("Stripe Checkout has not reported a completed payment yet.");
          return;
        }

        const resolvedSaleId = saleId || session.metadata?.saleId || session.clientReferenceId || "";
        const existingSale = resolvedSaleId ? api.softwareSales.get(resolvedSaleId) : undefined;
        if (!existingSale) {
          setInvoiceDeliveryStatus(null);
          setPaymentFailureMessage(
            "Stripe confirmed payment, but the local checkout record was not found. Refresh from master billing to sync the paid sale."
          );
          return;
        }

        const paidSale =
          api.softwareSales.update(existingSale.id, {
            ...paidSoftwareSalePatchFromStripeSession(session),
          }) ?? existingSale;
        await finalizePaidSoftwareSale(paidSale);
        window.history.replaceState({}, "", "/checkout");
      } catch (err) {
        if (cancelled) return;
        setInvoiceDeliveryStatus(null);
        setPaymentFailureMessage(err instanceof Error ? err.message : "Stripe Checkout could not be verified.");
      }
    }

    void recoverCompletedStripeCheckout();
    return () => {
      cancelled = true;
    };
  }, []);

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setHasCreatedPlan(false);
    setIsPaymentStep(false);
    setPaymentFailureMessage(null);
    setCheckoutSignatures(emptyCheckoutSignatures());
    setViewedCheckoutForms({});
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  function selectTerm(months: PlanTermMonths) {
    setTermMonths(months);
    setIsPaymentStep(false);
    setCheckoutSignatures(emptyCheckoutSignatures());
    setViewedCheckoutForms({});
    setError(null);
  }

  function setCheckoutSignatureField<K extends keyof CheckoutSignatureState>(
    formId: string,
    key: K,
    value: CheckoutSignatureState[K]
  ) {
    setError(null);
    setCheckoutSignatures((prev) => ({
      ...prev,
      [formId]: {
        ...(prev[formId] ?? { signerName: "", authorized: false }),
        [key]: value,
        signedAt: key === "signedAt" ? (value as string | undefined) : undefined,
      },
    }));
  }

  function setSeats(nextSeats: number) {
    setField("seats", String(normalizeSoftwareUserCount(nextSeats)));
  }

  function getPlanValidationError() {
    if (!form.agencyName.trim()) return "Add the agency name.";
    if (!form.contactName.trim()) return "Add the billing contact.";
    if (!hasValidBillingEmail) return "Add a valid billing email.";
    if (!form.phone.trim()) return "Add the billing phone number.";
    if (!hasSelectedUsers) return "Select how many users need access.";
    return null;
  }

  function createPlan() {
    const validationError = getPlanValidationError();
    if (validationError) return setError(validationError);
    setError(null);
    setIsPaymentStep(false);
    setHasCreatedPlan(true);
  }

  function getPaymentValidationError() {
    if (!hasViewedAllCheckoutForms) {
      const nextForm = REQUIRED_CHECKOUT_FORMS.find((requiredForm) => !viewedCheckoutForms[requiredForm.id]);
      return `View ${nextForm?.title ?? "all required checkout documents"} before processing payment.`;
    }
    if (!hasSignedCheckoutForms) {
      const nextForm = REQUIRED_CHECKOUT_FORMS.find((requiredForm) => !checkoutSignatures[requiredForm.id]?.signedAt);
      return `E-sign ${nextForm?.title ?? "each required checkout document"} before processing payment.`;
    }
    return null;
  }

  function continueToPayment() {
    const validationError = getPlanValidationError();
    if (validationError) return setError(validationError);
    if (!hasCreatedPlan) return setError("Create the plan before continuing to payment.");
    setError(null);
    setCheckoutSignatures((prev) => {
      const next = { ...prev };
      REQUIRED_CHECKOUT_FORMS.forEach((requiredForm) => {
        const existing = next[requiredForm.id] ?? { signerName: "", authorized: false };
        next[requiredForm.id] = {
          ...existing,
          signerName: existing.signerName.trim() ? existing.signerName : form.contactName.trim(),
        };
      });
      return next;
    });
    setIsPaymentStep(true);
  }

  function markCheckoutFormViewed(formId: string) {
    setViewedCheckoutForms((prev) =>
      prev[formId] ? prev : { ...prev, [formId]: new Date().toISOString() }
    );
    setError(null);
  }

  function signCheckoutForm(formId: string) {
    const requiredForm = REQUIRED_CHECKOUT_FORMS.find((formRow) => formRow.id === formId);
    const signature = checkoutSignatures[formId] ?? { signerName: "", authorized: false };
    if (!viewedCheckoutForms[formId]) {
      return setError(`View ${requiredForm?.title ?? "this document"} before signing.`);
    }
    if (!signature.signerName.trim()) {
      return setError(`Type your full legal name to sign ${requiredForm?.title ?? "this document"}.`);
    }
    if (!signature.authorized) {
      return setError(`Confirm your authority and intent to sign ${requiredForm?.title ?? "this document"}.`);
    }
    const signedAt = new Date().toISOString();
    const nextSignature = {
      ...signature,
      signerName: signature.signerName.trim(),
      authorized: true,
      signedAt,
    };
    setCheckoutSignatures((prev) => ({
      ...prev,
      [formId]: nextSignature,
    }));
    setError(null);
  }

  async function finalizePaidSoftwareSale(sale: SoftwareSale) {
    setSubmitted(sale);
    setInvoiceDeliveryStatus("Sending invoice email...");
    const result = await sendSoftwareSaleInvoiceEmail(sale);
    const updatedSale = api.softwareSales.update(sale.id, {
      status: result.ok && result.result?.status === "sent" ? "provisioning" : sale.status,
      ...softwareSaleInvoicePatchFromResult(result),
    });
    const saleForProvisioning = updatedSale ?? sale;
    setSubmitted(saleForProvisioning);
    if (result.ok && result.result?.status === "sent") {
      provisionAgencyForCompletedSale(saleForProvisioning);
      const closedSale = api.softwareSales.update(saleForProvisioning.id, { status: "closed" }) ?? saleForProvisioning;
      setSubmitted(closedSale);
      await db.syncNow();
      setInvoiceDeliveryStatus(`Invoice email sent through ${result.result.provider}.`);
    } else {
      await db.syncNow();
      setInvoiceDeliveryStatus(result.result?.error ?? result.error ?? "Invoice email could not be sent.");
    }
  }

  async function submitTransaction() {
    const validationError = getPlanValidationError();
    if (validationError) return setError(validationError);
    if (!hasCreatedPlan) return setError("Create the plan before continuing to payment.");
    if (!isPaymentStep) return setError("Continue to payment before processing the transaction.");
    const paymentValidationError = getPaymentValidationError();
    if (paymentValidationError) return setError(paymentValidationError);
    setPaymentFailureMessage(null);
    setStripeStarting(true);
    const signedAgreements: SoftwareSaleSignedAgreement[] = REQUIRED_CHECKOUT_FORMS.map((requiredForm) => ({
      id: requiredForm.id,
      title: requiredForm.title,
      summary: requiredForm.summary,
      version: requiredForm.version,
      viewedAt: viewedCheckoutForms[requiredForm.id],
      signedAt: checkoutSignatures[requiredForm.id].signedAt!,
      signedByName: checkoutSignatures[requiredForm.id].signerName.trim(),
      signedByEmail: form.email.trim(),
      signatureStatement: requiredForm.signatureStatement,
      electronicRecordConsent: requiredForm.id === "electronic-records-consent" || hasSignedCheckoutForms,
      signatureMethod: "typed_name_with_checkbox",
      signerUserAgent: navigator.userAgent,
    }));
    const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
    const finalSignedAt = signedAtValues[signedAtValues.length - 1]!;
    const primarySignerName = signedAgreements[0]?.signedByName ?? form.contactName.trim();

    let sale: SoftwareSale;
    try {
      sale = api.softwareSales.create({
        agencyName: form.agencyName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        product: form.product,
        tier: billingTier,
        seats,
        estimatedMonthly,
        setupFee,
        websiteAppAddOn: effectiveWebsiteAppAddOn,
        websiteAppAddOnMonthly,
        termMonths,
        termDiscountPercent: selectedTerm.discountPercent,
        termDiscountMonthly,
        monthlyBeforeTermDiscount,
        source: "transaction_site",
        paymentMode: "stripe_checkout",
        status: "checkout_pending",
        notes: form.notes.trim() || undefined,
        signedAgreementNames: signedAgreements.map((agreement) => agreement.title),
        signedAgreements,
        signedByName: primarySignerName,
        signedByEmail: form.email.trim(),
        signedAt: finalSignedAt,
      });
    } catch {
      setSubmitted(null);
      setInvoiceDeliveryStatus(null);
      setPaymentFailureMessage("Payment failed. Try a different payment method.");
      setStripeStarting(false);
      return;
    }
    setError(null);
    await db.syncNow();

    try {
      const origin = window.location.origin;
      const session = await createSoftwareSaleStripeCheckoutSession(sale, {
        successUrl: `${origin}/checkout?stripe_success=1&session_id={CHECKOUT_SESSION_ID}&sale_id=${encodeURIComponent(
          sale.id
        )}`,
        cancelUrl: `${origin}/checkout?stripe_cancelled=1&sale_id=${encodeURIComponent(sale.id)}`,
      });
      if (!session.ok || !session.url) {
        setPaymentFailureMessage(session.message || session.error || "Stripe Checkout could not be started.");
        setStripeStarting(false);
        return;
      }
      api.softwareSales.update(sale.id, { stripeCheckoutSessionId: session.id });
      await db.syncNow();
      window.location.assign(session.url);
    } catch (err) {
      setPaymentFailureMessage(err instanceof Error ? err.message : "Stripe Checkout could not be started.");
      setStripeStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080807] text-white">
      <header className="border-b border-white/10 bg-[#0f0e0b]">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-5 py-4 sm:px-6 xl:px-8">
          <div className="flex items-center gap-3">
            <QuotexMark
              className="h-10 w-10 border border-white/15"
              letterClassName="text-[25px]"
            />
            <div>
              <div className="font-display text-lg leading-none">Quotex Plan Builder</div>
              <div className="text-xs text-white/55">Secure subscription checkout</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs text-white/55 sm:flex">
            <LockKeyhole className="h-4 w-4 text-gold-300" />
            Billing intake only
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1320px] gap-6 px-5 py-8 sm:px-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:px-8 xl:py-12">
        <section className="rounded-lg border border-white/10 bg-[#11100c] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.35)] md:p-7">
          {paymentFailureMessage ? (
            <div className="grid min-h-[520px] place-items-center text-center">
              <div className="max-w-md">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-400/10 text-red-300">
                  <XCircle className="h-8 w-8" />
                </div>
                <h1 className="mt-5 font-display text-4xl">Payment failed</h1>
                <p className="mt-3 text-sm leading-relaxed text-white/65">
                  Try a different payment method. No invoice or agency code will be issued until
                  the payment is successful.
                </p>
                <div className="mt-6 rounded-md border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {paymentFailureMessage}
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    className="btn-gold"
                    onClick={() => {
                      setPaymentFailureMessage(null);
                      setSubmitted(null);
                      setIsPaymentStep(true);
                    }}
                  >
                    Try a different payment method
                  </button>
                  <button
                    type="button"
                    className={darkSecondaryButtonClass}
                    onClick={() => {
                      setPaymentFailureMessage(null);
                      setSubmitted(null);
                      setIsPaymentStep(false);
                    }}
                  >
                    Back to plan
                  </button>
                </div>
              </div>
            </div>
          ) : submitted ? (
            <div className="grid min-h-[520px] place-items-center text-center">
              <div className="max-w-md">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h1 className="mt-5 font-display text-4xl">Successful. Welcome to Quotex.</h1>
                <p className="mt-3 text-sm leading-relaxed text-white/65">
                  Payment was successful. {submitted.agencyName} is now in the master billing
                  queue with plan record {submitted.id}. The formal invoice and agency code are
                  emailed to {submitted.email}.
                </p>
                <div className="mt-6 rounded-md border border-white/10 bg-white/[0.04] p-4 text-left text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-white/55">Users</span>
                    <span className="font-medium">{submitted.seats}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-white/55">Product</span>
                    <span className="font-medium text-right">
                      {SOFTWARE_PRODUCT_OPTIONS[submitted.product ?? "full_platform"].label}
                    </span>
                  </div>
                  {softwareProductSupportsWebsiteAppAddOns(submitted.product) && (
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-white/55">Website / Quotex app add-on</span>
                    <span className="font-medium text-right">
                      {WEBSITE_APP_ADD_ON_OPTIONS[submitted.websiteAppAddOn ?? "none"].label}
                      {submitted.websiteAppAddOnMonthly
                        ? ` + ${fmt.money(submitted.websiteAppAddOnMonthly)}/mo`
                        : ""}
                    </span>
                  </div>
                  )}
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-white/55">Agency code</span>
                    <span className="font-medium">{softwareSaleAgencyCode(submitted)}</span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-white/55">E-signed forms</span>
                    <span className="font-medium text-right">
                      {submitted.signedAt
                        ? `${submitted.signedAgreementNames?.length ?? REQUIRED_CHECKOUT_FORMS.length} forms by ${submitted.signedByName ?? submitted.contactName}`
                        : "Pending"}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4">
                    <span className="text-white/55">Term</span>
                    <span className="font-medium text-right">
                      {submitted.termMonths ?? 12} months
                      {submitted.termDiscountPercent
                        ? ` - ${submitted.termDiscountPercent}% monthly discount`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between gap-4 border-t border-white/10 pt-3">
                    <span className="text-white/55">Monthly total</span>
                    <span className="font-medium">{fmt.money(submitted.estimatedMonthly)}/mo</span>
                  </div>
                  <div className="mt-3 rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs leading-relaxed text-emerald-100">
                    The billing email receives a formal invoice with the encrypted agency code
                    and plan details once checkout is completed.
                  </div>
                  {invoiceDeliveryStatus && (
                    <div className="mt-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-white/65">
                      {invoiceDeliveryStatus}
                    </div>
                  )}
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <a
                    href={employeeLoginHref}
                    className="btn bg-gold-500 text-white hover:bg-gold-600"
                  >
                    Continue to portal
                  </a>
                  <button
                    type="button"
                    className={darkSecondaryButtonClass}
                    onClick={() => {
                      setSubmitted(null);
                      setInvoiceDeliveryStatus(null);
                      setPaymentFailureMessage(null);
                      setHasCreatedPlan(false);
                      setIsPaymentStep(false);
                      setTermMonths(12);
                      setCheckoutSignatures(emptyCheckoutSignatures());
                      setViewedCheckoutForms({});
                      setViewingCheckoutFormId(null);
                      setForm({
                        agencyName: "",
                        contactName: "",
                        email: "",
                        phone: "",
                        website: "",
                        product: "full_platform",
                        seats: "",
                        websiteAppAddOn: "none",
                        notes: "",
                      });
                    }}
                  >
                    Build another plan
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-gold-300">
                    {isPaymentPage ? "Payment" : isPlanReviewPage ? "Plan review" : "Plan builder"}
                  </div>
                  <h1 className="mt-2 font-display text-4xl md:text-5xl">
                    {isPaymentPage
                      ? "Complete payment."
                      : isPlanReviewPage
                        ? "Review your monthly plan."
                        : "Build your monthly software plan."}
                  </h1>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/65">
                    {isPaymentPage
                      ? "Enter payment details to activate provisioning, send the formal invoice, and issue the agency code."
                      : isPlanReviewPage
                        ? "Confirm the monthly pricing before moving to the payment page."
                        : "Enter the agency billing details first, choose how many staff users need access, then select the optional company website or Quotex app activation."}
                  </p>
                </div>
                <CreditCard className="hidden h-8 w-8 shrink-0 text-gold-300 sm:block" />
              </div>

              {isPlanBuilderPage && (
                <>
                  <section className="mb-7 rounded-lg border border-white/10 bg-[#0f0e0b] p-5">
                    <div className="mb-4">
                      <div className="text-xs uppercase tracking-wider text-gold-300">Agency billing details</div>
                      <h2 className="mt-1 font-display text-2xl">Who is this plan for?</h2>
                    </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-agency-name">Agency name</label>
                    <input
                      id="transaction-agency-name"
                      className={darkInputClass}
                      value={form.agencyName}
                      onChange={(e) => setField("agencyName", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-contact-name">Billing contact</label>
                    <input
                      id="transaction-contact-name"
                      className={darkInputClass}
                      value={form.contactName}
                      onChange={(e) => setField("contactName", e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-email">Billing email</label>
                    <input
                      id="transaction-email"
                      className={darkInputClass}
                      type="email"
                      value={form.email}
                      onChange={(e) => setField("email", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-phone">Phone</label>
                    <input
                      id="transaction-phone"
                      className={darkInputClass}
                      value={form.phone}
                      onChange={(e) => setField("phone", e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-website">Current agency website (optional)</label>
                    <input
                      id="transaction-website"
                      className={darkInputClass}
                      placeholder="https://"
                      value={form.website}
                      onChange={(e) => setField("website", e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={darkLabelClass} htmlFor="transaction-notes">Provisioning notes (optional)</label>
                    <textarea
                      id="transaction-notes"
                      className={`${darkInputClass} min-h-[92px]`}
                      value={form.notes}
                      onChange={(e) => setField("notes", e.target.value)}
                      placeholder="Custom domain, preferred launch date, billing notes..."
                    />
                  </div>
                </div>
                  </section>

                  <section className="mb-7 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="p-5">
                    <div className="text-xs uppercase tracking-wider text-gold-300">Users</div>
                    <h2 className="mt-1 font-display text-2xl">How many users do you need?</h2>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/58">
                      Select the staff seats your agency needs now. The full monthly plan,
                      discounts, and add-ons are calculated after you create the plan.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-100">
                        Add users any time after checkout
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-white/10 bg-[#171510] p-5 lg:border-l lg:border-t-0">
                    <label className={darkLabelClass} htmlFor="transaction-seats">
                      Staff users
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`${darkSecondaryButtonClass} h-12 w-12 px-0`}
                        onClick={() => setSeats(hasSelectedUsers ? seats - 1 : 1)}
                        aria-label="Decrease users"
                        disabled={!hasSelectedUsers}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <input
                        id="transaction-seats"
                        className={`${darkInputClass} h-12 !w-24 flex-none text-center text-xl font-semibold`}
                        type="number"
                        min={1}
                        max={999}
                        value={form.seats}
                        onChange={(e) => setField("seats", e.target.value)}
                      />
                      <button
                        type="button"
                        className={`${darkSecondaryButtonClass} h-12 w-12 px-0`}
                        onClick={() => setSeats(hasSelectedUsers ? seats + 1 : 1)}
                        aria-label="Increase users"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {QUICK_USER_COUNTS.map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={`btn justify-center px-2 text-xs ${
                            hasSelectedUsers && seats === count
                              ? "border-gold-300 bg-gold-300 text-ink-950"
                              : "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]"
                          }`}
                          onClick={() => setSeats(count)}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                    <div className="mt-4 min-h-[42px] rounded-md border border-white/10 bg-black/10 px-3 py-2 text-xs font-semibold leading-snug text-emerald-200">
                      {hasSelectedUsers
                        ? `${seats} staff user${seats === 1 ? "" : "s"} selected for this plan.`
                        : "Select the exact user count or use a quick preset."}
                    </div>
                  </div>
                </div>
                  </section>

                  {supportsWebsiteAppAddOns && (
                  <section className="mb-7 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-wider text-gold-300">Optional monthly add-ons</div>
                  <h2 className="mt-1 font-display text-2xl">Company website and Quotex app.</h2>
                  <p className="mt-1 text-xs text-white/55">
                    Select the separate agency website, Quotex app activation, or bundled website and app.
                    The final monthly price below includes whichever option you choose.
                  </p>
                </div>
                <div className="grid gap-3">
                  {(Object.keys(WEBSITE_APP_ADD_ON_OPTIONS) as SoftwareSaleWebsiteAppAddOn[]).map((addOn) => {
                    const option = WEBSITE_APP_ADD_ON_OPTIONS[addOn];
                    const selected = form.websiteAppAddOn === addOn;
                    return (
                      <button
                        key={addOn}
                        type="button"
                        onClick={() => setField("websiteAppAddOn", addOn)}
                        className={`flex min-h-[92px] rounded-lg border p-4 text-left transition ${
                          selected
                            ? "border-gold-300 bg-gold-300/10 shadow-sm ring-2 ring-gold-300/20"
                            : "border-white/10 bg-[#171510] hover:border-gold-300/60 hover:bg-[#1d1a13]"
                        }`}
                      >
                        <div className="flex h-full w-full items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-white">
                              <span className="text-gold-300">{addOnIcon(addOn)}</span>
                              {option.label}
                            </div>
                            <div className="mt-1 text-xs leading-relaxed text-white/55">
                              {option.description}
                            </div>
                            <div className="mt-3 text-lg font-semibold leading-tight text-gold-100">
                              {option.monthlyPriceUsd > 0 ? `${fmt.money(option.monthlyPriceUsd)}/mo` : "No add-on charge"}
                            </div>
                            {addOn === "website_app" && (
                              <div className="mt-1 text-sm font-bold leading-tight text-emerald-200">
                                Bundle saves you $1,000 per month
                              </div>
                            )}
                          </div>
                          <div className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white/70">
                            {selected ? "Selected" : "Choose"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                  </section>
                  )}
                </>
              )}

              <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
                {isPlanReviewPage && (
                  <section className="rounded-lg border border-gold-300/30 bg-[#0f0e0b] p-5 text-white shadow-[0_18px_55px_rgba(0,0,0,0.2)]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-sm text-gold-200">
                        <ReceiptText className="h-4 w-4" />
                        Final monthly plan
                      </div>
                      <button
                        type="button"
                        className={darkSecondaryButtonClass}
                        onClick={() => {
                          setHasCreatedPlan(false);
                          setIsPaymentStep(false);
                        }}
                      >
                        Edit plan
                      </button>
                    </div>

                    <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                      <div className="space-y-3 p-4 text-sm">
                        <div className="flex items-start justify-between gap-5">
                          <div>
                            <div className="font-semibold text-white">Staff users</div>
                            <div className="mt-0.5 text-xs text-white/45">
                              {seats} x {fmt.money(productSeatPrice)}
                            </div>
                          </div>
                          <div className="font-semibold">{fmt.money(userSubtotal)}/mo</div>
                        </div>
                        <div className="flex items-start justify-between gap-5">
                          <div>
                            <div className="font-semibold text-white">Product</div>
                            <div className="mt-0.5 text-xs text-white/45">
                              {SOFTWARE_PRODUCT_OPTIONS[form.product].description}
                            </div>
                          </div>
                          <div className="font-semibold text-right">
                            {SOFTWARE_PRODUCT_OPTIONS[form.product].shortLabel}
                          </div>
                        </div>
                        {supportsWebsiteAppAddOns && (
                        <div className="flex items-start justify-between gap-5">
                          <div>
                            <div className="font-semibold text-white">Website / Quotex app package</div>
                            <div className="mt-0.5 text-xs text-white/45">
                              {WEBSITE_APP_ADD_ON_OPTIONS[effectiveWebsiteAppAddOn].label}
                            </div>
                          </div>
                          <div className="font-semibold">
                            {websiteAppRetailMonthly > 0 ? `${fmt.money(websiteAppRetailMonthly)}/mo` : "None"}
                          </div>
                        </div>
                        )}
                        {bundleDiscount > 0 && (
                          <div className="flex items-start justify-between gap-5">
                            <div>
                              <div className="font-semibold text-white">Website + app bundle discount</div>
                              <div className="mt-0.5 text-xs text-white/45">
                                Bundle selected
                              </div>
                            </div>
                            <div className="font-semibold text-emerald-200">-{fmt.money(bundleDiscount)}/mo</div>
                          </div>
                        )}
                        <div className="rounded-lg border border-white/10 bg-black/15 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="font-semibold text-white">Term length</div>
                              <div className="mt-0.5 text-xs text-white/45">
                                Longer commitments reduce the monthly software plan. You can renew
                                your term at any time.
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 sm:w-[24rem]">
                              {TERM_OPTIONS.map((term) => {
                                const selected = termMonths === term.months;
                                return (
                                  <button
                                    key={term.months}
                                    type="button"
                                    className={`rounded-md border px-3 py-2 text-center text-xs font-semibold transition ${
                                      selected
                                        ? "border-gold-300 bg-gold-300 text-ink-950"
                                        : "border-white/10 bg-white/[0.06] text-white hover:border-gold-300/60 hover:bg-white/[0.1]"
                                    }`}
                                    onClick={() => selectTerm(term.months)}
                                  >
                                    <span className="block">{term.label}</span>
                                    <span className={`mt-0.5 block text-[10px] ${selected ? "text-ink-700" : "text-white/45"}`}>
                                      {term.discountPercent ? `${term.discountPercent}% off` : "Standard"}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                        {termDiscountMonthly > 0 && (
                          <div className="flex items-start justify-between gap-5">
                            <div>
                              <div className="font-semibold text-white">
                                {selectedTerm.label} term discount
                              </div>
                              <div className="mt-0.5 text-xs text-white/45">
                                {selectedTerm.discountPercent}% off after selected add-ons.
                              </div>
                            </div>
                            <div className="font-semibold text-emerald-200">-{fmt.money(termDiscountMonthly)}/mo</div>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-gold-300/30 bg-gold-300/10 p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gold-100">
                              Final monthly price
                            </div>
                            <p className="mt-2 max-w-md text-sm leading-relaxed text-white/60">
                              Includes selected users and add-ons. First month is charged at checkout.
                            </p>
                          </div>
                          <div className="text-left sm:text-right">
                            {totalMonthlyDiscount > 0 && (
                              <div className="text-lg font-semibold text-red-300 line-through decoration-red-400 decoration-1">
                                {fmt.money(undiscountedMonthly)}/mo
                              </div>
                            )}
                            <div className="mt-1 text-3xl font-semibold leading-none text-white md:text-4xl">
                              {fmt.money(estimatedMonthly)}
                              <span className="ml-1 text-base text-white/70">/mo</span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs leading-relaxed text-emerald-100">
                          After payment, a formal invoice and encrypted agency code are emailed to
                          the billing email above.
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {error && (
                  <div className="rounded-md border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                    {error}
                  </div>
                )}

                {isPlanReviewPage && (
                  <div className="rounded-md border border-gold-300/30 bg-gold-300/10 px-4 py-3 text-sm text-gold-50">
                    The selected plan will be recorded for master billing and the formal invoice
                    workflow.
                  </div>
                )}

                {isPaymentPage && (
                  <section className="rounded-lg border border-white/10 bg-[#0f0e0b] p-5 text-white">
                    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-wider text-gold-300">Payment</div>
                        <h2 className="mt-1 font-display text-2xl">Secure Stripe Checkout.</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
                          After the required checkout documents are signed, payment opens in Stripe.
                          Quotex does not collect or store card or bank numbers on this page.
                        </p>
                      </div>
                      <button
                        type="button"
                        className={darkSecondaryButtonClass}
                        onClick={() => setIsPaymentStep(false)}
                      >
                        Back to plan
                      </button>
                    </div>

                    <div className="mb-5 rounded-lg border border-gold-300/25 bg-gold-300/[0.06] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-gold-100">
                            <PenLine className="h-4 w-4 text-gold-300" />
                            E-sign required before payment
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-white/55">
                            Payment cannot be processed until the billing contact signs the required
                            checkout forms for this plan. Each document must be opened and signed
                            individually.
                          </p>
                        </div>
                        <div
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            hasSignedCheckoutForms
                              ? "bg-emerald-400/10 text-emerald-200"
                              : "bg-white/[0.06] text-white/55"
                          }`}
                        >
                          {signedCheckoutFormCount}/{REQUIRED_CHECKOUT_FORMS.length} signed
                        </div>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {REQUIRED_CHECKOUT_FORMS.map((requiredForm) => {
                          const viewed = !!viewedCheckoutForms[requiredForm.id];
                          const signature = checkoutSignatures[requiredForm.id];
                          const signatureAttached = !!signature?.signedAt;
                          return (
                            <div
                              key={requiredForm.id}
                              className={`flex min-h-[8.25rem] flex-col justify-between rounded-md border px-3 py-3 transition ${
                                signatureAttached
                                  ? "border-emerald-300/25 bg-emerald-400/[0.08]"
                                  : viewed
                                    ? "border-gold-300/30 bg-black/15"
                                    : "border-white/10 bg-black/15"
                              }`}
                            >
                              <div>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex min-w-0 items-start gap-2">
                                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
                                    <div className="min-w-0">
                                      <div className="text-[13px] font-semibold leading-snug text-white">
                                        {requiredForm.title}
                                      </div>
                                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                                        {requiredForm.version}
                                      </div>
                                    </div>
                                  </div>
                                  {signatureAttached && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-200" />}
                                </div>
                                <div className="mt-3 min-h-[1.25rem] text-xs leading-snug text-white/50">
                                  {signatureAttached
                                    ? `Signed by ${signature.signerName.trim()}`
                                    : viewed
                                      ? "Viewed. Ready for signature."
                                      : "Open before signing."}
                                </div>
                              </div>

                              <div className="mt-3 flex items-center justify-between gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                    signatureAttached
                                      ? "bg-emerald-400/10 text-emerald-200"
                                      : viewed
                                        ? "bg-gold-300/10 text-gold-100"
                                        : "bg-white/[0.06] text-white/55"
                                  }`}
                                >
                                  {signatureAttached ? "Signed" : viewed ? "Ready" : "Required"}
                                </span>
                                <button
                                  type="button"
                                  className={`${darkSecondaryButtonClass} h-8 px-3 text-xs`}
                                  onClick={() => setViewingCheckoutFormId(requiredForm.id)}
                                >
                                  {signatureAttached ? "View" : viewed ? "Sign" : "View"}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-3 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-relaxed text-white/55">
                        Each signature is attached to its document with signer name, billing email,
                        authorization checkbox, timestamp, and checkout record.
                      </div>
                    </div>

                    <div className="rounded-lg border border-emerald-300/25 bg-emerald-400/[0.08] p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                            <LockKeyhole className="h-4 w-4 text-emerald-200" />
                            Stripe will collect the payment method
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-white/55">
                            The checkout session includes the selected plan total of {fmt.money(estimatedMonthly)}/mo.
                            After Stripe confirms payment, the invoice and agency code are emailed to {form.email.trim()}.
                          </p>
                        </div>
                        <div className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-white/65">
                          Hosted checkout
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {isPlanReviewPage ? (
                  <button
                    type="button"
                    className="btn-gold w-full justify-center py-3 text-base"
                    onClick={continueToPayment}
                  >
                    Continue to payment <ArrowRight className="h-5 w-5" />
                  </button>
                ) : isPaymentPage ? (
                  <button
                    type="button"
                    className={`btn-gold w-full justify-center py-3 text-base ${
                      hasSignedCheckoutForms && !stripeStarting ? "" : "cursor-not-allowed opacity-45"
                    }`}
                    disabled={!hasSignedCheckoutForms || stripeStarting}
                    onClick={submitTransaction}
                  >
                    {stripeStarting
                      ? "Opening secure checkout..."
                      : hasSignedCheckoutForms
                        ? "Continue to secure Stripe checkout"
                        : "Sign all documents to continue"}{" "}
                    <ArrowRight className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-gold w-full justify-center py-3 text-base"
                    onClick={createPlan}
                  >
                    Create plan <ArrowRight className="h-5 w-5" />
                  </button>
                )}
              </form>
            </>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-[#11100c] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-gold-300" />
              Transaction controls
            </div>
            <ul className="mt-4 space-y-3 text-sm text-white/65">
              {TRUST_POINTS.map((point) => (
                <li key={point} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>

      <Modal
        open={!!viewingCheckoutForm}
        onClose={() => setViewingCheckoutFormId(null)}
        title={viewingCheckoutForm?.title ?? "Checkout document"}
        size="lg"
      >
        {viewingCheckoutForm && (
          <div className="space-y-5 text-sm text-ink-700">
            <div className="rounded-lg border border-ink-100 bg-ink-50 p-4">
              <div className="text-xs uppercase tracking-wider text-ink-500">Document preview</div>
              <h3 className="mt-1 text-lg font-semibold text-ink-950">{viewingCheckoutForm.title}</h3>
              <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-500">
                Version {viewingCheckoutForm.version}
              </div>
              <p className="mt-2 leading-relaxed">{viewingCheckoutForm.summary}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Agency</div>
                <div className="mt-1 font-semibold text-ink-950">{form.agencyName || "Pending agency"}</div>
              </div>
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Billing contact</div>
                <div className="mt-1 font-semibold text-ink-950">{form.contactName || "Pending signer"}</div>
              </div>
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Selected users</div>
                <div className="mt-1 font-semibold text-ink-950">{seats} users</div>
              </div>
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Selected term</div>
                <div className="mt-1 font-semibold text-ink-950">
                  {termMonths} months
                  {selectedTerm.discountPercent ? ` - ${selectedTerm.discountPercent}% off` : ""}
                </div>
              </div>
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Term discount</div>
                <div className="mt-1 font-semibold text-ink-950">
                  {termDiscountMonthly ? `${fmt.money(termDiscountMonthly)}/mo` : "None"}
                </div>
              </div>
              <div className="rounded-md border border-ink-100 p-3">
                <div className="text-xs uppercase tracking-wider text-ink-500">Monthly plan</div>
                <div className="mt-1 font-semibold text-ink-950">{fmt.money(estimatedMonthly)}/mo</div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-ink-100 p-4">
              <div className="font-semibold text-ink-950">Agreement terms</div>
              <ul className="space-y-2 text-sm leading-relaxed">
                {viewingCheckoutForm.body.map((paragraph) => (
                  <li key={paragraph}>{paragraph}</li>
                ))}
              </ul>
            </div>

            {viewingCheckoutSignature?.signedAt ? (
              <div className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm [color-scheme:light]">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Electronic signature attached to this document
                </div>
                <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50 px-4 py-4">
                  <div
                    className="text-4xl leading-none text-ink-950"
                    style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}
                  >
                    {viewingCheckoutSignature.signerName.trim()}
                  </div>
                </div>
                <div className="mt-2 text-xs leading-relaxed text-emerald-800">
                  Signed by {viewingCheckoutSignature.signerName.trim()} for {form.agencyName || "this agency"} using {form.email.trim()} on{" "}
                  {new Date(viewingCheckoutSignature.signedAt).toLocaleString()}.
                </div>
              </div>
            ) : viewingCheckoutFormViewed ? (
              <div className="space-y-4 rounded-xl border border-gold-200 bg-white p-4 shadow-sm [color-scheme:light]">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500" htmlFor={`signature-${viewingCheckoutForm.id}`}>
                    Typed electronic signature for this document
                  </label>
                  <input
                    id={`signature-${viewingCheckoutForm.id}`}
                    className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-200"
                    value={viewingCheckoutSignature?.signerName ?? ""}
                    placeholder={form.contactName.trim() || "Full legal name"}
                    onChange={(e) =>
                      setCheckoutSignatureField(viewingCheckoutForm.id, "signerName", e.target.value)
                    }
                  />
                  <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50 px-4 py-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                      Signature preview
                    </div>
                    <div
                      className="mt-2 min-h-[2.25rem] text-4xl leading-none text-ink-950"
                      style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}
                    >
                      {(viewingCheckoutSignature?.signerName ?? "").trim() || form.contactName.trim() || "Full legal name"}
                    </div>
                  </div>
                </div>
                <label className="flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-3 text-left text-sm text-ink-700">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-ink-300 accent-gold-600"
                    checked={!!viewingCheckoutSignature?.authorized}
                    onChange={(e) =>
                      setCheckoutSignatureField(viewingCheckoutForm.id, "authorized", e.target.checked)
                    }
                  />
                  <span>
                    {viewingCheckoutForm.signatureStatement} I am authorized to sign for{" "}
                    {form.agencyName.trim() || "this agency"} and intend my typed name to be my
                    electronic signature on this document.
                  </span>
                </label>
                <button
                  type="button"
                  className="btn-gold w-full justify-center"
                  onClick={() => signCheckoutForm(viewingCheckoutForm.id)}
                >
                  Sign this document
                </button>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
              <div className="text-xs text-ink-500">
                Each document must be viewed and signed individually before payment.
              </div>
              {!viewingCheckoutFormViewed ? (
                <button
                  type="button"
                  className="btn-gold"
                  onClick={() => markCheckoutFormViewed(viewingCheckoutForm.id)}
                >
                  I viewed this document
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => setViewingCheckoutFormId(null)}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <footer className="px-5 pb-8">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-0 text-xs text-white/35 sm:px-1 xl:px-3">
          <span>Quotex monthly software plan builder</span>
          <a href={masterLoginHref} className="text-[10px] uppercase tracking-wider text-white/25 hover:text-white/55">
            System
          </a>
        </div>
      </footer>
    </div>
  );
}

export function CheckoutRemoteSignPage() {
  const { packetId = "" } = useParams<{ packetId: string }>();
  const initialPayload =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("p") : null;
  const [packet, setPacket] = useState<RemoteCheckoutPacket | null>(() => {
    return readRemoteSigningPacket(packetId) ?? decodeRemotePacketPayload(packetId, initialPayload);
  });
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingPacket, setSubmittingPacket] = useState(false);
  const [paymentRedirecting, setPaymentRedirecting] = useState(false);
  const [paymentStatusMessage, setPaymentStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const previousBackground = document.body.style.background;
    const previousColorScheme = document.body.style.colorScheme;
    document.body.style.background = "#080807";
    document.body.style.colorScheme = "dark";
    return () => {
      document.body.style.background = previousBackground;
      document.body.style.colorScheme = previousColorScheme;
    };
  }, []);

  useEffect(() => {
    if (packet) writeRemoteSigningPacket(packet);
  }, [packet]);

  useEffect(() => {
    let active = true;
    void readSharedRemoteSigningPacket(packetId).then((sharedPacket) => {
      if (!active || !sharedPacket) return;
      setPacket((current) => {
        if (!current) return sharedPacket;
        if (sharedPacket.submittedAt && !current.submittedAt) return sharedPacket;
        return sharedPacket.updatedAt > current.updatedAt ? sharedPacket : current;
      });
    });
    return () => {
      active = false;
    };
  }, [packetId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id")?.trim();
    const stripeSuccess = params.get("stripe_success") === "1";
    const stripeCancelled = params.get("stripe_cancelled") === "1";

    if (!stripeSuccess && !stripeCancelled) return;

    const cleanPath = `/checkout/sign/${encodeURIComponent(packetId)}`;
    let active = true;
    if (stripeCancelled) {
      setPaymentRedirecting(false);
      setPaymentStatusMessage(null);
      setError("Stripe Checkout was cancelled before the payment method was saved.");
      window.history.replaceState({}, "", cleanPath);
      return () => {
        active = false;
      };
    }

    void (async () => {
      setError(null);
      setPaymentRedirecting(false);
      setPaymentStatusMessage("Payment method received. Submitting signed documents to Quotex.");

      try {
        if (!sessionId) throw new Error("Stripe Checkout returned without a session id.");
        const checkout = await getSoftwareSaleStripeCheckoutSession(sessionId);
        const checkoutSession = checkout.session;
        if (
          !checkout.ok ||
          !checkoutSession ||
          (checkoutSession.status !== "complete" && checkoutSession.paymentStatus !== "paid")
        ) {
          throw new Error(checkout.message || checkout.error || "Stripe has not confirmed the payment method yet.");
        }

        const latestPacket =
          (await readSharedRemoteSigningPacket(packetId)) ?? readRemoteSigningPacket(packetId);
        if (!latestPacket) throw new Error("The signed packet could not be loaded for submission.");
        const missingForms = missingSignedRemoteCheckoutForms(latestPacket);
        if (missingForms.length > 0) {
          throw new Error("All required documents must be signed before the payment method can submit them.");
        }

        const firstSignature = firstRemoteCheckoutSignature(latestPacket);
        const submittedAt = latestPacket.submittedAt ?? new Date().toISOString();
        const paidPacket: RemoteCheckoutPacket = {
          ...latestPacket,
          stripeCheckoutSessionId: sessionId,
          submittedAt,
          submittedByName: latestPacket.submittedByName ?? firstSignature?.signerName?.trim() ?? latestPacket.contactName,
          submittedByEmail: latestPacket.submittedByEmail ?? latestPacket.email,
          updatedAt: submittedAt,
        };
        writeRemoteSigningPacket(paidPacket);
        const sharedPacket = await writeSharedRemoteSigningPacket(paidPacket);
        const finalized = await finalizePaidRemotePacket(sharedPacket, checkoutSession);
        const finalPacket: RemoteCheckoutPacket = {
          ...finalized.packet,
          stripeCheckoutSessionId: sessionId,
          submittedAt: finalized.packet.submittedAt ?? submittedAt,
          submittedByName: finalized.packet.submittedByName ?? paidPacket.submittedByName,
          submittedByEmail: finalized.packet.submittedByEmail ?? paidPacket.submittedByEmail,
          updatedAt: new Date().toISOString(),
        };
        writeRemoteSigningPacket(finalPacket);
        const syncedFinalPacket = await writeSharedRemoteSigningPacket(finalPacket);
        await db.syncNow();

        if (!active) return;
        setPacket(syncedFinalPacket);
        setPaymentStatusMessage(finalized.status);
      } catch (err) {
        if (!active) return;
        setPaymentStatusMessage(null);
        setError(err instanceof Error ? err.message : "Payment was received, but the signed packet could not be submitted.");
      } finally {
        if (active) setPaymentRedirecting(false);
        window.history.replaceState({}, "", cleanPath);
      }
    })();

    return () => {
      active = false;
    };
  }, [packetId]);

  function updateSignature(formId: string, patch: Partial<RemoteCheckoutSignatureState>, syncShared = false) {
    setError(null);
    setPacket((prev) => {
      if (!prev) return prev;
      const next: RemoteCheckoutPacket = {
        ...prev,
        updatedAt: new Date().toISOString(),
        signatures: {
          ...prev.signatures,
          [formId]: {
            ...(prev.signatures[formId] ?? { signerName: prev.contactName, authorized: false }),
            ...patch,
          },
        },
      };
      writeRemoteSigningPacket(next);
      if (syncShared) void writeSharedRemoteSigningPacket(next).catch(() => undefined);
      return next;
    });
  }

  function viewDocument(formId: string) {
    setActiveFormId(formId);
    updateSignature(formId, {
      viewedAt: packet?.signatures[formId]?.viewedAt ?? new Date().toISOString(),
    }, true);
    window.setTimeout(() => {
      document.getElementById(`remote-packet-form-${formId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  }

  function signDocument(formId: string) {
    if (!packet) return;
    const requiredForm = REQUIRED_CHECKOUT_FORMS.find((formRow) => formRow.id === formId);
    const signature = packet.signatures[formId] ?? { signerName: packet.contactName, authorized: false };
    if (!signature.viewedAt) {
      return setError(`Open and view ${requiredForm?.title ?? "this document"} before signing.`);
    }
    if (!signature.signerName.trim()) {
      return setError(`Type your full legal name to sign ${requiredForm?.title ?? "this document"}.`);
    }
    if (!signature.authorized) {
      return setError(`Confirm your authority and intent to sign ${requiredForm?.title ?? "this document"}.`);
    }
    updateSignature(formId, {
      signerName: signature.signerName.trim(),
      authorized: true,
      signedAt: new Date().toISOString(),
      signedByEmail: packet.email,
      signerUserAgent: navigator.userAgent,
    }, true);
  }

  async function startRemoteStripeCheckout(sourcePacket: RemoteCheckoutPacket) {
    if (paymentRedirecting) return;
    const missingForms = missingSignedRemoteCheckoutForms(sourcePacket);
    if (missingForms.length > 0) {
      setError("Sign every required document before entering payment information.");
      return;
    }
    setPaymentStatusMessage(null);
    const saleId = sourcePacket.saleId?.trim() || "";
    const sale = saleId ? api.softwareSales.get(saleId) : undefined;
    setError(null);
    setPaymentRedirecting(true);
    try {
      const origin = window.location.origin;
      const session = await createSoftwareSalePacketStripeCheckoutSession({
        saleId: saleId || undefined,
        signingPacketId: sourcePacket.id,
        successUrl: `${origin}/checkout/sign/${encodeURIComponent(
          sourcePacket.id
        )}?stripe_success=1&session_id={CHECKOUT_SESSION_ID}${saleId ? `&sale_id=${encodeURIComponent(saleId)}` : ""}`,
        cancelUrl: `${origin}/checkout/sign/${encodeURIComponent(sourcePacket.id)}?stripe_cancelled=1`,
      });
      if (!session.ok || !session.url) {
        setError(session.message || session.error || "Stripe Checkout could not be started.");
        setPaymentRedirecting(false);
        return;
      }
      if (sale) {
        api.softwareSales.update(sale.id, {
          stripeCheckoutSessionId: session.id,
          stripePaymentStatus: "checkout_pending",
        });
      }
      const packetWithSession: RemoteCheckoutPacket = {
        ...sourcePacket,
        stripeCheckoutSessionId: session.id,
        updatedAt: new Date().toISOString(),
      };
      writeRemoteSigningPacket(packetWithSession);
      await writeSharedRemoteSigningPacket(packetWithSession).catch(() => packetWithSession);
      setPacket(packetWithSession);
      await db.syncNow();
      window.location.assign(session.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe Checkout could not be started.");
      setPaymentRedirecting(false);
    }
  }

  async function submitSignedDocuments() {
    if (!packet) return;
    if (submittingPacket) return;
    const missingForms = missingSignedRemoteCheckoutForms(packet);
    if (missingForms.length > 0) {
      return setError("Sign every required document before entering payment information.");
    }
    const nextPacket: RemoteCheckoutPacket = { ...packet, updatedAt: new Date().toISOString() };
    setError(null);
    setSubmittingPacket(true);
    try {
      writeRemoteSigningPacket(nextPacket);
      const sharedPacket = await writeSharedRemoteSigningPacket(nextPacket);
      setPacket(sharedPacket);
      await startRemoteStripeCheckout(sharedPacket);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment entry could not be started. Check your connection and try again.");
    } finally {
      setSubmittingPacket(false);
    }
  }

  if (!packet) {
    return (
      <div className="min-h-screen bg-[#080807] px-5 py-10 text-white">
        <div className="mx-auto max-w-xl rounded-lg border border-white/10 bg-[#11100c] p-6">
          <QuotexMark className="h-12 w-12 border border-white/15" letterClassName="text-[28px]" />
          <h1 className="mt-5 font-display text-3xl">Signing link unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            This payment authorization packet could not be loaded. Ask the Quotex representative to resend the
            email or text link from the master plan builder.
          </p>
          <Link to="/checkout" className="btn-gold mt-5">
            Back to checkout
          </Link>
        </div>
      </div>
    );
  }

  const signedCount = REQUIRED_CHECKOUT_FORMS.filter((requiredForm) => packet.signatures[requiredForm.id]?.signedAt).length;
  const allSigned = signedCount === REQUIRED_CHECKOUT_FORMS.length;
  const submitted = !!packet.submittedAt;
  const paymentCompleted = !!packet.stripeCheckoutSessionId && submitted;
  const readyForPayment = allSigned && !paymentCompleted;

  return (
    <div className="min-h-screen bg-[#080807] text-white">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="rounded-xl border border-white/10 bg-[#11100c] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.35)] sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <QuotexMark className="h-12 w-12 border border-white/15" letterClassName="text-[28px]" />
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-gold-300">
                  Secure payment authorization
                </div>
                <h1 className="mt-1 font-display text-3xl">Review, authorize, and submit.</h1>
              </div>
            </div>
            <div
              className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                allSigned ? "bg-emerald-400/10 text-emerald-200" : "bg-white/[0.06] text-white/60"
              }`}
            >
              {signedCount}/{REQUIRED_CHECKOUT_FORMS.length} signed
            </div>
          </div>

          <div className="sticky top-0 z-10 -mx-5 mt-5 border-y border-white/10 bg-[#11100c]/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div className={`rounded-full px-3 py-2 font-semibold ${allSigned ? "bg-emerald-400/10 text-emerald-200" : "bg-white/[0.06] text-white/60"}`}>
                {signedCount}/{REQUIRED_CHECKOUT_FORMS.length} authorizations signed
              </div>
              <div className={`rounded-full px-3 py-2 font-semibold ${submitted ? "bg-emerald-400/10 text-emerald-200" : "bg-white/[0.06] text-white/60"}`}>
                Packet {submitted ? "submitted" : "not submitted"}
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs uppercase tracking-wider text-white/40">Agency</div>
              <div className="mt-1 font-semibold">{packet.agencyName}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs uppercase tracking-wider text-white/40">Signer</div>
              <div className="mt-1 font-semibold">{packet.contactName}</div>
              <div className="mt-0.5 text-xs text-white/45">{packet.email}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs uppercase tracking-wider text-white/40">Monthly plan</div>
              <div className="mt-1 font-semibold">{fmt.money(effectiveRemotePacketMonthly(packet))}/mo</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs uppercase tracking-wider text-white/40">Term</div>
              <div className="mt-1 font-semibold">
                {packet.termMonths} months
                {packet.termDiscountPercent ? ` - ${packet.termDiscountPercent}% off` : ""}
              </div>
            </div>
          </div>

          {submitted ? (
            <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              {paymentStatusMessage ??
                "Signed documents submitted. Continue to secure Stripe Checkout to enter the recurring payment method."}
            </div>
          ) : allSigned ? (
            <div className="mt-5 rounded-lg border border-gold-300/25 bg-gold-300/10 p-4 text-sm text-gold-50">
              All authorization documents are signed. Submit the packet to enter the secure payment method in Stripe Checkout.
            </div>
          ) : null}

          {error && (
            <div className="mt-5 rounded-md border border-red-300/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              {error}
            </div>
          )}

          <div className="mt-5 space-y-3">
            {REQUIRED_CHECKOUT_FORMS.map((requiredForm) => {
              const signature = packet.signatures[requiredForm.id] ?? {
                signerName: packet.contactName,
                authorized: false,
              };
              const active = activeFormId === requiredForm.id;
              const signed = !!signature.signedAt;
              return (
                <section
                  key={requiredForm.id}
                  id={`remote-packet-form-${requiredForm.id}`}
                  className="scroll-mt-20 overflow-hidden rounded-lg border border-white/10 bg-black/15"
                >
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gold-300" />
                        <div>
                          <h2 className="text-base font-semibold text-white">{requiredForm.title}</h2>
                          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                            {requiredForm.version}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-white/50">{requiredForm.summary}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          signed
                            ? "bg-emerald-400/10 text-emerald-200"
                            : signature.viewedAt
                              ? "bg-gold-300/10 text-gold-100"
                              : "bg-white/[0.06] text-white/55"
                        }`}
                      >
                        {signed ? "Signed" : signature.viewedAt ? "Viewed" : "View required"}
                      </span>
                      <button
                        type="button"
                        className={`${darkSecondaryButtonClass} text-xs`}
                        onClick={() => viewDocument(requiredForm.id)}
                      >
                        {active ? "Open" : "View"}
                      </button>
                    </div>
                  </div>

                  {active && (
                    <div className="border-t border-white/10 bg-[#15130f] p-4">
                      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs uppercase tracking-wider text-white/40">Agreement terms</div>
                        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-white/65">
                          {requiredForm.body.map((paragraph) => (
                            <li key={paragraph}>{paragraph}</li>
                          ))}
                        </ul>
                      </div>

                      {signed ? (
                        <div className="mt-4 rounded-lg border border-emerald-300/20 bg-emerald-400/10 p-4">
                          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
                            Electronic signature attached
                          </div>
                          <div
                            className="mt-3 text-4xl leading-none text-white"
                            style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}
                          >
                            {signature.signerName}
                          </div>
                          <div className="mt-2 text-xs text-emerald-100/75">
                            Signed {new Date(signature.signedAt!).toLocaleString()} using {packet.email}.
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-4 rounded-lg border border-gold-300/20 bg-white p-4 text-ink-900 [color-scheme:light]">
                          <div>
                            <label
                              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500"
                              htmlFor={`remote-signature-${requiredForm.id}`}
                            >
                              Typed electronic signature
                            </label>
                            <input
                              id={`remote-signature-${requiredForm.id}`}
                              className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-200"
                              value={signature.signerName}
                              placeholder={packet.contactName || "Full legal name"}
                              onChange={(event) =>
                                updateSignature(requiredForm.id, { signerName: event.target.value })
                              }
                            />
                            <div className="mt-3 rounded-lg border border-ink-100 bg-ink-50 px-4 py-4">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                                Signature preview
                              </div>
                              <div
                                className="mt-2 min-h-[2.25rem] text-4xl leading-none text-ink-950"
                                style={{ fontFamily: '"Brush Script MT", "Segoe Script", cursive' }}
                              >
                                {signature.signerName.trim() || packet.contactName || "Full legal name"}
                              </div>
                            </div>
                          </div>
                          <label className="flex items-start gap-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-3 text-left text-sm text-ink-700">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-ink-300 accent-gold-600"
                              checked={!!signature.authorized}
                              onChange={(event) =>
                                updateSignature(requiredForm.id, { authorized: event.target.checked })
                              }
                            />
                            <span>
                              {requiredForm.signatureStatement} I am authorized to sign for{" "}
                              {packet.agencyName} and intend my typed name to be my electronic
                              signature on this document.
                            </span>
                          </label>
                          <button
                            type="button"
                            className="btn-gold w-full justify-center"
                            onClick={() => signDocument(requiredForm.id)}
                          >
                            Sign this document
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">
                  {paymentCompleted ? "Payment method received" : "Enter payment method"}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-white/55">
                  {paymentCompleted
                    ? "Payment details were received and the signed documents were submitted to Quotex."
                    : allSigned
                      ? "Stripe Checkout securely collects the payment method. Signed documents submit automatically after payment is confirmed."
                      : "Sign every document above before submitting the packet."}
                </p>
              </div>
              <button
                type="button"
                className={`btn-gold justify-center ${
                  readyForPayment ? "" : "cursor-not-allowed opacity-55"
                }`}
                disabled={!readyForPayment || submittingPacket || paymentRedirecting}
                onClick={submitSignedDocuments}
              >
                <CheckCircle2 className="h-4 w-4" />
                {submittingPacket || paymentRedirecting
                  ? paymentRedirecting
                    ? "Opening checkout..."
                    : "Preparing..."
                  : paymentCompleted
                    ? "Submitted"
                    : "Enter payment method"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
