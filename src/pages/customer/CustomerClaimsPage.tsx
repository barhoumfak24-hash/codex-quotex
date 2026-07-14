import { useMemo, useState } from "react";
import { Mail, Phone, Search, Send } from "lucide-react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { CarrierClaimLink } from "@/components/ui/CarrierClaimLink";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { fmt } from "@/lib/format";
import { toTelHref } from "@/lib/phone";
import { useTenant } from "@/lib/tenant";
import { useCustomer } from "@/lib/useCustomer";

export function CustomerClaimsPage() {
  const customer = useCustomer();
  const { agency } = useTenant();
  const [query, setQuery] = useState("");
  // Contact-agency form state.
  const [contactAssetId, setContactAssetId] = useState<string>("");
  const [contactBody, setContactBody] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactBanner, setContactBanner] = useState<string | null>(null);
  if (!customer) return null;
  const assets = api.assets.listByCustomer(customer.id);
  const policies = api.policies.listByCustomer(customer.id);
  const claims = api.claims.listByCustomer(customer.id);
  const assignedAgent = customer.assignedAgentId
    ? api.users.get(customer.assignedAgentId)
    : undefined;
  const agentPhoneHref = toTelHref(assignedAgent?.phone);
  const agencyPhoneHref = toTelHref(agency?.phone);
  const callLabel = assignedAgent?.name
    ? `Call ${assignedAgent.name.split(" ")[0]}`
    : "Call my agent";

  // Every carrier the customer's agency is contracted with. Powers
  // the "all carriers we work with" pool below so customers can
  // start a claim with any of them, not only the carriers tied to
  // their existing policies (e.g. urgent loss reported to a wider
  // panel, or a relative's vehicle on the same household policy).
  const agencyCarriers = api.carriers.listForTenant(customer.tenantId);

  // Carriers we want to highlight at the top because the customer
  // already has at least one active policy with them. Each entry
  // carries the policy + asset context for the row.
  const policyCarrierRows = policies.map((p) => ({
    policy: p,
    carrier: api.carriers.get(p.carrierId),
    asset: api.assets.get(p.assetId),
  }));
  const policyCarrierIds = new Set(
    policyCarrierRows.map((r) => r.carrier?.id).filter(Boolean) as string[]
  );

  // Filter the broader agency-carrier pool against the search box
  // and dedupe against carriers already shown in the policy section.
  const filteredAgencyCarriers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agencyCarriers
      .filter((c) => !policyCarrierIds.has(c.id))
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (c.appetiteNotes ?? "").toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agencyCarriers, policyCarrierIds, query]);

  function alertAgent() {
    const trimmed = contactBody.trim();
    if (!trimmed) return;
    setContactBusy(true);
    try {
      api.claims.submitInquiry({
        tenantId: customer!.tenantId,
        customerId: customer!.id,
        assetId: contactAssetId || undefined,
        body: trimmed,
      });
      const asset = assets.find((a) => a.id === contactAssetId);
      const label = asset ? assetDisplayName(asset) : "your selection";
      setContactBanner(
        `Your agent has been alerted about a claim for ${label}. We've logged this on your status timeline.`
      );
      setContactBody("");
      setContactAssetId("");
      window.setTimeout(() => setContactBanner(null), 5000);
    } finally {
      setContactBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Claims</h1>
        <p className="text-ink-500 text-sm mt-1">
          File a claim directly with any carrier your agency works with and track status here.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Contact your agency about a claim"
          subtitle="Send your agent a message so they can help start, escalate, or coordinate a claim on your behalf. Tag the affected asset so they have full context."
          action={
            agentPhoneHref || agencyPhoneHref ? (
              <div className="flex flex-wrap items-center gap-2">
                {agentPhoneHref && (
                  <a href={agentPhoneHref} className="btn-outline text-sm whitespace-nowrap">
                    <Phone className="h-4 w-4" /> {callLabel}
                  </a>
                )}
                {agencyPhoneHref && agencyPhoneHref !== agentPhoneHref && (
                  <a href={agencyPhoneHref} className="btn-outline text-sm whitespace-nowrap">
                    <Phone className="h-4 w-4" /> Call agency
                  </a>
                )}
              </div>
            ) : undefined
          }
        />
        {contactBanner && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {contactBanner}
          </div>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="label">Which asset is this about?</label>
            <select
              className="input"
              value={contactAssetId}
              onChange={(e) => setContactAssetId(e.target.value)}
              disabled={contactBusy}
            >
              <option value="">— Not sure / pick later —</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {assetDisplayName(a)}
                </option>
              ))}
            </select>
            {assets.length === 0 && (
              <p className="mt-1 text-[11px] text-ink-500">
                No assets on file yet — your agent can still help; describe what happened below.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="label">What happened?</label>
            <textarea
              className="input min-h-[88px]"
              placeholder="Describe the loss, when it happened, and what you need. Your agent will reach out as soon as possible."
              value={contactBody}
              onChange={(e) => setContactBody(e.target.value)}
              disabled={contactBusy}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  alertAgent();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-500">
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-gold-600" />
                Your agent + agency manager are notified. The message + your selection are logged on
                your status timeline and theirs.
              </span>
              <button
                type="button"
                className="btn-primary text-sm whitespace-nowrap"
                onClick={alertAgent}
                disabled={contactBusy || contactBody.trim().length === 0}
              >
                <Send className="h-3.5 w-3.5" /> Alert my agent
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your carriers"
          subtitle="Carriers tied to your active policies. File here for the fastest routing — the carrier already has your policy on file."
        />
        {policyCarrierRows.length === 0 ? (
          <EmptyState
            title="No active policies"
            description="Once you have an active policy, the carrier appears here. In the meantime, you can still file with any of your agency's contracted carriers below."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {policyCarrierRows.map(({ policy, carrier, asset }) => (
              <li key={policy.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{asset ? assetDisplayName(asset) : "—"}</div>
                  <div className="text-xs text-ink-500 truncate">
                    {carrier?.name ?? "Unknown carrier"} ·{" "}
                    <span className="font-mono">{fmt.policyRef(policy)}</span>
                  </div>
                </div>
                {carrier && carrier.claimsUrl ? (
                  <CarrierClaimLink
                    tenantId={customer.tenantId}
                    customerId={customer.id}
                    carrierId={carrier.id}
                    carrierName={carrier.name}
                    claimsUrl={carrier.claimsUrl}
                    policyId={policy.id}
                    assetId={asset?.id}
                    variant="primary"
                    label="File a claim"
                    className="text-xs whitespace-nowrap"
                  />
                ) : (
                  <span className="text-xs text-ink-400">No claims URL on file</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="All carriers your agency works with"
          subtitle={`${agencyCarriers.length} carrier${agencyCarriers.length === 1 ? "" : "s"} contracted by your agency. You can start a claim with any of them — your agent will be looped in on the file automatically.`}
          action={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
              <input
                className="input !py-1.5 !text-xs pl-8 w-56"
                placeholder="Search carriers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          }
        />
        {agencyCarriers.length === 0 ? (
          <EmptyState
            title="No contracted carriers yet"
            description="Your agency hasn't linked any carriers in the master portal. Contact your agent to get started."
          />
        ) : filteredAgencyCarriers.length === 0 ? (
          <div className="text-sm text-ink-500 py-4 text-center">
            All matching carriers are already listed above under your active policies.
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {filteredAgencyCarriers.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-md border border-ink-100 p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  {c.appetiteNotes && (
                    <div className="text-[11px] text-ink-500 truncate">{c.appetiteNotes}</div>
                  )}
                  {c.stateAvailability.length > 0 && c.stateAvailability.length < 50 && (
                    <div className="text-[10px] text-ink-400 mt-0.5">
                      {c.stateAvailability.length} state{c.stateAvailability.length === 1 ? "" : "s"}
                    </div>
                  )}
                </div>
                {c.claimsUrl ? (
                  <CarrierClaimLink
                    tenantId={customer.tenantId}
                    customerId={customer.id}
                    carrierId={c.id}
                    carrierName={c.name}
                    claimsUrl={c.claimsUrl}
                    variant="compact"
                    label="File"
                    className="whitespace-nowrap"
                  />
                ) : (
                  <span className="text-[11px] text-ink-400 whitespace-nowrap">
                    Call your agent
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs text-ink-600 flex items-start gap-2">
          <Phone className="h-4 w-4 mt-0.5 shrink-0 text-gold-600" />
          <div>
            <strong className="text-ink-800">Not sure where to start?</strong> Call your dedicated
            agent and they'll route the claim to the right carrier for the loss type.
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Your claims" />
        {claims.length === 0 ? (
          <div className="text-sm text-ink-400">No claims on file.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {claims.map((c) => {
              const claimPolicy = api.policies.get(c.policyId);
              return (
                <li key={c.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      Claim #{c.externalClaimNumber ?? c.id.slice(-6)}
                    </div>
                    <div className="text-xs text-ink-500 flex flex-wrap gap-x-2">
                      <span>{api.carriers.get(c.carrierId)?.name}</span>
                      {claimPolicy && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{fmt.policyRef(claimPolicy)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="badge bg-blue-50 text-blue-700">
                    {c.status.replace("_", " ")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
