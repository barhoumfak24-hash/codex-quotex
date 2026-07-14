import Stripe from "stripe";
import { sendEmail, type EmailSendResult } from "./email.js";
import { readRemoteState, supabaseStateConfigured, writeRemoteState } from "./supabaseState.js";

const STRIPE_API_VERSION = "2026-02-25.clover";

const SOFTWARE_USER_MONTHLY_PRICE_USD = 300;
const COMPANY_WEBSITE_MONTHLY_ADD_ON_USD = 3_000;
const COMPANY_APP_MONTHLY_ADD_ON_USD = 3_000;
const COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD = 5_000;
const SOFTWARE_SETUP_FEE_USD = 0;

const PRODUCT_LABELS = {
  full_platform: "Full Quotex software",
} as const;

const ADD_ON_LABELS = {
  none: "Software only",
  website: "Company website",
  app: "Quotex client app",
  website_app: "Company website + Quotex app",
} as const;

const TERM_DISCOUNTS: Record<SoftwarePlanTermMonths, number> = {
  12: 0,
  24: 5,
  36: 8,
};

type SoftwareProduct = keyof typeof PRODUCT_LABELS;
type SoftwareSaleWebsiteAppAddOn = keyof typeof ADD_ON_LABELS;
type SoftwarePlanTermMonths = 12 | 24 | 36;
type SoftwareSaleSource = "transaction_site" | "master_portal";

export type SoftwareSaleCheckoutInput = {
  saleId?: string;
  signingPacketId?: string;
  agencyName: string;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  product?: SoftwareProduct;
  tier?: string;
  seats: number;
  websiteAppAddOn?: SoftwareSaleWebsiteAppAddOn;
  termMonths?: SoftwarePlanTermMonths;
  customMonthlyPriceUsd?: number;
  customMonthlyPriceReason?: string;
  source: SoftwareSaleSource;
  successUrl?: string;
  cancelUrl?: string;
  allowCustomPrice?: boolean;
};

export type SoftwareSaleCheckoutQuote = {
  product: SoftwareProduct;
  websiteAppAddOn: SoftwareSaleWebsiteAppAddOn;
  seats: number;
  termMonths: SoftwarePlanTermMonths;
  termDiscountPercent: number;
  userMonthlySubtotal: number;
  addOnMonthly: number;
  monthlyBeforeTermDiscount: number;
  termDiscountMonthly: number;
  standardEstimatedMonthly: number;
  estimatedMonthly: number;
  setupFee: number;
};

type SoftwareSaleTermWindow = {
  startEpochSeconds: number;
  endEpochSeconds: number;
  startIso: string;
  endIso: string;
};

type SyncedSoftwareSaleRecord =
  | {
      ok: true;
      stateId: string;
      snapshot: Record<string, unknown>;
      sales: unknown[];
      index: number;
      current: Record<string, unknown>;
    }
  | {
      ok: false;
      handled: boolean;
      reason: string;
    };

type RecurringInvoiceEmailHistoryEntry = {
  stripeInvoiceId: string;
  stripeInvoiceNumber?: string | null;
  stripeInvoiceUrl?: string | null;
  stripeInvoicePdf?: string | null;
  stripeSubscriptionId?: string | null;
  amountPaidUsd: number;
  currency: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: "sent" | "failed";
  provider: EmailSendResult["provider"];
  sentAt?: string;
  error?: string;
};

export type SoftwareSaleCheckoutSessionResult = {
  id: string;
  url: string;
  quote: SoftwareSaleCheckoutQuote;
};

let stripeClient: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("stripe_service_not_configured");
  stripeClient ??= new Stripe(key, {
    apiVersion: STRIPE_API_VERSION as never,
    appInfo: {
      name: "Quotex Insurance",
      version: "0.1.0",
    },
  });
  return stripeClient;
}

