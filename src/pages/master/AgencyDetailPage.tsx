import { useNavigate, useParams } from "react-router-dom";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Building2,
  Copy,
  DownloadCloud,
  Globe2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { Card, CardHeader, EmptyState, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api } from "@/lib/api";
import {
  addMonthsToDateInput,
  agencyPlanRenewalIso,
  agencyPlanStartIso,
  agencyRenewalStatus,
  dateInputFromIso,
  isoFromDateInput,
} from "@/lib/agencyContract";
import { buildAgencyWebsiteProfile } from "@/lib/agencyWebsite";
import { fmt } from "@/lib/format";
import { staffRoleLabel } from "@/lib/roles";
import {
  splitRunnerList,
  validateCarrierDownloadRunnerDraft,
} from "@/lib/carrierDownloadRunner";
import {
  SOFTWARE_PLAN_TERM_OPTIONS,
  SOFTWARE_USER_MONTHLY_PRICE_USD,
  WEBSITE_APP_ADD_ON_OPTIONS,
  agencyMonthlyPriceUsd,
  normalizeSoftwarePlanTerm,
  softwarePlanMonthlyBeforeTermDiscount,
  softwarePlanTermDiscountMonthlyUsd,
  standardAgencyMonthlyPriceUsd,
  websiteAppAddOnBundleDiscountUsd,
  websiteAppAddOnRetailMonthlyUsd,
} from "@/lib/tiers";
import {
  defaultWebsiteAuthRedirects,
  normalizeConnectionDomains,
} from "@/lib/websiteConnection";
import type {
  Agency,
  CarrierDownloadRunnerFeed,
  CarrierDownloadRunnerLineOfBusiness,
  CarrierDownloadRunnerMfaMode,
  CarrierDownloadRunnerMode,
  CarrierDownloadRunnerReviewRule,
  CarrierDownloadRunnerSchedule,
  CarrierDownloadRunnerStatus,
  CarrierDownloadRunnerTestStatus,
  SoftwarePlanTermMonths,
  SoftwareSaleWebsiteAppAddOn,
  SubscriptionTier,
  WebsiteAuthRedirects,
  WebsiteConnectionStatus,
} from "@/types";

const USER_SLOT_PRESETS = [10, 25, 50];
const WEBSITE_APP_ADD_ON_ORDER: SoftwareSaleWebsiteAppAddOn[] = [
  "none",
  "website",
  "app",
  "website_app",
];

function billingTierForUserSlots(slots: number): SubscriptionTier {
  if (slots <= 10) return "minimum";
  if (slots <= 25) return "mid";
  return "ultra";
}

