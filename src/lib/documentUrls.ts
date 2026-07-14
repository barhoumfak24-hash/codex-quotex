import type { Document } from "@/types";
import { resolveStateBlobUrl } from "./stateBlobs";

export function documentFileUrl(d: Pick<Document, "downloadUrl" | "storagePath">): string | null {
  if (d.downloadUrl?.startsWith("blob:")) return resolveStateBlobUrl(d.downloadUrl);
  if (d.downloadUrl) return d.downloadUrl;
  if (d.storagePath?.startsWith("blob:")) return resolveStateBlobUrl(d.storagePath);
  if (d.storagePath?.startsWith("/")) return d.storagePath;
  if (d.storagePath?.startsWith("public://")) {
    return `/${d.storagePath.replace(/^public:\/\//, "")}`;
  }
  return null;
}
