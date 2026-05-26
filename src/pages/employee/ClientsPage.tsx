import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { NewContactModal } from "@/components/contacts/NewContactModal";
import { ManagedByCell } from "@/components/contacts/ManagedByCell";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

export function ClientsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  if (!agency || !user) return null;
  // Every staff member can see the whole agency's client roster for
  // transparency. Who *manages* each client is shown in the Managed-by
  // column; activity-creation stays scoped to each agent's own book.
  let customers = api.customers.list(agency.id);
  if (q.trim()) {
    const t = q.toLowerCase();
    customers = customers.filter(
      (c) => c.name.toLowerCase().includes(t) || c.email.toLowerCase().includes(t)
    );
  }
  customers = [...customers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Clients</h1>
          <p className="text-ink-500 text-sm mt-1">
            All active clients in {agency.name}. The Managed-by column shows the
            owning agent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input max-w-xs"
            placeholder="Search clients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn-gold" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New client
          </button>
        </div>
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

      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Email</th>
              <th className="px-6 py-3">Phone</th>
              <th className="px-6 py-3">Policies</th>
              <th className="px-6 py-3">Joined</th>
              <th className="px-6 py-3">Managed by</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {customers.map((c) => {
              const policies = api.policies.listByCustomer(c.id);
              return (
                <tr key={c.id} className="hover:bg-ink-50/60">
                  <td className="px-6 py-4">
                    <span className="font-medium">{c.name}</span>
                  </td>
                  <td className="px-6 py-4 text-ink-700">{c.email}</td>
                  <td className="px-6 py-4 text-ink-700">{c.phone ?? "—"}</td>
                  <td className="px-6 py-4 text-ink-700">{policies.length}</td>
                  <td className="px-6 py-4 text-ink-700">{fmt.date(c.createdAt)}</td>
                  <td className="px-6 py-4">
                    <ManagedByCell
                      assignedAgentId={c.assignedAgentId}
                      additionalAgentIds={c.additionalAgentIds}
                    />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        to={`/employee/clients/${c.id}`}
                        className="btn-outline text-xs inline-flex"
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        title="Archive this client"
                        onClick={() => {
                          if (!confirm(`Archive ${c.name}? You can unarchive from /employee/archive.`)) return;
                          api.customers.archive(c.id);
                          refresh();
                        }}
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-ink-400 text-sm">
                  No clients found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}