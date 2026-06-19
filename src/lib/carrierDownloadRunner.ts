import type {
  CarrierDownloadRunnerFeed,
  CarrierDownloadRunnerLineOfBusiness,
  CarrierDownloadRunnerMfaMode,
  CarrierDownloadRunnerMode,
  CarrierDownloadRunnerReviewRule,
  CarrierDownloadRunnerSchedule,
  CarrierDownloadRunnerStatus,
  CarrierDownloadRunnerTestStatus,
} from "@/types";

export interface CarrierDownloadRunnerDraft {
  enabled: boolean;
  mode: CarrierDownloadRunnerMode;
  credentialVaultRef: string;
  mfaMode: CarrierDownloadRunnerMfaMode;
  authorizedUserIds: string[];
  lines: CarrierDownloadRunnerLineOfBusiness[];
  feeds: CarrierDownloadRunnerFeed[];
  carrierIds: string[];
  reviewRule: CarrierDownloadRunnerReviewRule;
  schedule: CarrierDownloadRunnerSchedule;
  failureAlertEmails: string[];
  contactEmail: string;
  contactPhone: string;
  lastTestAt: string;
  lastTestStatus: CarrierDownloadRunnerTestStatus;
  lastTestMessage: string;
}

export interface CarrierDownloadRunnerValidation {
  missing: string[];
  warnings: string[];
  status: CarrierDownloadRunnerStatus;
  ready: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitRunnerList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function validateCarrierDownloadRunnerDraft(
  draft: CarrierDownloadRunnerDraft
): CarrierDownloadRunnerValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!draft.enabled) {
    return { missing, warnings, status: "not_configured", ready: false };
  }

  if (!draft.mode) missing.push("Runner mode");
  if (!draft.credentialVaultRef.trim()) missing.push("Encrypted credential vault reference");
  if (draft.mfaMode === "not_configured") missing.push("MFA handling method");
  if (draft.authorizedUserIds.length === 0) missing.push("Authorized agency approver");
  if (draft.lines.length === 0) missing.push("At least one line of business");
  if (draft.feeds.length === 0) missing.push("At least one carrier update type");
  if (!draft.reviewRule) missing.push("Review rule");
  if (!draft.schedule) missing.push("Trigger timing");
  if (draft.failureAlertEmails.length === 0) missing.push("Failure alert recipient");
  if (!draft.contactEmail.trim()) missing.push("Agency runner contact email");
  if (draft.contactEmail.trim() && !EMAIL_RE.test(draft.contactEmail.trim())) {
    missing.push("Valid agency runner contact email");
  }
  draft.failureAlertEmails.forEach((email) => {
    if (!EMAIL_RE.test(email)) missing.push(`Valid alert email: ${email}`);
  });

  if (draft.reviewRule === "auto_safe_fields") {
    warnings.push(
      "Auto-updates must stay limited to safe fields; cancellations, non-renewals, premium changes, coverage changes, and low-confidence matches should stay staged for review."
    );
  }
  if (!draft.contactPhone.trim()) {
    warnings.push("A phone number is recommended for urgent carrier portal or MFA issues.");
  }
  if (draft.mode === "ai_portal_runner" && draft.mfaMode === "totp_vault") {
    warnings.push("TOTP vault automation should be limited to carriers whose terms allow delegated automation.");
  }
  if (draft.carrierIds.length === 0) {
    warnings.push("No active agency carriers are linked yet. The runner automatically uses active carrier-library links once they are enabled.");
  }

  if (draft.lastTestStatus === "failed") {
    return { missing, warnings, status: "error", ready: false };
  }

  if (draft.lastTestStatus !== "passed" || !draft.lastTestAt.trim()) {
    missing.push("Successful supervised runner test");
  }

  const ready = missing.length === 0;
  return {
    missing,
    warnings,
    status: ready ? "ready" : "pending_setup",
    ready,
  };
}
