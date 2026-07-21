import { prisma } from "./prisma.js";
import { aiParseCarrierReply } from "./ai/index.js";
import {
  parseCarrierReplyDeterministically,
  type ParsedCarrierReply,
} from "./carrierReplyParser.js";
import { readRemoteState, writeRemoteState } from "./supabaseState.js";

type CarrierReplyRow = {
  id: string;
  tenant_id: string;
  subject: string | null;
  body: string;
  body_html: string | null;
  attachments: unknown;
  resolution: unknown;
  sent_at: Date | null;
  created_at: Date;
};

type ProcessingSummary = {
  candidates: number;
  processed: number;
  alreadyProcessed: number;
  unmatched: number;
  failed: number;
};

const MAX_WRITE_ATTEMPTS = 5;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizedAiReply(value: Awaited<ReturnType<typeof aiParseCarrierReply>>): ParsedCarrierReply {
  const allowedOutcomes = new Set<ParsedCarrierReply["outcome"]>([
    "accepted",
    "quoted",
    "declined",
    "pending",
    "more_info_required",
  ]);
  return {
    ...value,
    outcome: allowedOutcomes.has(value.outcome as ParsedCarrierReply["outcome"])
      ? (value.outcome as ParsedCarrierReply["outcome"])
      : "pending",
  };
}

function currencyNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amount = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

function stateId(): string {
  const configured = process.env.STATE_SYNC_ID?.trim() || process.env.VITE_STATE_SYNC_ID?.trim() || "default";
  return `app_state:${configured}`;
}

function replyAttachments(value: unknown): Array<{ id?: string; fileName?: string; fileType?: string; description?: string }> {
  return objectArray(value).map((attachment) => ({
    id: stringValue(attachment.id) || undefined,
    fileName: stringValue(attachment.fileName) || undefined,
    fileType: stringValue(attachment.fileType) || undefined,
    description: stringValue(attachment.description) || undefined,
  }));
}

async function parseReply(row: CarrierReplyRow, submission: Record<string, unknown>): Promise<ParsedCarrierReply> {
  const email = {
    subject: row.subject ?? undefined,
    text: row.body,
    html: row.body_html ?? undefined,
    attachments: replyAttachments(row.attachments),
  };
  const deterministic = parseCarrierReplyDeterministically(email);
  if (deterministic.confidence >= 0.8 && !deterministic.requiresAgentReview) return deterministic;
  try {
    return normalizedAiReply(await aiParseCarrierReply({
      submission: {
        submissionId: stringValue(submission.submissionId),
        carrierId: stringValue(submission.carrierId),
        status: stringValue(submission.status),
      },
      email,
    }));
  } catch (error) {
    console.warn("Carrier reply AI parsing fell back to deterministic extraction", {
      communicationId: row.id,
      message: error instanceof Error ? error.message : "Unknown AI parsing error.",
    });
    return deterministic;
  }
}

function processingRecord(input: {
  tenantId: string;
  communicationId: string;
  sessionId: string;
  submissionId: string;
  parsed: ParsedCarrierReply;
  processedAt: string;
}) {
  return {
    id: `carrier_email_${input.tenantId}_${input.communicationId}`,
    tenantId: input.tenantId,
    communicationId: input.communicationId,
    outcome: input.parsed.requiresAgentReview ? "manual_review" : "matched_processed",
    matchedSessionId: input.sessionId,
    matchedSubmissionId: input.submissionId,
    matchReason: "mailbox_reply_target",
    classification: input.parsed.outcome,
    parseConfidence: input.parsed.confidence,
    processedAt: input.processedAt,
    createdAt: input.processedAt,
    updatedAt: input.processedAt,
  };
}

