import type { CommunicationAttachment } from "@/types";

export function fileToCommunicationAttachment(file: File): Promise<CommunicationAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.onload = () => {
      resolve({
        id: `attachment_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        dataUrl: String(reader.result ?? ""),
        description: "Uploaded email attachment",
      });
    };
    reader.readAsDataURL(file);
  });
}

export function formatAttachmentSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}
