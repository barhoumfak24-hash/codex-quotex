import { readRemoteState, writeRemoteState } from "./supabaseState.js";

type QuestionnaireLine = "personal" | "commercial";

interface SnapshotQuestion {
  id?: unknown;
  section?: unknown;
  label?: unknown;
  kind?: unknown;
  options?: unknown;
  required?: unknown;
  round?: unknown;
  carrierId?: unknown;
}

interface SnapshotSession {
  id?: unknown;
  status?: unknown;
  lineOfBusiness?: unknown;
  customerId?: unknown;
  prospectId?: unknown;
  questionnaireQuestions?: unknown;
  questionnaireResponses?: unknown;
  questionnaireResponseMeta?: unknown;
  questionnaireSentAt?: unknown;
  questionnaireAccessToken?: unknown;
  commercialApplicationSentAt?: unknown;
  commercialSecondRoundSentAt?: unknown;
  commercialSupplementalsCompletedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  [key: string]: unknown;
}

interface SnapshotContact {
  id?: unknown;
  name?: unknown;
}

interface AppSnapshot {
  quotingSessions?: SnapshotSession[];
  customers?: SnapshotContact[];
  prospects?: SnapshotContact[];
  [key: string]: unknown;
}

export interface PublicQuestionnaireQuestion {
  id: string;
  section: string;
  label: string;
  kind: "text" | "textarea" | "select" | "number";
  options?: string[];
  required?: boolean;
}

export interface PublicQuestionnaire {
  status: string;
  lineOfBusiness: QuestionnaireLine;
  questions: PublicQuestionnaireQuestion[];
  responses: Record<string, string>;
  responseMeta: Record<string, unknown>;
  contactName: string;
  commercialApplicationSentAt?: string;
  commercialSecondRoundSentAt?: string;
  commercialSupplementalsCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type QuestionnaireMutationResult =
  | { ok: true; questionnaire: PublicQuestionnaire; missingRequired: string[] }
  | { ok: false; reason: "not_found" | "state_unavailable" | "conflict" };

function stateId(): string {
  const configured = process.env.STATE_SYNC_ID?.trim() || process.env.VITE_STATE_SYNC_ID?.trim() || "default";
  return `app_state:${configured}`;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function lineOfBusiness(session: SnapshotSession): QuestionnaireLine {
  return session.lineOfBusiness === "commercial" ? "commercial" : "personal";
}

function normalizeQuestion(value: SnapshotQuestion): PublicQuestionnaireQuestion | null {
  const id = stringValue(value.id);
  const label = stringValue(value.label);
  if (!id || !label) return null;
  const kind = ["text", "textarea", "select", "number"].includes(stringValue(value.kind))
    ? (stringValue(value.kind) as PublicQuestionnaireQuestion["kind"])
    : "text";
  const options = Array.isArray(value.options)
    ? value.options.map(stringValue).filter(Boolean).slice(0, 100)
    : undefined;
  return {
    id,
    section: stringValue(value.section) || "Quote details",
    label,
    kind,
    ...(options?.length ? { options } : {}),
    ...(value.required === true ? { required: true } : {}),
  };
}

function visibleQuestions(session: SnapshotSession): PublicQuestionnaireQuestion[] {
  const rawQuestions = Array.isArray(session.questionnaireQuestions)
    ? (session.questionnaireQuestions as SnapshotQuestion[])
    : [];
  const line = lineOfBusiness(session);
  const visible = rawQuestions.filter((question) => {
    if (line !== "commercial") return true;
    if (session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt) {
      return question.round === "second_round";
    }
    if (!session.commercialApplicationSentAt) {
      return !question.carrierId && question.round !== "second_round";
    }
    return question.round === "second_round";
  });
  return visible.map(normalizeQuestion).filter((question): question is PublicQuestionnaireQuestion => Boolean(question));
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stringValue(item)] as const)
      .filter(([key]) => Boolean(key))
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function publicResponseMeta(value: unknown): Record<string, unknown> {
  const source = objectRecord(value);
  return Object.fromEntries(
    Object.entries(source).flatMap(([questionId, rawMeta]) => {
      if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return [];
      const meta = rawMeta as Record<string, unknown>;
      const updatedAt = stringValue(meta.updatedAt);
      const updatedByName = stringValue(meta.updatedByName);
      const updatedByRole = stringValue(meta.updatedByRole);
      if (!updatedAt || !updatedByName || !updatedByRole) return [];
      return [[questionId, { updatedAt, updatedByName, updatedByRole }]];
    })
  );
}

function accessMatches(session: SnapshotSession, accessId: string): boolean {
  const token = stringValue(session.questionnaireAccessToken);
  if (token) return token === accessId;
  // Compatibility for links sent before opaque questionnaire tokens existed.
  return Boolean(session.questionnaireSentAt) && stringValue(session.id) === accessId;
}

function contactName(snapshot: AppSnapshot, session: SnapshotSession): string {
  const customerId = stringValue(session.customerId);
  const prospectId = stringValue(session.prospectId);
  const contact = customerId
    ? snapshot.customers?.find((item) => stringValue(item.id) === customerId)
    : prospectId
      ? snapshot.prospects?.find((item) => stringValue(item.id) === prospectId)
      : undefined;
  return stringValue(contact?.name) || "Client";
}

function publicQuestionnaire(snapshot: AppSnapshot, session: SnapshotSession): PublicQuestionnaire {
  return {
    status: stringValue(session.status) || "gathering_info",
    lineOfBusiness: lineOfBusiness(session),
    questions: visibleQuestions(session),
    responses: stringRecord(session.questionnaireResponses),
    responseMeta: publicResponseMeta(session.questionnaireResponseMeta),
    contactName: contactName(snapshot, session),
    ...(stringValue(session.commercialApplicationSentAt)
      ? { commercialApplicationSentAt: stringValue(session.commercialApplicationSentAt) }
      : {}),
    ...(stringValue(session.commercialSecondRoundSentAt)
      ? { commercialSecondRoundSentAt: stringValue(session.commercialSecondRoundSentAt) }
      : {}),
    ...(stringValue(session.commercialSupplementalsCompletedAt)
      ? { commercialSupplementalsCompletedAt: stringValue(session.commercialSupplementalsCompletedAt) }
      : {}),
    createdAt: stringValue(session.createdAt) || new Date(0).toISOString(),
    updatedAt: stringValue(session.updatedAt) || new Date(0).toISOString(),
  };
}

function snapshotValue(value: unknown): AppSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AppSnapshot;
}

