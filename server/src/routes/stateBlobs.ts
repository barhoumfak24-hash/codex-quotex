import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateRequest, type AuthContext } from "../middleware/auth.js";
import {
  canAccessAgencyStateForAuth,
  scopeStateSnapshotForAuth,
  stateScopeForAuth,
} from "../services/stateSnapshotScope.js";
import { readRemoteState } from "../services/supabaseState.js";

export const stateBlobRoutes = Router();

const MAX_STATE_BLOB_BYTES = 3 * 1024 * 1024;
const MAX_DIRECT_STATE_BLOB_BYTES = 50 * 1024 * 1024;
const DEFAULT_BUCKET = "quotex-app-blobs";

const stateBlobPayloadSchema = z.object({
  dataUrl: z.string().min(1),
  contentType: z.string().min(1).optional(),
});

const stateBlobUploadUrlSchema = z.object({
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_DIRECT_STATE_BLOB_BYTES),
});

stateBlobRoutes.post("/upload-url", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const access = stateBlobAccess(req);
    if (!access) return res.status(401).json({ error: "unauthorized" });
    if (!canAccessAgencyStateForAuth(access.auth)) return res.status(403).json({ error: "forbidden" });
    if (!supabaseStorageConfigured()) {
      return res.status(503).json({ error: "state_blob_storage_not_configured" });
    }

    const parsed = stateBlobUploadUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_state_blob_upload", details: parsed.error.flatten() });
    }

    const key = `${blobScopeKey(access)}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extensionForContentType(parsed.data.contentType)}`;
    const signed = await fetch(
      `${supabaseUrl()}/storage/v1/object/upload/sign/${stateBlobBucket()}/${key}`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey(),
          authorization: `Bearer ${supabaseKey()}`,
          "content-type": "application/json",
          "x-upsert": "false",
        },
        body: "{}",
      }
    );
    const payload = (await signed.json().catch(() => null)) as { url?: string; error?: string; message?: string } | null;
    if (!signed.ok || !payload?.url) {
      return res.status(502).json({
        error: "state_blob_upload_url_failed",
        details: String(payload?.error || payload?.message || signed.status).slice(0, 300),
      });
    }

    return res.json({
      ok: true,
      ref: `blob:${key}`,
      key,
      contentType: parsed.data.contentType,
      sizeBytes: parsed.data.sizeBytes,
      uploadUrl: absoluteSupabaseStorageUrl(payload.url),
      maxBytes: MAX_DIRECT_STATE_BLOB_BYTES,
    });
  } catch (error) {
    next(error);
  }
});

stateBlobRoutes.post("/", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const access = stateBlobAccess(req);
    if (!access) return res.status(401).json({ error: "unauthorized" });
    if (!canAccessAgencyStateForAuth(access.auth)) return res.status(403).json({ error: "forbidden" });
    if (!supabaseStorageConfigured()) {
      return res.status(503).json({ error: "state_blob_storage_not_configured" });
    }

    const parsed = stateBlobPayloadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_state_blob", details: parsed.error.flatten() });

    const decoded = decodeDataUrl(parsed.data.dataUrl, parsed.data.contentType);
    if (!decoded) return res.status(400).json({ error: "invalid_data_url" });
    if (decoded.bytes.length > MAX_STATE_BLOB_BYTES) {
      return res.status(413).json({
        error: "state_blob_too_large",
        maxBytes: MAX_STATE_BLOB_BYTES,
      });
    }

    const key = `${blobScopeKey(access)}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extensionForContentType(decoded.contentType)}`;
    const uploadBody = decoded.bytes.buffer.slice(
      decoded.bytes.byteOffset,
      decoded.bytes.byteOffset + decoded.bytes.byteLength
    ) as ArrayBuffer;
    const put = await fetch(`${supabaseUrl()}/storage/v1/object/${stateBlobBucket()}/${key}`, {
      method: "POST",
      headers: {
        apikey: supabaseKey(),
        authorization: `Bearer ${supabaseKey()}`,
        "content-type": decoded.contentType,
        "x-upsert": "false",
      },
      body: uploadBody,
    });
    if (!put.ok) {
      const text = await put.text();
      return res.status(502).json({ error: "state_blob_store_failed", details: text.slice(0, 300) });
    }

    return res.json({
      ok: true,
      ref: `blob:${key}`,
      key,
      contentType: decoded.contentType,
      sizeBytes: decoded.bytes.length,
    });
  } catch (error) {
    next(error);
  }
});

stateBlobRoutes.get("/:key(*)", async (req, res, next) => {
  try {
    const access = stateBlobAccess(req);
    if (!access) return res.status(401).json({ error: "unauthorized" });
    if (!canAccessAgencyStateForAuth(access.auth)) return res.status(403).json({ error: "forbidden" });
    if (!supabaseStorageConfigured()) {
      return res.status(503).json({ error: "state_blob_storage_not_configured" });
    }
    const routeParams = req.params as unknown as Record<string, string>;
    const key = normalizeBlobKey(routeParams.key ?? routeParams["key(*)"] ?? "");
    if (!key) return res.status(400).json({ error: "invalid_state_blob_key" });
    if (!(await canReadBlobKey(req, access, key))) return res.status(403).json({ error: "forbidden" });

    const get = await fetch(`${supabaseUrl()}/storage/v1/object/${stateBlobBucket()}/${key}`, {
      method: "GET",
      headers: {
        apikey: supabaseKey(),
        authorization: `Bearer ${supabaseKey()}`,
      },
    });
    if (!get.ok) {
      const text = await get.text();
      return res.status(get.status === 404 ? 404 : 502).json({
        error: get.status === 404 ? "state_blob_not_found" : "state_blob_read_failed",
        details: text.slice(0, 300),
      });
    }

    const contentType = get.headers.get("content-type") ?? "application/octet-stream";
    const bytes = Buffer.from(await get.arrayBuffer());
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Vary", "Authorization");
    res.setHeader("Content-Type", contentType);
    res.send(bytes);
  } catch (error) {
    next(error);
  }
});

