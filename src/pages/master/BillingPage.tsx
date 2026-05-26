import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { TIER_LIMITS } from "@/lib/tiers";

export function BillingPage() {
  const agencies = api.agencies.list();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Billing</h1>
        <p className="text-ink-500 text-sm mt-1">Subscription billing across all tenant agencies.</p>
      </div>
      <Disclaimer>
        Stripe subscription operations are stubbed. Real impl: server-side webhook on{" "}
        <code>customer.subscription.updated</code>, with a placeholder hook fired when users are added/removed.
      </Disclaimer>
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <th className="px-6 py-3">Agency</th>
              <th className="px-6 py-3">Tier</th>
              <th className="px-6 py-3">Monthly price</th>
              <th className="px-6 py-3">Stripe customer</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {agencies.map((a) => (
              <tr key={a.id}>
                <td className="px-6 py-4 font-medium">{a.name}</td>
                <td className="px-6 py-4 capitalize">{a.tier}</td>
                <td className="px-6 py-4">{fmt.money(TIER_LIMITS[a.tier].monthlyPriceUsd)}</td>
                <td className="px-6 py-4 text-ink-700">{a.stripeCustomerId ?? "—"}</td>
                <td className="px-6 py-4"><Badge tone={a.active ? "success" : "neutral"}>{a.active ? "Active" : "Inactive"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}