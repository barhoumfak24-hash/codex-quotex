import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Briefcase,
  Camera,
  CheckCircle2,
  FileImage,
  Gem,
  HelpCircle,
  Home,
  Layers,
  Loader2,
  Sailboat,
  ScanLine,
  Sparkles,
  Umbrella,
  Upload,
  X,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import type { AddressParts } from "@/lib/addressSearch";
import { useCustomer } from "@/lib/useCustomer";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { driverLicenseInputValue, parseAamvaDriverLicense } from "@/lib/idScanner";
import {
  aiCarrierMatch,
  aiEnrichAsset,
  aiPremiumEstimate,
  aiProspectSummary,
} from "@/lib/ai";
import { fmt } from "@/lib/format";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";
import { categoryQuestionnaire } from "@/lib/categoryQuestionnaires";
import { isVinInputField, normalizeVinFieldValue, uppercaseVinInput } from "@/lib/vinInput";
import type {
  AssetType,
  CategoryQuestion,
  InsuranceCategory,
  QuoteRequest,
} from "@/types";

type BarcodeDetection = {
  rawValue: string;
  format?: string;
};

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<BarcodeDetection[]>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorConstructor(): BarcodeDetectorConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

// =====================================================================
// Customer "Get a private quote" express flow.
//
// One screen. Customer picks what they want insured, fills in name /
// phone / email / asset identifier (VIN / address / asset id) /
// driver's license number (or scan), and submits. The AI does the
// rest:
//   1. aiEnrichAsset pulls public records on the asset
//   2. aiPremiumEstimate produces a ballpark range
//   3. aiCarrierMatch picks the top recommendation
//   4. We create the QuoteRequest + Prospect + Activity Center task
//      pre-loaded with a questionnaire the agent sends as their reply
//   5. Customer gets a confirmation SMS
//
// Existing customers get their name / phone / email pre-filled from
// the account on file; everything stays editable so they can update
// before submitting.
// =====================================================================

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Home,
  Briefcase,
  Sailboat,
  Gem,
  Umbrella,
  Layers,
  HelpCircle,
};

// Label + placeholder for the single "asset identifier" field shown
// once an asset type is selected.
function assetIdentifierConfig(type: AssetType): {
  label: string;
  placeholder: string;
  helper: string;
  kind: "address" | "vin" | "text";
} {
  switch (type) {
    case "coastal_home":
      return {
        label: "Property address",
        placeholder: "Start typing your address…",
        helper:
          "We'll auto-pull flood zone, year built, square footage, construction type, and roof material from public records.",
        kind: "address",
      };
    case "luxury_vehicle":
      return {
        label: "VIN",
        placeholder: "17-character vehicle identification number",
        helper:
          "We'll decode year / make / model / trim and pull a market-value range from public auto-data sources.",
        kind: "vin",
      };
    case "yacht":
      return {
        label: "Hull ID (HIN) or vessel name",
        placeholder: "Hull ID or registered name",
        helper:
          "We'll cross-reference the vessel record (length / year / make / model) where available.",
        kind: "text",
      };
    case "jewelry":
      return {
        label: "Appraisal ID or short description",
        placeholder: "e.g. 4ct round diamond engagement ring + matching band",
        helper:
          "An itemized appraisal speeds binding; we'll request it from you in the follow-up.",
        kind: "text",
      };
    case "umbrella_liability":
      return {
        label: "Underlying primary policy reference",
        placeholder: "HO or Auto policy number on file",
        helper:
          "Umbrella limits stack above your underlying auto / homeowners — share the primary policy so we can size the umbrella correctly.",
        kind: "text",
      };
    case "full_portfolio":
      return {
        label: "Primary asset (address or VIN)",
        placeholder: "Address of primary home or VIN of primary vehicle",
        helper:
          "We'll start with the largest item and request the rest of the schedule in the follow-up.",
        kind: "text",
      };
    case "other":
    default:
      return {
        label: "Asset description",
        placeholder: "Describe what you'd like to insure",
        helper:
          "Your agent will reach out for specifics if the AI can't classify it automatically.",
        kind: "text",
      };
  }
}

function primaryIdentifierQuestionKeys(
  assetType: AssetType,
  kind: "address" | "vin" | "text"
): Set<string> {
  if (kind === "address") {
    return new Set(["address", "propertyAddress", "riskAddress", "primaryResidenceAddress"]);
  }
  if (kind === "vin") return new Set(["vin"]);
  if (assetType === "yacht") return new Set(["hin", "vesselName"]);
  return new Set();
}

function normalizeCategoryAnswer(question: CategoryQuestion, raw: string): unknown {
  const value = raw.trim();
  if (!value) return undefined;
  if (question.inputType === "number" || question.inputType === "currency") {
    const numeric = Number(value.replace(/[$,]/g, ""));
    return Number.isFinite(numeric) ? numeric : value;
  }
  if (question.inputType === "boolean") {
    if (/^yes$/i.test(value)) return true;
    if (/^no$/i.test(value)) return false;
  }
  return value;
}

