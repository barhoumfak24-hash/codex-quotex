import { randomUUID, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { authenticateRequest } from "../middleware/auth.js";

export const stateBlobRoutes = Router();

const MAX_STATE_BLOB_BYTES = 3 * 1024 * 1024;
const DEFAULT_BUCKET = "quotex-app-blobs";

const stateBlobPayloadSchema = z.object({
  dataUrl: z.string().min(1),
  contentType: z.string().min(1).optional(),
});

stateBlobRoutes.post("/", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    if (!stateAccessAllowed(req)) return res.status(401).json({ error: "unauthorized" });
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

    const key = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extensionForContentType(decoded.contentType)}`;
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

stateBlobRoutes.get("/:date/:name", async (req, res, next) => {
  try {
    if (!supabaseStorageConfigured()) {
      return res.status(503).json({ error: "state_blob_storage_not_configured" });
    }
    const key = normalizeBlobKey(`${req.params.date}/${req.params.name}`);
    if (!key) return res.status(400).json({ error: "invalid_state_blob_key" });

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
  if (!/^\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.[a-z0-9]+$/i.test(trimmed)) return "";
  return trimmed;
}

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

function stateAccessAllowed(req: Request): boolean {
  if (authenticateRequest(req)) return true;
  const expected = process.env.STATE_SYNC_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const headerToken = req.header("x-state-sync-token")?.trim();
  const bearer = req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return (
    constantTimeEquals(headerToken ?? "", expected) ||
    constantTimeEquals(bearer ?? "", expected)
  );
}

function constantTimeEquals(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
