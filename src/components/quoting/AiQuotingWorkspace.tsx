import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileCheck2,
  FileQuestion,
  FileText,
  GripVertical,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trophy,
  User,
  WandSparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  CompletedAcordDocumentPreview,
  DocumentViewerModal,
} from "@/components/ui/DocumentViewerModal";
import { DocumentTemplateFieldOverlay } from "@/components/ui/DocumentTemplateFields";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { subscribeToDbChanges } from "@/lib/db";
import { documentFileUrl } from "@/lib/documentUrls";
import { electronicSignaturePreviewStyle } from "@/lib/electronicSignature";
import {
  emailSignatureBlockForUser,
  type EmailSignatureBlock,
} from "@/lib/emailSignature";
import { fmt } from "@/lib/format";
import { fileToCommunicationAttachment, formatAttachmentSize } from "@/lib/messageAttachments";
import {
  getLiveMailboxCapability,
  sendCommunicationThroughLiveMailbox,
  syncCommunicationsFromLiveMailbox,
} from "@/lib/liveMailbox";
import { categoryQuotingQuestions } from "@/lib/categoryQuestionnaires";
import { type AiGatewayFailureDetail } from "@/lib/aiGateway";
import { carrierPortalRunnerStatus } from "@/lib/carrierPortalPlaybooks";
import {
  quoteMatchBadgeClass,
  quoteMatchCriteriaTitle,
  quoteMatchPercent,
} from "@/lib/quoteMatch";
import { isVinInputField, normalizeVinFieldValue } from "@/lib/vinInput";
import type {
  AssetType,
  CarrierQuote,
  CommunicationAttachment,
  CommercialCarrierRecommendation,
  Document,
  InsuranceCategory,
  QuestionnaireResponseMeta,
  QuotingLineOfBusiness,
  QuotingQuestion,
  QuotingSession,
} from "@/types";

function scrollParentFor(element: HTMLElement | null): HTMLElement | null {
  let parent = element?.parentElement ?? null;
  while (parent) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function preserveWindowScroll<T>(action: () => T): T {
  const anchor =
    document.getElementById("ai-quoting-workspace") ??
    document.getElementById("commercial-acord-workspace");
  const anchorTop = anchor?.getBoundingClientRect().top;
  const scrollParent = scrollParentFor(anchor);
  const parentTop = scrollParent?.scrollTop;
  const parentLeft = scrollParent?.scrollLeft;
  const left = window.scrollX;
  const top = window.scrollY;
  let restoreAttempts = 0;
  const restore = () => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (document.querySelector('[role="dialog"]')) {
      if (restoreAttempts < 4) {
        restoreAttempts += 1;
        window.setTimeout(restore, 60);
      }
      return;
    }
    if (
      scrollParent &&
      typeof parentTop === "number" &&
      (Math.abs(scrollParent.scrollTop - parentTop) > 1 ||
        Math.abs(scrollParent.scrollLeft - (parentLeft ?? 0)) > 1)
    ) {
      scrollParent.scrollTo({ left: parentLeft ?? 0, top: parentTop, behavior: "auto" });
    }
    if (anchor && typeof anchorTop === "number") {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 1) {
        if (scrollParent) {
          scrollParent.scrollBy({ top: delta, left: 0, behavior: "auto" });
        } else {
          window.scrollBy({ top: delta, left: 0, behavior: "auto" });
        }
      }
      if (Math.abs(window.scrollX - left) > 1) {
        window.scrollTo({ left, top: window.scrollY, behavior: "auto" });
      }
      return;
    }
    if (Math.abs(window.scrollY - top) > 1 || Math.abs(window.scrollX - left) > 1) {
      window.scrollTo({ left, top, behavior: "auto" });
    }
  };
  const scheduleRestore = () => {
    window.requestAnimationFrame(restore);
  };

  try {
    const result = action();
    const maybePromise = result as unknown as Promise<unknown>;
    if (result && typeof maybePromise.finally === "function") {
      maybePromise.finally(scheduleRestore);
    } else {
      scheduleRestore();
    }
    return result;
  } catch (error) {
    scheduleRestore();
    throw error;
  }
}

function quoteWorkspaceFailure(message: string, error: unknown): AiGatewayFailureDetail {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    path: "/ai/acord-map",
    message,
    error: errorMessage,
  };
}

type QuotingLineSelection = "none" | QuotingLineOfBusiness;
type AiMappingProgressMode = "start" | "next";

interface AiMappingProgress {
  id: string;
  mode: AiMappingProgressMode;
}

const MAX_MAPPING_PROGRESS_ITEMS = 48;
const COMMERCIAL_START_MAPPING_LABELS = [
  "agency information",
  "insured contact information",
  "business identity",
  "policy and effective dates",
  "selected ACORD fields",
  "public records",
  "remaining required fields",
];
const PERSONAL_FALLBACK_MAPPING_LABELS = [
  "property address",
  "occupancy",
  "year built",
  "square footage",
  "roof material",
  "public records",
];

