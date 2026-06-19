import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Download, Search, X } from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import {
  billingFrequencyLabel,
  billingHasMissingInfo,
  billingMethodLabel,
  billingStatusFor,
} from "@/lib/billing";
import { fmt } from "@/lib/format";
import type { Carrier, CarrierDownload, CustomerProfile, Payment, Policy } from "@/types";

type AccountingFilter =
  | "all"
  | "commission_pending"
  | "commission_received"
  | "unreconciled"
  | "direct_bill"
  | "agency_bill"
  | "premium_finance"
  | "past_due";

type ReconciliationStatus = "reconciled" | "pending" | "needs_review" | "missing_info";

type AccountingRow = {
  customer: CustomerProfile;
  policy: Policy;
  carrier?: Carrier;
  commissionDownloads: CarrierDownload[];
  payments: Payment[];
  premium: number;
  commissionRate: number;
  expectedCommission: number;
  receivedCommission: number;
  pendingCommission: number;
  reconciliationStatus: ReconciliationStatus;
};

type CarrierProductionRow = {
  carrierId: string;
  carrierName: string;
  premium: number;
  expectedCommission: number;
  policyCount: number;
  percentage: number;
};

const ACCOUNTING_FILTERS: Array<{ id: AccountingFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "commission_pending", label: "Commission Pending" },
  { id: "commission_received", label: "Commission Received" },
  { id: "unreconciled", label: "Unreconciled" },
  { id: "direct_bill", label: "Direct Bill" },
  { id: "agency_bill", label: "Agency Bill" },
  { id: "premium_finance", label: "Premium Finance" },
  { id: "past_due", label: "Past Due" },
];

const RECONCILIATION_LABEL: Record<ReconciliationStatus, string> = {
  reconciled: "Reconciled",
  pending: "Pending",
  needs_review: "Needs review",
  missing_info: "Missing info",
};

function reconciliationTone(status: ReconciliationStatus): "success" | "warn" | "error" | "neutral" {
  if (status === "reconciled") return "success";
  if (status === "needs_review") return "warn";
  if (status === "missing_info") return "error";
  return "neutral";
}

