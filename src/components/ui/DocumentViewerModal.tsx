import type { Document } from "@/types";
import { fmt } from "@/lib/format";
import { Badge } from "./Badge";
import { Modal } from "./Modal";
import { Download, FileImage } from "lucide-react";

// =====================================================================
// Shared document viewer + download helpers.
//
// Used by:
//   - DocumentList (customer + agent portals, every doc surface)
//   - AnalyticsPage drill-down DocList (manager quick-view inside
//     the metric detail modal)
//
// In production the viewer swaps the faux letter-size pane below
// for an <iframe> against a signed PDF/image viewer URL on the
// documents service; the download helper swaps to a signed S3
// link. The demo records metadata only.
// =====================================================================

export function downloadDocumentStub(d: Document) {
  const body = [
    `Quotex Insurance — Demo Document Placeholder`,
    ``,
    `File:        ${d.fileName}`,
    `Type:        ${d.type}`,
    `Status:      ${d.status}`,
    `Uploaded:    ${d.uploadedAt}`,
    `Tenant:      ${d.tenantId}`,
    `Storage:     ${d.storagePath}`,
    ``,
    `In production this would be a signed S3 URL returning the real file.`,
    `No real document content exists in the demo environment.`,
  ].join("\n");
  const blob = new Blob([body], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = d.fileName.replace(/\.[^.]+$/, "") + "-demo.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DocumentViewerModal({
  document: d,
  open,
  onClose,
  onDownload,
}: {
  document: Document | null;
  open: boolean;
  onClose: () => void;
  onDownload?: () => void;
}) {
  if (!d) return null;
  const isImage = d.fileType?.startsWith("image/");
  const handleDownload = onDownload ?? (() => downloadDocumentStub(d));
  return (
    <Modal open={open} onClose={onClose} title={d.fileName} size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-ink-500">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{fmt.titleCase(d.type)}</span>
            <span>·</span>
            <span>Uploaded {fmt.date(d.uploadedAt)}</span>
            <Badge tone={d.status === "approved" ? "success" : d.status === "rejected" ? "error" : "warn"}>
              {fmt.titleCase(d.status)}
            </Badge>
          </div>
          <button type="button" className="btn-outline text-xs" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" /> Download
          </button>
        </div>

        {/* Viewer pane — letter-size faux page on a neutral
            background. In production this swaps to an <iframe>
            against a signed PDF/image viewer URL. */}
        <div className="rounded-md bg-ink-100 border border-ink-200 p-4 sm:p-6 max-h-[70vh] overflow-y-auto">
          <div className="mx-auto bg-white shadow-luxe border border-ink-100 max-w-2xl aspect-[8.5/11] p-8 sm:p-12 text-sm leading-relaxed text-ink-800">
            {isImage ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                <FileImage className="h-12 w-12 text-ink-300" />
                <div>
                  <div className="font-medium text-ink-900">{d.fileName}</div>
                  <p className="text-xs text-ink-500 mt-1 max-w-sm mx-auto">
                    Image preview is rendered inline in production. The demo doesn't carry
                    actual file bytes for privacy.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="font-display text-2xl">{d.fileName}</div>
                <div className="text-xs uppercase tracking-wider text-ink-500 mt-1">
                  {fmt.titleCase(d.type)} — {d.status}
                </div>
                <hr className="my-5 border-ink-100" />
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
                  <dt className="text-ink-500">Uploaded</dt>
                  <dd>{fmt.date(d.uploadedAt)}</dd>
                  <dt className="text-ink-500">Visibility</dt>
                  <dd>{d.visibility.replace(/_/g, " ")}</dd>
                  <dt className="text-ink-500">Storage path</dt>
                  <dd className="font-mono break-all">{d.storagePath}</dd>
                </dl>
                <div className="mt-8 rounded-md border border-dashed border-ink-200 bg-ink-50 p-4 text-xs text-ink-600">
                  This is the Quotex demo viewer. In production this pane embeds the actual
                  PDF or image via a signed viewer URL on the document service — no new tab,
                  no download required. The audit log records every view.
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-primary text-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}