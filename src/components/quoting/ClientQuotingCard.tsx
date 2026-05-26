import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { AiQuotingWorkspace } from "@/components/quoting/AiQuotingWorkspace";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { AssetType, CustomerProfile } from "@/types";

// =====================================================================
// Client-side wrapper around AiQuotingWorkspace. Clients usually have
// 1+ existing assets to re-quote; this card adds an asset picker so
// the agent can choose which line the AI runs against. Falls back to
// a "new business" entry form (asset type + estimated value) when
// the client has no assets on file yet.
// =====================================================================

const ASSET_OPTIONS: { value: AssetType; label: string }[] = [
  { value: "coastal_home", label: "Coastal home" },
  { value: "luxury_vehicle", label: "Luxury vehicle" },
  { value: "yacht", label: "Yacht" },
  { value: "jewelry", label: "Jewelry" },
  { value: "umbrella_liability", label: "Umbrella liability" },
  { value: "full_portfolio", label: "Full portfolio" },
  { value: "other", label: "Other" },
];

export function ClientQuotingCard({
  tenantId,
  userId,
  customer,
}: {
  tenantId: string;
  userId: string;
  customer: CustomerProfile;
}) {
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const assets = api.assets.listByCustomer(customer.id);
  const existing = api.quoting.getForCustomer(customer.id);

  // Lock the asset picker once a session is active — restarting the
  // workspace via "Start over" clears the session and unlocks the
  // picker.
  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    existing?.assetId ?? assets[0]?.id ?? "new"
  );
  const [newAssetType, setNewAssetType] = useState<AssetType>(
    existing?.assetType ?? "coastal_home"
  );
  const [newAssetValue, setNewAssetValue] = useState<number>(
    existing?.estimatedValue ?? 1_000_000
  );

  const isNew = selectedAssetId === "new" || assets.length === 0;
  const pickedAsset = !isNew
    ? assets.find((a) => a.id === selectedAssetId) ?? assets[0]
    : null;
  const assetType: AssetType = pickedAsset ? pickedAsset.type : newAssetType;
  const estimatedValue = pickedAsset ? pickedAsset.estimatedValue : newAssetValue;
  const address = customer.mailingAddress ?? customer.garagingAddress;

  return (
    <Card>
      <CardHeader
        title="AI quoting workspace"
        subtitle="Re-quote an existing asset or run a new line. AI pulls public records, drafts a questionnaire for missing detail, and ranks every linked carrier by composite fit."
      />

      {!existing && (
        <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3 mb-4 space-y-3">
          <div>
            <label className="label">Which asset / line?</label>
            <select
              className="input"
              value={selectedAssetId}
              onChange={(e) => setSelectedAssetId(e.target.value)}
            >
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {api.helpers.assetTypeLabel(a.type)} ·{" "}
                  {fmt.money(a.estimatedValue)}
                </option>
              ))}
              <option value="new">— New line / new asset —</option>
            </select>
          </div>
          {isNew && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Asset type</label>
                <select
                  className="input"
                  value={newAssetType}
                  onChange={(e) => setNewAssetType(e.target.value as AssetType)}
                >
                  {ASSET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Estimated value</label>
                <input
                  type="number"
                  className="input"
                  value={newAssetValue}
                  onChange={(e) => setNewAssetValue(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <AiQuotingWorkspace
        tenantId={tenantId}
        userId={userId}
        contact={{
          kind: "client",
          id: customer.id,
          name: customer.name,
          assetType,
          estimatedValue,
          address,
          assetId: pickedAsset?.id,
        }}
        onChanged={refresh}
      />
    </Card>
  );
}