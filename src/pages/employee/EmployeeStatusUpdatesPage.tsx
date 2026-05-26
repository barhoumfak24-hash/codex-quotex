import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { StatusEventSource } from "@/types";

// =====================================================================
// Full status-update audit log for the agency.
//
// Shows every status event tied to this tenant, newest first, with
// full timestamps (not the truncated "5m ago" relative view used on
// the dashboard mini-timeline). Filters live at the top:
//
//   - Source       (customer / agent / ai / system)
//   - Visibility   (all / customer-visible / internal)
//   - Client       (dropdown of all customers in this tenant)
//   - Free-text    (matches the event message OR the customer name)
//
// Designed for the agent / manager who needs to scroll back through
// every interaction on a file, including renewal reminders, file
// uploads, emails, SMS, claim inquiries, and manual notes.
// =====================================================================

const SOURCES: { value: StatusEventSource | "all"; label: string }[] = [
  { value: "all", label: "All sources" },
  { value: "customer", label: "Customer" },
  { value: "agent", label: "Agent" },
  { value: "ai", label: "AI" },
  { value: "system", label: "System" },
];

type VisibilityFilter = "all" | "customer_visible" | "internal";

export function EmployeeStatusUpdatesPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [source, setSource] = useState<StatusEventSource | "all">("all");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");
  // Filter value encodes the kind so we can disambiguate ids that
  // could theoretically collide between tables. "all" | "c:<id>" |
  // "p:<id>" — and a special "p:any" to mean "any prospect".
  const [contact, setContact] = useState<string>("all");
  const [query, setQuery] = useState("");
  if (!agency || !user) return null;

  const customers = api.customers.listVisible(agency.id, { id: user.id, role: user.role });
  const visibleIds = new Set(customers.map((c) => c.id));
  // Agents only see status events tied to their assigned clients
  // (events with no customerId are tenant-scoped and stay visible).
  const all = api.status
    .listByTenant(agency.id)
    .filter((e) => !e.customerId || visibleIds.has(e.customerId));
  const prospects = api.prospects.listByTenant(agency.id);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const prospectById = new Map(prospects.map((p) => [p.id, p]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (source !== "all" && e.source !== source) return false;
      if (visibility !== "all" && e.visibility !== visibility) return false;
      if (contact !== "all") {
        if (contact === "c:any" && !e.customerId) return false;
        else if (contact === "p:any" && !e.prospectId) return false;
        else if (contact.startsWith("c:") && e.customerId !== contact.slice(2)) return false;
        else if (contact.startsWith("p:") && contact !== "p:any" && e.prospectId !== contact.slice(2))
          return false;
      }
      if (q) {
        const cName = e.customerId
          ? (customerById.get(e.customerId)?.name ?? "").toLowerCase()
          : "";
        const pName = e.prospectId
          ? (prospectById.get(e.prospectId)?.name ?? "").toLowerCase()
          : "";
        if (
          !e.message.toLowerCase().includes(q) &&
          !cName.includes(q) &&
          !pName.includes(q)
        )
          return false;
      }
      return true;
    });
  }, [all, source, visibility, contact, query, customerById, prospectById]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">All status updates</h1>
          <p className="text-ink-500 text-sm mt-1">
            Every renewal reminder, file upload, email/SMS, claim inquiry, and manual note across
            the agency. Permanent + timestamped.
          </p>
        </div>
        <div className="text-sm text-ink-500 font-mono">
          {filtered.length} of {all.length}
        </div>
      </div>

      <Card>
        <CardHeader title="Filters" subtitle="Narrow down by source, visibility, client, or text." />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Visibility</label>
            <select
              className="input"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as VisibilityFilter)}
            >
              <option value="all">All</option>
              <option value="customer_visible">Customer-visible</option>
              <option value="internal">Internal</option>
            </select>
          </div>
          <div>
            <label className="label">Client / Prospect</label>
            <select
              className="input"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
            >
              <option value="all">All clients + prospects</option>
              <option value="c:any">— Any client —</option>
              <option value="p:any">— Any prospect —</option>
              <optgroup label="Clients">
                {customers
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Prospects">
                {prospects
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="label">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
              <input
                className="input pl-8"
                placeholder="Message or client name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Card>

      <Card padded={false}>
        <div className="max-h-[70vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-10">
              <EmptyState
                title="No matching status updates"
                description="Adjust the filters above to widen the search."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b border-ink-100">
                <tr className="text-left text-xs uppercase tracking-wider text-ink-500">
                  <th className="px-6 py-3">When</th>
                  <th className="px-6 py-3">Source</th>
                  <th className="px-6 py-3">Client / Prospect</th>
                  <th className="px-6 py-3">Policy</th>
                  <th className="px-6 py-3">Message</th>
                  <th className="px-6 py-3">Visibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((e) => {
                  const cust = e.customerId ? customerById.get(e.customerId) : null;
                  const prospect = e.prospectId ? prospectById.get(e.prospectId) : null;
                  const policy = e.policyId ? api.policies.get(e.policyId) : null;
                  return (
                    <tr key={e.id} className="hover:bg-ink-50/40">
                      <td className="px-6 py-3 text-ink-700 whitespace-nowrap align-top">
                        <div>{fmt.dateTime(e.createdAt)}</div>
                        <div className="text-[11px] text-ink-400">{fmt.relative(e.createdAt)}</div>
                      </td>
                      <td className="px-6 py-3 capitalize align-top">{e.source}</td>
                      <td className="px-6 py-3 align-top">
                        {cust ? (
                          <Link
                            to={`/employee/clients/${cust.id}`}
                            className="text-gold-700 hover:text-gold-600"
                          >
                            {cust.name}
                          </Link>
                        ) : prospect ? (
                          <div className="flex items-center gap-1.5">
                            <Link
                              to={`/employee/prospects/${prospect.id}`}
                              className="text-gold-700 hover:text-gold-600"
                            >
                              {prospect.name}
                            </Link>
                            <Badge tone="info">Prospect</Badge>
                          </div>
                        ) : (
                          <span className="text-ink-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs align-top">
                        {policy ? fmt.policyRef(policy) : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="px-6 py-3 text-ink-800 align-top">
                        <div className="whitespace-pre-wrap break-words max-w-prose">
                          {e.message}
                        </div>
                      </td>
                      <td className="px-6 py-3 align-top whitespace-nowrap">
                        <Badge tone={e.visibility === "customer_visible" ? "info" : "neutral"}>
                          {e.visibility === "customer_visible" ? "Customer-visible" : "Internal"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}