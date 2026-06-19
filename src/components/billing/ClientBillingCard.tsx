import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import {
  BILLING_STATUS_LABEL,
  billingMethodLabel,
  billingStatusFor,
  billingStatusTone,
} from "@/lib/billing";
import { fmt } from "@/lib/format";

export function ClientBillingCard({
  customerId,
  className = "",
}: {
  customerId: string;
  tenantId: string;
  userId: string;
  onChanged: () => void;
  className?: string;
}) {
  const policies = api.policies.listByCustomer(customerId);

  return (
    <Card id="billing" className={className}>
      <CardHeader title="Billing" />

      {policies.length === 0 ? (
        <div className="text-sm text-ink-400">No billing records yet. Add a policy first.</div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {policies.map((policy) => {
            const asset = api.assets.get(policy.assetId);
            const carrier = api.carriers.get(policy.carrierId);
            const status = billingStatusFor(policy);
            return (
              <li key={policy.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-semibold text-ink-900">{fmt.policyRef(policy)}</div>
                  <div className="mt-0.5 truncate text-xs text-ink-500">
                    {carrier?.name ?? "Carrier"} - {asset?.label ?? "Asset not recorded"} - {billingMethodLabel(policy.billingMethod)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-2">
                  <Badge tone={billingStatusTone(status)}>{BILLING_STATUS_LABEL[status]}</Badge>
                  <Button size="xs" to={`/employee/billing/${policy.id}`} title="Open billing details">
                    Open
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
