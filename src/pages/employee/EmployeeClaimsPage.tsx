import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  ExternalLink,
  LifeBuoy,
  Link as LinkIcon,
  Mail,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { AiCustomFilterChip } from "@/components/ui/AiCustomFilterChip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import { assetDisplayName } from "@/lib/assetDisplay";
import { matchesAiCustomFilter } from "@/lib/aiCustomFilters";
import { fmt } from "@/lib/format";
import type { Asset, Carrier, Claim, CustomerProfile, Policy } from "@/types";

type ClaimStatus = Claim["status"];
type ClaimFilter = "all" | "opened" | "in_review" | "closed" | "missing_link" | "needs_follow_up";

type ClaimRow = {
  claim: Claim;
  customer?: CustomerProfile;
  policy?: Policy;
  asset?: Asset;
  carrier?: Carrier;
  claimsUrl?: string;
};

const CLAIM_FILTERS: Array<{ id: ClaimFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "opened", label: "Open" },
  { id: "in_review", label: "In Review" },
  { id: "closed", label: "Closed" },
  { id: "missing_link", label: "Missing Carrier Link" },
  { id: "needs_follow_up", label: "Needs Follow-Up" },
];

const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  opened: "Open",
  in_review: "In review",
  closed: "Closed",
};

function claimStatusTone(status: ClaimStatus): "success" | "warn" | "info" {
  if (status === "closed") return "success";
  if (status === "in_review") return "info";
  return "warn";
}

function statusRank(status: ClaimStatus): number {
  return status === "opened" ? 0 : status === "in_review" ? 1 : 2;
}

