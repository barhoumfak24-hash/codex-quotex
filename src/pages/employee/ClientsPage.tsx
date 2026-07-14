import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NewContactModal } from "@/components/contacts/NewContactModal";
import { ManagedByCell } from "@/components/contacts/ManagedByCell";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { aiAssetTypeAliases, matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { assetDisplayName } from "@/lib/assetDisplay";
import { fmt } from "@/lib/format";

type ClientFilter =
  | "all"
  | "my"
  | "active"
  | "personal"
  | "commercial"
  | "bound"
  | "renewals"
  | "claims"
  | "unassigned";

const CLIENT_FILTERS: Array<{ id: ClientFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "my", label: "My clients" },
  { id: "active", label: "Active" },
  { id: "personal", label: "Personal Lines" },
  { id: "commercial", label: "Commercial Lines" },
  { id: "bound", label: "Bound Policies" },
  { id: "renewals", label: "Renewals Due" },
  { id: "claims", label: "Claims" },
  { id: "unassigned", label: "Unassigned" },
];

export function ClientsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const nav = useNavigate();
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  if (!agency || !user) return null;

  const clientRows = api.customers.listVisible(agency.id, {
    id: user.id,
    role: user.role,
  }).map((customer) => {
    const policies = api.policies.listByCustomer(customer.id);
    const claims = api.claims.listByCustomer(customer.id);
    const assets = api.assets.listByCustomer(customer.id);
    const assignedAgent = customer.assignedAgentId ? api.users.get(customer.assignedAgentId) : undefined;
    const additionalAgents = (customer.additionalAgentIds ?? [])
      .map((id) => api.users.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const hasBoundPolicy = policies.some((policy) => policy.status === "bound");
    const hasPersonalLine =
      customer.lineOfBusiness === "personal" ||
      policies.some((policy) => (policy.department ?? "personal") === "personal");
    const hasCommercialLine =
      customer.lineOfBusiness === "commercial" ||
      policies.some((policy) => policy.department === "commercial");
    const hasUpcomingRenewal = policies.some(
      (policy) => policy.renewalStatus !== "not_due" || policy.status === "renewal_upcoming"
    );
    const hasOpenClaim = claims.some((claim) => claim.status !== "closed");
    const active = hasBoundPolicy || policies.length > 0;
    const primaryAsset = [...assets].sort((a, b) => b.estimatedValue - a.estimatedValue)[0];
    const portfolioValue = assets.reduce((sum, asset) => sum + asset.estimatedValue, 0);
    const latestStatus = api.status.listFor({ customerId: customer.id })[0];
    const latestCommunication = api.communications.listByCustomer(customer.id)[0];
    const latestAction = [
      latestStatus
        ? {
            label: latestStatus.message,
            at: latestStatus.createdAt,
          }
        : null,
      latestCommunication
        ? {
            label:
              latestCommunication.subject ||
              latestCommunication.body ||
              `${fmt.titleCase(latestCommunication.direction)} ${latestCommunication.channel}`,
            at: latestCommunication.createdAt,
          }
        : null,
    ]
      .filter((item): item is { label: string; at: string } => Boolean(item))
      .sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? {
      label: "Client added to book",
      at: customer.createdAt,
    };
    const marketingStatus = customer.marketingOptInEmail || customer.marketingOptInSms ? "Active" : "Opted out";
    const statusLabel = hasOpenClaim
      ? "Claim open"
      : hasUpcomingRenewal
      ? "Renewal due"
      : hasBoundPolicy
      ? "Bound"
      : policies.length > 0
      ? "In progress"
      : "New";
    return {
      customer,
      policies,
      claims,
      assets,
      primaryAsset,
      portfolioValue,
      latestAction,
      marketingStatus,
      statusLabel,
      assignedAgent,
      additionalAgents,
      active,
      hasPersonalLine,
      hasCommercialLine,
      hasBoundPolicy,
      hasUpcomingRenewal,
      hasOpenClaim,
    };
  });

  const filteredRows = clientRows
    .filter((row) => {
      if (filter === "my") {
        return (
          row.customer.assignedAgentId === user.id ||
          (row.customer.additionalAgentIds ?? []).includes(user.id) ||
          row.customer.assignedCsrId === user.id ||
          (row.customer.additionalCsrIds ?? []).includes(user.id)
        );
      }
      if (filter === "active") return row.active;
      if (filter === "personal") return row.hasPersonalLine;
      if (filter === "commercial") return row.hasCommercialLine;
      if (filter === "bound") return row.hasBoundPolicy;
      if (filter === "renewals") return row.hasUpcomingRenewal;
      if (filter === "claims") return row.hasOpenClaim;
      if (filter === "unassigned") {
        return (
          !row.customer.assignedAgentId &&
            !(row.customer.additionalAgentIds ?? []).length &&
            !row.customer.assignedCsrId &&
            !(row.customer.additionalCsrIds ?? []).length
        );
      }
      return true;
    })
    .filter((row) => {
      if (!customFilter.trim()) return true;
      return matchesAiCustomFilter(customFilter, {
        text: [
          row.customer.name,
          row.customer.businessName,
          row.customer.lineOfBusiness,
          row.customer.email,
          row.customer.phone,
          row.customer.mailingAddress,
          row.customer.garagingAddress,
          row.primaryAsset ? assetDisplayName(row.primaryAsset) : undefined,
          row.primaryAsset ? api.helpers.assetTypeLabel(row.primaryAsset.type) : undefined,
          row.latestAction.label,
          row.marketingStatus,
          row.statusLabel,
          row.assignedAgent?.name,
          row.customer.assignedCsrId ? api.users.get(row.customer.assignedCsrId)?.name : undefined,
          ...(row.customer.additionalCsrIds ?? []).map((id) => api.users.get(id)?.name),
          ...row.additionalAgents.map((agent) => agent.name),
          ...row.assets.flatMap((asset) => [
            assetDisplayName(asset),
            asset.type,
            api.helpers.assetTypeLabel(asset.type),
            asset.status,
            ...aiAssetTypeAliases(asset.type),
            String(asset.estimatedValue),
          ]),
          ...row.policies.flatMap((policy) => {
            const carrier = api.carriers.get(policy.carrierId);
            const asset = api.assets.get(policy.assetId);
            return [
              policy.policyNumber,
              policy.status,
              fmt.titleCase(policy.status.replace(/_/g, " ")),
              policy.renewalStatus,
              carrier?.name,
              asset ? assetDisplayName(asset) : undefined,
            ];
          }),
          ...row.claims.map((claim) => claim.status),
        ],
        flags: {
          active: row.active,
          inactive: !row.active,
          assigned: Boolean(
            row.customer.assignedAgentId ||
              (row.customer.additionalAgentIds ?? []).length ||
              row.customer.assignedCsrId ||
              (row.customer.additionalCsrIds ?? []).length
          ),
          unassigned:
            !row.customer.assignedAgentId &&
            !(row.customer.additionalAgentIds ?? []).length &&
            !row.customer.assignedCsrId &&
            !(row.customer.additionalCsrIds ?? []).length,
          bound: row.hasBoundPolicy,
          renewal: row.hasUpcomingRenewal,
          claim: row.claims.length > 0,
          openClaim: row.hasOpenClaim,
          closedClaim: row.claims.some((claim) => claim.status === "closed"),
          noPolicies: row.policies.length === 0,
          emailOptIn: row.customer.marketingOptInEmail,
          smsOptIn: row.customer.marketingOptInSms,
          new: Date.now() - new Date(row.customer.createdAt).getTime() <= 30 * 24 * 60 * 60 * 1000,
          personal: row.hasPersonalLine,
          commercial: row.hasCommercialLine,
        },
        numbers: [
          ...row.assets.map((asset) => asset.estimatedValue),
          ...row.policies.map((policy) => policy.finalPremium ?? policy.premiumEstimate),
        ],
      });
    })
    .filter((row) => {
      const term = q.trim().toLowerCase();
      if (!term) return true;
      return (
        row.customer.name.toLowerCase().includes(term) ||
        (row.customer.businessName ?? "").toLowerCase().includes(term) ||
        row.customer.email.toLowerCase().includes(term) ||
        (row.customer.phone ?? "").toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      const aLabel =
        a.customer.lineOfBusiness === "commercial" && a.customer.businessName
          ? a.customer.businessName
          : a.customer.name;
      const bLabel =
        b.customer.lineOfBusiness === "commercial" && b.customer.businessName
          ? b.customer.businessName
          : b.customer.name;
      return aLabel.localeCompare(bLabel);
    });

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl">Clients</h1>
          <p className="mt-1 max-w-xl text-sm text-ink-500">Active client book for {agency.name}.</p>
        </div>
        <button type="button" className="btn-gold" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New client
        </button>
      </div>

      <NewContactModal
        kind="client"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          refresh();
          nav(`/employee/clients/${id}`);
        }}
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search clients"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CLIENT_FILTERS.map((item) => (
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
          placeholder="ex: open claims, unassigned, Olivia, yacht over 1m"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[19%]" />
              <col className="w-[22%]" />
              <col className="w-[16%]" />
              <col className="w-[8%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[11%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
                <th className="px-4 py-4">Name</th>
                <th className="px-4 py-4">Email</th>
                <th className="px-4 py-4">Phone</th>
                <th className="px-4 py-4">Policies</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Managed by</th>
                <th className="px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filteredRows.map((row) => (
                <tr key={row.customer.id} className="hover:bg-ink-50/60">
                  <td className="px-4 py-5 align-middle">
                    {row.customer.lineOfBusiness === "commercial" && row.customer.businessName ? (
                      <>
                        <div className="break-words text-sm font-semibold leading-snug text-ink-900">
                          {row.customer.businessName}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-500">{row.customer.name}</div>
                      </>
                    ) : (
                      <>
                        <div className="break-words text-sm font-semibold leading-snug text-ink-900">
                          {row.customer.name}
                        </div>
                        {row.customer.businessName && (
                          <div className="mt-0.5 truncate text-xs text-ink-500">{row.customer.businessName}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="truncate text-sm text-ink-700">{row.customer.email}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="truncate text-sm text-ink-700">{row.customer.phone ?? "-"}</div>
                  </td>
                  <td className="px-4 py-5 align-middle text-sm tabular-nums">{row.policies.length}</td>
                  <td className="px-4 py-5 align-middle">
                    <Badge tone={row.hasOpenClaim ? "error" : row.hasUpcomingRenewal ? "warn" : row.hasBoundPolicy ? "success" : "neutral"}>
                      {row.statusLabel}
                    </Badge>
                  </td>
                  <td className="px-4 py-5 align-middle text-sm">
                    <ManagedByCell
                      assignedAgentId={row.customer.assignedAgentId}
                      additionalAgentIds={row.customer.additionalAgentIds}
                      assignedCsrId={row.customer.assignedCsrId}
                    />
                  </td>
                  <td className="px-4 py-5 align-middle text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        to={`/employee/clients/${row.customer.id}`}
                        size="xs"
                      >
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-sm text-ink-400">
                    No clients match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
