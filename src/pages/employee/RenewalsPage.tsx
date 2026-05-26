import { useState } from "react";
import { Check, Mail, MessageSquare, XCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

export function RenewalsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const [sentBanner, setSentBanner] = useState<string | null>(null);
  if (!agency || !user) return null;
  const visibleIds = new Set(
    api.customers
      .listVisible(agency.id, { id: user.id, role: user.role })
      .map((c) => c.id)
  );
  // Upcoming renewals are pinned to the top — they're the rows
  // driving the red Renewals sidebar badge. Agents only see renewals
  // for policies belonging to their assigned clients.
  const renewals = [...api.renewals.listByTenant(agency.id)]
    .filter((r) => {
      const policy = api.policies.get(r.policyId);
      return policy ? visibleIds.has(policy.customerId) : false;
    })
    .sort((a, b) => {
      const ra = a.status === "upcoming" ? 0 : 1;
      const rb = b.status === "upcoming" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.renewalDate.localeCompare(b.renewalDate);
    });
  const refresh = () => setRev((r) => r + 1);

  function sendReminder(renewalId: string, channel: "email" | "sms") {
    const result = api.renewals.sendReminder({ renewalId, channel, sentById: user!.id });
    if (result.reminderSent) {
      setSentBanner(`${channel.toUpperCase()} reminder logged. Check the client timeline.`);
      window.setTimeout(() => setSentBanner(null), 3500);
      refresh();
    }
  }
  function markRenewed(renewalId: string) {
    if (!confirm("Mark this renewal as renewed? It'll drop off the Renewals alert.")) return;
    api.renewals.markRenewed(renewalId);
    refresh();
  }
  function markNotDue(renewalId: string) {
    api.renewals.markNotDue(renewalId);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Renewals</h1>
        <p className="text-ink-500 text-sm mt-1">
          AI-tracked renewal pipeline. Reminders are logged on each client's status report.
        </p>
      </div>
      {sentBanner && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sentBanner}
        </div>
      )}
      <Card padded={false}>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-4 py-3 whitespace-nowrap">Client</th>
              <th className="px-4 py-3 whitespace-nowrap">Client code</th>
              <th className="px-4 py-3 whitespace-nowrap">Policy #</th>
              <th className="px-4 py-3 whitespace-nowrap">Policy type</th>
              <th className="px-4 py-3 whitespace-nowrap">Department</th>
              <th className="px-4 py-3 whitespace-nowrap">Carrier</th>
              <th className="px-4 py-3 whitespace-nowrap">Effective date</th>
              <th className="px-4 py-3 whitespace-nowrap">Expiration date</th>
              <th className="px-4 py-3 whitespace-nowrap">Status</th>
              <th className="px-4 py-3 whitespace-nowrap text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {renewals.map((r) => {
              const policy = api.policies.get(r.policyId);
              const customer = policy ? api.customers.get(policy.customerId) : null;
              const carrier = policy ? api.carriers.get(policy.carrierId) : null;
              const asset = policy ? api.assets.get(policy.assetId) : null;
              const upcoming = r.status === "upcoming";
              return (
                <tr key={r.id} className={upcoming ? "bg-alert-soft/60" : ""}>
                  <td className="px-4 py-4">
                    {upcoming && (
                      <span
                        className="inline-block h-2 w-2 rounded-full bg-alert mr-1.5 align-middle"
                        title="Upcoming"
                      />
                    )}
                    {customer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs text-ink-700">
                    {api.helpers.clientCodeFor(customer)}
                  </td>
                  <td className="px-4 py-4 font-mono text-xs">{fmt.policyRef(policy)}</td>
                  <td className="px-4 py-4 text-ink-700">
                    {asset ? api.helpers.assetTypeLabel(asset.type) : "—"}
                  </td>
                  <td className="px-4 py-4 text-ink-700">
                    {api.helpers.departmentLabel(policy)}
                  </td>
                  <td className="px-4 py-4">{carrier?.name ?? "—"}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{fmt.date(policy?.effectiveDate)}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{fmt.date(r.renewalDate)}</td>
                  <td className="px-4 py-4"><RenewalStatusBadge status={r.status} /></td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="btn-outline text-xs"
                        onClick={() => sendReminder(r.id, "email")}
                        disabled={!customer}
                        title="Log a renewal reminder via email and add it to the client timeline"
                      >
                        <Mail className="h-3.5 w-3.5" /> Email
                      </button>
                      <button
                        type="button"
                        className="btn-outline text-xs"
                        onClick={() => sendReminder(r.id, "sms")}
                        disabled={!customer}
                        title="Log a renewal reminder via SMS and add it to the client timeline"
                      >
                        <MessageSquare className="h-3.5 w-3.5" /> SMS
                      </button>
                      {upcoming && (
                        <>
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            onClick={() => markRenewed(r.id)}
                          >
                            <Check className="h-3.5 w-3.5" /> Mark renewed
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => markNotDue(r.id)}
                            title="Move out of Upcoming without renewing (false alarm / off-cycle)"
                          >
                            <XCircle className="h-3.5 w-3.5" /> Not due
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {renewals.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-ink-400 text-sm">No renewals tracked.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}