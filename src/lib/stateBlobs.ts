import { apiBaseUrl, envValue } from "./apiBase";
import { currentServerSessionToken, serverSessionHeaders } from "./serverSession";

const LARGE_INLINE_DATA_URL_BYTES = 100 * 1024;
const DIRECT_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const uploadedBlobRefs = new Map<string, string>();
const pendingBlobUploads = new Map<string, Promise<string>>();

export function isLargeInlineDataUrl(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:") && value.length > LARGE_INLINE_DATA_URL_BYTES;
}

export function resolveStateBlobUrl(value: string): string {
  if (!value.startsWith("blob:")) return value;
  const key = value.slice("blob:".length);
  const url = `${apiBaseUrl()}/state-blobs/${key.split("/").map(encodeURIComponent).join("/")}`;
  const query = new URLSearchParams();
  const token = currentServerSessionToken();
  if (token) query.set("access_token", token);
  if (/^\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.[a-z0-9]+$/i.test(key)) {
    query.set("state_id", envValue("VITE_STATE_SYNC_ID") || "default");
  }
  const suffix = query.toString();
  return suffix ? `${url}?${suffix}` : url;
}

export async function storeStateBlob(dataUrl: string, contentType?: string): Promise<string> {
  if (!isLargeInlineDataUrl(dataUrl)) return dataUrl;
  const cacheKey = stateBlobCacheKey(dataUrl);
  const cached = uploadedBlobRefs.get(cacheKey);
  if (cached) return cached;
  const pending = pendingBlobUploads.get(cacheKey);
  if (pending) return pending;

  const upload = uploadStateBlob(dataUrl, contentType).then((ref) => {
    uploadedBlobRefs.set(cacheKey, ref);
    return ref;
  });
  pendingBlobUploads.set(cacheKey, upload);
  try {
    return await upload;
  } finally {
    pendingBlobUploads.delete(cacheKey);
  }
}

function stateBlobCacheKey(dataUrl: string): string {
  return `${currentServerSessionToken() ?? "unauthenticated"}\u0000${dataUrl}`;
}

async function uploadStateBlob(dataUrl: string, contentType?: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl, contentType);
  if (!parsed) throw new Error("State blob upload received an invalid file.");
  if (parsed.sizeBytes > DIRECT_UPLOAD_THRESHOLD_BYTES) {
    return uploadStateBlobDirect(parsed);
  }

  const res = await fetch(`${apiBaseUrl()}/state-blobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...serverSessionHeaders(),
    },
    body: JSON.stringify({ dataUrl, contentType }),
  });
  const payload = (await res.json().catch(() => null)) as { ref?: string; error?: string } | null;
  if (!res.ok) {
    throw new Error(payload?.error ? `State blob upload failed: ${payload.error}` : `State blob upload failed: ${res.status}`);
  }
  if (!payload?.ref?.startsWith("blob:")) {
    throw new Error("State blob upload did not return a blob reference.");
  }
  return payload.ref;
}

type ParsedDataUrl = {
  contentType: string;
  encoded: string;
  base64: boolean;
  sizeBytes: number;
};

function parseDataUrl(dataUrl: string, fallbackContentType?: string): ParsedDataUrl | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const encoded = match[3] ?? "";
  const base64 = Boolean(match[2]);
  const sizeBytes = base64
    ? Math.max(0, Math.floor((encoded.length * 3) / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0))
    : new TextEncoder().encode(decodeURIComponent(encoded)).byteLength;
  return {
    contentType: match[1] || fallbackContentType || "application/octet-stream",
    encoded,
    base64,
    sizeBytes,
  };
}

async function uploadStateBlobDirect(file: ParsedDataUrl): Promise<string> {
  const permission = await fetch(`${apiBaseUrl()}/state-blobs/upload-url`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...serverSessionHeaders(),
    },
    body: JSON.stringify({ contentType: file.contentType, sizeBytes: file.sizeBytes }),
  });
  const payload = (await permission.json().catch(() => null)) as {
    ref?: string;
    uploadUrl?: string;
    error?: string;
  } | null;
  if (!permission.ok) {
    throw new Error(payload?.error ? `State blob upload failed: ${payload.error}` : `State blob upload failed: ${permission.status}`);
  }
  if (!payload?.ref?.startsWith("blob:") || !payload.uploadUrl) {
    throw new Error("State blob upload permission was incomplete.");
  }

  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", dataUrlBlob(file));
  const upload = await fetch(payload.uploadUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: form,
  });
  if (!upload.ok) {
    throw new Error(`State blob upload failed: ${upload.status}`);
  }
  return payload.ref;
}

function dataUrlBlob(file: ParsedDataUrl): Blob {
  if (!file.base64) {
    return new Blob([decodeURIComponent(file.encoded)], { type: file.contentType });
  }
  const binary = atob(file.encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: file.contentType });
}
