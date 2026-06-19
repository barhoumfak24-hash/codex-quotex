import { useState } from "react";
import {
  Check,
  ExternalLink,
  FileText,
  Mail,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { useTenant } from "@/lib/tenant";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt, renewalStatusLabel } from "@/lib/format";
import type { Renewal, RenewalStatus } from "@/types";

type RenewalFilter =
  | "all"
  | "upcoming"
  | "customer_notified"
  | "waiting_on_customer"
  | "submitted_for_renewal"
  | "not_renewed"
  | "renewed"
  | "not_due"
  | "lost";

const RENEWAL_FILTERS: Array<{ id: RenewalFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "upcoming", label: "Upcoming" },
  { id: "customer_notified", label: "Customer Notified" },
  { id: "waiting_on_customer", label: "Waiting" },
  { id: "submitted_for_renewal", label: "Submitted" },
  { id: "not_renewed", label: "Non-renewed" },
  { id: "renewed", label: "Renewed" },
  { id: "not_due", label: "Not Due" },
  { id: "lost", label: "Lost" },
];

const replacementStatusLabel: Record<NonNullable<Renewal["replacementStatus"]>, string> = {
  not_started: "Not started",
  marketing: "Rewrite in market",
  quoted: "Replacement quoted",
  replacement_bound: "Replacement bound",
  client_declined: "Client declined",
};

function renewalSortPriority(status: RenewalStatus) {
  if (status === "not_renewed") return 0;
  if (status === "upcoming") return 1;
  if (status === "waiting_on_customer" || status === "submitted_for_renewal") return 2;
  if (status === "customer_notified" || status === "agent_notified") return 3;
  if (status === "renewed") return 4;
  if (status === "lost") return 5;
  return 6;
}

