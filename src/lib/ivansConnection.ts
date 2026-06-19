import type {
  IvansConnectionStatus,
  IvansDownloadFeed,
  IvansDownloadFileFormat,
  IvansDownloadMethod,
  IvansLineOfBusiness,
  IvansPollingSchedule,
  IvansTestStatus,
} from "@/types";

export interface IvansConnectionDraft {
  enabled: boolean;
  method: IvansDownloadMethod;
  agencyAccount: string;
  mailboxId: string;
  receiverCode: string;
  credentialReference: string;
  lines: IvansLineOfBusiness[];
  feeds: IvansDownloadFeed[];
  tradingPartnerIds: string[];
  fileFormats: IvansDownloadFileFormat[];
  pollingSchedule: IvansPollingSchedule;
  inboundPath: string;
  archivePath: string;
  errorAlertEmails: string[];
  contactEmail: string;
  contactPhone: string;
  testFileReceivedAt: string;
  lastTestStatus: IvansTestStatus;
  lastTestMessage: string;
}

export interface IvansConnectionValidation {
  missing: string[];
  warnings: string[];
  status: IvansConnectionStatus;
  ready: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitIvansList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function validateIvansConnectionDraft(
  draft: IvansConnectionDraft
): IvansConnectionValidation {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!draft.enabled) {
    return { missing, warnings, status: "not_configured", ready: false };
  }

  if (!draft.method) missing.push("Download method");
  if (!draft.agencyAccount.trim()) missing.push("IVANS agency account / Y-account");
  if (!draft.mailboxId.trim()) missing.push("IVANS mailbox ID");
  if (!draft.receiverCode.trim()) missing.push("Receiver / vendor code");
  if (!draft.credentialReference.trim()) missing.push("Secret-managed credential reference");
  if (draft.lines.length === 0) missing.push("At least one line of business");
  if (draft.feeds.length === 0) missing.push("At least one download feed");
  if (draft.tradingPartnerIds.length === 0) {
    missing.push("Authorized carrier sender IDs / NAIC codes");
  }
  if (draft.fileFormats.length === 0) missing.push("Accepted file formats");
  if (!draft.pollingSchedule) missing.push("Polling schedule");
  if (draft.errorAlertEmails.length === 0) missing.push("Failure alert recipient");
  if (!draft.contactEmail.trim()) missing.push("Agency download contact email");
  if (draft.contactEmail.trim() && !EMAIL_RE.test(draft.contactEmail.trim())) {
    missing.push("Valid agency download contact email");
  }
  draft.errorAlertEmails.forEach((email) => {
    if (!EMAIL_RE.test(email)) missing.push(`Valid alert email: ${email}`);
  });

  if (draft.method === "sftp" && !draft.inboundPath.trim()) {
    missing.push("SFTP inbound folder / mailbox path");
  }
  if (!draft.archivePath.trim()) {
    warnings.push("Archive folder is recommended so processed files can be replayed during audits.");
  }
  if (!draft.contactPhone.trim()) {
    warnings.push("A phone number is recommended for IVANS/carrier download cutover support.");
  }

  if (draft.lastTestStatus === "failed") {
    return { missing, warnings, status: "error", ready: false };
  }

  if (draft.lastTestStatus !== "passed" || !draft.testFileReceivedAt.trim()) {
    missing.push("Passed IVANS test file received by Quotex");
  }

  const ready = missing.length === 0;
  return {
    missing,
    warnings,
    status: ready ? "ready" : "pending_setup",
    ready,
  };
}
