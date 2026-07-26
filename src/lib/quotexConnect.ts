import { apiBaseUrl } from "@/lib/apiBase";
import { serverSessionHeaders } from "@/lib/serverSession";

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
