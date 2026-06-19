import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { CarrierClaimLink } from "@/components/ui/CarrierClaimLink";
import { DocumentList } from "@/components/ui/DocumentList";
import { PolicyStatusBadge, RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { api } from "@/lib/api";
import { toSurfaceRoute } from "@/lib/appSurface";
import { fmt } from "@/lib/format";
import { useCustomer } from "@/lib/useCustomer";

export function CustomerPolicyPage() {
  const { policyId } = useParams();
  const customer = useCustomer();
  // Older builds had a demo-notice modal here; replaced by real
  // outbound carrier claim links via CarrierClaimLink below.
  const location = useLocation();
  const navigate = useNavigate();
  if (!policyId || !customer) return null;
  const policy = api.policies.get(policyId);
  if (!policy || policy.customerId !== customer.id) {
    return <EmptyState title="Policy not found" />;
  }
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const documents = api.documents.listByEntity({ policyId });
  const events = api.status.listFor({ policyId }).filter((e) => e.visibility === "customer_visible");

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => navigate(toSurfaceRoute("/customer/policies", location.pathname))}
        icon={<ArrowLeft className="h-4 w-4" />}
        className="-ml-2"
      >
        Back
      </Button>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">{asset?.label ?? "Policy"}</h1>
          <p className="text-ink-500 text-sm mt-1">
            {carrier?.name} · <span className="font-mono">{fmt.policyRef(policy)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-700">
            {api.helpers.departmentLabel(policy)}
          </span>
          <PolicyStatusBadge status={policy.status} />
          <RenewalStatusBadge status={policy.renewalStatus} />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Coverage" />
          <dl className="text-sm space-y-2">
            <Row label="Premium estimate" value={policy.premiumEstimate ? fmt.money(policy.premiumEstimate) : "—"} />
            <Row label="Final premium" value={policy.finalPremium ? fmt.money(policy.finalPremium) : "—"} />
            <Row label="Effective date" value={fmt.date(policy.effectiveDate)} />
            <Row label="Renewal date" value={fmt.date(policy.renewalDate)} />
          </dl>
          {carrier?.claimsUrl && (
            <CarrierClaimLink
              tenantId={customer.tenantId}
              customerId={customer.id}
              carrierId={carrier.id}
              carrierName={carrier.name}
              claimsUrl={carrier.claimsUrl}
              policyId={policy.id}
              assetId={asset?.id}
              variant="outline"
              className="w-full mt-4 justify-center"
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Policy remarks" />
          <Timeline events={events} context="customer" />
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Documents" />
          <DocumentList documents={documents} />
        </Card>
      </div>

      {asset && (
        <Link to={`/customer/assets/${asset.id}`} className="text-sm text-gold-700">
          View asset →
        </Link>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900">{value}</dd>
    </div>
  );
}
