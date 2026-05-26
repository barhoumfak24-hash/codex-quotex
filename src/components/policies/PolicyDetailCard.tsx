import { useMemo, useState } from "react";
import {
  Anchor,
  Briefcase,
  Car,
  ChevronDown,
  ChevronUp,
  Download,
  FileImage,
  FileText,
  Gem,
  Home,
  Package,
  Pencil,
  Umbrella,
} from "lucide-react";
import { CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PolicyStatusBadge, RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { AssetType, Document, Policy } from "@/types";

// =====================================================================
// Customer-portal policy card.
//
// Summary row is always visible. Click the card body (or the chevron)
// to expand into the full detail: asset, coverages, endorsements,
// exclusions, additional insureds, beneficiaries, premium breakdown,
// payment history, next payment, and a categorized document list with
// View + Download per file.
//
// "Request a policy change" button is prominent in the top-right at
// all viewport sizes — opens the PolicyEditWizard in policy-mode so
// the client can fill out the right per-intent form (limits, riders,
// asset info, drivers, beneficiaries, cancellation, or other).
// =====================================================================

const ASSET_ICON: Record<AssetType, React.ComponentType<{ className?: string }>> = {
  coastal_home: Home,
  luxury_vehicle: Car,
  yacht: Anchor,
  jewelry: Gem,
  umbrella_liability: Umbrella,
  full_portfolio: Briefcase,
  other: Package,
};

// Loose grouping of document types into the buckets the spec calls
// out. Unmapped types fall into "Other documents".
const DOC_GROUP_ORDER: { key: string; label: string; types: string[] }[] = [
  { key: "primary", label: "Policy documents", types: ["declarations_page", "policy_document", "policy_booklet"] },
  { key: "id", label: "Insurance ID cards", types: ["insurance_id_card"] },
  { key: "endorsements", label: "Endorsements & riders", types: ["endorsement_document"] },
  { key: "proof", label: "Proof of insurance", types: ["proof_of_insurance"] },
  { key: "inspection", label: "Inspections & appraisals", types: ["inspection_report", "wind_mitigation", "appraisal", "asset_information"] },
  { key: "claims", label: "Claim documents", types: ["claim_document"] },
  { key: "cancellation", label: "Cancellation & lapse notices", types: ["cancellation_notice"] },
  { key: "correspondence", label: "Carrier correspondence", types: ["carrier_correspondence"] },
  { key: "billing", label: "Billing", types: ["deposit_receipt", "payment_receipt"] },
];

export function PolicyDetailCard({
  policy,
  onRequestEdit,
}: {
  policy: Policy;
  onRequestEdit: (policy: Policy) => void;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const agent = policy.agentId ? api.users.list(policy.tenantId).find((u) => u.id === policy.agentId) : undefined;
  const payments = api.payments.listByPolicy(policy.id);
  const documents = api.documents.listByEntity({ policyId: policy.id });
  const customerVisibleDocs = documents.filter((d) => d.visibility !== "employee_only" && d.visibility !== "master_only");

  const AssetIcon = ASSET_ICON[asset?.type ?? "other"];
  const policyTypeLabel = asset ? api.helpers.assetTypeLabel(asset.type) : "Policy";

  // Group documents by category, newest first within each group.
  const docGroups = useMemo(() => {
    const usedIds = new Set<string>();
    const groups: { label: string; docs: Document[] }[] = [];
    for (const g of DOC_GROUP_ORDER) {
      const matched = customerVisibleDocs
        .filter((d) => g.types.includes(d.type as string))
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
      matched.forEach((d) => usedIds.add(d.id));
      if (matched.length) groups.push({ label: g.label, docs: matched });
    }
    const leftover = customerVisibleDocs
      .filter((d) => !usedIds.has(d.id))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    if (leftover.length) groups.push({ label: "Other documents", docs: leftover });
    return groups;
  }, [customerVisibleDocs]);

  function handleDownload(d: Document) {
    // Demo: we don't have real bytes, so we render a small text
    // stub describing the file and trigger a browser download.
    // The audit-trail call still fires in production-equivalent fashion.
    const stub = [
      `${d.fileName}`,
      `Type:   ${api.helpers.documentTypeLabel(d.type as string)}`,
      `Uploaded: ${fmt.dateTime(d.uploadedAt)}`,
      ``,
      `In production, this is a binary download from the carrier`,
      `document service. The demo records the audit-trail entry only.`,
    ].join("\n");
    const blob = new Blob([stub], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = d.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    api.helpers.logDocumentDownload({
      tenantId: d.tenantId,
      documentId: d.id,
      actorId: user?.id,
      actorRole: user?.role,
      customerId: d.customerId,
      policyId: d.policyId,
      assetId: d.assetId,
      fileName: d.fileName,
    });
  }

  function handleView(d: Document) {
    // Stub viewer for the demo. In production this opens a signed
    // viewer URL in a new tab. Audit log still fires.
    window.alert(
      `${d.fileName}\n\n` +
        `${api.helpers.documentTypeLabel(d.type as string)}\n` +
        `Uploaded ${fmt.dateTime(d.uploadedAt)}\n\n` +
        `In production, this opens an in-browser PDF viewer. The audit-log entry has been recorded.`
    );
    api.helpers.logDocumentDownload({
      tenantId: d.tenantId,
      documentId: d.id,
      actorId: user?.id,
      actorRole: user?.role,
      customerId: d.customerId,
      policyId: d.policyId,
      assetId: d.assetId,
      fileName: d.fileName,
    });
  }

  return (
    <div className="rounded-lg border border-ink-100 bg-white shadow-luxe overflow-hidden">
      {/* Summary row — always visible */}
      <div className="p-4 sm:p-5 flex items-start gap-4 flex-wrap">
        <CarrierLogo carrier={carrier} AssetIcon={AssetIcon} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-display text-xl text-ink-900 truncate">
                  {asset?.label ?? carrier?.name ?? "Policy"}
                </h3>
                <Badge tone="neutral">{policyTypeLabel}</Badge>
              </div>
              <div className="text-xs text-ink-500 font-mono mt-1">{fmt.policyRef(policy)}</div>
              <div className="text-xs text-ink-600 mt-1">{carrier?.name ?? "—"}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PolicyStatusBadge status={policy.status} />
              <button
                type="button"
                className="btn-primary text-xs whitespace-nowrap"
                onClick={() => onRequestEdit(policy)}
                title="Open the policy change request wizard"
              >
                <Pencil className="h-3.5 w-3.5" /> Request policy change
              </button>
            </div>
          </div>

          <dl className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1.5 text-xs">
            <SummaryRow label="Effective" value={fmt.date(policy.effectiveDate)} />
            <SummaryRow
              label="Renewal"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {fmt.date(policy.renewalDate)}
                  <RenewalStatusBadge status={policy.renewalStatus} />
                </span>
              }
            />
            <SummaryRow
              label="Premium"
              value={
                <span>
                  {policy.finalPremium
                    ? fmt.money(policy.finalPremium)
                    : policy.premiumEstimate
                    ? `${fmt.money(policy.premiumEstimate)} (est)`
                    : "—"}
                  {policy.paymentFrequency && (
                    <span className="text-ink-400">
                      {" "}/ {api.helpers.paymentFrequencyLabel(policy.paymentFrequency)}
                    </span>
                  )}
                </span>
              }
            />
            <SummaryRow
              label="Agent"
              value={
                agent ? (
                  <span>
                    {agent.name}
                    {agent.email && (
                      <a
                        className="text-gold-700 hover:underline ml-1.5"
                        href={`mailto:${agent.email}`}
                      >
                        ({agent.email})
                      </a>
                    )}
                  </span>
                ) : (
                  "Unassigned"
                )
              }
            />
          </dl>
        </div>
      </div>

      <button
        type="button"
        className="w-full px-4 sm:px-5 py-2 border-t border-ink-100 text-xs text-ink-600 hover:bg-ink-50/60 inline-flex items-center justify-center gap-1.5"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" /> Hide details
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" /> Show full policy detail
          </>
        )}
      </button>

      {/* Expandable body */}
      {expanded && (
        <div className="px-4 sm:px-5 py-5 border-t border-ink-100 space-y-6 bg-ink-50/30">
          {/* Asset details */}
          {asset && Object.keys(asset.details ?? {}).length > 0 && (
            <Section title="Insured asset">
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {Object.entries(asset.details as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-ink-500 capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
                    <dd className="text-ink-900 text-right">{maskSensitive(k, String(v))}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          {/* Coverages */}
          {policy.coverages && policy.coverages.length > 0 && (
            <Section title="Coverage breakdown">
              <ul className="divide-y divide-ink-100 text-sm">
                {policy.coverages.map((c, i) => (
                  <li key={i} className="py-2 flex flex-wrap items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-ink-900">{c.name}</div>
                      {c.description && (
                        <div className="text-xs text-ink-500 mt-0.5">{c.description}</div>
                      )}
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      {typeof c.limit === "number" && (
                        <div>
                          <span className="text-ink-500 text-xs">Limit </span>
                          <span className="font-semibold">{fmt.money(c.limit)}</span>
                        </div>
                      )}
                      {typeof c.deductible === "number" && (
                        <div className="text-xs text-ink-600">
                          Deductible {fmt.money(c.deductible)}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Endorsements */}
          {policy.endorsements && policy.endorsements.length > 0 && (
            <Section title="Endorsements & riders">
              <ul className="divide-y divide-ink-100 text-sm">
                {policy.endorsements.map((e, i) => (
                  <li key={i} className="py-2">
                    <div className="font-medium text-ink-900">{e.name}</div>
                    {e.description && (
                      <div className="text-xs text-ink-500 mt-0.5">{e.description}</div>
                    )}
                    {e.addedAt && (
                      <div className="text-[11px] text-ink-400 mt-0.5">
                        Added {fmt.date(e.addedAt)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Exclusions */}
          {policy.exclusions && policy.exclusions.length > 0 && (
            <Section title="What's not covered (exclusions)">
              <ul className="list-disc pl-5 text-sm text-ink-700 space-y-1">
                {policy.exclusions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Section>
          )}

          {/* Additional insureds + beneficiaries */}
          {((policy.additionalInsureds && policy.additionalInsureds.length > 0) ||
            (policy.beneficiaries && policy.beneficiaries.length > 0)) && (
            <Section title="Listed parties">
              <div className="grid sm:grid-cols-2 gap-6">
                {policy.additionalInsureds && policy.additionalInsureds.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
                      Additional insureds
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {policy.additionalInsureds.map((p, i) => (
                        <li key={i}>
                          <span className="text-ink-900 font-medium">{p.name}</span>
                          {p.relationship && (
                            <span className="text-ink-500"> — {p.relationship}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {policy.beneficiaries && policy.beneficiaries.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
                      Beneficiaries
                    </div>
                    <ul className="space-y-1.5 text-sm">
                      {policy.beneficiaries.map((b, i) => (
                        <li key={i}>
                          <span className="text-ink-900 font-medium">{b.name}</span>
                          {b.relationship && (
                            <span className="text-ink-500"> — {b.relationship}</span>
                          )}
                          {typeof b.percentage === "number" && (
                            <span className="text-ink-600"> ({b.percentage}%)</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Premium breakdown */}
          {policy.premiumBreakdown && (
            <Section title="Premium breakdown">
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {typeof policy.premiumBreakdown.base === "number" && (
                  <PremiumRow label="Base premium" value={fmt.money(policy.premiumBreakdown.base)} />
                )}
                {typeof policy.premiumBreakdown.fees === "number" && (
                  <PremiumRow label="Fees" value={fmt.money(policy.premiumBreakdown.fees)} />
                )}
                {typeof policy.premiumBreakdown.taxes === "number" && (
                  <PremiumRow label="Taxes" value={fmt.money(policy.premiumBreakdown.taxes)} />
                )}
                {typeof policy.premiumBreakdown.total === "number" && (
                  <PremiumRow
                    label="Total"
                    value={<strong>{fmt.money(policy.premiumBreakdown.total)}</strong>}
                  />
                )}
              </dl>
            </Section>
          )}

          {/* Payment history + next due */}
          {(payments.length > 0 ||
            policy.nextPaymentDueDate ||
            typeof policy.nextPaymentAmount === "number") && (
            <Section title="Payments">
              {(policy.nextPaymentDueDate || typeof policy.nextPaymentAmount === "number") && (
                <div className="rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-gold-800 mb-3 flex items-center justify-between gap-3 flex-wrap">
                  <span>
                    Next payment{" "}
                    {policy.nextPaymentDueDate ? (
                      <>due <strong>{fmt.date(policy.nextPaymentDueDate)}</strong></>
                    ) : null}
                  </span>
                  {typeof policy.nextPaymentAmount === "number" && (
                    <strong className="tabular-nums">{fmt.money(policy.nextPaymentAmount)}</strong>
                  )}
                </div>
              )}
              {payments.length === 0 ? (
                <div className="text-sm text-ink-400">No payment history yet.</div>
              ) : (
                <ul className="divide-y divide-ink-100 text-sm">
                  {payments
                    .slice()
                    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                    .map((p) => (
                      <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                        <span className="text-ink-700">{fmt.date(p.createdAt)}</span>
                        <span className="tabular-nums font-medium">{fmt.money(p.amount)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Section>
          )}

          {/* Documents */}
          <Section title={`Documents (${customerVisibleDocs.length})`}>
            {docGroups.length === 0 ? (
              <div className="text-sm text-ink-400">No documents on file yet.</div>
            ) : (
              <div className="space-y-4">
                {docGroups.map((g) => (
                  <div key={g.label}>
                    <div className="text-xs uppercase tracking-wider text-ink-500 mb-2">
                      {g.label}
                    </div>
                    <ul className="divide-y divide-ink-100">
                      {g.docs.map((d) => (
                        <li key={d.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <DocIcon fileType={d.fileType} />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-ink-900 truncate">{d.fileName}</div>
                              <div className="text-[11px] text-ink-500">
                                {api.helpers.documentTypeLabel(d.type as string)} ·{" "}
                                Uploaded {fmt.date(d.uploadedAt)}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              className="btn-ghost text-xs"
                              onClick={() => handleView(d)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn-outline text-xs"
                              onClick={() => handleDownload(d)}
                            >
                              <Download className="h-3.5 w-3.5" /> Download
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-md border border-ink-100 p-4">
      <CardHeader title={title} />
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right">{value}</dd>
    </div>
  );
}

function PremiumRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right tabular-nums">{value}</dd>
    </div>
  );
}

function DocIcon({ fileType }: { fileType?: string }) {
  if (fileType?.startsWith("image/")) return <FileImage className="h-4 w-4 text-ink-400 shrink-0" />;
  return <FileText className="h-4 w-4 text-ink-400 shrink-0" />;
}

function CarrierLogo({
  carrier,
  AssetIcon,
}: {
  carrier?: { name: string; logoUrl?: string } | undefined;
  AssetIcon: React.ComponentType<{ className?: string }>;
}) {
  if (carrier?.logoUrl) {
    return (
      <div className="h-14 w-14 shrink-0 rounded-md bg-white border border-ink-100 flex items-center justify-center overflow-hidden">
        <img src={carrier.logoUrl} alt={carrier.name} className="max-h-12 max-w-12 object-contain" />
      </div>
    );
  }
  const initials =
    carrier?.name
      ?.split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() ?? "—";
  return (
    <div className="h-14 w-14 shrink-0 rounded-md bg-gold-50 border border-gold-200 flex flex-col items-center justify-center text-gold-700">
      <AssetIcon className="h-5 w-5" />
      <span className="text-[10px] font-semibold mt-0.5 tracking-wider">{initials}</span>
    </div>
  );
}

// Sensitive PII shown inside the asset details block stays masked
// per the spec — even though customers only see their own policies,
// values like SSNs and driver's-license numbers should not echo back
// in full. Masks anything that looks like an SSN or DL.
function maskSensitive(key: string, value: string): string {
  const k = key.toLowerCase();
  if (/(ssn|tax|driver_?license|dln|dl_?number)/.test(k)) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) return `••• •• ${digits.slice(-4)}`;
    return "•••";
  }
  return value;
}