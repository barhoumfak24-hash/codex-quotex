import type {
  CarrierDownload,
  CarrierDownloadKind,
  CarrierDownloadSeverity,
  CarrierDownloadStatus,
} from "@/types";

export const CARRIER_DOWNLOAD_KIND_LABEL: Record<CarrierDownloadKind, string> = {
  policy_update: "Policy update",
  edoc: "eDoc",
  billing_update: "Billing update",
  claim_update: "Claim update",
  commission_statement: "Commission statement",
};

export const CARRIER_DOWNLOAD_STATUS_LABEL: Record<CarrierDownloadStatus, string> = {
  unreviewed: "Unreviewed",
  matched: "Matched",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
};

export function carrierDownloadStatusTone(
  status: CarrierDownloadStatus
): "neutral" | "info" | "success" | "warn" | "error" {
  if (status === "approved") return "success";
  if (status === "matched") return "info";
  if (status === "needs_review") return "warn";
  if (status === "rejected") return "error";
  return "neutral";
}

export function carrierDownloadSeverityTone(
  severity: CarrierDownloadSeverity
): "neutral" | "info" | "success" | "warn" | "error" {
  if (severity === "critical") return "error";
  if (severity === "warn") return "warn";
  return "info";
}

export function carrierDownloadNeedsReview(download: CarrierDownload): boolean {
  return (
    download.status === "needs_review" ||
    download.confidence < 75 ||
    download.changes.some((change) => change.severity === "critical") ||
    !download.policyId
  );
}

export function carrierDownloadSearchText(download: CarrierDownload): string[] {
  return [
    download.summary,
    download.kind,
    download.status,
    download.source,
    download.sourceReference ?? "",
    download.fileName ?? "",
    download.notes ?? "",
    ...download.changes.flatMap((change) => [
      change.label,
      String(change.currentValue ?? ""),
      String(change.incomingValue ?? ""),
    ]),
  ];
}
