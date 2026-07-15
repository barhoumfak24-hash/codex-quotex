import type { Document, DocumentTemplateFieldBox, TemplateFieldMap } from "@/types";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { api } from "@/lib/api";
import { documentFileUrl as resolveDocumentFileUrl } from "@/lib/documentUrls";
import { detectFillableDocumentFields } from "@/lib/fillableDocumentFields";
import {
  buildAcroFormFillPlan,
  bytesToPdfBlobUrl,
  bytesToPdfDataUrl,
  extractAcroFormFields,
  fillPdfAcroForm,
} from "@/lib/pdfAcroForm";
import { Badge } from "./Badge";
import { Modal } from "./Modal";
import { Download, FileImage, Pencil, Save } from "lucide-react";
import {
  DocumentTemplateFieldOverlay,
  DocumentTemplateFieldsEditor,
  DocumentTemplateFieldsPreview,
} from "./DocumentTemplateFields";

// =====================================================================
// Shared document viewer + download helpers.
//
// Used by:
//   - DocumentList (customer + agent portals, every doc surface)
//   - AnalyticsPage drill-down DocList (manager quick-view inside
//     the metric detail modal)
//
// In production the viewer swaps public demo URLs for signed URLs from
// the document service. When a demo document has a real bundled file,
// view and download use that file directly.
// =====================================================================

export const documentFileUrl = resolveDocumentFileUrl;

const COMPLETED_ACORD_DOCUMENT_TYPES = new Set([
  "completed_acord_application",
  "completed_acord_supplemental",
]);

const ACORD_META_FIELDS = new Set([
  "Source ACORD template ID",
  "Source ACORD file",
  "Completed packet type",
  "Completed by",
  "Completed field count",
  "Missing field count",
  "Missing fields",
  "ACORD PDF fill status",
  "Last filled at",
  "Bundled PDF",
  "Source file",
  "File name",
  "Email attachment",
  "Description",
  "Mapped field count",
  "Source ACORD layout fields",
  "AI dossier source count",
  "AI candidate field count",
  "AI fitted PDF field count",
  "AI overflow field count",
  "AI sources used",
  "AI source field counts",
  "Native PDF field count",
  "Native PDF filled field count",
  "Native PDF missing field count",
  "Native PDF artifact",
]);

export type FilledAcroPdfState =
  | { status: "idle" | "loading" | "no_fields" | "no_values" | "error"; url?: undefined; fieldCount?: number }
  | { status: "ready"; url: string; fieldCount: number };

