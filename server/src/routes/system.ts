import { Router } from "express";
import { requireRole } from "../middleware/auth.js";
import { runDisasterRecoveryCheck } from "../services/disasterRecovery.js";
import { databaseHealth } from "../services/prisma.js";

export const systemRoutes = Router();

systemRoutes.get("/database", async (_req, res) => {
  try {
    const health = await databaseHealth();
    res.status(health.ok ? 200 : 503).json(health);
  } catch (_error) {
    res.status(503).json({
      ok: false,
      configured: true,
      provider: "supabase-postgres",
      checkedAt: new Date().toISOString(),
    });
  }
});

systemRoutes.get(
  "/disaster-recovery",
  requireRole("platform_owner", "platform_admin", "master_admin"),
  async (_req, res, next) => {
    try {
      const report = await runDisasterRecoveryCheck({ source: "admin-status", persist: false });
      res.status(report.ok ? 200 : 503).json(report);
    } catch (error) {
      next(error);
    }
  }
);
