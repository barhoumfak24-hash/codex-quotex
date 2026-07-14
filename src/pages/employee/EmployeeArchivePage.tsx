import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, RotateCcw, Search, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { DetailGrid } from "@/components/analytics/MetricLists";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { aiAssetTypeAliases, matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt } from "@/lib/format";
import type { CustomerProfile, Prospect } from "@/types";

// =====================================================================
// Archived prospects + clients.
//
// Soft-deleted rows live here. Default agent views (Prospects,
// Clients) filter these out via api.*.listByTenant default; this
// page surfaces them with an Unarchive button so a misclick is
// reversible.
// =====================================================================

type Tab = "prospects" | "clients";
type ArchiveFilter =
  | "all"
  | "recent"
  | "assigned"
  | "unassigned"
  | "high_value"
  | "new"
  | "abandoned"
  | "nurturing"
  | "converted"
  | "lost"
  | "bound"
  | "renewals"
  | "claims"
  | "no_policies";

const PROSPECT_FILTERS: Array<{ id: ArchiveFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recently Archived" },
  { id: "new", label: "New" },
  { id: "abandoned", label: "Abandoned" },
  { id: "nurturing", label: "Nurturing" },
  { id: "converted", label: "Converted" },
  { id: "lost", label: "Lost" },
  { id: "unassigned", label: "Unassigned" },
  { id: "high_value", label: "High Value" },
];

const CLIENT_FILTERS: Array<{ id: ArchiveFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recently Archived" },
  { id: "bound", label: "Bound Policies" },
  { id: "renewals", label: "Renewals Due" },
  { id: "claims", label: "Open Claims" },
  { id: "no_policies", label: "No Policies" },
  { id: "unassigned", label: "Unassigned" },
  { id: "high_value", label: "High Value" },
];