export function downloadDocumentStub(d: Document) {
  const fileUrl = documentFileUrl(d);
  if (fileUrl) {
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = d.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const typeLabel = api.helpers.documentDisplayName({
    type: String(d.type),
    documentName: d.documentName,
  });
  const body = [
    `Quotex Insurance - Document unavailable`,
    ``,
    `File:        ${d.fileName}`,
    `Type:        ${typeLabel}`,
    `Status:      ${d.status}`,
    `Uploaded:    ${d.uploadedAt}`,
    `Tenant:      ${d.tenantId}`,
    `Storage:     ${d.storagePath}`,
    ``,
    `The original document content is not available from the configured storage path.`,
    `Re-upload the file or verify the document storage integration before sending this document.`,
  ].join("\n");
  const blob = new Blob([body], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = d.fileName.replace(/\.[^.]+$/, "") + "-unavailable.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CompletedAcordDocumentPreview({
  document: d,
  fields: providedFields,
  frameClassName,
  showStatus = true,
  viewerUrl = pdfViewerUrl,
  highlightFieldLabels = [],
}: {
  document: Document;
  fields?: TemplateFieldMap;
  frameClassName?: string;
  showStatus?: boolean;
  viewerUrl?: (fileUrl: string) => string;
  highlightFieldLabels?: string[];
}) {
  const fields = providedFields ?? d.templateFields ?? {};
  const fieldsKey = JSON.stringify(fields);
  const [filledAcroPdf, setFilledAcroPdf] = useState<FilledAcroPdfState>({ status: "idle" });

  useEffect(() => {
    if (!COMPLETED_ACORD_DOCUMENT_TYPES.has(String(d.type))) {
      setFilledAcroPdf({ status: "idle" });
      return;
    }
    const source = completedAcordPreviewSource(d, fields);
    if (!source?.fileUrl) {
      setFilledAcroPdf({ status: "idle" });
      return;
    }
    let revokedUrl: string | null = null;
    let cancelled = false;
    setFilledAcroPdf({ status: "loading" });
    fetch(source.fileUrl)
      .then((response) => {
        if (!response.ok) throw new Error("PDF fetch failed");
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        const acroFields = extractAcroFormFields(bytes);
        if (acroFields.length === 0) {
          setFilledAcroPdf({ status: "no_fields" });
          return;
        }
        const fillPlan = buildAcroFormFillPlan(fields, acroFields);
        if (fillPlan.filledFieldCount === 0) {
          setFilledAcroPdf({ status: "no_values", fieldCount: 0 });
          return;
        }
        const filled = fillPdfAcroForm(bytes, fillPlan.values);
        const dataUrl = bytesToPdfDataUrl(filled);
        persistFilledAcroPdfArtifact(d, fields, fillPlan, dataUrl);
        revokedUrl = bytesToPdfBlobUrl(filled);
        setFilledAcroPdf({ status: "ready", url: revokedUrl, fieldCount: fillPlan.filledFieldCount });
      })
      .catch(() => {
        if (!cancelled) setFilledAcroPdf({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [d.id, d.type, fieldsKey]);

  return (
    <FilledAcordDocumentPreview
      document={d}
      fields={fields}
      filledAcroPdf={filledAcroPdf}
      frameClassName={frameClassName}
      showStatus={showStatus}
      viewerUrl={viewerUrl}
      highlightFieldLabels={highlightFieldLabels}
    />
  );
}

export function DocumentViewerModal({
  document: d,
  open,
  onClose,
  onDownload,
  canEditFields = false,
  onChanged,
}: {
  document: Document | null;
  open: boolean;
  onClose: () => void;
  onDownload?: () => void;
  canEditFields?: boolean;
  onChanged?: () => void;
}) {
  const [editingFields, setEditingFields] = useState(false);
  const [fields, setFields] = useState<TemplateFieldMap>({});
  const [filledAcroPdf, setFilledAcroPdf] = useState<FilledAcroPdfState>({ status: "idle" });
  useEffect(() => {
    if (!d) return;
    setEditingFields(false);
    setFields(d.templateFields ?? {});
  }, [d?.id]);

  useEffect(() => {
    if (!open || !d || !COMPLETED_ACORD_DOCUMENT_TYPES.has(String(d.type))) {
      setFilledAcroPdf({ status: "idle" });
      return;
    }
    const source = completedAcordPreviewSource(d, fields);
    if (!source?.fileUrl) {
      setFilledAcroPdf({ status: "idle" });
      return;
    }
    let revokedUrl: string | null = null;
    let cancelled = false;
    setFilledAcroPdf({ status: "loading" });
    fetch(source.fileUrl)
      .then((response) => {
        if (!response.ok) throw new Error("PDF fetch failed");
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        const acroFields = extractAcroFormFields(bytes);
        if (acroFields.length === 0) {
          setFilledAcroPdf({ status: "no_fields" });
          return;
        }
        const fillPlan = buildAcroFormFillPlan(fields, acroFields);
        if (fillPlan.filledFieldCount === 0) {
          setFilledAcroPdf({ status: "no_values", fieldCount: 0 });
          return;
        }
        const filled = fillPdfAcroForm(bytes, fillPlan.values);
        const dataUrl = bytesToPdfDataUrl(filled);
        persistFilledAcroPdfArtifact(d, fields, fillPlan, dataUrl);
        revokedUrl = bytesToPdfBlobUrl(filled);
        setFilledAcroPdf({ status: "ready", url: revokedUrl, fieldCount: fillPlan.filledFieldCount });
      })
      .catch(() => {
        if (!cancelled) setFilledAcroPdf({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [open, d?.id, d?.type, fields]);

  if (!d) return null;
  const isImage = d.fileType?.startsWith("image/");
  const isPdf = d.fileType === "application/pdf" || /\.pdf$/i.test(d.fileName);
  const fileUrl = documentFileUrl(d);
  const isCompletedAcord = COMPLETED_ACORD_DOCUMENT_TYPES.has(String(d.type));
  const handleDownload = onDownload ?? (() => {
    if (filledAcroPdf.status === "ready") {
      const a = document.createElement("a");
      a.href = filledAcroPdf.url;
      a.download = d.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    downloadDocumentStub(d);
  });
  const typeLabel = api.helpers.documentDisplayName({
    type: String(d.type),
    documentName: d.documentName,
  });

  function saveFields() {
    api.documents.update(d!.id, { templateFields: fields });
    setEditingFields(false);
    onChanged?.();
  }

  return (
    <Modal open={open} onClose={onClose} title={d.fileName} size="xl">
      <div className="space-y-4">
        <div className="document-viewer-toolbar flex items-center justify-between gap-3 flex-wrap text-xs text-ink-500">
          <div className="flex items-center gap-2 flex-wrap">
            <span>{typeLabel}</span>
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
        <div className="document-viewer-pane rounded-md bg-ink-100 border border-ink-200 p-4 sm:p-6 max-h-[70vh] overflow-y-auto">
          {isCompletedAcord ? (
            <FilledAcordDocumentPreview document={d} fields={fields} filledAcroPdf={filledAcroPdf} />
          ) : fileUrl && isPdf ? (
            <div className="space-y-4">
              <iframe
                title={d.documentName ?? d.fileName}
                src={fileUrl}
                className="h-[70vh] min-h-[620px] w-full rounded bg-white shadow-luxe"
              />
              <div className="mx-auto max-w-2xl rounded-md border border-ink-100 bg-white p-4">
                <TemplateFieldsPane
                  fields={fields}
                  savedFields={d.templateFields}
                  canEdit={canEditFields}
                  editing={editingFields}
                  onEdit={() => setEditingFields(true)}
                  onCancel={() => {
                    setFields(d.templateFields ?? {});
                    setEditingFields(false);
                  }}
                  onSave={saveFields}
                  onChange={setFields}
                  layout={d.templateFieldLayout}
                />
              </div>
            </div>
          ) : (
            <div className="document-viewer-page mx-auto bg-white shadow-luxe border border-ink-100 max-w-2xl aspect-[8.5/11] p-8 sm:p-12 text-sm leading-relaxed text-ink-800">
            {isImage ? (
              <div className="flex min-h-full flex-col gap-5">
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <FileImage className="h-12 w-12 text-ink-300" />
                  <div>
                    <div className="font-medium text-ink-900">{d.fileName}</div>
                    <p className="text-xs text-ink-500 mt-1 max-w-sm mx-auto">
                      Image preview is rendered inline when file bytes are available through the document service.
                    </p>
                  </div>
                </div>
                <TemplateFieldsPane
                  fields={fields}
                  savedFields={d.templateFields}
                  canEdit={canEditFields}
                  editing={editingFields}
                  onEdit={() => setEditingFields(true)}
                  onCancel={() => {
                    setFields(d.templateFields ?? {});
                    setEditingFields(false);
                  }}
                  onSave={saveFields}
                  onChange={setFields}
                  layout={d.templateFieldLayout}
                />
              </div>
            ) : (
              <>
                <div className="document-viewer-title font-display text-2xl">{d.fileName}</div>
                <div className="text-xs uppercase tracking-wider text-ink-500 mt-1">
                  {typeLabel} — {d.status}
                </div>
                <hr className="my-5 border-ink-100" />
                <dl className="document-viewer-meta grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
                  <dt className="text-ink-500">Uploaded</dt>
                  <dd>{fmt.date(d.uploadedAt)}</dd>
                  <dt className="text-ink-500">Visibility</dt>
                  <dd>{d.visibility.replace(/_/g, " ")}</dd>
                  <dt className="text-ink-500">Storage path</dt>
                  <dd className="font-mono break-all">{d.storagePath}</dd>
                </dl>
                <TemplateFieldsPane
                  fields={fields}
                  savedFields={d.templateFields}
                  canEdit={canEditFields}
                  editing={editingFields}
                  onEdit={() => setEditingFields(true)}
                  onCancel={() => {
                    setFields(d.templateFields ?? {});
                    setEditingFields(false);
                  }}
                  onSave={saveFields}
                  onChange={setFields}
                  layout={d.templateFieldLayout}
                />
                <div className="mt-8 rounded-md border border-dashed border-ink-200 bg-ink-50 p-4 text-xs text-ink-600">
                  This pane embeds the actual PDF or image via a signed viewer URL on the document service. The audit log records every view.
                </div>
              </>
            )}
          </div>
          )}
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

export function FilledAcordDocumentPreview({
  document: d,
  fields,
  filledAcroPdf,
  frameClassName = "h-[70vh] min-h-[620px] w-full rounded bg-white shadow-luxe",
  showStatus = true,
  viewerUrl = pdfViewerUrl,
  highlightFieldLabels = [],
}: {
  document: Document;
  fields: TemplateFieldMap;
  filledAcroPdf: FilledAcroPdfState;
  frameClassName?: string;
  showStatus?: boolean;
  viewerUrl?: (fileUrl: string) => string;
  highlightFieldLabels?: string[];
}) {
  const source = completedAcordPreviewSource(d, fields);
  const missingFields = fields["Missing fields"]?.trim();
  const highlightedLabels = Array.from(new Set(highlightFieldLabels.map((label) => label.trim()).filter(Boolean)));

  return (
    <div className={showStatus ? "space-y-3" : ""}>
      {highlightedLabels.length > 0 && source?.layout.length ? (
        <div className={showStatus ? "space-y-3" : ""}>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Required missing ACORD fields are highlighted below. These are the fields that triggered
            the incomplete-send warning.
          </div>
          <DocumentTemplateFieldOverlay
            layout={source.layout}
            fields={source.overlayFields}
            fileUrl={source.fileUrl}
            sourceFileName={source.sourceFileName}
            title="Required missing ACORD fields"
            highlightLabels={highlightedLabels}
            showOnlyHighlighted
          />
        </div>
      ) : highlightedLabels.length > 0 && source ? (
        <div className={showStatus ? "space-y-3" : ""}>
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            The source PDF does not include detected field positions, so the required fields could not
            be highlighted. The original ACORD PDF is shown below.
          </div>
          <iframe
            title={`Selected ${source.sourceFileName}`}
            src={viewerUrl(source.fileUrl)}
            className={frameClassName}
          />
        </div>
      ) : filledAcroPdf.status === "ready" ? (
        <div className={showStatus ? "space-y-3" : ""}>
          {showStatus && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <span>
                Original editable ACORD PDF filled through {filledAcroPdf.fieldCount} native field
                {filledAcroPdf.fieldCount === 1 ? "" : "s"}.
              </span>
              <Badge tone="success">Native PDF fields</Badge>
            </div>
          )}
          <iframe
            title={`Filled ${d.fileName}`}
            src={viewerUrl(filledAcroPdf.url)}
            className={frameClassName}
          />
        </div>
      ) : filledAcroPdf.status === "loading" && source ? (
        <div className={showStatus ? "space-y-3" : ""}>
          {showStatus && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              Preparing the native filled ACORD PDF. The original remains available while it loads.
            </div>
          )}
          <iframe
            title={`Selected ${source.sourceFileName}`}
            src={viewerUrl(source.fileUrl)}
            className={frameClassName}
          />
        </div>
      ) : source ? (
        <iframe
          title={`Selected ${source.sourceFileName}`}
          src={viewerUrl(source.fileUrl)}
          className={frameClassName}
        />
      ) : (
        <div className={`flex items-center justify-center rounded-md border border-dashed border-ink-200 bg-white p-6 text-center text-sm text-ink-500 ${frameClassName}`}>
          The original ACORD PDF could not be resolved for this completed attachment.
        </div>
      )}
      {showStatus && filledAcroPdf.status === "no_fields" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This source PDF did not expose editable AcroForm fields to the browser. The source PDF is
          shown above until a fillable version is available.
        </div>
      )}
      {showStatus && filledAcroPdf.status === "error" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Quotex could not generate the native filled PDF preview. The source PDF is shown above.
        </div>
      )}
      {showStatus && missingFields && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Remaining blank ACORD fields: {missingFields}
        </div>
      )}
    </div>
  );
}

function completedAcordPreviewSource(d: Document, fields: TemplateFieldMap): {
  fileUrl: string;
  sourceFileName: string;
  layout: DocumentTemplateFieldBox[];
  overlayFields: TemplateFieldMap;
} | null {
  const sourceDocumentId = fields["Source ACORD template ID"];
  const sourceDocument = sourceDocumentId ? api.documents.get(sourceDocumentId) : undefined;
  const fileUrl = (sourceDocument && documentFileUrl(sourceDocument)) || documentFileUrl(d);
  if (!fileUrl) return null;
  const sourceFileName = sourceDocument?.fileName || fields["Source ACORD file"] || d.fileName;
  const detected = detectFillableDocumentFields({
    fileName: sourceFileName,
    fileType: sourceDocument?.fileType || d.fileType || "application/pdf",
    type: String(sourceDocument?.type || d.type),
    documentName: sourceDocument?.documentName || d.documentName,
  });
  const layout =
    d.templateFieldLayout?.length
      ? d.templateFieldLayout
      : sourceDocument?.templateFieldLayout?.length
      ? sourceDocument.templateFieldLayout
      : detected.templateFieldLayout;
  const overlayFields = fillAcordOverlayFields(layout, fields);
  return {
    fileUrl,
    sourceFileName,
    layout,
    overlayFields,
  };
}

function fillAcordOverlayFields(
  layout: DocumentTemplateFieldBox[],
  fields: TemplateFieldMap
): TemplateFieldMap {
  const overlay: TemplateFieldMap = {};
  layout.forEach((box) => {
    const value = valueForAcordBox(box.label, fields);
    if (value) overlay[box.label] = value;
  });
  return overlay;
}

function valueForAcordBox(label: string, fields: TemplateFieldMap): string {
  const direct = firstNonMetaFieldValue(fields, [label]);
  if (direct) return direct;
  const normalizedLabel = normalizeAcordLabel(label);
  const exact = Object.entries(fields).find(
    ([fieldLabel, value]) =>
      !!String(value ?? "").trim() &&
      !ACORD_META_FIELDS.has(fieldLabel) &&
      normalizeAcordLabel(fieldLabel) === normalizedLabel
  );
  if (exact) return exact[1].trim();
  return firstNonMetaFieldValue(fields, aliasesForAcordBox(label));
}

function firstNonMetaFieldValue(fields: TemplateFieldMap, labels: string[]): string {
  for (const label of labels) {
    if (ACORD_META_FIELDS.has(label)) continue;
    const value = fields[label]?.trim();
    if (value) return value;
  }
  return "";
}

function aliasesForAcordBox(label: string): string[] {
  const normalized = normalizeAcordLabel(label);
  if (normalized.includes("fax")) {
    if (normalized.includes("agency") || normalized.includes("producer")) return ["Agency fax", "Producer fax"];
    return ["Applicant fax", "Insured fax", "Contact fax"];
  }
  if (normalized.includes("secondary") || normalized.includes("alternate")) {
    if (normalized.includes("email")) return ["Secondary email", "Alternate email"];
    if (normalized.includes("phone")) return ["Secondary phone", "Alternate phone"];
    return [];
  }
  if ((normalized.includes("agency") || normalized.includes("producer")) && normalized.includes("phone")) {
    return ["Agency phone", "Producer phone"];
  }
  if ((normalized.includes("agency") || normalized.includes("producer")) && normalized.includes("email")) {
    return ["Agency email", "Producer email"];
  }
  if ((normalized.includes("agency") || normalized.includes("producer")) && normalized.includes("address")) {
    return ["Agency address", "Producer address"];
  }
  if ((normalized.includes("agency") || normalized.includes("producer")) && normalized.includes("contact")) {
    return ["Producer contact", "Producer contact name", "Agency contact"];
  }
  if (normalized.includes("client name") || normalized.includes("applicant")) {
    return ["Applicant name", "Named insured", "Insured", "Legal business name", "Primary contact"];
  }
  if (normalized.includes("business legal name")) {
    return ["Legal business name", "Named insured", "Applicant name", "Insured"];
  }
  if (normalized.includes("mailing address")) {
    return ["Mailing address", "Insured mailing address", "Client address"];
  }
  if (normalized.includes("risk property address") || normalized.includes("property address")) {
    return ["Property address", "Location", "Description of premises", "Locations"];
  }
  if (normalized.includes("requested effective date")) {
    return ["Effective date", "Policy term"];
  }
  if (normalized.includes("premium")) {
    return ["Premium", "Estimated exposure value", "Building value", "Values", "Limits"];
  }
  if (normalized.includes("description of operations")) {
    return ["Description of operations", "Business operations", "Products / services", "Operations"];
  }
  if (normalized.includes("loss history")) {
    return ["Loss history", "Claims history", "Prior losses"];
  }
  if (normalized.includes("annual payroll")) {
    return ["Annual payroll", "Payroll"];
  }
  if (normalized.includes("annual revenue")) {
    return ["Annual revenue", "Revenue"];
  }
  if (normalized.includes("primary contact")) {
    return ["Primary contact", "Applicant name"];
  }
  if (normalized.includes("contact email")) {
    return ["Contact email", "Email", "Applicant email", "Insured email"];
  }
  if (normalized.includes("agency")) {
    return ["Agency", "Agency name", "Producer", "Producer name"];
  }
  return [];
}

function normalizeAcordLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function persistFilledAcroPdfArtifact(
  d: Document,
  fields: TemplateFieldMap,
  fillPlan: ReturnType<typeof buildAcroFormFillPlan>,
  dataUrl: string
) {
  if (!COMPLETED_ACORD_DOCUMENT_TYPES.has(String(d.type))) return;
  if (d.downloadUrl === dataUrl) return;
  if (
    d.downloadUrl?.startsWith("data:application/pdf") &&
    d.storagePath?.startsWith("generated://completed-acord") &&
    !fields["Source ACORD template ID"]
  ) {
    return;
  }
  api.documents.update(d.id, {
    downloadUrl: dataUrl,
    storagePath: `generated://completed-acord/${d.id}/${d.fileName}`,
    templateFields: {
      ...fields,
      "Native PDF artifact": "Stored editable ACORD PDF generated from the original fillable form",
      "Native PDF field count": String(fillPlan.totalNativeFields),
      "Native PDF filled field count": String(fillPlan.filledFieldCount),
      "Native PDF missing field count": String(fillPlan.missingFields.length),
    },
  });
}

function pdfViewerUrl(fileUrl: string): string {
  if (fileUrl.includes("#")) return `${fileUrl}&toolbar=0&navpanes=0&scrollbar=0&page=1&view=Fit`;
  return `${fileUrl}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=Fit`;
}

function TemplateFieldsPane({
  fields,
  savedFields,
  canEdit,
  editing,
  onEdit,
  onCancel,
  onSave,
  onChange,
  layout,
}: {
  fields: TemplateFieldMap;
  savedFields?: TemplateFieldMap;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onChange: (fields: TemplateFieldMap) => void;
  layout?: Document["templateFieldLayout"];
}) {
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-500">
          Template fields
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn-outline text-xs" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit fields
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          <DocumentTemplateFieldOverlay
            layout={layout}
            fields={fields}
            editable
            onChange={onChange}
            title="Editable overlay fields"
          />
          <DocumentTemplateFieldsEditor
            fields={fields}
            onChange={onChange}
            title="Editable template fields"
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline text-xs" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="btn-primary text-xs" onClick={onSave}>
              <Save className="h-3.5 w-3.5" /> Save fields
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <DocumentTemplateFieldOverlay
            layout={layout}
            fields={savedFields}
            title="Detected fillable field overlay"
          />
          <DocumentTemplateFieldsPreview fields={savedFields} />
        </div>
      )}
    </div>
  );
}
