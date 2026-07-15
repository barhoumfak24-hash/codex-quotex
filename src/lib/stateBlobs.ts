import { apiBaseUrl, envValue } from "./apiBase";
import { currentServerSessionToken, serverSessionHeaders } from "./serverSession";

const LARGE_INLINE_DATA_URL_BYTES = 100 * 1024;
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