export function quoteSoftwareSaleCheckout(input: SoftwareSaleCheckoutInput): SoftwareSaleCheckoutQuote {
  const product = normalizeProduct(input.product);
  const seats = normalizeSeats(input.seats);
  const termMonths = normalizeTerm(input.termMonths);
  const websiteAppAddOn = normalizeAddOn(input.websiteAppAddOn);
  const userMonthlySubtotal = seats * SOFTWARE_USER_MONTHLY_PRICE_USD;
  const addOnMonthly = websiteAppAddOnMonthly(websiteAppAddOn);
  const monthlyBeforeTermDiscount = userMonthlySubtotal + addOnMonthly;
  const termDiscountPercent = TERM_DISCOUNTS[termMonths];
  const termDiscountMonthly =
    termDiscountPercent > 0 ? Math.round(monthlyBeforeTermDiscount * (termDiscountPercent / 100)) : 0;
  const standardEstimatedMonthly = Math.max(0, monthlyBeforeTermDiscount - termDiscountMonthly);
  const requestedCustomPrice =
    input.allowCustomPrice && Number.isFinite(input.customMonthlyPriceUsd) && (input.customMonthlyPriceUsd ?? 0) > 0
      ? Math.round(input.customMonthlyPriceUsd ?? standardEstimatedMonthly)
      : undefined;

  return {
    product,
    websiteAppAddOn,
    seats,
    termMonths,
    termDiscountPercent,
    userMonthlySubtotal,
    addOnMonthly,
    monthlyBeforeTermDiscount,
    termDiscountMonthly,
    standardEstimatedMonthly,
    estimatedMonthly: requestedCustomPrice ?? standardEstimatedMonthly,
    setupFee: SOFTWARE_SETUP_FEE_USD,
  };
}

export async function createSoftwareSaleCheckoutSession(
  input: SoftwareSaleCheckoutInput
): Promise<SoftwareSaleCheckoutSessionResult> {
  const quote = quoteSoftwareSaleCheckout(input);
  const origin = publicCheckoutOrigin();
  const saleId = cleanMetadataValue(input.saleId);
  const signingPacketId = cleanMetadataValue(input.signingPacketId);
  const metadata = softwareSaleMetadata(input, quote, saleId, signingPacketId);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer_email: input.email.trim(),
    client_reference_id: saleId,
    success_url:
      input.successUrl?.trim() ||
      `${origin}/checkout?stripe_success=1&session_id={CHECKOUT_SESSION_ID}${saleId ? `&sale_id=${encodeURIComponent(saleId)}` : ""}`,
    cancel_url:
      input.cancelUrl?.trim() ||
      `${origin}/checkout?stripe_cancelled=1${saleId ? `&sale_id=${encodeURIComponent(saleId)}` : ""}`,
    line_items: softwareSaleLineItems(input, quote),
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    metadata,
    subscription_data: {
      description: `${PRODUCT_LABELS[quote.product]} - ${input.agencyName.trim()} - ${quote.termMonths}-month recurring term`,
      metadata,
    },
  });

  if (!session.url) throw new Error("stripe_checkout_session_missing_url");
  return { id: session.id, url: session.url, quote };
}

export async function retrieveSoftwareSaleCheckoutSession(sessionId: string) {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "customer"],
  });
  const term = await ensureSoftwareSaleSubscriptionTerm(session);
  return softwareSaleCheckoutSessionSummary(session, term);
}

export async function verifyWebhook(rawBody: Buffer, signature: string) {
  if (!stripeConfigured()) {
    return developmentStripeFallback({
      id: "evt_stub",
      object: "event",
      type: "stub.event",
      data: { object: {} },
    } as unknown as Stripe.Event);
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("stripe_webhook_secret_not_configured");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

export async function handleStripeWebhookEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return markSoftwareSalePaid(event.data.object as Stripe.Checkout.Session);
    case "checkout.session.async_payment_failed":
      return markSoftwareSalePaymentIssue(event.data.object as Stripe.Checkout.Session, "payment_failed");
    case "invoice.payment_succeeded":
      return markSoftwareSaleRecurringInvoicePaid(event.data.object as Stripe.Invoice);
    case "invoice.payment_failed":
      return markSoftwareSalePaymentIssue(event.data.object as Stripe.Invoice, "invoice_payment_failed");
    case "customer.subscription.updated":
      return markSoftwareSaleSubscriptionStatus(event.data.object as Stripe.Subscription);
    case "customer.subscription.deleted":
      return markSoftwareSaleSubscriptionStatus(event.data.object as Stripe.Subscription);
    default:
      return { handled: false };
  }
}

export async function createDepositPaymentIntent(args: {
  amount: number;
  currency: string;
  customerEmail: string;
  metadata: Record<string, string>;
}) {
  if (!stripeConfigured()) return developmentStripeFallback({ clientSecret: "stub_secret", id: "pi_stub" });
  const intent = await stripe().paymentIntents.create({
    amount: Math.round(args.amount),
    currency: args.currency.toLowerCase(),
    receipt_email: args.customerEmail,
    automatic_payment_methods: { enabled: true },
    metadata: args.metadata,
  });
  return { clientSecret: intent.client_secret, id: intent.id };
}

