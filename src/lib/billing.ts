import type {
  Policy,
  PolicyBillingMethod,
  PolicyBillingPayer,
  PolicyBillingStatus,
} from "@/types";

export const BILLING_METHOD_LABEL: Record<PolicyBillingMethod, string> = {
  direct_bill: "Direct bill",
  agency_bill: "Agency bill",
  carrier_autopay: "Carrier autopay",
  premium_finance: "Premium finance",
  mortgagee_escrow: "Mortgagee / escrow",
  unknown: "Missing info",
};

export const BILLING_PAYER_LABEL: Record<PolicyBillingPayer, string> = {
  client: "Client",
  agency: "Agency",
  mortgagee: "Mortgagee",
  premium_finance_company: "Finance company",
  other: "Other payer",
};

export const BILLING_STATUS_LABEL: Record<PolicyBillingStatus, string> = {
  current: "Current",
  due_soon: "Due soon",
  past_due: "Past due",
  paid_in_full: "Paid in full",
  unknown: "Missing info",
};

const PAYMENT_FREQUENCY_LABEL: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  annual: "Annual",
};

export function billingMethodLabel(method?: PolicyBillingMethod): string {
  return BILLING_METHOD_LABEL[method ?? "unknown"];
}

export function billingPayerLabel(policy: Pick<Policy, "billingPayer" | "billingPayerName">): string {
  if (policy.billingPayerName?.trim()) return policy.billingPayerName.trim();
  if (!policy.billingPayer) return "Not recorded";
  return BILLING_PAYER_LABEL[policy.billingPayer];
}

export function billingFrequencyLabel(policy: Pick<Policy, "paymentFrequency">): string {
  return policy.paymentFrequency
    ? PAYMENT_FREQUENCY_LABEL[policy.paymentFrequency] ?? policy.paymentFrequency
    : "Not recorded";
}

export function billingStatusFor(
  policy: Pick<Policy, "billingStatus" | "nextPaymentDueDate">,
  now = new Date()
): PolicyBillingStatus {
  if (policy.billingStatus === "paid_in_full") return "paid_in_full";
  const due = policy.nextPaymentDueDate ? new Date(policy.nextPaymentDueDate) : null;
  if (due && Number.isFinite(due.getTime())) {
    const today = startOfDay(now).getTime();
    const dueDay = startOfDay(due).getTime();
    if (dueDay < today) return "past_due";
    const daysUntilDue = Math.ceil((dueDay - today) / 86_400_000);
    if (daysUntilDue <= 14) return "due_soon";
    return "current";
  }
  return policy.billingStatus ?? "unknown";
}

export function billingStatusTone(status: PolicyBillingStatus): "neutral" | "info" | "success" | "warn" | "error" {
  if (status === "past_due") return "error";
  if (status === "due_soon") return "warn";
  if (status === "current" || status === "paid_in_full") return "success";
  return "neutral";
}

export function billingStatusRank(status: PolicyBillingStatus): number {
  if (status === "past_due") return 0;
  if (status === "due_soon") return 1;
  if (status === "unknown") return 2;
  if (status === "current") return 3;
  return 4;
}

export function billingHasMissingInfo(policy: Pick<Policy, "billingMethod" | "paymentFrequency" | "nextPaymentDueDate">): boolean {
  return !policy.billingMethod || policy.billingMethod === "unknown" || !policy.paymentFrequency || !policy.nextPaymentDueDate;
}

export function billingCarrierUrl(carrier?: { billingPortalUrl?: string; agentPortalUrl?: string } | null): string | undefined {
  return carrier?.billingPortalUrl || carrier?.agentPortalUrl;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
