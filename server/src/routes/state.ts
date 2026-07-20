import { timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateRequest, validateAuthContext, type AuthContext } from "../middleware/auth.js";
import {
  readRemoteState,
  SupabaseStateUnavailableError,
  supabaseStateConfigured,
  writeRemoteState,
} from "../services/supabaseState.js";
import {
  mergeStateSnapshotForAuth,
  scopeStateSnapshotForAuth,
  stateScopeForAuth,
} from "../services/stateSnapshotScope.js";

export const stateRoutes = Router();

const statePayloadSchema = z.object({
  snapshot: z.unknown(),
  baseRevision: z.number().int().nonnegative().nullable().optional(),
});

stateRoutes.get("/:stateId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const access = await stateAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.reason });
    if (!supabaseStateConfigured()) return res.status(503).json({ found: false, error: "state_sync_not_configured" });

    const stateId = normalizeStateId(req.params.stateId);
    if (!stateId) return res.status(400).json({ error: "invalid_state_id" });

    const row = await readRemoteState(appStateId(stateId));
    const scoped = row
      ? scopeStateSnapshotForAuth(row.snapshot, access.auth)
      : { scoped: ["tenant", "customer"].includes(stateScopeForAuth(access.auth)), snapshot: null };
    return res.json({
      found: Boolean(row),
      scoped: scoped.scoped,
      snapshot: scoped.snapshot,
      updatedAt: row?.updated_at,
      revision: row?.revision ?? null,
    });
  } catch (error) {
    if (error instanceof SupabaseStateUnavailableError) {
      return res.status(503).json({ found: false, error: "state_sync_temporarily_unavailable" });
    }
    next(error);
  }
});

stateRoutes.put("/:stateId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const access = await stateAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.reason });
    if (!supabaseStateConfigured()) return res.status(503).json({ ok: false, error: "state_sync_not_configured" });

    const stateId = normalizeStateId(req.params.stateId);
    if (!stateId) return res.status(400).json({ error: "invalid_state_id" });

    const parsed = statePayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_state", details: parsed.error.flatten() });

    const id = appStateId(stateId);
    if (parsed.data.baseRevision === undefined) {
      return res.status(400).json({ error: "base_revision_required" });
    }
    const current = await readRemoteState(id);
    if ((current?.revision ?? null) !== parsed.data.baseRevision) {
      const scopedConflict = scopeStateSnapshotForAuth(current?.snapshot ?? null, access.auth);
      return res.status(409).json({
        ok: false,
        error: "state_revision_conflict",
        scoped: scopedConflict.scoped,
        snapshot: scopedConflict.snapshot,
        updatedAt: current?.updated_at,
        revision: current?.revision ?? null,
      });
    }
    const currentScoped = scopeStateSnapshotForAuth(current?.snapshot ?? null, access.auth);
    if (current && isDeepStrictEqual(currentScoped.snapshot, parsed.data.snapshot)) {
      return res.json({
        ok: true,
        unchanged: true,
        scoped: currentScoped.scoped,
        snapshot: currentScoped.snapshot,
        updatedAt: current.updated_at,
        revision: current.revision,
      });
    }
    const snapshot = mergeStateSnapshotForAuth(
      current?.snapshot ?? {},
      parsed.data.snapshot,
      access.auth
    );
    const baseRevision = parsed.data.baseRevision;

    // Polling clients can submit an already-current scoped snapshot. Treat it
    // as a successful save without creating a new revision or recovery copy.
    if (current && isDeepStrictEqual(current.snapshot, snapshot)) {
      const scoped = scopeStateSnapshotForAuth(current.snapshot, access.auth);
      return res.json({
        ok: true,
        unchanged: true,
        scoped: scoped.scoped,
        snapshot: scoped.snapshot,
        updatedAt: current.updated_at,
        revision: current.revision,
      });
    }

    const result = await writeRemoteState(id, snapshot, baseRevision);
    if (!result.ok) {
      const scopedConflict = scopeStateSnapshotForAuth(result.current?.snapshot ?? null, access.auth);
      return res.status(409).json({
        ok: false,
        error: "state_revision_conflict",
        scoped: scopedConflict.scoped,
        snapshot: scopedConflict.snapshot,
        updatedAt: result.current?.updated_at,
        revision: result.current?.revision ?? null,
      });
    }
    const scoped = scopeStateSnapshotForAuth(result.row.snapshot, access.auth);
    return res.json({
      ok: true,
      scoped: scoped.scoped,
      snapshot: scoped.snapshot,
      updatedAt: result.row.updated_at,
      revision: result.row.revision,
    });
  } catch (error) {
    if (error instanceof SupabaseStateUnavailableError) {
      return res.status(503).json({ ok: false, error: "state_sync_temporarily_unavailable" });
    }
    next(error);
  }
});

function appStateId(stateId: string) {
  return `app_state:${stateId}`;
}

function normalizeStateId(value: string | undefined) {
  return value?.trim().replace(/[^a-z0-9-]/gi, "").slice(0, 80) ?? "";
}

type StateAccess =
  | { ok: true; auth: AuthContext | null; tokenAccess: boolean }
  | { ok: false; status: number; reason: string };

async function stateAccess(req: Request): Promise<StateAccess> {
  const auth = authenticateRequest(req);
  if (auth) {
    const validation = await validateAuthContext(auth);
    if (!validation.ok) {
      return { ok: false, status: validation.status, reason: validation.reason };
    }
    return { ok: true, auth: validation.auth, tokenAccess: false };
  }

  // Operational state tokens are never accepted by the public production
  // route because they have no tenant scope. Development keeps the explicit
  // token path for local migration and route tests only.
  if (process.env.NODE_ENV === "production") {
    return { ok: false, status: 401, reason: "unauthorized" };
  }

  const expected = process.env.STATE_SYNC_TOKEN?.trim();
  if (!expected) {
    return { ok: true, auth: null, tokenAccess: true };
  }
  const headerToken = req.header("x-state-sync-token")?.trim();
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (constantTimeEquals(headerToken ?? "", expected) || constantTimeEquals(bearer ?? "", expected)) {
    return { ok: true, auth: null, tokenAccess: true };
  }
  return { ok: false, status: 401, reason: "unauthorized" };
}

function constantTimeEquals(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