function applyReplyToSnapshot(input: {
  snapshot: unknown;
  tenantId: string;
  row: CarrierReplyRow;
  submissionId: string;
  parsed: ParsedCarrierReply;
  processedAt: string;
}): { snapshot: Record<string, unknown>; outcome: "processed" | "already_processed" | "unmatched" } {
  const snapshot = asRecord(input.snapshot);
  const sessions = objectArray(snapshot.quotingSessions);
  const sessionIndex = sessions.findIndex((session) =>
    stringValue(session.tenantId) === input.tenantId &&
    objectArray(session.commercialCarrierSubmissions).some(
      (submission) => stringValue(submission.submissionId) === input.submissionId
    )
  );
  if (sessionIndex < 0) return { snapshot, outcome: "unmatched" };

  const session = sessions[sessionIndex];
  const submissions = objectArray(session.commercialCarrierSubmissions);
  const submissionIndex = submissions.findIndex(
    (submission) => stringValue(submission.submissionId) === input.submissionId
  );
  if (submissionIndex < 0) return { snapshot, outcome: "unmatched" };
  const submission = submissions[submissionIndex];
  const existingReplyIds = stringArray(submission.replyCommunicationIds);
  const processingRows = objectArray(snapshot.carrierEmailProcessing);
  const processingIndex = processingRows.findIndex(
    (item) => stringValue(item.tenantId) === input.tenantId && stringValue(item.communicationId) === input.row.id
  );
  if (existingReplyIds.includes(input.row.id) && processingIndex >= 0) {
    return { snapshot, outcome: "already_processed" };
  }

  const attachmentNames = new Set(input.parsed.supplementalAttachmentNames.map((name) => name.toLowerCase()));
  const supplementalAttachmentIds = replyAttachments(input.row.attachments)
    .filter((attachment) =>
      /pdf|supplement|application|questionnaire|loss.?run/i.test(
        `${attachment.fileName ?? ""} ${attachment.fileType ?? ""} ${attachment.description ?? ""}`
      ) || attachmentNames.has((attachment.fileName ?? "").toLowerCase())
    )
    .map((attachment) => attachment.id)
    .filter((id): id is string => Boolean(id));
  const requiresReview = input.parsed.requiresAgentReview || input.parsed.confidence < 0.72;
  const status = requiresReview
    ? "agent_review"
    : input.parsed.outcome === "declined"
      ? "declined"
      : input.parsed.outcome === "more_info_required"
        ? supplementalAttachmentIds.length > 0 ? "needs_supplemental" : "needs_client_info"
        : input.parsed.outcome === "accepted" || input.parsed.outcome === "quoted"
          ? "accepted"
          : "agent_review";
  const premium = currencyNumber(input.parsed.premiums[0]);
  const missingFields = input.parsed.requestedItems.length > 0
    ? input.parsed.requestedItems
    : status === "needs_supplemental"
      ? input.parsed.supplementalAttachmentNames.map((name) => `Complete ${name}`)
      : [];
  const nextSubmission: Record<string, unknown> = {
    ...submission,
    status,
    responseAt: input.processedAt,
    acceptedAt: status === "accepted" ? input.processedAt : submission.acceptedAt,
    responseDeadline: input.parsed.responseDeadline,
    replyCommunicationIds: unique([...existingReplyIds, input.row.id]),
    quote: {
      outcome: input.parsed.outcome,
      policyType: input.parsed.policyType,
      coverages: input.parsed.coverages,
      limits: input.parsed.limits,
      premiums: input.parsed.premiums,
      deductibles: input.parsed.deductibles,
      terms: input.parsed.terms,
      carrierNotes: input.parsed.carrierNotes,
      conditions: input.parsed.conditions,
      nextSteps: input.parsed.nextSteps,
      requestedItems: input.parsed.requestedItems,
      supplementalAttachmentIds,
      declineReason: input.parsed.declineReason,
      evidenceSnippets: input.parsed.evidenceSnippets,
      responseDeadline: input.parsed.responseDeadline,
      parsedAt: input.processedAt,
      confidence: input.parsed.confidence,
    },
    parseConfidence: input.parsed.confidence,
    premiumEstimate: premium ?? submission.premiumEstimate,
    finalPremium: status === "accepted" ? premium ?? submission.finalPremium : submission.finalPremium,
    declinedReason: input.parsed.declineReason,
    underwriterNotes: unique([
      ...input.parsed.carrierNotes,
      ...input.parsed.conditions,
      ...input.parsed.nextSteps,
    ]).join(" "),
    missingFields,
    supplementalDocumentIds: stringArray(submission.supplementalDocumentIds),
    agentReviewReason: status === "agent_review"
      ? input.parsed.agentReviewReason ?? "Carrier reply requires agent review before the workflow advances."
      : undefined,
    aiRationale: status === "agent_review"
      ? input.parsed.agentReviewReason ?? "Carrier reply requires agent review before the workflow advances."
      : `Carrier reply parsed from inbound message ${input.row.id}; outcome ${input.parsed.outcome}.`,
  };
  const nextSubmissions = submissions.map((item, index) => index === submissionIndex ? nextSubmission : item);
  const hasMissingInfo = nextSubmissions.some((item) => ["needs_client_info", "needs_supplemental"].includes(stringValue(item.status)));
  const hasAgentReview = nextSubmissions.some((item) => stringValue(item.status) === "agent_review");
  const quotedCount = nextSubmissions.filter((item) =>
    stringValue(item.status) === "accepted" && Number(item.finalPremium ?? item.premiumEstimate ?? 0) > 0
  ).length;
  const nextSession = {
    ...session,
    commercialCarrierSubmissions: nextSubmissions,
    missingFields: unique([...stringArray(session.missingFields), ...missingFields]),
    status: hasMissingInfo ? "awaiting_reply" : quotedCount > 0 ? "quoting" : session.status,
    aiSummary: hasAgentReview
      ? "One or more carrier replies need agent review before Quotex advances the workflow."
      : hasMissingInfo
        ? "Carrier replies were processed and supplemental information is ready for review."
        : quotedCount > 0
          ? `Carrier replies were processed with ${quotedCount} quoted market${quotedCount === 1 ? "" : "s"} ready for ranking.`
          : "Carrier replies were processed and the workflow is awaiting a final carrier outcome.",
    updatedAt: input.processedAt,
  };
  const nextProcessing = processingRecord({
    tenantId: input.tenantId,
    communicationId: input.row.id,
    sessionId: stringValue(session.id),
    submissionId: input.submissionId,
    parsed: input.parsed,
    processedAt: input.processedAt,
  });
  const updatedProcessingRows = processingIndex >= 0
    ? processingRows.map((item, index) => index === processingIndex ? { ...item, ...nextProcessing, createdAt: item.createdAt ?? input.processedAt } : item)
    : [...processingRows, nextProcessing];

  return {
    outcome: "processed",
    snapshot: {
      ...snapshot,
      quotingSessions: sessions.map((item, index) => index === sessionIndex ? nextSession : item),
      carrierEmailProcessing: updatedProcessingRows,
    },
  };
}

