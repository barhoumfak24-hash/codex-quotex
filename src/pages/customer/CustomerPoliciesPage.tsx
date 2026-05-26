import { useState } from "react";
import { EmptyState } from "@/components/ui/Card";
import { PolicyDetailCard } from "@/components/policies/PolicyDetailCard";
import { PolicyEditWizard } from "@/components/policies/PolicyEditWizard";
import { useCustomer } from "@/lib/useCustomer";
import { api } from "@/lib/api";
import type { Policy } from "@/types";

// =====================================================================
// Customer-portal Policies category.
//
// One expandable card per policy. Summary row is always visible
// (policy #, type, carrier, dates, premium + cadence, status,
// assigned agent + contact). Click "Show full policy detail" to
// expand the asset details, coverages, endorsements, exclusions,
// additional insureds, beneficiaries, premium breakdown, payment
// history, next payment, and the categorized document list with
// per-file View + Download buttons.
//
// "Request a policy change" opens the PolicyEditWizard in
// policy-mode, which routes the resulting Communication through
// api.policies.requestEdit — the agent sees a Clients-category
// alert and the AI auto-drafts an acknowledgment reply.
// =====================================================================

export function CustomerPoliciesPage() {
  const customer = useCustomer();
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  if (!customer) return null;
  const policies = api.policies.listByCustomer(customer.id);
  const editingAsset = editingPolicy ? api.assets.get(editingPolicy.assetId) ?? undefined : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Policies</h1>
        <p className="text-ink-500 text-sm mt-1">
          All active and pending coverage across your portfolio. Tap a card for the full detail,
          documents, and to request a change.
        </p>
      </div>

      {banner && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {banner}
        </div>
      )}

      <PolicyEditWizard
        open={editingPolicy != null}
        onClose={() => setEditingPolicy(null)}
        tenantId={customer.tenantId}
        customerId={customer.id}
        asset={editingAsset}
        policyId={editingPolicy?.id}
        mode="policy"
        onSent={() => {
          setBanner(
            "Your request has been submitted. Your agent will review and respond within 24 hours."
          );
          window.setTimeout(() => setBanner(null), 6000);
        }}
      />

      {policies.length === 0 ? (
        <EmptyState title="No policies yet" description="Start a quote to begin." />
      ) : (
        <div className="space-y-4">
          {policies.map((p) => (
            <PolicyDetailCard
              key={p.id}
              policy={p}
              onRequestEdit={(policy) => setEditingPolicy(policy)}
            />
          ))}
        </div>
      )}
    </div>
  );
}