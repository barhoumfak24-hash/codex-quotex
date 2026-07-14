import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Mail,
  Minus,
  Pencil,
  Plus,
  ReceiptText,
  Save,
  Send,
  X,
} from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import {
  sendSoftwareSaleInvoiceEmail,
  sendSoftwareSaleSigningEmail,
  softwareSaleInvoicePatchFromResult,
  type CommunicationResult,
} from "@/lib/communications";
import { fmt } from "@/lib/format";
import { provisionAgencyForCompletedSale, reconcilePaidSoftwareSalesToAgencies } from "@/lib/softwareSaleProvisioning";
import {
  createSoftwareSaleStripeCheckoutSession,
  getSoftwareSaleStripeCheckoutSession,
} from "@/lib/stripeCheckout";
import type { StripeCheckoutSessionSummary } from "@/lib/stripeCheckout";
import {
  COMPANY_APP_MONTHLY_ADD_ON_USD,
  COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD,
  COMPANY_WEBSITE_MONTHLY_ADD_ON_USD,
  SOFTWARE_SETUP_FEE_USD,
  WEBSITE_APP_ADD_ON_OPTIONS,
  normalizeSoftwareUserCount,
  softwareSeatMonthlyPrice,
  softwareUserMonthlySubtotal,
  websiteAppAddOnMonthlyUsd,
} from "@/lib/tiers";
import {
  REQUIRED_CHECKOUT_FORMS,
  createRemoteSigningPacketId,
  emptyRemoteCheckoutSignatures,
  encodeRemotePacketPayload,
  readRemoteSigningPacket,
  readSharedRemoteSigningPacket,
  writeSharedRemoteSigningPacket,
  writeRemoteSigningPacket,
  type PlanTermMonths,
  type RemoteCheckoutPacket,
} from "@/pages/transactions/TransactionSitePage";
import type {
  SoftwareSale,
  SoftwareSaleSignedAgreement,
  SoftwareProduct,
  SoftwareSaleWebsiteAppAddOn,
  SubscriptionTier,
} from "@/types";

const TERM_OPTIONS = [
  { months: 12, label: "12 months", discountPercent: 0 },
  { months: 24, label: "24 months", discountPercent: 5 },
  { months: 36, label: "36 months", discountPercent: 8 },
] as const;

const QUICK_USER_COUNTS = [10, 25, 50];
const MASTER_PLAN_BUILDER_DRAFT_KEY = "quotex_master_plan_builder:draft";

type MasterPlanForm = {
  agencyName: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  product: SoftwareProduct;
  seats: string;
  websiteAppAddOn: SoftwareSaleWebsiteAppAddOn;
  notes: string;
};

const blankForm: MasterPlanForm = {
  agencyName: "",
  contactName: "",
  email: "",
  phone: "",
  website: "",
  product: "full_platform",
  seats: "",
  websiteAppAddOn: "none",
  notes: "",
};

type MasterPlanBuilderDraft = {
  form: MasterPlanForm;
  termMonths: PlanTermMonths;
  saleId?: string;
  packetId?: string | null;
  customPriceActive?: boolean;
  customPriceValue?: string;
  customPriceReason?: string;
};