export function EmployeeClaimsPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);
  const requestedClaimId = searchParams.get("claim");

  if (!agency || !user) return null;
  const agencyId = agency.id;
  const userId = user.id;

  const visibleCustomers = api.customers.listVisible(agencyId, { id: userId, role: user.role });
  const visibleCustomerIds = new Set(visibleCustomers.map((c) => c.id));
  const rows: ClaimRow[] = api.claims
    .listByTenant(agencyId)
    .filter((claim) => visibleCustomerIds.has(claim.customerId))
    .map((claim) => {
      const customer = api.customers.get(claim.customerId);
      const policy = api.policies.get(claim.policyId);
      const asset = policy ? api.assets.get(policy.assetId) : undefined;
      const carrier = api.carriers.get(claim.carrierId);
      return {
        claim,
        customer,
        policy,
        asset,
        carrier,
        claimsUrl: claim.carrierClaimsUrl ?? carrier?.claimsUrl,
      };
    })
    .sort((a, b) => {
      const statusDiff = statusRank(a.claim.status) - statusRank(b.claim.status);
      if (statusDiff !== 0) return statusDiff;
      return a.claim.openedAt < b.claim.openedAt ? 1 : -1;
    });

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filter === "opened") return row.claim.status === "opened";
        if (filter === "in_review") return row.claim.status === "in_review";
        if (filter === "closed") return row.claim.status === "closed";
        if (filter === "missing_link") return !row.claimsUrl;
        if (filter === "needs_follow_up") {
          return row.claim.status !== "closed" && !row.claim.externalClaimNumber;
        }
        return true;
      })
      .filter((row) => {
        if (!q) return true;
        return claimSearchText(row).toLowerCase().includes(q);
      })
      .filter((row) => {
        if (!customFilter.trim()) return true;
        return matchesAiCustomFilter(customFilter, {
          text: claimSearchParts(row),
          flags: {
            active: row.claim.status !== "closed",
            claim: true,
            openClaim: row.claim.status !== "closed",
            closedClaim: row.claim.status === "closed",
            inReview: row.claim.status === "in_review",
            needsReview: row.claim.status === "in_review",
            pending: row.claim.status !== "closed" && !row.claim.externalClaimNumber,
            missing: !row.claimsUrl || !row.claim.externalClaimNumber,
            missingLink: !row.claimsUrl,
            missingClaimNumber: !row.claim.externalClaimNumber,
            needsFollowUp: row.claim.status !== "closed" && !row.claim.externalClaimNumber,
            personal: (row.policy?.department ?? "personal") === "personal",
            commercial: row.policy?.department === "commercial",
          },
          numbers: [row.claim.lossAmountUsd, row.policy?.finalPremium, row.policy?.premiumEstimate],
        });
      });
  }, [rows, filter, query, customFilter]);
  const openClaimRow = rows.find((row) => row.claim.id === openClaimId) ?? null;

  useEffect(() => {
    if (!requestedClaimId) return;
    if (rows.some((row) => row.claim.id === requestedClaimId)) {
      setOpenClaimId(requestedClaimId);
    }
  }, [requestedClaimId, rows]);

  function closeClaimDetail() {
    setOpenClaimId(null);
    if (requestedClaimId) {
      const next = new URLSearchParams(searchParams);
      next.delete("claim");
      setSearchParams(next, { replace: true });
    }
  }

  function setClaimStatus(row: ClaimRow, status: ClaimStatus) {
    api.claims.update(row.claim.id, {
      status,
      closedAt: status === "closed" ? new Date().toISOString() : undefined,
    });
    api.status.create({
      tenantId: agencyId,
      source: "agent",
      message: `Claim status changed to ${CLAIM_STATUS_LABEL[status]} for ${
        (row.asset ? assetDisplayName(row.asset) : row.customer?.name) ?? "client"
      }.`,
      visibility: "customer_visible",
      customerId: row.claim.customerId,
      policyId: row.claim.policyId,
      assetId: row.asset?.id,
      claimId: row.claim.id,
      createdById: userId,
    });
    refresh();
  }

  function stageCarrierAutomation(row: ClaimRow) {
    const claimsUrl = row.claimsUrl;
    if (!claimsUrl) {
      setNotice("Carrier claims URL is missing. Add the carrier link under Carrier library first.");
      return;
    }
    if (row.claim.status === "opened") {
      api.claims.update(row.claim.id, {
        status: "in_review",
        carrierClaimsUrl: claimsUrl,
      });
    }
    api.claims.draftClaimFollowUp({
      tenantId: agencyId,
      customerId: row.claim.customerId,
      carrierId: row.carrier?.id,
      carrierName: row.carrier?.name ?? "Carrier",
      claimsUrl,
      assetId: row.asset?.id,
      policyId: row.policy?.id,
      claimId: row.claim.id,
    });
    setNotice("AI staged the client follow-up, logged the carrier handoff, and moved the claim into review.");
    refresh();
  }

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl">Claims</h1>
          <p className="text-ink-500 text-sm mt-1">
            Open claims, carrier workspaces, client follow-ups, and claim documents in one queue.
          </p>
        </div>
        <button type="button" className="btn-gold" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add claim
        </button>
      </div>

      <AddClaimModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        tenantId={agencyId}
        userId={userId}
        customers={visibleCustomers}
        onCreated={() => {
          refresh();
          setNotice("Claim added. AI connected the policy, carrier workspace, and client timeline.");
        }}
      />
      <ClaimDetailModal
        row={openClaimRow}
        onClose={closeClaimDetail}
        onStageCarrierAutomation={stageCarrierAutomation}
        onStatusChange={setClaimStatus}
      />

      {notice && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-sm text-gold-900">
          <span>{notice}</span>
          <button type="button" className="text-gold-900/70 hover:text-gold-900" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
        <input
          className="input pl-9 pr-9 text-sm"
          placeholder="Search by client, carrier, policy, asset, claim number, or status..."
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
        {CLAIM_FILTERS.map((item) => (
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
          placeholder="ex: open Chubb claims, no claim number, coastal, closed"
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[16%]" />
            <col className="w-[16%]" />
            <col className="w-[14%]" />
            <col className="w-[12%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
            <col className="w-[19%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wider text-ink-500">
              <th className="px-4 py-4">Client</th>
              <th className="px-4 py-4">Policy</th>
              <th className="px-4 py-4">Carrier</th>
              <th className="px-4 py-4">Claim #</th>
              <th className="px-4 py-4">Opened</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filteredRows.map((row) => (
              <tr key={row.claim.id} className="hover:bg-ink-50/60">
                <td className="px-4 py-5 align-middle">
                  <RouterLink
                    to={`/employee/clients/${row.claim.customerId}`}
                    className="break-words text-sm font-semibold leading-snug text-ink-900 hover:text-gold-700 hover:underline"
                  >
                    {row.customer?.name ?? "Client"}
                  </RouterLink>
                  <div className="truncate text-xs text-ink-500">{row.customer?.email}</div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <RouterLink
                    to={`/employee/policies/${row.claim.policyId}`}
                    className="font-mono text-sm font-semibold text-ink-900 hover:text-gold-700 hover:underline"
                  >
                    {fmt.policyRef(row.policy)}
                  </RouterLink>
                  <div className="mt-0.5 line-clamp-2 text-xs text-ink-500">
                    {row.asset ? assetDisplayName(row.asset) : "Asset not recorded"} - {row.policy ? api.helpers.departmentLabel(row.policy) : "Policy pending"}
                  </div>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="line-clamp-2">{row.carrier?.name ?? "Carrier"}</div>
                  {!row.claimsUrl && <div className="mt-1 text-xs text-alert">Missing link</div>}
                </td>
                <td className="px-4 py-5 align-middle">
                  {row.claim.externalClaimNumber ? (
                    <span className="font-mono text-xs">{row.claim.externalClaimNumber}</span>
                  ) : (
                    <span className="text-xs text-ink-400">Needed</span>
                  )}
                </td>
                <td className="px-4 py-5 align-middle text-ink-700">{fmt.relative(row.claim.openedAt)}</td>
                <td className="px-4 py-5 align-middle">
                  <Badge tone={claimStatusTone(row.claim.status)}>{CLAIM_STATUS_LABEL[row.claim.status]}</Badge>
                </td>
                <td className="px-4 py-5 align-middle">
                  <div className="flex justify-end">
                    <Button size="xs" onClick={() => setOpenClaimId(row.claim.id)}>
                      Open
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-ink-400">
                  {query.trim() ? `No claims match "${query}".` : "No claims match this view."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ClaimDetailModal({
  row,
  onClose,
  onStageCarrierAutomation,
  onStatusChange,
}: {
  row: ClaimRow | null;
  onClose: () => void;
  onStageCarrierAutomation: (row: ClaimRow) => void;
  onStatusChange: (row: ClaimRow, status: ClaimStatus) => void;
}) {
  if (!row) return null;
  return (
    <Modal open={!!row} onClose={onClose} title="Claim details" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-ink-100 pb-3">
          {row.claimsUrl ? (
            <Button
              size="sm"
              href={row.claimsUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              View on carrier
            </Button>
          ) : (
            <Button size="sm" to="/employee/carriers" icon={<LinkIcon className="h-3.5 w-3.5" />}>
              Add carrier link
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => onStageCarrierAutomation(row)}
            disabled={!row.claimsUrl}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            AI sync
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label">Client</div>
            <RouterLink
              to={`/employee/clients/${row.claim.customerId}#claims`}
              className="font-medium text-ink-900 hover:text-gold-700 hover:underline"
            >
              {row.customer?.name ?? "Client"}
            </RouterLink>
            <div className="text-xs text-ink-500">{row.customer?.email}</div>
          </div>
          <div>
            <div className="label">Policy / asset</div>
            <RouterLink
              to={`/employee/policies/${row.claim.policyId}`}
              className="font-medium text-ink-900 hover:text-gold-700 hover:underline"
            >
              {row.asset ? assetDisplayName(row.asset) : fmt.policyRef(row.policy)}
            </RouterLink>
            <div className="text-xs text-ink-500">{fmt.policyRef(row.policy)}</div>
          </div>
          <div>
            <div className="label">Carrier</div>
            <div className="font-medium text-ink-900">{row.carrier?.name ?? "Carrier"}</div>
            <div className={row.claimsUrl ? "text-xs text-emerald-700" : "text-xs text-alert"}>
              {row.claimsUrl ? "Carrier workspace connected" : "Carrier claims URL missing"}
            </div>
          </div>
          <div>
            <div className="label">Claim number</div>
            <div className="font-mono text-sm">
              {row.claim.externalClaimNumber ?? <span className="font-sans text-ink-400">Needed</span>}
            </div>
          </div>
          <div>
            <div className="label">Opened</div>
            <div className="text-sm text-ink-700">{fmt.dateTime(row.claim.openedAt)}</div>
          </div>
          <div>
            <div className="label">Status</div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={claimStatusTone(row.claim.status)}>{CLAIM_STATUS_LABEL[row.claim.status]}</Badge>
              <select
                className="input !h-8 !w-auto !py-1 text-xs"
                value={row.claim.status}
                onChange={(e) => onStatusChange(row, e.target.value as ClaimStatus)}
              >
                <option value="opened">Open</option>
                <option value="in_review">In review</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function AddClaimModal({
  open,
  onClose,
  tenantId,
  userId,
  customers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  userId: string;
  customers: CustomerProfile[];
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [status, setStatus] = useState<ClaimStatus>("opened");
  const [externalClaimNumber, setExternalClaimNumber] = useState("");
  const [carrierClaimsUrl, setCarrierClaimsUrl] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  const policies = useMemo(
    () => (customerId ? api.policies.listByCustomer(customerId) : []),
    [customerId, open]
  );
  const selectedPolicy = policies.find((policy) => policy.id === policyId);
  const selectedCarrier = selectedPolicy ? api.carriers.get(selectedPolicy.carrierId) : undefined;
  const selectedAsset = selectedPolicy ? api.assets.get(selectedPolicy.assetId) : undefined;

  useEffect(() => {
    if (!open) return;
    setCustomerId("");
    setPolicyId("");
    setStatus("opened");
    setExternalClaimNumber("");
    setCarrierClaimsUrl("");
    setAiPrompt("");
    setAiSummary(null);
  }, [open]);

  function selectCustomer(nextCustomerId: string) {
    const nextPolicies = api.policies.listByCustomer(nextCustomerId);
    const firstPolicy = nextPolicies[0];
    const carrier = firstPolicy ? api.carriers.get(firstPolicy.carrierId) : undefined;
    setCustomerId(nextCustomerId);
    setPolicyId(firstPolicy?.id ?? "");
    setCarrierClaimsUrl(carrier?.claimsUrl ?? "");
  }

  function selectPolicy(nextPolicyId: string) {
    const nextPolicy = policies.find((policy) => policy.id === nextPolicyId);
    const carrier = nextPolicy ? api.carriers.get(nextPolicy.carrierId) : undefined;
    setPolicyId(nextPolicyId);
    setCarrierClaimsUrl(carrier?.claimsUrl ?? "");
  }

  function runAiAutofill() {
    const text = aiPrompt.trim();
    if (!text) {
      setAiSummary("Paste a carrier email, FNOL note, claim number, or file name first.");
      return;
    }
    const normalized = text.toLowerCase();
    const matchedCustomer = customers.find((customer) =>
      normalized.includes(customer.name.toLowerCase())
    );
    if (matchedCustomer) selectCustomer(matchedCustomer.id);

    const activePolicies = matchedCustomer ? api.policies.listByCustomer(matchedCustomer.id) : policies;
    const matchedPolicy = activePolicies.find((policy) => {
      const carrier = api.carriers.get(policy.carrierId);
      const asset = api.assets.get(policy.assetId);
      return [policy.policyNumber, fmt.policyRef(policy), carrier?.name, asset ? assetDisplayName(asset) : undefined]
        .filter(Boolean)
        .some((value) => normalized.includes(String(value).toLowerCase()));
    });
    if (matchedPolicy) {
      setPolicyId(matchedPolicy.id);
      const carrier = api.carriers.get(matchedPolicy.carrierId);
      setCarrierClaimsUrl(carrier?.claimsUrl ?? "");
    }

    if (/\b(closed|resolved|settled)\b/.test(normalized)) setStatus("closed");
    else if (/\b(review|adjuster|inspection|pending)\b/.test(normalized)) setStatus("in_review");
    else setStatus("opened");

    const claimNumber = inferClaimNumber(text);
    if (claimNumber) setExternalClaimNumber(claimNumber);
    setAiSummary(
      "AI matched the claim to the closest client/policy signal and prepared the carrier handoff fields. Review before saving."
    );
  }

  function submit() {
    if (!selectedPolicy) return;
    const customer = api.customers.get(selectedPolicy.customerId);
    const claim = api.claims.create({
      tenantId,
      customerId: selectedPolicy.customerId,
      policyId: selectedPolicy.id,
      carrierId: selectedPolicy.carrierId,
      carrierClaimsUrl: carrierClaimsUrl.trim() || selectedCarrier?.claimsUrl,
      externalClaimNumber: externalClaimNumber.trim() || undefined,
      status,
      closedAt: status === "closed" ? new Date().toISOString() : undefined,
    });
    api.status.create({
      tenantId,
      source: "agent",
      message: `Claim opened for ${selectedAsset ? assetDisplayName(selectedAsset) : fmt.policyRef(selectedPolicy)} with ${
        selectedCarrier?.name ?? "the carrier"
      }${externalClaimNumber.trim() ? ` (claim #${externalClaimNumber.trim()})` : ""}.`,
      visibility: "customer_visible",
      customerId: selectedPolicy.customerId,
      policyId: selectedPolicy.id,
      assetId: selectedPolicy.assetId,
      claimId: claim.id,
      createdById: userId,
    });
    if (carrierClaimsUrl.trim() || selectedCarrier?.claimsUrl) {
      api.claims.draftClaimFollowUp({
        tenantId,
        customerId: selectedPolicy.customerId,
        carrierId: selectedCarrier?.id,
        carrierName: selectedCarrier?.name ?? "Carrier",
        claimsUrl: carrierClaimsUrl.trim() || selectedCarrier?.claimsUrl || "",
        assetId: selectedPolicy.assetId,
        policyId: selectedPolicy.id,
        claimId: claim.id,
      });
    }
    onCreated();
    onClose();
    setCustomerId(customer?.id ?? "");
    setPolicyId("");
    setExternalClaimNumber("");
    setCarrierClaimsUrl("");
    setAiPrompt("");
    setAiSummary(null);
  }

  return (
    <Modal open={open} onClose={onClose} title="Add claim" size="md">
      <div className="space-y-4">
        <div className="rounded-md border border-gold-200 bg-gold-50/40 p-3">
          <label className="label">AI claim intake</label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="input text-sm"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Paste carrier email, FNOL note, claim #, or file name"
            />
            <button type="button" className="btn-primary text-sm whitespace-nowrap" onClick={runAiAutofill}>
              <Sparkles className="h-3.5 w-3.5" /> AI autofill
            </button>
          </div>
          {aiSummary && <div className="mt-2 text-xs text-ink-600">{aiSummary}</div>}
        </div>

        <div>
          <label className="label">Client *</label>
          <select className="input" value={customerId} onChange={(e) => selectCustomer(e.target.value)}>
            <option value="">Pick a client</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Policy *</label>
          <select className="input" value={policyId} onChange={(e) => selectPolicy(e.target.value)}>
            <option value="">Pick a policy</option>
            {policies.map((policy) => {
              const carrier = api.carriers.get(policy.carrierId);
              const asset = api.assets.get(policy.assetId);
              return (
                <option key={policy.id} value={policy.id}>
                  {asset ? assetDisplayName(asset) : fmt.policyRef(policy)} - {carrier?.name ?? "Carrier"} - {fmt.policyRef(policy)}
                </option>
              );
            })}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
              <option value="opened">Open</option>
              <option value="in_review">In review</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className="label">Carrier claim #</label>
            <input
              className="input"
              value={externalClaimNumber}
              onChange={(e) => setExternalClaimNumber(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div>
          <label className="label">Carrier claims URL</label>
          <input
            className="input"
            value={carrierClaimsUrl}
            onChange={(e) => setCarrierClaimsUrl(e.target.value)}
            placeholder="Carrier claim workspace URL"
          />
        </div>

        {selectedPolicy && (
          <div className="rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs text-ink-600">
            <LifeBuoy className="mr-1 inline h-3.5 w-3.5 text-gold-600" />
            {selectedCarrier?.name ?? "Carrier"} claim for {selectedAsset ? assetDisplayName(selectedAsset) : fmt.policyRef(selectedPolicy)}.
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-ink-100 pt-3">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary text-sm" onClick={submit} disabled={!selectedPolicy}>
            <Plus className="h-3.5 w-3.5" /> Add claim
          </button>
        </div>
      </div>
    </Modal>
  );
}

function claimSearchParts(row: ClaimRow): Array<string | undefined> {
  return [
    row.customer?.name,
    row.customer?.email,
    row.policy?.policyNumber,
    fmt.policyRef(row.policy),
    row.asset ? assetDisplayName(row.asset) : undefined,
    row.asset?.type,
    row.carrier?.name,
    row.claim.externalClaimNumber,
    CLAIM_STATUS_LABEL[row.claim.status],
    row.claim.status,
    row.claimsUrl ? "carrier link connected" : "missing carrier link",
  ];
}

function claimSearchText(row: ClaimRow): string {
  return claimSearchParts(row).filter(Boolean).join(" ");
}

function inferClaimNumber(text: string): string | null {
  const explicit = text.match(/(?:claim|clm|loss|fnol)[\s:#-]*(?:no|num|number|#)?[\s:#-]*([a-z0-9][a-z0-9_-]{3,})/i);
  if (explicit?.[1]) return explicit[1].toUpperCase();
  const fallback = text.match(/\b([A-Z]{2,5}[-\s]?\d{4,}[-\s]?[A-Z0-9]{0,6})\b/i);
  return fallback?.[1]?.replace(/\s+/g, "-").toUpperCase() ?? null;
}
