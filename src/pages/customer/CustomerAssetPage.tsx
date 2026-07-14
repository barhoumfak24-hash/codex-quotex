import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { DocumentList } from "@/components/ui/DocumentList";
import { isAddressLikeKey, MapLink } from "@/components/ui/MapLink";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { PolicyEditWizard } from "@/components/policies/PolicyEditWizard";
import { api } from "@/lib/api";
import { assetDisplayName, assetDisplaySubtitleLabel, formatAssetDetailValue } from "@/lib/assetDisplay";
import { toSurfaceRoute } from "@/lib/appSurface";
import { fmt } from "@/lib/format";
import { useCustomer } from "@/lib/useCustomer";

export function CustomerAssetPage() {
  const { assetId } = useParams();
  const customer = useCustomer();
  const location = useLocation();
  const navigate = useNavigate();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editBanner, setEditBanner] = useState<string | null>(null);
  if (!assetId || !customer) return null;
  const asset = api.assets.get(assetId);
  if (!asset || asset.customerId !== customer.id) {
    return <EmptyState title="Asset not found" />;
  }
  const policies = api.policies.listByAsset(assetId);
  const documents = api.documents.listByEntity({ assetId });
  const events = api.status.listFor({ assetId }).filter((e) => e.visibility === "customer_visible");

  function handleSent() {
    setEditBanner(
      `Your request has been sent to your agent. We've logged it on this asset's activity timeline.`
    );
    window.setTimeout(() => setEditBanner(null), 6000);
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => navigate(toSurfaceRoute("/customer/assets", location.pathname))}
        icon={<ArrowLeft className="h-4 w-4" />}
        className="-ml-2"
      >
        Back
      </Button>
      <div>
        <h1 className="font-display text-3xl">{assetDisplayName(asset)}</h1>
        <p className="text-ink-500 text-sm mt-1">
          {assetDisplaySubtitleLabel(asset.type)} · {fmt.money(asset.estimatedValue)}
        </p>
      </div>

      {editBanner && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {editBanner}
        </div>
      )}

      <PolicyEditWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        tenantId={customer.tenantId}
        customerId={customer.id}
        asset={asset}
        policyId={policies[0]?.id}
        onSent={handleSent}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Asset details" />
          <dl className="text-sm space-y-2">
            {Object.entries(asset.details as Record<string, unknown>).map(([k, v]) => {
              const shouldMap = isAddressLikeKey(k) && typeof v === "string";
              return (
                <div key={k} className="flex justify-between gap-3 text-ink-700">
                  <dt className="text-ink-500 capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                  <dd className="min-w-0 max-w-[62%] text-right text-ink-900">
                    {shouldMap ? (
                      <MapLink address={v} className="max-w-full justify-end text-right" />
                    ) : (
                      <span className="block truncate">{formatAssetDetailValue(k, v)}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Policies on this asset" />
          {policies.length === 0 ? (
            <div className="text-sm text-ink-400">No policy attached.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {policies.map((p) => (
                <li key={p.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{api.carriers.get(p.carrierId)?.name ?? "—"}</div>
                    <div className="text-xs text-ink-500 font-mono">{fmt.policyRef(p)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <PolicyStatusBadge status={p.status} />
                    <Button
                      size="xs"
                      to={`/customer/policies/${p.id}`}
                    >
                      View
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 pt-3 border-t border-ink-100 flex justify-start">
            <Button
              size="sm"
              onClick={() => setWizardOpen(true)}
              icon={<Pencil className="h-4 w-4" />}
            >
              Edit my policy
            </Button>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Documents" />
          <DocumentList documents={documents} />
        </Card>

        <Card>
          <CardHeader title="Activity" />
          <Timeline events={events} context="customer" />
        </Card>
      </div>
    </div>
  );
}