export async function updateAgencySubscription(args: {
  agencyId: string;
  tier: "minimum" | "mid" | "ultra";
  seatCount: number;
}) {
  if (!stripeConfigured()) return developmentStripeFallback({ stripeSubscriptionId: "sub_stub" });
  return {
    stripeSubscriptionId: "",
    note: `Stripe subscription updates require a checkout/customer context for agency ${args.agencyId}.`,
  };
}

function softwareSaleLineItems(input: SoftwareSaleCheckoutInput, quote: SoftwareSaleCheckoutQuote): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const monthlyCents = dollarsToCents(quote.estimatedMonthly);
  if (monthlyCents <= 0) throw new Error("stripe_checkout_amount_must_be_positive");

  const productName = PRODUCT_LABELS[quote.product];
  const addOnLabel = ADD_ON_LABELS[quote.websiteAppAddOn];
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        recurring: { interval: "month" },
        unit_amount: monthlyCents,
        product_data: {
          name: `${productName} - ${input.agencyName.trim()}`,
          description: `${quote.seats} staff user${quote.seats === 1 ? "" : "s"}${quote.websiteAppAddOn !== "none" ? `, ${addOnLabel}` : ""}${quote.termDiscountPercent ? `, ${quote.termDiscountPercent}% term discount` : ""}`,
        },
      },
    },
  ];

  if (quote.setupFee > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: dollarsToCents(quote.setupFee),
        product_data: {
          name: "Quotex setup fee",
          description: "One-time implementation and provisioning setup.",
        },
      },
    });
  }

  return lineItems;
}

function softwareSaleMetadata(
  input: SoftwareSaleCheckoutInput,
  quote: SoftwareSaleCheckoutQuote,
  saleId?: string,
  signingPacketId?: string
): Stripe.MetadataParam {
  return {
    app: "quotex",
    workflow: "software_sale",
    source: input.source,
    saleId: saleId ?? "",
    signingPacketId: signingPacketId ?? "",
    agencyName: input.agencyName.trim().slice(0, 450),
    contactName: input.contactName.trim().slice(0, 450),
    email: input.email.trim().slice(0, 450),
    phone: input.phone?.trim().slice(0, 450) ?? "",
    product: quote.product,
    websiteAppAddOn: quote.websiteAppAddOn,
    seats: String(quote.seats),
    termMonths: String(quote.termMonths),
    termDiscountPercent: String(quote.termDiscountPercent),
    estimatedMonthly: String(quote.estimatedMonthly),
    standardEstimatedMonthly: String(quote.standardEstimatedMonthly),
    monthlyRecurringUsd: String(quote.estimatedMonthly),
    recurringInterval: "month",
    termEnforcement: "cancel_at_term_end",
    customMonthlyPriceReason: input.allowCustomPrice ? input.customMonthlyPriceReason?.trim().slice(0, 450) ?? "" : "",
  };
}

function softwareSaleCheckoutSessionSummary(
  session: Stripe.Checkout.Session,
  term?: SoftwareSaleTermWindow | null
) {
  const subscription =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
  return {
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    mode: session.mode,
    customerId: customer ?? null,
    subscriptionId: subscription ?? null,
    customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
    clientReferenceId: session.client_reference_id ?? null,
    metadata: session.metadata ?? {},
    subscriptionTermStartedAt: term?.startIso ?? null,
    subscriptionTermEndsAt: term?.endIso ?? null,
  };
}

async function markSoftwareSalePaid(session: Stripe.Checkout.Session) {
  const term = await ensureSoftwareSaleSubscriptionTerm(session);
  const summary = softwareSaleCheckoutSessionSummary(session, term);
  const saleId = summary.metadata.saleId || summary.clientReferenceId || "";
  const subscriptionId = summary.subscriptionId ?? "";
  const customerId = summary.customerId ?? "";
  return updateSyncedSoftwareSale(saleId, {
    status: "paid",
    paymentMode: "stripe_checkout",
    stripeCheckoutSessionId: summary.id,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePaymentStatus: summary.paymentStatus,
    stripePaidAt: new Date().toISOString(),
    ...(term
      ? {
          stripeSubscriptionTermStartedAt: term.startIso,
          stripeSubscriptionTermEndsAt: term.endIso,
          stripeSubscriptionCancelAt: term.endIso,
        }
      : {}),
  });
}

