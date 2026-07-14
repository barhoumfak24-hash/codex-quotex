import { apiBaseUrl } from "./apiBase";
import { serverSessionHeaders } from "./serverSession";

const LARGE_INLINE_DATA_URL_BYTES = 100 * 1024;
const uploadedBlobRefs = new Map<string, string>();
const pendingBlobUploads = new Map<string, Promise<string>>();

export function isLargeInlineDataUrl(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:") && value.length > LARGE_INLINE_DATA_URL_BYTES;
}

export function resolveStateBlobUrl(value: string): string {
  if (!value.startsWith("blob:")) return value;
  const key = value.slice("blob:".length);
  return `${apiBaseUrl()}/state-blobs/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function storeStateBlob(dataUrl: string, contentType?: string): Promise<string> {
  if (!isLargeInlineDataUrl(dataUrl)) return dataUrl;
  const cached = uploadedBlobRefs.get(dataUrl);
  if (cached) return cached;
  const pending = pendingBlobUploads.get(dataUrl);
  if (pending) return pending;

  const upload = uploadStateBlob(dataUrl, contentType);
  pendingBlobUploads.set(dataUrl, upload);
  try {
    return await upload;
  } finally {
    pendingBlobUploads.delete(dataUrl);
  }
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
  uploadedBlobRefs.set(dataUrl, payload.ref);
  return payload.ref;
}
