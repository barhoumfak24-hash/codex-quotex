import { useEffect, useState } from "react";
import type { Document, TemplateFieldMap } from "@/types";
import { fmt } from "@/lib/format";
import { api } from "@/lib/api";
import { Badge } from "./Badge";
import { DocumentViewerModal, downloadDocumentStub } from "./DocumentViewerModal";
import { Modal } from "./Modal";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileImage,
  FileText,
  Pencil,
  RefreshCw,
  Save,
  Send,
} from "lucide-react";
import { DocumentTemplateFieldsEditor } from "./DocumentTemplateFields";

function DocIcon({ fileType }: { fileType?: string }) {
  if (fileType?.startsWith("image/"))
    return <FileImage className="h-4 w-4 text-ink-500" />;
  return <FileText className="h-4 w-4 text-ink-500" />;
}

export function DocumentList({
  documents,
  uploadedById,
  onChanged,
  onSendToClient,
  selectionMode = false,
  selectedDocumentIds = [],
  onSelectionChange,
  collapsePreviousTerms = false,
  requirementControls = false,
  canEditRequirements = false,
  requirementsLocked = false,
  esignRequirementControls = false,
  canEditEsignRequirements = false,
  esignRequirementsLocked = false,
  onToggleRequired,
  onToggleEsignRequirement,
  perRowRequirementEditing = false,
  showTermGroups = true,
  showLineOfBusinessLabels = false,
}: {
  documents: Document[];
  // When provided + a doc carries needsRenewalUpdate, each flagged row
  // gets an "Update for Renewal" button that drafts a new pending
  // version which the agent previews + publishes inline.
  uploadedById?: string;
  onChanged?: () => void;
  onSendToClient?: (document: Document) => void;
  selectionMode?: boolean;
  selectedDocumentIds?: string[];
  onSelectionChange?: (documentIds: string[]) => void;
  collapsePreviousTerms?: boolean;
  requirementControls?: boolean;
  canEditRequirements?: boolean;
  requirementsLocked?: boolean;
  esignRequirementControls?: boolean;
  canEditEsignRequirements?: boolean;
  esignRequirementsLocked?: boolean;
  onToggleRequired?: (document: Document) => void;
  onToggleEsignRequirement?: (document: Document, side: "customer" | "agent") => void;
  perRowRequirementEditing?: boolean;
  showTermGroups?: boolean;
  showLineOfBusinessLabels?: boolean;
}) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [renewalDraftId, setRenewalDraftId] = useState<string | null>(null);
  const [previousOpen, setPreviousOpen] = useState(false);
  const [editingRequirementId, setEditingRequirementId] = useState<string | null>(null);
  const [requirementDraft, setRequirementDraft] = useState<{
    required: boolean;
    customerEsignRequired: boolean;
    agentEsignRequired: boolean;
  } | null>(null);
  const viewing = viewingId ? documents.find((d) => d.id === viewingId) ?? null : null;
  const selectedSet = new Set(selectedDocumentIds);
  if (documents.length === 0) {
    return <div className="text-sm text-ink-400">No documents uploaded.</div>;
  }
  const visibleDocuments = documents.filter(
    (d) => !(d.supersedesId && d.renewalId && !d.publishedAt)
  );
  // Sort: newest term year first, then newest upload first within a term.
  const sorted = [...visibleDocuments].sort((a, b) => {
    const ay = a.policyTermYear ?? 0;
    const by = b.policyTermYear ?? 0;
    if (ay !== by) return by - ay;
    return a.uploadedAt < b.uploadedAt ? 1 : -1;
  });
  function sourceTermYearFor(d: Document): number | undefined {
    return d.policyTermYear ?? policyCurrentTermYearFor(d);
  }

  function latestTermYearFor(d: Document): number | null {
    if (!d.policyId) return null;
    return sorted.reduce<number | null>((latest, candidate) => {
      if (candidate.policyId !== d.policyId) return latest;
      const candidateYear = sourceTermYearFor(candidate);
      if (!candidateYear) return latest;
      return latest == null
        ? candidateYear
        : Math.max(latest, candidateYear);
    }, null);
  }

  function latestTermYearForDocumentType(d: Document): number | null {
    if (!d.policyId) return null;
    return sorted.reduce<number | null>((latest, candidate) => {
      if (candidate.policyId !== d.policyId || candidate.type !== d.type) return latest;
      const candidateYear = sourceTermYearFor(candidate);
      if (!candidateYear) return latest;
      return latest == null ? candidateYear : Math.max(latest, candidateYear);
    }, null);
  }

  function policyCurrentTermYearFor(d: Document): number | undefined {
    if (!d.policyId) return undefined;
    const policy = api.policies.get(d.policyId);
    const sourceDate = policy?.effectiveDate ?? policy?.renewalDate;
    if (!sourceDate) return undefined;
    const year = new Date(sourceDate).getUTCFullYear();
    if (!Number.isFinite(year)) return undefined;
    return policy?.effectiveDate ? year : year - 1;
  }

  function termYearFor(d: Document): number | undefined {
    if (d.policyTermYear) return d.policyTermYear;
    const currentYear = policyCurrentTermYearFor(d);
    if (publishedSuccessorFor(d)) return currentYear ?? undefined;
    const latestPolicyTermYear = latestTermYearFor(d);
    if (
      collapsePreviousTerms &&
      currentYear &&
      latestPolicyTermYear &&
      currentYear < latestPolicyTermYear &&
      !isRenewalWorkSource(d)
    ) {
      return currentYear;
    }
    return latestTermYearFor(d) ?? policyCurrentTermYearFor(d) ?? undefined;
  }

  function toggleRequired(d: Document) {
    if (perRowRequirementEditing && editingRequirementId === d.id && requirementDraft) {
      setRequirementDraft({ ...requirementDraft, required: !d.required });
      return;
    }
    if (requirementsLocked) return;
    if (onToggleRequired) {
      onToggleRequired(d);
      return;
    }
    api.documents.update(d.id, {
      required: !d.required,
    });
    onChanged?.();
  }

  function toggleEsignRequirement(d: Document, side: "customer" | "agent") {
    if (perRowRequirementEditing && editingRequirementId === d.id && requirementDraft) {
      setRequirementDraft({
        ...requirementDraft,
        ...(side === "customer"
          ? { customerEsignRequired: !d.customerEsignRequired }
          : { agentEsignRequired: !d.agentEsignRequired }),
      });
      return;
    }
    if (esignRequirementsLocked) return;
    if (onToggleEsignRequirement) {
      onToggleEsignRequirement(d, side);
      return;
    }
    api.esign.setRequirements(d.id, {
      ...(side === "customer"
        ? { customerEsignRequired: !d.customerEsignRequired }
        : { agentEsignRequired: !d.agentEsignRequired }),
    });
    onChanged?.();
  }

  function ruleButtonClass(active: boolean, width = "min-w-[6.25rem]", locked = false) {
    const tone = active
      ? "border-gold-500 bg-gold-50 text-gold-900 shadow-sm"
      : "border-ink-200 bg-white text-ink-600";
    const interaction = locked
      ? "cursor-default opacity-80"
      : active
      ? "hover:border-gold-500"
      : "hover:border-gold-300 hover:text-gold-800";
    return `h-8 ${width} rounded-md border px-3 text-[11px] font-semibold transition ${tone} ${interaction}`;
  }

  function startRequirementEdit(d: Document) {
    setEditingRequirementId(d.id);
    setRequirementDraft({
      required: !!d.required,
      customerEsignRequired: !!d.customerEsignRequired,
      agentEsignRequired: !!d.agentEsignRequired,
    });
  }

  function cancelRequirementEdit() {
    setEditingRequirementId(null);
    setRequirementDraft(null);
  }

  function saveRequirementEdit(d: Document) {
    if (!requirementDraft) return;
    if (requirementControls && canEditRequirements && requirementDraft.required !== !!d.required) {
      api.documents.update(d.id, { required: requirementDraft.required });
    }
    if (
      esignRequirementControls &&
      canEditEsignRequirements &&
      (requirementDraft.customerEsignRequired !== !!d.customerEsignRequired ||
        requirementDraft.agentEsignRequired !== !!d.agentEsignRequired)
    ) {
      api.esign.setRequirements(d.id, {
        customerEsignRequired: requirementDraft.customerEsignRequired,
        agentEsignRequired: requirementDraft.agentEsignRequired,
      });
    }
    setEditingRequirementId(null);
    setRequirementDraft(null);
    onChanged?.();
  }

  function lineOfBusinessLabel(d: Document): string {
    if (d.lineOfBusiness === "personal") return "For: Personal lines";
    if (d.lineOfBusiness === "commercial") return "For: Commercial lines";
    return "For: All lines";
  }

  function lineOfBusinessTone(d: Document): "neutral" | "info" | "gold" {
    if (d.lineOfBusiness === "personal") return "info";
    if (d.lineOfBusiness === "commercial") return "gold";
    return "neutral";
  }

  function publishedSuccessorFor(d: Document): Document | undefined {
    const directSuccessor = documents
      .filter(
        (candidate) =>
          candidate.supersedesId === d.id &&
          !!candidate.publishedAt &&
          candidate.status !== "rejected"
      )
      .sort((a, b) => ((a.publishedAt ?? "") < (b.publishedAt ?? "") ? 1 : -1))[0];
    if (directSuccessor) return directSuccessor;

    return documents
      .filter(
        (candidate) =>
          !!d.policyId &&
          candidate.id !== d.id &&
          candidate.policyId === d.policyId &&
          candidate.type === d.type &&
          !!candidate.publishedAt &&
          !!candidate.policyTermYear &&
          candidate.status !== "rejected" &&
          (!d.policyTermYear || candidate.policyTermYear > d.policyTermYear)
      )
      .sort((a, b) => {
        const ay = a.policyTermYear ?? 0;
        const by = b.policyTermYear ?? 0;
        if (ay !== by) return by - ay;
        return (a.publishedAt ?? "") < (b.publishedAt ?? "") ? 1 : -1;
      })[0];
  }

  function pendingRenewalDraftFor(d: Document): Document | undefined {
    return documents.find(
      (candidate) =>
        candidate.supersedesId === d.id &&
        candidate.renewalId === d.renewalForRenewalId &&
        !candidate.publishedAt &&
        candidate.status !== "rejected"
    );
  }

  function isRenewalWorkSource(d: Document): boolean {
    if (!d.needsRenewalUpdate || !d.renewalForRenewalId) return false;
    if (publishedSuccessorFor(d)) return false;
    const sourceYear = sourceTermYearFor(d);
    const latestSameTypeYear = latestTermYearForDocumentType(d);
    return !sourceYear || !latestSameTypeYear || sourceYear >= latestSameTypeYear;
  }

  function isPreviousDocument(d: Document): boolean {
    if (!collapsePreviousTerms) return false;
    const hasPublishedSuccessor = !!publishedSuccessorFor(d);
    const latestPolicyTermYear = latestTermYearFor(d);
    const stillNeedsRenewalWork = isRenewalWorkSource(d);
    if (stillNeedsRenewalWork) return false;
    const currentYear = policyCurrentTermYearFor(d);
    const documentTermYear = d.policyTermYear ?? currentYear;
    if (!documentTermYear) return hasPublishedSuccessor;
    return (
      hasPublishedSuccessor ||
      (latestPolicyTermYear != null && documentTermYear < latestPolicyTermYear)
    );
  }

  function isRenewedDocument(d: Document): boolean {
    if (d.lastChangeAction === "renewed") return true;
    if (d.supersedesId || d.renewalId) return true;
    const currentYear = policyCurrentTermYearFor(d);
    return !!d.publishedAt && !!d.policyTermYear && !!currentYear && d.policyTermYear > currentYear;
  }

  function documentChangeLabelFor(d: Document): string | undefined {
    const date = d.lastChangeAt ?? (isRenewedDocument(d) ? d.publishedAt : undefined) ?? d.uploadedAt;
    if (!date) return undefined;
    const action = d.lastChangeAction ?? (isRenewedDocument(d) ? "renewed" : "uploaded");
    const label =
      action === "renewed"
        ? "Renewed"
        : action === "edited"
        ? "Edited"
        : action === "updated"
        ? "Updated"
        : "Uploaded";
    return `${label} ${fmt.date(date)}`;
  }

  function groupDocuments(rows: Document[]) {
    const grouped = new Map<string, Document[]>();
    for (const d of rows) {
      const key = termYearFor(d) ? String(termYearFor(d)) : "current";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(d);
    }
    return grouped;
  }

  // Group by term year so historical terms are obviously preserved.
  const activeDocuments = sorted.filter((d) => !isPreviousDocument(d));
  const previousDocuments = sorted.filter(isPreviousDocument);
  const groups = showTermGroups
    ? groupDocuments(activeDocuments)
    : new Map([["", activeDocuments]]);
  const previousGroups = showTermGroups ? groupDocuments(previousDocuments) : new Map();
  const hasVersionActionColumn = visibleDocuments.some(
    (d) =>
      !!documentChangeLabelFor(d) ||
      (isRenewalWorkSource(d) && !!uploadedById)
  );
  const actionGridClass = hasVersionActionColumn
    ? onSendToClient
      ? "grid-cols-[8.5rem_3.75rem_7.5rem_6.25rem]"
      : "grid-cols-[8.5rem_3.75rem_6.25rem]"
    : onSendToClient
    ? "grid-cols-[3.75rem_7.5rem_6.25rem]"
    : "grid-cols-[3.75rem_6.25rem]";
  const groupEntries = Array.from(groups.entries());
  const previousGroupEntries = collapsePreviousTerms ? Array.from(previousGroups.entries()) : [];
  const previousDocumentCount = previousGroupEntries.reduce(
    (total, [, docs]) => total + docs.length,
    0
  );

  function termLabel(term: string) {
    return term === "current" ? "Current term" : `Policy term ${term}`;
  }

  function isLatestRenewedVersion(d: Document): boolean {
    if (!d.supersedesId || !d.policyTermYear) return false;
    const renewalTerms = sorted
      .filter(
        (candidate) =>
          !!candidate.supersedesId &&
          candidate.policyId === d.policyId &&
          candidate.type === d.type &&
          !!candidate.policyTermYear &&
          candidate.status !== "rejected"
      )
      .map((candidate) => candidate.policyTermYear ?? 0);
    return renewalTerms.length > 0 && d.policyTermYear === Math.max(...renewalTerms);
  }

  function renderRow(d: Document) {
    const editingRequirement = perRowRequirementEditing && editingRequirementId === d.id;
    const displayDocument =
      editingRequirement && requirementDraft
        ? {
            ...d,
            required: requirementDraft.required,
            customerEsignRequired: requirementDraft.customerEsignRequired,
            agentEsignRequired: requirementDraft.agentEsignRequired,
          }
        : d;
    const rowRequirementsLocked = perRowRequirementEditing
      ? !editingRequirement
      : requirementsLocked;
    const rowEsignRequirementsLocked = perRowRequirementEditing
      ? !editingRequirement
      : esignRequirementsLocked;
    const showRowSettingsAction =
      perRowRequirementEditing &&
      ((requirementControls && canEditRequirements) ||
        (esignRequirementControls && canEditEsignRequirements));
    const flagged = isRenewalWorkSource(d) && !!uploadedById;
    const draftForOriginal = flagged
      ? documents.find(
          (candidate) =>
            candidate.supersedesId === d.id &&
            candidate.renewalId === d.renewalForRenewalId &&
            !candidate.publishedAt &&
            candidate.status !== "rejected"
        )
      : undefined;
    const typeLabel = api.helpers.documentDisplayName({
      type: String(d.type),
      documentName: d.documentName,
    });
    const latestRenewedVersion = isLatestRenewedVersion(d);
    const displayTermYear = termYearFor(d);
    const changeLabel = documentChangeLabelFor(d);
    const selected = selectedSet.has(d.id);
    function toggleSelection() {
      if (!onSelectionChange) return;
      const next = selected
        ? selectedDocumentIds.filter((id) => id !== d.id)
        : [...selectedDocumentIds, d.id];
      onSelectionChange(next);
    }
    return (
      <li
        key={d.id}
        className={`document-list-row grid min-h-[5.75rem] grid-cols-[minmax(0,1fr)_6.75rem_auto] items-center gap-3 py-3 ${
          flagged ? "rounded-md bg-amber-50/40" : ""
        }`}
      >
        <div className="document-list-main flex items-center gap-3 min-w-0">
          {selectionMode && (
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded border-ink-300 text-gold-700 focus:ring-gold-300"
              checked={selected}
              onChange={toggleSelection}
              aria-label={`Select ${d.fileName}`}
            />
          )}
          <div className="h-9 w-9 shrink-0 rounded-md bg-ink-50 border border-ink-100 flex items-center justify-center text-ink-500">
            <DocIcon fileType={d.fileType} />
          </div>
          <div className="min-w-0">
            <div className="document-list-title text-sm font-semibold leading-snug text-ink-900 whitespace-nowrap">
              {d.fileName}
            </div>
            <div className="document-list-meta mt-0.5 flex min-h-6 min-w-0 items-center gap-2 text-xs text-ink-500">
              <span className="min-w-0 truncate whitespace-nowrap">{typeLabel}</span>
              <span className="hidden">
                {displayTermYear ? `· Term ${displayTermYear}` : ""}
              </span>
              {displayTermYear && (
                <span className="shrink-0 whitespace-nowrap text-ink-700">
                  Term {displayTermYear}
                </span>
              )}
            </div>
            <div className="mt-1 flex min-h-5 items-center gap-2">
              {(showLineOfBusinessLabels || d.lineOfBusiness) && (
                <Badge tone={lineOfBusinessTone(d)}>
                  {showLineOfBusinessLabels
                    ? lineOfBusinessLabel(d)
                    : d.lineOfBusiness === "personal"
                    ? "Personal lines"
                    : "Commercial lines"}
                </Badge>
              )}
              {latestRenewedVersion && <Badge tone="info">Renewed version</Badge>}
              {flagged && !draftForOriginal && (
                <Badge tone="warn">Needs update for renewal</Badge>
              )}
              {draftForOriginal && <Badge tone="info">Ready for review</Badge>}
            </div>
            {(requirementControls || esignRequirementControls) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-ink-50/60 px-2.5 py-2">
                {requirementControls && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-16 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      Required
                    </span>
                    {canEditRequirements ? (
                      <button
                        type="button"
                        className={ruleButtonClass(!!displayDocument.required, "min-w-[6.75rem]", rowRequirementsLocked)}
                        onClick={() => toggleRequired(displayDocument)}
                        aria-pressed={!!displayDocument.required}
                        disabled={rowRequirementsLocked}
                        title={
                          rowRequirementsLocked
                            ? "Unlock document settings to change this requirement"
                            : displayDocument.required
                            ? "Mark this document not required"
                            : "Mark this document required"
                        }
                      >
                        {displayDocument.required ? "Required" : "Not required"}
                      </button>
                    ) : d.required ? (
                      <Badge tone="warn">Required</Badge>
                    ) : (
                      <Badge tone="neutral">Not required</Badge>
                    )}
                  </div>
                )}
                {esignRequirementControls && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-12 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                      E-sign
                    </span>
                    {canEditEsignRequirements ? (
                      <>
                        <button
                          type="button"
                          className={ruleButtonClass(!!displayDocument.customerEsignRequired, "min-w-[6.25rem]", rowEsignRequirementsLocked)}
                          onClick={() => toggleEsignRequirement(displayDocument, "customer")}
                          aria-pressed={!!displayDocument.customerEsignRequired}
                          disabled={rowEsignRequirementsLocked}
                          title={
                            rowEsignRequirementsLocked
                              ? "Unlock document settings to change e-sign requirements"
                              : displayDocument.customerEsignRequired
                              ? "Remove customer e-sign requirement"
                              : "Require customer e-signature"
                          }
                        >
                          Customer
                        </button>
                        <button
                          type="button"
                          className={ruleButtonClass(!!displayDocument.agentEsignRequired, "min-w-[6.25rem]", rowEsignRequirementsLocked)}
                          onClick={() => toggleEsignRequirement(displayDocument, "agent")}
                          aria-pressed={!!displayDocument.agentEsignRequired}
                          disabled={rowEsignRequirementsLocked}
                          title={
                            rowEsignRequirementsLocked
                              ? "Unlock document settings to change e-sign requirements"
                              : displayDocument.agentEsignRequired
                              ? "Remove agent e-sign requirement"
                              : "Require agent e-signature"
                          }
                        >
                          Agent
                        </button>
                      </>
                    ) : (
                      <>
                        {d.customerEsignRequired && <Badge tone="warn">Customer e-sign</Badge>}
                        {d.agentEsignRequired && <Badge tone="warn">Agent e-sign</Badge>}
                        {!d.customerEsignRequired && !d.agentEsignRequired && (
                          <Badge tone="neutral">No e-sign</Badge>
                        )}
                      </>
                    )}
                  </div>
                )}
                {showRowSettingsAction && (
                  <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
                    {editingRequirement ? (
                      <>
                        <button
                          type="button"
                          className="btn-outline h-8 px-3 text-[11px]"
                          onClick={cancelRequirementEdit}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-gold h-8 px-3 text-[11px]"
                          onClick={() => saveRequirementEdit(d)}
                        >
                          <Save className="h-3.5 w-3.5" />
                          Save
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-outline h-8 px-3 text-[11px]"
                        onClick={() => startRequirementEdit(d)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit settings
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="document-list-status flex justify-start">
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
        </div>
        <div className={`document-list-actions grid shrink-0 items-center gap-1.5 ${actionGridClass}`}>
          {hasVersionActionColumn && (
            flagged && d.renewalForRenewalId ? (
              draftForOriginal ? (
                <button
                  type="button"
                  className="document-list-version-action btn-gold w-full px-2 text-[11px] whitespace-nowrap"
                  title="Review the updated renewal draft. Fields remain editable until you publish."
                  onClick={() => setRenewalDraftId(draftForOriginal.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Ready for review
                </button>
              ) : (
                <button
                  type="button"
                  className="document-list-version-action btn w-full bg-amber-600 px-2 text-[11px] text-white hover:bg-amber-700"
                  title="Create a pending renewal draft. Nothing publishes until you review and approve it."
                  onClick={() => {
                    api.documents.draftRenewalUpdate(
                      d.id,
                      d.renewalForRenewalId!,
                      uploadedById!
                    );
                    onChanged?.();
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Update for Renewal
                </button>
              )
            ) : changeLabel ? (
              <span className="document-list-version-action inline-flex h-8 w-full items-center justify-center rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 whitespace-nowrap">
                {changeLabel}
              </span>
            ) : (
              <span aria-hidden="true" className="document-list-version-action block h-8" />
            )
          )}
          <button
            type="button"
            className="btn-outline w-full px-2 text-[11px] whitespace-nowrap"
            title="View inline — opens a viewer inside the app without downloading"
            onClick={() => setViewingId(d.id)}
          >
            View
          </button>
          {onSendToClient && (
            <button
              type="button"
              className="btn-outline w-full px-2 text-[11px] whitespace-nowrap"
              title="Email this document to the client"
              onClick={() => onSendToClient(d)}
            >
              <Send className="h-3.5 w-3.5" /> Send to client
            </button>
          )}
          <button
            type="button"
            className="btn-outline w-full px-2 text-[11px] whitespace-nowrap"
            title="Download document"
            onClick={() => downloadDocumentStub(d)}
          >
            <Download className="h-3.5 w-3.5" /> Download
          </button>
        </div>
      </li>
    );
  }

  function renderGroup(term: string, docs: Document[]) {
    return (
      <div key={term} className="mb-3 last:mb-0">
        {term && (
          <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-1">
            {termLabel(term)}
          </div>
        )}
        <ul className="divide-y divide-ink-100">{docs.map(renderRow)}</ul>
      </div>
    );
  }

  return (
    <>
      {groupEntries.map(([term, docs]) => renderGroup(term, docs))}
      {previousGroupEntries.length > 0 && (
        <div className="mt-3 border-t border-ink-100 pt-3">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2 text-left text-xs font-semibold text-ink-700 transition hover:border-gold-200 hover:bg-gold-50"
            onClick={() => setPreviousOpen((open) => !open)}
          >
            <span>
              {previousOpen ? "Hide" : "Show"} previous term documents ({previousDocumentCount})
            </span>
            {previousOpen ? (
              <ChevronUp className="h-3.5 w-3.5 text-ink-500" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-ink-500" />
            )}
          </button>
          {previousOpen && (
            <div className="mt-3">
              {previousGroupEntries.map(([term, docs]) => renderGroup(term, docs))}
            </div>
          )}
        </div>
      )}
      <DocumentViewerModal
        document={viewing}
        open={viewing != null}
        onClose={() => setViewingId(null)}
        canEditFields={!!uploadedById}
        onChanged={onChanged}
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
  const [templateFields, setTemplateFields] = useState<TemplateFieldMap>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const draft = draftId ? api.documents.get(draftId) : undefined;
  const original = draft?.supersedesId
    ? api.documents.get(draft.supersedesId)
    : undefined;
  useEffect(() => {
    if (draft) {
      setFileName(draft.fileName);
      setTemplateFields(draft.templateFields ?? {});
      setSaved(false);
    }
  }, [draft?.id]);

  if (!draftId || !draft) return null;
  const docTypeLabel = api.helpers.documentTypeLabel(String(draft.type));

  function publish() {
    if (!draft || !uploadedById) return;
    setBusy(true);
    try {
      api.documents.publishRenewalUpdate(draft.id, uploadedById, { fileName, templateFields });
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!draft) return;
    setBusy(true);
    try {
      api.documents.update(draft.id, {
        fileName: fileName.trim() || draft.fileName,
        templateFields,
      });
      setSaved(true);
      onChanged?.();
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
    <Modal open onClose={onClose} title="Review renewal draft" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-ink-600">
          This refreshed {docTypeLabel.toLowerCase()} is ready for review for the {draft.policyTermYear ?? "new"} renewal term.
          Every field below is manually editable. Nothing is published to the client record until you click Publish.
        </p>
        <p className="hidden">
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
            The original document stays on file as the prior term record until this draft is published.
          </p>
          <p className="hidden">
            Demo — in production the AI also rewrites declared values (premium, dates,
            insureds) and a viewer renders the merged document. Here, fileName covers the
            edit surface.
          </p>
        </div>

        <DocumentTemplateFieldsEditor
          fields={templateFields}
          onChange={setTemplateFields}
          title="Editable renewal template fields"
        />

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ink-100">
          {saved && <span className="mr-auto text-xs font-medium text-emerald-700">Draft saved.</span>}
          <button type="button" className="btn-ghost text-sm" onClick={discard} disabled={busy}>
            Discard draft
          </button>
          <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="button" className="btn-outline text-sm" onClick={saveDraft} disabled={busy}>
            {busy ? "Saving..." : "Save draft"}
          </button>
          <button type="button" className="btn-gold text-sm text-[0]" onClick={publish} disabled={busy}>
            <span className="text-sm">{busy ? "Publishing..." : "Publish"}</span>
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
