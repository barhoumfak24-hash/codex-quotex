import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, ExternalLink, Mail, Pencil, RefreshCw, Send, ShieldCheck, User } from "lucide-react";
import { AddPolicyModal } from "@/components/policies/AddPolicyModal";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { DocumentList } from "@/components/ui/DocumentList";
import { PolicyStatusBadge, RenewalStatusBadge } from "@/components/ui/StatusBadge";
import { Timeline } from "@/components/ui/Timeline";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { useDemoNotice } from "@/lib/demo";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Policy } from "@/types";

// =====================================================================
// Employee-side full policy detail. Mirrors CustomerPolicyPage so the
// agent / manager has the same expandable surface the customer sees,
// with the extra context staff need (client back-link, internal
// timeline, download + edit-on-carrier actions inline).
// =====================================================================

export function EmployeePolicyPage() {
  const { policyId } = useParams();
  const { agency } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const showDemoNotice = useDemoNotice();
  const [editOpen, setEditOpen] = useState(false);
  const [renewedCount, setRenewedCount] = useState(0);
  const [, setRev] = useState(0);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(null);
  // Ensure upcoming renewals on this tenant have their term-bound docs
  // flagged + the renewal activity card present — covers both fresh
  // and stale-localStorage cases so the Update-for-Renewal flow shows
  // up on visit.
  useEffect(() => {
    if (!agency) return;
    api.renewals.ensureActivities(agency.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agency?.id]);
  if (!policyId || !agency || !user) return null;
  const policy = api.policies.get(policyId);
  if (!policy || policy.tenantId !== agency.id) {
    return <EmptyState title="Policy not found" />;
  }
  const customer = api.customers.get(policy.customerId);
  // Same visibility gate as the rest of the staff surface — an agent
  // shouldn't reach a policy by URL guess if the parent client isn't
  // in their book.
  if (
    !customer ||
    !api.customers.canSee(customer, { id: user.id, role: user.role })
  ) {
    return <EmptyState title="Policy not found" />;
  }
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const documents = api.documents.listByEntity({ policyId });
  // Staff see everything (internal + customer-visible) on the
  // timeline — same as ClientDetailPage's timeline panel.
  const events = api.status.listFor({ policyId });

  // `policy` is narrowed by the early return above; alias it to a
  // non-null local so the callbacks below don't trip TS narrowing
  // across function boundaries.
  const livePolicy: Policy = policy;
  function handleDownload() {
    const lines = buildPolicySummary({
      policy: livePolicy,
      customerName: customer?.name,
      assetLabel: asset?.label,
      carrierName: carrier?.name,
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `policy-${fmt.policyRef(livePolicy).replace(/[^a-z0-9-]/gi, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleRenewDocs() {
    const out = api.documents.renewForPolicy(livePolicy.id, user!.id);
    setRenewedCount(out.length);
    setRev((r) => r + 1);
  }

  // Plain-language description rendered in the card; also reused to
  // seed the "Send to client" email draft so the customer gets the
  // exact summary they're being shown on staff side.
  const desc = useMemo(
    () => describePolicy(livePolicy, asset, carrier),
    [livePolicy, asset, carrier]
  );

  function openSendToClient() {
    if (!customer) return;
    const firstName = customer.name.split(/\s+/)[0] || customer.name;
    const lines = [
      `Hi ${firstName},`,
      ``,
      `Here's a quick summary of your ${api.helpers.departmentLabel(livePolicy).toLowerCase()} coverage with us — pulled straight from your policy on file.`,
      ``,
      desc.summary,
      ``,
      `What's covered:`,
      ...desc.coverages.map((c) => `  • ${c}`),
    ];
    if (desc.note) {
      lines.push("", desc.note);
    }
    lines.push(
      "",
      `If anything looks off or you'd like to update limits, add or remove a covered asset, or review options at renewal, just reply to this email and I'll get on it right away.`,
      ``,
      `Thank you for trusting us with your coverage. Please do not hesitate to reach out with any questions.`
    );
    setSendSubject(`Your ${asset?.label ?? "policy"} summary · ${fmt.policyRef(livePolicy)}`);
    setSendBody(lines.join("\n"));
    setSentAt(null);
    setSendOpen(true);
  }

  function sendToClient() {
    if (!customer || !user) return;
    api.communications.create({
      tenantId: livePolicy.tenantId,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: sendSubject.trim() || `Your ${asset?.label ?? "policy"} summary`,
      body: sendBody,
      createdById: user.id,
    });
    setSentAt(new Date().toISOString());
  }

  function handleEdit() {
    if (carrier?.agentPortalUrl) {
      window.open(carrier.agentPortalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    showDemoNotice({
      feature: "Edit policy on carrier site",
      title: `${carrier?.name ?? "Carrier"} agent portal not configured`,
      body: `In production, this opens ${
        carrier?.name ?? "the carrier"
      }'s agent sign-in for ${fmt.policyRef(
        livePolicy
      )} so you can edit the policy directly on the carrier's system. Configure the carrier's agent portal URL under Master → Carriers to enable this link in the demo.`,
    });
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
        <div className="min-w-0">
          <h1 className="font-display text-3xl">{asset?.label ?? "Policy"}</h1>
          <p className="text-ink-500 text-sm mt-1">
            {carrier?.name ?? "—"} ·{" "}
            <span className="font-mono">{fmt.policyRef(policy)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-2.5 py-1 text-[11px] font-medium text-ink-700">
            {api.helpers.departmentLabel(policy)}
          </span>
          <PolicyStatusBadge status={policy.status} />
          <RenewalStatusBadge status={policy.renewalStatus} />
          <Button
            size="xs"
            to={`/employee/clients/${customer.id}`}
            icon={<User className="h-3.5 w-3.5" />}
          >
            {customer.name}
          </Button>
        </div>
      </div>

      <AddPolicyModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        policy={livePolicy}
        onCreated={() => setRev((r) => r + 1)}
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="flex flex-col h-[30rem]">
          <CardHeader title="Coverage" />
          <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
          <dl className="text-sm space-y-2">
            <Row label="Client" value={customer?.name ?? "—"} />
            <Row label="Carrier" value={carrier?.name ?? "—"} />
            <Row label="Asset" value={asset?.label ?? "—"} />
            <Row
              label="Policy number"
              value={<span className="font-mono">{fmt.policyRef(policy)}</span>}
            />
            <Row label="Effective date" value={fmt.date(policy.effectiveDate)} />
            <Row label="Renewal date" value={fmt.date(policy.renewalDate)} />
            <Row
              label="Premium estimate"
              value={policy.premiumEstimate ? fmt.money(policy.premiumEstimate) : "—"}
            />
            <Row
              label="Final premium"
              value={policy.finalPremium ? fmt.money(policy.finalPremium) : "—"}
            />
          </dl>
          <div className="mt-4 pt-3 border-t border-ink-100 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => setEditOpen(true)}
              icon={<Pencil className="h-3.5 w-3.5" />}
            >
              Edit policy
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              Download summary
            </Button>
            <Button
              size="sm"
              onClick={handleRenewDocs}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              title="Regenerate the policy's declarations page, ID card, and proof of insurance from current coverage"
            >
              Renew documents
            </Button>
            <Button
              size="sm"
              onClick={handleEdit}
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              {carrier?.agentPortalUrl ? `Edit on ${carrier.name}` : "Edit on carrier site"}
            </Button>
          </div>
          {renewedCount > 0 && (
            <p className="text-[11px] text-emerald-700 mt-2">
              Renewed {renewedCount} document{renewedCount === 1 ? "" : "s"} from current coverage —
              see the Documents card below.
            </p>
          )}
          {!carrier?.agentPortalUrl && (
            <p className="text-[11px] text-ink-400 mt-2">
              No agent portal URL configured for {carrier?.name ?? "this carrier"}. Set
              one under Master → Carriers to enable the deep-link.
            </p>
          )}
          </div>
        </Card>

        <Card className="flex flex-col h-[30rem]">
          <CardHeader title="Policy timeline" />
          <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
            <Timeline events={events} />
          </div>
        </Card>

        <Card className="flex flex-col h-[30rem]">
          <CardHeader
            title="Policy description"
            action={
              customer.email ? (
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={openSendToClient}
                  title={`Email this description to ${customer.name}`}
                >
                  <Send className="h-3.5 w-3.5" /> Send to client
                </button>
              ) : null
            }
          />
          <div className="space-y-3 flex-1 min-h-0 overflow-y-auto -mr-2 pr-2">
            <p className="text-sm text-ink-700 leading-relaxed">{desc.summary}</p>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-gold-600" /> What's covered
              </div>
              <ul className="space-y-1">
                {desc.coverages.map((c, i) => (
                  <li key={i} className="text-sm text-ink-700 flex items-start gap-1.5">
                    <span className="text-gold-500 mt-1.5 h-1 w-1 rounded-full bg-gold-500 shrink-0" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
            {desc.note && <p className="text-[11px] text-ink-400">{desc.note}</p>}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Documents" />
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
      </div>

      {asset && (
        <Link
          to={`/employee/clients/${customer.id}/assets/${asset.id}`}
          className="text-sm text-gold-700 inline-flex"
        >
          View asset →
        </Link>
      )}

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Send policy description to client"
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-[11px] text-ink-600 flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-gold-600" />
            <span>
              Sending to{" "}
              <span className="font-medium text-ink-900">{customer.name}</span>{" "}
              <span className="text-ink-500">&lt;{customer.email}&gt;</span> · auto-appends your saved email signature.
            </span>
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              className="input"
              value={sendSubject}
              onChange={(e) => {
                setSendSubject(e.target.value);
                setSentAt(null);
              }}
              disabled={!!sentAt}
            />
          </div>
          <div>
            <label className="label">Message</label>
            <textarea
              className="input min-h-[280px] font-mono text-[13px]"
              value={sendBody}
              onChange={(e) => {
                setSendBody(e.target.value);
                setSentAt(null);
              }}
              disabled={!!sentAt}
            />
            <div className="text-[11px] text-ink-400 mt-1">
              Edit freely — what you see here is what gets sent. Your email signature is added below the body
              automatically when it goes out.
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-ink-100 flex-wrap">
            <div className="text-[11px] text-ink-500">
              {sentAt
                ? `Sent ${fmt.relative(sentAt)} — recorded on the client timeline.`
                : "Drafted from the live policy description. Edits stay in this modal until you send."}
            </div>
            <div className="flex items-center gap-2">
              {sentAt ? (
                <button
                  type="button"
                  className="btn-primary text-sm"
                  onClick={() => setSendOpen(false)}
                >
                  Close
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-outline text-sm"
                    onClick={() => setSendOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    onClick={sendToClient}
                    disabled={!sendBody.trim() || !sendSubject.trim()}
                  >
                    <Send className="h-3.5 w-3.5" /> Send email
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Synthesize a plain-language description of the policy + what's
// covered. Uses the policy's own coverage schedule when present;
// otherwise falls back to a sensible default coverage list for the
// asset type so the card always reads usefully.
function describePolicy(
  policy: Policy,
  asset?: import("@/types").Asset,
  carrier?: import("@/types").Carrier
): { summary: string; coverages: string[]; note?: string } {
  const line = api.helpers.departmentLabel(policy);
  const assetType = asset ? api.helpers.assetTypeLabel(asset.type) : "asset";
  const carrierName = carrier?.name ?? "the carrier";
  const premium = policy.finalPremium ?? policy.premiumEstimate;
  const freqLabel = policy.paymentFrequency
    ? ` Premiums are billed ${policy.paymentFrequency.replace(/_/g, "-")}.`
    : "";

  const summary =
    `This is a ${line} policy${
      asset ? ` covering ${asset.label} (${assetType})` : ""
    }, underwritten by ${carrierName}. ` +
    `It took effect ${fmt.date(policy.effectiveDate)} and renews ${fmt.date(
      policy.renewalDate
    )}.` +
    (premium ? ` The current premium is ${fmt.money(premium)}.` : "") +
    freqLabel;

  // Prefer the policy's own coverage schedule when it has one.
  if (policy.coverages && policy.coverages.length > 0) {
    const coverages = policy.coverages.map((c) => {
      const bits: string[] = [];
      if (c.limit) bits.push(`limit ${fmt.money(c.limit)}`);
      if (c.deductible) bits.push(`deductible ${fmt.money(c.deductible)}`);
      return bits.length ? `${c.name} — ${bits.join(", ")}` : c.name;
    });
    return { summary, coverages };
  }

  const defaults: Record<string, string[]> = {
    coastal_home: [
      "Dwelling & other structures",
      "Personal property",
      "Loss of use",
      "Personal liability",
      "Windstorm / hurricane",
    ],
    luxury_vehicle: [
      "Bodily injury & property damage liability",
      "Comprehensive",
      "Collision",
      "Uninsured / underinsured motorist",
      "Roadside assistance",
    ],
    yacht: [
      "Hull (physical damage)",
      "Protection & indemnity liability",
      "Personal effects",
      "Towing & assistance",
    ],
    jewelry: [
      "All-risk scheduled coverage",
      "Worldwide protection",
      "Mysterious disappearance",
      "Pairs & sets",
    ],
    umbrella_liability: [
      "Excess personal liability",
      "Excess auto liability",
      "Worldwide coverage",
      "Legal defense costs",
    ],
    full_portfolio: [
      "Bundled property",
      "Auto",
      "Umbrella liability",
      "Scheduled valuables",
    ],
    other: ["Core coverage per the policy schedule"],
  };
  const coverages = asset ? defaults[asset.type] ?? defaults.other : defaults.other;
  return {
    summary,
    coverages,
    note: "Coverage shown is a standard outline for this line — see the carrier's declarations page for exact limits and deductibles.",
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-900 text-right">{value}</dd>
    </div>
  );
}

function buildPolicySummary(input: {
  policy: Policy;
  customerName?: string;
  assetLabel?: string;
  carrierName?: string;
}): string[] {
  const { policy: p, customerName, assetLabel, carrierName } = input;
  return [
    `POLICY SUMMARY`,
    `=============`,
    ``,
    `Policy number  : ${fmt.policyRef(p)}`,
    `Client         : ${customerName ?? "—"}`,
    `Asset          : ${assetLabel ?? "—"}`,
    `Carrier        : ${carrierName ?? "—"}`,
    `Status         : ${p.status}`,
    `Renewal status : ${p.renewalStatus}`,
    `Effective date : ${fmt.date(p.effectiveDate)}`,
    `Renewal date   : ${fmt.date(p.renewalDate)}`,
    `Premium est.   : ${p.premiumEstimate ? fmt.money(p.premiumEstimate) : "—"}`,
    `Final premium  : ${p.finalPremium ? fmt.money(p.finalPremium) : "—"}`,
    ``,
    `Generated by Quotex (demo). For an official carrier-issued PDF,`,
    `open this policy on the carrier's agent portal.`,
  ];
}