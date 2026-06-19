import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";

export function UsageAnalyticsPage() {
  const agencies = api.agencies.list();
  let totalProspects = 0;
  let totalMessages = 0;
  let totalDeposits = 0;
  const rows = agencies.map((a) => {
    const prospects = api.prospects.listByTenant(a.id).length;
    const messages = api.marketing.listMessages(a.id).length;
    const deposits = api.deposits.listByTenant(a.id).filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0);
    totalProspects += prospects;
    totalMessages += messages;
    totalDeposits += deposits;
    return { agency: a, prospects, messages, deposits };
  });
  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div>
        <h1 className="font-display text-3xl">Usage analytics</h1>
        <p className="text-ink-500 text-sm mt-1">Prospect, AI, and deposit volume per tenant.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Prospect volume" value={totalProspects} />
        <StatCard label="AI / SMS / email msgs" value={totalMessages} />
        <StatCard label="Customer deposits" value={fmt.money(totalDeposits)} />
      </div>
      <Card padded={false}>
        <CardHeader title="" />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Agency</th>
              <th className="px-6 py-3">Prospects</th>
              <th className="px-6 py-3">Messages</th>
              <th className="px-6 py-3">Deposits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.agency.id}>
                <td className="px-6 py-4 font-medium">{r.agency.name}</td>
                <td className="px-6 py-4">{r.prospects} / {r.agency.allowedProspectsPerMonth.toLocaleString()}</td>
                <td className="px-6 py-4">{r.messages} / {r.agency.allowedAiMessagesPerMonth.toLocaleString()}</td>
                <td className="px-6 py-4">{fmt.money(r.deposits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