function cleanMappingLabel(label: string | undefined): string {
  return (label ?? "")
    .replace(/[â€“â€”]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeMappingKey(key: string): string {
  const cleaned = cleanMappingLabel(key)
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function dedupeMappingLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  labels.forEach((label) => {
    const cleaned = cleanMappingLabel(label);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out.slice(0, MAX_MAPPING_PROGRESS_ITEMS);
}

function mappingLabelsForTemplate(template: Document): string[] {
  const layoutLabels = (template.templateFieldLayout ?? [])
    .map((field) => field.label)
    .filter((label) => !/^(source|generated|completed|template|file|download|storage)\b/i.test(label));
  if (layoutLabels.length > 0) return layoutLabels;
  return Object.keys(template.templateFields ?? {})
    .filter((key) => !/^(source|generated|completed|template|file|download|storage)\b/i.test(key))
    .map(humanizeMappingKey);
}

function mappingLabelsForStart(input: {
  lineOfBusiness: QuotingLineSelection;
  category?: InsuranceCategory;
  selectedCommercialTemplates: Document[];
  contact: {
    assetDetails?: Record<string, string>;
    address?: string;
    estimatedValue?: number;
  };
}): string[] {
  const categoryLabels =
    input.category && input.category.lineOfBusiness === input.lineOfBusiness
      ? categoryQuotingQuestions(input.category).map((question) => question.label)
      : [];
  const assetDetailLabels = Object.keys(input.contact.assetDetails ?? {}).map(humanizeMappingKey);
  const contactLabels = [
    input.contact.address ? "address" : "",
    typeof input.contact.estimatedValue === "number" && input.contact.estimatedValue > 0
      ? "estimated value"
      : "",
  ];
  const commercialTemplateLabels = input.selectedCommercialTemplates.flatMap((template) => [
    template.documentName || template.fileName,
    ...mappingLabelsForTemplate(template),
  ]);
  return dedupeMappingLabels([
    ...categoryLabels,
    ...assetDetailLabels,
    ...contactLabels,
    ...(input.lineOfBusiness === "commercial"
      ? [...COMMERCIAL_START_MAPPING_LABELS, ...commercialTemplateLabels]
      : PERSONAL_FALLBACK_MAPPING_LABELS),
  ]);
}

function mappingLabelsForSession(session: QuotingSession): string[] {
  const visibleQuestions = visibleQuestionnaireQuestions(session);
  const questions = visibleQuestions.length > 0 ? visibleQuestions : session.questionnaireQuestions ?? [];
  const questionLabels = questions.map((question) => question.label);
  const publicFieldLabels = Object.keys(session.publicFields ?? {}).map(humanizeMappingKey);
  const assetDetailLabels = Object.keys(session.assetDetails ?? {}).map(humanizeMappingKey);
  const commercialTemplateLabels = (session.commercialAcordTemplates ?? []).flatMap((template) => [
    template.documentName || template.fileName,
    template.formNumber ? `ACORD ${template.formNumber}` : "",
  ]);
  return dedupeMappingLabels([
    ...questionLabels,
    ...(session.missingFields ?? []),
    ...assetDetailLabels,
    ...publicFieldLabels,
    ...(session.lineOfBusiness === "commercial"
      ? [...COMMERCIAL_START_MAPPING_LABELS, ...commercialTemplateLabels]
      : PERSONAL_FALLBACK_MAPPING_LABELS),
  ]);
}

// =====================================================================
// AI quoting workspace. Replaces the old "Quote data" card on the
// prospect detail page. Walks the agent through:
//   1. Start session → AI pulls public records, lists what it has
//      and what it still needs.
//   2. Draft questionnaire → AI writes a message; agent reviews + sends.
//   3. Awaiting reply → agent marks the reply received when it comes in.
//   4. AI runs the quotes against every linked carrier and ranks
//      them by composite score.
// =====================================================================

export function AiQuotingWorkspace({
  tenantId,
  userId,
  contact,
  onChanged,
  onReset,
  onSetupLineOfBusinessChange,
  deepLinkExpanded = false,
  deepLinkFocusKey,
  setupControls,
  standalone = false,
}: {
  tenantId: string;
  userId: string;
  contact: {
    kind: "prospect" | "client";
    id: string;
    name: string;
    assetType: AssetType;
    address?: string;
    estimatedValue?: number;
    assetDetails?: Record<string, string>;
    categoryId?: string;
    categoryLabel?: string;
    categoryIds?: string[];
    categoryLabels?: string[];
    intakeWarnings?: string[];
    personalLinesAssetRequired?: boolean;
    personalLinesAssetSelected?: boolean;
    lineOfBusiness?: QuotingLineOfBusiness;
    // Client side: existing asset being re-quoted.
    assetId?: string;
    assets?: Array<{
      assetId?: string;
      label: string;
      assetType: AssetType;
      address?: string;
      estimatedValue?: number;
      assetDetails?: Record<string, string>;
      categoryId?: string;
      categoryLabel?: string;
    }>;
  };
  onChanged?: () => void;
  onReset?: () => void;
  onSetupLineOfBusinessChange?: (line: QuotingLineOfBusiness) => void;
  deepLinkExpanded?: boolean;
  deepLinkFocusKey?: string;
  setupControls?: ReactNode;
  standalone?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<null | string>(null);
  const [, setDbRev] = useState(0);
  const lockedLineOfBusiness = contact.lineOfBusiness;
  const [lineOfBusiness, setLineOfBusiness] = useState<QuotingLineSelection>(
    lockedLineOfBusiness ?? "none"
  );
  const [selectedAcordTemplateIds, setSelectedAcordTemplateIds] = useState<string[]>([]);
  const [highlightedCommercialMissingQuestions, setHighlightedCommercialMissingQuestions] =
    useState<QuotingQuestion[]>([]);
  const [workspaceOpen, setWorkspaceOpen] = useState(deepLinkExpanded);
  const [mappingProgress, setMappingProgress] = useState<AiMappingProgress | null>(null);
  const [setupMappingInFlight, setSetupMappingInFlight] = useState(false);
  const activeContactIdRef = useRef(contact.id);
  const mappingClearTimerRef = useRef<number | null>(null);
  const handleAiFailure = (failure: AiGatewayFailureDetail) => {
    console.warn("[quotex-ai-quoting-workspace] AI diagnostic retained outside UI", failure);
  };
  const syncWorkspaceRoute = (expanded: boolean) => {
    if (standalone) return;
    const params = new URLSearchParams(location.search);
    if (expanded) {
      params.set("quoteWorkspace", "expanded");
    } else {
      params.delete("quoteWorkspace");
    }
    const search = params.toString();
    const nextSearch = search ? `?${search}` : "";
    if (nextSearch === location.search) return;
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch,
        hash: location.hash,
      },
      { replace: true }
    );
  };
  const openWorkspace = () => {
    setWorkspaceOpen(true);
    syncWorkspaceRoute(true);
  };
  const closeWorkspace = () => {
    preserveWindowScroll(() => {
      setWorkspaceOpen(false);
      syncWorkspaceRoute(false);
    });
  };
  useEffect(() => subscribeToDbChanges(() => setDbRev((r) => r + 1)), []);
  useEffect(() => {
    return () => {
      if (mappingClearTimerRef.current !== null) {
        window.clearTimeout(mappingClearTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const onFailure = (event: Event) => {
      const detail = (event as CustomEvent<AiGatewayFailureDetail>).detail;
      if (!detail?.path) return;
      if (detail.path !== "/ai/acord-map" && detail.path !== "/ai/enrich-asset") return;
      handleAiFailure(detail);
    };
    window.addEventListener("quotex-ai-gateway-failure", onFailure);
    return () => window.removeEventListener("quotex-ai-gateway-failure", onFailure);
  }, []);
  const session =
    contact.kind === "prospect"
      ? api.quoting.getForProspect(contact.id)
      : api.quoting.getForCustomer(contact.id);
  useEffect(() => {
    if (!session?.id) return;
    void api.quoting
      .processInboundCarrierCommunications(tenantId, { sessionId: session.id })
      .catch((error) => console.error("Carrier-response catch-up failed", error));
  }, [session?.id, tenantId]);
  useEffect(() => {
    if (lockedLineOfBusiness) {
      setLineOfBusiness(lockedLineOfBusiness);
    }
  }, [lockedLineOfBusiness]);
  useEffect(() => {
    setHighlightedCommercialMissingQuestions([]);
  }, [session?.id]);
  useEffect(() => {
    if (activeContactIdRef.current !== contact.id) {
      activeContactIdRef.current = contact.id;
      setWorkspaceOpen(deepLinkExpanded);
    }
  }, [contact.id, deepLinkExpanded]);
  useEffect(() => {
    if (!deepLinkExpanded) return;
    setWorkspaceOpen(true);
  }, [deepLinkExpanded, deepLinkFocusKey]);
  const activeHighlightedCommercialMissingQuestions = useMemo(() => {
    if (!session || session.lineOfBusiness !== "commercial") return [];
    const responses = session.questionnaireResponses ?? {};
    return highlightedCommercialMissingQuestions.filter(
      (question) => !(responses[question.id] ?? "").trim()
    );
  }, [highlightedCommercialMissingQuestions, session?.id, session?.lineOfBusiness, session?.updatedAt]);
  const intakeWarnings = contact.intakeWarnings ?? [];
  const commercialAcordTemplates = useMemo(
    () =>
      api.documents
        .listTemplates(tenantId)
        .filter((doc) => {
          const name = `${doc.fileName} ${doc.documentName ?? ""}`.toLowerCase();
          return doc.fileType === "application/pdf" && name.includes("acord");
        })
        .sort((a, b) =>
          (a.documentName || a.fileName).localeCompare(b.documentName || b.fileName, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        ),
    [tenantId]
  );
  const needsCommercialAcordSelection =
    lineOfBusiness === "commercial" && selectedAcordTemplateIds.length === 0;
  const needsPolicyLineSelection = !lockedLineOfBusiness && lineOfBusiness === "none";
  const needsPersonalAssetSelection =
    lineOfBusiness === "personal" &&
    contact.personalLinesAssetRequired &&
    !contact.personalLinesAssetSelected;
  const selectedCommercialTemplates = commercialAcordTemplates.filter((template) =>
    selectedAcordTemplateIds.includes(template.id)
  );
  const selectedCommercialTemplateNames = selectedCommercialTemplates.map(
    (template) => template.documentName || template.fileName
  );
  const startMappingLabels = useMemo(
    () =>
      mappingLabelsForStart({
        lineOfBusiness,
        category: contact.categoryId ? api.categories.get(contact.categoryId) : undefined,
        selectedCommercialTemplates,
        contact,
      }),
    [
      lineOfBusiness,
      contact.categoryId,
      contact.address,
      contact.estimatedValue,
      contact.assetDetails,
      selectedCommercialTemplates,
    ]
  );

  function beginMappingProgress(_labels: string[], mode: AiMappingProgressMode): string {
    if (mappingClearTimerRef.current !== null) {
      window.clearTimeout(mappingClearTimerRef.current);
      mappingClearTimerRef.current = null;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMappingProgress({
      id,
      mode,
    });
    return id;
  }

  function finishMappingProgress(id: string) {
    if (mappingClearTimerRef.current !== null) {
      window.clearTimeout(mappingClearTimerRef.current);
      mappingClearTimerRef.current = null;
    }
    setMappingProgress((current) => (current?.id === id ? null : current));
  }

  async function runAcordAiMappingWithProgress(activeSession: QuotingSession) {
    const progressId = beginMappingProgress(mappingLabelsForSession(activeSession), "next");
    try {
      return await api.quoting.runAcordAiMapping(activeSession.id);
    } finally {
      finishMappingProgress(progressId);
    }
  }

  async function start() {
    if (
      needsPolicyLineSelection ||
      needsPersonalAssetSelection ||
      intakeWarnings.length > 0 ||
      needsCommercialAcordSelection
    ) return;
    const selectedLine = lineOfBusiness as QuotingLineOfBusiness;
    const progressId = beginMappingProgress(startMappingLabels, "start");
    setSetupMappingInFlight(true);
    openWorkspace();
    setBusy("start");
    try {
      await api.quoting.startSession({
        tenantId,
        prospectId: contact.kind === "prospect" ? contact.id : undefined,
        customerId: contact.kind === "client" ? contact.id : undefined,
        assetId: contact.assetId,
        createdById: userId,
        assetType: contact.assetType,
        contactName: contact.name,
        address: contact.address,
        estimatedValue: contact.estimatedValue,
        assetDetails: contact.assetDetails,
        categoryId: contact.categoryId,
        categoryLabel: contact.categoryLabel,
        categoryIds: contact.categoryIds,
        categoryLabels: contact.categoryLabels,
        lineOfBusiness: selectedLine,
        selectedAcordTemplateIds:
          selectedLine === "commercial" ? selectedAcordTemplateIds : undefined,
        assets: contact.assets,
      });
      onChanged?.();
    } catch (error) {
      handleAiFailure(quoteWorkspaceFailure("AI mapping could not start. Please try again.", error));
    } finally {
      finishMappingProgress(progressId);
      setSetupMappingInFlight(false);
      setBusy(null);
    }
  }

  const setupWorkspaceSteps = workflowStepsForLine(lineOfBusiness);
  const setupWorkspaceSubtitle = [
    lineOfBusiness === "commercial"
      ? "Commercial lines"
      : lineOfBusiness === "personal"
      ? "Personal lines"
      : "No line selected",
    selectedCommercialTemplateNames.length > 0
      ? `${selectedCommercialTemplateNames.length} ACORD ${
          selectedCommercialTemplateNames.length === 1 ? "form" : "forms"
        } selected`
      : null,
    needsPersonalAssetSelection || intakeWarnings.length > 0 || needsCommercialAcordSelection
      ? "Setup pending"
      : "Ready",
  ]
    .filter(Boolean)
    .join(" · ");
  const setupWorkspaceBody = (
      <div className="space-y-3">
        {!lockedLineOfBusiness && (
          <div>
            <label className="label">Policy type / line</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["personal", "commercial"] as const).map((line) => {
                const active = lineOfBusiness === line;
                const Icon = line === "personal" ? User : Building2;
                return (
                  <button
                    key={line}
                    type="button"
                    className={`rounded-md border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
                      active
                        ? "border-gold-400 bg-gold-50 text-ink-900 shadow-sm"
                        : "border-ink-200 bg-white text-ink-700 hover:border-gold-300"
                    }`}
                    onClick={() => {
                      setLineOfBusiness(line);
                      onSetupLineOfBusinessChange?.(line);
                    }}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Icon className="h-4 w-4 text-gold-700" />
                      {line === "personal" ? "Personal lines" : "Commercial lines"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {setupControls}
        {lineOfBusiness === "commercial" && (
          <CommercialAcordTemplatePicker
            templates={commercialAcordTemplates}
            selectedIds={selectedAcordTemplateIds}
            onToggle={(id) =>
              setSelectedAcordTemplateIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
          />
        )}
        {lineOfBusiness === "commercial" && selectedCommercialTemplateNames.length > 0 && (
          <div className="rounded-md border border-ink-100 bg-white px-3 py-2 text-xs text-ink-600">
            Selected: {selectedCommercialTemplateNames.join(", ")}.
          </div>
        )}
        {intakeWarnings.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <div className="font-semibold">Required asset details</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {intakeWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {needsPersonalAssetSelection && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            Asset required.
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => {
              void preserveWindowScroll(start);
            }}
            disabled={
              !!busy ||
              needsPolicyLineSelection ||
              needsPersonalAssetSelection ||
              intakeWarnings.length > 0 ||
              needsCommercialAcordSelection
            }
          >
          <Sparkles className="h-3.5 w-3.5" />
          {needsPolicyLineSelection
            ? "Select policy line first"
            : needsPersonalAssetSelection
            ? "Select asset first"
            : intakeWarnings.length > 0
            ? "Complete asset details first"
            : needsCommercialAcordSelection
            ? "Select ACORD document first"
            : "Start quote flow"}
          </button>
        </div>
      </div>
    );

  if (!session) {
    const setupMappingPending = setupMappingInFlight || mappingProgress?.mode === "start";
    const setupCurrentStep = setupMappingPending ? 2 : 1;
    const setupFullscreenSubtitle = setupMappingPending
      ? "Map known data for the selected asset"
      : setupWorkspaceSubtitle;
    if (standalone) {
      return (
        <StandaloneWorkflowLayout
          steps={setupWorkspaceSteps}
          currentStep={setupCurrentStep}
          completedStepNumbers={setupMappingPending ? [1] : []}
        >
          {setupMappingPending ? (
            <SetupAiMappingPendingPanel
              steps={setupWorkspaceSteps}
              totalSteps={setupWorkspaceSteps.length}
              progress={mappingProgress}
            />
          ) : (
            setupWorkspaceBody
          )}
        </StandaloneWorkflowLayout>
      );
    }
    return (
      <>
        {!workspaceOpen && (
          <CollapsedWorkflowProgress
            steps={setupWorkspaceSteps}
            currentStep={setupCurrentStep}
            totalSteps={setupWorkspaceSteps.length}
            subtitle={setupFullscreenSubtitle}
            actionLabel={setupMappingPending ? "Continue quote flow" : "Start quote flow"}
            onExpand={openWorkspace}
          />
        )}
        <AiWorkspaceFullScreen
          open={workspaceOpen}
          onClose={closeWorkspace}
          steps={setupWorkspaceSteps}
          currentStep={setupCurrentStep}
          totalSteps={setupWorkspaceSteps.length}
          title="AI Quoting Workspace"
          subtitle={setupFullscreenSubtitle}
        >
          {setupMappingPending ? (
            <SetupAiMappingPendingPanel
              steps={setupWorkspaceSteps}
              totalSteps={setupWorkspaceSteps.length}
              progress={mappingProgress}
            />
          ) : (
            setupWorkspaceBody
          )}
        </AiWorkspaceFullScreen>
      </>
    );
  }

  const flowSteps = workflowStepsForLine(session.lineOfBusiness ?? lineOfBusiness);
  const showQuoteRanking =
    session.status === "complete" ||
    (session.lineOfBusiness === "commercial" && session.quotes.length > 0);
  const shouldShowQuestionnaire =
    session.lineOfBusiness !== "commercial" ||
    visibleQuestionnaireQuestions(session).length > 0;
  const canGoBackInSession =
    session.lineOfBusiness === "commercial" ||
    session.status !== "gathering_info" ||
    session.quotes.length > 0 ||
    !!session.personalQuestionnairePreparedAt ||
    !!session.questionnaireSentAt ||
    !!session.commercialQuestionnairePreparedAt ||
    !!commercialApplicationSentAt(session) ||
    !!session.commercialSecondRoundSentAt ||
    !!session.commercialSupplementalsCompletedAt ||
    (session.commercialCarrierSubmissions ?? []).length > 0;
  const questionnaireCard = shouldShowQuestionnaire ? (
    <Questionnaire
      session={session}
      userId={userId}
      busy={busy}
      setBusy={setBusy}
      onChanged={onChanged}
    />
  ) : null;
  const flowPage =
    session.lineOfBusiness === "commercial"
      ? commercialFlowPage(session)
      : personalFlowPage(session);
  const activeWorkspaceBody = (
    <div className="space-y-4">
      {session.lineOfBusiness === "commercial" ? (
        <CommercialFlowPanel
          session={session}
          questionnaireCard={questionnaireCard}
          userId={userId}
          onChanged={onChanged}
          highlightMissingQuestions={activeHighlightedCommercialMissingQuestions}
          mappingProgress={mappingProgress}
          steps={flowSteps}
        />
      ) : (
        <PersonalFlowPanel
          session={session}
          questionnaireCard={questionnaireCard}
          userId={userId}
          onChanged={onChanged}
          showQuoteRanking={showQuoteRanking}
          mappingProgress={mappingProgress}
          steps={flowSteps}
        />
      )}
      <div className="pt-3 border-t border-ink-100 flex items-center justify-between gap-3">
        <div className="text-[11px] text-ink-500">
          Session opened {fmt.dateTime(session.createdAt)} · last updated{" "}
          {fmt.dateTime(session.updatedAt)}.
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => {
              if (!confirm("Start the quoting workspace over from scratch?")) return;
              preserveWindowScroll(() => {
                api.quoting.reset(session.id);
                onChanged?.();
                onReset?.();
              });
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Start over
          </button>
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => {
              preserveWindowScroll(() => {
                const steppedSession = api.quoting.stepBack(session.id);
                onChanged?.();
                if (!steppedSession) onReset?.();
              });
            }}
            disabled={!!busy || !canGoBackInSession}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <QuoteNextAction
            session={session}
            userId={userId}
            busy={busy}
            setBusy={setBusy}
            onChanged={onChanged}
            onCommercialMissingFieldsRevealed={setHighlightedCommercialMissingQuestions}
            onFailure={handleAiFailure}
            mappingProgress={mappingProgress}
            runAcordAiMapping={runAcordAiMappingWithProgress}
          />
        </div>
      </div>
    </div>
  );

  if (standalone) {
    return (
      <StandaloneWorkflowLayout
        steps={flowSteps}
        currentStep={flowPage.step}
        completedStepNumbers={workflowCompletedStepNumbers(session)}
      >
        {activeWorkspaceBody}
      </StandaloneWorkflowLayout>
    );
  }

  return (
    <>
      {!workspaceOpen && (
        <CollapsedWorkflowProgress
          steps={flowSteps}
          currentStep={flowPage.step}
          totalSteps={flowPage.total}
          completedStepNumbers={workflowCompletedStepNumbers(session)}
          subtitle={`${session.lineOfBusiness === "commercial" ? "Commercial lines" : "Personal lines"} - ${
            flowPage.title
          }`}
          actionLabel="Continue quote flow"
          onExpand={openWorkspace}
        />
      )}
      <AiWorkspaceFullScreen
        open={workspaceOpen}
        onClose={closeWorkspace}
        steps={flowSteps}
        currentStep={flowPage.step}
        totalSteps={flowPage.total}
        completedStepNumbers={workflowCompletedStepNumbers(session)}
        title="AI Quoting Workspace"
        subtitle={`${session.lineOfBusiness === "commercial" ? "Commercial lines" : "Personal lines"} · ${
          flowPage.title
        }`}
      >
        {activeWorkspaceBody}
      </AiWorkspaceFullScreen>
    </>
  );
}

function aiProviderFailureBlocksWorkflowForSession(session: QuotingSession): boolean {
  void session;
  return false;
}

function AiMappingProgressPanel({ progress }: { progress: AiMappingProgress | null }) {
  if (!progress) return null;
  const message =
    progress.mode === "start"
      ? "AI mapping is researching the selected line and building the workspace."
      : "AI mapping is reviewing the saved questionnaire and document fields.";
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <div>
          <div className="font-semibold">AI mapping in progress</div>
          <div className="mt-0.5 text-blue-800">{message}</div>
        </div>
      </div>
    </div>
  );
}

function SetupAiMappingPendingPanel({
  steps,
  totalSteps,
  progress,
}: {
  steps: WorkflowStepDefinition[];
  totalSteps: number;
  progress: AiMappingProgress | null;
}) {
  const activeProgress = progress ?? { id: "setup-ai-mapping", mode: "start" as const };
  return (
    <div className="rounded-md border border-violet-100 bg-violet-50/40 p-3 space-y-4">
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold">
            AI mapping
          </div>
          <h3 className="mt-1 text-base font-semibold text-ink-950">
            Map known data for the selected asset
          </h3>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <WorkflowStepIcons
            steps={steps}
            currentStep={2}
            totalSteps={totalSteps}
            completedStepNumbers={[1]}
          />
          <Badge tone="info">Step 2 of {totalSteps}</Badge>
        </div>
      </div>

      <AiMappingProgressPanel progress={activeProgress} />
    </div>
  );
}

function CommercialAcordTemplatePicker({
  templates,
  selectedIds,
  onToggle,
}: {
  templates: Document[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const selectedTemplates = templates.filter((template) => selectedIds.includes(template.id));
  const filteredTemplates = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => {
      const haystack = [
        template.documentName,
        template.fileName,
        template.documentName?.match(/\bACORD\s*0?(\d{1,4})\b/i)?.[1],
        template.fileName.match(/\bacord[-_\s]?0?(\d{1,4})\b/i)?.[1],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [searchText, templates]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewTemplate =
    selectedTemplates.find((template) => template.id === previewId) ?? selectedTemplates[0] ?? null;
  const previewUrl = previewTemplate ? documentFileUrl(previewTemplate) : null;

  useEffect(() => {
    if (selectedTemplates.length === 0) {
      setPreviewId(null);
      return;
    }
    if (!previewId || !selectedIds.includes(previewId)) {
      setPreviewId(selectedTemplates[0].id);
    }
  }, [previewId, selectedIds, selectedTemplates]);

  return (
    <div className="rounded-md border border-ink-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink-900">
            Select ACORD document(s) to complete
          </div>
        </div>
        <Badge tone={selectedIds.length > 0 ? "success" : "warn"}>
          {selectedIds.length} selected
        </Badge>
      </div>
      {templates.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No bundled ACORD PDFs found.
        </div>
      ) : (
        <>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              className="input min-h-10 pl-9 text-sm"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search ACORD documents by number, name, or file..."
              aria-label="Search ACORD documents"
            />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {filteredTemplates.map((template) => {
              const selected = selectedIds.includes(template.id);
              const fileUrl = documentFileUrl(template);
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
                    selected
                      ? "border-gold-400 bg-gold-50 shadow-sm"
                      : "border-ink-200 bg-white hover:border-gold-300"
                  }`}
                  onClick={() => {
                    if (!selected) setPreviewId(template.id);
                    onToggle(template.id);
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        selected ? "border-gold-600 bg-gold-600 text-white" : "border-ink-300"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-900">
                        {template.documentName || template.fileName}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {template.fileName}
                      </span>
                      {fileUrl && (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-gold-200 bg-gold-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-800">
                          <FileText className="h-3 w-3" /> Embedded PDF
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredTemplates.length === 0 && (
            <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-ink-50 px-3 py-4 text-center text-sm text-ink-500">
              No matching ACORD documents.
            </div>
          )}
          {previewTemplate && (
            <div className="mt-3 rounded-md border border-ink-200 bg-ink-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-ink-900">Embedded PDF preview</div>
                  <div className="mt-0.5 text-[11px] text-ink-500">
                    {previewTemplate.documentName || previewTemplate.fileName}
                  </div>
                </div>
                {selectedTemplates.length > 1 && (
                  <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
                    {selectedTemplates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          template.id === previewTemplate.id
                            ? "border-gold-400 bg-white text-gold-900"
                            : "border-ink-200 bg-white text-ink-600 hover:border-gold-300"
                        }`}
                        onClick={() => setPreviewId(template.id)}
                      >
                        {template.documentName?.replace(/\s+-\s+.*/, "") || template.fileName}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {previewTemplate.templateFieldLayout?.length ? (
                <DocumentTemplateFieldOverlay
                  layout={previewTemplate.templateFieldLayout}
                  fields={previewTemplate.templateFields}
                  fileUrl={previewUrl ?? undefined}
                  sourceFileName={previewTemplate.fileName}
                  title="Selected ACORD form"
                  renderPdfBackground={false}
                />
              ) : previewUrl ? (
                <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-white px-3 py-6 text-center text-xs text-ink-500">
                  The detected field overlay is unavailable for this ACORD file.
                  <a
                    className="ml-1 font-semibold text-blue-700 underline"
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the source PDF
                  </a>
                  .
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-ink-200 bg-white px-3 py-6 text-center text-xs text-ink-500">
                  This selected template does not have a bundled PDF URL.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type StatusStep = {
  key: string;
  label: string;
  state: "done" | "active" | "pending";
};

function QuoteMatchBadge({ score }: { score?: number | null }) {
  const percent = quoteMatchPercent(score);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums ${quoteMatchBadgeClass(
        percent
      )}`}
      title={quoteMatchCriteriaTitle(percent)}
    >
      {percent}% match
    </span>
  );
}

function quoteStatusSteps(session: QuotingSession): StatusStep[] {
  if (session.lineOfBusiness !== "commercial") {
    const steps = [
      { key: "gathering_info", label: "Gathering info" },
      { key: "awaiting_reply", label: "Awaiting reply" },
      { key: "quoting", label: "Running quotes" },
      { key: "complete", label: "Ranked" },
    ] as const;
    const idx = Math.max(0, steps.findIndex((s) => s.key === session.status));
    return steps.map((s, i) => ({
      ...s,
      state: i < idx ? "done" : i === idx ? "active" : "pending",
    }));
  }

  const submissions = session.commercialCarrierSubmissions ?? [];
  const sentToCarriers = !!commercialApplicationSentAt(session);
  const carrierRepliesRead = submissions.some(
    (s) =>
      !!s.responseAt ||
      s.status === "accepted" ||
      s.status === "declined" ||
      s.status === "needs_client_info" ||
      s.status === "supplemental_sent" ||
      s.status === "needs_supplemental" ||
      s.status === "agent_review"
  );
  const secondRoundSent = !!session.commercialSecondRoundSentAt;
  const acceptedRankingVisible =
    session.quotes.length > 0 &&
    submissions.some((s) => s.status === "accepted" || s.status === "supplemental_sent");
  const supplementalsComplete =
    !!session.commercialSupplementalsCompletedAt || session.status === "complete";
  const initialClientIntakeDone = sentToCarriers || session.status === "complete";
  const supplementalAutoFillSeen =
    supplementalsComplete ||
    submissions.some(
      (s) =>
        s.status === "supplemental_sent" ||
        s.status === "accepted" ||
        (s.supplementalDocumentIds ?? []).length > 0
    );

  return [
    {
      key: "public_data",
      label: "Public data",
      state: "done",
    },
    {
      key: "client_intake",
      label: "Client intake",
      state: initialClientIntakeDone ? "done" : "active",
    },
    {
      key: "carrier_apps",
      label: "Send to carriers",
      state: sentToCarriers ? "done" : initialClientIntakeDone ? "active" : "pending",
    },
    {
      key: "carrier_replies",
      label: "Filter carrier replies",
      state: carrierRepliesRead ? "done" : sentToCarriers ? "active" : "pending",
    },
    {
      key: "supplementals",
      label: "Auto-fill supplementals",
      state: supplementalAutoFillSeen ? "done" : carrierRepliesRead ? "active" : "pending",
    },
    {
      key: "missing_info",
      label: "Missing-info round",
      state: secondRoundSent
        ? supplementalsComplete
          ? "done"
          : "active"
        : carrierRepliesRead
        ? "done"
        : "pending",
    },
    {
      key: "accepted_ranking",
      label: "Accepted ranking",
      state: acceptedRankingVisible ? "active" : "pending",
    },
  ];
}

function StatusStrip({ session }: { session: QuotingSession }) {
  const steps = quoteStatusSteps(session);
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-600 flex-wrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-ink-200 bg-white text-ink-700 font-medium">
        {session.lineOfBusiness === "commercial" ? (
          <Building2 className="h-3 w-3" />
        ) : (
          <User className="h-3 w-3" />
        )}
        {session.lineOfBusiness === "commercial" ? "Commercial" : "Personal"}
      </span>
      {steps.map((s, i) => {
        const active = s.state === "active";
        const done = s.state === "done";
        return (
          <div key={s.key} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
                done
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : active
                  ? "bg-gold-100 border-gold-300 text-gold-800 font-medium"
                  : "bg-ink-50 border-ink-100 text-ink-500"
              }`}
            >
              {done && <Check className="h-3 w-3" />}
              {s.label}
            </span>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-ink-300" />}
          </div>
        );
      })}
    </div>
  );
}

type WorkflowStepDefinition = {
  number: number;
  label: string;
  icon: typeof ClipboardList;
};

type CommercialFlowPage = {
  key:
    | "ai_mapping"
    | "field_review"
    | "carrier_submissions"
    | "supplemental_round"
    | "accepted_ranking"
    | "carrier_review";
  step: number;
  total: number;
  eyebrow: string;
  title: string;
};

function commercialApplicationSentAt(session: QuotingSession): string | undefined {
  const submissions = session.commercialCarrierSubmissions ?? [];
  const applicationMessageIds = Array.from(
    new Set(submissions.flatMap((submission) => submission.applicationMessageIds ?? []))
  );
  if (applicationMessageIds.length > 0) {
    const communications = new Map(
      api.communications
        .listByTenant(session.tenantId)
        .map((communication) => [communication.id, communication])
    );
    const providerConfirmed = applicationMessageIds.every((messageId) => {
      const status = communications.get(messageId)?.deliveryStatus;
      return status === "sent" || status === "synced";
    });
    if (!providerConfirmed) return undefined;
  }
  if (session.commercialApplicationSentAt) return session.commercialApplicationSentAt;
  const applicationSubmission = submissions.find(
    (submission) =>
      (submission.applicationMessageIds?.length ?? 0) > 0 ||
      (submission.applicationDocumentIds?.length ?? 0) > 0 ||
      submission.status === "application_sent" ||
      submission.status === "awaiting_response" ||
      submission.status === "accepted" ||
      submission.status === "declined" ||
      submission.status === "needs_client_info" ||
      submission.status === "needs_supplemental" ||
      submission.status === "supplemental_sent" ||
      submission.status === "agent_review"
  );
  return applicationSubmission?.sentAt;
}

async function deliverCommercialCarrierEmails(input: {
  session: QuotingSession;
  userId: string;
  kind: "application" | "supplemental";
}): Promise<void> {
  try {
    const sender = api.users.get(input.userId);
    if (!sender || sender.tenantId !== input.session.tenantId) {
      throw new Error("The sending staff mailbox could not be verified.");
    }

    const messageIds = Array.from(
      new Set(
        (input.session.commercialCarrierSubmissions ?? []).flatMap((submission) =>
          input.kind === "application"
            ? submission.applicationMessageIds ?? []
            : submission.supplementalMessageIds ?? []
        )
      )
    );
    if (messageIds.length === 0) {
      throw new Error("The carrier email could not be prepared for delivery.");
    }

    const communications = new Map(
      api.communications
        .listByTenant(input.session.tenantId)
        .map((communication) => [communication.id, communication])
    );
    const missingMessage = messageIds.find((messageId) => !communications.has(messageId));
    if (missingMessage) {
      throw new Error("The carrier email could not be prepared for delivery.");
    }

    const failures: string[] = [];
    for (const messageId of messageIds) {
      const communication = communications.get(messageId)!;
      const result = await sendCommunicationThroughLiveMailbox({
        tenantId: input.session.tenantId,
        user: sender,
        communication,
      });
      if (!result.ok) failures.push(result.message);
    }
    if (failures.length > 0) {
      throw new Error("The connected mailbox did not confirm carrier email delivery.");
    }

    const confirmed = api.quoting.confirmCommercialCarrierDelivery(
      input.session.id,
      input.kind
    );
    if (!confirmed) {
      throw new Error("The carrier delivery confirmation could not be saved.");
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Carrier email delivery failed.";
    api.quoting.markCommercialCarrierDeliveryFailed(input.session.id, input.kind, reason);
    throw error;
  }
}

const COMMERCIAL_WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  { number: 1, label: "Setup", icon: ClipboardList },
  { number: 2, label: "AI mapping", icon: WandSparkles },
  { number: 3, label: "ACORD review", icon: FileCheck2 },
  { number: 4, label: "Carrier send", icon: Send },
  { number: 5, label: "Supplementals", icon: FileQuestion },
  { number: 6, label: "Quote ranking", icon: Trophy },
];

const PERSONAL_WORKFLOW_STEPS: WorkflowStepDefinition[] = [
  { number: 1, label: "Setup", icon: ClipboardList },
  { number: 2, label: "AI mapping", icon: WandSparkles },
  { number: 3, label: "Questionnaire", icon: FileQuestion },
  { number: 4, label: "Carrier ranking", icon: Trophy },
];

function workflowStepsForLine(
  lineOfBusiness: QuotingLineSelection | QuotingLineOfBusiness
): WorkflowStepDefinition[] {
  if (lineOfBusiness === "commercial") {
    return COMMERCIAL_WORKFLOW_STEPS;
  }
  return PERSONAL_WORKFLOW_STEPS;
}

function commercialFlowPage(session: QuotingSession): CommercialFlowPage {
  const submissions = session.commercialCarrierSubmissions ?? [];
  const applicationSentAt = commercialApplicationSentAt(session);
  const awaitingResponse = submissions.filter(
    (s) => s.status === "awaiting_response" || s.status === "application_sent"
  );
  const carrierRepliesRead = submissions.some(
    (s) =>
      !!s.responseAt ||
      s.status === "accepted" ||
      s.status === "declined" ||
      s.status === "needs_client_info" ||
      s.status === "supplemental_sent" ||
      s.status === "needs_supplemental" ||
      s.status === "agent_review"
  );
  if (!session.commercialQuestionnairePreparedAt && !applicationSentAt) {
    return {
      key: "ai_mapping",
      step: 2,
      total: 6,
      eyebrow: "AI mapping",
      title: "Map known data onto the selected ACORD document",
    };
  }
  if (!applicationSentAt) {
    return {
      key: "field_review",
      step: 3,
      total: 6,
      eyebrow: "ACORD field review",
      title: "Review the ACORD and handle the remaining fields",
    };
  }
  if (awaitingResponse.length > 0) {
    return {
      key: "carrier_submissions",
      step: 4,
      total: 6,
      eyebrow: "Carrier submissions",
      title: "Applications are out to carriers",
    };
  }
  if (session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt) {
    return {
      key: "supplemental_round",
      step: 5,
      total: 6,
      eyebrow: "Supplemental round",
      title: "Collect only the carrier follow-up fields",
    };
  }
  if (session.quotes.length > 0 || session.status === "complete") {
    return {
      key: "accepted_ranking",
      step: 6,
      total: 6,
      eyebrow: "Accepted ranking",
      title: "Review accepted markets and ranked quotes",
    };
  }
  return {
    key: carrierRepliesRead ? "carrier_review" : "carrier_submissions",
    step: carrierRepliesRead ? 6 : 4,
    total: 6,
    eyebrow: carrierRepliesRead ? "Carrier review" : "Carrier submissions",
    title: carrierRepliesRead ? "Carrier responses are ready" : "Applications are out to carriers",
  };
}

function WorkflowStepIcons({
  steps,
  currentStep,
  totalSteps,
  completedStepNumbers = [],
  wrap = true,
}: {
  steps: WorkflowStepDefinition[];
  currentStep: number;
  totalSteps?: number;
  completedStepNumbers?: number[];
  wrap?: boolean;
}) {
  const visibleSteps = steps.slice(0, totalSteps ?? steps.length);
  const total = visibleSteps.length;
  const completed = new Set(completedStepNumbers);

  return (
    <div
      className={`flex max-w-full items-center gap-1 py-1 ${wrap ? "flex-wrap" : "flex-nowrap"}`}
      aria-label={`Workflow progress: step ${currentStep} of ${total}`}
    >
      {visibleSteps.map((step, index) => {
        const done = step.number < currentStep || completed.has(step.number);
        const active = step.number === currentStep && !done;
        const Icon = step.icon;
        return (
          <div key={step.number} className="flex items-center gap-1">
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                done
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : active
                  ? "border-gold-400 bg-gold-50 text-gold-900 shadow-sm"
                  : "border-ink-200 bg-ink-50 text-ink-400"
              }`}
              title={`${step.label}: ${done ? "completed" : active ? "current" : "pending"}`}
              aria-label={`${step.label}: ${done ? "completed" : active ? "current" : "pending"}`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{step.label}</span>
              {done && (
                <span className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Check className="h-2.5 w-2.5 shrink-0" />
                </span>
              )}
            </span>
            {index < visibleSteps.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 text-ink-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StandaloneWorkflowLayout({
  steps,
  currentStep,
  completedStepNumbers = [],
  children,
}: {
  steps: WorkflowStepDefinition[];
  currentStep: number;
  completedStepNumbers?: number[];
  children: ReactNode;
}) {
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside
        className="hidden min-h-0 overflow-y-auto border-r border-ink-100 bg-ink-50/60 p-4 lg:block"
        aria-label={`Quote workflow steps: step ${currentStep} of ${steps.length}`}
      >
        <WorkspaceSideRail
          steps={steps}
          currentStep={currentStep}
          totalSteps={steps.length}
          completedStepNumbers={completedStepNumbers}
        />
      </aside>
      <main className="min-h-0 min-w-0 overflow-y-auto bg-ink-50/30 px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-[1320px] space-y-4">
          <div className="rounded-md border border-ink-100 bg-white px-3 py-2 lg:hidden">
            <WorkflowStepIcons
              steps={steps}
              currentStep={currentStep}
              totalSteps={steps.length}
              completedStepNumbers={completedStepNumbers}
            />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function workflowCompletedStepNumbers(session: QuotingSession): number[] {
  if (session.lineOfBusiness === "commercial") {
    const completed = new Set<number>();
    const applicationSentAt = commercialApplicationSentAt(session);
    if (session.commercialQuestionnairePreparedAt || applicationSentAt || session.quotes.length > 0) {
      completed.add(2);
    }
    if (applicationSentAt) {
      completed.add(3);
      completed.add(4);
    }
    if (session.commercialSupplementalsCompletedAt) completed.add(5);
    return Array.from(completed);
  }
  return session.status === "complete" || session.quotes.length > 0 ? [4] : [];
}

export function QuoteWorkflowProgress({ session }: { session: QuotingSession }) {
  const steps = workflowStepsForLine(session.lineOfBusiness ?? "personal");
  const page =
    session.lineOfBusiness === "commercial"
      ? commercialFlowPage(session)
      : personalFlowPage(session);

  return (
    <div className="flex min-w-max items-center gap-2">
      <WorkflowStepIcons
        steps={steps}
        currentStep={page.step}
        totalSteps={page.total}
        completedStepNumbers={workflowCompletedStepNumbers(session)}
        wrap={false}
      />
      <span className="shrink-0">
        <Badge tone="info">
          Step {page.step} of {page.total}
        </Badge>
      </span>
    </div>
  );
}

function AiWorkspaceLogoMark() {
  return (
    <span className="relative inline-grid h-10 w-10 shrink-0 place-items-center rounded-md border border-gold-200 bg-gold-50 text-gold-700">
      <FileText className="h-5 w-5" />
      <span className="absolute right-0.5 top-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-gold-700 shadow-sm">
        <Sparkles className="h-3 w-3" />
      </span>
    </span>
  );
}

function CollapsedWorkflowProgress({
  steps,
  currentStep,
  totalSteps,
  completedStepNumbers,
  subtitle,
  actionLabel = "Start quote flow",
  onExpand,
}: {
  steps: WorkflowStepDefinition[];
  currentStep: number;
  totalSteps: number;
  completedStepNumbers?: number[];
  subtitle?: string;
  actionLabel?: string;
  onExpand: () => void;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-3">
            <AiWorkspaceLogoMark />
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-ink-950">
                AI Quoting Workspace
              </div>
              {subtitle && <div className="mt-0.5 truncate text-sm text-ink-500">{subtitle}</div>}
            </div>
          </div>
          <div className="mt-3 overflow-x-auto pb-1">
            <WorkflowStepIcons
              steps={steps}
              currentStep={currentStep}
              totalSteps={totalSteps}
              completedStepNumbers={completedStepNumbers}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 lg:pl-4">
          <Badge tone="info">
            Step {currentStep} of {totalSteps}
          </Badge>
          <button
            type="button"
            className="btn-primary text-xs whitespace-nowrap"
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AiWorkspaceFullScreen({
  open,
  onClose,
  title,
  subtitle,
  steps,
  currentStep,
  totalSteps,
  completedStepNumbers,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  steps: WorkflowStepDefinition[];
  currentStep: number;
  totalSteps: number;
  completedStepNumbers?: number[];
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeRequestedRef = useRef(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (open) {
      closeRequestedRef.current = false;
      setShouldRender(true);
      setClosing(false);
      return;
    }
    if (!shouldRender) return;
    setClosing(true);
    const timer = window.setTimeout(() => {
      setShouldRender(false);
      setClosing(false);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, shouldRender]);
  useEffect(() => {
    if (!shouldRender) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    const focusTimer = open ? window.setTimeout(() => panelRef.current?.focus(), 0) : undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [open, shouldRender]);

  function requestClose() {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    onCloseRef.current();
  }

  if (!shouldRender) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-workspace-fullscreen-title"
      tabIndex={-1}
      className={`fixed inset-0 z-[60] flex flex-col bg-white text-ink-900 transition-opacity duration-150 ease-out focus:outline-none ${
        closing ? "opacity-0" : "opacity-100"
      }`}
    >
      <header className="shrink-0 border-b border-ink-100 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="relative flex min-h-[70px] flex-col justify-center gap-3 sm:block">
          <button
            type="button"
            className="btn-outline z-10 shrink-0 text-sm sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              requestClose();
            }}
            onClick={requestClose}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to profile
          </button>
          <div className="flex min-w-0 justify-center sm:min-h-[70px] sm:items-center">
            <div className="flex min-w-0 items-center justify-center gap-3">
              <AiWorkspaceLogoMark />
              <div className="min-w-0">
                <h2
                  id="ai-workspace-fullscreen-title"
                  className="truncate text-lg font-semibold text-ink-950"
                >
                  {title}
                </h2>
                {subtitle && (
                  <div className="mt-0.5 truncate text-sm text-ink-500">{subtitle}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-ink-100 bg-ink-50/60 p-4 lg:block">
          <WorkspaceSideRail
            steps={steps}
            currentStep={currentStep}
            totalSteps={totalSteps}
            completedStepNumbers={completedStepNumbers}
          />
        </aside>
        <main className="min-h-0 min-w-0 overflow-y-auto bg-ink-50/30 px-4 py-4 sm:px-6">
          <div className="mx-auto w-full max-w-[1320px] space-y-4">
            <div className="rounded-md border border-ink-100 bg-white px-3 py-2 lg:hidden">
              <WorkflowStepIcons
                steps={steps}
                currentStep={currentStep}
                totalSteps={totalSteps}
                completedStepNumbers={completedStepNumbers}
              />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function WorkspaceSideRail({
  steps,
  currentStep,
  totalSteps,
  completedStepNumbers = [],
}: {
  steps: WorkflowStepDefinition[];
  currentStep: number;
  totalSteps: number;
  completedStepNumbers?: number[];
}) {
  const visibleSteps = steps.slice(0, totalSteps);
  const completed = new Set(completedStepNumbers);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
          Workflow
        </div>
        <div className="mt-1 text-sm font-semibold text-ink-900">
          Step {currentStep} of {totalSteps}
        </div>
      </div>
      <ol className="space-y-2">
        {visibleSteps.map((step) => {
          const done = step.number < currentStep || completed.has(step.number);
          const active = step.number === currentStep && !done;
          const Icon = step.icon;
          return (
            <li
              key={step.number}
              className={`rounded-md border px-3 py-2 ${
                done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : active
                  ? "border-gold-300 bg-gold-50 text-gold-950"
                  : "border-ink-100 bg-white text-ink-500"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                    done
                      ? "border-emerald-300 bg-white text-emerald-700"
                      : active
                      ? "border-gold-300 bg-white text-gold-800"
                      : "border-ink-200 bg-ink-50 text-ink-400"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 text-sm font-semibold">{step.label}</span>
                {done && <Check className="h-3.5 w-3.5 shrink-0" />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function PublicFields({ session }: { session: QuotingSession }) {
  const selectedAssets = session.selectedAssetMappings ?? [];
  if (selectedAssets.length > 0) {
    return (
      <div className="space-y-3">
        {selectedAssets.map((asset, index) => {
          const entries = Object.entries(asset.publicFields);
          return (
            <section
              key={asset.assetId ?? `${asset.label}-${index}`}
              className="rounded-md border border-blue-100 bg-blue-50/40 p-3"
            >
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-800">
                <Bot className="h-3 w-3" /> AI-sourced values for {asset.label}
              </div>
              {entries.length > 0 ? (
                <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                  {entries.map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-3">
                      <dt className="text-ink-500">{key}</dt>
                      <dd className="text-right text-ink-800">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs text-ink-500">No reliable public values were found.</p>
              )}
            </section>
          );
        })}
      </div>
    );
  }
  const entries = Object.entries(session.publicFields);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-md border border-blue-100 bg-blue-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-blue-800 font-semibold mb-2 flex items-center gap-1.5">
        <Bot className="h-3 w-3" /> AI-sourced values for review
      </div>
      <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-500">{k}</dt>
            <dd className="text-ink-800 text-right">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Questionnaire({
  session,
  userId,
  busy,
  setBusy,
  onChanged,
}: {
  session: QuotingSession;
  userId: string;
  busy: null | string;
  setBusy: (v: null | string) => void;
  onChanged?: () => void;
}) {
  // Both personal + commercial sessions render the portal-link
  // questionnaire when there's something to ask the client. The
  // legacy inline-email draft path stays below as a fallback for
  // any pre-existing session with no questionnaireQuestions
  // attached (shouldn't happen after the v23 schema bump).
  if ((session.questionnaireQuestions?.length ?? 0) > 0) {
    return (
      <PortalQuestionnaire
        session={session}
        userId={userId}
        busy={busy}
        setBusy={setBusy}
        onChanged={onChanged}
      />
    );
  }
  if (session.missingFields.length === 0 && session.status !== "complete") {
    return null;
  }
  async function draft() {
    setBusy("draft");
    try {
      await api.quoting.draftQuestionnaire(session.id);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }
  function send() {
    preserveWindowScroll(() => {
      setBusy("send");
      try {
        api.quoting.sendQuestionnaire(session.id);
        onChanged?.();
      } finally {
        setBusy(null);
      }
    });
  }
  function markReplied() {
    setBusy("reply");
    try {
      api.quoting.markReplyReceivedAndQuote(session.id);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Needs from client
          ({session.missingFields.length})
        </div>
        {session.status === "awaiting_reply" && session.questionnaireSentAt && (
          <Badge tone="info">
            Sent {fmt.dateTime(session.questionnaireSentAt)}
          </Badge>
        )}
        {session.replyReceivedAt && (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" />
            Reply in
          </Badge>
        )}
      </div>
      <ul className="list-disc pl-5 space-y-0.5 text-xs text-ink-700">
        {session.missingFields.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      {session.status === "gathering_info" && !session.questionnaireDraft && (
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={draft}
          disabled={!!busy}
        >
          {busy === "draft" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {busy === "draft" ? "Drafting…" : "Draft questionnaire"}
        </button>
      )}

      {session.status === "gathering_info" && session.questionnaireDraft && (
        <div className="space-y-2">
          <div className="rounded-md border border-ink-100 bg-white p-3 whitespace-pre-wrap text-xs text-ink-800 max-h-[260px] overflow-y-auto">
            {session.questionnaireDraft}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={draft}
              disabled={!!busy}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Re-draft
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={send}
              disabled={!!busy}
            >
              {busy === "send" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {busy === "send" ? "Sending…" : "Send to client"}
            </button>
          </div>
        </div>
      )}

      {session.status === "awaiting_reply" && (
        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-amber-200">
          <div className="text-[11px] text-amber-800 flex items-start gap-1.5">
            <Mail className="h-3 w-3 mt-0.5 shrink-0" />
            <span>
              Questionnaire is in their inbox. Once they reply (visible in the
              Communications thread above), click below to feed the answers into
              the quoting engine.
            </span>
          </div>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={markReplied}
            disabled={!!busy}
          >
            {busy === "reply" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {busy === "reply" ? "Quoting…" : "Reply received — run quotes"}
          </button>
        </div>
      )}
    </div>
  );
}

// Portal-link questionnaire. Used for both personal + commercial
// sessions — agent generates the link, sends it to the client,
// waits for the client to submit answers through their auth-gated
// portal page. Commercial sessions mix base intake + per-carrier
// supplemental sections; personal sessions render one question per
// AI-identified missing field.
function visibleQuestionnaireQuestions(session: QuotingSession): QuotingQuestion[] {
  const questions = session.questionnaireQuestions ?? [];
  if (session.lineOfBusiness !== "commercial") {
    return questions.map((question) =>
      question.required ? question : { ...question, required: true }
    );
  }
  if (session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt) {
    return questions.filter((q) => q.round === "second_round");
  }
  if (!commercialApplicationSentAt(session)) {
    return questions.filter((q) => !q.carrierId && q.round !== "second_round");
  }
  return questions.filter((q) => q.round === "second_round");
}

function aiMappedQuestionAnswerCount(session: QuotingSession, questions: QuotingQuestion[]): number {
  const responses = session.questionnaireResponses ?? {};
  const meta = session.questionnaireResponseMeta ?? {};
  return questions.filter((question) => {
    if (meta[question.id]?.updatedByRole !== "ai") return false;
    const value = (responses[question.id] ?? "").trim();
    if (!value) return false;
    return !/^(unknown|n\/a|none|not found|not public|not available|requires)\b/i.test(value) &&
      !/\b(not found|not public|not publicly|no public|requires applicant|requires client|requires insured|unable to confirm|unable to determine|clue|loss runs?)\b/i.test(value);
  }).length;
}

function questionnaireEditorLabel(meta: QuestionnaireResponseMeta): string {
  const role =
    meta.updatedByRole === "customer"
      ? "customer"
      : meta.updatedByRole === "manager"
      ? "manager"
      : meta.updatedByRole === "ai"
      ? "AI"
      : "agent";
  return `${meta.updatedByName} (${role})`;
}

function QuestionEditMeta({
  meta,
  needsManual,
}: {
  meta?: QuestionnaireResponseMeta;
  needsManual?: boolean;
}) {
  if (!meta) {
    return (
      <div className={`mt-1 text-[11px] ${needsManual ? "font-medium text-amber-900" : "text-ink-400"}`}>
        {needsManual ? "Not found - enter manually." : "Shared field - not edited yet."}
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-0.5 text-[11px] text-ink-500">
      <div>
        Last edited by {questionnaireEditorLabel(meta)} - {fmt.dateTime(meta.updatedAt)}
      </div>
    </div>
  );
}

function PortalQuestionnaire({
  session,
  userId,
  busy,
  setBusy,
  onChanged,
}: {
  session: QuotingSession;
  userId: string;
  busy: null | string;
  setBusy: (v: null | string) => void;
  onChanged?: () => void;
}) {
  const portalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/customer/questionnaire/${session.id}`
      : `/customer/questionnaire/${session.id}`;
  const [copied, setCopied] = useState(false);
  const [questionnaireEditorOpen, setQuestionnaireEditorOpen] = useState(false);
  const [manualQuestionnaireOpen, setManualQuestionnaireOpen] = useState(false);
  const visibleQuestions = visibleQuestionnaireQuestions(session);
  const sectionCount = new Set(
    visibleQuestions.map((q) => q.section)
  ).size;
  const questionCount = visibleQuestions.length;
  const isSupplementalQuestionnaire =
    session.lineOfBusiness === "commercial" &&
    !!session.commercialSecondRoundSentAt &&
    !session.commercialSupplementalsCompletedAt;
  const questionnaireTitle = isSupplementalQuestionnaire
    ? "Supplemental questionnaire"
    : session.lineOfBusiness === "commercial"
    ? "Commercial questionnaire"
    : "Client questionnaire";
  const sendButtonLabel = isSupplementalQuestionnaire
    ? "Send supplemental questionnaire"
    : session.status === "awaiting_reply"
    ? "Send questionnaire link"
    : "Send to client";
  const answeredCount = Object.keys(session.questionnaireResponses ?? {}).length;
  const lastEdit = Object.values(session.questionnaireResponseMeta ?? {}).sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : -1
  )[0];

  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(portalUrl).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function send() {
    preserveWindowScroll(() => {
      setBusy("send");
      try {
        api.quoting.sendPortalLink(session.id, portalUrl);
        onChanged?.();
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <>
      <div
        id={session.lineOfBusiness === "commercial" ? "commercial-questionnaire-card" : undefined}
        className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-3"
      >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-amber-800 font-semibold flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />
          {questionnaireTitle}
          ({questionCount} question{questionCount === 1 ? "" : "s"} · {sectionCount} section
          {sectionCount === 1 ? "" : "s"})
        </div>
        {!isSupplementalQuestionnaire &&
          session.status === "awaiting_reply" &&
          session.questionnaireSentAt && (
          <Badge tone="info">Sent {fmt.dateTime(session.questionnaireSentAt)}</Badge>
        )}
        {session.replyReceivedAt && (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" /> Reply in — {answeredCount} answer
            {answeredCount === 1 ? "" : "s"}
          </Badge>
        )}
        <Badge tone="info">Shared live draft</Badge>
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={() => setQuestionnaireEditorOpen(true)}
        >
          <FileText className="h-3.5 w-3.5" />
          View questionnaire
        </button>
      </div>

      {lastEdit && !isSupplementalQuestionnaire && (
        <p className="text-[11px] text-ink-500">
          Last questionnaire edit by {questionnaireEditorLabel(lastEdit)} -{" "}
          {fmt.dateTime(lastEdit.updatedAt)}.
        </p>
      )}

      {(session.status === "gathering_info" || session.status === "awaiting_reply") && (
        <div className="space-y-2">
          <div className="rounded-md border border-ink-100 bg-white p-3 text-xs text-ink-700 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-mono truncate">{portalUrl}</span>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={copy}
              title="Copy the portal link"
            >
              {copied ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={send}
              disabled={!!busy}
            >
              {busy === "send" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {busy === "send" ? "Sending..." : sendButtonLabel}
            </button>
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => setManualQuestionnaireOpen(true)}
            >
              <FileText className="h-3.5 w-3.5" />
              Edit manually
            </button>
          </div>
          {session.status === "awaiting_reply" && !isSupplementalQuestionnaire && (
            <p className="text-[11px] text-amber-800">
              The questionnaire link is queued for client delivery. When they submit, the AI ranking runs
              automatically and you'll see an Activity Center task land in your queue.
            </p>
          )}
        </div>
      )}
      </div>
      <QuestionnaireEditorModal
        open={questionnaireEditorOpen}
        session={session}
        userId={userId}
        onClose={() => setQuestionnaireEditorOpen(false)}
        onChanged={onChanged}
      />
      <ManualQuestionnaireModal
        open={manualQuestionnaireOpen}
        session={session}
        userId={userId}
        onClose={() => setManualQuestionnaireOpen(false)}
        onChanged={onChanged}
      />
    </>
  );
}

function cloneQuestionForEditor(question: QuotingQuestion): QuotingQuestion {
  return {
    ...question,
    options: question.options ? [...question.options] : undefined,
  };
}

function newQuestionId() {
  return `qq_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function optionTextToList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((option) => option.trim())
    .filter(Boolean);
}

function QuestionnaireEditorModal({
  open,
  session,
  userId,
  onClose,
  onChanged,
}: {
  open: boolean;
  session: QuotingSession;
  userId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [draftQuestions, setDraftQuestions] = useState<QuotingQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const visibleQuestions = visibleQuestionnaireQuestions(session);
  const isSupplementalRound =
    session.lineOfBusiness === "commercial" &&
    !!session.commercialSecondRoundSentAt &&
    !session.commercialSupplementalsCompletedAt;
  const defaultSection =
    draftQuestions[0]?.section ??
    visibleQuestions[0]?.section ??
    (isSupplementalRound ? "Supplemental questions" : "Client questions");
  const sections = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    draftQuestions.forEach((question) => {
      const section = question.section.trim() || "General";
      const bucket = map.get(section) ?? [];
      bucket.push(question);
      map.set(section, bucket);
    });
    return Array.from(map.entries());
  }, [draftQuestions]);
  const invalidQuestionCount = draftQuestions.filter(
    (question) =>
      !question.label.trim() ||
      !question.section.trim() ||
      (question.kind === "select" && (question.options ?? []).length === 0)
  ).length;
  const editor = api.users.get(userId);
  const actor = {
    id: userId,
    name: editor?.name ?? "Agency team",
    role: editor?.role === "manager" ? "manager" : "agent",
  } as const;

  useEffect(() => {
    if (!open) return;
    setDraftQuestions(visibleQuestionnaireQuestions(session).map(cloneQuestionForEditor));
  }, [open, session.id, session.updatedAt]);

  function updateQuestion(id: string, patch: Partial<QuotingQuestion>) {
    setDraftQuestions((current) =>
      current.map((question) => {
        if (question.id !== id) return question;
        const next = { ...question, ...patch };
        if (patch.kind === "select" && (next.options ?? []).length === 0) {
          next.options = ["Yes", "No"];
        }
        if (patch.kind && patch.kind !== "select") {
          next.options = undefined;
        }
        return next;
      })
    );
  }

  function addQuestion(section = defaultSection) {
    const round: QuotingQuestion["round"] = isSupplementalRound ? "second_round" : "initial";
    setDraftQuestions((current) => [
      ...current,
      {
        id: newQuestionId(),
        section: section.trim() || "General",
        label: "",
        kind: "text",
        required: true,
        round,
      },
    ]);
  }

  function removeQuestion(id: string) {
    setDraftQuestions((current) => current.filter((question) => question.id !== id));
  }

  function save() {
    if (invalidQuestionCount > 0) return;
    const visibleQuestionIds = new Set(visibleQuestions.map((question) => question.id));
    const hiddenQuestions = (session.questionnaireQuestions ?? []).filter(
      (question) => !visibleQuestionIds.has(question.id)
    );
    setBusy(true);
    try {
      api.quoting.updateQuestionnaireQuestions(
        session.id,
        [...hiddenQuestions, ...draftQuestions],
        actor
      );
      onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="View questionnaire"
      size="xl"
      closeIcon="back"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" className="btn-outline text-sm" onClick={() => addQuestion()}>
            <Plus className="h-3.5 w-3.5" />
            Add question
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={save}
              disabled={busy || invalidQuestionCount > 0}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {busy ? "Saving..." : "Save questionnaire"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 text-xs text-ink-500">
          <div>
            {draftQuestions.length} question{draftQuestions.length === 1 ? "" : "s"} across{" "}
            {sections.length} section{sections.length === 1 ? "" : "s"}
          </div>
          {invalidQuestionCount > 0 && (
            <Badge tone="warn">
              {invalidQuestionCount} needs text/options
            </Badge>
          )}
        </div>

        {draftQuestions.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-200 bg-ink-50 p-6 text-center">
            <div className="text-sm font-semibold text-ink-900">No questions yet</div>
            <button
              type="button"
              className="btn-primary mt-3 text-sm"
              onClick={() => addQuestion()}
            >
              <Plus className="h-3.5 w-3.5" />
              Add question
            </button>
          </div>
        ) : (
          <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
            {sections.map(([section, questions]) => (
              <div key={section} className="rounded-md border border-ink-100 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                    {section}
                  </div>
                  <button
                    type="button"
                    className="btn-outline text-[11px] !px-2.5 !py-1.5"
                    onClick={() => addQuestion(section)}
                  >
                    <Plus className="h-3 w-3" />
                    Add here
                  </button>
                </div>
                <div className="space-y-3">
                  {questions.map((question) => (
                    <div
                      key={question.id}
                      className="rounded-md border border-ink-100 bg-ink-50/50 p-3"
                    >
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                        <div>
                          <label className="label">Question</label>
                          <input
                            className="input text-sm"
                            value={question.label}
                            onChange={(event) =>
                              updateQuestion(question.id, { label: event.target.value })
                            }
                            placeholder="Question text"
                          />
                        </div>
                        <div>
                          <label className="label">Type</label>
                          <select
                            className="input text-sm"
                            value={question.kind}
                            onChange={(event) =>
                              updateQuestion(question.id, {
                                kind: event.target.value as QuotingQuestion["kind"],
                              })
                            }
                          >
                            <option value="text">Text</option>
                            <option value="textarea">Long text</option>
                            <option value="number">Number</option>
                            <option value="select">Dropdown</option>
                          </select>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                        <div>
                          <label className="label">Section</label>
                          <input
                            className="input text-sm"
                            value={question.section}
                            onChange={(event) =>
                              updateQuestion(question.id, { section: event.target.value })
                            }
                          />
                        </div>
                        <label className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-ink-800">
                          <input
                            type="checkbox"
                            checked={!!question.required}
                            onChange={(event) =>
                              updateQuestion(question.id, { required: event.target.checked })
                            }
                          />
                          Required
                        </label>
                      </div>

                      {question.kind === "select" && (
                        <div className="mt-3">
                          <label className="label">Dropdown options</label>
                          <textarea
                            className="input min-h-[74px] text-sm"
                            value={(question.options ?? []).join("\n")}
                            onChange={(event) =>
                              updateQuestion(question.id, {
                                options: optionTextToList(event.target.value),
                              })
                            }
                            placeholder={"Yes\nNo\nPending"}
                          />
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-[11px] text-ink-500">
                          {question.sourceDocumentFileName
                            ? `Mapped from ${question.sourceDocumentFileName}`
                            : "Custom questionnaire question"}
                        </div>
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => removeQuestion(question.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function QuoteNextAction({
  session,
  userId,
  busy,
  setBusy,
  onChanged,
  onCommercialMissingFieldsRevealed,
  onFailure,
  mappingProgress,
  runAcordAiMapping,
}: {
  session: QuotingSession;
  userId: string;
  busy: null | string;
  setBusy: (v: null | string) => void;
  onChanged?: () => void;
  onCommercialMissingFieldsRevealed?: (questions: QuotingQuestion[]) => void;
  onFailure?: (failure: AiGatewayFailureDetail) => void;
  mappingProgress?: AiMappingProgress | null;
  runAcordAiMapping?: (session: QuotingSession) => Promise<QuotingSession | null>;
}) {
  const responses = session.questionnaireResponses ?? {};
  const questions = visibleQuestionnaireQuestions(session);
  const requiredMissing = questions.filter(
    (question) => question.required && !(responses[question.id] ?? "").trim()
  );
  const isCommercialIncomplete =
    session.lineOfBusiness === "commercial" && requiredMissing.length > 0;
  const needsCommercialQuestionnaire =
    session.lineOfBusiness === "commercial" &&
    !commercialApplicationSentAt(session) &&
    !session.commercialQuestionnairePreparedAt &&
    questions.length === 0;
  const needsPersonalQuestionnaireReview =
    session.lineOfBusiness !== "commercial" &&
    session.status === "gathering_info" &&
    questions.length > 0 &&
    !session.personalQuestionnairePreparedAt &&
    !session.questionnaireSentAt;
  const hasPendingCarrierResponses =
    session.lineOfBusiness === "commercial" &&
    !!commercialApplicationSentAt(session) &&
    (session.commercialCarrierSubmissions ?? []).some(
      (submission) =>
        submission.status === "awaiting_response" ||
        submission.status === "application_sent"
    );
  const [incompleteWarningOpen, setIncompleteWarningOpen] = useState(false);
  const [personalManualQuestionnaireOpen, setPersonalManualQuestionnaireOpen] =
    useState(false);
  const [carrierSelectOpen, setCarrierSelectOpen] = useState(false);
  const [carrierDraftReview, setCarrierDraftReview] = useState<{
    kind: "application" | "supplemental";
    selectedCarrierIds?: string[];
    drafts: CommercialEmailDraft[];
  } | null>(null);
  const [carrierDeliveryError, setCarrierDeliveryError] = useState<string | null>(null);
  const editor = api.users.get(userId);
  const actor = {
    id: userId,
    name: editor?.name ?? "Agency team",
    role: editor?.role === "manager" ? "manager" : "agent",
  } as const;
  const personalRequiredMissing =
    session.lineOfBusiness !== "commercial" &&
    !needsPersonalQuestionnaireReview &&
    requiredMissing.length > 0;
  const nextDisabled = !!busy;

  if (
    session.status === "complete" ||
    (session.lineOfBusiness === "commercial" &&
      commercialFlowPage(session).key === "accepted_ranking")
  ) {
    return null;
  }

  function saveCurrentResponses() {
    api.quoting.saveQuestionnaireResponses(session.id, responses, actor);
    onChanged?.();
  }

  async function continueCommercialSubmission() {
    onCommercialMissingFieldsRevealed?.([]);
    if (session.lineOfBusiness === "commercial" && !commercialApplicationSentAt(session)) {
      saveCurrentResponses();
      setCarrierSelectOpen(true);
      return;
    }
    if (hasPendingCarrierResponses) {
      setBusy("next");
      try {
        await api.quoting.readCommercialCarrierResponses(session.id);
        onChanged?.();
      } catch (error) {
        onFailure?.(
          quoteWorkspaceFailure("Carrier response processing could not complete.", error)
        );
      } finally {
        setBusy(null);
      }
      return;
    }
    if (session.lineOfBusiness === "commercial") {
      const drafts = api.quoting.previewCommercialCarrierEmails(
        session.id,
        responses,
        "supplemental"
      );
      if (drafts.length > 0) {
        setCarrierDraftReview({ kind: "supplemental", drafts });
        return;
      }
    }
    setBusy("next");
    try {
      api.quoting.submitQuestionnaireResponses(session.id, responses, actor);
      onChanged?.();
    } catch (error) {
      onFailure?.(quoteWorkspaceFailure("Quote ranking could not complete.", error));
    } finally {
      setBusy(null);
    }
  }

  async function next() {
    if (session.status === "complete") return;
    if (needsPersonalQuestionnaireReview) {
      try {
        api.quoting.preparePersonalQuestionnaire(session.id);
        onChanged?.();
      } catch (error) {
        onFailure?.(
          quoteWorkspaceFailure("Personal-lines questionnaire could not be prepared.", error)
        );
      }
      return;
    }
    if (needsCommercialQuestionnaire) {
      setBusy("next");
      try {
        const mapped = await (runAcordAiMapping ?? ((activeSession) => api.quoting.runAcordAiMapping(activeSession.id)))(
          session
        );
        if (!mapped || aiProviderFailureBlocksWorkflowForSession(mapped)) {
          onChanged?.();
          return;
        }
        api.quoting.prepareCommercialQuestionnaire(session.id);
        onChanged?.();
      } catch (error) {
        onFailure?.(
          quoteWorkspaceFailure("AI mapping could not complete. Please try again.", error)
        );
      } finally {
        setBusy(null);
      }
      return;
    }
    if (isCommercialIncomplete) {
      saveCurrentResponses();
      onCommercialMissingFieldsRevealed?.(requiredMissing);
      setIncompleteWarningOpen(true);
      return;
    }
    if (personalRequiredMissing) {
      setPersonalManualQuestionnaireOpen(true);
      return;
    }
    continueCommercialSubmission();
  }

  return (
    <>
      <button
        type="button"
        className="btn-primary text-xs"
        onClick={() => {
          void preserveWindowScroll(next);
        }}
        disabled={nextDisabled}
        title="Next"
      >
        {busy === "next" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{busy === "next" ? "Working..." : "Next"}</span>
        {busy !== "next" && <ArrowRight className="h-3.5 w-3.5" />}
      </button>
      <CommercialCarrierSelectionModal
        open={carrierSelectOpen}
        session={session}
        responses={responses}
        onClose={() => setCarrierSelectOpen(false)}
        onConfirm={(selectedCarrierIds) => {
          setCarrierDeliveryError(null);
          const drafts = api.quoting.previewCommercialCarrierEmails(
            session.id,
            responses,
            "application",
            selectedCarrierIds
          );
          if (drafts.length > 0) {
            setCarrierSelectOpen(false);
            setCarrierDraftReview({
              kind: "application",
              selectedCarrierIds,
              drafts,
            });
            return;
          }
          void preserveWindowScroll(async () => {
            setBusy("next");
            try {
              const submitted = api.quoting.submitQuestionnaireResponses(session.id, responses, actor, {
                selectedCommercialCarrierIds: selectedCarrierIds,
                awaitLiveMailboxDelivery: true,
              });
              if (!submitted) throw new Error("The carrier email could not be prepared.");
              await deliverCommercialCarrierEmails({
                session: submitted,
                userId,
                kind: "application",
              });
              onChanged?.();
              setCarrierSelectOpen(false);
            } catch (error) {
              setCarrierDeliveryError(
                "The carrier email was not delivered. Check the connected mailbox and try again."
              );
              onFailure?.(
                quoteWorkspaceFailure("Carrier email could not be delivered.", error)
              );
            } finally {
              setBusy(null);
            }
          });
        }}
      />
      <CommercialEmailDraftReviewModal
        open={!!carrierDraftReview}
        kind={carrierDraftReview?.kind ?? "application"}
        tenantId={session.tenantId}
        uploadedById={session.createdById}
        drafts={carrierDraftReview?.drafts ?? []}
        busy={busy === "next"}
        deliveryError={carrierDeliveryError}
        onClose={() => {
          const shouldReturnToCarrierList =
            carrierDraftReview?.kind === "application" &&
            !!carrierDraftReview.selectedCarrierIds?.length;
          setCarrierDraftReview(null);
          if (shouldReturnToCarrierList) setCarrierSelectOpen(true);
        }}
        onChangeDraft={(index, patch) => {
          setCarrierDraftReview((current) =>
            current
              ? {
                  ...current,
                  drafts: current.drafts.map((draft, draftIndex) =>
                    draftIndex === index ? { ...draft, ...patch } : draft
                  ),
                }
              : current
          );
        }}
        onSubmit={() => {
          if (!carrierDraftReview) return;
          setCarrierDeliveryError(null);
          void preserveWindowScroll(async () => {
            setBusy("next");
            try {
              const submitted = api.quoting.submitQuestionnaireResponses(session.id, responses, actor, {
                selectedCommercialCarrierIds: carrierDraftReview.selectedCarrierIds,
                commercialCarrierEmailDrafts: carrierDraftReview.drafts,
                awaitLiveMailboxDelivery: true,
              });
              if (!submitted) throw new Error("The carrier email could not be prepared.");
              await deliverCommercialCarrierEmails({
                session: submitted,
                userId,
                kind: carrierDraftReview.kind,
              });
              onChanged?.();
              setCarrierSelectOpen(false);
              setCarrierDraftReview(null);
            } catch (error) {
              setCarrierDeliveryError(
                "The carrier email was not delivered. Check the connected mailbox and try again."
              );
              onFailure?.(
                quoteWorkspaceFailure("Carrier email could not be delivered.", error)
              );
            } finally {
              setBusy(null);
            }
          });
        }}
      />
      <IncompleteCommercialWarningModal
        open={incompleteWarningOpen}
        title={
          commercialApplicationSentAt(session)
            ? "Send incomplete supplemental?"
            : "Send incomplete application?"
        }
        missingQuestions={requiredMissing}
        onBack={() => setIncompleteWarningOpen(false)}
        onProceed={() => {
          setIncompleteWarningOpen(false);
          continueCommercialSubmission();
        }}
      />
      {session.lineOfBusiness !== "commercial" && (
        <ManualQuestionnaireModal
          open={personalManualQuestionnaireOpen}
          session={session}
          userId={userId}
          onClose={() => setPersonalManualQuestionnaireOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function ManualQuestionnaireModal({
  open,
  session,
  userId,
  onClose,
  onChanged,
}: {
  open: boolean;
  session: QuotingSession;
  userId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const questions = visibleQuestionnaireQuestions(session);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | "save" | "submit">(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [incompleteWarningOpen, setIncompleteWarningOpen] = useState(false);
  const [incompleteFieldsRevealed, setIncompleteFieldsRevealed] = useState(false);
  const [carrierSelectOpen, setCarrierSelectOpen] = useState(false);
  const [carrierDraftReview, setCarrierDraftReview] = useState<{
    kind: "application" | "supplemental";
    selectedCarrierIds?: string[];
    drafts: CommercialEmailDraft[];
  } | null>(null);
  const [carrierDeliveryError, setCarrierDeliveryError] = useState<string | null>(null);
  const editor = api.users.get(userId);
  const actor = {
    id: userId,
    name: editor?.name ?? "Agency team",
    role: editor?.role === "manager" ? "manager" : "agent",
  } as const;

  useEffect(() => {
    if (!open) return;
    setResponses(session.questionnaireResponses ?? {});
    setDraftDirty(false);
  }, [open, session.id, session.updatedAt]);

  useEffect(() => {
    if (!open) return;
    setSavedAt(null);
    setDraftDirty(false);
    setIncompleteWarningOpen(false);
    setIncompleteFieldsRevealed(false);
  }, [open, session.id]);

  const sections = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    questions.forEach((q) => {
      const bucket = map.get(q.section) ?? [];
      bucket.push(q);
      map.set(q.section, bucket);
    });
    return Array.from(map.entries());
  }, [questions]);

  const answeredCount = Object.values(responses).filter((v) => v.trim()).length;
  const requiredMissing = questions.filter(
    (q) => q.required && !(responses[q.id] ?? "").trim()
  );
  const missingQuestionIds = new Set(requiredMissing.map((question) => question.id));
  const isCommercialIncomplete =
    session.lineOfBusiness === "commercial" && requiredMissing.length > 0;
  const showMissingFieldHighlights = requiredMissing.length > 0;
  const showIncompleteFieldWarnings = incompleteFieldsRevealed && isCommercialIncomplete;
  const saveDraftLabel =
    busy === "save" ? "Saving..." : savedAt && !draftDirty ? "Saved" : "Save draft";

  function setAnswer(question: QuotingQuestion, value: string) {
    setResponses((current) => ({
      ...current,
      [question.id]: normalizeVinFieldValue(
        { id: question.id, label: question.label },
        value
      ),
    }));
    setDraftDirty(true);
    setSavedAt(null);
  }

  function saveDraft() {
    setBusy("save");
    try {
      const updated = api.quoting.saveQuestionnaireResponses(session.id, responses, actor);
      if (updated) setResponses(updated.questionnaireResponses ?? responses);
      setSavedAt(updated?.updatedAt ?? new Date().toISOString());
      setDraftDirty(false);
      onChanged?.();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  function saveCurrentResponses() {
    const updated = api.quoting.saveQuestionnaireResponses(session.id, responses, actor);
    if (updated) setResponses(updated.questionnaireResponses ?? responses);
    setSavedAt(updated?.updatedAt ?? new Date().toISOString());
    setDraftDirty(false);
    onChanged?.();
  }

  function continueCommercialSubmission() {
    if (session.lineOfBusiness === "commercial" && !commercialApplicationSentAt(session)) {
      saveCurrentResponses();
      setCarrierSelectOpen(true);
      return;
    }
    if (session.lineOfBusiness === "commercial") {
      const drafts = api.quoting.previewCommercialCarrierEmails(
        session.id,
        responses,
        "supplemental"
      );
      if (drafts.length > 0) {
        setCarrierDraftReview({ kind: "supplemental", drafts });
        return;
      }
    }
    setBusy("submit");
    try {
      api.quoting.submitQuestionnaireResponses(session.id, responses, actor);
      onChanged?.();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  function submitManual() {
    if (requiredMissing.length > 0) {
      if (session.lineOfBusiness === "commercial") {
        saveCurrentResponses();
        setIncompleteFieldsRevealed(true);
        setIncompleteWarningOpen(true);
      }
      return;
    }
    continueCommercialSubmission();
  }

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title="Fill questionnaire manually"
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <button type="button" className="btn-ghost text-sm" onClick={onClose}>
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={saveDraft}
              disabled={!!busy}
            >
              {busy === "save" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saveDraftLabel}
            </button>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={submitManual}
              disabled={!!busy || (session.lineOfBusiness !== "commercial" && requiredMissing.length > 0)}
            >
              {busy === "submit" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {busy === "submit"
                ? "Submitting..."
                : session.lineOfBusiness === "commercial" && !commercialApplicationSentAt(session)
                ? "Review carrier send list"
                : session.lineOfBusiness === "commercial"
                ? "View email draft"
                : "Submit to AI workflow"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge tone={session.lineOfBusiness === "commercial" ? "gold" : "info"}>
              {session.lineOfBusiness === "commercial" ? "Commercial" : "Personal"}
            </Badge>
            <Badge tone={requiredMissing.length === 0 ? "success" : "warn"}>
              {requiredMissing.length === 0
                ? "Ready to submit"
                : session.lineOfBusiness === "commercial"
                ? `${requiredMissing.length} missing`
                : `${requiredMissing.length} required left`}
            </Badge>
            {savedAt && <Badge tone="success">Saved {fmt.dateTime(savedAt)}</Badge>}
            <Badge tone="info">Shared live draft</Badge>
          </div>
          <div className="text-ink-500">
            {answeredCount} of {questions.length} answered
          </div>
        </div>
        {showIncompleteFieldWarnings && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Some required commercial fields are still blank.
            </div>
            <p className="mt-1">Missing fields are highlighted below.</p>
          </div>
        )}

        <div className="space-y-4">
          {sections.map(([sectionName, sectionQuestions]) => (
            <div key={sectionName} className="rounded-md border border-ink-100 bg-white p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <h4 className="text-sm font-semibold text-ink-900">{sectionName}</h4>
                <Badge tone="neutral">
                  {sectionQuestions.length} question{sectionQuestions.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <div className="grid gap-3">
                {sectionQuestions.map((q) => {
                  const isMissing = showMissingFieldHighlights && missingQuestionIds.has(q.id);
                  const fieldClass = `input text-sm ${
                    isMissing ? "border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-200" : ""
                  }`;
                  return (
                  <div
                    key={q.id}
                    className={
                      isMissing
                        ? "rounded-md border border-amber-300 bg-amber-50/70 p-3"
                        : undefined
                    }
                  >
                    <label className="label">
                      {q.label}
                      {q.required && <span className="ml-1 text-rose-600">*</span>}
                    </label>
                    {q.kind === "textarea" ? (
                      <textarea
                        className={`${fieldClass} min-h-[82px]`}
                        value={responses[q.id] ?? ""}
                        onChange={(e) => setAnswer(q, e.target.value)}
                      />
                    ) : q.kind === "select" ? (
                      <select
                        className={fieldClass}
                        value={responses[q.id] ?? ""}
                        onChange={(e) => setAnswer(q, e.target.value)}
                      >
                        <option value="">Pick one</option>
                        {(q.options ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={q.kind === "number" ? "number" : "text"}
                        className={fieldClass}
                        value={responses[q.id] ?? ""}
                        onChange={(e) => setAnswer(q, e.target.value)}
                        autoCapitalize={isVinInputField({ id: q.id, label: q.label }) ? "characters" : undefined}
                        spellCheck={isVinInputField({ id: q.id, label: q.label }) ? false : undefined}
                      />
                    )}
                    {isMissing && (
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-900">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Missing required field.
                      </div>
                    )}
                    <QuestionEditMeta
                      meta={session.questionnaireResponseMeta?.[q.id]}
                      needsManual={q.required && !(responses[q.id] ?? "").trim()}
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

      </div>
    </Modal>
    <CommercialCarrierSelectionModal
      open={carrierSelectOpen}
      session={session}
      responses={responses}
      onClose={() => setCarrierSelectOpen(false)}
      onConfirm={(selectedCarrierIds) => {
        setCarrierDeliveryError(null);
        const drafts = api.quoting.previewCommercialCarrierEmails(
          session.id,
          responses,
          "application",
          selectedCarrierIds
          );
          if (drafts.length > 0) {
            setCarrierSelectOpen(false);
            setCarrierDraftReview({
              kind: "application",
              selectedCarrierIds,
              drafts,
            });
          return;
        }
        void preserveWindowScroll(async () => {
          setBusy("submit");
          try {
            const submitted = api.quoting.submitQuestionnaireResponses(session.id, responses, actor, {
              selectedCommercialCarrierIds: selectedCarrierIds,
              awaitLiveMailboxDelivery: true,
            });
            if (!submitted) throw new Error("The carrier email could not be prepared.");
            await deliverCommercialCarrierEmails({
              session: submitted,
              userId,
              kind: "application",
            });
            onChanged?.();
            setCarrierSelectOpen(false);
            onClose();
          } catch {
            setCarrierDeliveryError(
              "The carrier email was not delivered. Check the connected mailbox and try again."
            );
          } finally {
            setBusy(null);
          }
        });
      }}
    />
    <CommercialEmailDraftReviewModal
      open={!!carrierDraftReview}
      kind={carrierDraftReview?.kind ?? "application"}
      tenantId={session.tenantId}
      uploadedById={session.createdById}
      drafts={carrierDraftReview?.drafts ?? []}
      busy={busy === "submit"}
      deliveryError={carrierDeliveryError}
      onClose={() => {
        const shouldReturnToCarrierList =
          carrierDraftReview?.kind === "application" &&
          !!carrierDraftReview.selectedCarrierIds?.length;
        setCarrierDraftReview(null);
        if (shouldReturnToCarrierList) setCarrierSelectOpen(true);
      }}
      onChangeDraft={(index, patch) => {
        setCarrierDraftReview((current) =>
          current
            ? {
                ...current,
                drafts: current.drafts.map((draft, draftIndex) =>
                  draftIndex === index ? { ...draft, ...patch } : draft
                ),
              }
            : current
        );
      }}
      onSubmit={() => {
        if (!carrierDraftReview) return;
        setCarrierDeliveryError(null);
        void preserveWindowScroll(async () => {
          setBusy("submit");
          try {
            const submitted = api.quoting.submitQuestionnaireResponses(session.id, responses, actor, {
              selectedCommercialCarrierIds: carrierDraftReview.selectedCarrierIds,
              commercialCarrierEmailDrafts: carrierDraftReview.drafts,
              awaitLiveMailboxDelivery: true,
            });
            if (!submitted) throw new Error("The carrier email could not be prepared.");
            await deliverCommercialCarrierEmails({
              session: submitted,
              userId,
              kind: carrierDraftReview.kind,
            });
            onChanged?.();
            setCarrierSelectOpen(false);
            setCarrierDraftReview(null);
            onClose();
          } catch {
            setCarrierDeliveryError(
              "The carrier email was not delivered. Check the connected mailbox and try again."
            );
          } finally {
            setBusy(null);
          }
        });
      }}
    />
    <IncompleteCommercialWarningModal
      open={incompleteWarningOpen}
      title={
        commercialApplicationSentAt(session)
          ? "Send incomplete supplemental?"
          : "Send incomplete application?"
      }
      missingQuestions={requiredMissing}
      onBack={() => setIncompleteWarningOpen(false)}
      onProceed={() => {
        setIncompleteWarningOpen(false);
        continueCommercialSubmission();
      }}
    />
    </>
  );
}

type CommercialEmailDraft = ReturnType<
  typeof api.quoting.previewCommercialCarrierEmails
>[number];

function emailDraftAttachmentPreviewDocument(
  attachment: CommunicationAttachment,
  context: {
    tenantId: string;
    uploadedById?: string;
    uploadedAt: string;
    completedKind?: "application" | "supplemental";
  }
): Document {
  const linkedDocument = attachment.documentId
    ? api.documents.get(attachment.documentId)
    : undefined;
  const isCompletedAcord = Boolean(attachment.sourceDocumentId && attachment.filledFields);
  if (linkedDocument && (!isCompletedAcord || String(linkedDocument.type).startsWith("completed_acord"))) {
    return linkedDocument;
  }

  const sourceDocument = attachment.sourceDocumentId
    ? api.documents.get(attachment.sourceDocumentId)
    : undefined;
  const type = isCompletedAcord
    ? context.completedKind === "supplemental"
      ? "completed_acord_supplemental"
      : "completed_acord_application"
    : "email_attachment";

  return {
    id: attachment.documentId ?? `draft_attachment_${attachment.id}`,
    tenantId: context.tenantId,
    uploadedById: context.uploadedById ?? "system",
    fileName: attachment.fileName,
    fileType: attachment.fileType || sourceDocument?.fileType || "application/pdf",
    documentName:
      attachment.description ??
      (isCompletedAcord
        ? `Completed ${sourceDocument?.documentName ?? sourceDocument?.fileName ?? "ACORD attachment"}`
        : "Email attachment"),
    templateFields: {
      ...(!isCompletedAcord
        ? {
            "Email attachment": attachment.fileName,
            ...(attachment.description ? { Description: attachment.description } : {}),
          }
        : {}),
      ...(typeof attachment.filledFieldCount === "number"
        ? { "Mapped field count": String(attachment.filledFieldCount) }
        : {}),
      ...(attachment.filledFields ?? {}),
    },
    templateFieldLayout: linkedDocument?.templateFieldLayout ?? sourceDocument?.templateFieldLayout,
    fillableDetection: linkedDocument?.fillableDetection ?? sourceDocument?.fillableDetection,
    type,
    visibility: "employee_only",
    status: "approved",
    storagePath:
      attachment.storagePath ??
      sourceDocument?.storagePath ??
      `draft://email-attachments/${context.tenantId}/${attachment.id}/${attachment.fileName}`,
    downloadUrl: attachment.dataUrl ?? linkedDocument?.downloadUrl ?? sourceDocument?.downloadUrl,
    uploadedAt: context.uploadedAt,
    lastChangeAction: "uploaded",
    lastChangeAt: context.uploadedAt,
  };
}

function IncompleteCommercialWarningModal({
  open,
  title,
  missingQuestions,
  onBack,
  onProceed,
}: {
  open: boolean;
  title: string;
  missingQuestions: QuotingQuestion[];
  onBack: () => void;
  onProceed: () => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, QuotingQuestion[]>();
    missingQuestions.forEach((question) => {
      const bucket = map.get(question.section) ?? [];
      bucket.push(question);
      map.set(question.section, bucket);
    });
    return Array.from(map.entries());
  }, [missingQuestions]);

  return (
    <Modal open={open} onClose={onBack} title={title} size="lg" closeIcon="back">
      <div className="space-y-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950">
          <div className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Some required fields are still blank. Are you sure you want to proceed?
            </span>
          </div>
        </div>

        <div className="max-h-[280px] space-y-3 overflow-y-auto pr-1">
          {grouped.map(([section, questions]) => (
            <div key={section} className="rounded-md border border-ink-100 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                {section}
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-800">
                {questions.map((question) => (
                  <li key={question.id}>{question.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Go back and fill fields
          </button>
          <button type="button" className="btn-primary text-sm" onClick={onProceed}>
            <Send className="h-3.5 w-3.5" />
            Proceed anyway
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CommercialCarrierSelectionModal({
  open,
  session,
  responses,
  onClose,
  onConfirm,
}: {
  open: boolean;
  session: QuotingSession;
  responses: Record<string, string>;
  onClose: () => void;
  onConfirm: (selectedCarrierIds: string[]) => void;
}) {
  const responseKey = JSON.stringify(responses);
  const recommendations = useMemo(
    () =>
      api.quoting
        .recommendCommercialCarriers(session.id, responses)
        .filter(
          (row) =>
            !row.disabledReason &&
            (row.automationAvailable ||
              row.underwriterContacts.some((contact) => !!contact.email))
        ),
    [session.id, session.updatedAt, responseKey]
  );
  const readyCarrierIds = recommendations
    .map((row) => row.carrierId);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setSelected(readyCarrierIds);
  }, [open, readyCarrierIds.join("|")]);

  const selectedSet = new Set(selected);
  const allReadySelected =
    readyCarrierIds.length > 0 &&
    readyCarrierIds.every((carrierId) => selectedSet.has(carrierId));
  const selectedRecommendations = recommendations.filter((row) =>
    selectedSet.has(row.carrierId)
  );
  const underwriterCount = selectedRecommendations.reduce(
    (sum, row) => sum + row.underwriterContacts.length,
    0
  );
  const automationCount = selectedRecommendations.filter((row) => row.automationAvailable).length;

  function toggleCarrier(row: CommercialCarrierRecommendation) {
    setSelected((current) =>
      current.includes(row.carrierId)
        ? current.filter((carrierId) => carrierId !== row.carrierId)
        : [...current, row.carrierId]
    );
  }

  function toggleAll() {
    setSelected(allReadySelected ? [] : readyCarrierIds);
  }

  return (
    <Modal open={open} onClose={onClose} title="Send commercial application to carriers" size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-ink-100 bg-white p-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-900">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300 accent-gold-600"
              checked={allReadySelected}
              onChange={toggleAll}
              disabled={readyCarrierIds.length === 0}
            />
            Select all that apply
          </label>
          <div className="text-xs text-ink-500">
            {selected.length} carrier{selected.length === 1 ? "" : "s"} - {underwriterCount} email
            {underwriterCount === 1 ? "" : "s"} / {automationCount} portal runner
            {automationCount === 1 ? "" : "s"}
          </div>
        </div>

        <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
          {recommendations.length === 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              No send-ready carriers on file.
            </div>
          ) : (
            recommendations.map((row) => {
              const checked = selectedSet.has(row.carrierId);
              return (
                <button
                  key={row.carrierId}
                  type="button"
                  className={`w-full rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 ${
                    checked
                      ? "border-gold-400 bg-gold-50"
                      : "border-ink-100 bg-white hover:border-gold-300"
                  }`}
                  onClick={() => toggleCarrier(row)}
                >
                  <div className="grid gap-3 md:grid-cols-[44px_minmax(0,1fr)_120px]">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-ink-300 accent-gold-600"
                        checked={checked}
                        onChange={() => toggleCarrier(row)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-xs font-semibold text-white">
                        {row.rank}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-sm font-semibold text-ink-900">{row.carrierName}</div>
                        {row.hasCommercialAppetite && <Badge tone="success">Commercial appetite</Badge>}
                        {row.commercialDocumentCount > 0 && (
                          <Badge tone="info">
                            {row.commercialDocumentCount} doc{row.commercialDocumentCount === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {row.underwriterContacts.some((contact) => !!contact.email) && (
                          <Badge tone="gold">Underwriter email ready</Badge>
                        )}
                        {row.automationAvailable && (
                          <Badge tone="info">{row.connectorLabel ?? "AI portal runner ready"}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-600">{row.aiRationale}</p>
                      <p className="mt-1 text-[11px] text-ink-500">{row.fitReason}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {row.underwriterContacts.map((contact) => (
                          <span
                            key={contact.id}
                            className="rounded-full border border-ink-100 bg-white px-2 py-0.5 text-[11px] text-ink-600"
                          >
                            {contact.name} - {contact.email}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-ink-500">Match</div>
                      <div className="mt-1 flex justify-end">
                        <QuoteMatchBadge score={row.score} />
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            <Send className="h-3.5 w-3.5" />
            {underwriterCount > 0 ? "View email draft" : "Send selected carriers"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CommercialEmailDraftReviewModal({
  open,
  kind,
  tenantId,
  uploadedById,
  drafts,
  busy,
  deliveryError,
  onClose,
  onChangeDraft,
  onSubmit,
}: {
  open: boolean;
  kind: "application" | "supplemental";
  tenantId: string;
  uploadedById?: string;
  drafts: CommercialEmailDraft[];
  busy: boolean;
  deliveryError?: string | null;
  onClose: () => void;
  onChangeDraft: (
    index: number,
    patch: Partial<Pick<CommercialEmailDraft, "subject" | "body" | "attachments">>
  ) => void;
  onSubmit: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [attaching, setAttaching] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open, drafts.length]);

  useEffect(() => {
    if (!open) setPreviewDocument(null);
  }, [open]);

  const activeDraft = drafts[activeIndex] ?? drafts[0];
  const previewUploadedAt = useMemo(() => new Date().toISOString(), [open]);
  const title =
    kind === "application"
      ? "Review carrier application email"
      : "Review carrier supplemental email";
  const submitLabel =
    kind === "application" ? "Send to selected carriers" : "Send supplemental package";

  async function handleFiles(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0 || !activeDraft) return;
    setAttaching(true);
    try {
      const added: CommunicationAttachment[] = (await Promise.all(picked.map(fileToCommunicationAttachment))).map(
        (attachment) => ({
          ...attachment,
          id: `manual_${attachment.id}`,
          description: attachment.description ?? "Manually added carrier email attachment",
        })
      );
      onChangeDraft(activeIndex, {
        attachments: [...(activeDraft.attachments ?? []), ...added],
      });
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeManualAttachment(attachmentId: string) {
    if (!activeDraft) return;
    onChangeDraft(activeIndex, {
      attachments: (activeDraft.attachments ?? []).filter(
        (attachment) => attachment.id !== attachmentId
      ),
    });
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={title} size="xl">
        <div className="space-y-4">
        {drafts.length === 0 || !activeDraft ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No carrier underwriter email draft is available.
          </div>
        ) : (
          <div className="grid items-stretch gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex h-full min-h-0 flex-col space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Recipients
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {drafts.map((draft, index) => (
                  <button
                    key={`${draft.carrierId}-${draft.underwriterContactId}`}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      index === activeIndex
                        ? "border-gold-400 bg-gold-50"
                        : "border-ink-100 bg-white hover:border-gold-300"
                    }`}
                    onClick={() => setActiveIndex(index)}
                  >
                    <div className="text-sm font-semibold text-ink-900">{draft.carrierName}</div>
                    <div className="mt-0.5 text-xs text-ink-600">{draft.underwriterName}</div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">
                      {draft.underwriterEmail}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">To</label>
                <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700">
                  {activeDraft.underwriterName} · {activeDraft.underwriterEmail}
                </div>
              </div>
              <div>
                <label className="label">Subject</label>
                <input
                  className="input text-sm"
                  value={activeDraft.subject}
                  onChange={(event) =>
                    onChangeDraft(activeIndex, { subject: event.target.value })
                  }
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="label mb-0">Attachments</label>
                  <button
                    type="button"
                    className="btn-outline text-[11px] !px-2.5 !py-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={busy || attaching}
                    title="Add an attachment from your computer"
                  >
                    {attaching ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    <Paperclip className="h-3.5 w-3.5" />
                    Add attachment
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                  />
                </div>
                <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
                  {(activeDraft.attachments ?? []).length === 0 ? (
                    <div className="text-xs text-ink-500">No ACORD PDFs attached.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {activeDraft.attachments.map((attachment) => (
                        <span
                          key={attachment.id}
                          className="inline-flex max-w-full items-center gap-1 rounded-full border border-gold-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gold-900"
                          title={attachment.description}
                        >
                          <button
                            type="button"
                            className="inline-flex min-w-0 items-center gap-1 text-left hover:text-black"
                            onClick={() =>
                              setPreviewDocument(
                                emailDraftAttachmentPreviewDocument(attachment, {
                                  tenantId,
                                  uploadedById,
                                  uploadedAt: previewUploadedAt,
                                  completedKind: kind,
                                })
                              )
                            }
                            title={`Preview ${attachment.fileName}`}
                          >
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="truncate">{attachment.fileName}</span>
                            {typeof attachment.filledFieldCount === "number" && (
                              <span className="shrink-0 text-[10px] text-ink-500">
                                {attachment.filledFieldCount} mapped
                              </span>
                            )}
                            {attachment.sizeBytes ? (
                              <span className="shrink-0 text-[10px] text-ink-500">
                                {formatAttachmentSize(attachment.sizeBytes)}
                              </span>
                            ) : null}
                          </button>
                          {attachment.id.startsWith("manual_") && (
                            <button
                              type="button"
                              className="shrink-0 text-ink-400 hover:text-rose-600"
                              onClick={() => removeManualAttachment(attachment.id)}
                              title={`Remove ${attachment.fileName}`}
                              aria-label={`Remove ${attachment.fileName}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="label">Email body</label>
                <textarea
                  className="input h-[300px] min-h-[300px] resize-y text-sm leading-6"
                  value={activeDraft.body}
                  onChange={(event) =>
                    onChangeDraft(activeIndex, { body: event.target.value })
                  }
                />
              </div>
            </div>
          </div>
        )}

        {deliveryError && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
          >
            {deliveryError}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || drafts.length === 0}
            onClick={onSubmit}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {busy ? "Sending..." : submitLabel}
          </button>
        </div>
      </div>
      </Modal>
      <DocumentViewerModal
        document={previewDocument}
        open={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </>
  );
}

function CommercialFlowPanel({
  session,
  questionnaireCard,
  userId,
  onChanged,
  highlightMissingQuestions = [],
  mappingProgress,
  steps,
}: {
  session: QuotingSession;
  questionnaireCard?: ReactNode;
  userId: string;
  onChanged?: () => void;
  highlightMissingQuestions?: QuotingQuestion[];
  mappingProgress?: AiMappingProgress | null;
  steps: WorkflowStepDefinition[];
}) {
  const [checkingResponses, setCheckingResponses] = useState(false);
  const [responseCheckCoolingDown, setResponseCheckCoolingDown] = useState(false);
  const [lastResponseCheckAt, setLastResponseCheckAt] = useState<string | null>(null);
  const [responseCheckNotice, setResponseCheckNotice] = useState<{
    tone: "success" | "neutral" | "warn";
    message: string;
  } | null>(null);
  const responseCheckCooldownTimer = useRef<number | null>(null);
  const submissions = session.commercialCarrierSubmissions ?? [];
  const applicationSentAt = commercialApplicationSentAt(session);
  const accepted = submissions.filter(
    (s) => s.status === "accepted" || s.status === "supplemental_sent"
  );
  const waitingForClient = submissions.filter((s) => s.status === "needs_client_info");
  const agentReview = submissions.filter((s) => s.status === "agent_review");
  const awaitingResponse = submissions.filter(
    (s) => s.status === "awaiting_response" || s.status === "application_sent"
  );

  useEffect(
    () => () => {
      if (responseCheckCooldownTimer.current !== null) {
        window.clearTimeout(responseCheckCooldownTimer.current);
      }
    },
    []
  );

  async function checkForCarrierResponses() {
    if (checkingResponses || responseCheckCoolingDown) return;
    const user = api.users.get(userId);
    if (!user) {
      setResponseCheckNotice({
        tone: "warn",
        message: "Sign in again before checking the connected mailbox.",
      });
      return;
    }

    const responseCount = (candidate: QuotingSession | undefined) =>
      (candidate?.commercialCarrierSubmissions ?? []).filter(
        (submission) =>
          !!submission.responseAt ||
          submission.status === "accepted" ||
          submission.status === "declined" ||
          submission.status === "needs_supplemental" ||
          submission.status === "needs_client_info" ||
          submission.status === "agent_review"
      ).length;
    const responsesBefore = responseCount(api.quoting.get(session.id) ?? session);

    setCheckingResponses(true);
    setResponseCheckNotice(null);
    try {
      // QuoteX communications are the source of truth. External mailbox sync is
      // an optional enhancement and must never block the carrier workflow.
      await api.quoting.readCommercialCarrierResponses(session.id);

      try {
        const capability = await getLiveMailboxCapability({
          tenantId: session.tenantId,
          user,
          refresh: true,
        });
        if (capability?.mailboxConnected) {
          const sync = await syncCommunicationsFromLiveMailbox({
            tenantId: session.tenantId,
            user,
            maxResults: 50,
          });
          if (sync.ok) {
            await api.quoting.readCommercialCarrierResponses(session.id);
          }
        }
      } catch {
        // The managed QuoteX check above is still complete when a provider is
        // unavailable or has not been connected for read access.
      }

      const responsesAfter = responseCount(api.quoting.get(session.id));
      const newlyMatched = Math.max(0, responsesAfter - responsesBefore);
      setLastResponseCheckAt(new Date().toISOString());
      setResponseCheckNotice(
        newlyMatched > 0
          ? {
              tone: "success",
              message: `${newlyMatched} new carrier response${newlyMatched === 1 ? " was" : "s were"} verified and added.`,
            }
          : {
              tone: "neutral",
              message: "QuoteX responses checked. No new verified carrier responses were found.",
            }
      );
      onChanged?.();
    } finally {
      setCheckingResponses(false);
      setResponseCheckCoolingDown(true);
      responseCheckCooldownTimer.current = window.setTimeout(() => {
        setResponseCheckCoolingDown(false);
        responseCheckCooldownTimer.current = null;
      }, 8_000);
    }
  }

  const page = commercialFlowPage(session);
  const carrierAutomation = submissions.length > 0 && (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold flex items-center gap-1.5">
          <Building2 className="h-3 w-3" /> Commercial carrier automation
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {applicationSentAt && (
            <Badge tone="info">Applications sent {fmt.dateTime(applicationSentAt)}</Badge>
          )}
          {applicationSentAt && (
            <button
              type="button"
              className="btn-outline inline-flex items-center gap-1.5 text-xs"
              onClick={() => void checkForCarrierResponses()}
              disabled={checkingResponses || responseCheckCoolingDown}
              title="Check QuoteX for verified carrier replies"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingResponses ? "animate-spin" : ""}`} />
              {checkingResponses ? "Checking..." : "Check for responses"}
            </button>
          )}
          {session.commercialSecondRoundSentAt && session.status !== "complete" && (
            <Badge tone="warn">Second round sent</Badge>
          )}
          {session.commercialSupplementalsCompletedAt && (
            <Badge tone="success">Supplementals complete</Badge>
          )}
        </div>
      </div>

      {(lastResponseCheckAt || responseCheckNotice) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
            responseCheckNotice?.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : responseCheckNotice?.tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-ink-100 bg-white text-ink-700"
          }`}
          aria-live="polite"
        >
          <span>{responseCheckNotice?.message ?? "Mailbox checked."}</span>
          {lastResponseCheckAt && (
            <span className="shrink-0 text-ink-500">
              Last checked {fmt.dateTime(lastResponseCheckAt)}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label="Sent" value={submissions.length} />
        <Metric label="Awaiting" value={awaitingResponse.length} />
        <Metric label="Accepted" value={accepted.length} />
        <Metric label={agentReview.length > 0 ? "Review" : "Needs client"} value={agentReview.length > 0 ? agentReview.length : waitingForClient.length} />
      </div>

      <ol className="space-y-2">
        {submissions.map((submission) => {
          const carrier = api.carriers.get(submission.carrierId);
          const badge = commercialSubmissionBadge(submission.status);
          const supplementalAudits = (submission.supplementalDocumentIds ?? [])
            .map((documentId) => api.documents.get(documentId))
            .filter(Boolean);
          return (
            <li
              key={submission.carrierId}
              className="rounded-md border border-ink-100 bg-white p-3 text-xs"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink-900">
                    {carrier?.name ?? "Unknown carrier"}
                  </div>
                  <div className="mt-0.5 text-ink-500">{submission.fitReason}</div>
                  {submission.connectorLabel && (
                    <div className="mt-1 text-[11px] font-medium text-violet-800">
                      {submission.connectorLabel}
                      {submission.automationJobId ? ` - ${submission.automationJobId}` : ""}
                    </div>
                  )}
                </div>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
              <p className="mt-2 text-ink-700">{submission.aiRationale}</p>
              {submission.agentReviewReason && (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
                  {submission.agentReviewReason}
                </p>
              )}
              {submission.quote?.premiums?.length ? (
                <p className="mt-2 text-ink-700">
                  Premium captured: {submission.quote.premiums.join(", ")}
                </p>
              ) : null}
              {submission.responseDeadline && (
                <p className="mt-2 font-medium text-amber-900">
                  Carrier response due {fmt.date(submission.responseDeadline)}
                </p>
              )}
              {(submission.quote?.evidenceSnippets ?? []).length > 0 && (
                <div className="mt-2 text-ink-600">
                  <span className="font-semibold text-ink-800">Reply evidence:</span>{" "}
                  {(submission.quote?.evidenceSnippets ?? []).slice(0, 3).join(" ")}
                  {typeof submission.parseConfidence === "number"
                    ? ` (${Math.round(submission.parseConfidence * 100)}% confidence)`
                    : ""}
                </div>
              )}
              {supplementalAudits.length > 0 && (
                <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-950">
                  <div className="font-semibold">Staged document fill audit</div>
                  {supplementalAudits.map((document) => (
                    <div key={document!.id} className="mt-1">
                      {document!.fileName}: {document!.templateFields?.["Filled field count"] ?? "Generated"} filled, {document!.templateFields?.["Remaining blank field count"] ?? "0"} remaining
                      {document!.templateFields?.["Value sources"]
                        ? ` - ${document!.templateFields!["Value sources"]}`
                        : ""}
                    </div>
                  ))}
                </div>
              )}
              {(submission.missingFields ?? []).length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-amber-800">
                  {submission.missingFields!.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <div className="rounded-md border border-violet-100 bg-violet-50/40 p-3 space-y-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold">
              {page.eyebrow}
            </div>
            <h3 className="mt-1 text-base font-semibold text-ink-950">{page.title}</h3>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <WorkflowStepIcons
            steps={steps}
            currentStep={page.step}
            totalSteps={page.total}
            completedStepNumbers={workflowCompletedStepNumbers(session)}
          />
          <Badge tone="info">
            Step {page.step} of {page.total}
          </Badge>
        </div>
      </div>

      {page.key === "ai_mapping" && <AiMappingProgressPanel progress={mappingProgress ?? null} />}

      {highlightMissingQuestions.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {highlightMissingQuestions.length} required field
          {highlightMissingQuestions.length === 1 ? "" : "s"} missing.
        </div>
      )}

      {page.key === "ai_mapping" && (
        <>
          <PublicFields session={session} />
          <CommercialAcordSummary
            session={session}
            highlightMissingQuestions={highlightMissingQuestions}
          />
          <CommercialAiFillAudit session={session} />
        </>
      )}

      {page.key === "field_review" && (
        <>
          <CommercialAcordSummary
            session={session}
            highlightMissingQuestions={highlightMissingQuestions}
          />
          <CommercialAiFillAudit session={session} />
          {questionnaireCard}
        </>
      )}

      {page.key === "carrier_submissions" && carrierAutomation}

      {page.key === "supplemental_round" && (
        <>
          {highlightMissingQuestions.length > 0 && (
            <CommercialAcordSummary
              session={session}
              highlightMissingQuestions={highlightMissingQuestions}
            />
          )}
          {questionnaireCard}
          {carrierAutomation}
        </>
      )}

      {page.key === "accepted_ranking" && (
        <>
          {carrierAutomation}
          <QuotesTable session={session} userId={userId} onChanged={onChanged} />
        </>
      )}

      {page.key === "carrier_review" && carrierAutomation}
    </div>
  );
}

function personalFlowPage(session: QuotingSession): {
  key: "ai_mapping" | "questionnaire" | "carrier_ranking";
  step: number;
  total: number;
  eyebrow: string;
  title: string;
} {
  const total = PERSONAL_WORKFLOW_STEPS.length;
  if (session.status === "complete") {
    return {
      key: "carrier_ranking",
      step: 4,
      total,
      eyebrow: "Carrier ranking",
      title: "Ranked quote options are ready",
    };
  }
  if (session.status === "quoting" || session.quotes.length > 0) {
    return {
      key: "carrier_ranking",
      step: 4,
      total,
      eyebrow: "Carrier ranking",
      title: "Run carrier ranking for the selected asset",
    };
  }
  if (
    session.status === "awaiting_reply" ||
    !!session.questionnaireSentAt ||
    !!session.personalQuestionnairePreparedAt
  ) {
    return {
      key: "questionnaire",
      step: 3,
      total,
      eyebrow: "Client questionnaire",
      title: "Review and send the personal-lines questionnaire",
    };
  }
  return {
    key: "ai_mapping",
    step: 2,
    total,
    eyebrow: "AI mapping",
    title: "Map known data for the selected asset",
  };
}

function PersonalFlowPanel({
  session,
  questionnaireCard,
  userId,
  onChanged,
  showQuoteRanking,
  mappingProgress,
  steps,
}: {
  session: QuotingSession;
  questionnaireCard?: ReactNode;
  userId: string;
  onChanged?: () => void;
  showQuoteRanking: boolean;
  mappingProgress?: AiMappingProgress | null;
  steps: WorkflowStepDefinition[];
}) {
  const page = personalFlowPage(session);

  return (
    <div className="rounded-md border border-violet-100 bg-violet-50/40 p-3 space-y-4">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold">
              {page.eyebrow}
            </div>
            <h3 className="mt-1 text-base font-semibold text-ink-950">{page.title}</h3>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <WorkflowStepIcons
            steps={steps}
            currentStep={page.step}
            totalSteps={page.total}
            completedStepNumbers={workflowCompletedStepNumbers(session)}
          />
          <Badge tone="info">
            Step {page.step} of {page.total}
          </Badge>
        </div>
      </div>

      {page.key === "ai_mapping" && <AiMappingProgressPanel progress={mappingProgress ?? null} />}

      <PublicFields session={session} />
      {page.key === "ai_mapping" && !mappingProgress && (
        <PersonalAiMappingSummary session={session} />
      )}
      {page.key === "questionnaire" && questionnaireCard}
      {page.key === "carrier_ranking" && showQuoteRanking && (
        <QuotesTable session={session} userId={userId} onChanged={onChanged} />
      )}
    </div>
  );
}

function PersonalAiMappingSummary({ session }: { session: QuotingSession }) {
  const questions = visibleQuestionnaireQuestions(session);
  const responses = session.questionnaireResponses ?? {};
  const mappedAnswerCount = aiMappedQuestionAnswerCount(session, questions);
  const requiredMissingCount = questions.filter(
    (question) => question.required && !(responses[question.id] ?? "").trim()
  ).length;
  const optionalCount = questions.filter((question) => !question.required).length;

  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold">
            Mapping status
          </div>
        </div>
        <Badge tone={requiredMissingCount > 0 ? "warn" : "success"}>
          {requiredMissingCount > 0 ? `${requiredMissingCount} required left` : "Ready for questionnaire"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Metric label="Mapped answers" value={mappedAnswerCount} />
        <Metric label="Questionnaire fields" value={questions.length} />
        <Metric label="Optional fields" value={optionalCount} />
      </div>
      {session.aiSummary && (
        <div className="mt-3 rounded-md border border-ink-100 bg-ink-50/60 px-3 py-2 text-xs text-ink-700">
          {session.aiSummary}
        </div>
      )}
    </div>
  );
}

function CommercialAiFillAudit({ session }: { session: QuotingSession }) {
  const templates = session.commercialAcordTemplates ?? [];
  if (templates.length === 0) return null;

  const responseCount = Object.keys(session.questionnaireResponses ?? {}).length;
  const responseMeta = Object.values(session.questionnaireResponseMeta ?? {});
  const agentAnswerCount = responseMeta.filter(
    (meta) => meta.updatedByRole === "agent" || meta.updatedByRole === "manager"
  ).length;
  const clientAnswerCount = responseMeta.filter((meta) => meta.updatedByRole === "customer").length;
  const filledFieldCount = templates.reduce(
    (sum, template) => sum + (template.autoFilledFieldCount ?? 0),
    0
  );
  const missingFieldCount = templates.reduce(
    (sum, template) => sum + (template.missingFieldCount ?? 0),
    0
  );
  const sourceFieldCounts = aggregateAcordSourceFieldCounts(templates);
  const sourceEntries = Object.entries(sourceFieldCounts).filter(([, count]) => count > 0);
  const sourceTypesUsed = Array.from(
    new Set(templates.flatMap((template) => template.sourcesUsed ?? []))
  );
  const sourceCount = Math.max(0, ...templates.map((template) => template.sourceCount ?? 0));
  const candidateCount = templates.reduce((sum, template) => sum + (template.candidateCount ?? 0), 0);
  const fittedPdfFieldCount = templates.reduce(
    (sum, template) => sum + (template.fittedFieldCount ?? 0),
    0
  );
  const overflowFieldCount = templates.reduce(
    (sum, template) => sum + (template.overflowFieldCount ?? 0),
    0
  );
  const carrierEmailCount = (session.commercialCarrierSubmissions ?? []).reduce(
    (sum, submission) =>
      sum +
      (submission.applicationMessageIds?.length ?? 0) +
      (submission.supplementalMessageIds?.length ?? 0),
    0
  );
  const completedDocumentIds = new Set(
    (session.commercialCarrierSubmissions ?? []).flatMap((submission) => [
      ...(submission.applicationDocumentIds ?? []),
      ...(submission.supplementalDocumentIds ?? []),
    ])
  );

  return (
    <div className="rounded-md border border-ink-100 bg-white p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-800 font-semibold">
            AI fill audit
          </div>
        </div>
        <Badge tone={missingFieldCount > 0 ? "warn" : "success"}>
          {missingFieldCount > 0 ? `${missingFieldCount} fields need review` : "Ready for carriers"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="ACORD forms" value={templates.length} />
        <Metric label="Mapped fields" value={filledFieldCount} />
        <Metric label="Still blank" value={missingFieldCount} />
        <Metric label="Saved answers" value={responseCount} />
        <Metric label="Carrier emails" value={carrierEmailCount} />
      </div>

      <div className="mt-3 grid gap-2 text-xs text-ink-700 md:grid-cols-3">
        <div className="rounded-md border border-ink-100 bg-ink-50/60 p-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            Source trail
          </div>
          <div className="mt-1 text-ink-600">
            {sourceTypesUsed.length > 0
              ? sourceTypesUsed.map(acordSourceLabel).join(", ")
              : "No mapped field source has been recorded yet."}
          </div>
        </div>
        <div className="rounded-md border border-ink-100 bg-ink-50/60 p-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <FileText className="h-3.5 w-3.5 text-gold-700" />
            Mapping discipline
          </div>
          <div className="mt-1 text-ink-600">
            {sourceCount} dossier source{sourceCount === 1 ? "" : "s"} produced {candidateCount} candidate
            value{candidateCount === 1 ? "" : "s"}. {fittedPdfFieldCount} field
            {fittedPdfFieldCount === 1 ? "" : "s"} were fitted into detected PDF boxes
            {overflowFieldCount > 0
              ? `; ${overflowFieldCount} overflow value${overflowFieldCount === 1 ? "" : "s"} moved into remarks`
              : ""}.
          </div>
        </div>
        <div className="rounded-md border border-ink-100 bg-ink-50/60 p-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <User className="h-3.5 w-3.5 text-violet-700" />
            Answer ownership
          </div>
          <div className="mt-1 text-ink-600">
            {agentAnswerCount} staff answer{agentAnswerCount === 1 ? "" : "s"} and {clientAnswerCount} client answer
            {clientAnswerCount === 1 ? "" : "s"} are recorded on fields.
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-ink-700 md:grid-cols-2">
        <div className="rounded-md border border-ink-100 bg-ink-50/60 p-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <FileCheck2 className="h-3.5 w-3.5 text-emerald-700" />
            Field source counts
          </div>
          {sourceEntries.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sourceEntries.map(([source, count]) => (
                <span
                  key={source}
                  className="rounded-full border border-ink-100 bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-700"
                >
                  {acordSourceLabel(source)}: {count}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-ink-600">No source-backed fields have been mapped yet.</div>
          )}
        </div>
        <div className="rounded-md border border-ink-100 bg-ink-50/60 p-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink-900">
            <FileText className="h-3.5 w-3.5 text-gold-700" />
            Completed PDFs
          </div>
          <div className="mt-1 text-ink-600">
            {completedDocumentIds.size || templates.length} ACORD packet file
            {(completedDocumentIds.size || templates.length) === 1 ? "" : "s"} ready to
            preview from messages and timeline-linked carrier emails.
          </div>
        </div>
      </div>
    </div>
  );
}

function aggregateAcordSourceFieldCounts(
  templates: NonNullable<QuotingSession["commercialAcordTemplates"]>
): Record<string, number> {
  return templates.reduce<Record<string, number>>((counts, template) => {
    Object.entries(template.sourceFieldCounts ?? {}).forEach(([source, count]) => {
      counts[source] = (counts[source] ?? 0) + count;
    });
    return counts;
  }, {});
}

function acordSourceLabel(source: string): string {
  switch (source) {
    case "questionnaire":
      return "Questionnaire";
    case "public_record":
      return "Public records";
    case "asset_detail":
      return "Asset details";
    case "contact":
      return "Client profile";
    case "system":
      return "QuoteX system";
    default:
      return fmt.titleCase(source.replace(/_/g, " "));
  }
}

function CommercialAcordSummary({
  session,
  highlightMissingQuestions = [],
}: {
  session: QuotingSession;
  highlightMissingQuestions?: QuotingQuestion[];
}) {
  const templates = session.commercialAcordTemplates ?? [];
  const [previewId, setPreviewId] = useState<string | null>(null);
  const highlightedTemplateId = useMemo(
    () =>
      templates.find((template) =>
        highlightMissingQuestions.some((question) =>
          questionMatchesAcordTemplate(question, template)
        )
      )?.templateId,
    [highlightMissingQuestions, templates]
  );
  const previewTemplate =
    templates.find((template) => template.templateId === previewId) ?? templates[0] ?? null;
  const completedAcordDocuments = useMemo(
    () =>
      api.documents
        .listByTenant(session.tenantId)
        .filter(
          (document) =>
            document.quoteRequestId === session.id &&
            document.type === "completed_acord_application"
        ),
    [session.tenantId, session.id, session.updatedAt]
  );
  const completedPreviewDocument = previewTemplate
    ? completedAcordDocuments.find(
        (document) =>
          document.templateFields?.["Source ACORD template ID"] === previewTemplate.templateId
      )
    : undefined;
  const previewUrl = previewTemplate ? acordSelectionFileUrl(previewTemplate) : null;
  const sourcePreviewDocument = previewTemplate ? api.documents.get(previewTemplate.templateId) : undefined;
  const highlightedFieldLabels = previewTemplate
    ? Array.from(
        new Set(
          highlightMissingQuestions
            .filter((question) => questionMatchesAcordTemplate(question, previewTemplate))
            .flatMap((question) =>
              question.acordFieldLabels?.length ? question.acordFieldLabels : [question.label]
            )
            .map((label) => label.trim())
            .filter(Boolean)
        )
      )
    : [];

  useEffect(() => {
    if (templates.length === 0) {
      setPreviewId(null);
      return;
    }
    if (!previewId || !templates.some((template) => template.templateId === previewId)) {
      setPreviewId(templates[0].templateId);
    }
  }, [previewId, templates]);

  useEffect(() => {
    if (highlightedTemplateId && highlightedTemplateId !== previewId) {
      setPreviewId(highlightedTemplateId);
    }
  }, [highlightedTemplateId, previewId]);

  if (templates.length === 0) return null;
  return (
    <div id="commercial-acord-workspace" className="rounded-md border border-gold-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gold-800 font-semibold">
            ACORD application workspace
          </div>
        </div>
        <Badge tone="gold">
          {templates.length} form{templates.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {templates.map((template) => (
          <div
            key={template.templateId}
            className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-xs"
          >
            <div className="font-semibold text-ink-900">
              {template.documentName || template.fileName}
            </div>
            <div className="mt-0.5 text-ink-500">{template.fileName}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone="success">{template.autoFilledFieldCount} auto-filled</Badge>
              <Badge tone={template.missingFieldCount > 0 ? "warn" : "success"}>
                {template.missingFieldCount} still needed
              </Badge>
              {acordSelectionFileUrl(template) && <Badge tone="gold">Embedded PDF</Badge>}
              {highlightMissingQuestions.some((question) =>
                questionMatchesAcordTemplate(question, template)
              ) && <Badge tone="warn">Required missing</Badge>}
            </div>
            {(template.sourcesUsed?.length ?? 0) > 0 && (
              <div className="mt-2 text-[11px] text-ink-500">
                Sources: {template.sourcesUsed!.map(acordSourceLabel).join(", ")}
              </div>
            )}
          </div>
        ))}
      </div>
      {highlightedFieldLabels.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {highlightedFieldLabels.length} required missing ACORD field
          {highlightedFieldLabels.length === 1 ? "" : "s"} highlighted on the selected document.
        </div>
      )}
      {previewTemplate && (
        <div className="mt-3 rounded-md border border-ink-200 bg-ink-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-ink-900">Embedded selected ACORD</div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                {previewTemplate.documentName || previewTemplate.fileName}
              </div>
            </div>
            {templates.length > 1 && (
              <div className="flex max-w-full gap-1 overflow-x-auto pb-1">
                {templates.map((template) => (
                  <button
                    key={template.templateId}
                    type="button"
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      template.templateId === previewTemplate.templateId
                        ? "border-gold-400 bg-white text-gold-900"
                        : "border-ink-200 bg-white text-ink-600 hover:border-gold-300"
                    }`}
                    onClick={() => setPreviewId(template.templateId)}
                  >
                    {template.documentName?.replace(/\s+-\s+.*/, "") || template.fileName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            {completedPreviewDocument ? (
              <CompletedAcordDocumentPreview
                document={completedPreviewDocument}
                fields={completedPreviewDocument.templateFields}
                frameClassName="h-[520px] w-full rounded border border-ink-200 bg-white"
                showStatus={false}
                viewerUrl={embeddedAcordViewerUrl}
                highlightFieldLabels={highlightedFieldLabels}
              />
            ) : previewUrl && highlightedFieldLabels.length > 0 && sourcePreviewDocument?.templateFieldLayout?.length ? (
              <DocumentTemplateFieldOverlay
                layout={sourcePreviewDocument.templateFieldLayout}
                fields={sourcePreviewDocument.templateFields}
                fileUrl={previewUrl}
                sourceFileName={previewTemplate.fileName}
                title="Required missing ACORD fields"
                renderPdfBackground={false}
                highlightLabels={highlightedFieldLabels}
                showOnlyHighlighted
              />
            ) : previewUrl && sourcePreviewDocument?.templateFieldLayout?.length ? (
              <DocumentTemplateFieldOverlay
                layout={sourcePreviewDocument.templateFieldLayout}
                fields={sourcePreviewDocument.templateFields}
                fileUrl={previewUrl}
                sourceFileName={previewTemplate.fileName}
                title="Selected ACORD form"
                renderPdfBackground={false}
              />
            ) : previewUrl ? (
              <div className="rounded-md border border-dashed border-ink-200 bg-white px-3 py-6 text-center text-xs text-ink-500">
                The detected field overlay is unavailable for this ACORD file.
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 font-semibold text-gold-900 underline"
                >
                  Open the source PDF
                </a>
                .
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-ink-200 bg-white px-3 py-6 text-center text-xs text-ink-500">
                The completed ACORD preview is not available yet.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type CommercialAcordSelection = NonNullable<QuotingSession["commercialAcordTemplates"]>[number];

function questionMatchesAcordTemplate(
  question: QuotingQuestion,
  template: CommercialAcordSelection
): boolean {
  return (
    question.sourceDocumentId === template.templateId ||
    question.sourceDocumentFileName === template.fileName
  );
}

function acordSelectionFileUrl(template: CommercialAcordSelection): string | null {
  if (!template.storagePath) return template.downloadUrl ?? null;
  return documentFileUrl({
    downloadUrl: template.downloadUrl,
    storagePath: template.storagePath,
  });
}

function embeddedAcordViewerUrl(fileUrl: string): string {
  return fileUrl.includes("#") ? `${fileUrl}&toolbar=1&navpanes=0` : `${fileUrl}#toolbar=1&navpanes=0`;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-ink-100 bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}

function commercialSubmissionBadge(
  status: NonNullable<QuotingSession["commercialCarrierSubmissions"]>[number]["status"]
) {
  switch (status) {
    case "accepted":
      return { tone: "success" as const, label: "Accepted" };
    case "supplemental_sent":
      return { tone: "success" as const, label: "Supplemental sent" };
    case "needs_client_info":
      return { tone: "warn" as const, label: "Needs client info" };
    case "needs_supplemental":
      return { tone: "warn" as const, label: "Needs supplemental" };
    case "agent_review":
      return { tone: "warn" as const, label: "Agent review" };
    case "send_failed":
      return { tone: "warn" as const, label: "Delivery failed" };
    case "declined":
      return { tone: "neutral" as const, label: "Declined" };
    case "awaiting_response":
      return { tone: "info" as const, label: "Awaiting response" };
    case "application_sent":
      return { tone: "info" as const, label: "Prepared" };
  }
}

type QuoteLineItem = { label: string; detail: string; amount: number };

function quoteLineItemsForSession(session: QuotingSession, quote: CarrierQuote): QuoteLineItem[] {
  const assetType: AssetType = session.assetType ?? "other";
  const dwelling = session.estimatedValue ?? 0;
  const otherStructures = Math.round(dwelling * 0.1);
  const personalProperty = Math.round(dwelling * 0.5);
  const lossOfUse = Math.round(dwelling * 0.2);
  const liability = 1_000_000;
  const medicalPayments = 5_000;
  const baseRate =
    assetType === "coastal_home"
      ? 0.006
      : assetType === "luxury_vehicle"
      ? 0.012
      : assetType === "yacht"
      ? 0.015
      : assetType === "jewelry"
      ? 0.018
      : assetType === "umbrella_liability"
      ? 0.0008
      : 0.01;

  return session.lineOfBusiness === "commercial"
    ? [
        {
          label: "Commercial property / exposure base",
          detail: `${fmt.money(dwelling)} estimated exposure at ${(baseRate * 100).toFixed(2)}% base rate`,
          amount: Math.round(quote.premium * 0.42),
        },
        {
          label: "General liability",
          detail: `${fmt.money(liability)} occurrence limit`,
          amount: Math.round(quote.premium * 0.2),
        },
        {
          label: "Operations and payroll rating",
          detail: "AI-filled from business intake and supplementals",
          amount: Math.round(quote.premium * 0.16),
        },
        {
          label: "Carrier supplemental credits",
          detail: "Applied only after carrier accepted the application",
          amount: Math.round(quote.premium * 0.08),
        },
        {
          label: "Taxes, surcharges, fees",
          detail: "State + carrier mandated",
          amount: Math.round(quote.premium * 0.14),
        },
      ]
    : [
        {
          label: "Dwelling / base coverage",
          detail: `${fmt.money(dwelling)} at ${(baseRate * 100).toFixed(2)}% base rate`,
          amount: Math.round(quote.premium * 0.55),
        },
        {
          label: "Other structures",
          detail: `${fmt.money(otherStructures)} extension`,
          amount: Math.round(quote.premium * 0.08),
        },
        {
          label: "Personal property",
          detail: `${fmt.money(personalProperty)} schedule`,
          amount: Math.round(quote.premium * 0.16),
        },
        {
          label: "Loss of use",
          detail: `${fmt.money(lossOfUse)} ALE`,
          amount: Math.round(quote.premium * 0.04),
        },
        {
          label: "Personal liability",
          detail: `${fmt.money(liability)} per occurrence`,
          amount: Math.round(quote.premium * 0.1),
        },
        {
          label: "Medical payments",
          detail: `${fmt.money(medicalPayments)} per person`,
          amount: Math.round(quote.premium * 0.02),
        },
        {
          label: "Taxes, surcharges, fees",
          detail: "State + carrier mandated",
          amount: Math.round(quote.premium * 0.05),
        },
      ];
}

function quotePdfPlainText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022]/g, "-")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function quotePdfLiteral(value: unknown): string {
  return quotePdfPlainText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function quotePdfSlug(value: unknown): string {
  const slug = quotePdfPlainText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "quote";
}

function quotePdfWrap(value: unknown, maxChars: number): string[] {
  const text = quotePdfPlainText(value);
  if (!text) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function quotePdfContactName(session: QuotingSession): string {
  if (session.customerId) {
    return api.customers.get(session.customerId)?.name ?? "Client";
  }
  if (session.prospectId) {
    return api.prospects.get(session.prospectId)?.name ?? "Prospect";
  }
  return "Client";
}

function buildQuotePacketPdf(session: QuotingSession, quotes: CarrierQuote[]): { fileName: string; pdf: string } {
  const contactName = quotePdfContactName(session);
  const lineLabel = session.lineOfBusiness === "commercial" ? "Commercial lines" : "Personal lines";
  const assetLabel = session.categoryLabel || api.helpers.assetTypeLabel(session.assetType);
  const generatedAt = fmt.dateTime(new Date().toISOString());
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const pages = quotes.map((quote, quoteIndex) => {
    const carrier = api.carriers.get(quote.carrierId);
    const carrierName = carrier?.name ?? "Unknown carrier";
    const rank = session.quotes.findIndex((row) => row.carrierId === quote.carrierId) + 1;
    const match = quoteMatchPercent(quote.score);
    const confidence = Math.round(quote.confidence * 100);
    const lineItems = quoteLineItemsForSession(session, quote);
    const commands: string[] = [];
    let y = pageHeight - margin;

    function text(x: number, nextY: number, value: unknown, size = 10, font = "F1") {
      commands.push(`BT /${font} ${size} Tf ${x} ${nextY} Td (${quotePdfLiteral(value)}) Tj ET`);
    }

    function rule(nextY: number) {
      commands.push(`0.82 g ${margin} ${nextY} ${pageWidth - margin * 2} 0.75 re f 0 g`);
    }

    function wrapped(x: number, value: unknown, maxChars: number, size = 10, lineHeight = 14, font = "F1") {
      for (const line of quotePdfWrap(value, maxChars)) {
        text(x, y, line, size, font);
        y -= lineHeight;
      }
    }

    text(margin, y, "Quote comparison packet", 18, "F2");
    text(pageWidth - 172, y + 2, `Generated ${generatedAt}`, 8, "F1");
    y -= 20;
    wrapped(margin, `${contactName} - ${lineLabel} - ${assetLabel}`, 78, 9, 12);
    y -= 4;
    rule(y);
    y -= 28;

    text(margin, y, `Rank #${rank > 0 ? rank : quoteIndex + 1}`, 9, "F2");
    text(pageWidth - 160, y, `${match}% match`, 14, "F2");
    y -= 20;
    text(margin, y, carrierName, 22, "F2");
    text(pageWidth - 160, y + 2, fmt.money(quote.premium), 22, "F2");
    text(pageWidth - 160, y - 12, "annual premium", 8, "F1");
    y -= 34;
    wrapped(margin, quote.fitReason, 82, 10, 14);
    y -= 6;

    text(margin, y, "Line", 8, "F2");
    text(margin + 128, y, "Category", 8, "F2");
    text(margin + 278, y, "Value / limit", 8, "F2");
    text(margin + 420, y, "Confidence", 8, "F2");
    y -= 13;
    text(margin, y, lineLabel, 10, "F1");
    text(margin + 128, y, assetLabel, 10, "F1");
    text(margin + 278, y, fmt.money(session.estimatedValue ?? 0), 10, "F1");
    text(margin + 420, y, `${confidence}%`, 10, "F1");
    y -= 24;
    rule(y);
    y -= 24;

    text(margin, y, "Coverage breakdown", 12, "F2");
    y -= 18;
    for (const item of lineItems) {
      text(margin, y, item.label, 10, "F2");
      text(pageWidth - 120, y, fmt.money(item.amount), 10, "F2");
      y -= 12;
      wrapped(margin, item.detail, 78, 8, 10);
      y -= 4;
    }
    rule(y);
    y -= 18;
    text(margin, y, "Estimated annual premium", 11, "F2");
    text(pageWidth - 120, y, fmt.money(quote.premium), 11, "F2");
    y -= 34;

    text(margin, y, "Carrier runner", 12, "F2");
    y -= 18;
    wrapped(
      margin,
      `${quote.providerTrace?.providerLabel ?? "AI carrier portal runner"}${
        quote.providerTrace?.requestId ? ` - ${quote.providerTrace.requestId}` : ""
      }`,
      86,
      9,
      12
    );
    y -= 12;
    wrapped(
      margin,
      "Quote indications are preliminary and subject to carrier underwriting, final forms, credits, deductibles, fees, and binding confirmation.",
      92,
      8,
      11
    );

    return commands.join("\n");
  });

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const contentObjectIds = pages.map((_, index) => 4 + index * 2);
  const fontRegularId = 3 + pages.length * 2;
  const fontBoldId = fontRegularId + 1;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((stream, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const carrierName = quotes.length === 1 ? api.carriers.get(quotes[0].carrierId)?.name : "selected-quotes";
  const fileName = `quotex-${quotePdfSlug(contactName)}-${quotePdfSlug(carrierName)}-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  return { fileName, pdf };
}

function quotePacketAttachment(session: QuotingSession, quotes: CarrierQuote[]): CommunicationAttachment {
  const { fileName, pdf } = buildQuotePacketPdf(session, quotes);
  return {
    id: `quote_packet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    fileName,
    fileType: "application/pdf",
    sizeBytes: pdf.length,
    dataUrl: `data:application/pdf;base64,${btoa(pdf)}`,
    description:
      quotes.length === 1
        ? "Selected carrier quote PDF"
        : `${quotes.length} selected carrier quote PDFs`,
  };
}

function saveQuotePacketAsPdf(session: QuotingSession, quotes: CarrierQuote[]) {
  if (quotes.length === 0) return;
  const { fileName, pdf } = buildQuotePacketPdf(session, quotes);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function QuotesTable({
  session,
  userId,
  onChanged,
}: {
  session: QuotingSession;
  userId: string;
  onChanged?: () => void;
}) {
  const [quickView, setQuickView] = useState<CarrierQuote | null>(null);
  const [downloadSelectionMode, setDownloadSelectionMode] = useState(false);
  const [sendSelectionMode, setSendSelectionMode] = useState(false);
  const [compareSelectionMode, setCompareSelectionMode] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedQuoteIds, setSelectedQuoteIds] = useState<Set<string>>(() => new Set());
  const [sendDraftOpen, setSendDraftOpen] = useState(false);
  const [sendDraft, setSendDraft] = useState<QuoteRecommendationDraft | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sentSelectedAt, setSentSelectedAt] = useState<string | null>(null);
  const quoteIdKey = session.quotes.map((quote) => quote.carrierId).join("|");

  useEffect(() => {
    setSelectedQuoteIds((current) => {
      const validIds = new Set(session.quotes.map((quote) => quote.carrierId));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [session.id, quoteIdKey]);

  if (session.quotes.length === 0) {
    return (
      <div className="text-sm text-ink-500">
        No active carriers in this agency's library matched the asset type. Link a
        carrier under Carrier library and re-run.
      </div>
    );
  }
  const selectedQuotes = session.quotes.filter((quote) => selectedQuoteIds.has(quote.carrierId));
  const allSelected = selectedQuotes.length === session.quotes.length;
  const selectionMode = downloadSelectionMode || sendSelectionMode || compareSelectionMode;
  const contact = session.prospectId
    ? api.prospects.get(session.prospectId)
    : session.customerId
    ? api.customers.get(session.customerId)
    : null;
  const sender = session.createdById ? api.users.get(session.createdById) : undefined;
  const senderAgency = api.agencies.get(sender?.tenantId ?? session.tenantId);
  const signatureBlock = sender
    ? emailSignatureBlockForUser(
        sender,
        senderAgency?.logoUrl
          ? { name: `${senderAgency.name} logo`, dataUrl: senderAgency.logoUrl }
          : null
      )
    : null;
  const selectedQuotesRecipientLabel = contact
    ? `${contact.name}${contact.email ? ` - ${contact.email}` : ""}`
    : "Selected contact";

  function toggleQuoteSelection(carrierId: string, checked: boolean) {
    setSelectedQuoteIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(carrierId);
      } else {
        next.delete(carrierId);
      }
      return next;
    });
  }

  function toggleAllQuotes(checked: boolean) {
    setSelectedQuoteIds(checked ? new Set(session.quotes.map((quote) => quote.carrierId)) : new Set());
  }

  function handleQuoteListDownload() {
    if (!downloadSelectionMode) {
      setCompareSelectionMode(false);
      setSendSelectionMode(false);
      setDownloadSelectionMode(true);
      return;
    }
    if (selectedQuotes.length > 0) {
      saveQuotePacketAsPdf(session, selectedQuotes);
      setDownloadSelectionMode(false);
      setSelectedQuoteIds(new Set());
    }
  }

  function cancelQuoteListDownload() {
    setDownloadSelectionMode(false);
    setSendSelectionMode(false);
    setCompareSelectionMode(false);
    setSelectedQuoteIds(new Set());
  }

  function handleQuoteCompare() {
    if (!compareSelectionMode) {
      setDownloadSelectionMode(false);
      setSendSelectionMode(false);
      setCompareSelectionMode(true);
      return;
    }
    if (selectedQuotes.length >= 2) {
      setCompareOpen(true);
    }
  }

  function handleQuoteSendSelection() {
    if (!sendSelectionMode) {
      setDownloadSelectionMode(false);
      setCompareSelectionMode(false);
      setSendSelectionMode(true);
      return;
    }
    openSelectedQuotesDraft();
  }

  function buildSelectedQuotesDraft(quotes: CarrierQuote[]): QuoteRecommendationDraft | null {
    if (!contact || quotes.length === 0) return null;
    const firstName = contact.name.split(/\s+/)[0];
    const sortedQuotes = quotes
      .map((quote) => ({
        quote,
        carrierName: api.carriers.get(quote.carrierId)?.name ?? "Unknown carrier",
        rank: session.quotes.findIndex((row) => row.carrierId === quote.carrierId) + 1,
      }))
      .sort((a, b) => a.rank - b.rank);
    const topQuote = sortedQuotes[0];
    const summaryLines = sortedQuotes.map(({ quote, carrierName, rank }) => {
      const match = quoteMatchPercent(quote.score);
      return `  ${rank}. ${carrierName} - ${match}% match - ${fmt.money(quote.premium)} annual premium`;
    });
    return {
      subject:
        quotes.length === 1
          ? `Quote option - ${topQuote.carrierName}`
          : `${quotes.length} quote options for review`,
      body: [
        `Hi ${firstName},`,
        ``,
        quotes.length === 1
          ? `I attached the quote option we discussed for your review.`
          : `I attached a quote comparison packet with the ${quotes.length} options I would like you to review.`,
        ``,
        `Quick summary:`,
        ...summaryLines,
        ``,
        `The attached PDF has the quote breakdown for each selected option. These are still subject to final carrier underwriting, selected deductibles, forms, credits, and binding confirmation.`,
        ``,
        `Reply here with the option you would like to move forward with, or let me know if you want to compare anything differently.`,
      ].join("\n"),
      attachments: [quotePacketAttachment(session, sortedQuotes.map((row) => row.quote))],
    };
  }

  function openSelectedQuotesDraft() {
    const draft = buildSelectedQuotesDraft(selectedQuotes);
    if (!draft) return;
    setSendDraft(draft);
    setSendDraftOpen(true);
  }

  async function sendSelectedQuotesDraft() {
    if (!sendDraft || !contact) return;
    setSendBusy(true);
    try {
      api.communications.create({
        tenantId: session.tenantId,
        customerId: session.customerId,
        prospectId: session.prospectId,
        channel: "email",
        direction: "outbound",
        subject: sendDraft.subject,
        body: sendDraft.body,
        attachments: sendDraft.attachments.length > 0 ? sendDraft.attachments : undefined,
        createdById: session.createdById,
      });
      onChanged?.();
      setSentSelectedAt(new Date().toISOString());
      setSendDraftOpen(false);
      setDownloadSelectionMode(false);
      setSendSelectionMode(false);
      setCompareSelectionMode(false);
      setSelectedQuoteIds(new Set());
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-emerald-800 font-semibold flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" />{" "}
          {session.lineOfBusiness === "commercial"
            ? "Accepted carrier ranking"
            : "AI-ranked carrier quotes"}
        </div>
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {selectionMode && (
            <label className="inline-flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-gold-700"
                checked={allSelected}
                onChange={(event) => toggleAllQuotes(event.target.checked)}
                aria-label="Select all quotes"
              />
              Select all
            </label>
          )}
          {selectionMode && (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={cancelQuoteListDownload}
              title="Cancel quote selection"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          )}
          {contact && (sendSelectionMode || !selectionMode) && (
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={sendSelectionMode && (selectedQuotes.length === 0 || sendBusy)}
              onClick={handleQuoteSendSelection}
              title={
                sendSelectionMode
                  ? "Review the selected quote PDF before sending it to the client"
                  : "Select quote PDFs to review and send to the client"
              }
            >
              {sendBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              View send{sendSelectionMode && selectedQuotes.length ? ` (${selectedQuotes.length})` : ""}
            </button>
          )}
          {(!selectionMode || compareSelectionMode) && (
            <button
              type="button"
              className="btn-outline text-xs"
              disabled={compareSelectionMode && selectedQuotes.length < 2}
              onClick={handleQuoteCompare}
              title={
                compareSelectionMode
                  ? "Compare at least two selected quote options"
                  : "Select quote options to compare"
              }
            >
              <ClipboardList className="h-3.5 w-3.5" />
              Compare policies{compareSelectionMode && selectedQuotes.length ? ` (${selectedQuotes.length})` : ""}
            </button>
          )}
          {(!selectionMode || downloadSelectionMode) && (
            <button
              type="button"
              className="btn-outline text-xs"
              disabled={downloadSelectionMode && selectedQuotes.length === 0}
              onClick={handleQuoteListDownload}
              title={
                downloadSelectionMode
                  ? "Download selected quote PDF to this computer"
                  : "Select quote PDFs to download to this computer"
              }
            >
              <FileText className="h-3.5 w-3.5" />
              Download{downloadSelectionMode && selectedQuotes.length ? ` (${selectedQuotes.length})` : ""}
            </button>
          )}
        </div>
      </div>
      {session.aiSummary && (
        <p className="text-xs text-ink-600">{session.aiSummary}</p>
      )}
      {sentSelectedAt && (
        <div className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Sent selected quote packet to {contact?.name ?? "contact"}
        </div>
      )}
      <ol className="space-y-2">
        {session.quotes.map((q, i) => {
          const carrier = api.carriers.get(q.carrierId);
          return (
            <li
              key={q.carrierId}
              className="rounded-md border border-ink-100 bg-white p-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="min-w-0 flex items-center gap-2">
                {selectionMode && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-gold-700"
                    checked={selectedQuoteIds.has(q.carrierId)}
                    onChange={(event) => toggleQuoteSelection(q.carrierId, event.target.checked)}
                    aria-label={`Select ${carrier?.name ?? "carrier quote"}`}
                  />
                )}
                <span
                  className={`text-[11px] font-bold w-6 h-6 inline-flex items-center justify-center rounded-full ${
                    i === 0
                      ? "bg-gold-100 text-gold-800"
                      : "bg-ink-100 text-ink-700"
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-semibold">
                    {carrier?.name ?? "Unknown carrier"}
                  </div>
                  <div className="text-[11px] text-ink-500">{q.fitReason}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <QuoteMatchBadge score={q.score} />
                <div className="text-right">
                  <div className="text-2xl font-semibold tabular-nums text-ink-900">
                    {fmt.money(q.premium)}
                  </div>
                  <div className="text-[11px] text-ink-500 -mt-0.5">annual premium</div>
                </div>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={() => setQuickView(q)}
                  title="Inspect this quote's full detail"
                >
                  Quick view
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <QuickViewQuoteModal
        quote={quickView}
        session={session}
        onChanged={onChanged}
        onClose={() => setQuickView(null)}
      />
      <QuoteCompareModal
        open={compareOpen}
        session={session}
        quotes={selectedQuotes}
        onClose={() => setCompareOpen(false)}
      />
      <QuoteRecommendationDraftReviewModal
        open={sendDraftOpen}
        toLabel={selectedQuotesRecipientLabel}
        tenantId={session.tenantId}
        uploadedById={session.createdById}
        draft={sendDraft}
        signatureBlock={signatureBlock}
        busy={sendBusy}
        onClose={() => setSendDraftOpen(false)}
        onChange={(patch) => setSendDraft((current) => (current ? { ...current, ...patch } : current))}
        onSend={sendSelectedQuotesDraft}
      />
    </div>
  );
}

type CompareDropEdge = "before" | "after";

function QuoteCompareModal({
  open,
  session,
  quotes,
  onClose,
}: {
  open: boolean;
  session: QuotingSession;
  quotes: CarrierQuote[];
  onClose: () => void;
}) {
  const quoteRows = useMemo(
    () =>
      quotes
        .map((quote) => ({
          quote,
          carrier: api.carriers.get(quote.carrierId),
          rank: session.quotes.findIndex((row) => row.carrierId === quote.carrierId) + 1,
          lineItems: quoteLineItemsForSession(session, quote),
        }))
        .sort((a, b) => a.rank - b.rank),
    [quotes, session]
  );
  const defaultOrderIds = useMemo(
    () => quoteRows.map(({ quote }) => quote.carrierId),
    [quoteRows]
  );
  const defaultOrderKey = defaultOrderIds.join("|");
  const [orderedQuoteIds, setOrderedQuoteIds] = useState<string[]>([]);
  const [draggingCarrierId, setDraggingCarrierId] = useState<string | null>(null);
  const [compareDropTarget, setCompareDropTarget] = useState<{
    carrierId: string;
    edge: CompareDropEdge;
  } | null>(null);
  const compareTableRef = useRef<HTMLDivElement | null>(null);
  const activeOrderIds = orderedQuoteIds.length > 0 ? orderedQuoteIds : defaultOrderIds;
  const sortedQuotes = activeOrderIds
    .map((carrierId) => quoteRows.find(({ quote }) => quote.carrierId === carrierId))
    .filter(Boolean) as typeof quoteRows;
  const bestPremium =
    sortedQuotes.length > 0 ? Math.min(...sortedQuotes.map(({ quote }) => quote.premium)) : 0;
  const bestScore =
    sortedQuotes.length > 0 ? Math.max(...sortedQuotes.map(({ quote }) => quote.score)) : 0;
  const coverageLabels = Array.from(
    new Set(sortedQuotes.flatMap(({ lineItems }) => lineItems.map((item) => item.label)))
  );

  useEffect(() => {
    if (!open) return;
    setOrderedQuoteIds(defaultOrderIds);
    setDraggingCarrierId(null);
    setCompareDropTarget(null);
  }, [open, defaultOrderKey]);

  function removeComparedQuote(carrierId: string) {
    setOrderedQuoteIds((current) => {
      const base = current.length > 0 ? current : defaultOrderIds;
      return base.filter((id) => id !== carrierId);
    });
  }

  function moveComparedQuote(
    dragCarrierId: string,
    targetCarrierId: string,
    edge: CompareDropEdge = "before"
  ) {
    if (dragCarrierId === targetCarrierId) return;
    setOrderedQuoteIds((current) => {
      const base = current.length > 0 ? current : defaultOrderIds;
      if (!base.includes(dragCarrierId) || !base.includes(targetCarrierId)) return base;
      const next = base.filter((id) => id !== dragCarrierId);
      const targetIndex = next.indexOf(targetCarrierId);
      const insertAt = edge === "after" ? targetIndex + 1 : targetIndex;
      next.splice(insertAt, 0, dragCarrierId);
      return next;
    });
  }

  function compareDropTargetFor(event: React.DragEvent<HTMLElement>) {
    const root = compareTableRef.current;
    if (!root || !draggingCarrierId) return null;
    const headers = Array.from(
      root.querySelectorAll<HTMLElement>("[data-compare-carrier-id]")
    ).filter((header) => header.dataset.compareCarrierId !== draggingCarrierId);
    if (headers.length === 0) return null;

    let target: { carrierId: string; edge: CompareDropEdge; distance: number } | null = null;
    for (const header of headers) {
      const carrierId = header.dataset.compareCarrierId;
      if (!carrierId) continue;
      const rect = header.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const edge: CompareDropEdge = event.clientX < midpoint ? "before" : "after";
      const distance = Math.abs(event.clientX - midpoint);
      if (!target || distance < target.distance) {
        target = { carrierId, edge, distance };
      }
    }
    return target ? { carrierId: target.carrierId, edge: target.edge } : null;
  }

  function handleCompareDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!draggingCarrierId) return;
    const target = compareDropTargetFor(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setCompareDropTarget(target);
  }

  function handleCompareDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!draggingCarrierId) return;
    event.preventDefault();
    const target = compareDropTarget ?? compareDropTargetFor(event);
    if (target) {
      moveComparedQuote(draggingCarrierId, target.carrierId, target.edge);
    }
    setCompareDropTarget(null);
    setDraggingCarrierId(null);
  }

  return (
    <Modal open={open} onClose={onClose} title="Compare policies" size="xl" closeIcon="back">
      {sortedQuotes.length < 2 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Select at least two quote options to compare.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <DetailGroup title="Lowest premium">
              <div className="text-2xl font-semibold tabular-nums text-ink-900">
                {fmt.money(bestPremium)}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {sortedQuotes.find(({ quote }) => quote.premium === bestPremium)?.carrier?.name ??
                  "Selected carrier"}
              </p>
            </DetailGroup>
            <DetailGroup title="Strongest match">
              <div className="text-2xl font-semibold tabular-nums text-ink-900">
                {quoteMatchPercent(bestScore)}%
              </div>
              <p className="mt-1 text-xs text-ink-500">
                {sortedQuotes.find(({ quote }) => quote.score === bestScore)?.carrier?.name ??
                  "Selected carrier"}
              </p>
            </DetailGroup>
            <DetailGroup title="Options selected">
              <div className="text-2xl font-semibold tabular-nums text-ink-900">
                {sortedQuotes.length}
              </div>
              <p className="mt-1 text-xs text-ink-500">
                Current comparison order.
              </p>
            </DetailGroup>
          </div>

          <div
            ref={compareTableRef}
            className="max-w-full overflow-x-auto rounded-md border border-ink-100 bg-white"
            onDragOver={handleCompareDragOver}
            onDrop={handleCompareDrop}
            onDragLeave={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) return;
              if (!next) return;
              setCompareDropTarget(null);
            }}
          >
            <table className="min-w-[900px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/80 text-left">
                  <th className="sticky left-0 z-10 w-48 bg-ink-50/95 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Category
                  </th>
                  {sortedQuotes.map(({ quote, carrier, rank }) => (
                    <th
                      key={quote.carrierId}
                      data-compare-carrier-id={quote.carrierId}
                      className={`min-w-56 px-3 py-2 align-top transition ${
                        compareDropTarget?.carrierId === quote.carrierId
                          ? "bg-gold-50 ring-2 ring-inset ring-gold-300"
                          : draggingCarrierId && draggingCarrierId !== quote.carrierId
                          ? "bg-gold-50/50"
                          : ""
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            draggable
                            className="inline-flex h-9 shrink-0 cursor-grab items-center gap-1.5 rounded-md border border-gold-200 bg-gold-50 px-2.5 text-gold-900 active:cursor-grabbing"
                            onDragStart={(event) => {
                              setDraggingCarrierId(quote.carrierId);
                              setCompareDropTarget(null);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", quote.carrierId);
                            }}
                            onDragEnd={() => {
                              setCompareDropTarget(null);
                              setDraggingCarrierId(null);
                            }}
                            title={`Press and hold to move ${carrier?.name ?? "this carrier"}`}
                            aria-label={`Move ${carrier?.name ?? "carrier"} in comparison`}
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gold-100 text-[11px] font-bold text-gold-800">
                              {rank}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ink-200 bg-white text-ink-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => removeComparedQuote(quote.carrierId)}
                            title={`Remove ${carrier?.name ?? "carrier"} from comparison`}
                            aria-label={`Remove ${carrier?.name ?? "carrier"} from comparison`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-ink-900">
                            {carrier?.name ?? "Unknown carrier"}
                          </div>
                          <div className="mt-1">
                            <QuoteMatchBadge score={quote.score} />
                          </div>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <CompareRow
                  label="Annual premium"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value: (
                      <span className="text-lg font-semibold tabular-nums text-ink-900">
                        {fmt.money(quote.premium)}
                      </span>
                    ),
                    best: quote.premium === bestPremium,
                  }))}
                />
                <CompareRow
                  label="Match"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value: `${quoteMatchPercent(quote.score)}% match`,
                    best: quote.score === bestScore,
                  }))}
                />
                <CompareRow
                  label="Confidence"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value: `${Math.round(quote.confidence * 100)}%`,
                  }))}
                />
                <CompareRow
                  label="Carrier runner"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value: quote.providerTrace?.providerLabel ?? "AI carrier portal runner",
                  }))}
                />
                <CompareRow
                  label="Quote reference"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value:
                      quote.providerTrace?.runnerTrace?.extractedQuote?.quoteNumber ??
                      quote.providerTrace?.requestId ??
                      "Pending",
                  }))}
                />
                <CompareRow
                  label="Why it matched"
                  values={sortedQuotes.map(({ quote }) => ({
                    key: quote.carrierId,
                    value: quote.fitReason,
                  }))}
                />
                {coverageLabels.map((label) => (
                  <CompareRow
                    key={label}
                    label={label}
                    values={sortedQuotes.map(({ quote, lineItems }) => {
                      const item = lineItems.find((row) => row.label === label);
                      return {
                        key: quote.carrierId,
                        value: item ? (
                          <div>
                            <div className="font-medium tabular-nums text-ink-900">
                              {fmt.money(item.amount)}
                            </div>
                            <div className="mt-0.5 text-[11px] leading-snug text-ink-500">
                              {item.detail}
                            </div>
                          </div>
                        ) : (
                          "Not included"
                        ),
                      };
                    })}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end border-t border-ink-100 pt-3">
            <button type="button" className="btn-outline text-sm" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CompareRow({
  label,
  values,
}: {
  label: string;
  values: Array<{ key: string; value: React.ReactNode; best?: boolean }>;
}) {
  return (
    <tr>
      <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </th>
      {values.map((item) => (
        <td
          key={item.key}
          className={`px-3 py-2 align-top text-sm text-ink-700 ${
            item.best ? "bg-emerald-50 text-emerald-950" : ""
          }`}
        >
          <div className="flex items-start gap-2">
            {item.best && (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
            )}
            <div className="min-w-0">{item.value}</div>
          </div>
        </td>
      ))}
    </tr>
  );
}

function isLegacyCarrierProviderMessage(message: string): boolean {
  const blocked = [
    "ez" + "lynx",
    "q" + "as",
    "submit" + "quote",
    "so" + "ap",
    "carrier " + "api",
    "quoting " + "api",
    "endpoint",
  ];
  const lower = message.toLowerCase();
  return blocked.some((term) => lower.includes(term));
}

function QuickViewQuoteModal({
  quote,
  session,
  onChanged,
  onClose,
}: {
  quote: CarrierQuote | null;
  session: QuotingSession;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const [carrierNotice, setCarrierNotice] = useState<string | null>(null);
  useEffect(() => {
    setCarrierNotice(null);
  }, [quote?.carrierId, session.id]);

  if (!quote) {
    return (
      <Modal open={false} onClose={onClose} title="Quote detail" size="lg">
        <div />
      </Modal>
    );
  }
  const carrier = api.carriers.get(quote.carrierId);
  const runnerStatus = carrierPortalRunnerStatus(carrier);
  const rankIndex = session.quotes.findIndex((q) => q.carrierId === quote.carrierId);
  // Legacy quoting sessions may pre-date the assetType / estimatedValue
  // snapshot fields. Defensive fallbacks so opening Quick view on a
  // stale row doesn't crash the whole page to a white screen.
  const assetType: AssetType = session.assetType ?? "other";
  const estimatedValue = session.estimatedValue ?? 0;
  const appetite = (carrier?.appetites ?? []).find(
    (a) => a.assetType === assetType
  );
  const apiBadge =
    quote.providerTrace?.provider === "carrier_portal_automation" && quote.apiStatus === "connected"
      ? { tone: "success" as const, label: "Live AI carrier runner" }
    : quote.providerTrace?.runnerTrace?.mode === "configuration_trace"
      ? { tone: runnerStatus.tone, label: runnerStatus.label }
    : quote.providerTrace?.provider === "carrier_portal_automation"
      ? { tone: runnerStatus.canAttempt ? ("gold" as const) : runnerStatus.tone, label: runnerStatus.label }
      : quote.apiStatus === "simulated"
      ? { tone: "info" as const, label: "Carrier portal test mode" }
      : { tone: "gold" as const, label: "Carrier portal runner pending" };

  const currentQuote =
    api.quoting.get(session.id)?.quotes.find((q) => q.carrierId === quote.carrierId) ??
    quote;
  const implementation = currentQuote.implementation;
  const carrierPortalUrl = implementation?.carrierPortalUrl ?? carrier?.agentPortalUrl;

  // Derive a quick coverage suggestion from the asset value so the
  // modal feels like a real quote breakdown.
  const dwelling = estimatedValue ?? 0;
  const otherStructures = Math.round(dwelling * 0.1);
  const personalProperty = Math.round(dwelling * 0.5);
  const lossOfUse = Math.round(dwelling * 0.2);
  const liability = 1_000_000;
  const medicalPayments = 5_000;
  const baseRate =
    assetType === "coastal_home"
      ? 0.006
      : assetType === "luxury_vehicle"
      ? 0.012
      : assetType === "yacht"
      ? 0.015
      : assetType === "jewelry"
      ? 0.018
      : assetType === "umbrella_liability"
      ? 0.0008
      : 0.01;

  // Naive line-item breakdown so the agent has something credible
  // to talk through with the client. Splits proportional to coverage
  // weight, then adds taxes + fees to land within a couple hundred
  // dollars of the headline premium.
  const lineItems =
    session.lineOfBusiness === "commercial"
      ? [
          {
            label: "Commercial property / exposure base",
            detail: `${fmt.money(dwelling)} estimated exposure at ${(baseRate * 100).toFixed(2)}% base rate`,
            amount: Math.round(quote.premium * 0.42),
          },
          {
            label: "General liability",
            detail: `${fmt.money(liability)} occurrence limit`,
            amount: Math.round(quote.premium * 0.2),
          },
          {
            label: "Operations and payroll rating",
            detail: "AI-filled from business intake and supplementals",
            amount: Math.round(quote.premium * 0.16),
          },
          {
            label: "Carrier supplemental credits",
            detail: "Applied only after carrier accepted the application",
            amount: Math.round(quote.premium * 0.08),
          },
          {
            label: "Taxes, surcharges, fees",
            detail: "State + carrier mandated",
            amount: Math.round(quote.premium * 0.14),
          },
        ]
      : [
          {
            label: "Dwelling / base coverage",
            detail: `${fmt.money(dwelling)} at ${(baseRate * 100).toFixed(2)}% base rate`,
            amount: Math.round(quote.premium * 0.55),
          },
          {
            label: "Other structures",
            detail: `${fmt.money(otherStructures)} extension`,
            amount: Math.round(quote.premium * 0.08),
          },
          {
            label: "Personal property",
            detail: `${fmt.money(personalProperty)} schedule`,
            amount: Math.round(quote.premium * 0.16),
          },
          {
            label: "Loss of use",
            detail: `${fmt.money(lossOfUse)} ALE`,
            amount: Math.round(quote.premium * 0.04),
          },
          {
            label: "Personal liability",
            detail: `${fmt.money(liability)} per occurrence`,
            amount: Math.round(quote.premium * 0.1),
          },
          {
            label: "Medical payments",
            detail: `${fmt.money(medicalPayments)} per person`,
            amount: Math.round(quote.premium * 0.02),
          },
          {
            label: "Taxes, surcharges, fees",
            detail: "State + carrier mandated",
            amount: Math.round(quote.premium * 0.05),
          },
        ];

  return (
    <Modal open={!!quote} onClose={onClose} title="Carrier quote — quick view" size="lg">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-ink-500 uppercase tracking-wider">
              Rank #{rankIndex + 1} of {session.quotes.length}
            </div>
            <h3 className="text-xl font-semibold mt-0.5">
              {carrier?.name ?? "Unknown carrier"}
            </h3>
            <p className="text-xs text-ink-500 mt-1">{quote.fitReason}</p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-semibold tabular-nums text-ink-900 leading-tight">
              {fmt.money(quote.premium)}
            </div>
            <div className="text-xs text-ink-500 mt-0.5">annual premium</div>
            <div className="mt-2 flex items-center gap-1.5 justify-end flex-wrap">
              <Badge tone={apiBadge.tone}>{apiBadge.label}</Badge>
              <QuoteMatchBadge score={quote.score} />
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <DetailGroup title="Carrier appetite">
            {appetite ? (
              <dl className="text-xs space-y-1">
                <Row label="Asset type" value={appetite.assetType.replace(/_/g, " ")} />
                <Row
                  label="Value band"
                  value={`${appetite.minValue ? fmt.money(appetite.minValue) : "—"} – ${
                    appetite.maxValue ? fmt.money(appetite.maxValue) : "—"
                  }`}
                />
                <Row label="Risk levels" value={appetite.riskLevels.join(", ")} />
                <Row
                  label="Pricing tendency"
                  value={`${appetite.pricingTendency.toFixed(2)} × market`}
                />
              </dl>
            ) : (
              <span className="text-xs text-ink-500">
                No appetite row on file for this asset type — quote is
                interpolated from carrier defaults.
              </span>
            )}
          </DetailGroup>

          <DetailGroup title="Eligibility checks">
            <dl className="text-xs space-y-1">
              <Row
                label="Asset type"
                value={
                  carrier?.preferredAssetTypes.includes(assetType) ? (
                    <Badge tone="success">writes this line</Badge>
                  ) : (
                    <Badge tone="warn">no preferred-asset listing</Badge>
                  )
                }
              />
              <Row
                label="State availability"
                value={
                  (carrier?.stateAvailability ?? []).length > 0
                    ? carrier!.stateAvailability.slice(0, 6).join(", ") +
                      (carrier!.stateAvailability.length > 6 ? "…" : "")
                    : "—"
                }
              />
              {(carrier?.restrictedRisks ?? []).length > 0 && (
                <Row
                  label="Restrictions"
                  value={
                    <ul className="list-disc pl-4">
                      {(carrier!.restrictedRisks ?? []).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  }
                />
              )}
            </dl>
          </DetailGroup>
        </div>

        <DetailGroup title="Premium breakdown">
          <ul className="divide-y divide-ink-100 text-xs">
            {lineItems.map((li) => (
              <li
                key={li.label}
                className="py-1.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink-800">{li.label}</div>
                  <div className="text-[11px] text-ink-500">{li.detail}</div>
                </div>
                <div className="tabular-nums text-ink-800">{fmt.money(li.amount)}</div>
              </li>
            ))}
            <li className="py-2 flex items-center justify-between gap-3 font-semibold text-ink-900">
              <span>Estimated annual premium</span>
              <span className="tabular-nums">{fmt.money(quote.premium)}</span>
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-500">
            Line items are AI-interpolated from the headline premium and the
            standard coverage mix for {assetType.replace(/_/g, " ") || "this line"};
            the carrier's real quote document supersedes these once bound.
          </p>
        </DetailGroup>

        <DetailGroup title="Carrier runner">
          <dl className="text-xs space-y-1">
            <Row
              label="Playbook status"
              value={<Badge tone={runnerStatus.tone}>{runnerStatus.label}</Badge>}
            />
            <Row
              label="Runner"
              value={quote.providerTrace?.providerLabel ?? "AI carrier portal runner"}
            />
            <Row label="Status" value={apiBadge.label} />
            {quote.providerTrace && (
              <>
                <Row label="Runner reference" value={quote.providerTrace.requestId} />
                {quote.providerTrace.executionId && (
                  <Row label="Carrier job" value={quote.providerTrace.executionId} />
                )}
                {quote.providerTrace.runnerTrace && (
                  <>
                    <Row
                      label="Runner status"
                      value={`${quote.providerTrace.runnerTrace.status.replace(/_/g, " ")} - ${quote.providerTrace.runnerTrace.mode.replace(/_/g, " ")}`}
                    />
                    <Row
                      label="Mapped fields"
                      value={`${quote.providerTrace.runnerTrace.mappedFieldCount} total / ${quote.providerTrace.runnerTrace.requiredFieldCount} required`}
                    />
                    {quote.providerTrace.runnerTrace.extractedQuote && (
                      <Row
                        label="Quote number"
                        value={quote.providerTrace.runnerTrace.extractedQuote.quoteNumber}
                      />
                    )}
                  </>
                )}
              </>
            )}
            {carrierPortalUrl && (
              <Row
                label="Carrier portal"
                value={
                  <a
                    href={carrierPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                  >
                    Open carrier portal
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            )}
            {implementation && (
              <>
                <Row label="Implemented policy" value={`Policy #${implementation.policyId.slice(-6).toUpperCase()}`} />
                <Row label="Carrier reference" value={implementation.carrierReference} />
                <Row label="Implementation mode" value="Quotex record / carrier portal pending" />
                {implementation.bindingTrace && (
                  <>
                    <Row
                      label="Carrier binding"
                      value={
                        implementation.bindingTrace.status === "bound_on_carrier"
                          ? "Registered on carrier"
                          : implementation.bindingTrace.status === "manual_required"
                            ? "Manual carrier issue required"
                            : implementation.bindingTrace.status === "failed"
                              ? "Carrier bind failed"
                              : "Prepared, not sent"
                      }
                    />
                    <Row label="Bind request" value={implementation.bindingTrace.requestId} />
                  </>
                )}
              </>
            )}
          </dl>
          {carrier?.portalPlaybook && (
            <div className="mt-3 border-t border-ink-100 pt-2 text-[11px] text-ink-600">
              <div className="font-semibold text-ink-700">Runner playbook</div>
              <ul className="mt-1 space-y-1">
                <li>
                  <span className="font-semibold">Documents:</span>{" "}
                  {carrier.portalPlaybook.documents.slice(0, 3).join(" -> ") || "Manual workflow only."}
                </li>
                <li>
                  <span className="font-semibold">Claims:</span>{" "}
                  {carrier.portalPlaybook.claims.slice(0, 3).join(" -> ") || "Manual workflow only."}
                </li>
                <li>
                  <span className="font-semibold">Quotes:</span>{" "}
                  {carrier.portalPlaybook.quotes.slice(0, 3).join(" -> ") || "Manual workflow only."}
                </li>
                <li>
                  <span className="font-semibold">Stop if:</span>{" "}
                  {carrier.portalPlaybook.stopConditions.slice(0, 3).join(" | ")}
                </li>
              </ul>
            </div>
          )}
          {quote.providerTrace?.messages.filter((message) => !isLegacyCarrierProviderMessage(message)).length ? (
            <ul className="mt-3 space-y-1 border-t border-ink-100 pt-2 text-[11px] text-ink-600">
              {quote.providerTrace.messages
                .filter((message) => !isLegacyCarrierProviderMessage(message))
                .slice(0, 4)
                .map((message) => (
                <li key={message} className="flex gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-700" />
                  <span>{message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {quote.providerTrace?.runnerTrace?.validationChecks.length ? (
            <ul className="mt-3 space-y-1 border-t border-ink-100 pt-2 text-[11px] text-ink-600">
              {quote.providerTrace.runnerTrace.validationChecks.slice(0, 5).map((check) => (
                <li key={check.label} className="flex gap-1.5">
                  {check.status === "pass" ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-700" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-gold-700" />
                  )}
                  <span>
                    <span className="font-semibold">{check.label}:</span> {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {implementation?.bindingTrace?.messages.length ? (
            <ul className="mt-3 space-y-1 border-t border-ink-100 pt-2 text-[11px] text-ink-600">
              {implementation.bindingTrace.messages.slice(0, 5).map((message) => (
                <li key={message} className="flex gap-1.5">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-gold-700" />
                  <span>{message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </DetailGroup>

        {(carrier?.appetiteNotes || carrier?.tendencyNotes || carrier?.underwritingRules) && (
          <DetailGroup title="Underwriting context">
            <div className="text-xs text-ink-700 space-y-2 whitespace-pre-wrap">
              {carrier.appetiteNotes && (
                <p>
                  <span className="font-semibold">Appetite:</span> {carrier.appetiteNotes}
                </p>
              )}
              {carrier.tendencyNotes && (
                <p>
                  <span className="font-semibold">Tendency:</span> {carrier.tendencyNotes}
                </p>
              )}
              {carrier.underwritingRules && (
                <p>
                  <span className="font-semibold">Rules:</span> {carrier.underwritingRules}
                </p>
              )}
            </div>
          </DetailGroup>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-ink-100 flex-wrap">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <X className="h-3.5 w-3.5" /> Close
          </button>
          {carrierNotice && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {carrierNotice}
            </span>
          )}
          <div className="ml-auto flex items-center justify-end gap-2 flex-wrap">
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => saveQuotePacketAsPdf(session, [currentQuote])}
              title="Download this quote PDF"
            >
              <FileText className="h-3.5 w-3.5" /> Download
            </button>
            <button
              type="button"
              className="btn-outline text-sm"
              onClick={() => {
                if (carrierPortalUrl) {
                  window.open(carrierPortalUrl, "_blank", "noopener,noreferrer");
                  return;
                }
                setCarrierNotice("No carrier portal URL is configured.");
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" /> View on carrier
            </button>
            <SendQuoteToContactButton
              session={session}
              quote={currentQuote}
              lineItems={lineItems}
              carrierName={carrier?.name ?? "the carrier"}
              onChanged={onChanged}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// One-click send: composes a plain-text email summarizing the
// recommended quote and writes it as an outbound Communication so
// it lands in the contact's thread. Disabled while sending +
// shows a "Sent" confirmation chip after.
function friendlyCarrierFitSummary(rawReason: string, carrierName: string): string {
  const text = rawReason.toLowerCase();
  const parts: string[] = [];
  if (text.includes("appetite match")) {
    parts.push(`${carrierName}'s appetite matches this line of business`);
  }
  if (text.includes("value in band")) {
    parts.push("the value/limit falls inside the carrier's preferred band");
  }
  const stateMatch = rawReason.match(/writes in ([A-Z]{2})/);
  if (stateMatch?.[1]) {
    parts.push(`the carrier writes in ${stateMatch[1]}`);
  }
  if (text.includes("preferred pricing tendency")) {
    parts.push("pricing is favorable compared with the rest of the panel");
  } else if (text.includes("market pricing tendency")) {
    parts.push("pricing is in line with the market");
  } else if (text.includes("premium pricing tendency")) {
    parts.push("pricing is higher, but the carrier fit remains strong");
  }
  if (parts.length === 0) {
    return rawReason.replace(/\s+-\s+/g, "; ").replace(/\s*\u00b7\s*/g, ", ");
  }
  return `${parts.join(", ")}.`;
}

function recommendedQuoteWhyCarrierLines({
  session,
  quote,
  lineItems,
  carrierName,
}: {
  session: QuotingSession;
  quote: CarrierQuote;
  lineItems: { label: string; detail: string; amount: number }[];
  carrierName: string;
}): string[] {
  const assetLabel = session.categoryLabel || api.helpers.assetTypeLabel(session.assetType);
  const stateText = session.state ? ` in ${session.state}` : "";
  const valueText =
    session.estimatedValue && session.estimatedValue > 0
      ? ` with ${fmt.money(session.estimatedValue)} of value/limit on file`
      : "";
  const fitReason = friendlyCarrierFitSummary(quote.fitReason, carrierName);
  const confidence = Math.round(quote.confidence * 100);
  const score = quoteMatchPercent(quote.score);
  const primaryCoverage = lineItems
    .slice(0, 3)
    .map((item) => item.label)
    .join(", ");

  return [
    `  ${score}% MATCH`,
    `  ${carrierName} is the strongest fit for your ${assetLabel.toLowerCase()}${stateText}${valueText}.`,
    `  - Appetite: ${fitReason}`,
    `  - Price: ${fmt.money(quote.premium)} annual indication with ${confidence}% confidence before final underwriting.`,
    primaryCoverage
      ? `  - Coverage: reviewed against ${primaryCoverage}.`
      : `  - Coverage: based on the coverage information currently in the quoting workspace.`,
    `  Final terms still depend on carrier underwriting, selected deductibles, credits, and required forms.`,
  ];
}

type QuoteRecommendationDraft = {
  subject: string;
  body: string;
  attachments: CommunicationAttachment[];
};

function SendQuoteToContactButton({
  session,
  quote,
  lineItems,
  carrierName,
  onChanged,
}: {
  session: QuotingSession;
  quote: CarrierQuote;
  lineItems: { label: string; detail: string; amount: number }[];
  carrierName: string;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState<QuoteRecommendationDraft | null>(null);

  const contact = session.prospectId
    ? api.prospects.get(session.prospectId)
    : session.customerId
    ? api.customers.get(session.customerId)
    : null;
  if (!contact) return null;
  const firstName = contact.name.split(/\s+/)[0];
  const toLabel = `${contact.name}${contact.email ? ` - ${contact.email}` : ""}`;
  const sender = session.createdById ? api.users.get(session.createdById) : undefined;
  const senderAgency = api.agencies.get(sender?.tenantId ?? session.tenantId);
  const signatureBlock = sender
    ? emailSignatureBlockForUser(
        sender,
        senderAgency?.logoUrl
          ? { name: `${senderAgency.name} logo`, dataUrl: senderAgency.logoUrl }
          : null
      )
    : null;

  function buildDraft(): QuoteRecommendationDraft {
    const lines = lineItems
      .map((li) => `  - ${li.label}: ${fmt.money(li.amount)}\n    ${li.detail}`)
      .join("\n");
    const matchPercent = quoteMatchPercent(quote.score);
    const whyCarrierLines = recommendedQuoteWhyCarrierLines({
      session,
      quote,
      lineItems,
      carrierName,
    });
    return {
      subject: `Recommended quote - ${carrierName}`,
      body: [
        `Hi ${firstName},`,
        ``,
        `Based on the information we have on file, I'd recommend prioritizing ${carrierName}.`,
        `I attached the quote PDF so you can review the premium, match score, and coverage breakdown in one place.`,
        ``,
        `Quote snapshot:`,
        `  Carrier: ${carrierName}`,
        `  Match: ${matchPercent}%`,
        `  Annual premium: ${fmt.money(quote.premium)}`,
        ``,
        `Why this carrier (${matchPercent}% match):`,
        ...whyCarrierLines,
        ``,
        `Coverage summary:`,
        lines,
        ``,
        `Let me know if you'd like to move forward or want me to compare against other options on our panel - happy to walk through any of it on a quick call.`,
      ].join("\n"),
      attachments: [quotePacketAttachment(session, [quote])],
    };
  }

  function openDraftReview() {
    setDraft(buildDraft());
    setDraftOpen(true);
  }

  async function sendReviewedDraft() {
    if (!draft) return;
    setBusy(true);
    try {
      api.communications.create({
        tenantId: session.tenantId,
        customerId: session.customerId,
        prospectId: session.prospectId,
        channel: "email",
        direction: "outbound",
        subject: draft.subject,
        body: draft.body,
        attachments: draft.attachments.length > 0 ? draft.attachments : undefined,
        createdById: session.createdById,
      });
      onChanged?.();
      setSentAt(new Date().toISOString());
      setDraftOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (sentAt) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 px-2 py-1 rounded bg-emerald-50 border border-emerald-200">
        <CheckCircle2 className="h-3.5 w-3.5" /> Sent to {firstName}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn-primary text-sm"
        onClick={openDraftReview}
        disabled={busy}
        title={`Review and email this recommendation to ${contact.name}.`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
        {busy ? "Sending..." : "View send"}
      </button>
      <QuoteRecommendationDraftReviewModal
        open={draftOpen}
        toLabel={toLabel}
        tenantId={session.tenantId}
        uploadedById={session.createdById}
        draft={draft}
        signatureBlock={signatureBlock}
        busy={busy}
        onClose={() => setDraftOpen(false)}
        onChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
        onSend={sendReviewedDraft}
      />
    </>
  );
}

function QuoteRecommendationDraftReviewModal({
  open,
  toLabel,
  tenantId,
  uploadedById,
  draft,
  signatureBlock,
  busy,
  onClose,
  onChange,
  onSend,
}: {
  open: boolean;
  toLabel: string;
  tenantId: string;
  uploadedById?: string;
  draft: QuoteRecommendationDraft | null;
  signatureBlock: EmailSignatureBlock | null;
  busy: boolean;
  onClose: () => void;
  onChange: (patch: Partial<QuoteRecommendationDraft>) => void;
  onSend: () => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUploadedAt = useMemo(() => new Date().toISOString(), [open]);

  useEffect(() => {
    if (!open) setPreviewDocument(null);
  }, [open]);

  async function handleFiles(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0 || !draft) return;
    setAttaching(true);
    try {
      const added: CommunicationAttachment[] = (await Promise.all(picked.map(fileToCommunicationAttachment))).map(
        (attachment) => ({
          ...attachment,
          id: `manual_${attachment.id}`,
          description: attachment.description ?? "Inserted client quote email attachment",
        })
      );
      onChange({ attachments: [...draft.attachments, ...added] });
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    if (!draft) return;
    onChange({ attachments: draft.attachments.filter((attachment) => attachment.id !== id) });
  }

  return (
    <>
    <Modal open={open} onClose={onClose} title="Review client quote email" size="xl">
      <div className="space-y-4">
        {!draft ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            No recommendation draft is available.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">To</label>
              <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700">
                {toLabel}
              </div>
            </div>
            <div>
              <label className="label">Subject</label>
              <input
                className="input text-sm"
                value={draft.subject}
                onChange={(event) => onChange({ subject: event.target.value })}
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="label mb-0">Attachments</label>
                <button
                  type="button"
                  className="btn-outline text-[11px] !px-2.5 !py-1.5"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy || attaching}
                  title="Insert a file from your computer"
                >
                  {attaching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <Paperclip className="h-3.5 w-3.5" />
                  Insert file
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  onChange={(event) => void handleFiles(event.target.files)}
                />
              </div>
              <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
                {draft.attachments.length === 0 ? (
                  <div className="text-xs text-ink-500">No files inserted.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.attachments.map((attachment) => (
                      <span
                        key={attachment.id}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-gold-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gold-900"
                        title={attachment.description}
                      >
                        <button
                          type="button"
                          className="inline-flex min-w-0 items-center gap-1 text-left hover:text-black"
                          onClick={() =>
                            setPreviewDocument(
                              emailDraftAttachmentPreviewDocument(attachment, {
                                tenantId,
                                uploadedById,
                                uploadedAt: previewUploadedAt,
                              })
                            )
                          }
                          title={`Preview ${attachment.fileName}`}
                        >
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{attachment.fileName}</span>
                          {attachment.sizeBytes ? (
                            <span className="shrink-0 text-[10px] text-ink-500">
                              {formatAttachmentSize(attachment.sizeBytes)}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="shrink-0 text-ink-400 hover:text-rose-600"
                          onClick={() => removeAttachment(attachment.id)}
                          disabled={busy}
                          title={`Remove ${attachment.fileName}`}
                          aria-label={`Remove ${attachment.fileName}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="label">Email body</label>
              <textarea
                className="input h-[300px] min-h-[300px] resize-y text-sm leading-6"
                value={draft.body}
                onChange={(event) => onChange({ body: event.target.value })}
              />
            </div>
            <EmailSignaturePreview signature={signatureBlock} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onClose}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy || !draft?.subject.trim() || !draft?.body.trim()}
            onClick={onSend}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            {busy ? "Sending..." : "Send message"}
          </button>
        </div>
      </div>
      </Modal>
      <DocumentViewerModal
        document={previewDocument}
        open={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
      />
    </>
  );
}

function EmailSignaturePreview({ signature }: { signature: EmailSignatureBlock | null }) {
  if (!signature) return null;
  return (
    <div>
      <label className="label">Email signature</label>
      <div className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-sm text-ink-700">
        <div className="text-ink-400 leading-none">--</div>
        {signature.text && (
          <div className="mt-1 whitespace-pre-wrap break-words leading-snug">
            {signature.text}
          </div>
        )}
        {(signature.images ?? []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(signature.images ?? []).map((image, index) =>
              image.dataUrl ? (
                <img
                  key={`${image.name}-${index}`}
                  src={image.dataUrl}
                  alt={image.name}
                  className="max-h-16 max-w-[160px] rounded bg-white object-contain"
                />
              ) : (
                <span
                  key={`${image.name}-${index}`}
                  className="rounded border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-500"
                >
                  {image.name}
                </span>
              )
            )}
          </div>
        )}
        {signature.electronicSignature?.name && (
          <div className="mt-2 max-w-full overflow-x-auto overflow-y-hidden py-1">
            <div
              className="whitespace-nowrap text-ink-900"
              style={electronicSignaturePreviewStyle(signature.electronicSignature)}
            >
              {signature.electronicSignature.name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-ink-100 bg-ink-50/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-500 shrink-0">{label}</dt>
      <dd className="text-ink-800 text-right max-w-[60%]">{value}</dd>
    </div>
  );
}