export function AccountingPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountingFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [openPolicyId, setOpenPolicyId] = useState<string | null>(null);

  if (!agency || !user) return null;
  if (user.role !== "manager") return <Navigate to="/employee" replace />;

  const rows = buildAccountingRows(agency.id).sort((a, b) => {
    const statusDiff = reconciliationRank(a.reconciliationStatus) - reconciliationRank(b.reconciliationStatus);
    if (statusDiff !== 0) return statusDiff;
    return b.pendingCommission - a.pendingCommission;
  });

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filter === "commission_pending") return row.pendingCommission > 0;
        if (filter === "commission_received") return row.receivedCommission > 0;
        if (filter === "unreconciled") return row.reconciliationStatus !== "reconciled";
        if (filter === "direct_bill") return row.policy.billingMethod === "direct_bill";
        if (filter === "agency_bill") return row.policy.billingMethod === "agency_bill";
        if (filter === "premium_finance") return row.policy.billingMethod === "premium_finance";
        if (filter === "past_due") return billingStatusFor(row.policy) === "past_due";
        return true;
      })
      .filter((row) => {
        if (!q) return true;
        return accountingSearchParts(row).join(" ").toLowerCase().includes(q);
      })
      .filter((row) => {
        if (!customFilter.trim()) return true;
        return matchesAiCustomFilter(customFilter, {
          text: accountingSearchParts(row),
          flags: {
            active: row.policy.status === "bound",
            pending: row.pendingCommission > 0,
            received: row.receivedCommission > 0,
            reconciled: row.reconciliationStatus === "reconciled",
            unreconciled: row.reconciliationStatus !== "reconciled",
            needsReview: row.reconciliationStatus === "needs_review",
            missing: row.reconciliationStatus === "missing_info" || billingHasMissingInfo(row.policy),
            missingInfo: row.reconciliationStatus === "missing_info" || billingHasMissingInfo(row.policy),
            missingAccount: !row.policy.billingAccountNumber?.trim(),
            alert: row.reconciliationStatus === "needs_review" || row.reconciliationStatus === "missing_info",
            due: billingStatusFor(row.policy) === "past_due" || billingStatusFor(row.policy) === "due_soon",
            dueSoon: billingStatusFor(row.policy) === "due_soon",
            pastDue: billingStatusFor(row.policy) === "past_due",
            bound: row.policy.status === "bound",
            directBill: row.policy.billingMethod === "direct_bill",
            agencyBill: row.policy.billingMethod === "agency_bill",
            carrierAutopay: row.policy.billingMethod === "carrier_autopay",
            premiumFinance: row.policy.billingMethod === "premium_finance",
            mortgageeEscrow: row.policy.billingMethod === "mortgagee_escrow",
            personal: (row.policy.department ?? "personal") === "personal",
            commercial: row.policy.department === "commercial",
          },
          numbers: [row.premium, row.expectedCommission, row.receivedCommission, row.pendingCommission],
        });
      });
  }, [rows, filter, query, customFilter]);

  const selectedRow = rows.find((row) => row.policy.id === openPolicyId) ?? null;
  const totals = accountingTotals(rows);
  const carrierProduction = buildCarrierProductionRows(agency.id, rows);

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Accounting</h1>
          <p className="text-sm text-ink-500 mt-1">
            Manager-only commission, reconciliation, direct-bill, agency-bill, and premium-finance oversight.
          </p>
        </div>
        <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} disabled>
          Export
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <StatCard label="Agency revenue" value={fmt.money(totals.expectedCommission)} hint="Expected commission" />
        <StatCard label="Commission pending" value={fmt.money(totals.pendingCommission)} hint="Needs carrier/payment confirmation" />
        <StatCard label="Commission received" value={fmt.money(totals.receivedCommission)} hint="Recorded or reconciled" />
        <StatCard label="Unreconciled" value={totals.unreconciled} hint="Rows needing review" />
        <StatCard label="Agency bill" value={fmt.money(totals.agencyBillPremium)} hint="Premium tracked by agency" />
      </div>

      <CarrierProductionCard
        rows={carrierProduction.rows}
        totalPremium={carrierProduction.totalPremium}
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, policy, carrier, billing method, commission, payment reference, or reconciliation status..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ACCOUNTING_FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              filter === item.id
                ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 hover:shadow-md"
            }`}
          >
            {item.label}
          </button>
        ))}
        <AiCustomFilterChip
          value={customFilter}
          onChange={setCustomFilter}
          placeholder="ex: pending Chubb commission, direct bill over 10k, missing info, unreconciled commercial"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy</th>
              <th className="px-4 py-4">Carrier</th>
              <th className="px-4 py-4">Premium</th>
              <th className="px-4 py-4">Billing</th>
              <th className="px-4 py-4">Commission</th>
              <th className="px-4 py-4">Reconciliation</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filteredRows.map((row) => {
              const asset = api.assets.get(row.policy.assetId);
              return (
                <tr key={row.policy.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-5 align-middle">
                    <div className="break-words text-sm font-semibold leading-snug text-ink-900">
                      {row.customer.name}
                    </div>
                    <div className="truncate text-xs text-ink-500">{row.customer.email}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-mono text-sm font-semibold text-ink-900">{fmt.policyRef(row.policy)}</div>
                    <div className="truncate text-xs text-ink-500">
                      {asset?.label ?? "Asset not recorded"} - {api.helpers.departmentLabel(row.policy)}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="line-clamp-2">{row.carrier?.name ?? "Carrier missing"}</div>
                  </td>
                  <td className="px-4 py-5 align-middle tabular-nums">{fmt.money(row.premium)}</td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-medium text-ink-900 line-clamp-1">{billingMethodLabel(row.policy.billingMethod)}</div>
                    <div className="text-xs text-ink-500 line-clamp-1">{billingFrequencyLabel(row.policy)}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-semibold tabular-nums text-ink-900">{fmt.money(row.expectedCommission)}</div>
                    <div className="text-xs text-ink-500">
                      {(row.commissionRate * 100).toFixed(1)}% rate - {fmt.money(row.pendingCommission)} pending
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <Badge tone={reconciliationTone(row.reconciliationStatus)}>
                      {RECONCILIATION_LABEL[row.reconciliationStatus]}
                    </Badge>
                    {row.commissionDownloads.some((download) => download.status !== "approved") && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="h-3 w-3" />
                        Statement review
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="flex justify-end">
                      <Button size="xs" onClick={() => setOpenPolicyId(row.policy.id)}>
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-sm text-ink-400">
                  {query.trim() ? `No accounting rows match "${query}".` : "No accounting rows match this view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <AccountingDetailModal row={selectedRow} onClose={() => setOpenPolicyId(null)} />
    </div>
  );
}

function AccountingDetailModal({ row, onClose }: { row: AccountingRow | null; onClose: () => void }) {
  if (!row) return null;
  const asset = api.assets.get(row.policy.assetId);
  return (
    <Modal open={!!row} onClose={onClose} title="Accounting detail" size="xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-ink-100 pb-3">
          <Button size="sm" to={`/employee/billing/${row.policy.id}`}>
            Open billing
          </Button>
          <Button size="sm" to={`/employee/policies/${row.policy.id}`}>
            Open policy
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <MiniMetric label="Premium" value={fmt.money(row.premium)} />
          <MiniMetric label="Expected commission" value={fmt.money(row.expectedCommission)} />
          <MiniMetric label="Received / recorded" value={fmt.money(row.receivedCommission)} />
          <MiniMetric label="Pending" value={fmt.money(row.pendingCommission)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="shadow-none">
            <h3 className="text-base font-semibold text-ink-900">Policy accounting</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Client" value={row.customer.name} />
              <Field label="Policy" value={fmt.policyRef(row.policy)} mono />
              <Field label="Carrier" value={row.carrier?.name ?? "Carrier missing"} />
              <Field label="Asset" value={asset?.label ?? "Asset not recorded"} />
              <Field label="Billing method" value={billingMethodLabel(row.policy.billingMethod)} />
              <Field label="Payment plan" value={billingFrequencyLabel(row.policy)} />
              <Field label="Account / reference" value={row.policy.billingAccountNumber ?? row.policy.billingReference ?? "Not recorded"} />
              <Field label="Next due" value={`${fmt.date(row.policy.nextPaymentDueDate)} - ${fmt.money(row.policy.nextPaymentAmount ?? 0)}`} />
            </div>
          </Card>

          <Card className="shadow-none">
            <h3 className="text-base font-semibold text-ink-900">Reconciliation</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">Status</span>
                <Badge tone={reconciliationTone(row.reconciliationStatus)}>
                  {RECONCILIATION_LABEL[row.reconciliationStatus]}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">Commission rate</span>
                <span className="font-semibold">{(row.commissionRate * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-500">Carrier statements</span>
                <span className="font-semibold">{row.commissionDownloads.length}</span>
              </div>
              <div className="rounded-md border border-ink-100 bg-ink-50 p-3 text-xs leading-5 text-ink-600">
                {reconciliationSummary(row)}
              </div>
            </div>
          </Card>
        </div>

        <Card className="shadow-none">
          <h3 className="text-base font-semibold text-ink-900">Recorded payment history</h3>
          <div className="mt-3 divide-y divide-ink-100">
            {row.payments.length > 0 ? (
              row.payments.map((payment) => (
                <div key={payment.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3 text-sm">
                  <div>
                    <div className="font-medium text-ink-900">{fmt.money(payment.amount, payment.currency)}</div>
                    <div className="text-xs text-ink-500">{fmt.dateTime(payment.paidAt ?? payment.createdAt)}</div>
                  </div>
                  <div className="text-xs uppercase tracking-wider text-ink-500">{payment.method}</div>
                  <Badge tone={payment.status === "paid" ? "success" : payment.status === "failed" ? "error" : "neutral"}>
                    {fmt.titleCase(payment.status)}
                  </Badge>
                </div>
              ))
            ) : (
              <div className="py-4 text-sm text-ink-400">
                No recorded payment rows. Direct-bill and carrier-autopay policies may only reconcile from carrier statements.
              </div>
            )}
          </div>
        </Card>
      </div>
    </Modal>
  );
}

function buildAccountingRows(tenantId: string): AccountingRow[] {
  const customers = api.customers.list(tenantId).filter((customer) => !customer.archived);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const commissionDownloads = api.carrierDownloads
    .listByTenant(tenantId)
    .filter((download) => download.kind === "commission_statement");

  return api.policies
    .listByTenant(tenantId)
    .filter((policy) => customerById.has(policy.customerId))
    .map((policy) => {
      const customer = customerById.get(policy.customerId)!;
      const carrier = api.carriers.get(policy.carrierId);
      const payments = api.payments.listByPolicy(policy.id).filter((payment) => payment.status === "paid");
      const policyDownloads = commissionDownloads.filter((download) => download.policyId === policy.id);
      const premium = premiumFor(policy);
      const commissionRate = commissionRateFor(policy);
      const expectedCommission = Math.round(premium * commissionRate);
      const receivedCommission = commissionReceivedFor(policy, payments, policyDownloads, expectedCommission, premium);
      const pendingCommission = Math.max(0, expectedCommission - receivedCommission);
      const reconciliationStatus = reconciliationStatusFor(policy, policyDownloads, receivedCommission, expectedCommission);
      return {
        customer,
        policy,
        carrier,
        commissionDownloads: policyDownloads,
        payments,
        premium,
        commissionRate,
        expectedCommission,
        receivedCommission,
        pendingCommission,
        reconciliationStatus,
      };
    });
}

function buildCarrierProductionRows(tenantId: string, accountingRows: AccountingRow[]) {
  const carrierRows = new Map<string, CarrierProductionRow>();
  api.carriers.listForTenant(tenantId).forEach((carrier) => {
    carrierRows.set(carrier.id, {
      carrierId: carrier.id,
      carrierName: carrier.name,
      premium: 0,
      expectedCommission: 0,
      policyCount: 0,
      percentage: 0,
    });
  });

  accountingRows.forEach((row) => {
    const carrierId = row.carrier?.id ?? row.policy.carrierId ?? "missing";
    const carrierName = row.carrier?.name ?? "Carrier missing";
    const current =
      carrierRows.get(carrierId) ??
      {
        carrierId,
        carrierName,
        premium: 0,
        expectedCommission: 0,
        policyCount: 0,
        percentage: 0,
      };
    current.premium += row.premium;
    current.expectedCommission += row.expectedCommission;
    current.policyCount += 1;
    carrierRows.set(carrierId, current);
  });

  const totalPremium = Array.from(carrierRows.values()).reduce((sum, row) => sum + row.premium, 0);
  const rows = Array.from(carrierRows.values())
    .map((row) => ({
      ...row,
      percentage: totalPremium > 0 ? row.premium / totalPremium : 0,
    }))
    .sort((a, b) => {
      if (b.premium !== a.premium) return b.premium - a.premium;
      return a.carrierName.localeCompare(b.carrierName);
    });

  return { rows, totalPremium };
}

function CarrierProductionCard({
  rows,
  totalPremium,
}: {
  rows: CarrierProductionRow[];
  totalPremium: number;
}) {
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="p-5 pb-3">
        <CardHeader
          title="Carrier production"
          subtitle="Written premium by carrier, plus each carrier's share of the agency total."
          action={
            <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Agency total
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-900">
                {fmt.money(totalPremium)}
              </div>
            </div>
          }
        />
      </div>

      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[18%]" />
          <col className="w-[16%]" />
          <col className="w-[18%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <tr className="border-y border-ink-100 bg-ink-50/70 text-left text-xs uppercase tracking-wider text-ink-500">
            <th className="px-5 py-3">Carrier</th>
            <th className="px-5 py-3">Produced</th>
            <th className="px-5 py-3">Share</th>
            <th className="px-5 py-3">Expected commission</th>
            <th className="px-5 py-3 text-right">Policies</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr key={row.carrierId} className={row.premium > 0 ? "bg-white" : "bg-ink-50/30 text-ink-400"}>
              <td className="px-5 py-4 align-middle">
                <div className="font-semibold leading-snug text-ink-900">{row.carrierName}</div>
              </td>
              <td className="px-5 py-4 align-middle tabular-nums font-semibold text-ink-900">
                {fmt.money(row.premium)}
              </td>
              <td className="px-5 py-4 align-middle">
                <div className="flex items-center gap-3">
                  <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-gold-600"
                      style={{ width: `${Math.max(0, Math.min(100, row.percentage * 100))}%` }}
                    />
                  </div>
                  <span className="w-14 text-right tabular-nums font-semibold text-ink-800">
                    {(row.percentage * 100).toFixed(1)}%
                  </span>
                </div>
              </td>
              <td className="px-5 py-4 align-middle tabular-nums">
                {fmt.money(row.expectedCommission)}
              </td>
              <td className="px-5 py-4 align-middle text-right tabular-nums">
                {row.policyCount}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-sm text-ink-400">
                No carrier production has been recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function premiumFor(policy: Policy): number {
  return policy.finalPremium ?? policy.premiumBreakdown?.total ?? policy.premiumEstimate ?? 0;
}

function commissionRateFor(policy: Policy): number {
  if (policy.department === "commercial") return 0.15;
  if (policy.billingMethod === "premium_finance") return 0.11;
  if (policy.billingMethod === "carrier_autopay") return 0.12;
  if (policy.billingMethod === "agency_bill") return 0.14;
  return 0.125;
}

function commissionReceivedFor(
  policy: Policy,
  payments: Payment[],
  downloads: CarrierDownload[],
  expectedCommission: number,
  premium: number
): number {
  if (downloads.some((download) => download.status === "approved")) return expectedCommission;
  const paidPremium = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (premium <= 0) return 0;
  if (policy.billingMethod === "direct_bill" || policy.billingMethod === "carrier_autopay") {
    return 0;
  }
  return Math.min(expectedCommission, Math.round(expectedCommission * Math.min(1, paidPremium / premium)));
}

function reconciliationStatusFor(
  policy: Policy,
  downloads: CarrierDownload[],
  receivedCommission: number,
  expectedCommission: number
): ReconciliationStatus {
  if (billingHasMissingInfo(policy)) return "missing_info";
  if (downloads.some((download) => ["unreviewed", "matched", "needs_review"].includes(download.status))) {
    return "needs_review";
  }
  if (downloads.some((download) => download.status === "approved") || receivedCommission >= expectedCommission) {
    return "reconciled";
  }
  return "pending";
}

function reconciliationRank(status: ReconciliationStatus): number {
  if (status === "needs_review") return 0;
  if (status === "missing_info") return 1;
  if (status === "pending") return 2;
  return 3;
}

function accountingTotals(rows: AccountingRow[]) {
  return rows.reduce(
    (totals, row) => ({
      expectedCommission: totals.expectedCommission + row.expectedCommission,
      receivedCommission: totals.receivedCommission + row.receivedCommission,
      pendingCommission: totals.pendingCommission + row.pendingCommission,
      unreconciled: totals.unreconciled + (row.reconciliationStatus === "reconciled" ? 0 : 1),
      agencyBillPremium: totals.agencyBillPremium + (row.policy.billingMethod === "agency_bill" ? row.premium : 0),
    }),
    {
      expectedCommission: 0,
      receivedCommission: 0,
      pendingCommission: 0,
      unreconciled: 0,
      agencyBillPremium: 0,
    }
  );
}

function accountingSearchParts(row: AccountingRow): string[] {
  const asset = api.assets.get(row.policy.assetId);
  return [
    row.customer.name,
    row.customer.email,
    row.customer.phone,
    row.carrier?.name,
    asset?.label,
    row.policy.policyNumber,
    fmt.policyRef(row.policy),
    api.helpers.departmentLabel(row.policy),
    billingMethodLabel(row.policy.billingMethod),
    billingFrequencyLabel(row.policy),
    RECONCILIATION_LABEL[row.reconciliationStatus],
    row.policy.billingAccountNumber,
    row.policy.billingReference,
    row.policy.billingNotes,
    row.commissionDownloads.map((download) => download.summary).join(" "),
  ].filter(Boolean) as string[];
}

function reconciliationSummary(row: AccountingRow): string {
  if (row.reconciliationStatus === "missing_info") {
    return "Billing or payment-plan metadata is missing. Complete the billing fields before relying on commission projections.";
  }
  if (row.commissionDownloads.some((download) => ["unreviewed", "matched", "needs_review"].includes(download.status))) {
    return "A carrier commission statement is present and still needs manager review before this row is marked reconciled.";
  }
  if (row.reconciliationStatus === "reconciled") {
    return "This policy is reconciled from an approved carrier statement or recorded payment history.";
  }
  return "Expected commission is still pending. Reconcile it when the carrier statement or agency-bill receipt is available.";
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={mono ? "font-mono text-sm text-ink-900" : "text-sm font-medium text-ink-900"}>{value}</div>
    </div>
  );
}