export function AgencyDetailPage() {
  const { agencyId } = useParams();
  const nav = useNavigate();
  const [, setRev] = useState(0);
  const [slotCount, setSlotCount] = useState(1);
  const [copiedCode, setCopiedCode] = useState(false);
  const [codeChanged, setCodeChanged] = useState(false);
  const [planEditing, setPlanEditing] = useState(false);
  const [planDraftUsers, setPlanDraftUsers] = useState(1);
  const [planDraftAddOn, setPlanDraftAddOn] =
    useState<SoftwareSaleWebsiteAppAddOn>("none");
  const [planDraftTerm, setPlanDraftTerm] = useState<SoftwarePlanTermMonths>(12);
  const [planDraftStartedAt, setPlanDraftStartedAt] = useState("");
  const [planDraftRenewsAt, setPlanDraftRenewsAt] = useState("");
  const [planError, setPlanError] = useState("");
  const [priceOverrideEditing, setPriceOverrideEditing] = useState(false);
  const [priceOverrideValue, setPriceOverrideValue] = useState("");
  const [priceOverrideReason, setPriceOverrideReason] = useState("");
  const [priceOverrideError, setPriceOverrideError] = useState("");
  if (!agencyId) return null;
  const agency = api.agencies.get(agencyId);
  if (!agency) return <EmptyState title="Agency not found" />;
  const users = api.users
    .list(agency.id)
    .filter((u) => u.role === "agent" || u.role === "manager");
  const customers = api.customers.list(agency.id);
  const carriers = api.carriers.list();
  const links = api.carriers.links().filter((l) => l.tenantId === agency.id && l.active);
  const linkedIds = new Set(links.map((l) => l.carrierId));
  // Categories: same link/unlink pattern as carriers. Tenants with
  // no link rows fall back to all active categories at runtime;
  // here on the admin page we render the entire master library so
  // the master can explicitly opt rows in/out.
  const categories = api.categories.list();
  const personalCategories = categories.filter((category) => (category.lineOfBusiness ?? "personal") === "personal");
  const commercialCategories = categories.filter((category) => (category.lineOfBusiness ?? "personal") === "commercial");
  const categoryLinks = api.categories
    .links()
    .filter((l) => l.tenantId === agency.id && l.active);
  const linkedCategoryIds = new Set(categoryLinks.map((l) => l.categoryId));
  const activePlanUsers = planEditing
    ? Math.max(users.length || 1, Math.floor(planDraftUsers) || agency.allowedUsers)
    : agency.allowedUsers;
  const activePlanAddOn = planEditing ? planDraftAddOn : agency.websiteAppAddOn ?? "none";
  const activePlanTerm = planEditing
    ? planDraftTerm
    : normalizeSoftwarePlanTerm(agency.softwarePlanTermMonths);
  const agencyPlanStart = agencyPlanStartIso(agency);
  const agencyPlanRenewal = agencyPlanRenewalIso(agency);
  const activePlanStart = planEditing
    ? isoFromDateInput(planDraftStartedAt, agencyPlanStart)
    : agencyPlanStart;
  const activePlanRenewal = planEditing
    ? isoFromDateInput(planDraftRenewsAt, agencyPlanRenewal)
    : agencyPlanRenewal;
  const activeRenewalStatus = agencyRenewalStatus({
    ...agency,
    softwarePlanTermMonths: activePlanTerm,
    softwarePlanStartedAt: activePlanStart,
    softwarePlanRenewsAt: activePlanRenewal,
  });
  const userMonthly = activePlanUsers * SOFTWARE_USER_MONTHLY_PRICE_USD;
  const websiteAppRetailMonthly = websiteAppAddOnRetailMonthlyUsd(activePlanAddOn);
  const bundleDiscount = websiteAppAddOnBundleDiscountUsd(activePlanAddOn);
  const monthlyBeforeTermDiscount = softwarePlanMonthlyBeforeTermDiscount(
    activePlanUsers,
    activePlanAddOn
  );
  const termDiscountMonthly = softwarePlanTermDiscountMonthlyUsd(
    monthlyBeforeTermDiscount,
    activePlanTerm
  );
  const previewStandardMonthly = Math.max(0, monthlyBeforeTermDiscount - termDiscountMonthly);
  const standardMonthly = standardAgencyMonthlyPriceUsd(agency);
  const totalMonthly = agencyMonthlyPriceUsd(agency);
  const hasPriceOverride = typeof agency.monthlyPriceOverrideUsd === "number";
  const priceOverrideSavings = hasPriceOverride
    ? Math.max(0, standardMonthly - (agency.monthlyPriceOverrideUsd ?? standardMonthly))
    : 0;
  const openSlots = Math.max(0, agency.allowedUsers - users.length);
  const agencyCode = api.agencies.revealCodeForMaster(agency.id) ?? "";
  const refresh = () => setRev((r) => r + 1);

  function addSlots() {
    const safeCount = Math.max(1, Math.min(100, Math.floor(slotCount) || 1));
    api.agencies.addUserSlots(agency!.id, safeCount);
    setSlotCount(1);
    refresh();
  }

  function startPlanEdit() {
    setPlanDraftUsers(agency!.allowedUsers);
    setPlanDraftAddOn(agency!.websiteAppAddOn ?? "none");
    setPlanDraftTerm(normalizeSoftwarePlanTerm(agency!.softwarePlanTermMonths));
    setPlanDraftStartedAt(dateInputFromIso(agencyPlanStartIso(agency!)));
    setPlanDraftRenewsAt(dateInputFromIso(agencyPlanRenewalIso(agency!)));
    setPlanError("");
    setPriceOverrideEditing(false);
    setPlanEditing(true);
  }

  function cancelPlanEdit() {
    setPlanEditing(false);
    setPlanError("");
  }

  function setDraftUserSlots(slots: number) {
    setPlanDraftUsers(Math.max(users.length || 1, Math.min(500, Math.floor(slots) || 1)));
  }

  function savePlan() {
    const nextUsers = Math.max(users.length || 1, Math.min(500, Math.floor(planDraftUsers) || 1));
    const startedAt = isoFromDateInput(planDraftStartedAt, agencyPlanStartIso(agency!));
    const renewsAt = isoFromDateInput(planDraftRenewsAt, agencyPlanRenewalIso(agency!));
    if (new Date(renewsAt).getTime() <= new Date(startedAt).getTime()) {
      setPlanError("Renewal date must be after the term start date.");
      return;
    }
    const updated = api.agencies.update(agency!.id, {
      tier: billingTierForUserSlots(nextUsers),
      allowedUsers: nextUsers,
      websiteAppAddOn: planDraftAddOn,
      softwarePlanTermMonths: planDraftTerm,
      softwarePlanStartedAt: startedAt,
      softwarePlanRenewsAt: renewsAt,
    });
    if (!updated) {
      setPlanError("Plan could not be saved. Try again.");
      return;
    }
    setPlanEditing(false);
    setPlanError("");
    refresh();
  }

  function startPriceOverrideEdit() {
    setPriceOverrideEditing(true);
    setPriceOverrideError("");
    setPriceOverrideValue(String(agency!.monthlyPriceOverrideUsd ?? standardMonthly));
    setPriceOverrideReason(agency!.monthlyPriceOverrideReason ?? "");
  }

  function savePriceOverride() {
    const parsed = Number(priceOverrideValue.replace(/[$,]/g, "").trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPriceOverrideError("Enter a valid monthly price.");
      return;
    }
    api.agencies.update(agency!.id, {
      monthlyPriceOverrideUsd: Math.round(parsed),
      monthlyPriceOverrideReason: priceOverrideReason.trim() || undefined,
      monthlyPriceOverrideUpdatedAt: new Date().toISOString(),
    });
    setPriceOverrideEditing(false);
    setPriceOverrideError("");
    refresh();
  }

  function clearPriceOverride() {
    api.agencies.update(agency!.id, {
      monthlyPriceOverrideUsd: undefined,
      monthlyPriceOverrideReason: undefined,
      monthlyPriceOverrideUpdatedAt: undefined,
    });
    setPriceOverrideEditing(false);
    setPriceOverrideError("");
    setPriceOverrideValue("");
    setPriceOverrideReason("");
    refresh();
  }

  function copyAgencyCode() {
    if (!agencyCode) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(agencyCode).catch(() => {});
    }
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1400);
  }

  function changeAgencyCode() {
    const result = api.agencies.regenerateCode(agency!.id);
    if (!result.ok) return;
    setCodeChanged(true);
    setCopiedCode(false);
    setTimeout(() => setCodeChanged(false), 1400);
    refresh();
  }

  return (
    <div className="space-y-6">
      <button className="btn-ghost -ml-2" onClick={() => nav(-1)}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">{agency.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-400">Agency code</span>
            <input
              className="input !h-9 !py-1 !text-xs font-mono w-36"
              readOnly
              value={agencyCode}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Agency code"
            />
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={changeAgencyCode}
              title="Automatically generate a new unused agency sign-in code"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {codeChanged ? "Changed" : "Change code"}
            </button>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={copyAgencyCode}
              title="Copy agency sign-in code"
            >
              <Copy className="h-3.5 w-3.5" />
              {copiedCode ? "Copied" : "Copy code"}
            </button>
          </div>
          <p className="text-ink-500 text-sm mt-1">{agency.contactEmail} · {agency.serviceAreas.join(", ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={agency.active ? "success" : "neutral"}>{agency.active ? "Active" : "Inactive"}</Badge>
          {agency.active ? (
            <button className="btn-outline text-xs" onClick={() => { api.agencies.deactivate(agency.id); refresh(); }}>
              Deactivate
            </button>
          ) : (
            <button className="btn-outline text-xs" onClick={() => { api.agencies.update(agency.id, { active: true }); refresh(); }}>
              Reactivate
            </button>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Users" value={users.length} hint={`${openSlots} open of ${agency.allowedUsers}`} />
        <StatCard label="Clients" value={customers.length} />
        <StatCard label="Carriers linked" value={links.length} hint={`Limit: ${agency.allowedCarriers}`} />
        <StatCard
          label="Categories offered"
          value={linkedCategoryIds.size}
          hint={`of ${categories.length}`}
        />
        <StatCard
          label="MRR"
          value={fmt.money(totalMonthly)}
          hint={hasPriceOverride ? "Manual price" : `${agency.allowedUsers} users`}
        />
      </div>

      <Disclaimer>
        When users are added or removed here, a placeholder Stripe subscription update is triggered.
        Wire the real Stripe metered seats update before billing real money.
      </Disclaimer>

      <WebsiteConnectionCard agency={agency} onChanged={refresh} />

      <CarrierDownloadRunnerCard agency={agency} onChanged={refresh} />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader
            title="Software plan"
            subtitle="Build-a-plan pricing: staff users, website and Quotex app add-ons, and contract term only."
            action={
              planEditing ? (
                <button type="button" className="btn-ghost text-xs" onClick={cancelPlanEdit}>
                  <Lock className="h-3.5 w-3.5" /> Lock
                </button>
              ) : (
                <button type="button" className="btn-outline text-xs" onClick={startPlanEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Edit plan
                </button>
              )
            }
          />

          <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Staff users
                </div>
                {planEditing ? (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-outline h-9 w-9 justify-center px-0"
                      onClick={() => setDraftUserSlots(activePlanUsers - 1)}
                    >
                      -
                    </button>
                    <input
                      className="input !h-9 w-20 text-center font-semibold"
                      type="number"
                      min={Math.max(1, users.length)}
                      max={500}
                      value={activePlanUsers}
                      onChange={(event) => setDraftUserSlots(Number(event.target.value))}
                    />
                    <button
                      type="button"
                      className="btn-outline h-9 w-9 justify-center px-0"
                      onClick={() => setDraftUserSlots(activePlanUsers + 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 text-2xl font-semibold text-ink-900">{activePlanUsers}</div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  User monthly
                </div>
                <div className="mt-1 font-semibold text-ink-900">{fmt.money(userMonthly)}/mo</div>
                <div className="text-[11px] text-ink-500">
                  {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)} per user
                </div>
              </div>
            </div>
            {planEditing && (
              <div className="mt-3 flex flex-wrap gap-2">
                {USER_SLOT_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`btn-outline text-xs ${
                      activePlanUsers === preset ? "border-gold-500 bg-gold-100 text-ink-900" : ""
                    }`}
                    onClick={() => setDraftUserSlots(preset)}
                  >
                    {preset} users
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Website / Quotex app add-on
            </div>
            <div className="grid gap-2">
              {WEBSITE_APP_ADD_ON_ORDER.map((addOn) => {
                const option = WEBSITE_APP_ADD_ON_OPTIONS[addOn];
                const selected = activePlanAddOn === addOn;
                return (
                  <button
                    key={addOn}
                    type="button"
                    disabled={!planEditing}
                    tabIndex={planEditing ? 0 : -1}
                    onClick={() => setPlanDraftAddOn(addOn)}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      selected
                        ? "border-gold-400 bg-gold-50 text-ink-900"
                        : "border-ink-200 bg-white text-ink-700"
                    } ${planEditing ? "hover:border-gold-400" : "pointer-events-none select-none opacity-100"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{option.label}</div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-500">
                          {option.description}
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold">
                        {option.monthlyPriceUsd ? `${fmt.money(option.monthlyPriceUsd)}/mo` : "None"}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Contract term
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SOFTWARE_PLAN_TERM_OPTIONS.map((term) => {
                const selected = activePlanTerm === term.months;
                return (
                  <button
                    key={term.months}
                    type="button"
                    disabled={!planEditing}
                    tabIndex={planEditing ? 0 : -1}
                    onClick={() => {
                      setPlanDraftTerm(term.months);
                      if (planDraftStartedAt) {
                        setPlanDraftRenewsAt(addMonthsToDateInput(planDraftStartedAt, term.months));
                      }
                    }}
                    className={`rounded-md border px-2 py-2 text-center text-xs font-semibold transition ${
                      selected
                        ? "border-ink-900 bg-ink-900 text-white"
                        : "border-ink-200 bg-white text-ink-700"
                    } ${planEditing ? "hover:border-gold-400" : "pointer-events-none select-none opacity-100"}`}
                  >
                    <span className="block">{term.label}</span>
                    <span className={`block text-[10px] ${selected ? "text-white/70" : "text-ink-400"}`}>
                      {term.discountPercent ? `${term.discountPercent}% off` : "Standard"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
              Agencies can renew the selected term at any time.
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-ink-100 bg-white p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                Renewal schedule
              </div>
              <Badge tone={activeRenewalStatus.tone}>{activeRenewalStatus.label}</Badge>
            </div>
            {planEditing ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="label !text-[10px]">Term starts</label>
                  <input
                    className="input !h-9"
                    type="date"
                    value={planDraftStartedAt}
                    onChange={(event) => {
                      const nextStart = event.target.value;
                      setPlanDraftStartedAt(nextStart);
                      setPlanDraftRenewsAt(addMonthsToDateInput(nextStart, planDraftTerm));
                    }}
                  />
                </div>
                <div>
                  <label className="label !text-[10px]">Renews</label>
                  <input
                    className="input !h-9"
                    type="date"
                    value={planDraftRenewsAt}
                    onChange={(event) => setPlanDraftRenewsAt(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Term start
                  </dt>
                  <dd className="mt-1 font-medium text-ink-900">{fmt.date(activePlanStart)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Renewal date
                  </dt>
                  <dd className="mt-1 font-medium text-ink-900">{fmt.date(activePlanRenewal)}</dd>
                </div>
              </dl>
            )}
          </div>

          <dl className="mt-4 space-y-2 rounded-lg border border-ink-100 bg-white p-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Staff users</dt>
              <dd className="font-medium">{activePlanUsers} x {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Website / Quotex app retail</dt>
              <dd className="font-medium">{websiteAppRetailMonthly ? fmt.money(websiteAppRetailMonthly) : "None"}</dd>
            </div>
            {bundleDiscount > 0 && (
              <div className="flex justify-between gap-3 text-emerald-700">
                <dt>Website + app bundle discount</dt>
                <dd className="font-medium">-{fmt.money(bundleDiscount)}</dd>
              </div>
            )}
            {termDiscountMonthly > 0 && (
              <div className="flex justify-between gap-3 text-emerald-700">
                <dt>{activePlanTerm}-month term discount</dt>
                <dd className="font-medium">-{fmt.money(termDiscountMonthly)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t border-ink-100 pt-2 font-semibold text-ink-900">
              <dt>{planEditing ? "Preview standard monthly" : "Standard monthly"}</dt>
              <dd>{fmt.money(planEditing ? previewStandardMonthly : standardMonthly)}/mo</dd>
            </div>
            {hasPriceOverride && !planEditing && (
              <div className="flex justify-between gap-3 text-emerald-700">
                <dt>Manual special price</dt>
                <dd className="font-medium">
                  {priceOverrideSavings ? `-${fmt.money(priceOverrideSavings)}` : "Custom"}
                </dd>
              </div>
            )}
            {!planEditing && (
              <div className="flex justify-between gap-3 border-t border-ink-100 pt-2 text-base font-semibold text-ink-950">
                <dt>Total monthly</dt>
                <dd>{fmt.money(totalMonthly)}/mo</dd>
              </div>
            )}
          </dl>

          {planError && <div className="mt-3 text-xs text-red-600">{planError}</div>}

          {planEditing && (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-outline text-xs" onClick={cancelPlanEdit}>
                Cancel
              </button>
              <button type="button" className="btn-gold text-xs" onClick={savePlan}>
                <Save className="h-3.5 w-3.5" /> Save plan
              </button>
            </div>
          )}

          <div className="mt-4 rounded-md border border-ink-100 bg-ink-50 p-3 text-xs text-ink-600">
            {hasPriceOverride ? (
              <>
                <div className="font-semibold text-ink-900">Manual special price active</div>
                <div className="mt-1">
                  {agency.monthlyPriceOverrideReason || "No reason recorded."}
                </div>
                {agency.monthlyPriceOverrideUpdatedAt && (
                  <div className="mt-1 text-ink-400">
                    Updated {fmt.dateTime(agency.monthlyPriceOverrideUpdatedAt)}
                  </div>
                )}
              </>
            ) : (
              "Standard pricing is active. Use a manual special price only for founder-approved discounts."
            )}
            {!planEditing && (
              <div className="mt-3">
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={startPriceOverrideEdit}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit special price
                </button>
              </div>
            )}
          </div>

          {priceOverrideEditing && !planEditing && (
            <div className="mt-4 space-y-3 rounded-lg border border-gold-200 bg-gold-50 p-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Manual monthly price
                </label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={priceOverrideValue}
                  onChange={(event) => setPriceOverrideValue(event.target.value)}
                  placeholder={String(standardMonthly)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Discount reason
                </label>
                <textarea
                  className="input min-h-[78px]"
                  value={priceOverrideReason}
                  onChange={(event) => setPriceOverrideReason(event.target.value)}
                  placeholder="Founder-approved discount, annual relationship, launch credit..."
                />
              </div>
              {priceOverrideError && <div className="text-xs text-red-600">{priceOverrideError}</div>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary text-xs" onClick={savePriceOverride}>
                  <Save className="h-3.5 w-3.5" /> Save special price
                </button>
                {hasPriceOverride && (
                  <button type="button" className="btn-outline text-xs" onClick={clearPriceOverride}>
                    Clear override
                  </button>
                )}
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setPriceOverrideEditing(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Carrier library" subtitle="Assign which carriers this agency can offer." />
          <ul className="grid sm:grid-cols-2 gap-2">
            {carriers.map((c) => {
              const linked = linkedIds.has(c.id);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 border border-ink-100 rounded-md p-3">
                  <div>
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-ink-500">{c.preferredAssetTypes.length} appetites</div>
                  </div>
                  <button
                    className={linked ? "btn-ghost text-xs text-rose-600" : "btn-outline text-xs"}
                    onClick={() => {
                      if (linked) api.carriers.unlinkFromAgency(c.id, agency.id);
                      else api.carriers.linkToAgency(c.id, agency.id);
                      refresh();
                    }}
                  >
                    {linked ? "Unlink" : "Link"}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Category library"
            subtitle="Assign which asset categories this agency offers in the customer quote flow. Each category carries its own intake-question schema; the AI uses those questions during intake."
          />
          <div className="mb-3 flex items-center justify-end gap-2 text-xs">
            <button
              className="btn-ghost"
              onClick={() => {
                categories.forEach((c) => {
                  if (!linkedCategoryIds.has(c.id)) api.categories.linkToAgency(c.id, agency.id);
                });
                refresh();
              }}
            >
              Link all
            </button>
            <button
              className="btn-ghost text-rose-600"
              onClick={() => {
                categories.forEach((c) => api.categories.unlinkFromAgency(c.id, agency.id));
                refresh();
              }}
            >
              Unlink all
            </button>
          </div>
          <ul className="space-y-4">
            {[
              { title: "Personal lines", rows: personalCategories },
              { title: "Commercial lines", rows: commercialCategories },
            ].map((section) => (
              <li key={section.title} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-ink-500">
                    {section.title}
                  </div>
                  <span className="text-[11px] text-ink-400">
                    {section.rows.length} categor{section.rows.length === 1 ? "y" : "ies"}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {section.rows.map((c) => {
                    const linked = linkedCategoryIds.has(c.id);
                    const qCount = c.questions?.length ?? 0;
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center justify-between gap-2 border rounded-md p-3 ${
                          c.active ? "border-ink-100" : "border-ink-100 opacity-60"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c.label}</div>
                          <div className="text-[11px] text-ink-500">
                            {c.assetType.replace(/_/g, " ")} · {qCount} question
                            {qCount === 1 ? "" : "s"}
                            {!c.active && " · inactive"}
                          </div>
                        </div>
                        <button
                          className={linked ? "btn-ghost text-xs text-rose-600" : "btn-outline text-xs"}
                          onClick={() => {
                            if (linked) api.categories.unlinkFromAgency(c.id, agency.id);
                            else api.categories.linkToAgency(c.id, agency.id);
                            refresh();
                          }}
                        >
                          {linked ? "Unlink" : "Link"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
            {categories.length === 0 && (
              <li className="sm:col-span-2 lg:col-span-3 text-sm text-ink-400 text-center py-6">
                No categories in the master library yet — add them at{" "}
                <code>/master/categories</code>.
              </li>
            )}
          </ul>
        </Card>

        <BranchesCard agencyId={agency.id} onChanged={refresh} />

        <Card className="lg:col-span-3">
          <CardHeader
            title="Users in this agency"
            subtitle={`${users.length}/${agency.allowedUsers} staff slots used. ${openSlots} open slot${openSlots === 1 ? "" : "s"} available.`}
            action={
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="label !text-[10px]">Add slots</label>
                  <input
                    className="input !py-1.5 !text-xs w-20"
                    type="number"
                    min={1}
                    max={100}
                    value={slotCount}
                    onChange={(e) =>
                      setSlotCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                  />
                </div>
                <button
                  type="button"
                  className="btn-gold text-xs"
                  onClick={addSlots}
                  title={`Add ${fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)} per month for each user slot`}
                >
                  <Plus className="h-3.5 w-3.5" /> Add slot
                </button>
              </div>
            }
          />
          <div className="mb-3 rounded-md border border-gold-100 bg-gold-50/60 px-3 py-2 text-xs text-ink-600">
            Each additional user slot adds{" "}
            <span className="font-semibold text-ink-900">
              {fmt.money(SOFTWARE_USER_MONTHLY_PRICE_USD)}/mo
            </span>{" "}
            to this agency's subscription automatically. Adding {slotCount} slot
            {slotCount === 1 ? "" : "s"} changes MRR by{" "}
            <span className="font-semibold text-ink-900">
              {fmt.money(slotCount * SOFTWARE_USER_MONTHLY_PRICE_USD)}/mo
            </span>
            .
          </div>
          <ul className="divide-y divide-ink-100">
            {users.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-ink-500">{u.email}</div>
                </div>
                <Badge tone="gold">{fmt.titleCase(u.role)}</Badge>
              </li>
            ))}
            {users.length === 0 && <li className="py-4 text-sm text-ink-400">No users.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function WebsiteConnectionCard({
  agency,
  onChanged,
}: {
  agency: Agency;
  onChanged: () => void;
}) {
  const profile = buildAgencyWebsiteProfile(agency);
  const [locked, setLocked] = useState(true);
  const [website, setWebsite] = useState(agency.website ?? "");
  const [portalBaseUrl, setPortalBaseUrl] = useState(agency.portalBaseUrl ?? "");
  const [customerPortalUrl, setCustomerPortalUrl] = useState(agency.customerPortalUrl ?? "");
  const [quoteStartUrl, setQuoteStartUrl] = useState(agency.quoteStartUrl ?? "");
  const [allowedDomains, setAllowedDomains] = useState(
    (agency.websiteAllowedDomains ?? []).join("\n")
  );
  const [webhookUrl, setWebhookUrl] = useState(agency.websiteWebhookUrl ?? "");
  const [redirects, setRedirects] = useState<WebsiteAuthRedirects>({
    ...defaultWebsiteAuthRedirects(agency.website),
    ...(agency.websiteAuthRedirects ?? {}),
  });
  const [copied, setCopied] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const apiEndpoint = "/api/website/prospects";
  const syncEndpoint = "/api/website/sync";
  const websiteApiKey = api.agencies.revealWebsiteApiKeyForMaster(agency.id) ?? "";
  const webhookSecret = api.agencies.revealWebsiteWebhookSecretForMaster(agency.id) ?? "";
  const connectionStatus = agency.websiteLastWebhookStatus ?? "not_tested";
  const fieldClassName = connectionFieldClass(locked);

  function resetDraftFromAgency() {
    setWebsite(agency.website ?? "");
    setPortalBaseUrl(agency.portalBaseUrl ?? "");
    setCustomerPortalUrl(agency.customerPortalUrl ?? "");
    setQuoteStartUrl(agency.quoteStartUrl ?? "");
    setAllowedDomains((agency.websiteAllowedDomains ?? []).join("\n"));
    setWebhookUrl(agency.websiteWebhookUrl ?? "");
    setRedirects({
      ...defaultWebsiteAuthRedirects(agency.website),
      ...(agency.websiteAuthRedirects ?? {}),
    });
  }

  function startEdit() {
    resetDraftFromAgency();
    setCopied(null);
    setRotated(null);
    setSavedAt(null);
    setLocked(false);
  }

  function save() {
    api.agencies.update(agency.id, {
      website: website.trim() || undefined,
      portalBaseUrl: portalBaseUrl.trim() || undefined,
      customerPortalUrl: customerPortalUrl.trim() || undefined,
      quoteStartUrl: quoteStartUrl.trim() || undefined,
      websiteAllowedDomains: normalizeConnectionDomains(allowedDomains),
      websiteWebhookUrl: webhookUrl.trim() || undefined,
      websiteAuthRedirects: cleanRedirects(redirects),
      websiteEnabled: true,
      websiteConnectionUpdatedAt: new Date().toISOString(),
    });
    setSavedAt(new Date().toISOString());
    setLocked(true);
    onChanged();
  }

  function cancel() {
    resetDraftFromAgency();
    setLocked(true);
    setRotated(null);
    setSavedAt(null);
  }

  function copy(text: string, id: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(id);
    setTimeout(() => setCopied((current) => (current === id ? null : current)), 1400);
  }

  function rotateApiKey() {
    if (locked) return;
    const result = api.agencies.regenerateWebsiteApiKey(agency.id);
    if (!result.ok) return;
    setRotated("api");
    setCopied(null);
    setTimeout(() => setRotated((current) => (current === "api" ? null : current)), 1400);
    onChanged();
  }

  function rotateWebhookSecret() {
    if (locked) return;
    const result = api.agencies.regenerateWebsiteWebhookSecret(agency.id);
    if (!result.ok) return;
    setRotated("webhook");
    setCopied(null);
    setTimeout(() => setRotated((current) => (current === "webhook" ? null : current)), 1400);
    onChanged();
  }

  function checkSetup() {
    if (!locked) {
      save();
      setTimeout(() => {
        api.agencies.checkWebsiteConnection(agency.id);
        onChanged();
      }, 0);
      return;
    }
    api.agencies.checkWebsiteConnection(agency.id);
    onChanged();
  }

  function setRedirect(key: keyof WebsiteAuthRedirects, value: string) {
    if (locked) return;
    setRedirects((current) => ({ ...current, [key]: value }));
  }

  return (
    <Card>
      <CardHeader
        title="Website + customer portal connection"
        subtitle={
          locked
            ? "Locked. Tap Edit connection to change website, portal, sync, or credential settings."
            : "Editing. Save to re-lock this connection; Cancel discards unsaved changes."
        }
        action={
          locked ? (
            <button type="button" className="btn-outline text-xs" onClick={checkSetup}>
              Check setup
            </button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-sm text-ink-700">
        <span className={`h-2.5 w-2.5 rounded-full ${connectionStatusClass(connectionStatus)}`} />
        <span className="font-medium">{connectionStatusLabel(connectionStatus)}</span>
        <span className="text-ink-500">
          {agency.websiteLastWebhookMessage ?? "Connection has not been checked yet."}
        </span>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="lg:col-span-2">
          <label className="label">External website URL</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://agencywebsite.com"
          />
        </div>
        <div>
          <label className="label">Customer portal URL</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={customerPortalUrl}
            onChange={(e) => setCustomerPortalUrl(e.target.value)}
            placeholder="https://agencywebsite.com/client-portal"
          />
        </div>
        <div>
          <label className="label">Quote start URL</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={quoteStartUrl}
            onChange={(e) => setQuoteStartUrl(e.target.value)}
            placeholder="https://agencywebsite.com/start-quote"
          />
        </div>
        <div>
          <label className="label">Software portal URL</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={portalBaseUrl}
            onChange={(e) => setPortalBaseUrl(e.target.value)}
            placeholder="https://app.quotex.com"
          />
        </div>
        <div>
          <label className="label">Sync webhook URL</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://agencywebsite.com/api/quotex-sync"
          />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Allowed website domains</label>
          <textarea
            className={`${fieldClassName} min-h-[86px]`}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={allowedDomains}
            onChange={(e) => setAllowedDomains(e.target.value)}
            placeholder={"agencywebsite.com\nwww.agencywebsite.com"}
          />
          <p className="mt-1 text-xs text-ink-500">
            Only these domains can use this agency connection.
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4">
        <div className="mb-3 text-xs uppercase tracking-wider text-ink-500">Connection credentials</div>
        <div className="grid lg:grid-cols-2 gap-3">
          <SecretRow
            label="Connection ID"
            value={agency.id}
            copied={copied === "agencyId"}
            onCopy={() => copy(agency.id, "agencyId")}
          />
          <SecretRow
            label="Website API key"
            value={websiteApiKey}
            copied={copied === "apiKey"}
            onCopy={() => copy(websiteApiKey, "apiKey")}
            actionLabel={!locked ? (rotated === "api" ? "Changed" : "Change key") : undefined}
            onAction={!locked ? rotateApiKey : undefined}
          />
          <SecretRow
            label="Webhook signing secret"
            value={webhookSecret}
            copied={copied === "webhookSecret"}
            onCopy={() => copy(webhookSecret, "webhookSecret")}
            actionLabel={!locked ? (rotated === "webhook" ? "Changed" : "Change secret") : undefined}
            onAction={!locked ? rotateWebhookSecret : undefined}
          />
          <SecretRow
            label="Lead intake endpoint"
            value={apiEndpoint}
            copied={copied === "api"}
            onCopy={() => copy(apiEndpoint, "api")}
            icon={<Globe2 className="h-3.5 w-3.5" />}
          />
          <SecretRow
            label="Customer sync endpoint"
            value={syncEndpoint}
            copied={copied === "sync"}
            onCopy={() => copy(syncEndpoint, "sync")}
            icon={<Globe2 className="h-3.5 w-3.5" />}
          />
          <SecretRow
            label="Staff portal handoff"
            value={profile.employeeLoginUrl}
            copied={copied === "employee"}
            onCopy={() => copy(profile.employeeLoginUrl, "employee")}
          />
        </div>
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4">
        <div className="mb-3 text-xs uppercase tracking-wider text-ink-500">Customer auth return URLs</div>
        <div className="grid md:grid-cols-2 gap-3">
          <RedirectInput
            label="Login success"
            value={redirects.loginSuccess ?? ""}
            locked={locked}
            onChange={(value) => setRedirect("loginSuccess", value)}
          />
          <RedirectInput
            label="Logout"
            value={redirects.logout ?? ""}
            locked={locked}
            onChange={(value) => setRedirect("logout", value)}
          />
          <RedirectInput
            label="Password reset"
            value={redirects.passwordReset ?? ""}
            locked={locked}
            onChange={(value) => setRedirect("passwordReset", value)}
          />
          <RedirectInput
            label="Signature return"
            value={redirects.documentSignatureReturn ?? ""}
            locked={locked}
            onChange={(value) => setRedirect("documentSignatureReturn", value)}
          />
          <RedirectInput
            label="Questionnaire return"
            value={redirects.questionnaireReturn ?? ""}
            locked={locked}
            onChange={(value) => setRedirect("questionnaireReturn", value)}
          />
        </div>
      </div>

      <div className="mt-4 rounded-md border border-gold-100 bg-gold-50/50 p-3 text-sm text-ink-700">
        Website quote requests, portal updates, customer documents, messages, questionnaires,
        signatures, claims, and customer-safe policy data use this connection to stay tied to
        the correct agency tenant in both directions.
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-4 flex-wrap">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
          <Lock className={`h-3 w-3 ${savedAt ? "text-emerald-600" : ""}`} />
          {savedAt
            ? "Saved - locked again."
            : locked
              ? "Locked."
              : "Editing - unsaved changes."}
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <button type="button" className="btn-outline text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit connection
            </button>
          ) : (
            <>
              <button type="button" className="btn-outline text-xs" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="btn-primary text-xs" onClick={checkSetup}>
                Check setup
              </button>
              <button type="button" className="btn-gold text-xs" onClick={save}>
                <Save className="h-3.5 w-3.5" /> Save connection
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const RUNNER_LINE_OPTIONS: Array<{ id: CarrierDownloadRunnerLineOfBusiness; label: string }> = [
  { id: "personal", label: "Personal lines" },
  { id: "commercial", label: "Commercial lines" },
];

const RUNNER_FEED_OPTIONS: Array<{ id: CarrierDownloadRunnerFeed; label: string }> = [
  { id: "policy", label: "Policies" },
  { id: "renewal", label: "Renewals" },
  { id: "endorsement", label: "Endorsements" },
  { id: "cancellation", label: "Cancellations" },
  { id: "billing", label: "Billing / paid status" },
  { id: "claims", label: "Claims" },
  { id: "edocs", label: "eDocs" },
  { id: "commission", label: "Commission / direct bill" },
];

const RUNNER_MODE_OPTIONS: Array<{ id: CarrierDownloadRunnerMode; label: string }> = [
  { id: "ai_portal_runner", label: "AI carrier portal runner" },
  { id: "secure_mailbox", label: "Secure mailbox / download inbox" },
  { id: "manual_upload_review", label: "Manual upload + AI review" },
];

const RUNNER_REVIEW_OPTIONS: Array<{ id: CarrierDownloadRunnerReviewRule; label: string }> = [
  { id: "stage_all", label: "Stage every update" },
  { id: "auto_safe_fields", label: "Auto-update safe fields" },
  { id: "require_review_for_material_changes", label: "Review material changes" },
];

const RUNNER_SCHEDULE_OPTIONS: Array<{ id: CarrierDownloadRunnerSchedule; label: string }> = [
  { id: "as_available", label: "As soon as information is available" },
  { id: "hourly", label: "Hourly" },
  { id: "twice_daily", label: "Twice daily" },
  { id: "daily", label: "Daily" },
  { id: "manual", label: "Manual import only" },
];

const RUNNER_TRIGGER_ROWS = [
  {
    title: "Policy put in place",
    detail: "Runner signs into the carrier portal, confirms policy data, pulls documents, billing path, and the renewal date.",
  },
  {
    title: "Renewal window",
    detail: "A few weeks before renewal, runner pulls renewal terms, renewed documents, billing changes, and non-renewal notices.",
  },
  {
    title: "Non-renewal detected",
    detail: "If carrier evidence says non-renewed, Quotex marks the renewal non-renewed and creates the replacement-market activity.",
  },
  {
    title: "Billing, claims, and eDocs",
    detail: "Runner checks paid status, billing changes, claim updates, and newly posted carrier documents without changing carrier records.",
  },
];

const RUNNER_GAP_ROWS = [
  "Carrier portal credential must exist in the vault for each authorized staff path.",
  "MFA, CAPTCHA, changed carrier screens, and ambiguous matches pause for staff approval.",
  "Premium, coverage, cancellation, and non-renewal changes are staged with audit history before they touch the file.",
  "All active agency carrier-library links are included automatically; inactive carriers are skipped.",
];

const RUNNER_TEST_STATUS_OPTIONS: Array<{ id: CarrierDownloadRunnerTestStatus; label: string }> = [
  { id: "not_tested", label: "Not tested" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
];

function CarrierDownloadRunnerCard({
  agency,
  onChanged,
}: {
  agency: Agency;
  onChanged: () => void;
}) {
  const [locked, setLocked] = useState(true);
  const [enabled, setEnabled] = useState(
    Boolean(agency.carrierRunnerEnabled ?? agency.ivansDownloadEnabled)
  );
  const [status, setStatus] = useState<CarrierDownloadRunnerStatus>(
    agency.carrierRunnerStatus ?? agency.ivansConnectionStatus ?? "not_configured"
  );
  const [agencyAccount, setAgencyAccount] = useState(agency.carrierRunnerAgencyCode ?? agency.ivansAgencyAccount ?? agency.agencyCodePreview ?? "");
  const [mailboxId, setMailboxId] = useState(agency.carrierRunnerProfileId ?? agency.ivansMailboxId ?? "");
  const [receiverCode, setReceiverCode] = useState(agency.carrierRunnerReceiverCode ?? agency.ivansReceiverCode ?? "");
  const [method, setMethod] = useState<CarrierDownloadRunnerMode>(
    agency.carrierRunnerMode ?? "ai_portal_runner"
  );
  const [credentialReference, setCredentialReference] = useState(
    agency.carrierRunnerCredentialVaultRef ?? agency.ivansCredentialReference ?? ""
  );
  const [mfaMode, setMfaMode] = useState<CarrierDownloadRunnerMfaMode>(
    agency.carrierRunnerMfaMode ?? "staff_approval"
  );
  const [authorizedUserIds, setAuthorizedUserIds] = useState<string[]>(
    agency.carrierRunnerAuthorizedUserIds ?? []
  );
  const [contactEmail, setContactEmail] = useState(agency.carrierRunnerContactEmail ?? agency.ivansContactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(agency.carrierRunnerContactPhone ?? agency.ivansContactPhone ?? "");
  const [lines, setLines] = useState<CarrierDownloadRunnerLineOfBusiness[]>(
    agency.carrierRunnerLinesOfBusiness ?? agency.ivansLinesOfBusiness ?? ["personal"]
  );
  const [feeds, setFeeds] = useState<CarrierDownloadRunnerFeed[]>(
    agency.carrierRunnerFeeds ?? agency.ivansDownloadFeeds ?? ["policy", "renewal", "billing", "edocs"]
  );
  const [fileFormats, setFileFormats] = useState<CarrierDownloadRunnerReviewRule[]>(
    agency.carrierRunnerReviewRule
      ? [agency.carrierRunnerReviewRule]
      : ["require_review_for_material_changes"]
  );
  const [pollingSchedule, setPollingSchedule] = useState<CarrierDownloadRunnerSchedule>(
    agency.carrierRunnerSchedule ?? agency.ivansPollingSchedule ?? "as_available"
  );
  const [inboundPath, setInboundPath] = useState(agency.carrierRunnerWorkingPath ?? agency.ivansInboundPath ?? "");
  const [archivePath, setArchivePath] = useState(agency.carrierRunnerArchivePath ?? agency.ivansArchivePath ?? "");
  const [errorAlertEmails, setErrorAlertEmails] = useState(
    (agency.carrierRunnerFailureAlertEmails ?? agency.ivansErrorAlertEmails ?? []).join("\n")
  );
  const [testFileReceivedAt, setTestFileReceivedAt] = useState(
    agency.carrierRunnerLastTestAt ?? agency.ivansTestFileReceivedAt
      ? (agency.carrierRunnerLastTestAt ?? agency.ivansTestFileReceivedAt ?? "").slice(0, 16)
      : ""
  );
  const [lastTestStatus, setLastTestStatus] = useState<CarrierDownloadRunnerTestStatus>(
    agency.carrierRunnerLastTestStatus ?? agency.ivansLastTestStatus ?? "not_tested"
  );
  const [lastTestMessage, setLastTestMessage] = useState(agency.carrierRunnerLastTestMessage ?? agency.ivansLastTestMessage ?? "");
  const [notes, setNotes] = useState(agency.carrierRunnerNotes ?? agency.ivansNotes ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const fieldClassName = connectionFieldClass(locked);
  const activeCarrierLinks = api
    .carriers
    .links()
    .filter((link) => link.tenantId === agency.id && link.active);
  const activeCarrierIds = activeCarrierLinks.map((link) => link.carrierId);
  const activeCarrierNames = activeCarrierLinks.map(
    (link) => api.carriers.get(link.carrierId)?.name ?? link.carrierId
  );
  const validation = validateCarrierDownloadRunnerDraft({
    enabled,
    mode: method,
    credentialVaultRef: credentialReference,
    mfaMode,
    authorizedUserIds,
    lines,
    feeds,
    carrierIds: activeCarrierIds,
    reviewRule: fileFormats[0] ?? "require_review_for_material_changes",
    schedule: pollingSchedule,
    failureAlertEmails: splitRunnerList(errorAlertEmails),
    contactEmail,
    contactPhone,
    lastTestAt: testFileReceivedAt,
    lastTestStatus,
    lastTestMessage,
  });
  const hasSavedRunnerSetup = Boolean(
    agency.carrierRunnerAgencyCode?.trim() ||
      agency.carrierRunnerProfileId?.trim() ||
      agency.carrierRunnerCredentialVaultRef?.trim() ||
      activeCarrierIds.length ||
      agency.carrierRunnerContactEmail?.trim()
  );
  const runnerSetupStatusText = agency.carrierRunnerUpdatedAt
    ? `Updated ${fmt.dateTime(agency.carrierRunnerUpdatedAt)}`
    : hasSavedRunnerSetup
      ? "Runner setup saved. Awaiting supervised test."
      : "No carrier runner setup saved yet.";

  function resetDraftFromAgency() {
    setEnabled(Boolean(agency.carrierRunnerEnabled ?? agency.ivansDownloadEnabled));
    setStatus(agency.carrierRunnerStatus ?? agency.ivansConnectionStatus ?? "not_configured");
    setAgencyAccount(agency.carrierRunnerAgencyCode ?? agency.ivansAgencyAccount ?? agency.agencyCodePreview ?? "");
    setMailboxId(agency.carrierRunnerProfileId ?? agency.ivansMailboxId ?? "");
    setReceiverCode(agency.carrierRunnerReceiverCode ?? agency.ivansReceiverCode ?? "");
    setMethod(agency.carrierRunnerMode ?? "ai_portal_runner");
    setCredentialReference(agency.carrierRunnerCredentialVaultRef ?? agency.ivansCredentialReference ?? "");
    setMfaMode(agency.carrierRunnerMfaMode ?? "staff_approval");
    setAuthorizedUserIds(agency.carrierRunnerAuthorizedUserIds ?? []);
    setContactEmail(agency.carrierRunnerContactEmail ?? agency.ivansContactEmail ?? "");
    setContactPhone(agency.carrierRunnerContactPhone ?? agency.ivansContactPhone ?? "");
    setLines(agency.carrierRunnerLinesOfBusiness ?? agency.ivansLinesOfBusiness ?? ["personal"]);
    setFeeds(agency.carrierRunnerFeeds ?? agency.ivansDownloadFeeds ?? ["policy", "renewal", "billing", "edocs"]);
    setFileFormats(
      agency.carrierRunnerReviewRule
        ? [agency.carrierRunnerReviewRule]
        : ["require_review_for_material_changes"]
    );
    setPollingSchedule(agency.carrierRunnerSchedule ?? agency.ivansPollingSchedule ?? "as_available");
    setInboundPath(agency.carrierRunnerWorkingPath ?? agency.ivansInboundPath ?? "");
    setArchivePath(agency.carrierRunnerArchivePath ?? agency.ivansArchivePath ?? "");
    setErrorAlertEmails((agency.carrierRunnerFailureAlertEmails ?? agency.ivansErrorAlertEmails ?? []).join("\n"));
    setTestFileReceivedAt(
      agency.carrierRunnerLastTestAt ?? agency.ivansTestFileReceivedAt
        ? (agency.carrierRunnerLastTestAt ?? agency.ivansTestFileReceivedAt ?? "").slice(0, 16)
        : ""
    );
    setLastTestStatus(agency.carrierRunnerLastTestStatus ?? agency.ivansLastTestStatus ?? "not_tested");
    setLastTestMessage(agency.carrierRunnerLastTestMessage ?? agency.ivansLastTestMessage ?? "");
    setNotes(agency.carrierRunnerNotes ?? agency.ivansNotes ?? "");
  }

  function startEdit() {
    resetDraftFromAgency();
    setSavedAt(null);
    setLocked(false);
  }

  function cancel() {
    resetDraftFromAgency();
    setSavedAt(null);
    setLocked(true);
  }

  function save(nextStatus?: CarrierDownloadRunnerStatus) {
    const savedStatus: CarrierDownloadRunnerStatus = !enabled
      ? "not_configured"
      : status === "paused"
        ? "paused"
        : nextStatus ?? validation.status;
    api.agencies.update(agency.id, {
      carrierRunnerEnabled: enabled,
      carrierRunnerStatus: savedStatus,
      carrierRunnerMode: method,
      carrierRunnerAgencyCode: agencyAccount.trim() || undefined,
      carrierRunnerProfileId: mailboxId.trim() || undefined,
      carrierRunnerReceiverCode: receiverCode.trim() || undefined,
      carrierRunnerCredentialVaultRef: credentialReference.trim() || undefined,
      carrierRunnerMfaMode: mfaMode,
      carrierRunnerAuthorizedUserIds: authorizedUserIds,
      carrierRunnerLinesOfBusiness: lines,
      carrierRunnerFeeds: feeds,
      carrierRunnerCarrierIds: activeCarrierIds,
      carrierRunnerReviewRule: fileFormats[0] ?? "require_review_for_material_changes",
      carrierRunnerSchedule: pollingSchedule,
      carrierRunnerWorkingPath: inboundPath.trim() || undefined,
      carrierRunnerArchivePath: archivePath.trim() || undefined,
      carrierRunnerFailureAlertEmails: splitRunnerList(errorAlertEmails),
      carrierRunnerContactEmail: contactEmail.trim() || undefined,
      carrierRunnerContactPhone: contactPhone.trim() || undefined,
      carrierRunnerLastTestAt: testFileReceivedAt
        ? new Date(testFileReceivedAt).toISOString()
        : undefined,
      carrierRunnerLastTestStatus: lastTestStatus,
      carrierRunnerLastTestMessage: lastTestMessage.trim() || undefined,
      carrierRunnerNotes: notes.trim() || undefined,
      carrierRunnerUpdatedAt: new Date().toISOString(),
    });
    setSavedAt(new Date().toISOString());
    setStatus(savedStatus);
    setLocked(true);
    onChanged();
  }

  function checkSetup() {
    const nextStatus: CarrierDownloadRunnerStatus = validation.status;
    if (locked) {
      api.agencies.update(agency.id, {
        carrierRunnerStatus: nextStatus,
        carrierRunnerUpdatedAt: new Date().toISOString(),
      });
      onChanged();
      return;
    }
    setStatus(nextStatus);
    save(nextStatus);
  }

  function toggleLine(line: CarrierDownloadRunnerLineOfBusiness) {
    if (locked) return;
    setLines((current) =>
      current.includes(line) ? current.filter((item) => item !== line) : [...current, line]
    );
  }

  function toggleFeed(feed: CarrierDownloadRunnerFeed) {
    if (locked) return;
    setFeeds((current) =>
      current.includes(feed) ? current.filter((item) => item !== feed) : [...current, feed]
    );
  }

  function toggleFileFormat(format: CarrierDownloadRunnerReviewRule) {
    if (locked) return;
    setFileFormats([format]);
  }

  function toggleAuthorizedUser(userId: string) {
    if (locked) return;
    setAuthorizedUserIds((current) =>
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId]
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <DownloadCloud className="h-4 w-4 text-gold-600" /> Carrier download AI runner
          </span>
        }
        subtitle={
          locked
            ? "Locked. Controls how Quotex signs into carrier portals, stages updates, and protects staff from bad imports."
            : "Editing. Save to re-lock the carrier download AI runner."
        }
        action={
          locked ? (
            <button type="button" className="btn-outline text-xs" onClick={checkSetup}>
              Check setup
            </button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-sm text-ink-700">
        <span className={`h-2.5 w-2.5 rounded-full ${runnerStatusClass(agency.carrierRunnerStatus ?? status)}`} />
        <span className="font-medium">{runnerStatusLabel(agency.carrierRunnerStatus ?? status)}</span>
        <span className="text-ink-500">{runnerSetupStatusText}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="lg:col-span-2 rounded-md border border-ink-100 bg-white p-3">
          <button
            type="button"
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            className={`flex w-full items-center justify-between gap-3 text-left ${
              locked ? "pointer-events-none select-none" : ""
            }`}
            onClick={() => setEnabled((current) => !current)}
          >
            <span>
              <span className="block text-sm font-semibold text-ink-900">
                Automatic carrier download runner
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">
                When enabled, Quotex signs into approved carrier portals with stored staff credentials, retrieves policy, renewal, billing, claim, and document information, and stages risky changes for review.
              </span>
            </span>
            <span
              className={`inline-flex min-w-20 justify-center rounded-full px-3 py-1 text-xs font-semibold ${
                enabled ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-600"
              }`}
            >
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </button>
        </div>
        <div>
          <label className="label">Connection status</label>
          <select
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={status}
            onChange={(event) => setStatus(event.target.value as CarrierDownloadRunnerStatus)}
          >
            <option value="not_configured">Not configured</option>
            <option value="pending_setup">Pending setup</option>
            <option value="ready">Ready</option>
            <option value="paused">Paused</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label className="label">Runner mode</label>
          <select
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={method}
            onChange={(event) => setMethod(event.target.value as CarrierDownloadRunnerMode)}
          >
            {RUNNER_MODE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Carrier portal agency code / account group</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={agencyAccount}
            onChange={(event) => setAgencyAccount(event.target.value)}
            placeholder="Carrier-issued agency code or account group"
          />
        </div>
        <div>
          <label className="label">Runner profile ID</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={mailboxId}
            onChange={(event) => setMailboxId(event.target.value)}
            placeholder="Internal runner profile or environment ID"
          />
        </div>
        <div>
          <label className="label">Quotex receiver code</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={receiverCode}
            onChange={(event) => setReceiverCode(event.target.value)}
            placeholder="Quotex receiver code for this agency"
          />
        </div>
        <div>
          <label className="label">Credential vault reference</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={credentialReference}
            onChange={(event) => setCredentialReference(event.target.value)}
            placeholder="secret://carrier-runner/agency/portal-access"
          />
        </div>
        <div>
          <label className="label">MFA handling</label>
          <select
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={mfaMode}
            onChange={(event) => setMfaMode(event.target.value as CarrierDownloadRunnerMfaMode)}
          >
            <option value="staff_approval">Pause for staff approval</option>
            <option value="carrier_push">Carrier push approval</option>
            <option value="totp_vault">TOTP vault where allowed</option>
            <option value="not_configured">Not configured</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label">Carrier portals included automatically</label>
          <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
            <div className="flex flex-wrap gap-2">
              {activeCarrierNames.length > 0 ? (
                activeCarrierNames.map((name) => (
                  <span key={name} className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-xs font-semibold text-ink-700">
                    {name}
                  </span>
                ))
              ) : (
                <span className="text-sm text-ink-500">
                  No active carriers linked yet. Link carriers above and the runner includes them automatically.
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              The runner does not use a separate manual carrier list. It follows this agency's active carrier library links and skips inactive carriers.
            </p>
          </div>
        </div>
        <div>
          <label className="label">Runner contact email</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="downloads@agency.com"
          />
        </div>
        <div>
          <label className="label">Runner contact phone</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>
        <div>
          <label className="label">Update timing</label>
          <select
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={pollingSchedule}
            onChange={(event) => setPollingSchedule(event.target.value as CarrierDownloadRunnerSchedule)}
          >
            {RUNNER_SCHEDULE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-500">
            As available means event-triggered: policy placed, renewal window, billing check, document sync, claim check, or staff-requested run.
          </p>
        </div>
        <div>
          <label className="label">Failure alert emails</label>
          <textarea
            className={`${fieldClassName} min-h-[76px]`}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={errorAlertEmails}
            onChange={(event) => setErrorAlertEmails(event.target.value)}
            placeholder={"downloads@agency.com\nops@quotexinsurance.com"}
          />
        </div>
        <div>
          <label className="label">Runner working folder / mailbox path</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={inboundPath}
            onChange={(event) => setInboundPath(event.target.value)}
            placeholder="runner://agency/inbound or /carrier-downloads/agency"
          />
        </div>
        <div>
          <label className="label">Audit archive / replay folder</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={archivePath}
            onChange={(event) => setArchivePath(event.target.value)}
            placeholder="runner://agency/archive"
          />
        </div>
        <div>
          <label className="label">Last supervised test result</label>
          <select
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={lastTestStatus}
            onChange={(event) => setLastTestStatus(event.target.value as CarrierDownloadRunnerTestStatus)}
          >
            {RUNNER_TEST_STATUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Last supervised test at</label>
          <input
            type="datetime-local"
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={testFileReceivedAt}
            onChange={(event) => setTestFileReceivedAt(event.target.value)}
          />
        </div>
        <div className="lg:col-span-2">
          <label className="label">Test result message</label>
          <input
            className={fieldClassName}
            disabled={locked}
            tabIndex={locked ? -1 : 0}
            value={lastTestMessage}
            onChange={(event) => setLastTestMessage(event.target.value)}
            placeholder="Example: Chubb AL3 renewal + PDF eDoc parsed, matched policy, and archived successfully."
          />
        </div>
      </div>

      <div className="mt-5 grid lg:grid-cols-3 gap-4">
        <TogglePanel
          title="Lines of business"
          locked={locked}
          options={RUNNER_LINE_OPTIONS}
          selected={lines}
          onToggle={(id) => toggleLine(id as CarrierDownloadRunnerLineOfBusiness)}
        />
        <TogglePanel
          title="Carrier updates to pull"
          locked={locked}
          options={RUNNER_FEED_OPTIONS}
          selected={feeds}
          onToggle={(id) => toggleFeed(id as CarrierDownloadRunnerFeed)}
        />
        <TogglePanel
          title="Review behavior"
          locked={locked}
          options={RUNNER_REVIEW_OPTIONS}
          selected={fileFormats}
          onToggle={(id) => toggleFileFormat(id as CarrierDownloadRunnerReviewRule)}
        />
      </div>

      <div className="mt-4">
        <TogglePanel
          title="Staff allowed to approve MFA / exceptions"
          locked={locked}
          options={api.users.list(agency.id).map((staff) => ({
            id: staff.id,
            label: `${staff.name} (${staffRoleLabel(staff.role)})`,
          }))}
          selected={authorizedUserIds}
          onToggle={toggleAuthorizedUser}
        />
      </div>

      <div className="mt-4">
        <label className="label">Setup notes</label>
        <textarea
          className={`${fieldClassName} min-h-[92px]`}
          disabled={locked}
          tabIndex={locked ? -1 : 0}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Carrier portal exceptions, allowed automation notes, MFA contact rules, carrier-specific review notes..."
        />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="mb-3 text-xs uppercase tracking-wider text-ink-500">Automatic runner triggers</div>
          <div className="space-y-3">
            {RUNNER_TRIGGER_ROWS.map((row) => (
              <div key={row.title} className="border-b border-ink-100 pb-3 last:border-b-0 last:pb-0">
                <div className="text-sm font-semibold text-ink-900">{row.title}</div>
                <div className="mt-0.5 text-xs leading-5 text-ink-500">{row.detail}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-ink-100 bg-white p-3">
          <div className="mb-3 text-xs uppercase tracking-wider text-ink-500">Gaps handled before import</div>
          <div className="space-y-2">
            {RUNNER_GAP_ROWS.map((row) => (
              <div key={row} className="rounded-md bg-ink-50/60 px-3 py-2 text-xs leading-5 text-ink-600">
                {row}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        className={`mt-4 rounded-md border p-3 text-sm ${
          validation.ready
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : validation.status === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-gold-200 bg-gold-50/70 text-ink-700"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Production readiness check</div>
          <Badge tone={validation.ready ? "success" : validation.status === "error" ? "error" : "gold"}>
            {runnerStatusLabel(validation.status)}
          </Badge>
        </div>
        {!enabled ? (
          <p className="mt-2 text-xs">Carrier download automation is disabled for this agency.</p>
        ) : validation.missing.length === 0 ? (
          <p className="mt-2 text-xs">
            Required carrier access scope, credential reference, MFA handling, approvers, alerts, and supervised test are present.
          </p>
        ) : (
          <div className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wider">Still needed</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {validation.missing.map((item) => (
                <span key={item} className="rounded-full bg-white/80 px-2 py-1 text-[11px]">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
        {validation.warnings.length > 0 && (
          <div className="mt-3 border-t border-current/10 pt-2 text-xs">
            {validation.warnings.join(" ")}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        {[
          "Never cancels, binds, deletes, or changes carrier-side records.",
          "Matches policy number first, then insured, address, carrier, and term.",
          "Hashes every downloaded file to prevent duplicate imports.",
          "Stages low-confidence, premium, coverage, cancellation, and non-renewal changes for review.",
        ].map((item) => (
          <div key={item} className="rounded-md border border-ink-100 bg-white p-3 text-xs leading-5 text-ink-600">
            {item}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-gold-100 bg-gold-50/50 p-3 text-sm text-ink-700">
        Store only secret-manager references here, never raw carrier passwords. Live carrier runner
        access should remain Pending setup until a supervised test signs in, downloads a sample update,
        parses it, matches it to a policy, stages the change, and records the audit trail.
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-ink-100 pt-4 flex-wrap">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
          <Lock className={`h-3 w-3 ${savedAt ? "text-emerald-600" : ""}`} />
          {savedAt
            ? "Saved - locked again."
            : locked
              ? "Locked."
              : "Editing - unsaved changes."}
        </div>
        <div className="flex items-center gap-2">
          {locked ? (
            <button type="button" className="btn-outline text-xs" onClick={startEdit}>
              <Pencil className="h-3.5 w-3.5" /> Edit runner
            </button>
          ) : (
            <>
              <button type="button" className="btn-outline text-xs" onClick={cancel}>
                Cancel
              </button>
              <button type="button" className="btn-primary text-xs" onClick={checkSetup}>
                Check setup
              </button>
              <button type="button" className="btn-gold text-xs" onClick={() => save()}>
                <Save className="h-3.5 w-3.5" /> Save runner
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function TogglePanel({
  title,
  locked,
  options,
  selected,
  onToggle,
}: {
  title: string;
  locked: boolean;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="mb-2 text-xs uppercase tracking-wider text-ink-500">{title}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              disabled={locked}
              tabIndex={locked ? -1 : 0}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-200 bg-white text-ink-700"
              } ${locked ? "pointer-events-none select-none opacity-90" : "hover:border-gold-400"}`}
              onClick={() => onToggle(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function runnerStatusClass(status: CarrierDownloadRunnerStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500";
    case "pending_setup":
      return "bg-amber-500";
    case "paused":
      return "bg-ink-400";
    case "error":
      return "bg-rose-500";
    case "not_configured":
    default:
      return "bg-ink-300";
  }
}

function runnerStatusLabel(status: CarrierDownloadRunnerStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "pending_setup":
      return "Pending setup";
    case "paused":
      return "Paused";
    case "error":
      return "Error";
    case "not_configured":
    default:
      return "Not configured";
  }
}

function cleanRedirects(redirects: WebsiteAuthRedirects): WebsiteAuthRedirects {
  return Object.fromEntries(
    Object.entries(redirects)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => Boolean(value))
  ) as WebsiteAuthRedirects;
}

function connectionStatusClass(status: WebsiteConnectionStatus): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500";
    case "needs_setup":
      return "bg-amber-500";
    case "error":
      return "bg-rose-500";
    case "not_tested":
    default:
      return "bg-ink-300";
  }
}

function connectionStatusLabel(status: WebsiteConnectionStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_setup":
      return "Needs setup";
    case "error":
      return "Error";
    case "not_tested":
    default:
      return "Not checked";
  }
}

function connectionFieldClass(locked: boolean): string {
  return locked
    ? "input pointer-events-none select-none cursor-default bg-ink-50 text-ink-700 opacity-100 focus:border-ink-200 focus:ring-0"
    : "input";
}

function RedirectInput({
  label,
  value,
  locked,
  onChange,
}: {
  label: string;
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className={connectionFieldClass(locked)}
        disabled={locked}
        tabIndex={locked ? -1 : 0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://agencywebsite.com/client-portal"
      />
    </div>
  );
}

function SecretRow({
  label,
  value,
  copied,
  onCopy,
  actionLabel,
  onAction,
  icon,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="text-xs uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-ink-100 bg-ink-50 px-2 py-1.5">
          {icon && <span className="shrink-0 text-gold-600">{icon}</span>}
          <code className="min-w-0 flex-1 select-none truncate font-mono text-xs text-ink-800">
            {value || "Not generated"}
          </code>
        </div>
        <button type="button" className="btn-outline text-[11px] !px-2 !py-1" onClick={onCopy} disabled={!value}>
          {copied ? "Copied" : "Copy"}
        </button>
        {onAction && actionLabel && (
          <button type="button" className="btn-outline text-[11px] !px-2 !py-1" onClick={onAction}>
            <RefreshCw className="h-3 w-3" /> {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// Branches / office locations for an agency. The agency's own address
// is the HQ; these are additional locations the master can add/remove.
function BranchesCard({
  agencyId,
  onChanged,
}: {
  agencyId: string;
  onChanged: () => void;
}) {
  const branches = api.branches.listByAgency(agencyId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [phone, setPhone] = useState("");

  function reset() {
    setName("");
    setAddress("");
    setCity("");
    setState("");
    setZip("");
    setPhone("");
  }

  function add() {
    if (!name.trim()) return;
    api.branches.create({
      agencyId,
      name: name.trim(),
      address: address.trim() || undefined,
      city: city.trim() || undefined,
      state: state.trim() || undefined,
      zip: zip.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    reset();
    setOpen(false);
    onChanged();
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title={`Branches (${branches.length})`}
        subtitle="Additional office locations beyond the agency headquarters."
        action={
          <button type="button" className="btn-gold text-xs" onClick={() => setOpen((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Add branch
          </button>
        }
      />

      {open && (
        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Branch name *</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Downtown Office"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Street address</label>
              <input
                className="input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">State</label>
                <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
              </div>
              <div>
                <label className="label">ZIP</label>
                <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-outline text-sm" onClick={() => { reset(); setOpen(false); }}>
              Cancel
            </button>
            <button type="button" className="btn-primary text-sm" onClick={add} disabled={!name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add branch
            </button>
          </div>
        </div>
      )}

      {branches.length === 0 ? (
        <div className="text-sm text-ink-400">
          No branches yet — the agency operates from its headquarters address only.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {branches.map((b) => (
            <li key={b.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex items-start gap-2">
                <Building2 className="h-4 w-4 text-ink-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{b.name}</div>
                  <div className="text-xs text-ink-500">
                    {[b.address, [b.city, b.state].filter(Boolean).join(", "), b.zip]
                      .filter(Boolean)
                      .join(" · ") || "No address on file"}
                    {b.phone ? ` · ${b.phone}` : ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-outline text-xs !px-2 text-rose-600"
                title="Remove branch"
                onClick={() => {
                  if (!confirm(`Remove the "${b.name}" branch?`)) return;
                  api.branches.remove(b.id);
                  onChanged();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
