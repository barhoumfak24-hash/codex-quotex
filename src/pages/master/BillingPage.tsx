import { useState } from "react";
import type { ReactNode } from "react";
import { DollarSign, Pencil, Save, TrendingUp, Users, X } from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import {
  SOFTWARE_USER_MONTHLY_PRICE_USD,
  WEBSITE_APP_ADD_ON_OPTIONS,
  agencyMonthlyPriceUsd,
  extraUserSlotsForAgency,
  softwareSaleMonthlyTotalForSeats,
  standardAgencyMonthlyPriceUsd,
  websiteAppAddOnMonthlyUsd,
} from "@/lib/tiers";
import type { Agency, SoftwareSale, SoftwareSaleStatus } from "@/types";

export function BillingPage() {
  const [, setRev] = useState(0);
  const [editingAgencyId, setEditingAgencyId] = useState<string | null>(null);
  const [priceOverrideValue, setPriceOverrideValue] = useState("");
  const [priceOverrideReason, setPriceOverrideReason] = useState("");
  const [priceOverrideError, setPriceOverrideError] = useState("");

  const refresh = () => setRev((r) => r + 1);
  const agencies = api.agencies.list();
  const activeAgencies = agencies.filter((agency) => agency.active);
  const softwareSales = api.softwareSales.list();
  const openSales = softwareSales.filter((sale) => sale.status !== "closed");

  const pipelineMrr = openSales.reduce((sum, sale) => sum + saleMonthlyValue(sale), 0);
  const activeMrr = activeAgencies.reduce((sum, agency) => sum + agencyMonthlyPriceUsd(agency), 0);
  const standardActiveMrr = activeAgencies.reduce(
    (sum, agency) => sum + standardAgencyMonthlyPriceUsd(agency),
    0
  );
  const seatRevenue = activeAgencies.reduce(
    (sum, agency) => sum + agency.allowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD,
    0
  );
  const websiteAppRevenue = activeAgencies.reduce(
    (sum, agency) => sum + websiteAppAddOnMonthlyUsd(agency.websiteAppAddOn),
    0
  );
  const overrideDelta = activeMrr - standardActiveMrr;
  const overriddenAgencies = activeAgencies.filter(
    (agency) => typeof agency.monthlyPriceOverrideUsd === "number"
  );

  function setSaleStatus(id: string, status: SoftwareSaleStatus) {
    api.softwareSales.setStatus(id, status);
    refresh();
  }

  function startPriceEdit(agency: Agency) {
    setEditingAgencyId(agency.id);
    setPriceOverrideError("");
    setPriceOverrideValue(String(agency.monthlyPriceOverrideUsd ?? standardAgencyMonthlyPriceUsd(agency)));
    setPriceOverrideReason(agency.monthlyPriceOverrideReason ?? "");
  }

  function cancelPriceEdit() {
    setEditingAgencyId(null);
    setPriceOverrideError("");
    setPriceOverrideValue("");
    setPriceOverrideReason("");
  }

  function savePriceOverride(agency: Agency) {
    const parsed = Number(priceOverrideValue.replace(/[$,]/g, "").trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      setPriceOverrideError("Enter a valid monthly price.");
      return;
    }
    api.agencies.update(agency.id, {
      monthlyPriceOverrideUsd: Math.round(parsed),
      monthlyPriceOverrideReason: priceOverrideReason.trim() || undefined,
      monthlyPriceOverrideUpdatedAt: new Date().toISOString(),
    });
    cancelPriceEdit();
    refresh();
  }

  function clearPriceOverride(agency: Agency) {
    api.agencies.update(agency.id, {
      monthlyPriceOverrideUsd: undefined,
      monthlyPriceOverrideReason: undefined,
      monthlyPriceOverrideUpdatedAt: undefined,
    });
    cancelPriceEdit();
    refresh();
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div>
        <h1 className="font-display text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-ink-500">
          Revenue, subscription value, and agency-level monthly price controls.
        </p>
      </div>

      <Disclaimer>
        Payment status should be detected by Stripe webhooks, not by a manual paid button. Real
        implementation: server-side webhooks on <code>checkout.session.completed</code>,{" "}
        <code>invoice.payment_succeeded</code>, and <code>invoice.payment_failed</code>.
      </Disclaimer>

      <RevenueBreakdown
        activeMrr={activeMrr}
        standardActiveMrr={standardActiveMrr}
        seatRevenue={seatRevenue}
        websiteAppRevenue={websiteAppRevenue}
        overrideDelta={overrideDelta}
        pipelineMrr={pipelineMrr}
        openSalesCount={openSales.length}
        activeAgencyCount={activeAgencies.length}
        overriddenAgencyCount={overriddenAgencies.length}
      />

      <Card>
        <CardHeader
          title="Software checkout queue"
          subtitle={`${openSales.length} open request${openSales.length === 1 ? "" : "s"} from the transaction website. Payment state updates automatically once webhooks are connected.`}
        />
        {softwareSales.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
            No software checkout requests yet. Submissions from the transaction website will appear here.
          </div>
        ) : (
          <div className="divide-y divide-ink-100">
            {softwareSales.map((sale) => {
              const monthlyPrice = saleMonthlyValue(sale);
              const addOn = WEBSITE_APP_ADD_ON_OPTIONS[sale.websiteAppAddOn ?? "none"];
              return (
                <div
                  key={sale.id}
                  className="grid gap-4 py-4 text-sm lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Agency</div>
                    <div className="mt-1 font-medium text-ink-900">{sale.agencyName}</div>
                    <div className="text-xs text-ink-500">
                      {sale.website || "No website supplied"} - {fmt.dateTime(sale.createdAt)}
                    </div>
                    {sale.notes && (
                      <div className="mt-2 max-w-xl text-xs leading-relaxed text-ink-500">
                        {sale.notes}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-400">Buyer</div>
                    <div className="mt-1 font-medium">{sale.contactName}</div>
                    <div className="text-xs text-ink-500">{sale.email}</div>
                    {sale.phone && <div className="text-xs text-ink-500">{sale.phone}</div>}
                    {sale.signedAt ? (
                      <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-xs leading-relaxed text-emerald-700">
                        Forms e-signed {fmt.dateTime(sale.signedAt)}
                        {sale.signedByName ? ` by ${sale.signedByName}` : ""}.
                        {sale.signedAgreements?.length ? (
                          <div className="mt-2 space-y-1 border-t border-emerald-100 pt-2">
                            {sale.signedAgreements.map((agreement) => (
                              <div key={agreement.id} className="flex justify-between gap-3">
                                <span className="font-medium text-emerald-900">{agreement.title}</span>
                                <span className="shrink-0">{fmt.dateTime(agreement.signedAt)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                        Checkout forms not e-signed yet.
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 lg:text-right">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-400">Users</div>
                        <div className="mt-1">{sale.seats} software users</div>
                        <div className="text-xs text-ink-500">Volume discount applied automatically</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-400">Value</div>
                        <div className="mt-1">{fmt.money(monthlyPrice)}/mo</div>
                        <div className="text-xs text-ink-500">
                          {fmt.money(softwareSaleMonthlyTotalForSeats(sale.seats, "none"))} software
                          {sale.websiteAppAddOnMonthly ? ` + ${fmt.money(sale.websiteAppAddOnMonthly)} add-on` : ""}
                        </div>
                        <div className="text-xs text-ink-500">
                          {sale.termMonths ?? 12}-month term
                          {sale.termDiscountPercent
                            ? ` - ${sale.termDiscountPercent}% off (${fmt.money(sale.termDiscountMonthly ?? 0)}/mo)`
                            : ""}
                        </div>
                        <div className="text-xs text-ink-500">{addOn.label}</div>
                      </div>
                    </div>
                    <div>
                      <Badge tone={saleTone(sale.status)}>{fmt.titleCase(sale.status.replace(/_/g, " "))}</Badge>
                      <div className="mt-1 break-all text-[11px] text-ink-400">{sale.stripeCheckoutSessionId}</div>
                      {sale.status === "checkout_pending" && (
                        <div className="mt-1 text-[11px] text-ink-500">
                          Waiting for automatic payment confirmation.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      {sale.status !== "provisioning" && sale.status !== "closed" && (
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => setSaleStatus(sale.id, "provisioning")}
                        >
                          Provision
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => setSaleStatus(sale.id, sale.status === "closed" ? "checkout_pending" : "closed")}
                      >
                        {sale.status === "closed" ? "Reopen" : "Close"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Agency monthly billing"
          subtitle="Manual special prices are master-only overrides. They change billed monthly revenue without changing the agency's purchased seats."
        />
        <div className="overflow-hidden rounded-lg border border-ink-100">
          <div className="grid grid-cols-[minmax(13rem,1.25fr)_7rem_minmax(13rem,1fr)_minmax(12rem,1fr)_minmax(15rem,auto)] gap-3 border-b border-ink-100 bg-ink-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
            <div>Agency</div>
            <div>Tier</div>
            <div>Monthly price</div>
            <div>Stripe</div>
            <div className="text-right">Price control</div>
          </div>
          <div className="divide-y divide-ink-100">
            {agencies.map((agency) => {
              const standardMonthly = standardAgencyMonthlyPriceUsd(agency);
              const billedMonthly = agencyMonthlyPriceUsd(agency);
              const hasOverride = typeof agency.monthlyPriceOverrideUsd === "number";
              const editing = editingAgencyId === agency.id;
              const discount = standardMonthly - billedMonthly;
              return (
                <div
                  key={agency.id}
                  className="grid grid-cols-[minmax(13rem,1.25fr)_7rem_minmax(13rem,1fr)_minmax(12rem,1fr)_minmax(15rem,auto)] items-start gap-3 px-4 py-4 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-ink-900">{agency.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone={agency.active ? "success" : "neutral"}>
                        {agency.active ? "Active" : "Inactive"}
                      </Badge>
                      {hasOverride && <Badge tone="gold">Special price</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-ink-500">
                      {agency.allowedUsers} purchased user seats
                    </div>
                  </div>
                  <div className="capitalize text-ink-700">{agency.tier}</div>
                  <div>
                    <div className="font-semibold text-ink-900">{fmt.money(billedMonthly)}/mo</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      Standard: {fmt.money(standardMonthly)}/mo
                    </div>
                    {extraUserSlotsForAgency(agency) > 0 && (
                      <div className="text-xs text-ink-500">
                        Includes {extraUserSlotsForAgency(agency)} add-on slot
                        {extraUserSlotsForAgency(agency) === 1 ? "" : "s"}
                      </div>
                    )}
                    {hasOverride && (
                      <div className={discount >= 0 ? "text-xs text-emerald-700" : "text-xs text-amber-700"}>
                        {discount >= 0
                          ? `${fmt.money(discount)}/mo discount`
                          : `${fmt.money(Math.abs(discount))}/mo above standard`}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 text-xs text-ink-600">
                    <div className="break-all">{agency.stripeCustomerId ?? "No Stripe customer yet"}</div>
                    {agency.stripeSubscriptionId && (
                      <div className="mt-1 break-all text-ink-400">{agency.stripeSubscriptionId}</div>
                    )}
                  </div>
                  <div className="space-y-2 text-right">
                    {editing ? (
                      <div className="ml-auto max-w-sm rounded-md border border-gold-200 bg-gold-50 p-3 text-left">
                        <label className="label" htmlFor={`price-${agency.id}`}>
                          Manual monthly price
                        </label>
                        <input
                          id={`price-${agency.id}`}
                          className="input"
                          inputMode="numeric"
                          value={priceOverrideValue}
                          onChange={(event) => {
                            setPriceOverrideValue(event.target.value);
                            setPriceOverrideError("");
                          }}
                          placeholder={String(standardMonthly)}
                        />
                        <label className="label mt-3" htmlFor={`reason-${agency.id}`}>
                          Reason
                        </label>
                        <textarea
                          id={`reason-${agency.id}`}
                          className="input min-h-[72px]"
                          value={priceOverrideReason}
                          onChange={(event) => setPriceOverrideReason(event.target.value)}
                          placeholder="Founder-approved discount, relationship pricing..."
                        />
                        {priceOverrideError && (
                          <div className="mt-2 text-xs font-medium text-rose-700">
                            {priceOverrideError}
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button type="button" className="btn-ghost text-xs" onClick={cancelPriceEdit}>
                            <X className="h-3.5 w-3.5" /> Cancel
                          </button>
                          {hasOverride && (
                            <button
                              type="button"
                              className="btn-outline text-xs"
                              onClick={() => clearPriceOverride(agency)}
                            >
                              Clear override
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-gold text-xs"
                            onClick={() => savePriceOverride(agency)}
                          >
                            <Save className="h-3.5 w-3.5" /> Save price
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => startPriceEdit(agency)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Adjust price
                        </button>
                        {hasOverride && (
                          <div className="ml-auto max-w-xs text-xs leading-relaxed text-ink-500">
                            {agency.monthlyPriceOverrideReason || "No reason recorded."}
                            {agency.monthlyPriceOverrideUpdatedAt && (
                              <div className="text-ink-400">
                                Updated {fmt.dateTime(agency.monthlyPriceOverrideUpdatedAt)}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

function RevenueBreakdown({
  activeMrr,
  standardActiveMrr,
  seatRevenue,
  websiteAppRevenue,
  overrideDelta,
  pipelineMrr,
  openSalesCount,
  activeAgencyCount,
  overriddenAgencyCount,
}: {
  activeMrr: number;
  standardActiveMrr: number;
  seatRevenue: number;
  websiteAppRevenue: number;
  overrideDelta: number;
  pipelineMrr: number;
  openSalesCount: number;
  activeAgencyCount: number;
  overriddenAgencyCount: number;
}) {
  const projectedMonthly = activeMrr + pipelineMrr;
  return (
    <Card>
      <CardHeader
        title="Monthly revenue breakdown"
        subtitle="What the platform is currently billing, what is pending, and where the money is coming from."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(18rem,1.1fr)_minmax(0,1.9fr)]">
        <div className="rounded-lg border border-gold-200 bg-gold-50 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-gold-700">
                Active monthly revenue
              </div>
              <div className="mt-2 text-4xl font-semibold text-ink-900">{fmt.money(activeMrr)}</div>
              <div className="mt-1 text-sm text-ink-600">
                {activeAgencyCount} active agenc{activeAgencyCount === 1 ? "y" : "ies"}
              </div>
            </div>
            <DollarSign className="h-7 w-7 text-gold-700" />
          </div>
          <div className="mt-4 rounded-md border border-gold-200 bg-white/60 px-3 py-2 text-sm text-ink-700">
            Projected with open checkout requests:{" "}
            <span className="font-semibold text-ink-950">{fmt.money(projectedMonthly)}/mo</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <RevenueTile
            icon={<Users className="h-4 w-4" />}
            label="Staff-seat revenue"
            value={fmt.money(seatRevenue)}
            hint={`$${SOFTWARE_USER_MONTHLY_PRICE_USD}/user/mo across active agencies`}
          />
          <RevenueTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Website / Quotex app add-ons"
            value={fmt.money(websiteAppRevenue)}
            hint="Active agency website and app packages"
          />
          <RevenueTile
            icon={<Pencil className="h-4 w-4" />}
            label={overrideDelta < 0 ? "Manual discounts" : "Manual price adjustments"}
            value={
              overrideDelta === 0
                ? fmt.money(0)
                : `${overrideDelta > 0 ? "+" : "-"}${fmt.money(Math.abs(overrideDelta))}`
            }
            hint={`${overriddenAgencyCount} special price override${overriddenAgencyCount === 1 ? "" : "s"}`}
            valueClassName={
              overrideDelta < 0
                ? "text-emerald-700"
                : overrideDelta > 0
                ? "text-amber-700"
                : undefined
            }
          />
          <RevenueTile
            icon={<DollarSign className="h-4 w-4" />}
            label="Open checkout pipeline"
            value={fmt.money(pipelineMrr)}
            hint={`${openSalesCount} open transaction request${openSalesCount === 1 ? "" : "s"}`}
          />
        </div>
      </div>
      <div className="mt-4 rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-500">
        Standard active pricing before manual overrides: {fmt.money(standardActiveMrr)}/mo.
        Active monthly revenue reflects any master-approved special pricing.
      </div>
    </Card>
  );
}

function RevenueTile({
  icon,
  label,
  value,
  hint,
  valueClassName = "text-ink-900",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="rounded-md border border-gold-200 bg-gold-50 p-2 text-gold-700">{icon}</span>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${valueClassName}`}>{value}</div>
          <div className="mt-1 text-xs leading-relaxed text-ink-500">{hint}</div>
        </div>
      </div>
    </div>
  );
}

function saleTone(status: SoftwareSaleStatus): "neutral" | "info" | "success" | "warn" | "error" | "gold" {
  if (status === "paid_demo") return "success";
  if (status === "provisioning") return "gold";
  if (status === "closed") return "neutral";
  return "warn";
}

function saleMonthlyValue(sale: SoftwareSale): number {
  return sale.estimatedMonthly || softwareSaleMonthlyTotalForSeats(sale.seats, sale.websiteAppAddOn);
}
