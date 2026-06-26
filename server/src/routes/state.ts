import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { readRemoteState, supabaseStateConfigured, writeRemoteState } from "../services/supabaseState.js";

export const stateRoutes = Router();

const statePayloadSchema = z.object({
  snapshot: z.unknown(),
});

stateRoutes.get("/:stateId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    if (!stateAccessAllowed(req)) return res.status(401).json({ error: "unauthorized" });
    if (!supabaseStateConfigured()) return res.status(503).json({ found: false, error: "state_sync_not_configured" });

    const stateId = normalizeStateId(req.params.stateId);
    if (!stateId) return res.status(400).json({ error: "invalid_state_id" });

    const row = await readRemoteState(appStateId(stateId));
    return res.json({ found: Boolean(row), snapshot: row?.snapshot ?? null, updatedAt: row?.updated_at });
  } catch (error) {
    next(error);
  }
});

stateRoutes.put("/:stateId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    if (!stateAccessAllowed(req)) return res.status(401).json({ error: "unauthorized" });
    if (!supabaseStateConfigured()) return res.status(503).json({ ok: false, error: "state_sync_not_configured" });

    const stateId = normalizeStateId(req.params.stateId);
    if (!stateId) return res.status(400).json({ error: "invalid_state_id" });

    const parsed = statePayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_state", details: parsed.error.flatten() });

    const row = await writeRemoteState(appStateId(stateId), parsed.data.snapshot);
    return res.json({ ok: true, snapshot: row.snapshot, updatedAt: row.updated_at });
  } catch (error) {
    next(error);
  }
});

function appStateId(stateId: string) {
  return `app_state:${stateId}`;
}

function normalizeStateId(value: string | undefined) {
  return value?.trim().replace(/[^a-z0-9-]/gi, "").slice(0, 80) ?? "";
}

function stateAccessAllowed(req: Request): boolean {
  const expected = process.env.STATE_SYNC_TOKEN?.trim();
  if (!expected) return true;
  const headerToken = req.header("x-state-sync-token")?.trim();
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return constantTimeEquals(headerToken ?? "", expected) || constantTimeEquals(bearer ?? "", expected);
}

function constantTimeEquals(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
