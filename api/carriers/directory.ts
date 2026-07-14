import { CARRIER_DIRECTORY_PAYLOAD } from "../_carrierDirectoryPayload.js";
import { applyRateLimit } from "../_rateLimit.js";

// GET /api/carriers/directory
//
// Public, read-only carrier launcher directory for Quotex Connect. It exposes
// carrier names and portal URLs only. No agency data, credentials, recipes, or
// tenant-scoped records are returned here.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (
    !(await applyRateLimit(req, res, "carrier-directory", {
      windowMs: 60_000,
      limit: 120,
      failOpen: true,
    }))
  ) {
    return;
  }

  res.status(200).json(CARRIER_DIRECTORY_PAYLOAD);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCorsHeaders(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
}