export function RenewalsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [, setRev] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RenewalFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [openRenewalId, setOpenRenewalId] = useState<string | null>(null);
  const [sentBanner, setSentBanner] = useState<string | null>(null);
  if (!agency || !user) return null;
  const userId = user.id;

  const visibleIds = new Set(
    api.customers
      .listVisible(agency.id, { id: user.id, role: user.role })
      .map((c) => c.id)
  );

  // Upcoming renewals are pinned to the top. Agents only see renewals
  // for policies belonging to their assigned clients.
  const renewals = [...api.renewals.listByTenant(agency.id)]
    .filter((r) => {
      const policy = api.policies.get(r.policyId);
      return policy ? visibleIds.has(policy.customerId) : false;
    })
    .filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;

      const policy = api.policies.get(r.policyId);
      const customer = policy ? api.customers.get(policy.customerId) : null;
      const carrier = policy ? api.carriers.get(policy.carrierId) : null;
      const asset = policy ? api.assets.get(policy.assetId) : null;
      const text = [
        customer?.name,
        api.helpers.clientCodeFor(customer),
        policy?.policyNumber,
        fmt.policyRef(policy),
        asset?.label,
        asset ? api.helpers.assetTypeLabel(asset.type) : undefined,
        api.helpers.departmentLabel(policy),
        carrier?.name,
        r.status,
        renewalStatusLabel[r.status],
        r.renewalDate,
        policy?.effectiveDate,
        r.nonRenewalReason,
        r.nonRenewalCarrierReference,
        r.replacementStatus ? replacementStatusLabel[r.replacementStatus] : undefined,
        r.replacementStrategy,
        ...(r.nonRenewalNotes ?? []),
      ];

      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (!text.filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
      }

      if (!customFilter.trim()) return true;
      return matchesAiCustomFilter(customFilter, {
        text,
        flags: {
          renewal: true,
          upcoming: r.status === "upcoming",
          pending:
            r.status === "upcoming" ||
            r.status === "customer_notified" ||
            r.status === "agent_notified" ||
            r.status === "waiting_on_customer" ||
            r.status === "submitted_for_renewal",
          active: r.status !== "renewed" && r.status !== "not_renewed" && r.status !== "lost",
          renewed: r.status === "renewed",
          lost: r.status === "lost" || r.status === "not_renewed",
          nonrenewed: r.status === "not_renewed",
          waiting: r.status === "waiting_on_customer",
          submitted: r.status === "submitted_for_renewal",
          needsFollowUp: r.status === "customer_notified" || r.status === "agent_notified" || r.status === "waiting_on_customer",
          personal: (policy?.department ?? "personal") === "personal",
          commercial: policy?.department === "commercial",
        },
        numbers: [policy?.finalPremium, policy?.premiumEstimate],
      });
    })
    .sort((a, b) => {
      const ra = renewalSortPriority(a.status);
      const rb = renewalSortPriority(b.status);
      if (ra !== rb) return ra - rb;
      return a.renewalDate.localeCompare(b.renewalDate);
    });

  const refresh = () => setRev((r) => r + 1);
  const openRenewal = renewals.find((r) => r.id === openRenewalId) ?? null;

  function sendReminder(renewalId: string, channel: "email") {
    const renewal = api.renewals.get(renewalId);
    const result =
      renewal?.status === "not_renewed"
        ? api.renewals.sendNonRenewalSummary({ renewalId, channel, sentById: userId })
        : api.renewals.sendReminder({ renewalId, channel, sentById: userId });
    if (result.reminderSent) {
      setSentBanner(
        renewal?.status === "not_renewed"
          ? `${channel.toUpperCase()} non-renewal summary logged. Check the client timeline.`
          : `${channel.toUpperCase()} reminder logged. Check the client timeline.`
      );
      window.setTimeout(() => setSentBanner(null), 3500);
      refresh();
    }
  }

  function markRenewed(renewalId: string) {
    if (!confirm("Mark this renewal as renewed? It'll drop off the Renewals alert.")) return;
    api.renewals.markRenewed(renewalId);
    setPolicyRenewalStatus(renewalId, "renewed");
    refresh();
  }

  function markNotDue(renewalId: string) {
    api.renewals.markNotDue(renewalId);
    setPolicyRenewalStatus(renewalId, "not_due");
    refresh();
  }

  function updateRenewal(renewalId: string, patch: Partial<Renewal>) {
    api.renewals.update(renewalId, patch);
    if (patch.status) setPolicyRenewalStatus(renewalId, patch.status);
    refresh();
  }

  function setPolicyRenewalStatus(renewalId: string, status: RenewalStatus) {
    const renewal = api.renewals.get(renewalId);
    if (renewal) api.policies.update(renewal.policyId, { renewalStatus: status });
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Renewals</h1>
          <p className="mt-1 text-sm text-ink-500">
            AI-tracked renewal pipeline. Reminders are logged in each client's remarks.
          </p>
        </div>
      </div>

      {sentBanner && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {sentBanner}
        </div>
      )}
      <RenewalDetailModal
        renewal={openRenewal}
        onClose={() => setOpenRenewalId(null)}
        onSendReminder={sendReminder}
        onMarkRenewed={markRenewed}
        onMarkNotDue={markNotDue}
        onUpdateRenewal={updateRenewal}
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, policy, asset, carrier, date, or status..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {RENEWAL_FILTERS.map((item) => (
          <button
            type="button"
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`min-h-8 rounded-md border px-3 py-1.5 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
              filter === item.id
                ? "border-ink-900 bg-ink-900 text-white shadow-sm"
                : "border-ink-200 bg-white text-ink-700 shadow-sm hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900 hover:shadow-md"
            }`}
          >
            {item.label}
          </button>
        ))}
        <AiCustomFilterChip
          value={customFilter}
          onChange={setCustomFilter}
          placeholder="ex: upcoming, Chubb, personal, waiting, premium over 5k"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[14%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[13%]" />
            <col className="w-[15%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy / Asset</th>
              <th className="px-4 py-4">Carrier</th>
              <th className="px-4 py-4">Expiration</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4">Replacement</th>
              <th className="px-4 py-4">Reason / Next Step</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {renewals.map((r) => {
              const policy = api.policies.get(r.policyId);
              const customer = policy ? api.customers.get(policy.customerId) : null;
              const carrier = policy ? api.carriers.get(policy.carrierId) : null;
              const asset = policy ? api.assets.get(policy.assetId) : null;
              const isNonRenewed = r.status === "not_renewed";
              const replacementLabel = r.replacementStatus
                ? replacementStatusLabel[r.replacementStatus]
                : isNonRenewed
                ? "Not started"
                : "-";
              const reasonText =
                r.nonRenewalReason ??
                r.retentionActions?.[0] ??
                "Review coverage, documents, and carrier terms before the renewal date.";
              return (
                <tr
                  key={r.id}
                  className={isNonRenewed ? "bg-rose-50/40 hover:bg-rose-50/70" : "hover:bg-ink-50/60"}
                >
                  <td className="px-4 py-5 align-middle">
                    <div className="flex min-w-0 items-center gap-1.5 break-words text-sm font-semibold leading-snug text-ink-900">
                      <span>{customer?.name ?? "-"}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] font-normal text-ink-400">
                      {api.helpers.clientCodeFor(customer)}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="font-mono text-sm font-semibold text-ink-900">{fmt.policyRef(policy)}</div>
                    <div className="mt-0.5 text-[11px] text-ink-400">
                      {asset?.label ?? "-"} · {api.helpers.departmentLabel(policy)}
                    </div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="line-clamp-2 text-sm text-ink-700">{carrier?.name ?? "-"}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">{fmt.date(r.renewalDate)}</td>
                  <td className="px-4 py-5 align-middle">
                    <RenewalStatusBadge status={r.status as RenewalStatus} />
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="text-sm font-medium text-ink-800">{replacementLabel}</div>
                    {r.nonRenewalCarrierReference && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
                        {r.nonRenewalCarrierReference}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="line-clamp-2 text-sm text-ink-700">{reasonText}</div>
                  </td>
                  <td className="px-4 py-5 align-middle">
                    <div className="flex justify-end">
                      <Button size="xs" onClick={() => setOpenRenewalId(r.id)}>
                        Open
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {renewals.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-sm text-ink-400">
                  {query.trim() || customFilter.trim() || filter !== "all"
                    ? "No renewals match the current filters."
                    : "No renewals tracked."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function RenewalDetailModal({
  renewal,
  onClose,
  onSendReminder,
  onMarkRenewed,
  onMarkNotDue,
  onUpdateRenewal,
}: {
  renewal: Renewal | null;
  onClose: () => void;
  onSendReminder: (renewalId: string, channel: "email") => void;
  onMarkRenewed: (renewalId: string) => void;
  onMarkNotDue: (renewalId: string) => void;
  onUpdateRenewal: (renewalId: string, patch: Partial<Renewal>) => void;
}) {
  if (!renewal) return null;
  const policy = api.policies.get(renewal.policyId);
  const customer = policy ? api.customers.get(policy.customerId) : null;
  const carrier = policy ? api.carriers.get(policy.carrierId) : null;
  const asset = policy ? api.assets.get(policy.assetId) : null;
  const upcoming = renewal.status === "upcoming";
  const isNonRenewed = renewal.status === "not_renewed";
  const carrierPortalUrl = carrier?.agentPortalUrl ?? carrier?.billingPortalUrl ?? carrier?.claimsUrl;
  const recommendedCarriers = (renewal.recommendedCarrierIds ?? [])
    .map((id) => api.carriers.get(id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));

  return (
    <Modal
      open={!!renewal}
      onClose={onClose}
      title={isNonRenewed ? "Non-renewal details" : "Renewal details"}
      size={isNonRenewed ? "xl" : "lg"}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-ink-100 pb-3">
          {isNonRenewed && carrierPortalUrl && (
            <Button
              size="sm"
              href={carrierPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              View on carrier
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onSendReminder(renewal.id, "email")}
            disabled={!customer}
            icon={<Mail className="h-3.5 w-3.5" />}
            title={
              isNonRenewed
                ? "Log a non-renewal summary email and add it to the client timeline"
                : "Log an email reminder and add it to the client timeline"
            }
          >
            {isNonRenewed ? "Send notice summary" : "Email reminder"}
          </Button>
          {isNonRenewed && renewal.replacementStatus !== "replacement_bound" && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onUpdateRenewal(renewal.id, { replacementStatus: "marketing" })}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Start rewrite
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={() =>
                  onUpdateRenewal(renewal.id, {
                    replacementStatus: "replacement_bound",
                    status: "renewed",
                  })
                }
                icon={<Check className="h-3.5 w-3.5" />}
              >
                Mark replaced
              </Button>
            </>
          )}
          {upcoming && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onMarkRenewed(renewal.id)}
                icon={<Check className="h-3.5 w-3.5" />}
              >
                Mark renewed
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onMarkNotDue(renewal.id)}
                icon={<XCircle className="h-3.5 w-3.5" />}
                title="Move out of Upcoming without renewing"
              >
                Not due
              </Button>
            </>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label">Client</div>
            <div className="font-medium text-ink-900">{customer?.name ?? "-"}</div>
            <div className="font-mono text-xs text-ink-400">{api.helpers.clientCodeFor(customer)}</div>
          </div>
          <div>
            <div className="label">Policy</div>
            {policy ? (
              <Button size="xs" to={`/employee/policies/${policy.id}`}>
                Open policy
              </Button>
            ) : (
              <div className="text-sm text-ink-400">Policy unavailable</div>
            )}
            <div className="mt-1 font-mono text-xs text-ink-500">{fmt.policyRef(policy)}</div>
          </div>
          <div>
            <div className="label">Asset</div>
            <div className="font-medium text-ink-900">{asset?.label ?? "-"}</div>
            <div className="text-xs text-ink-500">
              {asset ? api.helpers.assetTypeLabel(asset.type) : ""}
            </div>
          </div>
          <div>
            <div className="label">Carrier</div>
            <div className="font-medium text-ink-900">{carrier?.name ?? "-"}</div>
          </div>
          <div>
            <div className="label">Effective</div>
            <div className="text-sm text-ink-700">{fmt.date(policy?.effectiveDate)}</div>
          </div>
          <div>
            <div className="label">Expiration</div>
            <div className="text-sm text-ink-700">{fmt.date(renewal.renewalDate)}</div>
          </div>
          <div>
            <div className="label">Status</div>
            <RenewalStatusBadge status={renewal.status as RenewalStatus} />
          </div>
        </div>

        {isNonRenewed && (
          <div className="space-y-4 rounded-lg border border-rose-100 bg-rose-50/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 text-sm font-semibold text-rose-800">
                  <ShieldAlert className="h-4 w-4" />
                  Carrier non-renewal file
                </div>
                <p className="mt-1 text-sm text-ink-600">
                  Keep the policy record intact, work the replacement path here, and use the carrier
                  link or notice document when you need to verify the source.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {renewal.nonRenewalNoticeUrl && (
                  <Button
                    size="xs"
                    href={renewal.nonRenewalNoticeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<FileText className="h-3.5 w-3.5" />}
                  >
                    Open notice
                  </Button>
                )}
                {carrierPortalUrl && (
                  <Button
                    size="xs"
                    href={carrierPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    icon={<ExternalLink className="h-3.5 w-3.5" />}
                  >
                    Carrier workspace
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-ink-100 bg-white p-3">
                <div className="label">Notice date</div>
                <div className="text-sm font-semibold text-ink-900">
                  {fmt.date(renewal.nonRenewalNoticeDate)}
                </div>
              </div>
              <div className="rounded-md border border-ink-100 bg-white p-3">
                <div className="label">Effective non-renewal</div>
                <div className="text-sm font-semibold text-ink-900">
                  {fmt.date(renewal.nonRenewalEffectiveDate ?? renewal.renewalDate)}
                </div>
              </div>
              <div className="rounded-md border border-ink-100 bg-white p-3">
                <div className="label">Carrier reference</div>
                <div className="truncate font-mono text-xs font-semibold text-ink-900">
                  {renewal.nonRenewalCarrierReference ?? "-"}
                </div>
              </div>
              <div className="rounded-md border border-ink-100 bg-white p-3">
                <div className="label">Replacement status</div>
                <div className="text-sm font-semibold text-ink-900">
                  {renewal.replacementStatus
                    ? replacementStatusLabel[renewal.replacementStatus]
                    : "Not started"}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-md border border-ink-100 bg-white p-4">
                <div className="label">Why it was not renewed</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">
                  {renewal.nonRenewalReason ?? "No carrier reason has been recorded yet."}
                </p>
                <div className="mt-4 label">Replacement strategy</div>
                <p className="mt-1 text-sm leading-relaxed text-ink-700">
                  {renewal.replacementStrategy ??
                    "Start a rewrite, confirm updated exposure details, and document carrier responses here."}
                </p>
              </div>

              <div className="rounded-md border border-ink-100 bg-white p-4">
                <div className="label">Recommended rewrite markets</div>
                <div className="mt-2 space-y-2">
                  {recommendedCarriers.length > 0 ? (
                    recommendedCarriers.map((recommendedCarrier) => (
                      <div
                        key={recommendedCarrier.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-ink-100 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-ink-800">
                          {recommendedCarrier.name}
                        </span>
                        {recommendedCarrier.agentPortalUrl && (
                          <Button
                            size="xs"
                            href={recommendedCarrier.agentPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open
                          </Button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-ink-400">No rewrite markets selected yet.</div>
                  )}
                </div>
              </div>
            </div>

            {((renewal.retentionActions?.length ?? 0) + (renewal.nonRenewalNotes?.length ?? 0) > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-ink-100 bg-white p-4">
                  <div className="label">Action checklist</div>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
                    {(renewal.retentionActions ?? []).map((action) => (
                      <li key={action} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-600" />
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-md border border-ink-100 bg-white p-4">
                  <div className="label">Notes</div>
                  <ul className="mt-2 space-y-1.5 text-sm text-ink-700">
                    {(renewal.nonRenewalNotes ?? []).map((note) => (
                      <li key={note} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
