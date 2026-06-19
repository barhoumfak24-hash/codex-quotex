import type {
  CarrierRunnerJob,
  CarrierRunnerJobStatus,
  CarrierRunnerJobTrigger,
  Policy,
  Renewal,
} from "@/types";

export const CARRIER_RUNNER_RENEWAL_LOOKAHEAD_DAYS = 21;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function carrierRunnerTriggerLabel(trigger: CarrierRunnerJobTrigger): string {
  switch (trigger) {
    case "policy_placed":
      return "Policy placed";
    case "policy_check":
      return "Policy check";
    case "renewal_window":
      return "Renewal window";
    case "renewal_status_check":
      return "Renewal status check";
    case "billing_check":
      return "Billing check";
    case "claim_check":
      return "Claim check";
    case "document_sync":
      return "Document sync";
    case "manual":
      return "Manual runner check";
  }
}

export function carrierRunnerJobStatusLabel(status: CarrierRunnerJobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "needs_mfa":
      return "Needs MFA";
    case "staged_for_review":
      return "Staged for review";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function carrierRunnerJobIsOpen(job: CarrierRunnerJob): boolean {
  return !["completed", "cancelled"].includes(job.status);
}

export function daysUntilCarrierRunnerRenewal(
  policy: Pick<Policy, "renewalDate">,
  nowIso: string
): number | null {
  if (!policy.renewalDate) return null;
  const renewalMs = new Date(policy.renewalDate).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(renewalMs) || !Number.isFinite(nowMs)) return null;
  return Math.ceil((renewalMs - nowMs) / MS_PER_DAY);
}

export function shouldQueueCarrierRunnerRenewalJob(
  policy: Pick<Policy, "renewalDate" | "renewalStatus" | "status">,
  renewal: Pick<Renewal, "status"> | undefined,
  nowIso: string,
  lookaheadDays = CARRIER_RUNNER_RENEWAL_LOOKAHEAD_DAYS
): boolean {
  if (!policy.renewalDate) return false;
  if (policy.status !== "bound" && policy.status !== "renewed" && policy.status !== "renewal_upcoming") {
    return false;
  }
  if (policy.renewalStatus === "not_renewed" || renewal?.status === "not_renewed") return false;
  if (policy.renewalStatus === "renewed" || renewal?.status === "renewed") return false;
  const days = daysUntilCarrierRunnerRenewal(policy, nowIso);
  return days !== null && days <= lookaheadDays && days >= -7;
}
