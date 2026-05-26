import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { PolicyActions } from "@/components/policies/PolicyActions";
import { Card } from "@/components/ui/Card";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { PolicyStatus } from "@/types";

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
];

export function EmployeePoliciesPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
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
    if (!q) return allPolicies;
    return allPolicies.filter((p) => {
      const customer = api.customers.get(p.customerId);
      const asset = api.assets.get(p.assetId);
      const carrier = api.carriers.get(p.carrierId);
      const haystack = [
        customer?.name,
        customer?.email,
        asset?.label,
        carrier?.name,
        p.policyNumber,
        p.status,
        fmt.titleCase(p.status.replace(/_/g, " ")),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allPolicies, query]);

  return (
    <div className="space-y-6">
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

      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Client</th>
              <th className="px-6 py-3">Asset</th>
              <th className="px-6 py-3">Carrier</th>
              <th className="px-6 py-3">Premium</th>
              <th className="px-6 py-3">Renewal</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Advance</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {policies.map((p) => {
              const customer = api.customers.get(p.customerId);
              const asset = api.assets.get(p.assetId);
              const carrier = api.carriers.get(p.carrierId);
              const pending = PENDING_STATES.includes(p.status);
              return (
                <tr key={p.id} className={pending ? "bg-alert-soft/60 hover:bg-alert-soft" : "hover:bg-ink-50/60"}>
                  <td className="px-6 py-4 font-medium">
                    <div className="flex items-center gap-1.5">
                      {pending && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-alert"
                          title="Pending agent action"
                        />
                      )}
                      {customer?.name ?? "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>{asset?.label ?? "—"}</div>
                    <div className="text-[11px] text-ink-400">{api.helpers.departmentLabel(p)}</div>
                  </td>
                  <td className="px-6 py-4">{carrier?.name ?? "—"}</td>
                  <td className="px-6 py-4">{p.finalPremium ? fmt.money(p.finalPremium) : p.premiumEstimate ? fmt.money(p.premiumEstimate) : "—"}</td>
                  <td className="px-6 py-4">{fmt.date(p.renewalDate)}</td>
                  <td className="px-6 py-4"><PolicyStatusBadge status={p.status} /></td>
                  <td className="px-6 py-4 text-right">
                    <select
                      className="input !py-1 !text-xs"
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
                  <td className="px-6 py-4">
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