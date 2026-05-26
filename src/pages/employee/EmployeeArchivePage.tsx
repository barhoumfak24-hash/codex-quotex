import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Eye, RotateCcw, Search, X } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { DetailGrid } from "@/components/analytics/MetricLists";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

// =====================================================================
// Archived prospects + clients.
//
// Soft-deleted rows live here. Default agent views (Prospects,
// Clients) filter these out via api.*.listByTenant default; this
// page surfaces them with an Unarchive button so a misclick is
// reversible.
// =====================================================================

type Tab = "prospects" | "clients";

export function EmployeeArchivePage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("prospects");
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<
    | { kind: "prospect"; id: string }
    | { kind: "client"; id: string }
    | null
  >(null);
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  if (!agency || !user) return null;
  const allProspects = api.prospects.listArchived(agency.id);
  // Agents only see archived clients that were assigned to them.
  // Managers see every archived client in the tenant.
  const isAgent = user.role === "agent";
  const allCustomers = api.customers
    .listArchived(agency.id)
    .filter((c) => !isAgent || c.assignedAgentId === user.id);

  const q = query.trim().toLowerCase();
  const prospects = useMemo(
    () =>
      !q
        ? allProspects
        : allProspects.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.email.toLowerCase().includes(q) ||
              p.status.replace(/_/g, " ").toLowerCase().includes(q)
          ),
    [allProspects, q]
  );
  const customers = useMemo(
    () =>
      !q
        ? allCustomers
        : allCustomers.filter(
            (c) =>
              c.name.toLowerCase().includes(q) ||
              c.email.toLowerCase().includes(q) ||
              (c.phone ?? "").toLowerCase().includes(q)
          ),
    [allCustomers, q]
  );

  return (
    <div className="space-y-6">
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
          onClick={() => setTab("prospects")}
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
          onClick={() => setTab("clients")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "clients"
              ? "border-gold-500 text-ink-900"
              : "border-transparent text-ink-500 hover:text-ink-800"
          }`}
        >
          Clients ({customers.length})
        </button>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-outline text-xs inline-flex"
                          onClick={() => setQuick({ kind: "prospect", id: p.id })}
                        >
                          <Eye className="h-3.5 w-3.5" /> Quick view
                        </button>
                        <button
                          type="button"
                          className="btn-outline text-xs inline-flex"
                          onClick={() => {
                            api.prospects.unarchive(p.id);
                            refresh();
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Unarchive
                        </button>
                      </div>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-outline text-xs inline-flex"
                          onClick={() => setQuick({ kind: "client", id: c.id })}
                        >
                          <Eye className="h-3.5 w-3.5" /> Quick view
                        </button>
                        <button
                          type="button"
                          className="btn-outline text-xs inline-flex"
                          onClick={() => {
                            api.customers.unarchive(c.id);
                            refresh();
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Unarchive
                        </button>
                      </div>
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

      <ArchiveQuickView quick={quick} onClose={() => setQuick(null)} />
    </div>
  );
}

// Lightweight basic-info popup for an archived prospect / client so a
// manager can sanity-check a record before restoring it, without
// leaving the archive.
function ArchiveQuickView({
  quick,
  onClose,
}: {
  quick: { kind: "prospect" | "client"; id: string } | null;
  onClose: () => void;
}) {
  if (!quick) return null;

  if (quick.kind === "prospect") {
    const p = api.prospects.get(quick.id);
    if (!p) return null;
    return (
      <Modal open onClose={onClose} title={p.name} size="md">
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
        <div className="mt-4 pt-3 border-t border-ink-100 flex justify-end">
          <Link to={`/employee/prospects/${p.id}`} className="btn-outline text-xs inline-flex">
            Open full profile
          </Link>
        </div>
      </Modal>
    );
  }

  const c = api.customers.get(quick.id);
  if (!c) return null;
  const policies = api.policies.listByCustomer(c.id);
  return (
    <Modal open onClose={onClose} title={c.name} size="md">
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
      <div className="mt-4 pt-3 border-t border-ink-100 flex justify-end">
        <Link to={`/employee/clients/${c.id}`} className="btn-outline text-xs inline-flex">
          Open full profile
        </Link>
      </div>
    </Modal>
  );
}