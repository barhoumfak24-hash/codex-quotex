// =====================================================================
// Vercel Serverless Function — POST /api/carrier-quote-runner
//
// Secure broker for carrier agent-portal quote automation.
//
// This endpoint is intentionally NOT a browser automation worker itself.
// It validates and forwards sanitized quote-runner jobs to a protected
// production worker (Playwright/browser farm, queue, or vendor RPA)
// without exposing carrier credentials to the React bundle.
//
// Required production env:
//   CARRIER_AUTOMATION_ENABLE_LIVE=true
//   CARRIER_AUTOMATION_WORKER_URL=https://...
//   CARRIER_AUTOMATION_WORKER_TOKEN=...
//
// The worker receives only vault references, mapped fields, and the
// carrier portal entry URL. It must resolve credentials server-side,
// handle MFA, fill the quote portal, extract quote results, and return
// an auditable result. This function fails closed when the worker is not
// configured.
// =====================================================================

interface RunnerFieldMapping {
  quotexField: string;
  carrierField: string;
  value: string;
  source: "public_record" | "questionnaire" | "asset_detail" | "system";
  required: boolean;
  confidence: number;
}

interface RunnerJobPayload {
  jobId?: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  carrier?: {
    id?: string;
    name?: string;
    entryUrl?: string;
    agentPortalUrl?: string;
    customerPortalUrl?: string;
    credentialReference?: string;
    mfaMode?: string;
  };
  session?: {
    id?: string;
    customerId?: string;
    prospectId?: string;
    assetId?: string;
    assetType?: string;
    lineOfBusiness?: "personal" | "commercial";
    state?: string;
  };
  fieldMappings?: RunnerFieldMapping[];
  parallelGroupKey?: string;
}

const WORKER_TIMEOUT_MS = 60_000;

function safeJsonParse(value: string): RunnerJobPayload {
  try {
    return JSON.parse(value) as RunnerJobPayload;
  } catch {
    return {};
  }
}

function jsonContainsRawCredential(value: unknown): boolean {
  const blockedKeys = new Set([
    "password",
    "passcode",
    "otp",
    "totp",
    "secret",
    "api_key",
    "apikey",
    "token_value",
    "access_token",
    "refresh_token",
  ]);
  const allowedReferenceKeys = new Set(["credentialreference"]);

  function visit(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(visit);
    return Object.entries(node as Record<string, unknown>).some(([key, child]) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (allowedReferenceKeys.has(normalized)) return false;
      if (blockedKeys.has(normalized)) return true;
      return visit(child);
    });
  }

  return visit(value);
}

function validatePayload(payload: RunnerJobPayload): string[] {
  const errors: string[] = [];
  const entryUrl =
    payload.carrier?.entryUrl ||
    payload.carrier?.agentPortalUrl ||
    payload.carrier?.customerPortalUrl;

  if (!payload.jobId && !payload.requestId) errors.push("jobId or requestId is required");
  if (!payload.tenantId) errors.push("tenantId is required");
  if (!payload.userId) errors.push("userId is required");
  if (!payload.carrier?.id) errors.push("carrier.id is required");
  if (!payload.carrier?.name) errors.push("carrier.name is required");
  if (!entryUrl || !/^https:\/\//i.test(entryUrl)) {
    errors.push("carrier entry URL must be HTTPS");
  }
  if (!payload.carrier?.credentialReference) {
    errors.push("carrier.credentialReference is required");
  }
  if (!Array.isArray(payload.fieldMappings) || payload.fieldMappings.length === 0) {
    errors.push("fieldMappings are required");
  }
  if (jsonContainsRawCredential(payload)) {
    errors.push("raw credentials are not accepted by this endpoint");
  }

  return errors;
}

function sanitizedForwardPayload(payload: RunnerJobPayload) {
  return {
    jobId: payload.jobId ?? payload.requestId,
    requestId: payload.requestId,
    tenantId: payload.tenantId,
    userId: payload.userId,
    carrier: {
      id: payload.carrier?.id,
      name: payload.carrier?.name,
      entryUrl:
        payload.carrier?.entryUrl ||
        payload.carrier?.agentPortalUrl ||
        payload.carrier?.customerPortalUrl,
      credentialReference: payload.carrier?.credentialReference,
      mfaMode: payload.carrier?.mfaMode ?? "staff_prompt",
    },
    session: payload.session,
    fieldMappings: payload.fieldMappings,
    parallelGroupKey: payload.parallelGroupKey,
    requestedAt: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const payload: RunnerJobPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});
  const validationErrors = validatePayload(payload);
  if (validationErrors.length > 0) {
    res.status(400).json({ error: "invalid_runner_payload", details: validationErrors });
    return;
  }

  if (process.env.CARRIER_AUTOMATION_ENABLE_LIVE !== "true") {
    res.status(503).json({
      error: "carrier_automation_disabled",
      message: "Carrier portal automation is disabled until production live mode is explicitly enabled.",
    });
    return;
  }

  const workerUrl = process.env.CARRIER_AUTOMATION_WORKER_URL;
  const workerToken = process.env.CARRIER_AUTOMATION_WORKER_TOKEN;
  if (!workerUrl || !workerToken || !/^https:\/\//i.test(workerUrl)) {
    res.status(503).json({
      error: "carrier_automation_worker_not_configured",
      message: "Carrier portal automation worker URL/token is not configured.",
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const upstream = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify(sanitizedForwardPayload(payload)),
      signal: controller.signal,
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.status(502).json({
        error: "carrier_automation_worker_failed",
        status: upstream.status,
        message:
          typeof data?.message === "string"
            ? data.message
            : "Carrier portal automation worker returned an error.",
      });
      return;
    }
    res.status(200).json({
      ok: true,
      jobId: payload.jobId ?? payload.requestId,
      result: data,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    res.status(aborted ? 504 : 502).json({
      error: aborted ? "carrier_automation_worker_timeout" : "carrier_automation_worker_unreachable",
      message: aborted
        ? "Carrier portal automation worker timed out."
        : "Carrier portal automation worker could not be reached.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