export function MasterPlanBuilderPage() {
  const [draftSeed] = useState(() => loadMasterPlanBuilderDraft());
  const [form, setForm] = useState<MasterPlanForm>(draftSeed.form);
  const [termMonths, setTermMonths] = useState<PlanTermMonths>(draftSeed.termMonths);
  const [sale, setSale] = useState<SoftwareSale | null>(draftSeed.sale);
  const [packetId, setPacketId] = useState<string | null>(draftSeed.packetId);
  const [packetSyncRevision, setPacketSyncRevision] = useState(0);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [customPriceEditing, setCustomPriceEditing] = useState(false);
  const [customPriceActive, setCustomPriceActive] = useState(draftSeed.customPriceActive);
  const [customPriceValue, setCustomPriceValue] = useState(draftSeed.customPriceValue);
  const [customPriceReason, setCustomPriceReason] = useState(draftSeed.customPriceReason);
  const [customPriceError, setCustomPriceError] = useState<string | null>(null);

  const parsedSeats = Number.parseInt(form.seats, 10);
  const hasSelectedUsers = form.seats.trim() !== "" && Number.isFinite(parsedSeats) && parsedSeats > 0;
  const seats = hasSelectedUsers ? normalizeSoftwareUserCount(parsedSeats) : 0;
  const effectiveWebsiteAppAddOn = form.websiteAppAddOn;
  const productSeatPrice = softwareSeatMonthlyPrice(form.product);
  const userSubtotal = hasSelectedUsers ? softwareUserMonthlySubtotal(seats, form.product) : 0;
  const addOnMonthly = websiteAppAddOnMonthlyUsd(effectiveWebsiteAppAddOn);
  const websiteAppRetailMonthly =
    effectiveWebsiteAppAddOn === "website_app"
      ? COMPANY_WEBSITE_MONTHLY_ADD_ON_USD + COMPANY_APP_MONTHLY_ADD_ON_USD
      : addOnMonthly;
  const bundleDiscount =
    effectiveWebsiteAppAddOn === "website_app" ? COMPANY_WEBSITE_AND_APP_BUNDLE_DISCOUNT_USD : 0;
  const monthlyBeforeTermDiscount = hasSelectedUsers ? userSubtotal + websiteAppRetailMonthly - bundleDiscount : 0;
  const selectedTerm = TERM_OPTIONS.find((term) => term.months === termMonths) ?? TERM_OPTIONS[0];
  const termDiscountMonthly =
    selectedTerm.discountPercent > 0
      ? Math.round(monthlyBeforeTermDiscount * (selectedTerm.discountPercent / 100))
      : 0;
  const standardEstimatedMonthly = Math.max(0, monthlyBeforeTermDiscount - termDiscountMonthly);
  const parsedCustomPrice = Number.parseInt(customPriceValue, 10);
  const hasCustomPrice =
    customPriceActive && Number.isFinite(parsedCustomPrice) && parsedCustomPrice > 0;
  const estimatedMonthly = hasCustomPrice ? parsedCustomPrice : standardEstimatedMonthly;
  const customPriceDelta = hasSelectedUsers && hasCustomPrice ? standardEstimatedMonthly - estimatedMonthly : 0;
  const packet = useMemo(
    () => (packetId ? readRemoteSigningPacket(packetId) : null),
    [packetId, packetSyncRevision]
  );
  const signedCount = packet
    ? REQUIRED_CHECKOUT_FORMS.filter((requiredForm) => packet.signatures[requiredForm.id]?.signedAt).length
    : 0;
  const allSigned = signedCount === REQUIRED_CHECKOUT_FORMS.length;
  const packetSubmitted = !!packet?.submittedAt;
  const invoiceSent = !!sale?.invoiceEmailSentAt || sale?.invoiceEmailStatus === "sent";

  useEffect(() => {
    saveMasterPlanBuilderDraft({
      form,
      termMonths,
      saleId: sale?.id,
      packetId,
      customPriceActive,
      customPriceValue,
      customPriceReason,
    });
  }, [customPriceActive, customPriceReason, customPriceValue, form, packetId, sale?.id, termMonths]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id")?.trim();
    const saleId = params.get("sale_id")?.trim();
    const stripeSuccess = params.get("stripe_success") === "1";
    const stripeCancelled = params.get("stripe_cancelled") === "1";
    if (!stripeSuccess && !stripeCancelled) return;

    const clearStripeParams = () => window.history.replaceState({}, "", "/master/build-plan");

    if (stripeCancelled) {
      setShareStatus("Stripe checkout was cancelled. No invoice or agency code was sent.");
      clearStripeParams();
      return;
    }

    if (!sessionId || !saleId) {
      setError("Stripe returned without the checkout session details.");
      clearStripeParams();
      return;
    }

    let cancelled = false;
    const finishStripeCheckout = async () => {
      setShareStatus("Verifying Stripe payment...");
      const checkout = await getSoftwareSaleStripeCheckoutSession(sessionId);
      if (cancelled) return;
      if (!checkout.ok || !checkout.session) {
        setError(checkout.message || checkout.error || "Stripe checkout could not be verified.");
        clearStripeParams();
        return;
      }
      const { session } = checkout;
      if (session.paymentStatus !== "paid" && session.status !== "complete") {
        setError("Stripe checkout is not paid yet. No invoice or agency code was sent.");
        clearStripeParams();
        return;
      }
      const existingSale = api.softwareSales.get(saleId) ?? sale;
      if (!existingSale || existingSale.id !== saleId) {
        setError("Stripe confirmed payment, but the master sale record was not found.");
        clearStripeParams();
        return;
      }
      const updated = api.softwareSales.update(existingSale.id, {
        ...paidSalePatchFromCheckoutSession(session),
      });
      const paidSale = updated ?? existingSale;
      setSale(paidSale);
      const provisionedAgency = provisionAgencyForCompletedSale(paidSale);
      const paidPacket =
        paidSale.signingPacketId ? readRemoteSigningPacket(paidSale.signingPacketId) : packetId ? readRemoteSigningPacket(packetId) : null;
      if (!paidPacket) {
        setShareStatus(`Stripe payment verified. Agency provisioned: ${provisionedAgency.name}. Send the invoice once the signed packet is visible again.`);
        clearStripeParams();
        return;
      }
      clearStripeParams();
      await sendInvoiceForSale(paidSale, paidPacket, true);
    };

    void finishStripeCheckout();
    return () => {
      cancelled = true;
    };
  }, [packetId, sale]);

  useEffect(() => {
    if (!packetId) return;
    let cancelled = false;

    const syncSignedSale = async () => {
      const localPacket = readRemoteSigningPacket(packetId);
      const sharedPacket = await readSharedRemoteSigningPacket(packetId);
      const nextPacket = newestSigningPacket(localPacket, sharedPacket);
      if (!nextPacket || cancelled) return;
      if (!sameSigningPacketSnapshot(localPacket, nextPacket)) {
        writeRemoteSigningPacket(nextPacket);
        setPacketSyncRevision((current) => current + 1);
      }
      const activeSale = sale ?? recoverSoftwareSaleFromPacket(nextPacket);
      if (!activeSale) return;
      if (!sale || sale.id !== activeSale.id) setSale(activeSale);
      const nextSignedCount = REQUIRED_CHECKOUT_FORMS.filter(
        (requiredForm) => nextPacket.signatures[requiredForm.id]?.signedAt
      ).length;
      if (nextSignedCount !== REQUIRED_CHECKOUT_FORMS.length) return;
      if (!nextPacket.submittedAt) return;
      const signedAgreements = signedAgreementsFromPacket(nextPacket);
      const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
      const signedAt = signedAtValues[signedAtValues.length - 1];
      const signedAgreementNames = signedAgreements.map((agreement) => agreement.title);
      const existingSale = api.softwareSales.get(activeSale.id) ?? activeSale;
      const alreadySynced =
        existingSale.signingPacketId === nextPacket.id &&
        existingSale.signedAt === signedAt &&
        existingSale.signedPacketSubmittedAt === nextPacket.submittedAt &&
        existingSale.invoiceEmailSentAt === nextPacket.invoiceEmailSentAt &&
        existingSale.invoiceEmailStatus === nextPacket.invoiceEmailStatus &&
        signedAgreementNames.length === (existingSale.signedAgreementNames ?? []).length &&
        signedAgreementNames.every((title, index) => title === existingSale.signedAgreementNames?.[index]);
      const updated = alreadySynced
        ? existingSale
        : api.softwareSales.update(activeSale.id, {
            signingPacketId: nextPacket.id,
            signedAgreementNames,
            signedAgreements,
            signedByName: signedAgreements[0]?.signedByName,
            signedByEmail: signedAgreements[0]?.signedByEmail,
            signedAt,
            signedPacketSubmittedAt: nextPacket.submittedAt,
            signedPacketSubmittedByName: nextPacket.submittedByName ?? signedAgreements[0]?.signedByName,
            signedPacketSubmittedByEmail: nextPacket.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
            invoiceEmailSentAt: nextPacket.invoiceEmailSentAt,
            invoiceEmailStatus: nextPacket.invoiceEmailStatus,
            invoiceEmailProvider: nextPacket.invoiceEmailProvider,
            invoiceEmailError: nextPacket.invoiceEmailError,
            status: nextPacket.invoiceEmailStatus === "sent" ? "closed" : existingSale.status,
          });
      if (!updated) return;
      if (!alreadySynced) setSale(updated);
      if (updated.invoiceEmailStatus === "sent" || updated.invoiceEmailSentAt) {
        const provisionedAgency = provisionAgencyForCompletedSale(updated);
        const closedSale = api.softwareSales.update(updated.id, { status: "closed" }) ?? updated;
        setSale(closedSale);
        clearCompletedPlan(`Invoice sent. Agency provisioned: ${provisionedAgency.name}.`);
        return;
      }
      if (!stripePaymentConfirmed(updated) && nextPacket.stripeCheckoutSessionId && !invoiceSending) {
        setShareStatus("Signed packet received. Verifying Stripe payment...");
        const checkout = await getSoftwareSaleStripeCheckoutSession(nextPacket.stripeCheckoutSessionId);
        if (cancelled) return;
        const checkoutSession = checkout.session;
        if (
          checkout.ok &&
          checkoutSession &&
          (checkoutSession.status === "complete" || checkoutSession.paymentStatus === "paid")
        ) {
          const paidSale =
            api.softwareSales.update(updated.id, {
              ...paidSalePatchFromCheckoutSession(checkoutSession, updated.stripePaidAt ?? new Date().toISOString()),
              signingPacketId: nextPacket.id,
              signedAgreementNames,
              signedAgreements,
              signedByName: signedAgreements[0]?.signedByName,
              signedByEmail: signedAgreements[0]?.signedByEmail,
              signedAt,
              signedPacketSubmittedAt: nextPacket.submittedAt,
              signedPacketSubmittedByName: nextPacket.submittedByName ?? signedAgreements[0]?.signedByName,
              signedPacketSubmittedByEmail: nextPacket.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
              invoiceEmailSentAt: nextPacket.invoiceEmailSentAt,
              invoiceEmailStatus: nextPacket.invoiceEmailStatus,
              invoiceEmailProvider: nextPacket.invoiceEmailProvider,
              invoiceEmailError: nextPacket.invoiceEmailError,
            }) ?? updated;
          setSale(paidSale);
          await sendInvoiceForSale(paidSale, nextPacket, true);
          return;
        }
      }
      if (!stripePaymentConfirmed(updated)) {
        setShareStatus("Signed payment packet received. Open Stripe Checkout to start the recurring monthly subscription.");
      }
    };

    void syncSignedSale();
    const interval = window.setInterval(() => void syncSignedSale(), 1000);
    const handleStorage = () => void syncSignedSale();
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
    };
  }, [invoiceSending, packetId, sale]);

  function setField<K extends keyof MasterPlanForm>(key: K, value: MasterPlanForm[K]) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
    resetPreparedPlan();
  }

  function resetPreparedPlan() {
    setSale(null);
    setPacketId(null);
    setShareStatus(null);
    setError(null);
  }

  function setSeats(nextSeats: number) {
    setField("seats", String(normalizeSoftwareUserCount(nextSeats)));
  }

  function validationError() {
    if (!form.agencyName.trim()) return "Add the agency name.";
    if (!form.contactName.trim()) return "Add the billing contact.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return "Add a valid billing email.";
    if (!form.phone.trim()) return "Add the billing phone number.";
    if (!hasSelectedUsers) return "Select the number of users.";
    if (customPriceActive && !hasCustomPrice) return "Add a custom monthly price greater than $0 or clear it.";
    return null;
  }

  function savePlanAndPrepareDocs() {
    const validation = validationError();
    if (validation) return setError(validation);
    const existingSale = sale;
    const saleInput = {
      agencyName: form.agencyName.trim(),
      contactName: form.contactName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      website: form.website.trim() || undefined,
      product: form.product,
      tier: billingTierForSeats(seats),
      seats,
      estimatedMonthly,
      setupFee: SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: effectiveWebsiteAppAddOn,
      websiteAppAddOnMonthly: addOnMonthly,
      termMonths,
      termDiscountPercent: selectedTerm.discountPercent,
      termDiscountMonthly,
      monthlyBeforeTermDiscount,
      standardEstimatedMonthly,
      customMonthlyPriceUsd: hasCustomPrice ? estimatedMonthly : undefined,
      customMonthlyPriceReason: hasCustomPrice ? customPriceReason.trim() || undefined : undefined,
      source: "master_portal" as const,
      paymentMode: "stripe_checkout" as const,
      status: "checkout_pending" as const,
      notes: form.notes.trim() || undefined,
    };
    const nextSale = existingSale
      ? api.softwareSales.update(existingSale.id, saleInput)
      : api.softwareSales.create(saleInput);
    if (!nextSale) return setError("The master plan could not be saved.");
    const nextPacket = createPacketForSale(nextSale);
    const saleWithPacketId =
      nextSale.signingPacketId === nextPacket.id
        ? nextSale
        : api.softwareSales.update(nextSale.id, { signingPacketId: nextPacket.id }) ?? nextSale;
    writeRemoteSigningPacket(nextPacket);
    void writeSharedRemoteSigningPacket(nextPacket).catch(() => undefined);
    setSale(saleWithPacketId);
    setPacketId(nextPacket.id);
    setPacketSyncRevision((current) => current + 1);
    setShareStatus("Plan saved. Send the payment authorization packet when ready.");
    setError(null);
  }

  useEffect(() => {
    reconcilePaidSoftwareSalesToAgencies();
  }, []);

  function createPacketForSale(nextSale: SoftwareSale): RemoteCheckoutPacket {
    const existing =
      packetId
        ? readRemoteSigningPacket(packetId)
        : nextSale.signingPacketId
          ? readRemoteSigningPacket(nextSale.signingPacketId)
          : null;
    const nextPacketId = existing?.id ?? nextSale.signingPacketId ?? createRemoteSigningPacketId();
    const now = new Date().toISOString();
    return {
      id: nextPacketId,
      saleId: nextSale.id,
      agencyName: nextSale.agencyName,
      contactName: nextSale.contactName,
      email: nextSale.email,
      phone: nextSale.phone ?? "",
      website: nextSale.website,
      product: nextSale.product,
      tier: nextSale.tier,
      seats: nextSale.seats,
      estimatedMonthly: nextSale.estimatedMonthly,
      setupFee: nextSale.setupFee,
      websiteAppAddOn: nextSale.websiteAppAddOn,
      websiteAppAddOnMonthly: nextSale.websiteAppAddOnMonthly,
      termMonths: (nextSale.termMonths ?? 12) as PlanTermMonths,
      termDiscountPercent: nextSale.termDiscountPercent ?? 0,
      termDiscountMonthly: nextSale.termDiscountMonthly,
      monthlyBeforeTermDiscount: nextSale.monthlyBeforeTermDiscount,
      standardEstimatedMonthly: nextSale.standardEstimatedMonthly,
      customMonthlyPriceUsd: nextSale.customMonthlyPriceUsd,
      customMonthlyPriceReason: nextSale.customMonthlyPriceReason,
      addOnLabel: WEBSITE_APP_ADD_ON_OPTIONS[nextSale.websiteAppAddOn ?? "none"].label,
      source: nextSale.source,
      paymentMode: nextSale.paymentMode,
      stripeCheckoutSessionId: nextSale.stripeCheckoutSessionId,
      invoiceEmailSentAt: nextSale.invoiceEmailSentAt,
      invoiceEmailStatus: nextSale.invoiceEmailStatus,
      invoiceEmailProvider: nextSale.invoiceEmailProvider,
      invoiceEmailError: nextSale.invoiceEmailError,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      submittedAt: existing?.submittedAt,
      submittedByName: existing?.submittedByName,
      submittedByEmail: existing?.submittedByEmail,
      paymentMethodEntry: existing?.paymentMethodEntry,
      signatures: existing?.signatures ?? emptyRemoteCheckoutSignatures(nextSale.contactName),
    };
  }

  function saveCustomPrice() {
    const parsed = Number.parseInt(customPriceValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setCustomPriceError("Enter a valid monthly price.");
      return;
    }
    setCustomPriceValue(String(parsed));
    setCustomPriceActive(true);
    setCustomPriceEditing(false);
    setCustomPriceError(null);
    resetPreparedPlan();
  }

  function clearCustomPrice() {
    setCustomPriceActive(false);
    setCustomPriceEditing(false);
    setCustomPriceValue("");
    setCustomPriceReason("");
    setCustomPriceError(null);
    resetPreparedPlan();
  }

  function ensurePacketLink() {
    if (!sale) {
      savePlanAndPrepareDocs();
      const latestPacket = packetId ? readRemoteSigningPacket(packetId) : null;
      return latestPacket ? signingLinkForPacket(latestPacket) : "";
    }
    const nextPacket = packet ?? createPacketForSale(sale);
    writeRemoteSigningPacket(nextPacket);
    void writeSharedRemoteSigningPacket(nextPacket).catch(() => undefined);
    setPacketId(nextPacket.id);
    if (sale.signingPacketId !== nextPacket.id) {
      const updatedSale = api.softwareSales.update(sale.id, { signingPacketId: nextPacket.id });
      if (updatedSale) setSale(updatedSale);
    }
    setPacketSyncRevision((current) => current + 1);
    return signingLinkForPacket(nextPacket);
  }

  async function copyLink() {
    const link = ensurePacketLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setShareStatus("Signing link copied.");
    } catch {
      setShareStatus(link);
    }
  }

  async function emailDocs() {
    const link = ensurePacketLink();
    if (!link) return;
    setShareStatus("Sending payment authorization email...");
    const result = await sendSoftwareSaleSigningEmail({
      agencyName: form.agencyName.trim(),
      contactName: form.contactName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      signingLink: link,
      documents: REQUIRED_CHECKOUT_FORMS.map((requiredForm) => ({
        title: requiredForm.title,
        version: requiredForm.version,
      })),
    });
    setShareStatus(formatCommunicationStatus(result, "Payment authorization email"));
  }

  async function sendInvoice() {
    if (!sale) return;
    if (!allSigned || !packet || !packetSubmitted) {
      return setShareStatus("The customer must submit the payment authorization packet before sending the invoice.");
    }
    await sendInvoiceForSale(sale, packet, false);
  }

  async function sendInvoiceForSale(targetSale: SoftwareSale, targetPacket: RemoteCheckoutPacket, automatic: boolean) {
    if (invoiceSending) return;
    if (!stripePaymentConfirmed(targetSale)) {
      await startStripeCheckoutForSale(targetSale, targetPacket, automatic);
      return;
    }
    if (
      targetSale.invoiceEmailSentAt ||
      targetSale.invoiceEmailStatus === "sent"
    ) {
      const provisionedAgency = provisionAgencyForCompletedSale(targetSale);
      api.softwareSales.update(targetSale.id, { status: "closed" });
      clearCompletedPlan(`Agency provisioned: ${provisionedAgency.name}. Build A Plan is ready for the next sale.`);
      return;
    }
    setShareStatus("Sending invoice email...");
    setInvoiceSending(true);
    const signedAgreements = signedAgreementsFromPacket(targetPacket);
    const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
    const signedAt = signedAtValues[signedAtValues.length - 1];
    const saleForEmail = {
      ...targetSale,
      signingPacketId: targetPacket.id,
      signedAgreementNames: signedAgreements.map((agreement) => agreement.title),
      signedAgreements,
      signedByName: signedAgreements[0]?.signedByName,
      signedByEmail: signedAgreements[0]?.signedByEmail,
      signedAt,
      signedPacketSubmittedAt: targetPacket.submittedAt,
      signedPacketSubmittedByName: targetPacket.submittedByName ?? signedAgreements[0]?.signedByName,
      signedPacketSubmittedByEmail: targetPacket.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
    };
    try {
      const result = await sendSoftwareSaleInvoiceEmail(saleForEmail);
      const updated = api.softwareSales.update(targetSale.id, {
        status: result.ok && result.result?.status === "sent" ? "closed" : targetSale.status,
        signingPacketId: targetPacket.id,
        signedAgreementNames: saleForEmail.signedAgreementNames,
        signedAgreements: saleForEmail.signedAgreements,
        signedByName: saleForEmail.signedByName,
        signedByEmail: saleForEmail.signedByEmail,
        signedAt: saleForEmail.signedAt,
        signedPacketSubmittedAt: saleForEmail.signedPacketSubmittedAt,
        signedPacketSubmittedByName: saleForEmail.signedPacketSubmittedByName,
        signedPacketSubmittedByEmail: saleForEmail.signedPacketSubmittedByEmail,
        ...softwareSaleInvoicePatchFromResult(result),
      });
      if (updated) setSale(updated);
      const statusMessage = formatCommunicationStatus(result, "Invoice email");
      if (result.ok && result.result?.status === "sent") {
        const completedSale = updated ?? { ...targetSale, ...softwareSaleInvoicePatchFromResult(result) };
        const provisionedAgency = provisionAgencyForCompletedSale(completedSale);
        api.softwareSales.update(completedSale.id, { status: "closed" });
        clearCompletedPlan(`${statusMessage} Agency provisioned: ${provisionedAgency.name}.`);
        return;
      }
      setShareStatus(statusMessage);
    } finally {
      setInvoiceSending(false);
    }
  }

  async function startStripeCheckoutForSale(targetSale: SoftwareSale, targetPacket: RemoteCheckoutPacket, automatic: boolean) {
    setShareStatus("Opening Stripe Checkout for the recurring monthly subscription...");
    setInvoiceSending(true);
    const signedAgreements = signedAgreementsFromPacket(targetPacket);
    const signedAtValues = signedAgreements.map((agreement) => agreement.signedAt).sort();
    const signedAt = signedAtValues[signedAtValues.length - 1];
    const saleForCheckout =
      api.softwareSales.update(targetSale.id, {
        status: "checkout_pending",
        paymentMode: "stripe_checkout",
        signingPacketId: targetPacket.id,
        signedAgreementNames: signedAgreements.map((agreement) => agreement.title),
        signedAgreements,
        signedByName: signedAgreements[0]?.signedByName,
        signedByEmail: signedAgreements[0]?.signedByEmail,
        signedAt,
        signedPacketSubmittedAt: targetPacket.submittedAt,
        signedPacketSubmittedByName: targetPacket.submittedByName ?? signedAgreements[0]?.signedByName,
        signedPacketSubmittedByEmail: targetPacket.submittedByEmail ?? signedAgreements[0]?.signedByEmail,
      }) ?? targetSale;
    setSale(saleForCheckout);
    try {
      const origin = window.location.origin;
      const session = await createSoftwareSaleStripeCheckoutSession(saleForCheckout, {
        master: true,
        successUrl: `${origin}/master/build-plan?stripe_success=1&session_id={CHECKOUT_SESSION_ID}&sale_id=${encodeURIComponent(
          saleForCheckout.id
        )}`,
        cancelUrl: `${origin}/master/build-plan?stripe_cancelled=1&sale_id=${encodeURIComponent(saleForCheckout.id)}`,
      });
      if (!session.ok || !session.url) {
        setShareStatus(session.message || session.error || "Stripe Checkout could not be started.");
        return;
      }
      const updatedSale =
        api.softwareSales.update(saleForCheckout.id, {
          stripeCheckoutSessionId: session.id,
          stripePaymentStatus: "checkout_pending",
        }) ?? saleForCheckout;
      setSale(updatedSale);
      const nextPacket = { ...targetPacket, stripeCheckoutSessionId: session.id, updatedAt: new Date().toISOString() };
      writeRemoteSigningPacket(nextPacket);
      void writeSharedRemoteSigningPacket(nextPacket).catch(() => undefined);
      setPacketSyncRevision((current) => current + 1);
      if (automatic) {
        setShareStatus("Signed packet received. Open Stripe Checkout to collect the recurring subscription payment.");
        return;
      }
      window.location.assign(session.url);
    } finally {
      setInvoiceSending(false);
    }
  }

  function clearCompletedPlan(message?: string) {
    setForm(blankForm);
    setTermMonths(12);
    setSale(null);
    setPacketId(null);
    setPacketSyncRevision((current) => current + 1);
    setCustomPriceActive(false);
    setCustomPriceValue("");
    setCustomPriceReason("");
    setCustomPriceEditing(false);
    setCustomPriceError(null);
    setError(null);
    try {
      localStorage.removeItem(MASTER_PLAN_BUILDER_DRAFT_KEY);
    } catch {
      // Non-critical: state above has already cleared the active builder.
    }
    setShareStatus(message ?? "Plan complete. Build A Plan is ready for the next sale.");
  }

  function openSigner() {
    const link = ensurePacketLink();
    if (!link) return;
    window.open(link, "_blank", "noopener,noreferrer");
    setShareStatus("Signer page opened in a new tab.");
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Build A Plan</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Master-side plan builder for phone sales. Build the monthly software plan, save it to
            billing, then send the secure payment authorization packet from here.
          </p>
        </div>
        {sale && (
          <Badge tone={packetSubmitted ? "success" : allSigned ? "gold" : "warn"}>
            {packetSubmitted ? "Packet complete" : allSigned ? "Awaiting submit" : "Packet pending"}
          </Badge>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Agency and billing contact" subtitle="This information appears on the plan documents." />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Agency name" value={form.agencyName} onChange={(value) => setField("agencyName", value)} />
              <Field label="Billing contact" value={form.contactName} onChange={(value) => setField("contactName", value)} />
              <Field label="Billing email" type="email" value={form.email} onChange={(value) => setField("email", value)} />
              <Field label="Phone" value={form.phone} onChange={(value) => setField("phone", value)} />
              <Field label="Current website (optional)" value={form.website} onChange={(value) => setField("website", value)} />
              <div>
                <label className="label">Provisioning notes (optional)</label>
                <textarea
                  className="input min-h-[88px]"
                  value={form.notes}
                  onChange={(event) => setField("notes", event.target.value)}
                  placeholder="Custom domain, launch timing, special pricing notes..."
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Monthly plan"
              subtitle={`${fmt.money(productSeatPrice)} per user per month, plus selected website or Quotex app add-ons.`}
            />
            <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div>
                <label className="label">Staff users</label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-outline h-11 w-11 justify-center px-0"
                    disabled={!hasSelectedUsers}
                    onClick={() => setSeats(hasSelectedUsers ? seats - 1 : 1)}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    className="input h-11 w-24 text-center text-lg font-semibold"
                    type="number"
                    min={1}
                    max={999}
                    value={form.seats}
                    onChange={(event) => setField("seats", event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-outline h-11 w-11 justify-center px-0"
                    onClick={() => setSeats(hasSelectedUsers ? seats + 1 : 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_USER_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={`btn-outline text-xs ${seats === count ? "border-gold-400 bg-gold-50 text-gold-800" : ""}`}
                      onClick={() => setSeats(count)}
                    >
                      {count} users
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {(Object.keys(WEBSITE_APP_ADD_ON_OPTIONS) as SoftwareSaleWebsiteAppAddOn[]).map((addOn) => {
                  const option = WEBSITE_APP_ADD_ON_OPTIONS[addOn];
                  const selected = form.websiteAppAddOn === addOn;
                  return (
                    <button
                      key={addOn}
                      type="button"
                      className={`rounded-lg border p-4 text-left text-sm transition ${
                        selected
                          ? "border-gold-400 bg-gold-50 shadow-sm"
                          : "border-ink-200 bg-white hover:border-gold-300"
                      }`}
                      onClick={() => setField("websiteAppAddOn", addOn)}
                    >
                      <div className="flex justify-between gap-3">
                        <span className="font-semibold text-ink-900">{option.label}</span>
                        <span className="shrink-0 text-ink-700">
                          {option.monthlyPriceUsd ? `${fmt.money(option.monthlyPriceUsd)}/mo` : "No add-on"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-ink-500">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-ink-100 bg-ink-50 p-4">
              <div className="label">Term</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {TERM_OPTIONS.map((term) => (
                  <button
                    key={term.months}
                    type="button"
                    className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                      termMonths === term.months
                        ? "border-gold-400 bg-white text-gold-800"
                        : "border-ink-200 bg-white text-ink-800"
                    }`}
                    onClick={() => {
                      setTermMonths(term.months);
                      resetPreparedPlan();
                    }}
                  >
                    {term.label}
                    <span className="ml-1 text-xs text-ink-500">
                      {term.discountPercent ? `${term.discountPercent}% off` : "standard"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Final plan"
              subtitle={hasSelectedUsers ? "Save the plan before sending documents." : "Select users to calculate the plan."}
            />
            <div className="space-y-3 text-sm">
              <PlanRow
                label="Product"
                value="Full software"
                detail="Full Quotex software"
              />
              <PlanRow
                label="Staff users"
                value={hasSelectedUsers ? `${fmt.money(userSubtotal)}/mo` : "Pending"}
                detail={hasSelectedUsers ? `${seats} x ${fmt.money(productSeatPrice)}` : undefined}
              />
              <PlanRow
                label="Website / Quotex app package"
                value={websiteAppRetailMonthly ? `${fmt.money(websiteAppRetailMonthly)}/mo` : "None"}
                detail={WEBSITE_APP_ADD_ON_OPTIONS[effectiveWebsiteAppAddOn].label}
              />
              {bundleDiscount > 0 && <PlanRow label="Bundle discount" value={`-${fmt.money(bundleDiscount)}/mo`} />}
              {termDiscountMonthly > 0 && (
                <PlanRow
                  label={`${selectedTerm.label} term discount`}
                  value={`-${fmt.money(termDiscountMonthly)}/mo`}
                  detail={`${selectedTerm.discountPercent}% off`}
                />
              )}
              <div
                className={`rounded-lg border p-3 ${
                  hasCustomPrice
                    ? "border-gold-200 bg-gold-50"
                    : "border-ink-100 bg-ink-50"
                }`}
              >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                        Master custom price
                      </div>
                      <div className="mt-1 text-sm text-ink-600">
                        Standard calculated price: {hasSelectedUsers ? `${fmt.money(standardEstimatedMonthly)}/mo` : "Pending"}
                      </div>
                      {hasCustomPrice && (
                        <div className={customPriceDelta >= 0 ? "mt-1 text-xs font-semibold text-emerald-700" : "mt-1 text-xs font-semibold text-amber-700"}>
                          {customPriceDelta === 0
                            ? "Custom price matches standard."
                            : customPriceDelta > 0
                              ? `${fmt.money(customPriceDelta)}/mo custom savings`
                              : `${fmt.money(Math.abs(customPriceDelta))}/mo above standard`}
                        </div>
                      )}
                    </div>
                    {!customPriceEditing && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          disabled={!hasSelectedUsers}
                          onClick={() => {
                            setCustomPriceValue((current) => current || String(estimatedMonthly));
                            setCustomPriceEditing(true);
                            setCustomPriceError(null);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" /> {hasCustomPrice ? "Edit price" : "Custom price"}
                        </button>
                        {hasCustomPrice && (
                          <button type="button" className="btn-ghost text-xs" onClick={clearCustomPrice}>
                            <X className="h-3.5 w-3.5" /> Clear
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {customPriceEditing && (
                    <div className="mt-3 space-y-3 rounded-md border border-white/70 bg-white p-3">
                      <div>
                        <label className="label">Custom monthly price</label>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={customPriceValue}
                          onChange={(event) => {
                            setCustomPriceValue(event.target.value);
                            setCustomPriceError(null);
                          }}
                          placeholder={String(standardEstimatedMonthly)}
                        />
                      </div>
                      <div>
                        <label className="label">Reason (optional)</label>
                        <textarea
                          className="input min-h-[74px]"
                          value={customPriceReason}
                          onChange={(event) => setCustomPriceReason(event.target.value)}
                          placeholder="Founder-approved price, referral deal, launch credit..."
                        />
                      </div>
                      {customPriceError && <div className="text-xs text-red-600">{customPriceError}</div>}
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => {
                            setCustomPriceEditing(false);
                            setCustomPriceError(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button type="button" className="btn-gold text-xs" onClick={saveCustomPrice}>
                          <Save className="h-3.5 w-3.5" /> Save custom price
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              <div className="border-t border-ink-100 pt-4">
                <div className="text-xs uppercase tracking-wider text-ink-500">Final monthly price</div>
                <div className="mt-1 text-3xl font-semibold text-ink-950">
                  {hasSelectedUsers ? fmt.money(estimatedMonthly) : "--"}
                  {hasSelectedUsers && <span className="ml-1 text-base text-ink-500">/mo</span>}
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="button" className="btn-gold mt-5 w-full justify-center" onClick={savePlanAndPrepareDocs}>
              <ReceiptText className="h-4 w-4" /> Save plan and prepare payment packet
            </button>
          </Card>

          <Card>
            <CardHeader
              title="Send payment authorization"
              subtitle="Send one secure packet for electronic signatures, then open Stripe Checkout for the recurring subscription."
            />
            {sale ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-ink-100 bg-ink-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink-900">{sale.agencyName}</div>
                      <div className="text-xs text-ink-500">{sale.contactName} - {sale.email}</div>
                    </div>
                    <Badge tone={packetSubmitted ? "success" : allSigned ? "gold" : "warn"}>
                      {packetSubmitted ? "Submitted" : `${signedCount}/${REQUIRED_CHECKOUT_FORMS.length} signed`}
                    </Badge>
                  </div>
                  {packet?.submittedAt && (
                    <div className="mt-3 rounded-md border border-emerald-100 bg-white px-3 py-2 text-xs text-emerald-700">
                      Signed packet submitted {fmt.dateTime(packet.submittedAt)} by{" "}
                      {packet.submittedByName ?? sale.contactName}.
                    </div>
                  )}
                  {packet?.paymentMethodEntry && (
                    <div className="mt-3 rounded-md border border-gold-100 bg-white px-3 py-2 text-xs text-gold-800">
                      Payment method saved: {paymentEntryLabel(packet.paymentMethodEntry.label, packet.paymentMethodEntry.last4)}.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-outline justify-center text-xs" onClick={emailDocs}>
                    <Mail className="h-4 w-4" /> Email
                  </button>
                  <button type="button" className="btn-outline justify-center text-xs" onClick={copyLink}>
                    <Copy className="h-4 w-4" /> Copy link
                  </button>
                  <button type="button" className="btn-outline justify-center text-xs" onClick={openSigner}>
                    <ExternalLink className="h-4 w-4" /> Open signer
                  </button>
                </div>
                <button
                  type="button"
                  className={`btn-gold w-full justify-center text-xs ${packetSubmitted && !invoiceSending ? "" : "cursor-not-allowed opacity-50"}`}
                  disabled={!packetSubmitted || invoiceSending}
                  onClick={sendInvoice}
                >
                  <ReceiptText className="h-4 w-4" />{" "}
                  {invoiceSent
                    ? "Invoice and agency code sent"
                    : invoiceSending
                      ? "Working..."
                      : stripePaymentConfirmed(sale)
                        ? "Send invoice and agency code"
                        : "Open recurring Stripe checkout"}
                </button>

                {shareStatus && (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {shareStatus}
                  </div>
                )}

                <div className="space-y-2">
                  {REQUIRED_CHECKOUT_FORMS.map((requiredForm) => {
                    const signature = packet?.signatures[requiredForm.id];
                    return (
                      <div key={requiredForm.id} className="flex items-center justify-between gap-3 rounded-md border border-ink-100 px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-gold-600" />
                          <span className="truncate font-medium">{requiredForm.title}</span>
                        </div>
                        {signature?.signedAt ? (
                          <span className="shrink-0 text-xs font-semibold text-emerald-700">
                            Signed {fmt.dateTime(signature.signedAt)}
                          </span>
                        ) : (
                          <span className="shrink-0 text-xs text-ink-400">Pending</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
                Save the plan first, then send the payment authorization packet from here.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function PlanRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="font-semibold text-ink-900">{label}</div>
        {detail && <div className="mt-0.5 text-xs text-ink-500">{detail}</div>}
      </div>
      <div className="shrink-0 font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function loadMasterPlanBuilderDraft() {
  const fallback = {
    form: blankForm,
    termMonths: 12 as PlanTermMonths,
    sale: null as SoftwareSale | null,
    packetId: null as string | null,
    customPriceActive: false,
    customPriceValue: "",
    customPriceReason: "",
  };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(MASTER_PLAN_BUILDER_DRAFT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<MasterPlanBuilderDraft>;
    const savedSale = parsed.saleId ? api.softwareSales.get(parsed.saleId) : null;
    return {
      form: { ...blankForm, ...(parsed.form ?? {}) },
      termMonths: isPlanTermMonths(parsed.termMonths) ? parsed.termMonths : fallback.termMonths,
      sale: savedSale ?? null,
      packetId: parsed.packetId ?? null,
      customPriceActive: !!parsed.customPriceActive,
      customPriceValue: parsed.customPriceValue ?? "",
      customPriceReason: parsed.customPriceReason ?? "",
    };
  } catch {
    return fallback;
  }
}

function saveMasterPlanBuilderDraft(draft: MasterPlanBuilderDraft) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MASTER_PLAN_BUILDER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Browser storage can be unavailable in private mode; the active page still keeps state in memory.
  }
}

function isPlanTermMonths(value: unknown): value is PlanTermMonths {
  return value === 12 || value === 24 || value === 36;
}

function stripePaymentConfirmed(sale: SoftwareSale): boolean {
  return sale.stripePaymentStatus === "paid" || !!sale.stripePaidAt;
}

function paidSalePatchFromCheckoutSession(
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

function paymentEntryLabel(label: string, last4: string) {
  return `${label} ending in ${last4}`;
}

function recoverSoftwareSaleFromPacket(packet: RemoteCheckoutPacket): SoftwareSale | null {
  if (packet.saleId) {
    const existing = api.softwareSales.get(packet.saleId);
    if (existing) {
      return existing.signingPacketId === packet.id
        ? existing
        : api.softwareSales.update(existing.id, { signingPacketId: packet.id }) ?? existing;
    }
  }
  try {
    return api.softwareSales.create({
      agencyName: packet.agencyName,
      contactName: packet.contactName,
      email: packet.email,
      phone: packet.phone,
      website: packet.website,
      product: packet.product,
      tier: packet.tier ?? billingTierForSeats(packet.seats),
      seats: packet.seats,
      estimatedMonthly: packet.estimatedMonthly,
      setupFee: packet.setupFee ?? SOFTWARE_SETUP_FEE_USD,
      websiteAppAddOn: packet.websiteAppAddOn ?? websiteAppAddOnFromPacket(packet),
      websiteAppAddOnMonthly: packet.websiteAppAddOnMonthly ?? 0,
      termMonths: packet.termMonths,
      termDiscountPercent: packet.termDiscountPercent,
      termDiscountMonthly: packet.termDiscountMonthly ?? 0,
      monthlyBeforeTermDiscount: packet.monthlyBeforeTermDiscount ?? packet.estimatedMonthly,
      standardEstimatedMonthly: packet.standardEstimatedMonthly ?? packet.estimatedMonthly,
      customMonthlyPriceUsd: packet.customMonthlyPriceUsd,
      customMonthlyPriceReason: packet.customMonthlyPriceReason,
      source: packet.source ?? "master_portal",
      paymentMode: packet.paymentMode ?? "stripe_checkout",
      notes: `Recovered from submitted signing packet ${packet.id}.`,
      stripeCheckoutSessionId: packet.stripeCheckoutSessionId,
      invoiceEmailSentAt: packet.invoiceEmailSentAt,
      invoiceEmailStatus: packet.invoiceEmailStatus,
      invoiceEmailProvider: packet.invoiceEmailProvider,
      invoiceEmailError: packet.invoiceEmailError,
      signingPacketId: packet.id,
    });
  } catch {
    return null;
  }
}

function websiteAppAddOnFromPacket(packet: RemoteCheckoutPacket): SoftwareSaleWebsiteAppAddOn {
  const matched = (Object.keys(WEBSITE_APP_ADD_ON_OPTIONS) as SoftwareSaleWebsiteAppAddOn[]).find(
    (key) => WEBSITE_APP_ADD_ON_OPTIONS[key].label === packet.addOnLabel
  );
  return matched ?? "none";
}

function billingTierForSeats(seats: number): SubscriptionTier {
  if (seats <= 10) return "minimum";
  if (seats <= 25) return "mid";
  return "ultra";
}

function signingLinkForPacket(packet: RemoteCheckoutPacket) {
  return `${window.location.origin}/checkout/sign/${packet.id}?p=${encodeRemotePacketPayload(packet)}`;
}

function newestSigningPacket(
  localPacket: RemoteCheckoutPacket | null,
  sharedPacket: RemoteCheckoutPacket | null
): RemoteCheckoutPacket | null {
  if (!localPacket) return sharedPacket;
  if (!sharedPacket) return localPacket;
  if (sharedPacket.submittedAt && !localPacket.submittedAt) return sharedPacket;
  if (localPacket.submittedAt && !sharedPacket.submittedAt) return localPacket;
  return sharedPacket.updatedAt >= localPacket.updatedAt ? sharedPacket : localPacket;
}

function sameSigningPacketSnapshot(a: RemoteCheckoutPacket | null, b: RemoteCheckoutPacket | null) {
  if (!a || !b) return a === b;
  return (
    a.updatedAt === b.updatedAt &&
    a.submittedAt === b.submittedAt &&
    a.paymentMethodEntry?.enteredAt === b.paymentMethodEntry?.enteredAt &&
    REQUIRED_CHECKOUT_FORMS.every(
      (requiredForm) =>
        a.signatures[requiredForm.id]?.viewedAt === b.signatures[requiredForm.id]?.viewedAt &&
        a.signatures[requiredForm.id]?.signedAt === b.signatures[requiredForm.id]?.signedAt &&
        a.signatures[requiredForm.id]?.signerName === b.signatures[requiredForm.id]?.signerName
    )
  );
}

function signedAgreementsFromPacket(packet: RemoteCheckoutPacket): SoftwareSaleSignedAgreement[] {
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

function formatCommunicationStatus(result: CommunicationResult, label: string) {
  if (result.ok && result.result?.status === "sent") {
    return `${label} sent through ${result.result.provider}.`;
  }
  return result.result?.error ?? result.error ?? `${label} could not be sent.`;
}
