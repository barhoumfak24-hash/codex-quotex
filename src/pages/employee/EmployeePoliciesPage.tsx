import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { PolicyActions } from "@/components/policies/PolicyActions";
import { Card } from "@/components/ui/Card";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt } from "@/lib/format";
import type { PolicyStatus } from "@/types";

type PolicyFilter = "all" | "bound" | "pending" | "renewals" | "claims" | "personal" | "commercial" | "declined";

const POLICY_FILTERS: Array<{ id: PolicyFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "bound", label: "Bound" },
  { id: "pending", label: "Pending" },
  { id: "renewals", label: "Renewals" },
  { id: "claims", label: "Claims" },
  { id: "personal", label: "Personal" },
  { id: "commercial", label: "Commercial" },
  { id: "declined", label: "Declined" },
];

// Policies in any of these stages drive the red Policies sidebar
// badge — they're waiting on agent action.
const PENDING_STATES: PolicyStatus[] = [
  "submitted_to_agent",
  "under_agent_review",
  "submitted_to_carrier",
  "carrier_reviewing",
  "documents_needed",
];
const ALL_STATUSES: PolicyStatus[] = [
  "quote_started",
  "documents_needed",
  "submitted_to_agent",
  "under_agent_review",
  "submitted_to_carrier",
  "carrier_reviewing",
  "approved",
  "bound",
  "declined",
  "deposit_paid",
  "deposit_refunded",
  "renewal_upcoming",
  "renewed",
  "claim_opened",
  "claim_closed",
  "closed",
];

export function EmployeePoliciesPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [policyFilter, setPolicyFilter] = useState<PolicyFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  if (!agency || !user) return null;
  const visibleIds = new Set(
    api.customers
      .listVisible(agency.id, { id: user.id, role: user.role })
      .map((c) => c.id)
  );
  // Pinned: pending-action rows go to the top so the agent can see
  // exactly which policies are producing the sidebar alert. Agents
  // only see policies for clients assigned to them.
  const allPolicies = [...api.policies.listByTenant(agency.id)]
    .filter((p) => visibleIds.has(p.customerId))
    .sort((a, b) => {
      const ra = PENDING_STATES.includes(a.status) ? 0 : 1;
      const rb = PENDING_STATES.includes(b.status) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

  // Search across client name, asset label, carrier name, policy
  // number, and status — case-insensitive substring.
  const policies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filteredByChip = allPolicies.filter((p) => {
      if (policyFilter === "bound") return p.status === "bound";
      if (policyFilter === "pending") return PENDING_STATES.includes(p.status);
      if (policyFilter === "renewals") return p.renewalStatus !== "not_due" || p.status === "renewal_upcoming";
      if (policyFilter === "claims") return p.status === "claim_opened" || p.status === "claim_closed";
      if (policyFilter === "personal") return (p.department ?? "personal") === "personal";
      if (policyFilter === "commercial") return p.department === "commercial";
      if (policyFilter === "declined") return p.status === "declined";
      return true;
    });
    const searched = q
      ? filteredByChip.filter((p) => {
      const customer = api.customers.get(p.customerId);
      const asset = api.assets.get(p.assetId);
      const carrier = api.carriers.get(p.carrierId);
      const haystack = [
        customer?.name,
        customer?.email,
        asset ? assetDisplayName(asset) : undefined,
        carrier?.name,
        p.policyNumber,
        fmt.policyRef(p),
        p.status,
        fmt.titleCase(p.status.replace(/_/g, " ")),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    })
      : filteredByChip;
    if (!customFilter.trim()) return searched;
    return searched.filter((p) => {
      const customer = api.customers.get(p.customerId);
      const asset = api.assets.get(p.assetId);
      const carrier = api.carriers.get(p.carrierId);
      return matchesAiCustomFilter(customFilter, {
        text: [
          customer?.name,
          customer?.email,
          asset ? assetDisplayName(asset) : undefined,
          asset?.type,
          asset ? api.helpers.assetTypeLabel(asset.type) : undefined,
          carrier?.name,
          p.policyNumber,
          fmt.policyRef(p),
          p.status,
          fmt.titleCase(p.status.replace(/_/g, " ")),
          p.renewalStatus,
          api.helpers.departmentLabel(p),
        ],
        flags: {
          active: p.status === "bound" || PENDING_STATES.includes(p.status),
          bound: p.status === "bound",
          renewal: p.renewalStatus !== "not_due" || p.status === "renewal_upcoming",
          claim: p.status === "claim_opened" || p.status === "claim_closed",
          openClaim: p.status === "claim_opened",
          closedClaim: p.status === "claim_closed",
          pending: PENDING_STATES.includes(p.status),
          quote: p.status === "quote_started",
          approved: p.status === "approved",
          declined: p.status === "declined",
          personal: (p.department ?? "personal") === "personal",
          commercial: p.department === "commercial",
        },
        numbers: [p.finalPremium, p.premiumEstimate],
      });
    });
  }, [allPolicies, policyFilter, query, customFilter]);

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Policies</h1>
          <p className="text-ink-500 text-sm mt-1">All policies in {agency.name}.</p>
        </div>
        <button type="button" className="btn-gold" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add policy
        </button>
      </div>
      <AddPolicyModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={refresh} />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, asset, carrier, policy number, or status…"
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
        {POLICY_FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setPolicyFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              policyFilter === item.id
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
          placeholder="ex: pending, Chubb, renewal, commercial, premium over 5k"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[12%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy</th>
              <th className="px-4 py-4">Carrier</th>
              <th className="px-4 py-4">Premium</th>
              <th className="px-4 py-4">Renewal</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4 text-right">Advance</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {policies.map((p) => {
              const customer = api.customers.get(p.customerId);
              const asset = api.assets.get(p.assetId);
              const carrier = api.carriers.get(p.carrierId);
              return (
                <tr key={p.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-5 align-middle">
                    <div className="flex items-center gap-1.5 break-words text-sm font-semibold leading-snug text-ink-900">
                      {customer?.name ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-mono text-sm font-semibold text-ink-900">{fmt.policyRef(p)}</div>
                    <div className="line-clamp-2">{asset ? assetDisplayName(asset) : "—"}</div>
                    <div className="text-[11px] text-ink-400">{api.helpers.departmentLabel(p)}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="line-clamp-2">{carrier?.name ?? "—"}</div>
                  </td>
                  <td className="px-4 py-5 align-middle tabular-nums">{p.finalPremium ? fmt.money(p.finalPremium) : p.premiumEstimate ? fmt.money(p.premiumEstimate) : "—"}</td>
                  <td className="px-4 py-5 align-middle">{fmt.date(p.renewalDate)}</td>
                  <td className="px-4 py-5 align-middle"><PolicyStatusBadge status={p.status} /></td>
                  <td className="px-4 py-5 align-middle text-right">
                    <select
                      className="input !w-full !py-1 !text-xs"
                      value={p.status}
                      onChange={(e) => {
                        api.policies.setStatus(p.id, e.target.value as PolicyStatus);
                        refresh();
                      }}
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {fmt.titleCase(s.replace(/_/g, " "))}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <PolicyActions policy={p} size="xs" />
                  </td>
                </tr>
              );
            })}
            {policies.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-ink-400 text-sm">
                  {query.trim()
                    ? `No policies match "${query}".`
                    : "No policies."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