async function markNormalizedReplyProcessed(row: CarrierReplyRow, processedAt: string, parsed: ParsedCarrierReply) {
  await prisma.$executeRaw`
    UPDATE communications
    SET resolution = COALESCE(resolution, '{}'::jsonb) || ${JSON.stringify({
      carrierProcessedAt: processedAt,
      carrierOutcome: parsed.outcome,
      parseConfidence: parsed.confidence,
    })}::jsonb,
        updated_at = now()
    WHERE id = ${row.id}
      AND tenant_id = ${row.tenant_id}
  `;
}

async function processRow(row: CarrierReplyRow): Promise<"processed" | "already_processed" | "unmatched"> {
  const submissionId = stringValue(asRecord(row.resolution).carrierSubmissionId);
  if (!submissionId) return "unmatched";
  let parsed: ParsedCarrierReply | null = null;

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const current = await readRemoteState(stateId());
    if (!current) return "unmatched";
    const snapshot = asRecord(current.snapshot);
    const session = objectArray(snapshot.quotingSessions).find((candidate) =>
      stringValue(candidate.tenantId) === row.tenant_id &&
      objectArray(candidate.commercialCarrierSubmissions).some(
        (submission) => stringValue(submission.submissionId) === submissionId
      )
    );
    if (!session) return "unmatched";
    const submission = objectArray(session.commercialCarrierSubmissions).find(
      (candidate) => stringValue(candidate.submissionId) === submissionId
    );
    if (!submission) return "unmatched";
    if (!parsed) parsed = await parseReply(row, submission);
    const processedAt = new Date().toISOString();
    const applied = applyReplyToSnapshot({
      snapshot,
      tenantId: row.tenant_id,
      row,
      submissionId,
      parsed,
      processedAt,
    });
    if (applied.outcome !== "processed") return applied.outcome;
    const result = await writeRemoteState(stateId(), applied.snapshot, current.revision);
    if (result.ok) {
      await markNormalizedReplyProcessed(row, processedAt, parsed);
      return "processed";
    }
  }
  throw new Error(`Carrier reply state update conflicted ${MAX_WRITE_ATTEMPTS} times.`);
}

export async function processPersistedCarrierReplies(input: {
  tenantId: string;
  limit?: number;
}): Promise<ProcessingSummary> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = await prisma.$queryRaw<CarrierReplyRow[]>`
    SELECT id, tenant_id, subject, body, body_html, attachments, resolution, sent_at, created_at
    FROM communications
    WHERE tenant_id = ${input.tenantId}
      AND channel = 'email'
      AND direction = 'inbound'
      AND COALESCE(resolution->>'carrierSubmissionId', '') <> ''
    ORDER BY COALESCE(sent_at, created_at) ASC
    LIMIT ${limit}
  `;
  const summary: ProcessingSummary = {
    candidates: rows.length,
    processed: 0,
    alreadyProcessed: 0,
    unmatched: 0,
    failed: 0,
  };
  for (const row of rows) {
    try {
      const outcome = await processRow(row);
      if (outcome === "processed") summary.processed += 1;
      else if (outcome === "already_processed") summary.alreadyProcessed += 1;
      else summary.unmatched += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("Persisted carrier reply processing failed", {
        tenantId: input.tenantId,
        communicationId: row.id,
        message: error instanceof Error ? error.message : "Unknown processing error.",
      });
    }
  }
  return summary;
}
