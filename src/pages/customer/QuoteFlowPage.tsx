import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Briefcase,
  CheckCircle2,
  Gem,
  HelpCircle,
  Home,
  Layers,
  Loader2,
  Sailboat,
  Sparkles,
  Umbrella,
  Upload,
} from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { useCustomer } from "@/lib/useCustomer";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import {
  aiCarrierMatch,
  aiEnrichAsset,
  aiPremiumEstimate,
  aiProspectSummary,
} from "@/lib/ai";
import { fmt } from "@/lib/format";
import type {
  AssetType,
  InsuranceCategory,
  QuoteRequest,
} from "@/types";

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

export function QuoteFlowPage() {
  const customer = useCustomer();
  const { agency } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();

  const categories = api.categories.listActiveForTenant(agency?.id ?? "");

  const [lineOfBusiness, setLineOfBusiness] = useState<"personal" | "commercial" | null>(null);
  const [pickedCategory, setPickedCategory] = useState<InsuranceCategory | null>(null);
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [assetId, setAssetId] = useState("");
  const [dlNumber, setDlNumber] = useState("");
  const [dlFileName, setDlFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<QuoteRequest | null>(null);

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

  const canSubmit =
    !!lineOfBusiness &&
    !!pickedCategory &&
    !!assetType &&
    name.trim().length > 1 &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    phone.trim().length >= 7 &&
    assetId.trim().length > 0 &&
    (dlNumber.trim().length >= 4 || !!dlFileName);

  async function submit() {
    if (!agency || !user || !customer || !pickedCategory || !assetType || !idCfg) return;
    setError(null);
    setBusy(true);
    try {
      // Persist updated contact info on the customer record so the
      // agent has the latest on file before reaching out.
      api.customers.update(customer.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });

      // 1. AI public-records lookup on the asset.
      const enrichSeed: Record<string, unknown> = {};
      if (idCfg.kind === "address") enrichSeed.address = assetId.trim();
      else if (idCfg.kind === "vin") enrichSeed.vin = assetId.trim();
      else enrichSeed.description = assetId.trim();
      const enrichment = await aiEnrichAsset(assetType, enrichSeed);

      // Merge enriched fields with the raw inputs so the estimate
      // has the richest picture available.
      const fields: Record<string, unknown> = {
        ...enrichSeed,
        ...enrichment.fields,
        lineOfBusiness,
        driversLicenseNumber: dlNumber.trim() || undefined,
        driversLicenseDocument: dlFileName ?? undefined,
      };

      // 2. AI ballpark estimate + carrier match.
      const carriers = api.carriers.listForTenant(agency.id);
      const [estimate, carrierMatch] = await Promise.all([
        aiPremiumEstimate({ assetType, parsedData: fields }, carriers),
        aiCarrierMatch({ assetType, parsedData: fields }, carriers),
      ]);

      // 3. Quote row.
      const rawDescription = `Express quote (${lineOfBusiness} lines): ${pickedCategory.label}. Asset: ${assetId.trim()}.`;
      const quote = api.quotes.create({
        tenantId: agency.id,
        customerId: customer.id,
        assetType,
        rawDescription,
        parsedData: fields,
        aiPremiumEstimateMin: estimate?.min,
        aiPremiumEstimateMax: estimate?.max,
        aiRecommendedCarrierId: carrierMatch?.carrierId,
        aiRecommendationReason: carrierMatch?.reason,
        missingDocuments: estimate?.missingDocuments ?? [],
        status: "submitted_to_agent",
      });

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
        assetType,
        estimatedValue: (fields.estimatedValue as number | undefined) ?? undefined,
        aiSummary: aiSummary.summary,
        lastAction: "Submitted express quote",
        lastActivityAt: new Date().toISOString(),
        recommendedFollowUp: aiSummary.recommendedFollowUp,
        marketingStatus: customer.marketingOptInEmail ? "active" : "none",
        status: "quote_in_progress",
        quoteRequestId: quote.id,
      });

      // 6. Auto-SMS confirmation to the customer.
      const firstName = name.trim().split(/\s+/)[0];
      if (phone.trim()) {
        api.communications.create({
          tenantId: agency.id,
          customerId: customer.id,
          channel: "sms",
          direction: "outbound",
          body: `Thank you, ${firstName}. We received your quote request and an agent will be in touch shortly with carrier options.`,
          createdById: "ai",
        });
      }

      // 7. Activity Center task with pre-drafted questionnaire reply.
      const reply = buildQuestionnaireReplyBody({
        contactName: name.trim(),
        agencyName: agency.name,
        assetType,
        assetLabel: api.helpers.assetTypeLabel(assetType),
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
              <div className="text-[11px] text-ink-500 mt-1">
                AI ballpark — your agent confirms the final number with the carrier.
              </div>
            </div>
          )}
          {phone.trim() && (
            <p className="text-xs text-ink-500 mt-4">
              A confirmation SMS is on its way to {phone.trim()}.
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/customer" className="btn-primary">
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
          {categories.map((c) => {
            const Icon = ICON_MAP[c.icon ?? "Layers"] ?? Layers;
            const active = pickedCategory?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setPickedCategory(c)}
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
          setAssetId={setAssetId}
          dlNumber={dlNumber}
          setDlNumber={setDlNumber}
          dlFileName={dlFileName}
          setDlFileName={setDlFileName}
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
          onClick={() => navigate("/customer")}
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
}): { subject: string; body: string } {
  const first = input.contactName.split(/\s+/)[0];
  const QUESTIONS: Partial<Record<AssetType, string[]>> = {
    coastal_home: [
      "Year built + any major renovations in the last 10 years",
      "Roof age + material, plus a copy of the most recent wind-mitigation form (FL OIR-B1-1802 or state equivalent)",
      "Pool / trampoline / other attractive nuisances (Y/N + details)",
      "Burglar + smoke alarm specs (central station? monitored?)",
      "Any prior losses in the last 5 years (carrier, paid amount, cause)",
      "Short-term rental usage in the last 12 months (Y/N)",
    ],
    luxury_vehicle: [
      "Annual mileage estimate",
      "Primary use (pleasure / commute / business)",
      "All drivers (name, DOB, license #, years insured)",
      "Garaging: locked garage / driveway / street",
      "Modifications, performance upgrades, tracking device",
      "Loss history in last 5 years",
    ],
    yacht: [
      "Cruising area (Atlantic / Caribbean / Great Lakes / etc.)",
      "Captain & crew details (licensed? years experience?)",
      "Marina + slip address (where moored)",
      "Hurricane plan",
      "Loss history in last 5 years",
    ],
    jewelry: [
      "Recent appraisal (year, appraiser, replacement value)",
      "Storage when not worn (home safe / bank vault / on person)",
      "Travel frequency with the item",
    ],
    umbrella_liability: [
      "Confirmed underlying limits (HO / Auto / Watercraft)",
      "Household drivers under age 25",
      "Dog breed + bite history (if any)",
      "Pool + diving board / slide",
      "Public-facing roles (board seats, media, etc.)",
    ],
  };
  const list = (QUESTIONS[input.assetType] ?? [
    "Anything else you'd like the carrier to know about the risk",
  ])
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  const subject = `Following up on your ${input.assetLabel.toLowerCase()} quote — a few questions`;
  const body = [
    `Hi ${first},`,
    ``,
    `Thank you for sending over your quote request. Our system has pulled what it could from public records and assembled a preliminary estimate — to lock in firm carrier quotes I just need you to fill in a few items below:`,
    ``,
    list,
    ``,
    `Reply right to this thread with your answers. Once we have them, I'll run the request through every carrier we work with and follow up with the top recommendations the same day.`,
    ``,
    `Talk soon,`,
    `${input.agencyName} team`,
  ].join("\n");
  return { subject, body };
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
  dlNumber,
  setDlNumber,
  dlFileName,
  setDlFileName,
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
  dlNumber: string;
  setDlNumber: (v: string) => void;
  dlFileName: string | null;
  setDlFileName: (v: string | null) => void;
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
  const STEPS = [
    { key: "name" as const, label: "Full name" },
    { key: "phone" as const, label: "Phone" },
    { key: "email" as const, label: "Email" },
    { key: "asset" as const, label: idCfg.label },
    { key: "dl" as const, label: "Driver's license" },
  ];
  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  function stepValid(): boolean {
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
              />
            ) : (
              <input
                className="input"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                placeholder={idCfg.placeholder}
                autoCapitalize={idCfg.kind === "vin" ? "characters" : undefined}
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
            <label className="block rounded-md border border-dashed border-ink-200 px-4 py-3 text-sm text-center cursor-pointer hover:bg-ink-50">
              <input
                type="file"
                className="hidden"
                accept="image/*,.pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setDlFileName(f.name);
                  e.currentTarget.value = "";
                }}
              />
              <div className="flex items-center justify-center gap-2 text-ink-700">
                <Upload className="h-4 w-4" />
                {dlFileName ? `Replace scan (${dlFileName})` : "Or scan / upload your license"}
              </div>
              <div className="text-[11px] text-ink-400 mt-1">
                Filename + metadata only in this demo — production uploads to
                encrypted storage. Either the number or the scan is required.
              </div>
            </label>
          </div>
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