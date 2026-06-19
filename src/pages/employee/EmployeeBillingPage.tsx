import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import {
  BILLING_STATUS_LABEL,
  billingCarrierUrl,
  billingFrequencyLabel,
  billingHasMissingInfo,
  billingMethodLabel,
  billingStatusFor,
  billingStatusRank,
  billingStatusTone,
} from "@/lib/billing";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt } from "@/lib/format";
import type { Carrier, CustomerProfile, Policy, PolicyBillingStatus } from "@/types";

type BillingFilter =
  | "all"
  | "current"
  | "due_soon"
  | "past_due"
  | "direct_bill"
  | "agency_bill"
  | "premium_finance"
  | "missing_info";

type PolicyBillingRow = {
  customer: CustomerProfile;
  policy: Policy;
  carrier?: Carrier;
  status: PolicyBillingStatus;
  premium: number;
};

const BILLING_FILTERS: Array<{ id: BillingFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "current", label: "Current" },
  { id: "due_soon", label: "Due Soon" },
  { id: "past_due", label: "Past Due" },
  { id: "direct_bill", label: "Direct Bill" },
  { id: "agency_bill", label: "Agency Bill" },
  { id: "premium_finance", label: "Premium Finance" },
  { id: "missing_info", label: "Missing Info" },
];

