import { useEffect, useState } from "react";
import type { Document } from "@/types";
import { fmt } from "@/lib/format";
import { api } from "@/lib/api";
import { Badge } from "./Badge";
import { DocumentViewerModal, downloadDocumentStub } from "./DocumentViewerModal";
import { Modal } from "./Modal";
import { Download, FileImage, FileText, RefreshCw } from "lucide-react";

function DocIcon({ fileType }: { fileType?: string }) {
  if (fileType?.startsWith("image/"))
    return <FileImage className="h-4 w-4 text-ink-500" />;
  return <FileText className="h-4 w-4 text-ink-500" />;
}

export function DocumentList({
  documents,
  uploadedById,
  onChanged,
}: {
  documents: Document[];
  // When provided + a doc carries needsRenewalUpdate, each flagged row
  // gets an "Update for Renewal" button that drafts a new pending
  // version which the agent previews + publishes inline.
  uploadedById?: string;
  onChanged?: () => void;
}) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [renewalDraftId, setRenewalDraftId] = useState<string | null>(null);
  const viewing = viewingId ? documents.find((d) => d.id === viewingId) ?? null : null;
  if (documents.length === 0) {
    return <div className="text-sm text-ink-400">No documents uploaded.</div>;
  }
  // Sort: newest term year first, then newest upload first within a term.
  const sorted = [...documents].sort((a, b) => {
    const ay = a.policyTermYear ?? 0;
    const by = b.policyTermYear ?? 0;
    if (ay !== by) return by - ay;
    return a.uploadedAt < b.uploadedAt ? 1 : -1;
  });
  // Group by term year so historical terms are obviously preserved.
  const groups = new Map<string, Document[]>();
  for (const d of sorted) {
    const key = d.policyTermYear ? String(d.policyTermYear) : "current";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  function renderRow(d: Document) {
    const flagged = !!d.needsRenewalUpdate && !!uploadedById;
    return (
      <li
        key={d.id}
        className={`flex items-center justify-between py-3 gap-3 flex-wrap ${
          flagged ? "bg-amber-50/40 -mx-2 px-2 rounded-md" : ""
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-md bg-ink-50 border border-ink-100 flex items-center justify-center text-ink-500">
            <DocIcon fileType={d.fileType} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink-900 truncate">{d.fileName}</div>
            <div className="text-xs text-ink-500 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>{fmt.titleCase(d.type)}</span>
              <span>·</span>
              <span>{fmt.date(d.uploadedAt)}</span>
              {d.policyTermYear && (
                <>
                  <span>·</span>
                  <span className="text-ink-700">Term {d.policyTermYear}</span>
                </>
              )}
              {d.publishedAt && (
                <Badge tone="success">Published {fmt.date(d.publishedAt)}</Badge>
              )}
              {d.supersedesId && (
                <Badge tone="info">Renewed version</Badge>
              )}
              {flagged && (
                <Badge tone="warn">Needs update for renewal</Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            tone={
              d.status === "approved"
                ? "success"
                : d.status === "rejected"
                ? "error"
                : "warn"
            }
          >
            {fmt.titleCase(d.status)}
          </Badge>
          {flagged && d.renewalForRenewalId && (
            <button
              type="button"
              className="btn bg-amber-600 text-white hover:bg-amber-700 text-xs"
              title="AI drafts an updated version of this document for the new renewal term. You preview + edit, then publish."
              onClick={() => {
                const draft = api.documents.draftRenewalUpdate(
                  d.id,
                  d.renewalForRenewalId!,
                  uploadedById!
                );
                if (draft) setRenewalDraftId(draft.id);
                onChanged?.();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Update for Renewal
            </button>
          )}
          <button
            type="button"
            className="btn-ghost text-xs whitespace-nowrap"
            title="View inline — opens a viewer inside the app without downloading"
            onClick={() => setViewingId(d.id)}
          >
            View
          </button>
          <button
            type="button"
            className="btn-outline text-xs whitespace-nowrap"
            title="Download (demo placeholder)"
            onClick={() => downloadDocumentStub(d)}
          >
            <Download className="h-3.5 w-3.5" /> Download
          </button>
        </div>
      </li>
    );
  }

  return (
    <>
      {Array.from(groups.entries()).map(([term, docs]) => (
        <div key={term} className="mb-3 last:mb-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
            {term === "current" ? "Current term" : `Policy term ${term}`}
          </div>
          <ul className="divide-y divide-ink-100">{docs.map(renderRow)}</ul>
        </div>
      ))}
      <DocumentViewerModal
        document={viewing}
        open={viewing != null}
        onClose={() => setViewingId(null)}
      />
      <RenewalDraftPublishModal
        draftId={renewalDraftId}
        uploadedById={uploadedById}
        onClose={() => setRenewalDraftId(null)}
        onChanged={onChanged}
      />
    </>
  );
}

// Preview + edit + publish a draft created by api.documents.draftRenewalUpdate.
function RenewalDraftPublishModal({
  draftId,
  uploadedById,
  onClose,
  onChanged,
}: {
  draftId: string | null;
  uploadedById?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = draftId ? api.documents.get(draftId) : undefined;
  const original = draft?.supersedesId
    ? api.documents.get(draft.supersedesId)
    : undefined;
  useEffect(() => {
    if (draft) setFileName(draft.fileName);
  }, [draft?.id]);

  if (!draftId || !draft) return null;
  const docTypeLabel = api.helpers.documentTypeLabel(String(draft.type));

  function publish() {
    if (!draft || !uploadedById) return;
    setBusy(true);
    try {
      api.documents.publishRenewalUpdate(draft.id, uploadedById, { fileName });
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (!draft) return;
    if (!confirm("Discard this draft? The original document stays flagged for renewal.")) return;
    api.documents.update(draft.id, { status: "rejected" });
    onChanged?.();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Update document for renewal" size="md">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          AI drafted a refreshed {docTypeLabel.toLowerCase()} for the {draft.policyTermYear ?? "new"} renewal term. Double-check the
          details and publish — the original stays on file as the prior term's record.
        </p>

        <div className="rounded-md border border-ink-200 bg-white p-4 space-y-3">
          <div>
            <label className="label">File name</label>
            <input
              className="input text-sm font-mono"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Document type" value={docTypeLabel} />
            <Field
              label="Term year"
              value={draft.policyTermYear ? String(draft.policyTermYear) : "—"}
            />
            <Field label="Visibility" value={draft.visibility.replace(/_/g, " ")} />
            <Field label="Status (draft)" value={fmt.titleCase(draft.status)} />
            {original && (
              <>
                <Field label="Supersedes" value={original.fileName} />
                <Field label="Prior term" value={original.policyTermYear ? String(original.policyTermYear) : "—"} />
              </>
            )}
          </dl>
          <p className="text-[11px] text-ink-400">
            Demo — in production the AI also rewrites declared values (premium, dates,
            insureds) and a viewer renders the merged document. Here, fileName covers the
            edit surface.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          <button type="button" className="btn-ghost text-sm" onClick={discard} disabled={busy}>
            Discard draft
          </button>
          <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" className="btn-gold text-sm" onClick={publish} disabled={busy}>
            {busy ? "Publishing…" : "Publish for renewal term"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider">{label}</dt>
      <dd className="text-ink-900 mt-0.5">{value}</dd>
    </div>
  );
}