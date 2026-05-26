import { Building2, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Timeline } from "@/components/ui/Timeline";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { TIER_LIMITS } from "@/lib/tiers";

export function MasterDashboard() {
  const agencies = api.agencies.list();
  const carriers = api.carriers.list();
  let totalCustomers = 0;
  let totalPolicies = 0;
  let totalDeposits = 0;
  let mrr = 0;
  const events: ReturnType<typeof api.status.listByTenant> = [];
  for (const a of agencies) {
    totalCustomers += api.customers.list(a.id).length;
    totalPolicies += api.policies.listByTenant(a.id).length;
    totalDeposits += api.deposits
      .listByTenant(a.id)
      .filter((d) => d.status === "paid")
      .reduce((s, d) => s + d.amount, 0);
    mrr += a.active ? TIER_LIMITS[a.tier].monthlyPriceUsd : 0;
    // Master sees high-signal, agency-level activity only. Internal AI
    // drafts (SMS / email queued for review) belong to the agency staff
    // and are deliberately excluded here to honor tenant boundaries.
    const tenantEvents = api.status
      .listByTenant(a.id)
      .filter((e) => !(e.source === "ai" && e.visibility === "internal"));
    events.push(...tenantEvents);
  }
  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Platform overview</h1>
        <p className="text-ink-500 text-sm mt-1">Founder controls for all agencies, carriers, and platform health.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Agencies" value={agencies.filter((a) => a.active).length} hint={`${agencies.length} total`} icon={<Building2 className="h-5 w-5" />} />
        <StatCard label="Clients" value={totalCustomers} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Policies" value={totalPolicies} icon={<ShieldCheck className="h-5 w-5" />} />
        <StatCard label="Carriers" value={carriers.length} icon={<Sparkles className="h-5 w-5" />} />
        <StatCard label="MRR" value={fmt.money(mrr)} hint="Subscription only" icon={<Wallet className="h-5 w-5" />} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader title="Agencies" />
          <ul className="divide-y divide-ink-100">
            {agencies.map((a) => (
              <li key={a.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{a.name}</div>
                  <div className="text-xs text-ink-500 mt-0.5 capitalize">
                    {a.tier} tier · {a.serviceAreas.join(", ")}
                  </div>
                </div>
                <div className="text-sm">
                  <div className="text-ink-900">{fmt.money(TIER_LIMITS[a.tier].monthlyPriceUsd)}/mo</div>
                  <div className="text-xs text-ink-500">Deposits paid: {fmt.money(totalDeposits)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Platform activity" />
          <Timeline events={events.slice(0, 12)} />
        </Card>
      </div>
    </div>
  );
}