export function EmployeeBillingPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BillingFilter>("all");
  const [customFilter, setCustomFilter] = useState("");

  if (!agency || !user) return null;

  const visibleCustomers = api.customers.listVisible(agency.id, { id: user.id, role: user.role });
  const rows: PolicyBillingRow[] = visibleCustomers
    .flatMap((customer) =>
      api.policies.listByCustomer(customer.id).map((policy) => ({
        customer,
        policy,
        carrier: api.carriers.get(policy.carrierId),
        status: billingStatusFor(policy),
        premium: premiumFor(policy) ?? 0,
      }))
    )
    .sort((a, b) => {
      const statusDiff = billingStatusRank(a.status) - billingStatusRank(b.status);
      if (statusDiff !== 0) return statusDiff;
      return (a.policy.nextPaymentDueDate ?? a.policy.createdAt).localeCompare(
        b.policy.nextPaymentDueDate ?? b.policy.createdAt
      );
    });

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filter === "current") return row.status === "current" || row.status === "paid_in_full";
        if (filter === "due_soon") return row.status === "due_soon";
        if (filter === "past_due") return row.status === "past_due";
        if (filter === "direct_bill") return row.policy.billingMethod === "direct_bill";
        if (filter === "agency_bill") return row.policy.billingMethod === "agency_bill";
        if (filter === "premium_finance") return row.policy.billingMethod === "premium_finance";
        if (filter === "missing_info") return billingHasMissingInfo(row.policy);
        return true;
      })
      .filter((row) => {
        if (!q) return true;
        return policyBillingSearchParts(row).join(" ").toLowerCase().includes(q);
      })
      .filter((row) => {
        if (!customFilter.trim()) return true;
        return matchesAiCustomFilter(customFilter, {
          text: policyBillingSearchParts(row),
          flags: {
            active: row.policy.status === "bound" || row.status !== "paid_in_full",
            bound: row.policy.status === "bound",
            pending: row.status === "due_soon" || row.status === "past_due" || billingHasMissingInfo(row.policy),
            due: row.status === "due_soon" || row.status === "past_due",
            dueSoon: row.status === "due_soon",
            pastDue: row.status === "past_due",
            alert: row.status === "past_due" || billingHasMissingInfo(row.policy),
            missing: billingHasMissingInfo(row.policy),
            missingInfo: billingHasMissingInfo(row.policy),
            missingAccount: !row.policy.billingAccountNumber?.trim(),
            directBill: row.policy.billingMethod === "direct_bill",
            agencyBill: row.policy.billingMethod === "agency_bill",
            carrierAutopay: row.policy.billingMethod === "carrier_autopay",
            premiumFinance: row.policy.billingMethod === "premium_finance",
            mortgageeEscrow: row.policy.billingMethod === "mortgagee_escrow",
            personal: (row.policy.department ?? "personal") === "personal",
            commercial: row.policy.department === "commercial",
          },
          numbers: [
            row.premium,
            row.policy.finalPremium,
            row.policy.premiumEstimate,
            row.policy.nextPaymentAmount,
          ],
        });
      });
  }, [rows, filter, query, customFilter]);

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Billing</h1>
          <p className="text-ink-500 text-sm mt-1">
            One row per policy. Open the exact policy billing record you need to review.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, carrier, policy, account, billing method, premium, or status..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
        {BILLING_FILTERS.map((item) => (
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
          placeholder="ex: past due, direct bill, missing account, premium over 10k"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[18%]" />
            <col className="w-[15%]" />
            <col className="w-[18%]" />
            <col className="w-[11%]" />
            <col className="w-[15%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy</th>
              <th className="px-4 py-4">Carriers</th>
              <th className="px-4 py-4">Premium</th>
              <th className="px-4 py-4">How Paid</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filteredRows.map((row) => {
              const asset = api.assets.get(row.policy.assetId);
              return (
                <tr key={row.policy.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-5 align-middle">
                    <div className="break-words text-sm font-semibold leading-snug text-ink-900">{row.customer.name}</div>
                    <div className="truncate text-xs text-ink-500">{row.customer.email}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-mono text-sm font-semibold text-ink-900">{fmt.policyRef(row.policy)}</div>
                    <div className="truncate text-xs text-ink-500">
                      {asset?.label ?? "Asset not recorded"} - {api.helpers.departmentLabel(row.policy)}
                    </div>
                    <div className="text-xs text-ink-500">
                      {row.policy.nextPaymentDueDate ? `Next due ${fmt.date(row.policy.nextPaymentDueDate)}` : "No due date"}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="line-clamp-2">{row.carrier?.name ?? "Carrier missing"}</div>
                    {row.carrier && !billingCarrierUrl(row.carrier) && (
                      <div className="mt-1 text-xs text-alert">Missing portal</div>
                    )}
                  </td>
                  <td className="px-4 py-5 align-middle tabular-nums">
                    {row.premium ? fmt.money(row.premium) : "-"}
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-medium text-ink-900 line-clamp-1">{billingMethodLabel(row.policy.billingMethod)}</div>
                    <div className="text-xs text-ink-500 line-clamp-1">{billingFrequencyLabel(row.policy)}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <Badge tone={billingStatusTone(row.status)}>{BILLING_STATUS_LABEL[row.status]}</Badge>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="flex justify-end">
                      <Button size="xs" to={`/employee/billing/${row.policy.id}`}>
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-ink-400">
                  {query.trim() ? `No billing policies match "${query}".` : "No billing policies match this view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function premiumFor(policy: Policy): number | undefined {
  return policy.finalPremium ?? policy.premiumBreakdown?.total ?? policy.premiumEstimate;
}

function policyBillingSearchParts(row: PolicyBillingRow): string[] {
  const asset = api.assets.get(row.policy.assetId);
  return [
    row.customer.name,
    row.customer.email,
    row.customer.phone,
    row.carrier?.name,
    asset?.label,
    api.helpers.departmentLabel(row.policy),
    row.policy.policyNumber,
    row.policy.billingAccountNumber,
    row.policy.billingReference,
    row.policy.billingFinanceCompany,
    row.policy.billingMortgagee,
    row.policy.billingNotes,
    billingMethodLabel(row.policy.billingMethod),
    billingFrequencyLabel(row.policy),
    BILLING_STATUS_LABEL[billingStatusFor(row.policy)],
    fmt.policyRef(row.policy),
  ].filter(Boolean) as string[];
}
