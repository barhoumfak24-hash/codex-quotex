import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, FileText, Pencil, User, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { DocumentList } from "@/components/ui/DocumentList";
import { isAddressLikeKey, MapLink } from "@/components/ui/MapLink";
import { PolicyStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { formatAssetValue } from "@/lib/assetLabels";
import { fmt } from "@/lib/format";

// =====================================================================
// Employee-side asset detail. Mirrors CustomerAssetPage but scoped to
// staff: same layout (asset details / policies / documents / activity
// timeline) plus the internal-visibility timeline events the customer
// view filters out, and a back-link to the client profile.
// =====================================================================

export function EmployeeAssetPage() {
  const { assetId, customerId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [, setRev] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [assetLabelDraft, setAssetLabelDraft] = useState("");
  if (!assetId || !customerId || !agency || !user) return null;
  const resolvedAssetId = assetId;
  const customer = api.customers.get(customerId);
  // Same access gate as ClientDetailPage — agents can only see clients
  // assigned to them, so we hide assets that hang off invisible
  // customers as if they didn't exist.
  if (
    !customer ||
    customer.tenantId !== agency.id ||
    !api.customers.canSee(customer, { id: user.id, role: user.role })
  ) {
    return <EmptyState title="Asset not found" />;
  }
  const asset = api.assets.get(assetId);
  if (!asset || asset.customerId !== customer.id) {
    return <EmptyState title="Asset not found" />;
  }
  const policies = api.policies.listByAsset(resolvedAssetId);
  const documents = api.documents.listByEntity({ assetId: resolvedAssetId });
  // Staff timeline shows everything — internal-only events included.
  const events = api.status.listFor({ assetId: resolvedAssetId });

  function startRename() {
    const current = api.assets.get(resolvedAssetId);
    if (!current) return;
    setAssetLabelDraft(current.label);
    setRenaming(true);
  }

  function cancelRename() {
    setAssetLabelDraft("");
    setRenaming(false);
  }

  function saveRename() {
    const next = assetLabelDraft.trim();
    if (!next) return;
    const current = api.assets.get(resolvedAssetId);
    if (!current) return;
    api.assets.update(current.id, {
      label: next,
      details: {
        ...(current.details ?? {}),
        customLabel: next,
      },
    });
    setRenaming(false);
    setAssetLabelDraft("");
    setRev((r) => r + 1);
  }

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        onClick={() => navigate(-1)}
        icon={<ArrowLeft className="h-4 w-4" />}
        className="-ml-2"
      >
        Back
      </Button>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {renaming ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                className="input min-w-[18rem]"
                value={assetLabelDraft}
                onChange={(event) => setAssetLabelDraft(event.target.value)}
                autoFocus
                aria-label="Asset name"
              />
              <Button size="xs" onClick={saveRename} icon={<Check className="h-3.5 w-3.5" />}>
                Save
              </Button>
              <Button size="xs" variant="outline" onClick={cancelRename} icon={<X className="h-3.5 w-3.5" />}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-3xl">{asset.label}</h1>
              <Button
                size="xs"
                variant="ghost"
                onClick={startRename}
                icon={<Pencil className="h-3.5 w-3.5" />}
              >
                Rename
              </Button>
            </div>
          )}
          <p className="text-ink-500 text-sm mt-1">
            {api.helpers.assetTypeLabel(asset.type)} · {formatAssetValue(asset.estimatedValue)}
          </p>
        </div>
        <Button
          size="xs"
          to={`/employee/clients/${customer.id}`}
          icon={<User className="h-3.5 w-3.5" />}
        >
          {customer.name}
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Asset details" />
          {Object.keys(asset.details ?? {}).length === 0 ? (
            <div className="text-sm text-ink-400">No structured details on file.</div>
          ) : (
            <dl className="text-sm space-y-2">
              {Object.entries(asset.details as Record<string, unknown>).map(([k, v]) => {
                const shouldMap = isAddressLikeKey(k) && typeof v === "string";
                return (
                  <div key={k} className="flex justify-between gap-3 text-ink-700">
                    <dt className="text-ink-500 capitalize">
                      {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </dt>
                    <dd className="min-w-0 max-w-[62%] text-right text-ink-900">
                      {shouldMap ? (
                        <MapLink address={v} className="max-w-full justify-end text-right" />
                      ) : (
                        <span className="block truncate">{String(v)}</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Policies on this asset" />
          {policies.length === 0 ? (
            <div className="text-sm text-ink-400">No policy attached.</div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {policies.map((p) => {
                const carrier = api.carriers.get(p.carrierId);
                return (
                  <li
                    key={p.id}
                    className="py-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{carrier?.name ?? "—"}</div>
                      <div className="text-xs text-ink-500 font-mono">
                        {fmt.policyRef(p)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <PolicyStatusBadge status={p.status} />
                      <Button
                        size="xs"
                        to={`/employee/policies/${p.id}`}
                      >
                        View
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-ink-500" /> Documents
              </span>
            }
          />
          {documents.length === 0 ? (
            <div className="text-sm text-ink-400">No documents on file.</div>
          ) : (
            <DocumentList
              documents={documents}
              uploadedById={user.id}
              onChanged={() => setRev((r) => r + 1)}
            />
          )}
        </Card>

        <Card>
          <CardHeader title="Activity" />
          <Timeline events={events} />
        </Card>
      </div>
    </div>
  );
}