function decodeDataUrl(dataUrl: string, fallbackContentType?: string): { contentType: string; bytes: Buffer } | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const contentType = match[1] || fallbackContentType || "application/octet-stream";
  const raw = match[3] ?? "";
  const bytes = match[2]
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf8");
  return { contentType, bytes };
}

function extensionForContentType(contentType: string) {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("json")) return "json";
  if (contentType.startsWith("text/")) return "txt";
  return "bin";
}

function normalizeBlobKey(value: string) {
  const trimmed = value.replace(/^blob:/, "").trim();
  if (!SCOPED_BLOB_KEY_PATTERN.test(trimmed) && !LEGACY_BLOB_KEY_PATTERN.test(trimmed)) {
    return "";
  }
  return trimmed;
}

const LEGACY_BLOB_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.[a-z0-9]+$/i;
const SCOPED_BLOB_KEY_PATTERN = /^(?:tenant\/[a-f0-9]{32}|platform|token)\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.[a-z0-9]+$/i;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function supabaseUrl(): string {
  return env("SUPABASE_URL").replace(/\/+$/, "");
}

function supabaseKey(): string {
  return env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
}

function stateBlobBucket(): string {
  return env("SUPABASE_STATE_BLOB_BUCKET") || DEFAULT_BUCKET;
}

function supabaseStorageConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

function absoluteSupabaseStorageUrl(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.startsWith("/") ? value : `/${value}`;
  return `${supabaseUrl()}/storage/v1${path}`;
}

type StateBlobAccess = {
  auth: AuthContext | null;
  tokenAccess: boolean;
};

function stateBlobAccess(req: Request): StateBlobAccess | null {
  const auth = authenticateBlobRequest(req);
  if (auth) return { auth, tokenAccess: false };
  const expected = process.env.STATE_SYNC_TOKEN?.trim();
  if (!expected) return null;
  const headerToken = req.header("x-state-sync-token")?.trim();
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (
    constantTimeEquals(headerToken ?? "", expected) ||
    constantTimeEquals(bearer ?? "", expected)
  ) {
    return { auth: null, tokenAccess: true };
  }
  return null;
}

function authenticateBlobRequest(req: Request): AuthContext | null {
  const direct = authenticateRequest(req);
  if (direct) return direct;
  const queryToken = typeof req.query.access_token === "string" ? req.query.access_token.trim() : "";
  if (!queryToken) return null;

  const requestWithBearer = Object.create(req) as Request;
  requestWithBearer.header = ((name: string) =>
    name.toLowerCase() === "authorization" ? `Bearer ${queryToken}` : req.header(name)) as Request["header"];
  return authenticateRequest(requestWithBearer);
}

function blobScopeKey(access: StateBlobAccess): string {
  const scope = stateScopeForAuth(access.auth);
  if (scope === "tenant" && access.auth?.tenantId) return tenantBlobScope(access.auth.tenantId);
  return scope === "platform" ? "platform" : "token";
}

async function canReadBlobKey(req: Request, access: StateBlobAccess, key: string): Promise<boolean> {
  if (LEGACY_BLOB_KEY_PATTERN.test(key)) return canReadLegacyBlobKey(req, access, key);
  const scope = stateScopeForAuth(access.auth);
  if (scope === "platform") return true;
  if (scope === "tenant" && access.auth?.tenantId) {
    return key.startsWith(`${tenantBlobScope(access.auth.tenantId)}/`);
  }
  return access.tokenAccess && key.startsWith("token/");
}

async function canReadLegacyBlobKey(req: Request, access: StateBlobAccess, key: string): Promise<boolean> {
  const scope = stateScopeForAuth(access.auth);
  if ((scope !== "tenant" && scope !== "platform") || !access.auth) return false;
  const stateId = requestedStateId(req);
  if (!stateId) return false;

  const row = await readRemoteState(`app_state:${stateId}`);
  if (!row) return false;
  const scoped = scopeStateSnapshotForAuth(row.snapshot, access.auth);
  return scopedSnapshotReferencesLegacyBlob(scoped.snapshot, key);
}

function scopedSnapshotReferencesLegacyBlob(snapshot: unknown, key: string): boolean {
  if (!isObject(snapshot)) return false;
  const ref = `blob:${key}`;
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  if (
    documents.some(
      (document) =>
        isObject(document) &&
        (document.downloadUrl === ref || document.storagePath === ref)
    )
  ) {
    return true;
  }

  const communications = Array.isArray(snapshot.communications) ? snapshot.communications : [];
  return communications.some((communication) => {
    if (!isObject(communication) || !Array.isArray(communication.attachments)) return false;
    return communication.attachments.some(
      (attachment) =>
        isObject(attachment) &&
        (attachment.dataUrl === ref || attachment.storagePath === ref)
    );
  });
}

function requestedStateId(req: Request): string {
  const raw = typeof req.query.state_id === "string" ? req.query.state_id.trim() : "default";
  return raw.replace(/[^a-z0-9-]/gi, "").slice(0, 80);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tenantBlobScope(tenantId: string): string {
  const digest = createHash("sha256").update(tenantId).digest("hex").slice(0, 32);
  return `tenant/${digest}`;
}

function constantTimeEquals(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
