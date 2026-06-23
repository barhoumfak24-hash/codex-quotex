import { applyRateLimit } from "./_rateLimit";
import {
  executeCarrierAutomationJob,
  type CarrierAutomationJobPayload,
  workerConfigFromEnv,
} from "./_carrierAutomationWorker";

function safeJsonParse(value: string): CarrierAutomationJobPayload {
  try {
    return JSON.parse(value) as CarrierAutomationJobPayload;
  } catch {
    return {};
  }
}

function bearerToken(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const raw = req.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!(await applyRateLimit(req, res, "carrier-automation-worker", { windowMs: 60_000, limit: 10 }))) return;

  const expectedToken = process.env.CARRIER_AUTOMATION_WORKER_TOKEN;
  if (!expectedToken || bearerToken(req) !== expectedToken) {
    res.status(401).json({ error: "unauthorized_worker_request" });
    return;
  }

  const payload: CarrierAutomationJobPayload =
    typeof req.body === "string" ? safeJsonParse(req.body) : (req.body ?? {});

  const result = await executeCarrierAutomationJob(payload, workerConfigFromEnv(process.env));
  res.status(result.ok ? 200 : result.status === "blocked" ? 400 : 502).json(result);
}
