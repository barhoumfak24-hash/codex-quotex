import { applyRateLimit } from "./_rateLimit.js";

// GET /api/__diag
//
// Read-only health probe for deployment triage. It reports only whether
// sensitive environment variables are present, never their values.
//
// In production this endpoint requires DIAG_TOKEN, because deployment
// metadata and integration presence are still useful to attackers.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!(await applyRateLimit(req, res, "diag", { windowMs: 60_000, limit: 30 }))) return;
  if (!canReadDiagnostics(req)) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.status(200).json({
    ok: true,
    env: {
      SMARTY_AUTH_ID: !!process.env.SMARTY_AUTH_ID,
      SMARTY_AUTH_TOKEN: !!process.env.SMARTY_AUTH_TOKEN,
      CARRIER_AUTOMATION_ENABLE_LIVE: process.env.CARRIER_AUTOMATION_ENABLE_LIVE === "true",
      CARRIER_AUTOMATION_WORKER_URL: !!process.env.CARRIER_AUTOMATION_WORKER_URL,
      CARRIER_AUTOMATION_WORKER_TOKEN: !!process.env.CARRIER_AUTOMATION_WORKER_TOKEN,
    },
    vercel: {
      region: process.env.VERCEL_REGION ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      env: process.env.VERCEL_ENV ?? null,
    },
    runtime: { node: process.version },
    now: new Date().toISOString(),
  });
}

function canReadDiagnostics(req: any): boolean {
  if (process.env.VERCEL_ENV !== "production") return true;
  const expected = process.env.DIAG_TOKEN;
  if (!expected) return false;
  return bearerToken(req) === expected || queryToken(req) === expected;
}

function bearerToken(req: any): string | null {
  const header = String(req.headers?.authorization ?? "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function queryToken(req: any): string | null {
  const token = req.query?.token;
  return Array.isArray(token) ? token[0] ?? null : token ?? null;
}
