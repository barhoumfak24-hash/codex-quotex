// =====================================================================
// Vercel Serverless Function — GET /api/__diag
//
// Read-only health probe. Returns presence/absence of the env vars
// the property-records lookup depends on, plus the Vercel deployment
// metadata so we can verify the latest code is actually live.
//
// SAFE TO EXPOSE: never echoes the env-var VALUES, only whether they
// are set. Useful when triaging "lookup isn't working" — open
// https://<your-domain>/api/__diag in any browser and screenshot.
//
// Sample healthy response:
//   {
//     "ok": true,
//     "env": {
//       "SMARTY_AUTH_ID": true,
//       "SMARTY_AUTH_TOKEN": true
//     },
//     "vercel": {
//       "region": "iad1",
//       "deploymentId": "dpl_…",
//       "gitCommitSha": "2c4b241…",
//       "gitBranch": "claude/quotex-insurance-platform-dfSjs",
//       "env": "production"
//     },
//     "runtime": { "node": "v20.…" },
//     "now": "2026-05-13T…"
//   }
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  res.status(200).json({
    ok: true,
    env: {
      SMARTY_AUTH_ID: !!process.env.SMARTY_AUTH_ID,
      SMARTY_AUTH_TOKEN: !!process.env.SMARTY_AUTH_TOKEN,
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