function findSession(snapshot: AppSnapshot, accessId: string): SnapshotSession | undefined {
  return snapshot.quotingSessions?.find((session) => accessMatches(session, accessId));
}

export async function readPublicQuestionnaire(accessId: string): Promise<PublicQuestionnaire | null> {
  const row = await readRemoteState(stateId());
  const snapshot = snapshotValue(row?.snapshot);
  if (!snapshot) return null;
  const session = findSession(snapshot, accessId);
  return session ? publicQuestionnaire(snapshot, session) : null;
}

function acceptedResponses(
  session: SnapshotSession,
  incoming: Record<string, string>
): Record<string, string> {
  const allowed = new Set(visibleQuestions(session).map((question) => question.id));
  return Object.fromEntries(
    Object.entries(incoming)
      .filter(([key]) => allowed.has(key))
      .map(([key, value]) => [key, String(value ?? "").slice(0, 10_000)])
  );
}

function missingRequired(session: SnapshotSession, responses: Record<string, string>): string[] {
  return visibleQuestions(session)
    .filter((question) => question.required && !responses[question.id]?.trim())
    .map((question) => question.label);
}

export async function updatePublicQuestionnaire(
  accessId: string,
  incoming: Record<string, string>,
  submit: boolean
): Promise<QuestionnaireMutationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readRemoteState(stateId());
    const snapshot = snapshotValue(row?.snapshot);
    if (!row || !snapshot) return { ok: false, reason: "state_unavailable" };
    const session = findSession(snapshot, accessId);
    if (!session) return { ok: false, reason: "not_found" };

    const now = new Date().toISOString();
    const patch = acceptedResponses(session, incoming);
    const responses = { ...stringRecord(session.questionnaireResponses), ...patch };
    const previousMeta = objectRecord(session.questionnaireResponseMeta);
    const editorName = contactName(snapshot, session);
    const responseMeta = { ...previousMeta };
    for (const questionId of Object.keys(patch)) {
      responseMeta[questionId] = {
        updatedAt: now,
        updatedById: "questionnaire-recipient",
        updatedByName: editorName,
        updatedByRole: "customer",
      };
    }
    const missing = missingRequired(session, responses);
    const isCommercial = lineOfBusiness(session) === "commercial";
    const isSupplemental = Boolean(session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt);

    session.questionnaireResponses = responses;
    session.questionnaireResponseMeta = responseMeta;
    session.missingFields = missing;
    session.updatedAt = now;
    if (submit && (isCommercial || missing.length === 0)) {
      session.replyReceivedAt = now;
      session.status = isCommercial && !isSupplemental ? "gathering_info" : "quoting";
      if (isSupplemental) session.commercialSupplementalsCompletedAt = now;
    }

    const result = await writeRemoteState(stateId(), snapshot, row.revision);
    if (result.ok) {
      return {
        ok: true,
        questionnaire: publicQuestionnaire(snapshot, session),
        missingRequired: missing,
      };
    }
  }
  return { ok: false, reason: "conflict" };
}