async function markSoftwareSalePaymentIssue(
  object: Stripe.Checkout.Session | Stripe.Invoice,
  reason: "payment_failed" | "invoice_payment_failed"
) {
  const saleId = saleIdFromStripeObject(object);
  return updateSyncedSoftwareSale(saleId, {
    status: "checkout_pending",
    stripePaymentStatus: reason,
    stripePaymentIssueAt: new Date().toISOString(),
  });
}

async function markSoftwareSaleRecurringInvoicePaid(invoice: Stripe.Invoice) {
  const saleId = saleIdFromStripeObject(invoice);
  const subscriptionId = subscriptionIdFromStripeObject(invoice);
  const customerId = customerIdFromStripeObject(invoice);
  const basePatch = {
    status: "paid",
    paymentMode: "stripe_checkout",
    stripePaymentStatus: "paid",
    stripePaidAt: new Date().toISOString(),
    ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    ...(customerId ? { stripeCustomerId: customerId } : {}),
  };

  if (!isRecurringSoftwareInvoice(invoice)) {
    return updateSyncedSoftwareSale(saleId, basePatch);
  }

  return sendRecurringSoftwareInvoiceEmail(saleId, invoice, basePatch);
}

async function markSoftwareSaleSubscriptionStatus(subscription: Stripe.Subscription) {
  const saleId = saleIdFromStripeObject(subscription);
  const customerId = customerIdFromStripeObject(subscription);
  return updateSyncedSoftwareSale(saleId, {
    stripeSubscriptionId: subscription.id,
    stripePaymentStatus: subscription.status,
    ...(subscription.start_date
      ? { stripeSubscriptionTermStartedAt: epochSecondsToIso(subscription.start_date) }
      : {}),
    ...(subscription.cancel_at
      ? {
          stripeSubscriptionTermEndsAt: epochSecondsToIso(subscription.cancel_at),
          stripeSubscriptionCancelAt: epochSecondsToIso(subscription.cancel_at),
        }
      : {}),
    ...(customerId ? { stripeCustomerId: customerId } : {}),
  });
}

async function ensureSoftwareSaleSubscriptionTerm(
  session: Stripe.Checkout.Session
): Promise<SoftwareSaleTermWindow | null> {
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return null;

  const metadata = session.metadata ?? {};
  const termMonths = normalizeTerm(Number.parseInt(metadata.termMonths ?? "", 10));
  const subscription =
    typeof session.subscription === "string"
      ? await stripe().subscriptions.retrieve(subscriptionId)
      : (session.subscription as Stripe.Subscription);
  const startEpochSeconds =
    subscription.start_date || session.created || Math.floor(Date.now() / 1000);
  const endEpochSeconds = addUtcMonths(startEpochSeconds, termMonths);
  const existingCancelAt = subscription.cancel_at ?? null;
  const subscriptionMetadata = subscription.metadata ?? {};
  const mergedMetadata: Stripe.MetadataParam = {
    ...subscriptionMetadata,
    ...metadata,
    termMonths: String(termMonths),
    termStartedAt: epochSecondsToIso(startEpochSeconds),
    termEndsAt: epochSecondsToIso(endEpochSeconds),
    termEnforcement: "cancel_at_term_end",
  };

  const metadataAlreadySynced =
    subscriptionMetadata.termMonths === String(termMonths) &&
    subscriptionMetadata.termStartedAt === mergedMetadata.termStartedAt &&
    subscriptionMetadata.termEndsAt === mergedMetadata.termEndsAt &&
    subscriptionMetadata.termEnforcement === "cancel_at_term_end";

  if (existingCancelAt !== endEpochSeconds || !metadataAlreadySynced) {
    await stripe().subscriptions.update(subscriptionId, {
      cancel_at: endEpochSeconds,
      metadata: mergedMetadata,
    });
  }

  return {
    startEpochSeconds,
    endEpochSeconds,
    startIso: epochSecondsToIso(startEpochSeconds),
    endIso: epochSecondsToIso(endEpochSeconds),
  };
}

