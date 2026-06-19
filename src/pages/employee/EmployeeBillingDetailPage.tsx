import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, ExternalLink, Mail, Pencil, Save, Send, User } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Timeline } from "@/components/ui/Timeline";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import { api } from "@/lib/api";
import {
  BILLING_STATUS_LABEL,
  billingCarrierUrl,
  billingFrequencyLabel,
  billingMethodLabel,
  billingPayerLabel,
  billingStatusFor,
  billingStatusTone,
} from "@/lib/billing";
import { fmt } from "@/lib/format";
import type {
  Carrier,
  Payment,
  Policy,
  PolicyBillingMethod,
  PolicyBillingPayer,
  PolicyBillingStatus,
  StatusEvent,
} from "@/types";

type BillingForm = {
  billingMethod: PolicyBillingMethod;
  billingPayer: PolicyBillingPayer;
  billingPayerName: string;
  billingStatus: PolicyBillingStatus;
  paymentFrequency: "" | NonNullable<Policy["paymentFrequency"]>;
  nextPaymentDueDate: string;
  nextPaymentAmount: string;
  billingAccountNumber: string;
  billingReference: string;
  billingFinanceCompany: string;
  billingMortgagee: string;
  billingLastVerifiedAt: string;
  billingNotes: string;
  billingPortalUrl: string;
  billingPhone: string;
  billingEmail: string;
};

const BILLING_METHOD_OPTIONS: Array<{ value: PolicyBillingMethod; label: string }> = [
  { value: "direct_bill", label: "Direct bill" },
  { value: "agency_bill", label: "Agency bill" },
  { value: "carrier_autopay", label: "Carrier autopay" },
  { value: "premium_finance", label: "Premium finance" },
  { value: "mortgagee_escrow", label: "Mortgagee / escrow" },
  { value: "unknown", label: "Missing info" },
];

const BILLING_PAYER_OPTIONS: Array<{ value: PolicyBillingPayer; label: string }> = [
  { value: "client", label: "Client" },
  { value: "agency", label: "Agency" },
  { value: "mortgagee", label: "Mortgagee" },
  { value: "premium_finance_company", label: "Finance company" },
  { value: "other", label: "Other payer" },
];

const BILLING_STATUS_OPTIONS: Array<{ value: PolicyBillingStatus; label: string }> = [
  { value: "current", label: "Current" },
  { value: "due_soon", label: "Due soon" },
  { value: "past_due", label: "Past due" },
  { value: "paid_in_full", label: "Paid in full" },
  { value: "unknown", label: "Missing info" },
];

const FREQUENCY_OPTIONS: Array<{ value: NonNullable<Policy["paymentFrequency"]>; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
];