export function EmployeeArchivePage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("prospects");
  const [query, setQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [quick, setQuick] = useState<
    | { kind: "prospect"; id: string }
    | { kind: "client"; id: string }
    | null
  >(null);
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  if (!agency || !user) return null;
  const allProspects = api.prospects
    .listArchived(agency.id)
    .filter((p) => api.prospects.canSee(p, user));
  const allCustomers = api.customers
    .listArchived(agency.id)
    .filter((c) => api.customers.canSee(c, user));

  const q = query.trim().toLowerCase();
  const prospects = useMemo(() => {
    return allProspects
      .filter((p) => !q || prospectSearchText(p).includes(q))
      .filter((p) => matchesArchiveProspectFilter(p, archiveFilter))
      .filter((p) => !customFilter.trim() || matchesAiCustomFilter(customFilter, prospectArchiveSubject(p)));
  }, [allProspects, q, archiveFilter, customFilter]);
  const customers = useMemo(() => {
    return allCustomers
      .filter((c) => !q || customerSearchText(c).includes(q))
      .filter((c) => matchesArchiveCustomerFilter(c, archiveFilter, agency.id))
      .filter((c) => !customFilter.trim() || matchesAiCustomFilter(customFilter, customerArchiveSubject(c, agency.id)));
  }, [allCustomers, q, archiveFilter, customFilter, agency.id]);

  const activeFilterSet = tab === "prospects" ? PROSPECT_FILTERS : CLIENT_FILTERS;

  function switchTab(next: Tab) {
    setTab(next);
    setArchiveFilter("all");
    setCustomFilter("");
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div>
        <h1 className="font-display text-3xl">Archive</h1>
        <p className="text-ink-500 text-sm mt-1">
          Prospects and clients you've archived. Search, quick-view the basics, or restore any
          row with one click.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search archived prospects & clients by name, email…"
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

      <div className="flex items-center gap-1 border-b border-ink-100">
        <button
          type="button"
          onClick={() => switchTab("prospects")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "prospects"
              ? "border-gold-500 text-ink-900"
              : "border-transparent text-ink-500 hover:text-ink-800"
          }`}
        >
          Prospects ({prospects.length})
        </button>
        <button
          type="button"
          onClick={() => switchTab("clients")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "clients"
              ? "border-gold-500 text-ink-900"
              : "border-transparent text-ink-500 hover:text-ink-800"
          }`}
        >
          Clients ({customers.length})
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {activeFilterSet.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setArchiveFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              archiveFilter === item.id
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
          label="AI Custom"
          placeholder={
            tab === "prospects"
              ? "ex: lost, unassigned, coastal, high value, nurturing"
              : "ex: open claims, no policies, renewals, Chubb, high value"
          }
        />
      </div>

      {tab === "prospects" ? (
        <Card padded={false}>
          {prospects.length === 0 ? (
            <div className="p-10">
              <EmptyState
                title="No archived prospects"
                description="Archived rows appear here. They no longer count toward the Prospects badge or show in the main list."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Status at archive</th>
                  <th className="px-6 py-3">Archived</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {prospects.map((p) => (
                  <tr key={p.id}>
                    <td className="px-6 py-3 font-medium">
                      <Link to={`/employee/prospects/${p.id}`} className="hover:text-gold-700">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-ink-700">{p.email}</td>
                    <td className="px-6 py-3 capitalize text-ink-700">
                      {p.status.replace(/_/g, " ")}
                    </td>
                    <td className="px-6 py-3 text-ink-500 text-xs">
                      {p.archivedAt ? fmt.relative(p.archivedAt) : "—"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        className="btn-outline text-xs inline-flex"
                        onClick={() => setQuick({ kind: "prospect", id: p.id })}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card padded={false}>
          {customers.length === 0 ? (
            <div className="p-10">
              <EmptyState
                title="No archived clients"
                description="Archived rows appear here. Their portal access is unaffected — archive is a staff-side filter only."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Phone</th>
                  <th className="px-6 py-3">Archived</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-3 font-medium">
                      <Link to={`/employee/clients/${c.id}`} className="hover:text-gold-700">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-ink-700">{c.email}</td>
                    <td className="px-6 py-3 text-ink-700">{c.phone ?? "—"}</td>
                    <td className="px-6 py-3 text-ink-500 text-xs">
                      {c.archivedAt ? fmt.relative(c.archivedAt) : "—"}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        className="btn-outline text-xs inline-flex"
                        onClick={() => setQuick({ kind: "client", id: c.id })}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <div className="text-[11px] text-ink-400 flex items-center gap-1.5">
        <Archive className="h-3 w-3" />
        Archive is a soft delete — nothing is permanently removed. Restore anytime.
      </div>

      <ArchiveQuickView
        quick={quick}
        onClose={() => setQuick(null)}
        onRestored={() => {
          setQuick(null);
          refresh();
        }}
      />
    </div>
  );
}

function prospectSearchText(p: Prospect): string {
  return [
    p.name,
    p.email,
    p.phone,
    p.status,
    p.status.replace(/_/g, " "),
    p.marketingStatus,
    p.assetType,
    api.helpers.assetTypeLabel(p.assetType),
    ...aiAssetTypeAliases(p.assetType),
    p.aiSummary,
    p.lastAction,
    p.recommendedFollowUp,
    ...contactOwnerNames(p),
    hasContactOwner(p) ? "" : "unassigned",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function customerSearchText(c: CustomerProfile): string {
  const policies = api.policies.listByCustomer(c.id);
  const assets = api.assets.listByCustomer(c.id);
  const claims = api.claims.listByCustomer(c.id);
  return [
    c.name,
    c.email,
    c.phone,
    c.clientCode,
    c.mailingAddress,
    c.garagingAddress,
    ...contactOwnerNames(c),
    hasContactOwner(c) ? "" : "unassigned",
    ...assets.flatMap((a) => [assetDisplayName(a), a.type, api.helpers.assetTypeLabel(a.type), ...aiAssetTypeAliases(a.type)]),
    ...policies.flatMap((p) => [
      p.policyNumber,
      fmt.policyRef(p),
      p.status,
      p.renewalStatus,
      api.helpers.departmentLabel(p),
      api.carriers.get(p.carrierId)?.name,
    ]),
    ...claims.map((claim) => claim.status),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesArchiveProspectFilter(p: Prospect, filter: ArchiveFilter): boolean {
  if (filter === "all") return true;
  if (filter === "recent") return wasArchivedRecently(p.archivedAt);
  if (filter === "assigned") return hasContactOwner(p);
  if (filter === "unassigned") return !hasContactOwner(p);
  if (filter === "high_value") return Number(p.estimatedValue ?? 0) >= 1_000_000;
  if (
    filter === "new" ||
    filter === "abandoned" ||
    filter === "nurturing" ||
    filter === "converted" ||
    filter === "lost"
  ) {
    return p.status === filter;
  }
  return true;
}

function matchesArchiveCustomerFilter(
  c: CustomerProfile,
  filter: ArchiveFilter,
  tenantId: string
): boolean {
  const policies = api.policies.listByCustomer(c.id);
  const assets = api.assets.listByCustomer(c.id);
  const claims = api.claims.listByCustomer(c.id);
  if (filter === "all") return true;
  if (filter === "recent") return wasArchivedRecently(c.archivedAt);
  if (filter === "assigned") return hasContactOwner(c);
  if (filter === "unassigned") return !hasContactOwner(c);
  if (filter === "high_value") {
    return assets.some((a) => Number(a.estimatedValue ?? 0) >= 1_000_000);
  }
  if (filter === "bound") return policies.some((p) => p.status === "bound");
  if (filter === "claims") return claims.some((claim) => claim.status !== "closed");
  if (filter === "no_policies") return policies.length === 0;
  if (filter === "renewals") {
    const policyIds = new Set(policies.map((p) => p.id));
    return api.renewals
      .listByTenant(tenantId)
      .some((r) => r.status === "upcoming" && policyIds.has(r.policyId));
  }
  return true;
}

function prospectArchiveSubject(p: Prospect) {
  return {
    text: [
      p.name,
      p.email,
      p.phone,
      p.status,
      p.marketingStatus,
      p.assetType,
      api.helpers.assetTypeLabel(p.assetType),
      ...aiAssetTypeAliases(p.assetType),
      p.aiSummary,
      p.lastAction,
      p.recommendedFollowUp,
      ...contactOwnerNames(p),
      hasContactOwner(p) ? "" : "unassigned",
    ],
    flags: {
      active: p.status !== "lost" && p.status !== "converted",
      new: p.status === "new",
      contacted: p.status === "contacted",
      quote: p.status === "quote_in_progress",
      abandoned: p.status === "abandoned",
      nurturing: p.status === "nurturing",
      converted: p.status === "converted",
      lost: p.status === "lost",
      assigned: hasContactOwner(p),
      unassigned: !hasContactOwner(p),
      optedOut: p.marketingStatus === "opted_out",
    },
    numbers: [p.estimatedValue],
  };
}

function customerArchiveSubject(c: CustomerProfile, tenantId: string) {
  const policies = api.policies.listByCustomer(c.id);
  const assets = api.assets.listByCustomer(c.id);
  const claims = api.claims.listByCustomer(c.id);
  const upcomingPolicyIds = new Set(
    api.renewals
      .listByTenant(tenantId)
      .filter((r) => r.status === "upcoming")
      .map((r) => r.policyId)
  );
  return {
    text: [
      c.name,
      c.email,
      c.phone,
      c.clientCode,
      c.mailingAddress,
      c.garagingAddress,
      ...contactOwnerNames(c),
      hasContactOwner(c) ? "" : "unassigned",
      ...assets.flatMap((a) => [assetDisplayName(a), a.type, api.helpers.assetTypeLabel(a.type), ...aiAssetTypeAliases(a.type)]),
      ...policies.flatMap((p) => [
        p.policyNumber,
        fmt.policyRef(p),
        p.status,
        p.renewalStatus,
        api.helpers.departmentLabel(p),
        api.carriers.get(p.carrierId)?.name,
      ]),
      ...claims.map((claim) => claim.status),
    ],
    flags: {
      active: policies.some((p) => p.status === "bound" || p.status === "approved"),
      assigned: hasContactOwner(c),
      unassigned: !hasContactOwner(c),
      bound: policies.some((p) => p.status === "bound"),
      renewal: policies.some((p) => upcomingPolicyIds.has(p.id)),
      claim: claims.length > 0,
      openClaim: claims.some((claim) => claim.status !== "closed"),
      closedClaim: claims.some((claim) => claim.status === "closed"),
      noPolicies: policies.length === 0,
      emailOptIn: c.marketingOptInEmail,
      smsOptIn: c.marketingOptInSms,
      personal: policies.some((p) => (p.department ?? "personal") === "personal"),
      commercial: policies.some((p) => p.department === "commercial"),
    },
    numbers: [
      ...assets.map((a) => a.estimatedValue),
      ...policies.map((p) => p.finalPremium ?? p.premiumEstimate),
    ],
  };
}

function wasArchivedRecently(archivedAt?: string): boolean {
  if (!archivedAt) return false;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return new Date(archivedAt).getTime() >= Date.now() - thirtyDays;
}

function contactOwnerIds(row: Prospect | CustomerProfile): string[] {
  return [
    row.assignedAgentId,
    ...(row.additionalAgentIds ?? []),
    row.assignedCsrId,
  ].filter(Boolean) as string[];
}

function hasContactOwner(row: Prospect | CustomerProfile): boolean {
  return contactOwnerIds(row).length > 0;
}

function contactOwnerNames(row: Prospect | CustomerProfile): string[] {
  return contactOwnerIds(row)
    .map((id) => api.users.get(id)?.name)
    .filter(Boolean) as string[];
}

// Lightweight basic-info popup for an archived prospect / client so a
// manager can sanity-check a record before restoring it, without
// leaving the archive.
function ArchiveQuickView({
  quick,
  onClose,
  onRestored,
}: {
  quick: { kind: "prospect" | "client"; id: string } | null;
  onClose: () => void;
  onRestored: () => void;
}) {
  if (!quick) return null;

  if (quick.kind === "prospect") {
    const p = api.prospects.get(quick.id);
    if (!p) return null;
    return (
      <Modal open onClose={onClose} title={p.name} size="md">
        <div className="mb-4 flex flex-wrap justify-end gap-2 border-b border-ink-100 pb-3">
          <button
            type="button"
            className="btn-outline text-xs inline-flex"
            onClick={() => {
              api.prospects.unarchive(p.id);
              onRestored();
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Unarchive
          </button>
          <Link to={`/employee/prospects/${p.id}`} className="btn-outline text-xs inline-flex">
            Open full profile
          </Link>
        </div>
        <DetailGrid
          rows={[
            { label: "Email", value: p.email },
            { label: "Phone", value: p.phone ?? "—" },
            { label: "Interest", value: api.helpers.assetTypeLabel(p.assetType) },
            {
              label: "Estimated value",
              value: p.estimatedValue ? fmt.money(p.estimatedValue) : "—",
            },
            { label: "Status at archive", value: fmt.titleCase(p.status.replace(/_/g, " ")) },
            { label: "Marketing", value: p.marketingStatus },
            {
              label: "Managed by",
              value: p.assignedAgentId
                ? api.users.get(p.assignedAgentId)?.name ?? "—"
                : "Unassigned",
            },
            { label: "Archived", value: p.archivedAt ? fmt.dateTime(p.archivedAt) : "—" },
            { label: "AI summary", value: p.aiSummary },
          ]}
        />
      </Modal>
    );
  }

  const c = api.customers.get(quick.id);
  if (!c) return null;
  const policies = api.policies.listByCustomer(c.id);
  return (
    <Modal open onClose={onClose} title={c.name} size="md">
      <div className="mb-4 flex flex-wrap justify-end gap-2 border-b border-ink-100 pb-3">
        <button
          type="button"
          className="btn-outline text-xs inline-flex"
          onClick={() => {
            api.customers.unarchive(c.id);
            onRestored();
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Unarchive
        </button>
        <Link to={`/employee/clients/${c.id}`} className="btn-outline text-xs inline-flex">
          Open full profile
        </Link>
      </div>
      <DetailGrid
        rows={[
          { label: "Client code", value: api.helpers.clientCodeFor(c) },
          { label: "Email", value: c.email },
          { label: "Phone", value: c.phone ?? "—" },
          { label: "Mailing address", value: c.mailingAddress ?? "—" },
          { label: "Garaging address", value: c.garagingAddress ?? "—" },
          { label: "Joined", value: fmt.date(c.createdAt) },
          { label: "Policies", value: policies.length },
          {
            label: "Managed by",
            value: c.assignedAgentId
              ? api.users.get(c.assignedAgentId)?.name ?? "—"
              : "Unassigned",
          },
          { label: "Archived", value: c.archivedAt ? fmt.dateTime(c.archivedAt) : "—" },
        ]}
      />
    </Modal>
  );
}