async function sendRecurringSoftwareInvoiceEmail(
  saleId: string,
  invoice: Stripe.Invoice,
  basePatch: Record<string, unknown>
) {
  const loaded = await loadSyncedSoftwareSale(saleId);
  if (!loaded.ok) return { handled: loaded.handled, updated: false, reason: loaded.reason };

  const history = recurringInvoiceEmailHistory(loaded.current);
  const alreadySent = history.some(
    (entry) => entry.stripeInvoiceId === invoice.id && entry.status === "sent"
  );
  if (alreadySent) {
    return updateLoadedSoftwareSale(loaded, basePatch);
  }

  const result = await sendEmail({
    to: saleString(loaded.current, "email") || invoiceCustomerEmail(invoice),
    from: masterPortalEmailFrom(),
    replyTo: masterPortalReplyTo(),
    subject: `Quotex subscription invoice ${stripeInvoiceNumber(invoice)} - ${saleString(loaded.current, "agencyName")}`,
    html: recurringInvoiceEmailHtml(loaded.current, invoice),
    text: recurringInvoiceEmailText(loaded.current, invoice),
    categories: ["software-sale", "recurring-invoice"],
  });
  const sent = result.status === "sent";
  const sentAt = new Date().toISOString();
  const entry: RecurringInvoiceEmailHistoryEntry = {
    stripeInvoiceId: invoice.id,
    stripeInvoiceNumber: stripeInvoiceNumber(invoice),
    stripeInvoiceUrl: stripeInvoiceUrl(invoice),
    stripeInvoicePdf: stripeInvoicePdf(invoice),
    stripeSubscriptionId: subscriptionIdFromStripeObject(invoice) || null,
    amountPaidUsd: invoiceAmountPaidUsd(invoice),
    currency: invoiceCurrency(invoice),
    periodStart: invoicePeriod(invoice).startIso,
    periodEnd: invoicePeriod(invoice).endIso,
    status: sent ? "sent" : "failed",
    provider: result.provider,
    sentAt: sent ? sentAt : undefined,
    error: sent ? undefined : result.error ?? "Recurring invoice email could not be sent.",
  };

  return updateLoadedSoftwareSale(loaded, {
    ...basePatch,
    recurringInvoiceEmailLastStripeInvoiceId: invoice.id,
    recurringInvoiceEmailStatus: entry.status,
    recurringInvoiceEmailProvider: entry.provider,
    recurringInvoiceEmailSentAt: sent ? sentAt : undefined,
    recurringInvoiceEmailError: sent ? undefined : entry.error,
    recurringInvoiceEmailHistory: [...history.filter((item) => item.stripeInvoiceId !== invoice.id), entry].slice(-36),
  });
}

async function updateSyncedSoftwareSale(saleId: string, patch: Record<string, unknown>) {
  const loaded = await loadSyncedSoftwareSale(saleId);
  if (!loaded.ok) return { handled: loaded.handled, updated: false, reason: loaded.reason };
  return updateLoadedSoftwareSale(loaded, patch);
}

async function loadSyncedSoftwareSale(saleId: string): Promise<SyncedSoftwareSaleRecord> {
  if (!saleId) return { ok: false, handled: false, reason: "missing_sale_id" };
  if (!supabaseStateConfigured()) return { ok: false, handled: true, reason: "state_sync_not_configured" };
  const stateId = `app_state:${process.env.STATE_SYNC_ID?.trim() || "default"}`;
  const row = await readRemoteState(stateId);
  const snapshot = normalizeObject(row?.snapshot);
  if (!snapshot) return { ok: false, handled: true, reason: "missing_app_state" };
  const sales = Array.isArray(snapshot.softwareSales) ? snapshot.softwareSales : [];
  const index = sales.findIndex((sale) => normalizeObject(sale)?.id === saleId);
  if (index < 0) return { ok: false, handled: true, reason: "sale_not_found" };
  const current = normalizeObject(sales[index]);
  if (!current) return { ok: false, handled: true, reason: "sale_invalid" };
  return { ok: true, stateId, snapshot, sales, index, current };
}