export function EmployeeBillingDetailPage() {
  const { policyId } = useParams();
  const navigate = useNavigate();
  const { agency } = useTenant();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [, setRev] = useState(0);
  const [form, setForm] = useState<BillingForm>(() => emptyForm());
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sentAt, setSentAt] = useState<string | null>(null);

  if (!policyId || !agency || !user) return null;
  const policy = api.policies.get(policyId);
  if (!policy || policy.tenantId !== agency.id) return <EmptyState title="Billing record not found" />;

  const customer = api.customers.get(policy.customerId);
  if (!customer || !api.customers.canSee(customer, { id: user.id, role: user.role })) {
    return <EmptyState title="Billing record not found" />;
  }

  const liveAgency = agency;
  const liveUser = user;
  const livePolicy = policy;
  const liveCustomer = customer;
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const payments = api.payments.listByPolicy(policy.id);
  const latestPaidPayment = latestPaidPaymentFor(payments);
  const events = api.status.listFor({ policyId: policy.id }).filter(isBillingTimelineEvent);
  const status = billingStatusFor(policy);
  const carrierUrl = billingCarrierUrl(carrier);

  function setField<K extends keyof BillingForm>(key: K, value: BillingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit() {
    setForm(formFromPolicy(livePolicy, carrier));
    setEditing(true);
  }

  function cancelEdit() {
    setForm(formFromPolicy(livePolicy, carrier));
    setEditing(false);
  }

  function save() {
    api.policies.update(livePolicy.id, {
      billingMethod: form.billingMethod,
      billingPayer: form.billingPayer,
      billingPayerName: clean(form.billingPayerName),
      billingStatus: form.billingStatus,
      paymentFrequency: form.paymentFrequency || undefined,
      nextPaymentDueDate: dateToIso(form.nextPaymentDueDate),
      nextPaymentAmount: moneyToNumber(form.nextPaymentAmount),
      billingAccountNumber: clean(form.billingAccountNumber),
      billingReference: clean(form.billingReference),
      billingFinanceCompany: clean(form.billingFinanceCompany),
      billingMortgagee: clean(form.billingMortgagee),
      billingLastVerifiedAt: dateToIso(form.billingLastVerifiedAt),
      billingNotes: clean(form.billingNotes),
    });
    if (carrier) {
      api.carriers.update(carrier.id, {
        billingPortalUrl: clean(form.billingPortalUrl),
        billingPhone: clean(form.billingPhone),
        billingEmail: clean(form.billingEmail),
      });
    }
    api.status.create({
      tenantId: liveAgency.id,
      source: "agent",
      message: `Billing tracking updated for ${fmt.policyRef(livePolicy)}.`,
      visibility: "internal",
      customerId: liveCustomer.id,
      policyId: livePolicy.id,
      assetId: livePolicy.assetId,
      createdById: liveUser.id,
    });
    setEditing(false);
    setRev((current) => current + 1);
  }

  function openSendSummary() {
    setSendSubject(`Billing summary for ${fmt.policyRef(livePolicy)}`);
    setSendBody(
      buildBillingSummaryMessage({
        policy: livePolicy,
        customerName: liveCustomer.name,
        assetLabel: asset?.label,
        carrier,
        latestPaidPayment,
      })
    );
    setSentAt(null);
    setSendOpen(true);
  }

  function sendBillingSummary() {
    if (!liveCustomer.email) return;
    const comm = api.communications.create({
      tenantId: liveAgency.id,
      customerId: liveCustomer.id,
      channel: "email",
      direction: "outbound",
      subject: sendSubject.trim() || `Billing summary for ${fmt.policyRef(livePolicy)}`,
      body: sendBody,
      createdById: liveUser.id,
    });
    api.status.create({
      tenantId: liveAgency.id,
      source: "agent",
      message: `Billing summary sent to client for ${fmt.policyRef(livePolicy)}.`,
      visibility: "customer_visible",
      customerId: liveCustomer.id,
      policyId: livePolicy.id,
      assetId: livePolicy.assetId,
      communicationId: comm.id,
      createdById: liveUser.id,
    });
    setSentAt(new Date().toISOString());
    setRev((current) => current + 1);
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => navigate(-1)} icon={<ArrowLeft className="h-4 w-4" />} className="-ml-2">
        Back
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl">{fmt.policyRef(policy)} billing</h1>
          <p className="mt-1 text-sm text-ink-500">
            {carrier?.name ?? "Carrier"} - {asset?.label ?? "Asset not recorded"} - {customer.name}
          </p>
        </div>
        <div className="flex max-w-3xl flex-wrap items-center justify-end gap-2">
          <Badge tone={billingStatusTone(status)}>{BILLING_STATUS_LABEL[status]}</Badge>
          <Button size="xs" to={`/employee/clients/${customer.id}`} icon={<User className="h-3.5 w-3.5" />}>
            {customer.name}
          </Button>
          <Button size="xs" to={`/employee/policies/${policy.id}`}>
            Policy
          </Button>
          {carrierUrl && (
            <Button
              size="xs"
              href={carrierUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLink className="h-3.5 w-3.5" />}
            >
              View on carrier
            </Button>
          )}
          {editing ? (
            <>
              <Button size="xs" onClick={cancelEdit}>
                Cancel
              </Button>
              <Button size="xs" variant="primary" onClick={save} icon={<Save className="h-3.5 w-3.5" />}>
                Save
              </Button>
            </>
          ) : (
            <Button size="xs" variant="primary" onClick={startEdit} icon={<Pencil className="h-3.5 w-3.5" />}>
              Edit billing info
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <BillingEditForm form={form} setField={setField} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-3">
            <CardHeader
              title="Billing summary"
              action={
                <Button
                  size="xs"
                  onClick={openSendSummary}
                  icon={<Send className="h-3.5 w-3.5" />}
                  disabled={!customer.email}
                  title={customer.email ? "Send this billing summary to the client" : "Client email is not recorded"}
                >
                  Send to client
                </Button>
              }
            />
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Policy billing
                </div>
                <dl className="space-y-2 text-sm">
                  <Row label="Policy" value={<span className="font-mono">{fmt.policyRef(policy)}</span>} />
                  <Row label="Client" value={customer.name} />
                  <Row label="Carrier" value={carrier?.name ?? "Carrier missing"} />
                  <Row label="Asset" value={asset?.label ?? "Asset not recorded"} />
                  <Row label="Premium" value={premiumFor(policy) ? fmt.money(premiumFor(policy) ?? 0) : "Not recorded"} />
                  <Row label="How paid" value={billingMethodLabel(policy.billingMethod)} />
                  <Row label="Payment plan" value={billingFrequencyLabel(policy)} />
                  <Row
                    label="Next due"
                    value={nextDueSummary(policy, latestPaidPayment)}
                  />
                </dl>
              </div>
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  Payment path
                </div>
                <dl className="space-y-2 text-sm">
                  <Row label="Payer" value={billingPayerLabel(policy)} />
                  <Row label="Payer name" value={policy.billingPayerName ?? "Not recorded"} />
                  <Row label="Account" value={policy.billingAccountNumber ?? "Not recorded"} />
                  <Row label="Reference" value={policy.billingReference ?? "Not recorded"} />
                  <Row label="Finance company" value={policy.billingFinanceCompany ?? "Not recorded"} />
                  <Row label="Mortgagee / escrow" value={policy.billingMortgagee ?? "Not recorded"} />
                  <Row label="Verified" value={fmt.date(policy.billingLastVerifiedAt)} />
                </dl>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-400">
              This page tracks how the client pays the carrier. It does not collect card, bank, or ACH details.
            </p>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader title="Billing history" />
            <BillingHistory payments={payments} />
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader
              title="Billing remarks"
              subtitle="Payment plan changes, billing method updates, premium changes, and billing-summary sends."
            />
            <Timeline events={events} clickable={false} />
          </Card>
        </div>
      )}

      <Modal open={sendOpen} onClose={() => setSendOpen(false)} title="Send billing summary" size="lg">
        <div className="space-y-4">
          <div className="rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-[11px] text-ink-600 flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-gold-600" />
            <div className="min-w-0">
              Sending to <span className="font-medium text-ink-900">{customer.name}</span>{" "}
              <span className="text-ink-500">&lt;{customer.email}&gt;</span>. Your saved email signature is added automatically.
            </div>
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
              className="input min-h-[260px] font-mono text-[13px]"
              value={sendBody}
              onChange={(e) => {
                setSendBody(e.target.value);
                setSentAt(null);
              }}
              disabled={!!sentAt}
            />
            <div className="mt-1 text-[11px] text-ink-400">
              This is a billing summary only. It does not request or collect payment details.
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
            <div className="text-[11px] text-ink-500">
              {sentAt ? `Sent ${fmt.relative(sentAt)} and recorded on the billing timeline.` : "Review the summary, then send it directly to the client."}
            </div>
            <div className="flex items-center gap-2">
              {sentAt ? (
                <Button variant="primary" size="sm" onClick={() => setSendOpen(false)}>
                  Close
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => setSendOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={sendBillingSummary}
                    disabled={!sendBody.trim() || !sendSubject.trim()}
                    icon={<Send className="h-3.5 w-3.5" />}
                  >
                    Send email
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function BillingEditForm({
  form,
  setField,
}: {
  form: BillingForm;
  setField: <K extends keyof BillingForm>(key: K, value: BillingForm[K]) => void;
}) {
  return (
    <Card>
      <CardHeader title="Edit billing info" subtitle="Unlocked billing tracking fields. This still does not collect payment information." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Method">
          <select
            className="input text-sm"
            value={form.billingMethod}
            onChange={(e) => setField("billingMethod", e.target.value as PolicyBillingMethod)}
          >
            {BILLING_METHOD_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payer">
          <select
            className="input text-sm"
            value={form.billingPayer}
            onChange={(e) => setField("billingPayer", e.target.value as PolicyBillingPayer)}
          >
            {BILLING_PAYER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Plan">
          <select
            className="input text-sm"
            value={form.paymentFrequency}
            onChange={(e) => setField("paymentFrequency", e.target.value as BillingForm["paymentFrequency"])}
          >
            <option value="">Not recorded</option>
            {FREQUENCY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className="input text-sm"
            value={form.billingStatus}
            onChange={(e) => setField("billingStatus", e.target.value as PolicyBillingStatus)}
          >
            {BILLING_STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payer name">
          <input className="input text-sm" value={form.billingPayerName} onChange={(e) => setField("billingPayerName", e.target.value)} />
        </Field>
        <Field label="Next due">
          <input
            className="input text-sm"
            type="date"
            value={form.nextPaymentDueDate}
            onChange={(e) => setField("nextPaymentDueDate", e.target.value)}
          />
        </Field>
        <Field label="Next amount">
          <input
            className="input text-sm"
            type="number"
            min="0"
            value={form.nextPaymentAmount}
            onChange={(e) => setField("nextPaymentAmount", e.target.value)}
          />
        </Field>
        <Field label="Account #">
          <input
            className="input text-sm"
            value={form.billingAccountNumber}
            onChange={(e) => setField("billingAccountNumber", e.target.value)}
          />
        </Field>
        <Field label="Reference">
          <input className="input text-sm" value={form.billingReference} onChange={(e) => setField("billingReference", e.target.value)} />
        </Field>
        <Field label="Finance company">
          <input
            className="input text-sm"
            value={form.billingFinanceCompany}
            onChange={(e) => setField("billingFinanceCompany", e.target.value)}
          />
        </Field>
        <Field label="Mortgagee / escrow">
          <input className="input text-sm" value={form.billingMortgagee} onChange={(e) => setField("billingMortgagee", e.target.value)} />
        </Field>
        <Field label="Verified">
          <input
            className="input text-sm"
            type="date"
            value={form.billingLastVerifiedAt}
            onChange={(e) => setField("billingLastVerifiedAt", e.target.value)}
          />
        </Field>
        <Field label="Carrier billing portal" className="sm:col-span-2">
          <input className="input text-sm" value={form.billingPortalUrl} onChange={(e) => setField("billingPortalUrl", e.target.value)} />
        </Field>
        <Field label="Billing phone">
          <input className="input text-sm" value={form.billingPhone} onChange={(e) => setField("billingPhone", e.target.value)} />
        </Field>
        <Field label="Billing email">
          <input className="input text-sm" value={form.billingEmail} onChange={(e) => setField("billingEmail", e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" className="mt-3">
        <textarea
          className="input min-h-24 resize-y text-sm"
          value={form.billingNotes}
          onChange={(e) => setField("billingNotes", e.target.value)}
        />
      </Field>
    </Card>
  );
}

function BillingHistory({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-ink-400">No billing history recorded for this policy yet.</p>;
  }

  const sorted = payments
    .slice()
    .sort((a, b) => String(b.paidAt ?? b.createdAt).localeCompare(String(a.paidAt ?? a.createdAt)));
  const paidOnly = sorted.filter((payment) => payment.status === "paid");

  return (
    <ul className="divide-y divide-ink-100 text-sm">
      {sorted.map((payment) => {
        const paidIndex = paidOnly.findIndex((item) => item.id === payment.id);
        const priorPaid = paidIndex >= 0 ? paidOnly[paidIndex + 1] : undefined;
        const change = payment.status === "paid" ? paymentChangeLabel(payment.amount, priorPaid?.amount, "from prior") : null;
        return (
          <li key={payment.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_4rem_5rem_7rem_6rem] sm:items-center">
            <div className="min-w-0">
              <div className="font-medium text-ink-900">{fmt.date(payment.paidAt ?? payment.createdAt)}</div>
              <div className="text-xs text-ink-500">Carrier payment record</div>
            </div>
            <span className="w-16 justify-self-center text-center text-xs uppercase tracking-wider text-ink-500">{payment.method}</span>
            <span className="flex w-20 justify-self-center justify-center">
              <Badge tone={payment.status === "paid" ? "success" : payment.status === "failed" ? "error" : "warn"}>
                {payment.status.replace(/_/g, " ")}
              </Badge>
            </span>
            <span className={change ? change.className : "text-xs text-ink-400"}>{change?.label ?? "First payment"}</span>
            <span className="tabular-nums font-semibold text-ink-900">{fmt.money(payment.amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function buildBillingSummaryMessage(input: {
  policy: Policy;
  customerName: string;
  assetLabel?: string;
  carrier?: Carrier;
  latestPaidPayment?: Payment;
}): string {
  const { policy, customerName, assetLabel, carrier, latestPaidPayment } = input;
  const firstName = customerName.split(/\s+/)[0] || customerName;
  const premium = premiumFor(policy);
  const lines = [
    `Hi ${firstName},`,
    ``,
    `Here is the current billing summary we have on file for your policy.`,
    ``,
    `Policy: ${fmt.policyRef(policy)}`,
    `Client: ${customerName}`,
    `Carrier: ${carrier?.name ?? "Not recorded"}`,
    `Asset: ${assetLabel ?? "Not recorded"}`,
    `Premium: ${premium ? fmt.money(premium) : "Not recorded"}`,
    `How paid: ${billingMethodLabel(policy.billingMethod)}`,
    `Payment plan: ${billingFrequencyLabel(policy)}`,
    `Next due: ${nextDueSummaryText(policy, latestPaidPayment)}`,
    ``,
    `Payment path:`,
    `Payer: ${billingPayerLabel(policy)}`,
    `Payer name: ${policy.billingPayerName ?? "Not recorded"}`,
    `Account: ${policy.billingAccountNumber ?? "Not recorded"}`,
    `Reference: ${policy.billingReference ?? "Not recorded"}`,
    `Finance company: ${policy.billingFinanceCompany ?? "Not recorded"}`,
    `Mortgagee / escrow: ${policy.billingMortgagee ?? "Not recorded"}`,
    `Verified: ${fmt.date(policy.billingLastVerifiedAt)}`,
  ];
  lines.push(
    ``,
    `This is for reference only and does not collect payment information. If anything looks incorrect, reply here and we will update our records.`
  );
  return lines.join("\n");
}

function isBillingTimelineEvent(event: StatusEvent): boolean {
  if (event.source === "ai" || event.createdById === "ai") return false;
  const text = event.message.toLowerCase();
  const billingTerms = [
    "billing",
    "payment",
    "premium",
    "payer",
    "paid",
    "invoice",
    "installment",
    "autopay",
    "finance",
    "mortgagee",
    "escrow",
    "renewal",
  ];
  return billingTerms.some((term) => text.includes(term));
}

function latestPaidPaymentFor(payments: Payment[]): Payment | undefined {
  return payments
    .filter((payment) => payment.status === "paid")
    .sort((a, b) => String(b.paidAt ?? b.createdAt).localeCompare(String(a.paidAt ?? a.createdAt)))[0];
}

function nextDueSummary(policy: Policy, latestPaidPayment?: Payment): ReactNode {
  if (!policy.nextPaymentDueDate) return "Not recorded";
  const change =
    typeof policy.nextPaymentAmount === "number"
      ? paymentChangeLabel(policy.nextPaymentAmount, latestPaidPayment?.amount, "from last payment")
      : null;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span>{nextDueBaseText(policy)}</span>
      {change && <span className={change.className}>{change.label}</span>}
    </span>
  );
}

function nextDueSummaryText(policy: Policy, latestPaidPayment?: Payment): string {
  if (!policy.nextPaymentDueDate) return "Not recorded";
  const change =
    typeof policy.nextPaymentAmount === "number"
      ? paymentChangeLabel(policy.nextPaymentAmount, latestPaidPayment?.amount, "from last payment")
      : null;
  return change ? `${nextDueBaseText(policy)} (${change.label})` : nextDueBaseText(policy);
}

function nextDueBaseText(policy: Policy): string {
  return `${fmt.date(policy.nextPaymentDueDate)}${
    typeof policy.nextPaymentAmount === "number" ? ` - ${fmt.money(policy.nextPaymentAmount)}` : ""
  }`;
}

function paymentChangeLabel(
  currentAmount: number,
  priorAmount?: number,
  suffix = "from prior"
): { label: string; className: string } | null {
  if (typeof priorAmount !== "number" || priorAmount <= 0) return null;
  const pct = ((currentAmount - priorAmount) / priorAmount) * 100;
  const abs = Math.abs(pct);
  const pctText = abs < 0.05 ? "0%" : `${abs.toFixed(abs >= 10 ? 0 : 1)}%`;
  if (abs < 0.05) {
    return { label: `${pctText} ${suffix}`, className: "text-xs font-medium text-ink-500" };
  }
  if (pct > 0) {
    return { label: `Up ${pctText} ${suffix}`, className: "text-xs font-semibold text-amber-700" };
  }
  return { label: `Down ${pctText} ${suffix}`, className: "text-xs font-semibold text-emerald-700" };
}

function premiumFor(policy: Policy): number | undefined {
  return policy.finalPremium ?? policy.premiumBreakdown?.total ?? policy.premiumEstimate;
}

function formFromPolicy(policy: Policy, carrier?: Carrier): BillingForm {
  return {
    billingMethod: policy.billingMethod ?? "unknown",
    billingPayer: policy.billingPayer ?? "client",
    billingPayerName: policy.billingPayerName ?? "",
    billingStatus: policy.billingStatus ?? billingStatusFor(policy),
    paymentFrequency: policy.paymentFrequency ?? "",
    nextPaymentDueDate: isoToDateInput(policy.nextPaymentDueDate),
    nextPaymentAmount: typeof policy.nextPaymentAmount === "number" ? String(policy.nextPaymentAmount) : "",
    billingAccountNumber: policy.billingAccountNumber ?? "",
    billingReference: policy.billingReference ?? "",
    billingFinanceCompany: policy.billingFinanceCompany ?? "",
    billingMortgagee: policy.billingMortgagee ?? "",
    billingLastVerifiedAt: isoToDateInput(policy.billingLastVerifiedAt),
    billingNotes: policy.billingNotes ?? "",
    billingPortalUrl: carrier?.billingPortalUrl ?? "",
    billingPhone: carrier?.billingPhone ?? "",
    billingEmail: carrier?.billingEmail ?? "",
  };
}

function emptyForm(): BillingForm {
  return {
    billingMethod: "unknown",
    billingPayer: "client",
    billingPayerName: "",
    billingStatus: "unknown",
    paymentFrequency: "",
    nextPaymentDueDate: "",
    nextPaymentAmount: "",
    billingAccountNumber: "",
    billingReference: "",
    billingFinanceCompany: "",
    billingMortgagee: "",
    billingLastVerifiedAt: "",
    billingNotes: "",
    billingPortalUrl: "",
    billingPhone: "",
    billingEmail: "",
  };
}

function clean(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function moneyToNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function isoToDateInput(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-ink-700">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right text-ink-900">{value}</dd>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
