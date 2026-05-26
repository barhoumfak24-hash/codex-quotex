import { Link } from "react-router-dom";
import { Briefcase, Gem, Home, Sailboat, ShieldCheck, Umbrella } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useCustomer } from "@/lib/useCustomer";
import type { AssetType } from "@/types";

// =====================================================================
// "My assets" list. Customer-side counterpart to /customer/policies —
// every asset in the customer's portfolio (homes, vehicles, yachts,
// jewelry, umbrella liability, etc.) with a quick View link into the
// full per-asset detail page.
// =====================================================================

const ASSET_ICONS: Partial<Record<AssetType, React.ComponentType<{ className?: string }>>> = {
  coastal_home: Home,
  luxury_vehicle: Briefcase,
  yacht: Sailboat,
  jewelry: Gem,
  umbrella_liability: Umbrella,
  full_portfolio: ShieldCheck,
};

export function CustomerAssetsPage() {
  const customer = useCustomer();
  if (!customer) return null;
  const assets = api.assets.listByCustomer(customer.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">My assets</h1>
        <p className="text-ink-500 text-sm mt-1">
          Everything we insure for you. Tap an asset for the full details, attached
          policy, documents, and activity timeline.
        </p>
      </div>

      <Card padded={false}>
        {assets.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No assets yet"
              description="Once your agent adds something to your portfolio it'll show up here. Start a new quote to add coverage for a home, vehicle, yacht, or anything else."
              icon={<ShieldCheck className="h-8 w-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {assets.map((a) => {
              const Icon = ASSET_ICONS[a.type] ?? ShieldCheck;
              const policies = api.policies.listByAsset(a.id);
              return (
                <li key={a.id}>
                  <Link
                    to={`/customer/assets/${a.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-ink-50/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex items-center justify-center h-10 w-10 rounded-md bg-ink-100 text-ink-700 shrink-0">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-ink-900 truncate">
                          {a.label}
                        </div>
                        <div className="text-xs text-ink-500 mt-0.5">
                          {api.helpers.assetTypeLabel(a.type)} ·{" "}
                          {fmt.money(a.estimatedValue)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {policies[0] && (
                        <PolicyStatusBadge status={policies[0].status} />
                      )}
                      <span className="text-xs text-gold-700 font-medium">View →</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}