async function updateLoadedSoftwareSale(
  loaded: Extract<SyncedSoftwareSaleRecord, { ok: true }>,
  patch: Record<string, unknown>
) {
  loaded.sales[loaded.index] = {
    ...loaded.current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  loaded.snapshot.softwareSales = loaded.sales;
  await writeRemoteState(loaded.stateId, loaded.snapshot);
  return { handled: true, updated: true, saleId: loaded.current.id };
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recurringInvoiceEmailHistory(sale: Record<string, unknown>): RecurringInvoiceEmailHistoryEntry[] {
  const raw = sale.recurringInvoiceEmailHistory;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => normalizeObject(entry))
    .filter((entry): entry is Record<string, unknown> => !!entry)
    .map((entry): RecurringInvoiceEmailHistoryEntry => {
      const provider: EmailSendResult["provider"] =
        entry.provider === "sendgrid" ||
        entry.provider === "resend" ||
        entry.provider === "smtp"
          ? entry.provider
          : "unconfigured";
      return {
        stripeInvoiceId: typeof entry.stripeInvoiceId === "string" ? entry.stripeInvoiceId : "",
        stripeInvoiceNumber: typeof entry.stripeInvoiceNumber === "string" ? entry.stripeInvoiceNumber : null,
        stripeInvoiceUrl: typeof entry.stripeInvoiceUrl === "string" ? entry.stripeInvoiceUrl : null,
        stripeInvoicePdf: typeof entry.stripeInvoicePdf === "string" ? entry.stripeInvoicePdf : null,
        stripeSubscriptionId: typeof entry.stripeSubscriptionId === "string" ? entry.stripeSubscriptionId : null,
        amountPaidUsd: typeof entry.amountPaidUsd === "number" ? entry.amountPaidUsd : 0,
        currency: typeof entry.currency === "string" ? entry.currency : "usd",
        periodStart: typeof entry.periodStart === "string" ? entry.periodStart : null,
        periodEnd: typeof entry.periodEnd === "string" ? entry.periodEnd : null,
        status: entry.status === "sent" ? "sent" : "failed",
        provider,
        sentAt: typeof entry.sentAt === "string" ? entry.sentAt : undefined,
        error: typeof entry.error === "string" ? entry.error : undefined,
      };
    })
    .filter((entry) => entry.stripeInvoiceId);
}

function isRecurringSoftwareInvoice(invoice: Stripe.Invoice): boolean {
  const reason = invoiceBillingReason(invoice);
  return reason !== "subscription_create";
}

function recurringInvoiceEmailHtml(sale: Record<string, unknown>, invoice: Stripe.Invoice) {
  const agencyName = saleString(sale, "agencyName") || "your agency";
  const contactName = saleString(sale, "contactName") || "there";
  const period = invoicePeriod(invoice);
  const hostedInvoiceUrl = stripeInvoiceUrl(invoice);
  const invoicePdf = stripeInvoicePdf(invoice);
  const linkRows = [
    hostedInvoiceUrl ? button(hostedInvoiceUrl, "View invoice") : "",
    invoicePdf ? button(invoicePdf, "Download PDF") : "",
  ].join("");

  return emailShell(
    `Subscription invoice ${stripeInvoiceNumber(invoice)}`,
    `
      <p>Hi ${escapeHtml(contactName)},</p>
      <p>This is your monthly Quotex subscription invoice for <strong>${escapeHtml(agencyName)}</strong>.</p>
      <p>The saved payment method on file was charged automatically by Stripe. No signatures, payment authorization, or payment method entry are needed for this monthly invoice.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:18px 0;">
        ${invoiceRow("Invoice", stripeInvoiceNumber(invoice))}
        ${invoiceRow("Agency", agencyName)}
        ${invoiceRow("Product", softwareSaleProductLabel(sale))}
        ${invoiceRow("Staff users", String(saleNumber(sale, "seats") || 1))}
        ${invoiceRow("Website / app package", softwareSaleAddOnLabel(sale))}
        ${invoiceRow("Billing period", invoicePeriodLabel(period))}
        ${invoiceRow("Subscription", subscriptionIdFromStripeObject(invoice) || "Not recorded")}
        ${invoiceRow("Amount paid", money(invoiceAmountPaidUsd(invoice)), true)}
      </table>
      ${linkRows}
      <p style="font-size:13px;color:#666;margin-top:22px;">Keep this email for your records. If anything looks incorrect, reply directly to this email.</p>
    `
  );
}

function recurringInvoiceEmailText(sale: Record<string, unknown>, invoice: Stripe.Invoice) {
  const agencyName = saleString(sale, "agencyName") || "your agency";
  const period = invoicePeriod(invoice);
  const lines = [
    `Quotex subscription invoice ${stripeInvoiceNumber(invoice)}`,
    "",
    `Hi ${saleString(sale, "contactName") || "there"},`,
    "",
    `This is your monthly Quotex subscription invoice for ${agencyName}.`,
    "The saved payment method on file was charged automatically by Stripe. No signatures, payment authorization, or payment method entry are needed for this monthly invoice.",
    "",
    `Agency: ${agencyName}`,
    `Product: ${softwareSaleProductLabel(sale)}`,
    `Staff users: ${saleNumber(sale, "seats") || 1}`,
    `Website / app package: ${softwareSaleAddOnLabel(sale)}`,
    `Billing period: ${invoicePeriodLabel(period)}`,
    `Subscription: ${subscriptionIdFromStripeObject(invoice) || "Not recorded"}`,
    `Amount paid: ${money(invoiceAmountPaidUsd(invoice))}`,
  ];
  const hostedInvoiceUrl = stripeInvoiceUrl(invoice);
  const invoicePdf = stripeInvoicePdf(invoice);
  if (hostedInvoiceUrl) lines.push("", `View invoice: ${hostedInvoiceUrl}`);
  if (invoicePdf) lines.push(`Download PDF: ${invoicePdf}`);
  lines.push("", "Keep this email for your records. If anything looks incorrect, reply directly to this email.");
  return lines.join("\n");
}

function emailShell(title: string, body: string) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f5f3ed;font-family:Arial,Helvetica,sans-serif;color:#181713;">
        <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(title)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ed;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #e4dfd2;border-radius:14px;overflow:hidden;">
                <tr>
                  <td style="background:#0b0a08;color:#fff;padding:24px 28px;">
                    <div style="font-size:22px;font-weight:700;">Quotex Insurance</div>
                    <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#d7bd69;margin-top:4px;">Agency operating system</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;font-size:15px;line-height:1.55;">
                    <h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;color:#111;">${escapeHtml(title)}</h1>
                    ${body}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function button(href: string, label: string) {
  return `
    <p style="margin:12px 8px 12px 0;display:inline-block;">
      <a href="${escapeHtml(href)}" style="display:inline-block;background:#9b7627;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">${escapeHtml(label)}</a>
    </p>
  `;
}

function invoiceRow(label: string, value: string, strong = false) {
  return `
    <tr>
      <td style="border-bottom:1px solid #eee;padding:9px 8px;color:#666;">${escapeHtml(label)}</td>
      <td align="right" style="border-bottom:1px solid #eee;padding:9px 8px;${strong ? "font-size:20px;font-weight:700;color:#111;" : "font-weight:600;color:#222;"}">${escapeHtml(value)}</td>
    </tr>
  `;
}

function invoicePeriod(invoice: Stripe.Invoice): { startIso: string | null; endIso: string | null } {
  const record = invoice as unknown as Record<string, unknown>;
  const directStart = numberValue(record.period_start);
  const directEnd = numberValue(record.period_end);
  if (directStart || directEnd) {
    return {
      startIso: directStart ? epochSecondsToIso(directStart) : null,
      endIso: directEnd ? epochSecondsToIso(directEnd) : null,
    };
  }
  const lines = normalizeObject(record.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  const firstLine = normalizeObject(data[0]);
  const period = normalizeObject(firstLine?.period);
  const lineStart = numberValue(period?.start);
  const lineEnd = numberValue(period?.end);
  return {
    startIso: lineStart ? epochSecondsToIso(lineStart) : null,
    endIso: lineEnd ? epochSecondsToIso(lineEnd) : null,
  };
}

function invoicePeriodLabel(period: { startIso: string | null; endIso: string | null }) {
  if (!period.startIso && !period.endIso) return "Not recorded";
  if (!period.startIso) return `Through ${formatDate(period.endIso)}`;
  if (!period.endIso) return `Starting ${formatDate(period.startIso)}`;
  return `${formatDate(period.startIso)} - ${formatDate(period.endIso)}`;
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function stripeInvoiceNumber(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.number === "string" && record.number.trim() ? record.number.trim() : invoice.id;
}

function stripeInvoiceUrl(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.hosted_invoice_url === "string" && record.hosted_invoice_url.trim()
    ? record.hosted_invoice_url.trim()
    : null;
}

function stripeInvoicePdf(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.invoice_pdf === "string" && record.invoice_pdf.trim() ? record.invoice_pdf.trim() : null;
}

function invoiceBillingReason(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.billing_reason === "string" ? record.billing_reason : "";
}

function invoiceAmountPaidUsd(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  const cents = numberValue(record.amount_paid) || numberValue(record.amount_due) || 0;
  return cents / 100;
}

function invoiceCurrency(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.currency === "string" && record.currency ? record.currency.toLowerCase() : "usd";
}

function invoiceCustomerEmail(invoice: Stripe.Invoice) {
  const record = invoice as unknown as Record<string, unknown>;
  return typeof record.customer_email === "string" ? record.customer_email : "";
}

function saleString(sale: Record<string, unknown>, key: string) {
  const value = sale[key];
  return typeof value === "string" ? value.trim() : "";
}

function saleNumber(sale: Record<string, unknown>, key: string) {
  const value = sale[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function softwareSaleProductLabel(sale: Record<string, unknown>) {
  void sale;
  return PRODUCT_LABELS.full_platform;
}

function softwareSaleAddOnLabel(sale: Record<string, unknown>) {
  const addOn = saleString(sale, "websiteAppAddOn");
  if (addOn === "website" || addOn === "app" || addOn === "website_app") return ADD_ON_LABELS[addOn];
  return ADD_ON_LABELS.none;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function masterPortalEmailFrom() {
  return (
    process.env.MASTER_PORTAL_EMAIL_FROM?.trim() ||
    process.env.MASTER_PORTAL_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    process.env.SENDGRID_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "Quotex Insurance <no-reply@quotexinsurance.com>"
  );
}

function masterPortalReplyTo() {
  return (
    process.env.MASTER_PORTAL_REPLY_TO?.trim() ||
    process.env.MASTER_PORTAL_EMAIL?.trim() ||
    process.env.EMAIL_REPLY_TO?.trim() ||
    undefined
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function saleIdFromStripeObject(object: Stripe.Checkout.Session | Stripe.Invoice | Stripe.Subscription): string {
  const direct = object.metadata?.saleId?.trim();
  if (direct) return direct;
  const record = object as unknown as Record<string, unknown>;
  const parent = normalizeObject(record.parent);
  const parentSubscriptionDetails = normalizeObject(parent?.subscription_details);
  const parentMetadata = normalizeObject(parentSubscriptionDetails?.metadata);
  const parentSaleId = typeof parentMetadata?.saleId === "string" ? parentMetadata.saleId.trim() : "";
  if (parentSaleId) return parentSaleId;
  const subscriptionDetails = normalizeObject(record.subscription_details);
  const subscriptionMetadata = normalizeObject(subscriptionDetails?.metadata);
  const subscriptionSaleId =
    typeof subscriptionMetadata?.saleId === "string" ? subscriptionMetadata.saleId.trim() : "";
  return subscriptionSaleId;
}

function subscriptionIdFromStripeObject(object: Stripe.Invoice | Stripe.Subscription): string {
  if ("id" in object && object.object === "subscription") return object.id;
  const record = object as unknown as Record<string, unknown>;
  const subscription = record.subscription;
  if (typeof subscription === "string") return subscription;
  const subscriptionObject = normalizeObject(subscription);
  return typeof subscriptionObject?.id === "string" ? subscriptionObject.id : "";
}

function customerIdFromStripeObject(object: Stripe.Checkout.Session | Stripe.Invoice | Stripe.Subscription): string {
  const customer = object.customer;
  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object" && "id" in customer && typeof customer.id === "string") {
    return customer.id;
  }
  return "";
}

function normalizeProduct(product?: string): SoftwareProduct {
  void product;
  return "full_platform";
}

function normalizeAddOn(addOn?: string): SoftwareSaleWebsiteAppAddOn {
  if (addOn === "website" || addOn === "app" || addOn === "website_app") return addOn;
  return "none";
}

function normalizeTerm(term?: number): SoftwarePlanTermMonths {
  if (term === 24 || term === 36) return term;
  return 12;
}

function normalizeSeats(seats: number): number {
  return Math.max(1, Math.min(999, Math.ceil(Number.isFinite(seats) ? seats : 1)));
}

function addUtcMonths(startEpochSeconds: number, months: SoftwarePlanTermMonths): number {
  const start = new Date(startEpochSeconds * 1000);
  const day = start.getUTCDate();
  const targetYear = start.getUTCFullYear();
  const targetMonth = start.getUTCMonth() + months;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const end = new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(day, lastDayOfTargetMonth),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds()
    )
  );
  return Math.floor(end.getTime() / 1000);
}

function epochSecondsToIso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function websiteAppAddOnMonthly(addOn: SoftwareSaleWebsiteAppAddOn): number {
  if (addOn === "website") return COMPANY_WEBSITE_MONTHLY_ADD_ON_USD;
  if (addOn === "app") return COMPANY_APP_MONTHLY_ADD_ON_USD;
  if (addOn === "website_app") return COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD;
  return 0;
}

function dollarsToCents(value: number): number {
  return Math.round(Math.max(0, value) * 100);
}

function cleanMetadataValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

function publicCheckoutOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.FRONTEND_ORIGIN?.split(",")[0]?.trim() ||
    "https://quotexinsurance.com"
  ).replace(/\/+$/, "");
}

function developmentStripeFallback<T>(value: T): T {
  if (process.env.NODE_ENV === "production") {
    throw new Error("stripe_service_not_configured");
  }
  return value;
}