function buildCategoryParsedData(
  questions: CategoryQuestion[],
  answers: Record<string, string>
): Record<string, unknown> {
  return questions.reduce<Record<string, unknown>>((acc, question) => {
    const normalized = normalizeCategoryAnswer(question, answers[question.key] ?? "");
    if (normalized !== undefined) acc[question.key] = normalized;
    return acc;
  }, {});
}

function numericAnswer(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringifyRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim().length > 0)
      .map(([key, value]) => [key, String(value)])
  );
}

export function QuoteFlowPage() {
  const customer = useCustomer();
  const { agency } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isAppSurface = getAppSurface() === "agencyApp";
  const appRoute = (path: string) =>
    isAppSurface ? toAppRoute(path) : toSurfaceRoute(path, pathname);

  const categories = api.categories.listActiveForTenant(agency?.id ?? "");

  const [lineOfBusiness, setLineOfBusiness] = useState<"personal" | "commercial" | null>(null);
  const [pickedCategory, setPickedCategory] = useState<InsuranceCategory | null>(null);
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [assetId, setAssetId] = useState("");
  const [categoryAnswers, setCategoryAnswers] = useState<Record<string, string>>({});
  const [selectedAddressParts, setSelectedAddressParts] = useState<AddressParts | null>(null);
  const [dlNumber, setDlNumber] = useState("");
  const [dlFileName, setDlFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<QuoteRequest | null>(null);
  const visibleCategories = lineOfBusiness
    ? categories.filter((c) => (c.lineOfBusiness ?? "personal") === lineOfBusiness)
    : [];

  // Pull existing customer data forward as defaults if the customer
  // record finishes loading after first render.
  useEffect(() => {
    if (!customer) return;
    if (!name) setName(customer.name);
    if (!phone && customer.phone) setPhone(customer.phone);
    if (!email) setEmail(customer.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  const assetType: AssetType | null = pickedCategory?.assetType ?? null;
  const idCfg = assetType ? assetIdentifierConfig(assetType) : null;
  const categoryQuestions = useMemo(
    () =>
      pickedCategory && assetType && idCfg
        ? categoryQuestionnaire(pickedCategory).filter(
            (question) => !primaryIdentifierQuestionKeys(assetType, idCfg.kind).has(question.key)
          )
        : [],
    [pickedCategory, assetType, idCfg?.kind]
  );
  const requiredCategoryQuestionsAnswered = categoryQuestions
    .filter((question) => question.required)
    .every((question) => String(categoryAnswers[question.key] ?? "").trim().length > 0);

  const canSubmit =
    !!lineOfBusiness &&
    !!pickedCategory &&
    !!assetType &&
    name.trim().length > 1 &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    phone.trim().length >= 7 &&
    assetId.trim().length > 0 &&
    (dlNumber.trim().length >= 4 || !!dlFileName) &&
    requiredCategoryQuestionsAnswered;

  const quoteStep = !lineOfBusiness
    ? "policy line"
    : !pickedCategory
    ? "coverage type"
    : name.trim().length <= 1 || !/^\S+@\S+\.\S+$/.test(email.trim()) || phone.trim().length < 7
    ? "contact information"
    : assetId.trim().length === 0
    ? idCfg?.label ?? "asset details"
    : dlNumber.trim().length < 4 && !dlFileName
    ? "ID verification"
    : !requiredCategoryQuestionsAnswered
    ? "category questionnaire"
    : "review and submit";
  const quoteCompletionPercent = !lineOfBusiness
    ? 10
    : !pickedCategory
    ? 20
    : name.trim().length <= 1 || !/^\S+@\S+\.\S+$/.test(email.trim()) || phone.trim().length < 7
    ? 45
    : assetId.trim().length === 0
    ? 65
    : dlNumber.trim().length < 4 && !dlFileName
    ? 82
    : !requiredCategoryQuestionsAnswered
    ? 88
    : 94;
  const lastIncompleteSaveKey = useRef("");

  useEffect(() => {
    setCategoryAnswers({});
  }, [pickedCategory?.id]);

  useEffect(() => {
    if (!agency || !user || !customer || submitted || busy) return;
    if (!pickedCategory || !assetType) return;
    const saveKey = JSON.stringify({
      tenantId: agency.id,
      customerId: customer.id,
      lineOfBusiness,
      categoryId: pickedCategory.id,
      name,
      email,
      phone,
      assetId,
      selectedAddressParts,
      dlNumber,
      dlFileName,
      categoryAnswers,
      quoteStep,
    });
    if (saveKey === lastIncompleteSaveKey.current) return;
    const timer = window.setTimeout(() => {
      const quoteRequest = api.quotes.recordIncompleteWorkflow({
        tenantId: agency.id,
        customerId: customer.id,
        assetType,
        lineOfBusiness: lineOfBusiness ?? undefined,
        categoryId: pickedCategory.id,
        categoryLabel: pickedCategory.label,
        contactName: name.trim() || customer.name,
        contactEmail: email.trim(),
        contactPhone: phone.trim(),
        assetIdentifier: assetId.trim(),
        parsedData: buildCategoryParsedData(categoryQuestions, categoryAnswers),
        currentStep: quoteStep,
        completionPercent: quoteCompletionPercent,
        assignedAgentId: customer.assignedAgentId,
        createdById: user.id,
      });
      const quoteSession = api.quoting.upsertCustomerIntakeSession({
        tenantId: agency.id,
        customerId: customer.id,
        quoteRequestId: quoteRequest.id,
        assetType,
        lineOfBusiness: lineOfBusiness ?? undefined,
        categoryId: pickedCategory.id,
        categoryLabel: pickedCategory.label,
        contactName: name.trim() || customer.name,
        address: assetId.trim(),
        estimatedValue: numericAnswer(categoryAnswers.estimatedValue),
        assetDetails: {
          ...stringifyRecord(buildCategoryParsedData(categoryQuestions, categoryAnswers)),
          assetIdentifier: assetId.trim(),
        },
        questionnaireAnswers: categoryAnswers,
        assignedAgentId: customer.assignedAgentId,
        createdById: user.id,
        status: "quote_started",
      });
      if (quoteRequest.quoteSessionId !== quoteSession.id) {
        api.quotes.update(quoteRequest.id, { quoteSessionId: quoteSession.id });
      }
      lastIncompleteSaveKey.current = saveKey;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    agency,
    user,
    customer,
    submitted,
    busy,
    pickedCategory,
    assetType,
    lineOfBusiness,
    name,
    email,
    phone,
    assetId,
    selectedAddressParts,
    dlNumber,
    dlFileName,
    categoryQuestions,
    categoryAnswers,
    quoteStep,
    quoteCompletionPercent,
  ]);

  async function submit() {
    if (!agency || !user || !customer || !lineOfBusiness || !pickedCategory || !assetType || !idCfg) return;
    setError(null);
    setBusy(true);
    try {
      // Persist updated contact info on the customer record so the
      // agent has the latest on file before reaching out.
      const routedCustomer = api.customers.update(customer.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        lineOfBusiness,
      }) ?? customer;

      // 1. AI public-records lookup on the asset.
      const enrichSeed: Record<string, unknown> = {};
      if (idCfg.kind === "address") {
        enrichSeed.address = assetId.trim();
        if (selectedAddressParts) {
          enrichSeed.addressParts = selectedAddressParts;
          enrichSeed.streetAddress = selectedAddressParts.street;
          enrichSeed.unit = selectedAddressParts.apt || undefined;
          enrichSeed.city = selectedAddressParts.city;
          enrichSeed.state = selectedAddressParts.state;
          enrichSeed.zip = selectedAddressParts.zip;
        }
      } else if (idCfg.kind === "vin") enrichSeed.vin = uppercaseVinInput(assetId).trim();
      else enrichSeed.description = assetId.trim();
      const enrichment = await aiEnrichAsset(assetType, enrichSeed, categoryQuestions);

      // Merge enriched fields with the raw inputs so the estimate
      // has the richest picture available.
      const fields: Record<string, unknown> = {
        ...enrichSeed,
        ...enrichment.fields,
        lineOfBusiness,
        driversLicenseNumber: dlNumber.trim() || undefined,
        driversLicenseDocument: dlFileName ?? undefined,
        ...buildCategoryParsedData(categoryQuestions, categoryAnswers),
      };

      // 2. AI ballpark estimate + carrier match.
      const carriers = api.carriers.listForTenant(agency.id);
      const [estimate, carrierMatch] = await Promise.all([
        aiPremiumEstimate({ assetType, parsedData: fields }, carriers),
        aiCarrierMatch({ assetType, parsedData: fields }, carriers),
      ]);

      // 3. Quote row.
      const displayAssetId = idCfg.kind === "vin" ? uppercaseVinInput(assetId).trim() : assetId.trim();
      const rawDescription = `Express quote (${lineOfBusiness} lines): ${pickedCategory.label}. Asset: ${displayAssetId}.`;
      const quote = api.quotes.submitCustomerQuote({
        tenantId: agency.id,
        customerId: customer.id,
        assetType,
        lineOfBusiness,
        categoryId: pickedCategory.id,
        categoryLabel: pickedCategory.label,
        rawDescription,
        parsedData: fields,
        publicFieldEvidence: enrichment.evidence,
        aiPremiumEstimateMin: estimate?.min,
        aiPremiumEstimateMax: estimate?.max,
        aiPremiumEstimateConfidence: estimate?.confidence,
        aiPremiumEstimateRationale: estimate?.rationale,
        aiPremiumEstimateSources: estimate?.sourceSummary,
        aiPremiumEstimateFactors: estimate?.pricingFactors,
        aiRecommendedCarrierId: carrierMatch?.carrierId,
        aiRecommendationReason: carrierMatch?.reason,
        missingDocuments: estimate?.missingDocuments ?? [],
        status: "submitted_to_agent",
        assignedAgentId: routedCustomer.assignedAgentId,
      });
      const quoteSession = api.quoting.upsertCustomerIntakeSession({
        tenantId: agency.id,
        customerId: customer.id,
        quoteRequestId: quote.id,
        assetType,
        lineOfBusiness,
        categoryId: pickedCategory.id,
        categoryLabel: pickedCategory.label,
        contactName: name.trim(),
        address: fields.address ? String(fields.address) : assetId.trim(),
        estimatedValue: (fields.estimatedValue as number | undefined) ?? estimate?.max,
        assetDetails: stringifyRecord(fields),
        publicFieldEvidence: enrichment.evidence,
        questionnaireAnswers: categoryAnswers,
        assignedAgentId: routedCustomer.assignedAgentId,
        createdById: user.id,
        status: "submitted_to_agent",
      });
      if (quote.quoteSessionId !== quoteSession.id) {
        api.quotes.update(quote.id, { quoteSessionId: quoteSession.id });
      }

      // 4. Timeline crumbs (customer-visible).
      api.status.create({
        tenantId: agency.id,
        source: "ai",
        message: `AI generated preliminary quote for ${api.helpers.assetTypeLabel(assetType)}.`,
        visibility: "customer_visible",
        customerId: customer.id,
      });
      api.status.create({
        tenantId: agency.id,
        source: "system",
        message: "Quote submitted to agent for review.",
        visibility: "customer_visible",
        customerId: customer.id,
      });

      // 5. Prospect mirror so the agent's prospect queue picks it up.
      const aiSummary = await aiProspectSummary({
        assetType,
        estimatedValue:
          (fields.estimatedValue as number | undefined) ?? estimate?.max,
        lastAction: "Submitted express quote",
        rawDescription,
      });
      api.prospects.create({
        tenantId: agency.id,
        customerId: customer.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        lineOfBusiness,
        assetType,
        estimatedValue: (fields.estimatedValue as number | undefined) ?? undefined,
        aiSummary: aiSummary.summary,
        lastAction: "Submitted express quote",
        lastActivityAt: new Date().toISOString(),
        recommendedFollowUp: aiSummary.recommendedFollowUp,
        marketingStatus: customer.marketingOptInEmail ? "active" : "none",
        status: "quote_in_progress",
        quoteRequestId: quote.id,
        assignedAgentId: routedCustomer.assignedAgentId,
      });

      // 6. Email confirmation to the customer.
      const firstName = name.trim().split(/\s+/)[0];
      if (email.trim()) {
        api.communications.create({
          tenantId: agency.id,
          customerId: customer.id,
          channel: "email",
          direction: "outbound",
          subject: "Your quote request was received",
          body: `Hi ${firstName},\n\nThank you. We received your quote request and an agent will be in touch shortly with carrier options.`,
          createdById: "ai",
        });
      }

      // 7. Activity Center task with pre-drafted questionnaire reply.
      const reply = buildQuestionnaireReplyBody({
        contactName: name.trim(),
        agencyName: agency.name,
        assetType,
        assetLabel: api.helpers.assetTypeLabel(assetType),
        categoryLabel: pickedCategory.label,
        questions: categoryQuestions,
      });
      api.tasks.createExpressQuoteFollowUp({
        tenantId: agency.id,
        customerId: customer.id,
        title: `Express quote — ${name.trim()}: ${api.helpers.assetTypeLabel(assetType)}`,
        description: `Customer submitted an express quote request. AI pulled public records + generated a ballpark estimate; send the follow-up questionnaire to lock in real numbers.`,
        aiSummary: aiSummary.summary,
        aiReplyBody: reply.body,
        aiReplySubject: reply.subject,
        severity: "warning",
        severityReason: "New express-quote submission — questionnaire ready to send.",
        assignedToId: customer.assignedAgentId,
        createdById: user.id,
        quoteRequestId: quote.id,
        quoteSessionId: quoteSession.id,
      });

      setSubmitted(quote);
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // ---------- Submitted success screen ----------
  if (submitted && agency) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card className="text-center !p-10">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
          <h2 className="font-display text-2xl mt-4">Quote submitted</h2>
          <p className="text-ink-600 mt-2">
            Your dedicated agent at {agency.name} will review your file and reach out
            shortly.
          </p>
          {submitted.aiPremiumEstimateMin != null && submitted.aiPremiumEstimateMax != null && (
            <div className="mt-6 rounded-md border border-ink-100 bg-ink-50/40 px-4 py-3 text-sm text-ink-700">
              Preliminary range:{" "}
              <strong className="text-ink-900">
                {fmt.money(submitted.aiPremiumEstimateMin)} –{" "}
                {fmt.money(submitted.aiPremiumEstimateMax)}
              </strong>
              {(submitted.aiPremiumEstimateConfidence != null ||
                (submitted.aiPremiumEstimateSources ?? []).length > 0) && (
                <div className="text-[11px] text-ink-500 mt-1">
                  {submitted.aiPremiumEstimateConfidence != null
                    ? `Research confidence ${Math.round(submitted.aiPremiumEstimateConfidence * 100)}%`
                    : "Research basis saved"}
                  {(submitted.aiPremiumEstimateSources ?? []).length > 0
                    ? ` · ${(submitted.aiPremiumEstimateSources ?? []).slice(0, 2).join(" · ")}`
                    : ""}
                </div>
              )}
              <div className="text-[11px] text-ink-500 mt-1">
                AI ballpark — your agent confirms the final number with the carrier.
              </div>
            </div>
          )}
          {email.trim() && (
            <p className="text-xs text-ink-500 mt-4">
              A confirmation email is on its way to {email.trim()}.
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Link to={appRoute("/customer")} className="btn-primary">
              <ArrowLeft className="h-4 w-4" />
              Back to your portfolio
            </Link>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setSubmitted(null);
                setLineOfBusiness(null);
                setPickedCategory(null);
                setAssetId("");
                setCategoryAnswers({});
                setSelectedAddressParts(null);
                setDlNumber("");
                setDlFileName(null);
              }}
            >
              Start another quote
            </button>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- Express form ----------
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl">Get a private quote</h1>
        <p className="text-ink-500 text-sm mt-1">
          Five quick fields and our AI handles the rest — public-records lookup, carrier
          matching, and a ballpark estimate.
        </p>
      </div>

      <Disclaimer>
        AI-generated estimates only. Final pricing, binding, and coverage decisions
        require a licensed agent's review.
      </Disclaimer>

      <Card>
        <CardHeader
          title="Is this for personal or commercial lines?"
          subtitle="Personal covers homes, autos, yachts, jewelry, and umbrella for an individual or family. Commercial covers a business — property, GL, BOP, workers' comp, commercial auto, etc."
        />
        <div className="grid sm:grid-cols-2 gap-3">
          {([
            {
              key: "personal" as const,
              title: "Personal lines",
              blurb: "Coverage for me, my family, and my personal assets.",
            },
            {
              key: "commercial" as const,
              title: "Commercial lines",
              blurb: "Coverage for a business I own or operate.",
            },
          ]).map((opt) => {
            const active = lineOfBusiness === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setLineOfBusiness(opt.key);
                  // Picking a different LOB drops the in-progress
                  // category since available categories may differ.
                  if (lineOfBusiness !== opt.key) setPickedCategory(null);
                }}
                className={`text-left rounded-md border p-4 transition-colors ${
                  active
                    ? "border-gold-400 bg-gold-50"
                    : "border-ink-100 hover:border-ink-300"
                }`}
              >
                <div className="text-sm font-semibold">{opt.title}</div>
                <div className="text-[11px] text-ink-500 mt-1">{opt.blurb}</div>
              </button>
            );
          })}
        </div>
      </Card>

      {lineOfBusiness && (
      <Card>
        <CardHeader
          title="What would you like to insure?"
          subtitle="Pick one — the AI tunes the public-records lookup to the asset class."
        />
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleCategories.map((c) => {
            const Icon = ICON_MAP[c.icon ?? "Layers"] ?? Layers;
            const active = pickedCategory?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    setPickedCategory((current) => (current?.id === c.id ? null : c))
                  }
                  className={`w-full text-left rounded-md border p-3 transition-colors ${
                    active
                      ? "border-gold-400 bg-gold-50"
                      : "border-ink-100 hover:border-ink-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-ink-500" />
                    <span className="text-sm font-semibold">{c.label}</span>
                  </div>
                  {c.description && (
                    <div className="text-[11px] text-ink-500 mt-1">{c.description}</div>
                  )}
                </button>
              </li>
            );
          })}
          {visibleCategories.length === 0 && (
            <li className="sm:col-span-2 lg:col-span-3 rounded-md border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">
              No {lineOfBusiness} categories are enabled for this agency yet.
            </li>
          )}
        </ul>
      </Card>
      )}

      {lineOfBusiness && pickedCategory && idCfg && (
        <ExpressWizard
          name={name}
          setName={setName}
          phone={phone}
          setPhone={setPhone}
          email={email}
          setEmail={setEmail}
          assetId={assetId}
          setAssetId={(value) => {
            setAssetId(idCfg.kind === "vin" ? uppercaseVinInput(value) : value);
            setSelectedAddressParts(null);
          }}
          setSelectedAddressParts={setSelectedAddressParts}
          dlNumber={dlNumber}
          setDlNumber={setDlNumber}
          dlFileName={dlFileName}
          setDlFileName={setDlFileName}
          categoryQuestions={categoryQuestions}
          categoryAnswers={categoryAnswers}
          setCategoryAnswer={(key, value) =>
            setCategoryAnswers((current) => ({
              ...current,
              [key]: normalizeVinFieldValue(
                {
                  key,
                  label: categoryQuestions.find((question) => question.key === key)?.label,
                },
                value
              ),
            }))
          }
          idCfg={idCfg}
          busy={busy}
          error={error}
          canSubmit={canSubmit}
          onSubmit={submit}
        />
      )}

      {!lineOfBusiness && (
        <div className="text-center text-xs text-ink-400">
          Pick personal or commercial above to continue.
        </div>
      )}
      {lineOfBusiness && !pickedCategory && (
        <div className="text-center text-xs text-ink-400">
          Pick a category above to continue.
        </div>
      )}

      <div className="text-center">
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => navigate(appRoute("/customer"))}
        >
          Cancel and return to portfolio
        </button>
      </div>
    </div>
  );
}

// Asset-type-specific questionnaire the AI pre-drafts as the agent's
// reply body. Sending the reply auto-resolves the spawned Activity
// Center task (see api.tasks.logReply).
function buildQuestionnaireReplyBody(input: {
  contactName: string;
  agencyName: string;
  assetType: AssetType;
  assetLabel: string;
  categoryLabel: string;
  questions: CategoryQuestion[];
}): { subject: string; body: string } {
  const first = input.contactName.split(/\s+/)[0];
  const list = (input.questions.length > 0
    ? input.questions.map((question) => question.label)
    : ["Anything else you'd like the carrier to know about the risk"])
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  const subject = `Following up on your ${input.categoryLabel.toLowerCase()} quote`;
  const body = [
    `Hi ${first},`,
    ``,
    `Thank you for sending over your ${input.categoryLabel.toLowerCase()} quote request. Please complete the remaining items below:`,
    ``,
    list,
    ``,
    `Reply right to this thread with your answers.`,
    ``,
    `Talk soon,`,
    `${input.agencyName} team`,
  ].join("\n");
  return { subject, body };
}

function DriverLicenseCameraScanner({
  dlFileName,
  setDlFileName,
  setDlNumber,
}: {
  dlFileName: string | null;
  setDlFileName: (v: string | null) => void;
  setDlNumber: (v: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [streamReadyKey, setStreamReadyKey] = useState(0);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScannerOpen(false);
    setStreamReadyKey((key) => key + 1);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!scannerOpen || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => {
      setScanError("Camera opened, but playback was blocked. Try tapping Open camera again.");
    });
  }, [scannerOpen, streamReadyKey]);

  useEffect(() => {
    if (!scannerOpen || !streamRef.current) return;
    const Detector = getBarcodeDetectorConstructor();
    if (!Detector) {
      setScanStatus("Camera ready. This browser does not support automatic ID barcode reading, so capture an ID image or upload one.");
      return;
    }

    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = new Detector({ formats: ["pdf417"] });
      setScanStatus("Point the camera at the barcode on the back of the license.");
    } catch {
      setScanStatus("Camera ready. This browser cannot initialize PDF417 scanning, so capture an ID image or upload one.");
      return;
    }

    let busy = false;
    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (!detector || !video || video.readyState < 2 || busy) return;
      busy = true;
      try {
        const codes = await detector.detect(video);
        const rawValue = codes.find((code) => code.rawValue?.trim())?.rawValue;
        if (!rawValue) return;
        const parsed = parseAamvaDriverLicense(rawValue);
        const inputValue = driverLicenseInputValue(parsed);
        if (inputValue) setDlNumber(inputValue);
        const label = parsed.state
          ? `Camera ID scan (${parsed.state}${parsed.licenseNumber ? ` ending ${parsed.licenseNumber.slice(-4)}` : ""})`
          : "Camera ID barcode scan";
        setDlFileName(label);
        setScanStatus(
          inputValue
            ? "ID barcode scanned. License number was filled into the quote."
            : "ID barcode scanned. The image was attached, but license number was not readable."
        );
        stopCamera();
      } catch {
        // Keep scanning. Some frames fail while the license is moving.
      } finally {
        busy = false;
      }
    }, 650);

    return () => window.clearInterval(timer);
  }, [scannerOpen, streamReadyKey, setDlFileName, setDlNumber, stopCamera]);

  async function startCamera() {
    setScanError(null);
    setScanStatus(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setScanError("This browser does not allow camera access. Upload an ID image instead.");
      return;
    }
    try {
      setScannerOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      setStreamReadyKey((key) => key + 1);
    } catch (err) {
      setScannerOpen(false);
      setScanError(
        err instanceof Error && err.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access or upload an ID image."
          : "Unable to open the camera. Upload an ID image instead."
      );
    }
  }

  function captureImage() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      setScanError("Camera is not ready yet. Hold the ID still and try again.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setDlFileName(
      `Camera ID image captured ${new Date().toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`
    );
    setScanStatus("ID image captured. Production uploads the encrypted image for agency review.");
    stopCamera();
  }

  return (
    <div className="rounded-md border border-ink-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink-900">Camera ID scanner</div>
          <div className="text-[11px] text-ink-500">
            Scan the PDF417 barcode on the back of a driver's license, or capture/upload an ID image.
          </div>
        </div>
        {!scannerOpen ? (
          <button type="button" className="btn-outline text-xs" onClick={startCamera}>
            <Camera className="h-3.5 w-3.5" />
            Open camera
          </button>
        ) : (
          <button type="button" className="btn-outline text-xs" onClick={stopCamera}>
            <X className="h-3.5 w-3.5" />
            Close camera
          </button>
        )}
      </div>

      {scannerOpen && (
        <div className="mt-3 overflow-hidden rounded-md border border-ink-200 bg-black">
          <video ref={videoRef} className="aspect-video w-full object-cover" playsInline muted />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black px-3 py-2 text-white">
            <div className="inline-flex items-center gap-1.5 text-xs">
              <ScanLine className="h-3.5 w-3.5 text-gold-300" />
              Hold the back barcode steady in frame.
            </div>
            <button type="button" className="btn-gold text-xs" onClick={captureImage}>
              <FileImage className="h-3.5 w-3.5" />
              Capture image
            </button>
          </div>
        </div>
      )}

      <label className="mt-3 block rounded-md border border-dashed border-ink-200 px-4 py-3 text-center text-sm cursor-pointer hover:bg-ink-50">
        <input
          type="file"
          className="hidden"
          accept="image/*,.pdf"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setDlFileName(f.name);
            setScanStatus("ID file selected. Production uploads the encrypted file for agency review.");
            e.currentTarget.value = "";
          }}
        />
        <div className="flex items-center justify-center gap-2 text-ink-700">
          <Upload className="h-4 w-4" />
          {dlFileName ? `Replace ID file (${dlFileName})` : "Upload ID image or PDF"}
        </div>
      </label>

      {scanStatus && <div className="mt-2 text-[11px] text-emerald-700">{scanStatus}</div>}
      {scanError && <div className="mt-2 text-[11px] text-alert">{scanError}</div>}
      <canvas ref={canvasRef} className="hidden" />
      <div className="mt-2 text-[11px] text-ink-400">
        Upload only the minimum required ID details. Files are handled through the encrypted document service.
      </div>
    </div>
  );
}

function CategoryQuestionField({
  question,
  value,
  onChange,
}: {
  question: CategoryQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">
        {question.label}
        {question.required && <span className="text-alert"> *</span>}
      </label>
      {question.inputType === "textarea" ? (
        <textarea
          className="input min-h-[118px]"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
          autoFocus
        />
      ) : question.inputType === "select" ? (
        <select className="input" value={value} onChange={(event) => onChange(event.target.value)} autoFocus>
          <option value="">Select...</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : question.inputType === "boolean" ? (
        <select className="input" value={value} onChange={(event) => onChange(event.target.value)} autoFocus>
          <option value="">Select...</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value="Unsure">Unsure</option>
        </select>
      ) : question.inputType === "address" ? (
        <AddressAutocomplete
          value={value}
          onChange={onChange}
          placeholder={question.placeholder ?? "Start typing address..."}
          required={!!question.required}
          allowMockFallback={false}
        />
      ) : (
          <input
            className="input"
            type={
              question.inputType === "number" || question.inputType === "currency"
              ? "number"
              : question.inputType === "date"
              ? "date"
              : "text"
          }
            value={value}
            onChange={(event) =>
              onChange(normalizeVinFieldValue(question, event.target.value))
            }
            placeholder={question.placeholder}
            autoCapitalize={isVinInputField(question) ? "characters" : undefined}
            spellCheck={isVinInputField(question) ? false : undefined}
            autoFocus
          />
      )}
      {question.helpText && <p className="mt-1 text-[11px] text-ink-500">{question.helpText}</p>}
    </div>
  );
}

// One-question-at-a-time wizard. Walks the customer through name →
// phone → email → asset identifier → driver's license, with a
// Next / Back row at the bottom. Last step exposes Submit instead of
// Next. Keeps the layout the customer expected from the multi-step
// flow without bringing back the 5 detail steps.
function ExpressWizard({
  name,
  setName,
  phone,
  setPhone,
  email,
  setEmail,
  assetId,
  setAssetId,
  setSelectedAddressParts,
  dlNumber,
  setDlNumber,
  dlFileName,
  setDlFileName,
  categoryQuestions,
  categoryAnswers,
  setCategoryAnswer,
  idCfg,
  busy,
  error,
  canSubmit,
  onSubmit,
}: {
  name: string;
  setName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  assetId: string;
  setAssetId: (v: string) => void;
  setSelectedAddressParts: (parts: AddressParts | null) => void;
  dlNumber: string;
  setDlNumber: (v: string) => void;
  dlFileName: string | null;
  setDlFileName: (v: string | null) => void;
  categoryQuestions: CategoryQuestion[];
  categoryAnswers: Record<string, string>;
  setCategoryAnswer: (key: string, value: string) => void;
  idCfg: {
    label: string;
    placeholder: string;
    helper: string;
    kind: "address" | "vin" | "text";
  };
  busy: boolean;
  error: string | null;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  type WizardStep = {
    key: "name" | "phone" | "email" | "asset" | "dl" | `category:${string}`;
    label: string;
    question?: CategoryQuestion;
  };
  const BASE_STEPS: WizardStep[] = [
    { key: "name" as const, label: "Full name" },
    { key: "phone" as const, label: "Phone" },
    { key: "email" as const, label: "Email" },
    { key: "asset" as const, label: idCfg.label },
    { key: "dl" as const, label: "Driver's license" },
  ];
  const STEPS = [
    ...BASE_STEPS,
    ...categoryQuestions.map((question) => ({
      key: `category:${question.key}` as const,
      label: question.label,
      question,
    })),
  ];
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  useEffect(() => {
    setStepIdx((current) => Math.min(current, Math.max(0, STEPS.length - 1)));
  }, [STEPS.length]);

  function stepValid(): boolean {
    if (step.key.startsWith("category:")) {
      const question = step.question;
      if (!question) return false;
      if (!question.required) return true;
      return String(categoryAnswers[question.key] ?? "").trim().length > 0;
    }
    switch (step.key) {
      case "name":
        return name.trim().length > 1;
      case "phone":
        return phone.trim().length >= 7;
      case "email":
        return /^\S+@\S+\.\S+$/.test(email.trim());
      case "asset":
        return assetId.trim().length > 0;
      case "dl":
        return dlNumber.trim().length >= 4 || !!dlFileName;
    }
    return false;
  }

  const isLast = stepIdx === STEPS.length - 1;

  return (
    <Card>
      <CardHeader
        title={`Step ${stepIdx + 1} of ${STEPS.length} — ${step.label}`}
        subtitle="Existing customers — your account info is pre-filled; update anything you'd like before continuing."
      />

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-5">
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`h-1.5 rounded-full flex-1 ${
              i <= stepIdx ? "bg-gold-400" : "bg-ink-100"
            }`}
          />
        ))}
      </div>

      <div className="space-y-4 min-h-[180px]">
        {step.key === "name" && (
          <div>
            <label className="label">What's your full name?</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
            />
          </div>
        )}
        {step.key === "phone" && (
          <div>
            <label className="label">What's the best phone number to reach you?</label>
            <input
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              autoComplete="tel"
              autoFocus
            />
            <p className="text-[11px] text-ink-500 mt-1">
              We'll text you a confirmation as soon as you submit.
            </p>
          </div>
        )}
        {step.key === "email" && (
          <div>
            <label className="label">What email should we send your quote to?</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
          </div>
        )}
        {step.key === "asset" && (
          <div>
            <label className="label">{idCfg.label}</label>
            {idCfg.kind === "address" ? (
              <AddressAutocomplete
                value={assetId}
                onChange={(v) => setAssetId(v)}
                onSelectParts={setSelectedAddressParts}
                placeholder={idCfg.placeholder}
                required
                allowMockFallback={false}
              />
            ) : (
              <input
                className="input"
                value={assetId}
                onChange={(e) =>
                  setAssetId(idCfg.kind === "vin" ? uppercaseVinInput(e.target.value) : e.target.value)
                }
                placeholder={idCfg.placeholder}
                autoCapitalize={idCfg.kind === "vin" ? "characters" : undefined}
                spellCheck={idCfg.kind === "vin" ? false : undefined}
                autoFocus
              />
            )}
            <p className="text-[11px] text-ink-500 mt-1">{idCfg.helper}</p>
          </div>
        )}
        {step.key === "dl" && (
          <div className="space-y-3">
            <div>
              <label className="label">Driver's license number</label>
              <input
                className="input"
                value={dlNumber}
                onChange={(e) => setDlNumber(e.target.value)}
                placeholder="State + license number"
                autoFocus
              />
            </div>
            <DriverLicenseCameraScanner
              dlFileName={dlFileName}
              setDlFileName={setDlFileName}
              setDlNumber={setDlNumber}
            />
          </div>
        )}
        {step.key.startsWith("category:") && step.question && (
          <CategoryQuestionField
            question={step.question}
            value={categoryAnswers[step.question.key] ?? ""}
            onChange={(value) => {
              if (step.question) setCategoryAnswer(step.question.key, value);
            }}
          />
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-xs text-alert">
          {error}
        </div>
      )}

      <div className="mt-5 text-[11px] text-ink-500 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-violet-500" />
        {isLast
          ? "On submit, the AI pulls public records, matches carriers, and texts you a confirmation."
          : `${STEPS.length - stepIdx - 1} more step${
              STEPS.length - stepIdx - 1 === 1 ? "" : "s"
            } to go.`}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-outline text-sm"
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          disabled={stepIdx === 0 || busy}
        >
          Back
        </button>
        {isLast ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onSubmit}
            disabled={!canSubmit || busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? "Submitting…" : "Submit express quote"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary"
            onClick={() => setStepIdx((i) => Math.min(STEPS.length - 1, i + 1))}
            disabled={!stepValid() || busy}
          >
            Next
          </button>
        )}
      </div>
    </Card>
  );
}
