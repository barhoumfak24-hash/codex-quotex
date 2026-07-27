import { apiBaseUrl } from "@/lib/apiBase";
import { serverSessionHeaders } from "@/lib/serverSession";
import type { CarrierQuote } from "@/types";

export type QuotexConnectJobType =
  | "open_portal"
  | "retrieve_quote"
  | "retrieve_policy"
  | "retrieve_claim"
  | "retrieve_documents";

export type QuotexConnectJob = {
  id: string;
  quoteSessionId: string | null;
  carrierId: string;
  carrierName: string;
  jobType: QuotexConnectJobType;
  status:
    | "queued"
    | "claimed"
    | "opening_portal"
    | "waiting_for_login"
    | "waiting_for_mfa"
    | "running"
    | "completed"
    | "manual_required"
    | "failed"
    | "cancelled";
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export class QuotexConnectError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "QuotexConnectError";
    this.code = code;
  }
}

export function quotexConnectQuoteCarrierIds(session: {
  lineOfBusiness?: "personal" | "commercial";
  linkedCarrierIds?: string[];
  commercialCarrierSubmissions?: Array<{
    carrierId: string;
    status: string;
  }>;
}): string[] {
  const carrierIds =
    session.lineOfBusiness === "commercial"
      ? (session.commercialCarrierSubmissions ?? [])
          .filter(
            (submission) =>
              submission.status !== "send_failed" && submission.status !== "declined"
          )
          .map((submission) => submission.carrierId)
      : session.linkedCarrierIds ?? [];

  return [...new Set(carrierIds.filter(Boolean))];
}

export async function listQuotexConnectJobs(input: {
  quoteSessionId: string;
  jobType?: QuotexConnectJobType;
}): Promise<QuotexConnectJob[]> {
  const query = new URLSearchParams({ quoteSessionId: input.quoteSessionId });
  if (input.jobType) query.set("jobType", input.jobType);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/connect/jobs?${query.toString()}`, {
      headers: serverSessionHeaders(),
    });
  } catch {
    throw new QuotexConnectError(
      "connect_unreachable",
      "Quotex Connect could not reach the secure carrier bridge."
    );
  }

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string; jobs?: QuotexConnectJob[] }
    | null;
  if (!response.ok || body?.ok !== true || !Array.isArray(body.jobs)) {
    const code = body?.error || "connect_job_failed";
    throw new QuotexConnectError(code, connectJobErrorMessage(code));
  }
  return body.jobs;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function boundedRatio(value: unknown, fallback: number): number {
  const number = finiteNumber(value);
  if (number === undefined) return fallback;
  const ratio = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, ratio));
}

export function verifiedCarrierQuoteFromConnectJob(
  job: QuotexConnectJob
): CarrierQuote | null {
  if (job.jobType !== "retrieve_quote" || job.status !== "completed" || !job.result) {
    return null;
  }
  const verification =
    job.result.verification &&
    typeof job.result.verification === "object" &&
    !Array.isArray(job.result.verification)
      ? (job.result.verification as Record<string, unknown>)
      : null;
  if (
    verification?.verified !== true ||
    verification.source !== "carrier_portal" ||
    typeof verification.portalUrl !== "string" ||
    !/^https:\/\//i.test(verification.portalUrl)
  ) {
    return null;
  }

  const quote =
    job.result.quote &&
    typeof job.result.quote === "object" &&
    !Array.isArray(job.result.quote)
      ? (job.result.quote as Record<string, unknown>)
      : job.result;
  const premium = finiteNumber(quote.premium ?? quote.annualPremium);
  const carrierReference = String(
    quote.carrierReference ?? quote.quoteNumber ?? quote.reference ?? ""
  ).trim();
  if (!premium || premium <= 0 || !carrierReference) return null;

  const fitReason =
    String(quote.fitReason ?? quote.summary ?? "").trim() ||
    "Verified carrier portal quote.";
  return {
    carrierId: job.carrierId,
    premium,
    confidence: boundedRatio(quote.confidence, 1),
    score: finiteNumber(quote.matchScore ?? quote.score) ?? 0,
    fitReason,
    apiStatus: "connected",
    source: "quotex_connect",
    carrierReference,
    providerTrace: {
      provider: "carrier_portal_automation",
      providerLabel: "Quotex Connect",
      transport: "browser_automation",
      requestId: job.id,
      executionId: carrierReference,
      liveReady: true,
      submittedAt: job.completedAt ?? job.updatedAt,
      messages: [`Verified carrier portal quote ${carrierReference}.`],
    },
  };
}

export async function createQuotexConnectJob(input: {
  carrierId: string;
  carrierName: string;
  jobType: QuotexConnectJobType;
  quoteSessionId?: string;
  payload?: Record<string, unknown>;
}): Promise<{ job: QuotexConnectJob; reused: boolean }> {
  const headers = new Headers(serverSessionHeaders());
  headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/connect/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        carrierId: input.carrierId,
        carrierName: input.carrierName,
        jobType: input.jobType,
        quoteSessionId: input.quoteSessionId,
        payload: input.payload ?? {},
      }),
    });
  } catch {
    throw new QuotexConnectError(
      "connect_unreachable",
      "Quotex Connect could not reach the secure carrier bridge."
    );
  }

  const body = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        error?: string;
        job?: QuotexConnectJob;
        reused?: boolean;
      }
    | null;

  if (!response.ok || body?.ok !== true || !body.job) {
    const code = body?.error || "connect_job_failed";
    throw new QuotexConnectError(code, connectJobErrorMessage(code));
  }

  return {
    job: body.job,
    reused: body.reused === true,
  };
}

function connectJobErrorMessage(code: string): string {
  switch (code) {
    case "connect_device_required":
      return "Pair this browser with Quotex Connect in Account settings before opening a carrier.";
    case "quote_session_not_found":
      return "This quote flow has not finished syncing yet. Wait a moment and try again.";
    case "agency_account_required":
      return "Sign in to your agency account before opening a carrier.";
    case "account_inactive":
    case "agency_inactive":
      return "This agency account is not active.";
    case "sensitive_job_payload_rejected":
      return "The carrier request contained information that must stay in the local browser.";
    case "connect_unreachable":
      return "Quotex Connect could not reach the secure carrier bridge.";
    default:
      return "Quotex Connect could not start this carrier action.";
  }
}
