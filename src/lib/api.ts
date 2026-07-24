// =====================================================================
// API client — all data access in the frontend goes through here.
// Today: many demo workflows are backed by the browser-local db (`./db`).
// Production readiness requires moving each data domain to authenticated
// server routes before real agency data is imported.
// Tenant scoping is enforced here for safety (mock) and on server (real).
// =====================================================================

import {
  aiRankCarrierQuotes,
  aiClassifyActivityResolution,
  aiClassifyInboundForActivity,
  aiGeneratePersonalQuestionnaire,
  aiGenerateCommercialQuestionnaire,
  aiMapAcordFields,
  aiParseCarrierReply,
  INBOUND_TRIAGE_VERSION,
} from "./ai";
import { ACORD_FORM_CATALOG, type AcordFormSeed } from "./seed";
import {
  buildAssetLabelFromDetails,
  normalizeAssetDetails,
  uppercaseVinTokens,
} from "./assetDisplay";
import type {
  ActivityResolution,
  AiAcordFieldMapping,
  InboundDocumentServiceIntent,
  InboundQuoteIntakeQuestion,
  InboundServiceIntent,
} from "./ai";
import { db } from "./db";
import { fmt } from "./format";
import { uid, nowIso } from "./id";
import { apiBaseUrl } from "./apiBase";
import {
  currentServerSessionClaims,
  serverSessionHeaders,
} from "./serverSession";
import {
  generateConnectionSecret,
  generateAgencyCode,
  generateUsername,
  agencyCodeMatches,
  maskedAgencyCode,
  normalizeAgencyCode,
  protectAgencyCode,
  revealProtectedAgencyCode,
  slugifyAgency,
  tierProvisionPlan,
} from "./credentials";
import {
  assessWebsiteConnection,
  ensureWebsiteConnection,
  protectWebsiteApiKey,
  protectWebsiteWebhookSecret,
  revealWebsiteApiKey,
  revealWebsiteWebhookSecret,
} from "./websiteConnection";
import {
  addMonthsToDateInput,
  agencyPlanRenewalIso,
  agencyPlanTermMonths,
  dateInputFromIso,
  isoFromDateInput,
} from "./agencyContract";
import {
  billingHasMissingInfo,
  billingMethodLabel,
  billingStatusFor,
} from "./billing";
import {
  CARRIER_RUNNER_RENEWAL_LOOKAHEAD_DAYS,
  carrierRunnerJobIsOpen,
  carrierRunnerTriggerLabel,
  shouldQueueCarrierRunnerRenewalJob,
} from "./carrierRunnerJobs";
import { buildCarrierDirectory } from "./carrierDirectory";
import { categoryQuotingQuestions } from "./categoryQuestionnaires";
import {
  appendEmailSignatureBlock,
  emailSignatureBlockForUser,
} from "./emailSignature";
import {
  appendMarketingContactCta,
  MARKETING_SMART_CTA_LABEL,
  marketingSmartContactUrl,
  prependMarketingHeroImage,
} from "./marketingSmartLinks";
import { inferMailProvider } from "./mailProvider";
import {
  getCarrierQuoteProviderReadiness,
  runCarrierQuoteProviders,
} from "./quoteProviders";
import { runCarrierPortalRunner } from "./carrierPortalRunner";
import {
  prepareCarrierPolicyBinding,
  runCarrierPolicyBinding,
} from "./carrierBindingProviders";
import {
  assetTypeDisplayName as sharedAssetTypeDisplayName,
  decodeVinViaNhtsa,
  deriveAssetLabel,
  looksLikeVin,
  normalizeVin,
  vinValidationIssue,
} from "./assetLabels";
import { isLockingMasterAccount } from "./masterAccount";
import {
  isDocumentOnlyAcordSession,
  isQuotingWorkflowOpen,
  newestOpenQuotingSessionsPerContact,
} from "./quotingWorkflows";
import {
  extractQuoteReplyIntake,
  normalizedQuoteIdentifier,
  type PersonalQuoteReplyIntake,
} from "./personalQuoteAutomation";
import { agencyMonthlyPriceUsd, TIER_LIMITS } from "./tiers";
import {
  buildDocumentTemplateFields,
  documentTypeLabelForTemplate,
  normalizeTemplateFields,
} from "./documentTemplateFields";
import { detectFillableDocumentFields } from "./fillableDocumentFields";
import {
  acordDefinitionForTemplate,
  acordQuestionCountForTemplate,
  buildAcordQuestionsForTemplate,
  countAcordAutoFilledFields,
  getAcordFormNumber,
} from "./acordQuestionnaires";
import { fillAcordFromClientDossier } from "./acordAiFillEngine";
import {
  buildAcroFormFillPlan,
  bytesToPdfDataUrl,
  extractAcroFormFields,
  fillPdfAcroForm,
} from "./pdfAcroForm";
import {
  aiEvidenceAllowsQuestionnairePrefill,
  aiEvidenceAllowsDocumentAutofill,
  evaluateAiProductionGate,
  findAiPublicEvidence,
} from "./aiProductionGuards";
import {
  activeStaffCount,
  isRoutableStaffRole,
  isRoutingManagerRole,
  isStaffRole,
  staffRoleLabel,
  type StaffRole,
} from "./roles";
import type {
  Agency,
  AccountingSettings,
  AiNotification,
  Asset,
  AssetType,
  AuditLog,
  BookImportBatch,
  CalendarEvent,
  Carrier,
  CarrierAgencyLink,
  CarrierAppetite,
  CarrierContact,
  CarrierEmailProcessing,
  CarrierDownload,
  CarrierDownloadChange,
  CarrierDownloadDocumentPayload,
  CarrierDownloadKind,
  CarrierRunnerJob,
  CarrierRunnerJobOutcome,
  CarrierRunnerJobStatus,
  CarrierRunnerJobTrigger,
  CarrierQuote,
  Claim,
  Communication,
  ConnectedMailbox,
  ConnectedMailboxStatus,
  CustomerProfile,
  Deposit,
  Document,
  DocumentType,
  DocumentVisibility,
  DemoLead,
  DemoLeadStatus,
  TemplateFieldMap,
  CustomDocumentType,
  CustomMessage,
  CustomMessageAudience,
  CustomMessageFilter,
  CustomMessageAttachment,
  CustomMessageRecurrence,
  CommunicationAttachment,
  CategoryAgencyLink,
  InsuranceCategory,
  HrSubmission,
  HrSubmissionKind,
  HrSubmissionStatus,
  MarketingCampaign,
  MarketingAutoMessageRule,
  MasterAgencyActivity,
  MasterAgencyActivityKind,
  MailboxOutboxJob,
  MailboxOutboxStatus,
  MailProvider,
  MarketingMessage,
  Note,
  Payment,
  PersonalLinesCarrierApiDiagnostic,
  PersonalLinesCarrierApiDiagnosticRow,
  Policy,
  PolicyStatus,
  PublicDataEvidenceMap,
  PublicDataFieldEvidence,
  PublicDataFieldSourceKind,
  MarketingConfig,
  MarketingAttachment,
  InternalMessage,
  InternalThread,
  MessageBlock,
  MessagePin,
  MessageReport,
  MessageMute,
  Prospect,
  ProspectStatus,
  QuoteRequest,
  CommercialCarrierRecommendation,
  CommercialCarrierSubmission,
  CommercialCarrierSubmissionQuote,
  QuotingQuestion,
  QuotingLineOfBusiness,
  QuotingSession,
  QuotingSessionAssetMapping,
  QuotingSessionStatus,
  QuestionnaireEditorRole,
  QuestionnaireResponseMeta,
  Reminder,
  Renewal,
  Role,
  SecurityBan,
  SecurityIncident,
  SecurityIncidentSeverity,
  SecurityIncidentStatus,
  SecuritySubjectKind,
  SoftwareSale,
  SoftwareSaleStatus,
  StatusEvent,
  StatusEventSource,
  SubscriptionTier,
  Task,
  TaskSeverity,
  TaskStatus,
  Timesheet,
  TimesheetEntry,
  TimesheetFrequency,
  TimesheetStatus,
  User,
  PerformanceGoalRequest,
} from "@/types";

type QuestionnaireResponseActor = {
  id?: string;
  name?: string;
  role?: QuestionnaireEditorRole;
};

function questionnaireResponseMetaFor(
  actor: QuestionnaireResponseActor | undefined,
  updatedAt: string
): QuestionnaireResponseMeta {
  return {
    updatedAt,
    updatedById: actor?.id,
    updatedByName: actor?.name?.trim() || "Unknown editor",
    updatedByRole: actor?.role ?? "agent",
  };
}

function mergeQuestionnaireResponseMeta(
  session: QuotingSession,
  responses: Record<string, string>,
  actor: QuestionnaireResponseActor | undefined,
  updatedAt: string
): Record<string, QuestionnaireResponseMeta> {
  const next = { ...(session.questionnaireResponseMeta ?? {}) };
  const existing = session.questionnaireResponses ?? {};
  for (const [questionId, value] of Object.entries(responses)) {
    const existingMeta = next[questionId];
    const actorRole = actor?.role ?? "agent";
    const sameValue = existing[questionId] === value;
    const humanConfirmedAiValue =
      sameValue &&
      existingMeta?.updatedByRole === "ai" &&
      actorRole !== "ai";
    if (sameValue && existingMeta && !humanConfirmedAiValue) continue;
    next[questionId] = questionnaireResponseMetaFor(actor, updatedAt);
  }
  return next;
}

function normalizeQuestionnaireLookup(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactQuestionnaireLookup(value: unknown): string {
  return normalizeQuestionnaireLookup(value).replace(/\s+/g, "");
}

function cleanQuestionnairePrefillValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function questionnaireLookupText(question: QuotingQuestion): string {
  return compactQuestionnaireLookup(
    `${question.id} ${question.acordFieldKey ?? ""} ${question.label} ${(question.acordFieldLabels ?? []).join(" ")}`
  );
}

function recordLookupText(key: string): string {
  return compactQuestionnaireLookup(key);
}

function lookupLooksAddress(value: string): boolean {
  return (
    value.includes("address") ||
    value.includes("location") ||
    value.includes("premises") ||
    value.includes("garaging") ||
    value.includes("mooring") ||
    value.includes("risk")
  );
}

function lookupLooksPropertyComposite(value: string): boolean {
  return (
    (value.includes("propertylocation") ||
      value.includes("propertyaddresslocation") ||
      value.includes("premises")) &&
    (value.includes("occupancy") || value.includes("description"))
  );
}

type QuestionnaireLookupKind =
  | "address"
  | "email"
  | "phone"
  | "website"
  | "businessName"
  | "dba"
  | "entityType"
  | "operations"
  | "yearStarted"
  | "yearsInBusiness"
  | "naics"
  | "sic"
  | "value"
  | "yearBuilt"
  | "squareFootage"
  | "roofMaterial"
  | "roofAge"
  | "construction"
  | "occupancy"
  | "floodZone"
  | "distanceToCoast"
  | "lotSize"
  | "city"
  | "state"
  | "zip";

function questionnaireLookupKind(value: string): QuestionnaireLookupKind | null {
  const lookup = compactQuestionnaireLookup(value);
  if (!lookup) return null;
  if (lookup.includes("email")) return "email";
  if (lookup.includes("phone") || lookup.includes("telephone")) return "phone";
  if (lookup.includes("website") || lookup.includes("url")) return "website";
  if (lookup.includes("zipcode") || lookup.includes("postalcode") || lookup === "zip") return "zip";
  if (lookup === "city" || lookup.endsWith("city")) return "city";
  if (lookup === "state" || lookup.endsWith("state")) return "state";
  if (lookup.includes("naics")) return "naics";
  if (lookup.includes("sic")) return "sic";
  if (lookup.includes("dba") || lookup.includes("doingbusinessas")) return "dba";
  if (lookup.includes("entitytype") || lookup.includes("businesstype") || lookup.includes("typeofbusiness")) {
    return "entityType";
  }
  if (
    lookup.includes("businessdescription") ||
    lookup.includes("operations") ||
    lookup.includes("operationdescription") ||
    lookup.includes("natureofbusiness")
  ) {
    return "operations";
  }
  if (
    lookup.includes("yearstarted") ||
    lookup.includes("businessstarted") ||
    lookup.includes("datebusinessstarted") ||
    lookup.includes("yearbusinessstarted")
  ) {
    return "yearStarted";
  }
  if (lookup.includes("yearsinbusiness") || lookup.includes("timeinbusiness")) return "yearsInBusiness";
  if (lookup.includes("yearbuilt") || lookup.includes("builtyear")) return "yearBuilt";
  if (lookup.includes("squarefootage") || lookup.includes("livingarea") || lookup.includes("buildingarea")) {
    return "squareFootage";
  }
  if (
    lookup.includes("roofmaterial") ||
    lookup.includes("rooftype") ||
    lookup.includes("roofcovering") ||
    (lookup.includes("roof") &&
      (lookup.includes("material") ||
        lookup.includes("shape") ||
        lookup.includes("pitch") ||
        lookup.includes("skylight")))
  ) {
    return "roofMaterial";
  }
  if (lookup.includes("roofage") || lookup.includes("roofyear")) return "roofAge";
  if (lookup.includes("constructiontype") || lookup.includes("construction")) return "construction";
  if (lookup.includes("occupancy") || lookup.includes("occupied") || lookup.includes("primaryuse")) {
    return "occupancy";
  }
  if (lookup.includes("floodzone") || lookup.includes("femazone")) return "floodZone";
  if (lookup.includes("distancetocoast") || lookup.includes("coastdistance")) return "distanceToCoast";
  if (lookup.includes("lotsize") || lookup.includes("acreage") || lookup.includes("landarea")) return "lotSize";
  if (
    lookup.includes("legalbusinessname") ||
    lookup.includes("businesslegalname") ||
    lookup.includes("businessnameasregistered") ||
    lookup.includes("nameofinsured") ||
    lookup.includes("namedinsured") ||
    lookup.includes("insuredname") ||
    lookup.includes("applicantname") ||
    lookup.includes("businessname")
  ) {
    return "businessName";
  }
  if (
    lookup.includes("industrycode") ||
    lookup.includes("primaryindustry") ||
    lookup.includes("industry")
  ) {
    return "naics";
  }
  if (
    lookup.includes("estimatedvalue") ||
    lookup.includes("appraisedvalue") ||
    lookup.includes("agreedvalue") ||
    lookup.includes("scheduledvalue") ||
    lookup.includes("requestedamount") ||
    lookup.includes("requestedlimit") ||
    lookup.includes("propertyvalue") ||
    lookup.includes("buildinglimit")
  ) {
    return "value";
  }
  if (lookupLooksAddress(lookup)) return "address";
  return null;
}

function questionnaireQuestionLookupKinds(question: QuotingQuestion): Set<QuestionnaireLookupKind> {
  return new Set(
    questionnaireQuestionLookupKeys(question)
      .map(questionnaireLookupKind)
      .filter((kind): kind is QuestionnaireLookupKind => kind !== null)
  );
}

function questionnaireFieldKeyMatchesQuestion(question: QuotingQuestion, recordKey: string): boolean {
  const keys = questionnaireQuestionLookupKeys(question);
  const normalizedRecordKey = normalizeQuestionnaireLookup(recordKey);
  const compactRecordKey = compactQuestionnaireLookup(recordKey);
  if (
    keys.some((key) => {
      const normalizedKey = normalizeQuestionnaireLookup(key);
      const compactKey = compactQuestionnaireLookup(key);
      return normalizedKey === normalizedRecordKey || compactKey === compactRecordKey;
    })
  ) {
    return true;
  }

  const recordKind = questionnaireLookupKind(recordKey);
  if (!recordKind) return false;
  return questionnaireQuestionLookupKinds(question).has(recordKind);
}

function valueLooksLikeAddress(value: string): boolean {
  return /\d/.test(value) && /\b(st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|boulevard|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|pl|place|terrace|ter|trail|trl|mi|fl|ga|sc|ny|ca|tx|il|oh|pa|zip)\b/i.test(value);
}

function valueLooksLikeFourDigitYear(value: string): boolean {
  const year = Number(value.trim());
  return Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 2;
}

function valueLooksLikeNumericAnswer(value: string): boolean {
  return /^\$?\s*\d[\d,]*(?:\.\d+)?$/.test(value.trim());
}

function valueContainsQuestionnaireNumber(value: string): boolean {
  return /\d/.test(value.trim());
}

function valueLooksLikeQuestionnaireUnavailableNote(value: string): boolean {
  return /\b(unknown|not public|not publicly|not found|no public|n\/a|not available|unconfirmed|requires|needed|verify|applicant|attestation|clue|loss runs?)\b/i.test(
    value
  );
}

function valueLooksLikeUnavailableAiAnswer(value: string): boolean {
  return (
    /^(unknown|n\/a|none|not found|not public|not available|unconfirmed|requires)\b/i.test(value) ||
    /\b(not found|not public|not publicly|no public|not available|unconfirmed|unable to confirm|unable to determine|requires applicant|requires client|requires insured|applicant attestation|clue|loss runs?)\b/i.test(
      value
    )
  );
}

function valueLooksLikeUncertainAiAnswer(value: string): boolean {
  return /\b(likely|possibly|probably|appears|seems|may be|might be|could be|assumed|inferred|estimated|estimate only|approximately|approx\.?|unverified|needs? confirmation|subject to verification)\b/i.test(
    value
  );
}

function canonicalQuestionnaireOptionAnswer(
  question: QuotingQuestion,
  rawValue: unknown
): string | undefined {
  const value = cleanQuestionnairePrefillValue(rawValue);
  if (!value || !question.options?.length) return undefined;
  const normalized = normalizeQuestionnaireLookup(value);
  return question.options.find(
    (option) => normalizeQuestionnaireLookup(option) === normalized
  );
}

function questionLooksAddressOnly(question: QuotingQuestion): boolean {
  const lookup = questionnaireLookupText(question);
  if (!lookupLooksAddress(lookup)) return false;
  if (lookupLooksPropertyComposite(lookup)) return false;
  return !(
    lookup.includes("nameandmailingaddress") ||
    lookup.includes("nameaddress") ||
    lookup.includes("contactphoneemail") ||
    lookup.includes("certificateholder") ||
    lookup.includes("evidenceholder") ||
    lookup.includes("additionalinterest")
  );
}

function valueLooksLikeBusinessEntityName(value: string): boolean {
  return /\b(llc|l\.l\.c\.|inc|inc\.|corp|corporation|co\.|company|ltd|limited|pllc|llp|lp|holdings|group|partners|enterprises|ventures|services|logistics|management|agency|insurance|properties)\b/i.test(
    value
  );
}

function valueLooksLikeUsableBusinessName(value: string): boolean {
  const text = value.trim();
  return (
    /[a-z]/i.test(text) &&
    text.replace(/[^a-z]/gi, "").length >= 3 &&
    !/^\d+$/.test(text.replace(/\D/g, "")) &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) &&
    !valueLooksLikeAddress(text)
  );
}

function questionRequiresRegisteredBusinessName(question: QuotingQuestion): boolean {
  const lookup = questionnaireLookupText(question);
  return (
    lookup.includes("legalbusinessname") ||
    lookup.includes("businesslegalname") ||
    lookup.includes("businessnameasregistered")
  );
}

function questionRecordEntryIsCompatible(
  question: QuotingQuestion,
  recordKey: string,
  value: string
): boolean {
  const questionLookup = questionnaireLookupText(question);
  const keyLookup = recordLookupText(recordKey);
  if (
    valueLooksLikeAddress(value) &&
    !questionLooksAddressOnly(question) &&
    !lookupLooksPropertyComposite(questionLookup) &&
    !questionExplicitlyAllowsAddressAnswer(question)
  ) {
    return false;
  }
  if (questionSpecificAcordLabelMatchesRecordKey(question, recordKey)) {
    if (lookupLooksAddress(keyLookup)) {
      if (
        !questionLooksAddressOnly(question) &&
        !lookupLooksPropertyComposite(questionLookup) &&
        !questionExplicitlyAllowsAddressAnswer(question)
      ) {
        return false;
      }
      return valueLooksLikeAddress(value);
    }
    if (keyLookup.includes("email")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (keyLookup.includes("phone")) return value.replace(/\D/g, "").length >= 7;
    if (keyLookup.includes("fein") || keyLookup.includes("ein") || keyLookup.includes("tax")) {
      return value.replace(/\D/g, "").length >= 9;
    }
    if (
      keyLookup.includes("name") ||
      keyLookup.includes("insured") ||
      keyLookup.includes("applicant") ||
      keyLookup.includes("business")
    ) {
      return !valueLooksLikeAddress(value);
    }
    return true;
  }
  if (questionLooksAddressOnly(question)) {
    return lookupLooksAddress(keyLookup) && valueLooksLikeAddress(value);
  }
  if (lookupLooksPropertyComposite(questionLookup)) {
    if (keyLookup.includes("propertylocation") || keyLookup.includes("propertyaddresslocation")) {
      return valueLooksLikeAddress(value);
    }
    return (
      (lookupLooksAddress(keyLookup) && valueLooksLikeAddress(value)) ||
      keyLookup.includes("occupancy") ||
      keyLookup.includes("description") ||
      keyLookup.includes("construction") ||
      keyLookup.includes("squarefootage") ||
      keyLookup.includes("yearbuilt")
    );
  }
  if (lookupLooksAddress(keyLookup)) {
    return false;
  }
  if (questionCanUseContactName(question)) {
    if (questionRequiresRegisteredBusinessName(question) && !valueLooksLikeBusinessEntityName(value)) {
      return false;
    }
    return !lookupLooksAddress(keyLookup);
  }
  if (questionCanUseEstimatedValue(question)) {
    return /value|limit|amount|coverage|premium|revenue|payroll|sales/.test(keyLookup);
  }
  if (questionLookup.includes("email")) return keyLookup.includes("email");
  if (questionLookup.includes("phone")) return keyLookup.includes("phone");
  if (questionLookup.includes("website")) return keyLookup.includes("website") || keyLookup.includes("url");
  if (questionLookup.includes("fein") || questionLookup.includes("federalein")) {
    return keyLookup.includes("fein") || keyLookup.includes("ein") || keyLookup.includes("tax");
  }
  return true;
}

function questionnaireAnswerLooksCompatible(question: QuotingQuestion, rawValue: unknown): boolean {
  const value = cleanQuestionnairePrefillValue(rawValue);
  if (!value) return false;
  if (question.options?.length) return Boolean(canonicalQuestionnaireOptionAnswer(question, value));
  const lookup = questionnaireLookupText(question);
  const normalizedQuestion = normalizeQuestionnaireLookup(
    `${question.label} ${(question.acordFieldLabels ?? []).join(" ")}`
  );
  const labeledLines = value
    .split(/\r?\n|;\s+/)
    .map((line) => line.trim())
    .filter((line) => /^([^:]{2,90}):\s*(.+)$/.test(line));
  if (lookup.includes("primarycontactphoneemailandmailingaddress")) {
    return (
      labeledLines.length > 0 &&
      labeledLines.some((line) => /^Primary contact:\s+.+/i.test(line)) &&
      labeledLines.some((line) => /^Phone:\s*[\d\s().+-]{7,}$/i.test(line)) &&
      labeledLines.some((line) => /^Email:\s*[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(line))
    );
  }
  if (lookup.includes("businessidentity") || lookup.includes("legalbusinessnameentitytype")) {
    return labeledLines.some((line) => /^Legal business name:\s+.+/i.test(line));
  }
  if (
    lookup.includes("yearsataddress") ||
    lookup.includes("monthsataddress") ||
    lookup.includes("yearsatcurrentaddress") ||
    lookup.includes("monthsatcurrentaddress")
  ) {
    return /^\d+(?:\.\d+)?(?:\s*(?:years?|months?))?$/i.test(value.trim());
  }
  if (valueLooksLikeAddress(value)) {
    if (
      /\b(operation|operations|product|products|service|services|revenue|payroll|employee|employees)\b/.test(
        normalizedQuestion
      )
    ) {
      return false;
    }
    return (
      questionLooksAddressOnly(question) ||
      lookupLooksPropertyComposite(lookup) ||
      questionExplicitlyAllowsAddressAnswer(question)
    );
  }
  if (
    lookup.includes("yearbuilt") ||
    lookup.includes("roofyear") ||
    lookup.includes("modelyear") ||
    lookup.includes("yearstarted")
  ) {
    return valueLooksLikeFourDigitYear(value);
  }
  if (lookup.includes("yearsinbusiness") || lookup.includes("roofage")) {
    return valueLooksLikeNumericAnswer(value) || valueContainsQuestionnaireNumber(value);
  }
  if (
    lookup.includes("squarefootage") ||
    lookup.includes("livingarea") ||
    lookup.includes("buildingarea") ||
    lookup.includes("lotsize") ||
    lookup.includes("numberofstories") ||
    lookup.includes("stories") ||
    lookup.includes("bedrooms") ||
    lookup.includes("bathrooms")
  ) {
    return valueLooksLikeNumericAnswer(value) || valueContainsQuestionnaireNumber(value);
  }
  if (
    lookup.includes("occupancy") ||
    lookup.includes("occupied") ||
    lookup.includes("primaryuse") ||
    lookup.includes("propertyuse")
  ) {
    return /\b(primary|secondary|seasonal|vacation|rental|tenant|owner|occupied|vacant)\b/i.test(value);
  }
  if (
    lookup.includes("constructiontype") ||
    lookup.includes("construction") ||
    lookup.includes("roofmaterial") ||
    lookup.includes("rooftype") ||
    (lookup.includes("roof") &&
      (lookup.includes("material") ||
        lookup.includes("shape") ||
        lookup.includes("pitch") ||
        lookup.includes("skylight"))) ||
    lookup.includes("floodzone") ||
    lookup.includes("protectionclass")
  ) {
    return !valueLooksLikeAddress(value) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 220;
  }
  if (
    /\b(loss|claim|incident|conviction|violation|mvr|bankruptcy|cancel|nonrenew|audit|payroll|revenue|sales|fein|tax id|ssn|social security)\b/.test(
      normalizedQuestion
    )
  ) {
    return !valueLooksLikeQuestionnaireUnavailableNote(value);
  }
  if (
    lookup.includes("estimatedvalue") ||
    lookup.includes("appraisedvalue") ||
    lookup.includes("agreedvalue") ||
    lookup.includes("scheduledvalue") ||
    lookup.includes("requestedamount") ||
    lookup.includes("requestedlimit") ||
    lookup.includes("exposurevalue") ||
    lookup.includes("replacementcost") ||
    lookup.includes("marketvalue")
  ) {
    return valueLooksLikeNumericAnswer(value) || valueContainsQuestionnaireNumber(value);
  }
  if (questionRequiresRegisteredBusinessName(question) && !valueLooksLikeBusinessEntityName(value)) {
    return false;
  }
  if (lookup.includes("email")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (lookup.includes("phone")) return value.replace(/\D/g, "").length >= 7;
  if (lookup.includes("fein") || lookup.includes("federalein")) {
    return value.replace(/\D/g, "").length >= 9;
  }
  return true;
}

function questionnaireAnswerLooksConcreteForAiPrefill(
  question: QuotingQuestion,
  rawValue: unknown
): boolean {
  const value = cleanQuestionnairePrefillValue(rawValue);
  if (
    !value ||
    valueLooksLikeUnavailableAiAnswer(value) ||
    valueLooksLikeUncertainAiAnswer(value)
  ) {
    return false;
  }
  return questionnaireAnswerLooksCompatible(question, value);
}

function questionSpecificAcordLabelMatchesRecordKey(question: QuotingQuestion, recordKey: string): boolean {
  const labels = question.acordFieldLabels ?? [];
  if (labels.length === 0) return false;
  const normalizedRecordKey = normalizeQuestionnaireLookup(recordKey);
  const compactRecordKey = compactQuestionnaireLookup(recordKey);
  return labels.some((label) => {
    const normalizedLabel = normalizeQuestionnaireLookup(label);
    const compactLabel = compactQuestionnaireLookup(label);
    return normalizedLabel === normalizedRecordKey || compactLabel === compactRecordKey;
  });
}

function questionnaireLookupIsSensitive(value: string): boolean {
  return /address|location|premises|garaging|mooring|risk|name|insured|applicant|email|phone|website|fein|ein|tax|policy/.test(
    value
  );
}

function mappedFieldValueIsCompatible(
  fieldKey: string,
  rawValue: unknown,
  session?: {
    contactName?: string;
    publicFields?: Record<string, unknown>;
    address?: string;
  }
): boolean {
  const value = cleanQuestionnairePrefillValue(rawValue);
  if (!value) return false;
  const keyLookup = recordLookupText(fieldKey);
  const addressField = lookupLooksAddress(keyLookup);
  const knownNames = [
    session?.contactName,
    session?.publicFields?.["Legal business name"],
    session?.publicFields?.["Business legal name"],
    session?.publicFields?.["Named insured"],
    session?.publicFields?.["Name of insured"],
    session?.publicFields?.["Applicant name"],
    session?.publicFields?.["Owner of record"],
  ]
    .map((item) => cleanQuestionnairePrefillValue(item).toLowerCase())
    .filter(Boolean);
  if (addressField) {
    const normalizedValue = value.toLowerCase();
    if (knownNames.some((name) => name === normalizedValue)) return false;
    return valueLooksLikeAddress(value);
  }
  if (keyLookup.includes("email")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (keyLookup.includes("phone")) return value.replace(/\D/g, "").length >= 7;
  if (keyLookup.includes("fein") || keyLookup.includes("ein") || keyLookup.includes("tax")) {
    return value.replace(/\D/g, "").length >= 9;
  }
  if (
    (keyLookup.includes("name") ||
      keyLookup.includes("insured") ||
      keyLookup.includes("applicant") ||
      keyLookup.includes("business")) &&
    valueLooksLikeAddress(value)
  ) {
    return false;
  }
  return true;
}

function compatibleQuestionnaireMappingKey(
  question: QuotingQuestion,
  fieldKey: string,
  rawValue: unknown,
  session?: {
    contactName?: string;
    publicFields?: Record<string, unknown>;
    address?: string;
  }
): string | null {
  const value = cleanQuestionnairePrefillValue(rawValue);
  if (!value) return null;
  if (!questionnaireFieldKeyMatchesQuestion(question, fieldKey)) return null;
  const candidates = [
    fieldKey,
    ...(question.acordFieldLabels ?? []),
    question.acordFieldKey,
    question.label,
  ]
    .map((candidate) => cleanQuestionnairePrefillValue(candidate))
    .filter(Boolean);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      mappedFieldValueIsCompatible(candidate, value, session) &&
      questionRecordEntryIsCompatible(question, candidate, value)
    ) {
      return candidate;
    }
  }
  return null;
}

function questionnaireEvidenceFromMapping(
  mapping: AiAcordFieldMapping | undefined,
  fieldKey: string,
  updatedAt: string
): PublicDataFieldEvidence | undefined {
  if (!mapping) return undefined;
  const sourceKind =
    mapping.sourceKind && mapping.sourceKind !== "unknown" ? mapping.sourceKind : "model_estimate";
  const sourceUrl = cleanQuestionnairePrefillValue(mapping.sourceUrl);
  const confidence = Math.max(0.45, Math.min(1, Number(mapping.confidence) || 0.72));
  if (questionnaireMappingRequiresCitation(sourceKind) && !sourceUrl) {
    return undefined;
  }
  const rationale = cleanQuestionnairePrefillValue(mapping.rationale);
  return {
    fieldKey,
    sourceKind,
    sourceLabel: cleanQuestionnairePrefillValue(mapping.sourceLabel) || "OpenAI questionnaire research",
    sourceUrl: sourceUrl || undefined,
    confidence,
    verified: mapping.verified === true,
    allowDocumentAutofill: false,
    collectedAt: updatedAt,
    notes: [
      rationale || "Editable questionnaire prefill from OpenAI research. Review before carrier submission.",
      sourceUrl ? `Source URL: ${sourceUrl}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function questionnaireMappingRequiresCitation(sourceKind: PublicDataFieldSourceKind): boolean {
  return (
    sourceKind === "web_search" ||
    sourceKind === "public_web" ||
    sourceKind === "government_api" ||
    sourceKind === "commercial_provider"
  );
}

function questionnaireQuestionLookupKeys(question: QuotingQuestion): string[] {
  return [
    question.acordFieldKey,
    question.label,
    ...(question.acordFieldLabels ?? []),
    question.id.split("-").pop(),
  ]
    .map((value) => cleanQuestionnairePrefillValue(value))
    .filter(Boolean);
}

function questionnaireResponseAiMetaFor(
  updatedAt: string,
  evidence?: PublicDataFieldEvidence
): QuestionnaireResponseMeta {
  return {
    updatedAt,
    updatedById: "ai",
    updatedByName: "QuoteX AI",
    updatedByRole: "ai",
    sourceKind: evidence?.sourceKind ?? "client_intake",
    sourceName: evidence?.sourceLabel ?? "QuoteX system",
    sourceLabel: evidence?.sourceLabel ?? "QuoteX system",
    sourceUrl: evidence?.sourceUrl,
    confidence: evidence?.confidence,
    observedDate: evidence?.observedDate,
    verified: evidence?.verified,
    sourceNotes: evidence?.notes,
  };
}

function questionnaireEvidenceForQuestion(
  question: QuotingQuestion,
  evidence?: PublicDataEvidenceMap
): PublicDataFieldEvidence | undefined {
  return questionnaireQuestionLookupKeys(question)
    .map((key) => findAiPublicEvidence(evidence, key))
    .find((item): item is PublicDataFieldEvidence => Boolean(item && aiEvidenceAllowsQuestionnairePrefill(item)));
}

function questionnaireRecordEntryFor(
  question: QuotingQuestion,
  record?: Record<string, unknown>
): { key: string; value: string } | undefined {
  if (!record) return undefined;
  const keys = questionnaireQuestionLookupKeys(question);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = cleanQuestionnairePrefillValue(record[key]);
    if (value) return { key, value };
  }

  for (const [recordKey, rawValue] of Object.entries(record)) {
    if (!questionnaireFieldKeyMatchesQuestion(question, recordKey)) continue;
    const value = cleanQuestionnairePrefillValue(rawValue);
    if (value) return { key: recordKey, value };
  }
  return undefined;
}

function questionnaireAnswerHasUnsafeAiEvidence(
  question: QuotingQuestion,
  evidence?: PublicDataEvidenceMap
): boolean {
  if (!evidence) return false;
  const matchedEvidence = questionnaireQuestionLookupKeys(question)
    .map((key) => findAiPublicEvidence(evidence, key))
    .filter((item): item is PublicDataFieldEvidence => Boolean(item));
  if (matchedEvidence.length === 0) return false;
  return (
    matchedEvidence.some((item) => item.sourceKind === "model_estimate") &&
    !matchedEvidence.some((item) => aiEvidenceAllowsQuestionnairePrefill(item))
  );
}

function questionCanUseQuoteAddress(question: QuotingQuestion): boolean {
  const lookup = questionnaireLookupText(question);
  if (lookup.includes("email") || lookup.includes("ifdifferent")) return false;
  return (
    lookup.includes("propertyaddress") ||
    lookup.includes("riskaddress") ||
    lookup.includes("primaryresidenceaddress") ||
    lookup.includes("residenceaddress") ||
    lookup.includes("locationaddress") ||
    lookup.includes("propertylocation") ||
    lookup.includes("premisesaddress")
  );
}

function questionExplicitlyAllowsAddressAnswer(question: QuotingQuestion): boolean {
  const lookup = normalizeQuestionnaireLookup(
    `${question.id} ${question.acordFieldKey ?? ""} ${question.label} ${(question.acordFieldLabels ?? []).join(" ")}`
  );
  return (
    /\b(address|premises|garaging|mooring)\b/.test(lookup) ||
    /\b(property|risk|insured|applicant|mailing|location)\s+location\b/.test(lookup) ||
    questionCanUseQuoteAddress(question)
  );
}

function questionCanUseEstimatedValue(question: QuotingQuestion): boolean {
  const lookup = compactQuestionnaireLookup(`${question.acordFieldKey ?? ""} ${question.label}`);
  return (
    lookup.includes("estimatedvalue") ||
    lookup.includes("appraisedvalue") ||
    lookup.includes("agreedvalue") ||
    lookup.includes("scheduledvalue") ||
    lookup.includes("requestedamount") ||
    lookup.includes("requestedlimit")
  );
}

function questionCanUseContactName(question: QuotingQuestion): boolean {
  const lookup = questionnaireLookupText(question);
  if (questionLooksAddressOnly(question)) return false;
  return (
    lookup.includes("legalbusinessname") ||
    lookup.includes("businesslegalname") ||
    lookup.includes("businessnameasregistered") ||
    lookup.includes("nameofinsured") ||
    lookup.includes("insuredname") ||
    lookup.includes("applicantname")
  );
}

function publicOrAssetValue(
  input: {
    assetDetails?: Record<string, string>;
    publicFields: Record<string, unknown>;
  },
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const assetValue = cleanQuestionnairePrefillValue(input.assetDetails?.[key]);
    if (assetValue) return assetValue;
    const publicValue = cleanQuestionnairePrefillValue(input.publicFields[key]);
    if (publicValue) return publicValue;
  }
  const normalizedKeys = keys.map(compactQuestionnaireLookup).filter(Boolean);
  const records = [input.assetDetails, input.publicFields].filter(Boolean) as Record<string, unknown>[];
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const compactKey = compactQuestionnaireLookup(key);
      if (!normalizedKeys.some((candidate) => compactKey === candidate)) continue;
      const cleaned = cleanQuestionnairePrefillValue(value);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function line(label: string, value?: string): string | undefined {
  const cleaned = cleanQuestionnairePrefillValue(value);
  return cleaned ? `${label}: ${cleaned}` : undefined;
}

function joinKnownLines(lines: (string | undefined)[]): string | undefined {
  const out = lines.filter((item): item is string => !!item);
  return out.length > 0 ? out.join("\n") : undefined;
}

function compositeKnownQuestionnaireAnswerFor(
  question: QuotingQuestion,
  input: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    businessName?: string;
    address?: string;
    estimatedValue?: number;
    assetDetails?: Record<string, string>;
    publicFields: Record<string, unknown>;
  }
): string | undefined {
  const lookup = questionnaireLookupText(question);
  const legalName =
    publicOrAssetValue(input, [
      "Legal business name (as registered)",
      "Legal business name",
      "Business legal name",
      "Named insured",
      "Name of insured",
      "Applicant name",
      "businessName",
    ]) ??
    (input.businessName && valueLooksLikeUsableBusinessName(input.businessName)
      ? input.businessName
      : undefined) ??
    (input.contactName && valueLooksLikeBusinessEntityName(input.contactName)
      ? input.contactName
      : undefined);
  const propertyAddressCandidate =
    publicOrAssetValue(input, [
      "Property address",
      "Risk address",
      "Premises address",
      "Location address",
      "address",
      "propertyAddress",
      "riskAddress",
      "primaryResidenceAddress",
    ]) ?? input.address;
  const propertyAddress =
    propertyAddressCandidate && valueLooksLikeAddress(propertyAddressCandidate)
      ? propertyAddressCandidate
      : undefined;
  const operationsCandidate =
    publicOrAssetValue(input, [
      "Business operations summary",
      "Business operations",
      "Description of operations",
      "Business description",
      "operationsDescription",
      "productsServices",
    ]);
  const operations =
    operationsCandidate && !valueLooksLikeAddress(operationsCandidate)
      ? operationsCandidate
      : undefined;
  const entityType = publicOrAssetValue(input, ["Entity type", "Business entity type", "entityType"]);
  const fein = publicOrAssetValue(input, ["Federal EIN", "FEIN", "EIN", "Tax ID", "federalEin"]);
  const website = publicOrAssetValue(input, ["Website", "Business website", "website"]);
  const years = publicOrAssetValue(input, ["Years in business", "Year established", "yearEstablished"]);
  const naics = publicOrAssetValue(input, ["Primary industry / NAICS code", "NAICS", "SIC", "naics"]);
  const operatingStatesCandidate =
    publicOrAssetValue(input, ["Operating states", "State", "States of operation", "state"]) ??
    undefined;
  const operatingStates =
    operatingStatesCandidate && !valueLooksLikeAddress(operatingStatesCandidate)
      ? operatingStatesCandidate
      : undefined;
  const occupancy = publicOrAssetValue(input, ["Occupancy", "occupancy"]);
  const description = publicOrAssetValue(input, ["Description of premises", "Property description", "description"]);
  const estimatedValue =
    typeof input.estimatedValue === "number" && Number.isFinite(input.estimatedValue) && input.estimatedValue > 0
      ? `$${Math.round(input.estimatedValue).toLocaleString()}`
      : publicOrAssetValue(input, ["Estimated exposure value", "Estimated value", "Building value"]);

  if (questionLooksAddressOnly(question)) {
    return propertyAddress && valueLooksLikeAddress(propertyAddress) ? propertyAddress : undefined;
  }
  if (lookup.includes("namedinsuredlegalnameandmailingaddress") || lookup.includes("insurednameaddress")) {
    return joinKnownLines([line("Named insured", legalName), line("Mailing address", propertyAddress)]);
  }
  if (lookup.includes("businessidentity") || lookup.includes("legalbusinessnameentitytype")) {
    return joinKnownLines([
      line("Legal business name", legalName),
      line("Entity type", entityType),
      line("FEIN", fein),
      line("Website", website),
      line("Years in business", years),
      line("Primary industry / NAICS", naics),
    ]);
  }
  if (lookup.includes("legalbusinessnameasregistered")) return legalName;
  if (lookup.includes("federalein")) return fein;
  if (lookup.includes("yearestablished")) return years;
  if (lookup.includes("entitytype")) return entityType;
  if (lookup.includes("primaryindustry") || lookup.includes("naics")) return naics;
  if (lookup.includes("businessoperationssummary") || lookup.includes("businessoperations")) return operations;
  if (lookup.includes("operatingstates")) return operatingStates;
  if (lookup.includes("primarycontactphoneemailandmailingaddress")) {
    return joinKnownLines([
      line("Primary contact", input.contactName),
      line("Phone", input.contactPhone),
      line("Email", input.contactEmail),
      line("Mailing address", propertyAddress),
    ]);
  }
  if (lookup.includes("email") && input.contactEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contactEmail)) {
    return input.contactEmail.trim();
  }
  if (lookup.includes("phone") && input.contactPhone && input.contactPhone.replace(/\D/g, "").length >= 7) {
    return input.contactPhone.trim();
  }
  if (lookup.includes("propertylocation") || lookup.includes("propertyaddresslocationoccupancydescription")) {
    if (propertyAddress && !occupancy && !description) {
      return propertyAddress;
    }
    return joinKnownLines([
      line("Property address", propertyAddress),
      line("Occupancy", occupancy),
      line("Description", description),
    ]);
  }
  if (lookup.includes("buildingbusinesspersonalproperty") || lookup.includes("propertyvalues")) {
    return estimatedValue ? `Estimated value / limit: ${estimatedValue}` : undefined;
  }
  return undefined;
}

function personalAutoQuestionKey(
  session: QuotingSession | undefined,
  question: QuotingQuestion
): string | undefined {
  if (!session || session.lineOfBusiness === "commercial" || session.assetType !== "luxury_vehicle") {
    return undefined;
  }
  return cleanQuestionnairePrefillValue(question.acordFieldKey) || undefined;
}

function exactQuestionnaireRecordValue(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!record) return undefined;
  const normalizedKeys = new Set(keys.map(compactQuestionnaireLookup).filter(Boolean));
  for (const [recordKey, rawValue] of Object.entries(record)) {
    if (!normalizedKeys.has(compactQuestionnaireLookup(recordKey))) continue;
    const value = cleanQuestionnairePrefillValue(rawValue);
    if (value && !valueLooksLikeUnavailableAiAnswer(value) && !valueLooksLikeUncertainAiAnswer(value)) {
      return value;
    }
  }
  return undefined;
}

function splitPersonName(name?: string): { first?: string; middle?: string; last?: string; suffix?: string } {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[parts.length - 1]) ? parts.pop() : undefined;
  if (parts.length === 1) return { first: parts[0], suffix };
  return {
    first: parts[0],
    middle: parts.length > 2 ? parts.slice(1, -1).join(" ") : undefined,
    last: parts[parts.length - 1],
    suffix,
  };
}

function parseVerifiedUsAddress(address?: string): {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
} {
  const value = String(address ?? "").trim();
  if (!value) return {};
  const match = value.match(/^(.+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (!match) return {};
  return {
    street: match[1].trim(),
    city: match[2].trim(),
    state: match[3].toUpperCase(),
    zip: match[4],
  };
}

function personalAutoAssetMappingForQuestion(
  session: QuotingSession,
  question: QuotingQuestion
): QuotingSessionAssetMapping | undefined {
  const selected = session.selectedAssetMappings ?? [];
  if (selected.length === 0) return undefined;
  return selected.find((asset, index) =>
    question.id.endsWith(`__asset_${asset.assetId ?? index}`)
  ) ?? selected[0];
}

function personalAutoKnownQuestionnaireAnswerFor(
  session: QuotingSession,
  question: QuotingQuestion,
  input: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    address?: string;
    assetDetails?: Record<string, string>;
    publicFields: Record<string, unknown>;
    publicFieldEvidence?: PublicDataEvidenceMap;
  }
): string | undefined {
  const key = personalAutoQuestionKey(session, question);
  if (!key) return undefined;

  const contact = contactForQuotingSession(session);
  const contactName = input.contactName ?? contact?.name;
  const name = splitPersonName(contactName);
  const selectedMapping = personalAutoAssetMappingForQuestion(session, question);
  const storedAssetId = selectedMapping?.assetId ?? session.assetId;
  const storedAsset = storedAssetId
    ? tenantFilter(db.list("assets"), session.tenantId).find((asset) => asset.id === storedAssetId)
    : undefined;
  const assetDetails = {
    ...(storedAsset?.details ?? {}),
    ...(input.assetDetails ?? {}),
    ...(selectedMapping?.assetDetails ?? {}),
  } as Record<string, unknown>;
  const publicFields = {
    ...(input.publicFields ?? {}),
    ...(selectedMapping?.publicFields ?? {}),
  };
  const publicEvidence = {
    ...(input.publicFieldEvidence ?? {}),
    ...(selectedMapping?.publicFieldEvidence ?? {}),
  };
  const exact = (...keys: string[]) =>
    exactQuestionnaireRecordValue(assetDetails, [key, ...keys]) ??
    (() => {
      const candidate = exactQuestionnaireRecordValue(publicFields, [key, ...keys]);
      if (!candidate) return undefined;
      const evidence = [key, ...keys]
        .map((candidateKey) => findAiPublicEvidence(publicEvidence, candidateKey))
        .find((item) => item && aiEvidenceAllowsQuestionnairePrefill(item));
      return evidence ? candidate : undefined;
    })();

  const contactMailingAddress =
    contact && "mailingAddress" in contact
      ? cleanQuestionnairePrefillValue(contact.mailingAddress)
      : undefined;
  const garagingAddressText =
    exactQuestionnaireRecordValue(assetDetails, ["garagingAddress", "garageAddress"]) ??
    selectedMapping?.address;
  const residenceAddressText =
    exactQuestionnaireRecordValue(assetDetails, [
      "currentResidenceAddress",
      "residenceAddress",
      "primaryResidenceAddress",
    ]) ??
    input.address ??
    selectedMapping?.address ??
    garagingAddressText ??
    contactMailingAddress;
  const residenceAddress = parseVerifiedUsAddress(residenceAddressText);
  const garagingAddress = parseVerifiedUsAddress(garagingAddressText);
  const mailingMatchesResidence = Boolean(
    contactMailingAddress &&
      residenceAddressText &&
      normalizeQuestionnaireLookup(contactMailingAddress) ===
        normalizeQuestionnaireLookup(residenceAddressText)
  );
  const garageMatchesResidence = Boolean(
    garagingAddressText &&
      residenceAddressText &&
      normalizeQuestionnaireLookup(garagingAddressText) ===
        normalizeQuestionnaireLookup(residenceAddressText)
  );
  const policies = tenantFilter(db.list("policies"), session.tenantId)
    .filter((policy) => policy.customerId === session.customerId)
    .filter((policy) => !selectedMapping?.assetId || policy.assetId === selectedMapping.assetId)
    .sort((a, b) => Number(b.status === "bound") - Number(a.status === "bound"));
  const policy = policies[0];
  const carrier = policy
    ? db.list("carriers").find((candidate) => candidate.id === policy.carrierId)
    : undefined;
  const driver = policy?.participants?.find(
    (participant) =>
      (participant.participantType === "driver" || participant.participantType === "operator") &&
      (!selectedMapping?.assetId ||
        !participant.assignedAssetId ||
        participant.assignedAssetId === selectedMapping.assetId)
  );
  const driverName = splitPersonName(driver?.name ?? contactName);
  const coverage = (...names: string[]) =>
    policy?.coverages?.find((item) =>
      names.some((name) => compactQuestionnaireLookup(item.name) === compactQuestionnaireLookup(name))
    );
  const coverageText = (...names: string[]) => {
    const item = coverage(...names);
    if (!item) return undefined;
    if (item.description?.trim()) return item.description.trim();
    if (typeof item.limit === "number" && item.limit > 0) return `$${item.limit.toLocaleString()}`;
    if (typeof item.deductible === "number" && item.deductible >= 0) {
      return `$${item.deductible.toLocaleString()}`;
    }
    return undefined;
  };
  const exactBoolean = (...keys: string[]) => {
    const value = exact(...keys);
    if (!value) return undefined;
    if (/^(yes|true|1)$/i.test(value)) return "Yes";
    if (/^(no|false|0)$/i.test(value)) return "No";
    return undefined;
  };

  const direct: Record<string, string | undefined> = {
    primaryFirstName: name.first,
    primaryMiddleInitial: name.middle?.charAt(0),
    primaryLastName: name.last,
    primarySuffix: name.suffix,
    primaryDateOfBirth: exact("primaryDateOfBirth", "dateOfBirth", "dob"),
    primarySsnLastFour: exact("primarySsnLastFour", "ssnLastFour"),
    primaryGender: exact("primaryGender", "gender"),
    primaryMaritalStatus: exact("primaryMaritalStatus", "maritalStatus"),
    primaryOccupation: exact("primaryOccupation", "occupation"),
    cellPhone: input.contactPhone ?? contact?.phone,
    emailAddress: input.contactEmail ?? contact?.email,
    currentStreetAddress: residenceAddress.street,
    currentCity: residenceAddress.city,
    currentState: residenceAddress.state,
    currentZipCode: residenceAddress.zip,
    mailingAddress: mailingMatchesResidence ? undefined : contactMailingAddress,
    mailingSameAsCurrent:
      contactMailingAddress && residenceAddressText
        ? mailingMatchesResidence
          ? "Yes"
          : "No"
        : undefined,
    alternateGarageStreet: garageMatchesResidence ? undefined : garagingAddress.street,
    alternateGarageCity: garageMatchesResidence ? undefined : garagingAddress.city,
    alternateGarageState: garageMatchesResidence ? undefined : garagingAddress.state,
    alternateGarageZip: garageMatchesResidence ? undefined : garagingAddress.zip,
    ratingState: session.state ?? residenceAddress.state,
    targetEffectiveDate: policy?.effectiveDate ?? exact("targetEffectiveDate", "effectiveDate"),
    currentlyInsured: policy ? "Yes" : exactBoolean("currentlyInsured"),
    currentPremium:
      policy?.finalPremium && policy.finalPremium > 0
        ? String(policy.finalPremium)
        : policy?.premiumEstimate && policy.premiumEstimate > 0
        ? String(policy.premiumEstimate)
        : undefined,
    currentCarrier: carrier?.name,
    currentPolicyExpirationDate: policy?.renewalDate,
    currentPolicyNumber: policy?.policyNumber,
    currentLiabilityLimits: coverageText("Liability", "Bodily Injury", "Bodily Injury Liability"),
    driverFirstName: driverName.first,
    driverLastName: driverName.last,
    driverDateOfBirth: driver?.dateOfBirth ?? exact("driverDateOfBirth", "dateOfBirth", "dob"),
    driverRelationshipToApplicant: driver?.relationship,
    driverStatus: driver?.status,
    driverLicenseState: driver?.licenseState ?? exact("driverLicenseState", "licenseState"),
    driverLicenseNumber: driver?.licenseNumber ?? exact("driverLicenseNumber", "licenseNumber"),
    driverLicenseStatus: exact("driverLicenseStatus", "licenseStatus"),
    vin: normalizeVin(exact("vin") ?? ""),
    vehicleYear: exact("vehicleYear", "year"),
    vehicleMake: exact("vehicleMake", "make"),
    vehicleModel: exact("vehicleModel", "model"),
    vehicleTrim: exact("vehicleTrim", "trim", "VIN-decoded trim", "series"),
    vehicleBodyStyle: exact("vehicleBodyStyle", "bodyStyle", "vehicleType", "Body class"),
    vehiclePurchaseDate: exact("vehiclePurchaseDate", "purchaseDate"),
    vehicleOwnershipStatus: exact("vehicleOwnershipStatus", "ownershipStatus"),
    vehicleRegisteredState: exact("vehicleRegisteredState", "registeredState"),
    vehicleOriginalMsrp: exact("vehicleOriginalMsrp", "originalMsrp", "msrp"),
    vehicleEngine: exact("vehicleEngine", "engine", "Engine model", "Engine configuration"),
    vehicleCylinders: exact(
      "vehicleCylinders",
      "cylinders",
      "engineCylinders",
      "Engine cylinders",
      "Cylinders"
    ),
    vehicleDisplacement: exact(
      "vehicleDisplacement",
      "displacement",
      "displacementL",
      "Engine displacement (L)",
      "Displacement (L)",
      "Displacement"
    ),
    vehicleFuelType: exact("vehicleFuelType", "fuelType", "Fuel type", "Primary fuel type"),
    vehicleDriveType: exact("vehicleDriveType", "driveType", "Drive type"),
    vehicleDoorCount: exact("vehicleDoorCount", "doorCount", "doors", "Doors"),
    principalOperator: driver?.name ?? exact("principalOperator"),
    occasionalOperator: exact("occasionalOperator"),
    vehicleUsage: exact("vehicleUsage", "usage", "primaryUse"),
    oneWayCommuteMiles: exact("oneWayCommuteMiles", "commuteMiles"),
    daysDrivenPerWeek: exact("daysDrivenPerWeek"),
    annualMileage: exact("annualMileage", "annualMiles", "mileage"),
    vehicleGaraged: exactBoolean("vehicleGaraged", "garaged"),
    garageLocation:
      exact("garageLocation") ??
      (garagingAddressText && residenceAddressText
        ? garageMatchesResidence
          ? "Residence"
          : "Other"
        : undefined),
    antiLockBrakes: exactBoolean("antiLockBrakes", "abs"),
    antiTheftDevice: exactBoolean("antiTheftDevice", "antiTheft"),
    airbags: exactBoolean("airbags"),
    bodilyInjuryLimits: coverageText("Bodily Injury", "Bodily Injury Liability"),
    propertyDamageLimits: coverageText("Property Damage", "Property Damage Liability"),
    comprehensiveDeductible: coverageText("Comprehensive"),
    collisionDeductible: coverageText("Collision"),
    rentalReimbursement: coverageText("Rental Reimbursement", "Rental"),
    towingCoverage: coverageText("Towing", "Roadside Assistance"),
    fullGlassCoverage: coverageText("Full Glass", "Glass"),
  };

  return cleanQuestionnairePrefillValue(direct[key] ?? exact(key)) || undefined;
}

function knownQuestionnaireAnswerFor(
  question: QuotingQuestion,
  input: {
    session?: QuotingSession;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    businessName?: string;
    address?: string;
    estimatedValue?: number;
    assetDetails?: Record<string, string>;
    publicFields: Record<string, unknown>;
    publicFieldEvidence?: PublicDataEvidenceMap;
  }
): string | undefined {
  const strictPersonalAutoKey = personalAutoQuestionKey(input.session, question);
  if (strictPersonalAutoKey && input.session) {
    return personalAutoKnownQuestionnaireAnswerFor(input.session, question, input);
  }
  const composite = compositeKnownQuestionnaireAnswerFor(question, input);
  if (composite) return composite;
  const fromAssetDetails = questionnaireRecordEntryFor(question, input.assetDetails);
  if (
    fromAssetDetails &&
    questionRecordEntryIsCompatible(question, fromAssetDetails.key, fromAssetDetails.value)
  ) {
    const assetEvidence = findAiPublicEvidence(input.publicFieldEvidence, fromAssetDetails.key);
    if (assetEvidence && !aiEvidenceAllowsQuestionnairePrefill(assetEvidence)) return undefined;
    return fromAssetDetails.value;
  }
  const fromPublicFields = questionnaireRecordEntryFor(question, input.publicFields);
  if (
    fromPublicFields &&
    questionRecordEntryIsCompatible(question, fromPublicFields.key, fromPublicFields.value) &&
    aiEvidenceAllowsQuestionnairePrefill(findAiPublicEvidence(input.publicFieldEvidence, fromPublicFields.key))
  ) {
    return fromPublicFields.value;
  }
  if (input.address && questionCanUseQuoteAddress(question) && valueLooksLikeAddress(input.address)) {
    return input.address.trim();
  }
  if (input.contactName?.trim() && questionCanUseContactName(question)) {
    if (
      questionRequiresRegisteredBusinessName(question) &&
      !valueLooksLikeBusinessEntityName(input.contactName)
    ) {
      return undefined;
    }
    return input.contactName.trim();
  }
  if (
    typeof input.estimatedValue === "number" &&
    Number.isFinite(input.estimatedValue) &&
    input.estimatedValue > 0 &&
    questionCanUseEstimatedValue(question)
  ) {
    return String(input.estimatedValue);
  }
  return undefined;
}

function seedKnownQuestionnaireResponses(input: {
  session?: QuotingSession;
  questions: QuotingQuestion[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessName?: string;
  address?: string;
  estimatedValue?: number;
  assetDetails?: Record<string, string>;
  publicFields: Record<string, unknown>;
  publicFieldEvidence?: PublicDataEvidenceMap;
  updatedAt: string;
}): {
  questionnaireResponses?: Record<string, string>;
  questionnaireResponseMeta?: Record<string, QuestionnaireResponseMeta>;
  missingFields: string[];
} {
  const questionnaireResponses: Record<string, string> = {};
  const questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta> = {};
  input.questions.forEach((question) => {
    const answer = knownQuestionnaireAnswerFor(question, input);
    if (!answer) return;
    if (!questionnaireAnswerLooksConcreteForAiPrefill(question, answer)) return;
    questionnaireResponses[question.id] =
      canonicalQuestionnaireOptionAnswer(question, answer) ?? answer;
    questionnaireResponseMeta[question.id] = questionnaireResponseAiMetaFor(
      input.updatedAt,
      questionnaireEvidenceForQuestion(question, input.publicFieldEvidence)
    );
  });

  const missingFields = input.questions
    .filter((question) => question.required && !questionnaireResponses[question.id]?.trim())
    .map((question) => question.label);

  return {
    questionnaireResponses:
      Object.keys(questionnaireResponses).length > 0 ? questionnaireResponses : undefined,
    questionnaireResponseMeta:
      Object.keys(questionnaireResponseMeta).length > 0 ? questionnaireResponseMeta : undefined,
    missingFields,
  };
}

function mergeSeededQuestionnaireResponses(input: {
  session: QuotingSession;
  questions: QuotingQuestion[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  businessName?: string;
  address?: string;
  estimatedValue?: number;
  assetDetails?: Record<string, string>;
  publicFields: Record<string, unknown>;
  publicFieldEvidence?: PublicDataEvidenceMap;
  updatedAt: string;
}): {
  questionnaireResponses: Record<string, string>;
  questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta>;
  missingFields: string[];
} {
  const seeded = seedKnownQuestionnaireResponses({
    session: input.session,
    questions: input.questions,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    businessName: input.businessName,
    address: input.address,
    estimatedValue: input.estimatedValue,
    assetDetails: input.assetDetails,
    publicFields: input.publicFields,
    publicFieldEvidence: input.publicFieldEvidence,
    updatedAt: input.updatedAt,
  });
  const questionIds = new Set(input.questions.map((question) => question.id));
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));
  const seededResponses = seeded.questionnaireResponses ?? {};
  const responseMeta = input.session.questionnaireResponseMeta ?? {};
  const existingResponses = Object.fromEntries(
    Object.entries(input.session.questionnaireResponses ?? {}).filter(([questionId, value]) => {
      if (!questionIds.has(questionId)) return false;
      const question = questionsById.get(questionId);
      if (!question || !questionnaireAnswerLooksCompatible(question, value)) return false;
      const meta = responseMeta[questionId];
      if (meta?.updatedByRole !== "ai") return true;

      // A fresh deterministic QuoteX seed outranks an older AI answer, while
      // human and customer edits always remain authoritative.
      if (seededResponses[questionId]) return false;
      const cleaned = cleanQuestionnairePrefillValue(value);
      const strictPersonalAutoKey = personalAutoQuestionKey(input.session, question);
      if (
        strictPersonalAutoKey &&
        !aiEvidenceAllowsQuestionnairePrefill(
          findAiPublicEvidence(input.publicFieldEvidence, strictPersonalAutoKey)
        )
      ) {
        return false;
      }
      if (
        questionnaireAnswerHasUnsafeAiEvidence(question, input.publicFieldEvidence) ||
        valueLooksLikeUnavailableAiAnswer(cleaned) ||
        valueLooksLikeUncertainAiAnswer(cleaned) ||
        !questionnaireAnswerLooksConcreteForAiPrefill(question, cleaned)
      ) {
        return false;
      }

      return Boolean(
        questionnaireEvidenceForQuestion(question, input.publicFieldEvidence) ||
          questionnaireResponseMetaIsTrustedAiSeed(meta)
      );
    })
  );
  const survivingResponseIds = new Set(Object.keys(existingResponses));
  const existingMeta = Object.fromEntries(
    Object.entries(input.session.questionnaireResponseMeta ?? {}).filter(([questionId]) =>
      survivingResponseIds.has(questionId)
    )
  );
  const questionnaireResponses: Record<string, string> = {
    ...(seeded.questionnaireResponses ?? {}),
    ...existingResponses,
  };
  const questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta> = {
    ...(seeded.questionnaireResponseMeta ?? {}),
    ...existingMeta,
  };
  const missingFields = input.questions
    .filter((question) => question.required && !questionnaireResponses[question.id]?.trim())
    .map((question) => question.label);
  return { questionnaireResponses, questionnaireResponseMeta, missingFields };
}

function dedupeQuotingQuestionsByLabel(questions: QuotingQuestion[]): QuotingQuestion[] {
  const seen = new Set<string>();
  const out: QuotingQuestion[] = [];
  questions.forEach((question) => {
    const key = normalizeQuestionnaireLookup(question.label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(question);
  });
  return out;
}

function humanizeQuestionnaireSeedLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  if (/\s|\/|[()]/.test(trimmed)) return trimmed;
  const words = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  if (!words) return trimmed;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function completePersonalQuestionnaireQuestions(input: {
  assetType: AssetType;
  categories?: InsuranceCategory[];
  publicFields: Record<string, unknown>;
  missingFields: string[];
  existingQuestions?: QuotingQuestion[];
}): QuotingQuestion[] {
  const categoryQuestions = (input.categories ?? []).flatMap(categoryQuotingQuestions);
  const retainedExistingQuestions =
    categoryQuestions.length > 0
      ? (input.existingQuestions ?? []).filter(
          (question) => Boolean(question.sourceDocumentId || question.carrierId)
        )
      : input.existingQuestions ?? [];
  if (categoryQuestions.length > 0) {
    return dedupeQuotingQuestionsByLabel([
      ...categoryQuestions,
      ...retainedExistingQuestions,
    ]);
  }

  const internalKeys = new Set([
    "categoryid",
    "categorylabel",
    "lineofbusiness",
    "assetidentifier",
    "assetid",
    "contactname",
    "customerid",
    "prospectid",
  ]);
  const labels = [...Object.keys(input.publicFields), ...input.missingFields]
    .filter((label) => !internalKeys.has(compactQuestionnaireLookup(label)))
    .map(humanizeQuestionnaireSeedLabel)
    .filter(Boolean);
  const aiQuestions =
    labels.length > 0
      ? aiGeneratePersonalQuestionnaire({
          assetType: input.assetType,
          missingFields: labels,
        })
      : [];
  return dedupeQuotingQuestionsByLabel([
    ...aiQuestions,
    ...retainedExistingQuestions,
  ]);
}

function personalQuestionnaireCategories(session: QuotingSession): InsuranceCategory[] {
  const tenantCategories = api.categories
    .listActiveForTenant(session.tenantId)
    .filter((category) => category.lineOfBusiness === "personal");
  const allPersonalCategories = api.categories
    .listActive()
    .filter((category) => category.lineOfBusiness === "personal");
  const selectedIds = new Set(
    [
      session.categoryId,
      ...(session.categoryIds ?? []),
      ...(session.selectedAssetMappings ?? []).map((mapping) => mapping.categoryId),
    ].filter((value): value is string => Boolean(value))
  );
  const selectedLabels = new Set(
    [
      session.categoryLabel,
      ...(session.categoryLabels ?? []),
      ...(session.selectedAssetMappings ?? []).map((mapping) => mapping.categoryLabel),
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeQuestionnaireLookup)
  );
  const explicit = allPersonalCategories.filter(
    (category) =>
      selectedIds.has(category.id) ||
      selectedLabels.has(normalizeQuestionnaireLookup(category.label))
  );
  if (explicit.length > 0) return explicit;

  const tenantAssetTypeCategory = tenantCategories.find(
    (category) => category.assetType === session.assetType
  );
  if (tenantAssetTypeCategory) return [tenantAssetTypeCategory];

  const globalAssetTypeCategory = allPersonalCategories.find(
    (category) => category.assetType === session.assetType
  );
  return globalAssetTypeCategory ? [globalAssetTypeCategory] : [];
}

function personalQuestionnaireCategoryForAsset(input: {
  tenantId: string;
  assetType: AssetType;
  categoryId?: string;
  categoryLabel?: string;
}): InsuranceCategory | undefined {
  const explicit = input.categoryId ? api.categories.get(input.categoryId) : undefined;
  if (explicit?.lineOfBusiness === "personal") return explicit;

  const normalizedLabel = normalizeQuestionnaireLookup(input.categoryLabel ?? "");
  const tenantCategories = api.categories
    .listActiveForTenant(input.tenantId)
    .filter((category) => category.lineOfBusiness === "personal");
  const globalCategories = api.categories
    .listActive()
    .filter((category) => category.lineOfBusiness === "personal");
  if (normalizedLabel) {
    const labelMatch = [...tenantCategories, ...globalCategories].find(
      (category) => normalizeQuestionnaireLookup(category.label) === normalizedLabel
    );
    if (labelMatch) return labelMatch;
  }
  return (
    tenantCategories.find((category) => category.assetType === input.assetType) ??
    globalCategories.find((category) => category.assetType === input.assetType)
  );
}

function migrateQuestionnaireAnswersToQuestions(
  session: QuotingSession,
  questions: QuotingQuestion[]
): QuotingSession {
  const existingQuestions = session.questionnaireQuestions ?? [];
  const existingResponses = session.questionnaireResponses ?? {};
  const existingMeta = session.questionnaireResponseMeta ?? {};
  const responses = { ...existingResponses };
  const meta = { ...existingMeta };

  questions.forEach((question) => {
    if (cleanQuestionnairePrefillValue(responses[question.id])) return;
    const acordKey = compactQuestionnaireLookup(question.acordFieldKey ?? "");
    const labelKey = normalizeQuestionnaireLookup(question.label);
    const sourceQuestion = existingQuestions.find((candidate) => {
      const candidateAcordKey = compactQuestionnaireLookup(candidate.acordFieldKey ?? "");
      return Boolean(
        (acordKey && candidateAcordKey === acordKey) ||
          normalizeQuestionnaireLookup(candidate.label) === labelKey
      );
    });
    if (!sourceQuestion) return;
    const value = cleanQuestionnairePrefillValue(existingResponses[sourceQuestion.id]);
    if (!value || !questionnaireAnswerLooksCompatible(question, value)) return;
    responses[question.id] = value;
    if (existingMeta[sourceQuestion.id]) {
      meta[question.id] = existingMeta[sourceQuestion.id];
    }
  });

  return {
    ...session,
    questionnaireResponses: responses,
    questionnaireResponseMeta: meta,
  };
}

function quoteSessionAddressContext(session: QuotingSession): string | undefined {
  const candidates = [
    session.assetDetails?.propertyAddress,
    session.assetDetails?.riskAddress,
    session.assetDetails?.primaryResidenceAddress,
    session.assetDetails?.address,
    typeof session.publicFields.address === "string" ? session.publicFields.address : undefined,
  ];
  return candidates.find((value) => !!value?.trim() && valueLooksLikeAddress(value));
}

function ensureCompletePersonalCategoryQuestionnaire(session: QuotingSession): QuotingSession {
  if (session.lineOfBusiness === "commercial") return session;
  const categories = personalQuestionnaireCategories(session);
  const fullQuestions = completePersonalQuestionnaireQuestions({
    assetType: session.assetType,
    categories,
    publicFields: session.publicFields,
    missingFields: session.missingFields,
    existingQuestions: session.questionnaireQuestions,
  });
  if (fullQuestions.length === 0) return session;

  const existingQuestions = session.questionnaireQuestions ?? [];
  const contact = contactForQuotingSession(session);
  const migratedSession = migrateQuestionnaireAnswersToQuestions(session, fullQuestions);
  const merged = mergeSeededQuestionnaireResponses({
    session: migratedSession,
    questions: fullQuestions,
    contactName: contact?.name,
    contactEmail: contact?.email,
    contactPhone: contact?.phone,
    businessName: contact && "businessName" in contact ? contact.businessName : undefined,
    address: quoteSessionAddressContext(session),
    estimatedValue: session.estimatedValue,
    assetDetails: session.assetDetails,
    publicFields: session.publicFields,
    publicFieldEvidence: session.publicFieldEvidence,
    updatedAt: session.updatedAt,
  });
  const questionnaireResponses = merged.questionnaireResponses;
  const questionnaireResponseMeta = merged.questionnaireResponseMeta;
  const missingFields = merged.missingFields;
  const existingResponses = session.questionnaireResponses ?? {};
  const hasCompleteQuestionSet =
    existingQuestions.length === fullQuestions.length &&
    fullQuestions.every((question) => existingQuestions.some((existing) => existing.id === question.id));
  const responsesChanged = fullQuestions.some(
    (question) =>
      cleanQuestionnairePrefillValue(existingResponses[question.id]) !==
      cleanQuestionnairePrefillValue(questionnaireResponses[question.id])
  );
  const missingFieldsChanged =
    session.missingFields.length !== missingFields.length ||
    session.missingFields.some((field, index) => field !== missingFields[index]);

  if (hasCompleteQuestionSet && !responsesChanged && !missingFieldsChanged) return session;
  return {
    ...session,
    questionnaireQuestions: fullQuestions,
    questionnaireResponses,
    questionnaireResponseMeta,
    missingFields,
  };
}

const DEFAULT_TIMESHEET_SETTINGS: Pick<
  AccountingSettings,
  "timesheetFrequency" | "dueWeekday" | "dueDayOfMonth" | "reminderTime"
> = {
  timesheetFrequency: "weekly",
  dueWeekday: 5,
  dueDayOfMonth: 28,
  reminderTime: "09:00",
};

function defaultTimesheetRecipientIds(tenantId: string): string[] {
  return db
    .list("users")
    .filter((user) => user.tenantId === tenantId && user.active && isStaffRole(user.role))
    .map((user) => user.id);
}

function timesheetNotificationSummary(settings: AccountingSettings): string {
  const period = currentTimesheetPeriod(settings);
  return `Your timesheet for ${fmt.date(period.periodStart)} - ${fmt.date(
    period.periodEnd
  )} is due ${fmt.date(period.dueDate)} at ${settings.reminderTime}.`;
}

function totalTimesheetHours(entries: TimesheetEntry[]): number {
  return Number(entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(2));
}

function dateOnly(date: Date): string {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, new Date(year, month + 1, 0).getDate());
}

function currentTimesheetPeriod(settings: AccountingSettings, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (settings.timesheetFrequency === "monthly") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const due = new Date(
      today.getFullYear(),
      today.getMonth(),
      clampDay(today.getFullYear(), today.getMonth(), settings.dueDayOfMonth)
    );
    return { periodStart: dateOnly(start), periodEnd: dateOnly(end), dueDate: dateOnly(due) };
  }

  if (settings.timesheetFrequency === "semi_monthly") {
    const firstHalf = today.getDate() <= 15;
    const start = new Date(today.getFullYear(), today.getMonth(), firstHalf ? 1 : 16);
    const end = firstHalf
      ? new Date(today.getFullYear(), today.getMonth(), 15)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const due = firstHalf
      ? new Date(today.getFullYear(), today.getMonth(), 15)
      : new Date(
          today.getFullYear(),
          today.getMonth(),
          clampDay(today.getFullYear(), today.getMonth(), settings.dueDayOfMonth)
        );
    return { periodStart: dateOnly(start), periodEnd: dateOnly(end), dueDate: dateOnly(due) };
  }

  const mondayOffset = (today.getDay() + 6) % 7;
  const weekStart = addDays(today, -mondayOffset);
  const spanWeeks = settings.timesheetFrequency === "bi_weekly" ? 2 : 1;
  let start = weekStart;
  if (spanWeeks === 2) {
    const anchor = new Date(2026, 0, 5);
    anchor.setHours(0, 0, 0, 0);
    const weeksSinceAnchor = Math.floor((weekStart.getTime() - anchor.getTime()) / (7 * 86_400_000));
    if (weeksSinceAnchor % 2 !== 0) start = addDays(weekStart, -7);
  }
  const end = addDays(start, spanWeeks * 7 - 1);
  const targetWeekStart = spanWeeks === 2 ? addDays(start, 7) : start;
  const due = addDays(targetWeekStart, (settings.dueWeekday + 6) % 7);
  return { periodStart: dateOnly(start), periodEnd: dateOnly(end), dueDate: dateOnly(due) };
}

function isDueTodayOrPast(iso: string, now = new Date()): boolean {
  return new Date(dateOnly(new Date(iso))).getTime() <= new Date(dateOnly(now)).getTime();
}

const FORBIDDEN_TENANT_ID = "__quotex_forbidden_tenant__";
const PLATFORM_ROLES = new Set<Role>(["master_admin"]);

function assertCanUseMasterAdminRole(role: Role, currentUserId?: string) {
  if (role !== "master_admin") return;
  const existingMaster = db
    .list("users")
    .find((user) => isLockingMasterAccount(user) && user.id !== currentUserId);
  if (existingMaster) {
    throw new Error("master_admin_limit_reached");
  }
}

function browserTenantLock(): { tenantId: string; userId: string } | null {
  const claims = currentServerSessionClaims();
  if (!claims?.tenantId || PLATFORM_ROLES.has(claims.role as Role)) return null;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

function scopedTenantForBrowser(tenantId?: string | null): string | null | undefined {
  const lock = browserTenantLock();
  if (!lock) return tenantId;
  if (tenantId == null) return lock.tenantId;
  return tenantId === lock.tenantId ? tenantId : FORBIDDEN_TENANT_ID;
}

function browserCanReadAgency(id: string): boolean {
  const lock = browserTenantLock();
  return !lock || id === lock.tenantId;
}

const tenantFilter = <T extends { tenantId?: string | null }>(rows: T[], tenantId?: string | null) => {
  const scopedTenantId = scopedTenantForBrowser(tenantId);
  if (scopedTenantId === FORBIDDEN_TENANT_ID) return [];
  return scopedTenantId == null ? rows : rows.filter((r) => r.tenantId === scopedTenantId);
};

function normalizeSecurityIpAddress(input?: string): string {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function securitySubjectKindForUser(user?: User): SecuritySubjectKind {
  if (!user) return "unknown";
  if (isStaffRole(user.role)) return "staff";
  if (user.role === "customer") return "customer";
  return "unknown";
}

function contactOwnerIds(row: {
  assignedAgentId?: string;
  additionalAgentIds?: string[];
  assignedCsrId?: string;
  additionalCsrIds?: string[];
}): string[] {
  return Array.from(
    new Set(
      [
        row.assignedAgentId,
        ...(row.additionalAgentIds ?? []),
        row.assignedCsrId,
        ...(row.additionalCsrIds ?? []),
      ].filter((id): id is string => !!id)
    )
  );
}

function contactIsOwnedBy(
  row: {
    assignedAgentId?: string;
    additionalAgentIds?: string[];
    assignedCsrId?: string;
    additionalCsrIds?: string[];
  },
  userId?: string
): boolean {
  return !!userId && contactOwnerIds(row).includes(userId);
}

type ContactOwnership = {
  tenantId: string;
  assignedAgentId?: string;
  additionalAgentIds?: string[];
  assignedCsrId?: string;
  additionalCsrIds?: string[];
};

function assignedContactOwners(row?: ContactOwnership | null): string[] {
  if (!row) return [];
  return contactOwnerIds(row).filter((ownerId) => {
    const owner = db
      .list("users")
      .find((user) => user.id === ownerId && user.tenantId === row.tenantId);
    return (
      !!owner &&
      owner.active !== false &&
      owner.staffAccessStatus !== "banned" &&
      owner.staffAccessStatus !== "deleted" &&
      isRoutableStaffRole(owner.role)
    );
  });
}

function assignedContactOwner(row?: ContactOwnership | null): string | undefined {
  return assignedContactOwners(row)[0];
}

function linkedContactOwners(input: {
  tenantId: string;
  customerId?: string;
  prospectId?: string;
}): string[] {
  const contact = input.customerId
    ? db
        .list("customers")
        .find((row) => row.id === input.customerId && row.tenantId === input.tenantId)
    : input.prospectId
      ? db
          .list("prospects")
          .find((row) => row.id === input.prospectId && row.tenantId === input.tenantId)
      : undefined;
  return assignedContactOwners(contact);
}

function linkedContactOwner(input: {
  tenantId: string;
  customerId?: string;
  prospectId?: string;
}): string | undefined {
  return linkedContactOwners(input)[0];
}

function hasContactAssignment(row: ContactOwnership): boolean {
  return contactOwnerIds(row).length > 0;
}

type ContactLineOfBusiness = "personal" | "commercial";

type AutoRoutableContact = {
  tenantId: string;
  assignedAgentId?: string;
  additionalAgentIds?: string[];
  lineOfBusiness?: ContactLineOfBusiness;
  archived?: boolean;
};

function activeLineAgents(tenantId: string, line: ContactLineOfBusiness): User[] {
  const activeAgents = db
    .list("users")
    .filter(
      (user) =>
        user.tenantId === tenantId &&
        user.active !== false &&
        user.role === "agent" &&
        user.staffAccessStatus !== "banned" &&
        user.staffAccessStatus !== "deleted"
    );
  const exact = activeAgents.filter((user) => user.lineOfBusiness === line);
  return (exact.length > 0 ? exact : activeAgents.filter((user) => !user.lineOfBusiness)).sort(
    (a, b) => a.name.localeCompare(b.name)
  );
}

function contactLine(row: Pick<AutoRoutableContact, "lineOfBusiness">): ContactLineOfBusiness | undefined {
  return row.lineOfBusiness === "commercial" || row.lineOfBusiness === "personal"
    ? row.lineOfBusiness
    : undefined;
}

function contactLoadForAgent(agentId: string, tenantId: string, line: ContactLineOfBusiness): number {
  const owns = (row: AutoRoutableContact) =>
    row.tenantId === tenantId &&
    !row.archived &&
    contactLine(row) === line &&
    contactOwnerIds(row).includes(agentId);

  const customerLoad = db.list("customers").filter(owns).length;
  const prospectLoad = db
    .list("prospects")
    .filter((prospect) => owns(prospect) && prospect.status !== "converted").length;
  return customerLoad + prospectLoad;
}

function chooseAutoRouteAgent(
  tenantId: string,
  line: ContactLineOfBusiness | undefined
): User | undefined {
  if (!line) return undefined;
  return activeLineAgents(tenantId, line)
    .map((agent) => ({
      agent,
      load: contactLoadForAgent(agent.id, tenantId, line),
      createdAt: agent.createdAt,
    }))
    .sort((a, b) => a.load - b.load || a.createdAt.localeCompare(b.createdAt) || a.agent.name.localeCompare(b.agent.name))[0]
    ?.agent;
}

function syncPolicyClaimStatus(claim: Claim) {
  const stillHasOpenClaim = db
    .list("claims")
    .some((c) => c.id !== claim.id && c.policyId === claim.policyId && c.status !== "closed");
  const nextStatus: PolicyStatus =
    claim.status === "closed" && !stillHasOpenClaim ? "claim_closed" : "claim_opened";
  db.update("policies", claim.policyId, { status: nextStatus });
}

// ---------------------------------------------------------------------
// Lightweight keyword classifier for customer-submitted policy edit
// requests. Used by api.policies.requestEdit to pick the right
// "next steps" copy in the AI-drafted acknowledgment email. Real
// implementation would route through the LLM; this keeps the demo
// deterministic and free.
// ---------------------------------------------------------------------

type EditRequestClass =
  | "coverage_limit"
  | "named_insured"
  | "address"
  | "usage"
  | "deductible"
  | "cancellation"
  | "general";

function classifyEditRequest(raw: string): EditRequestClass {
  const t = raw.toLowerCase();
  if (/(cancel|remove|drop|terminate)\s+(my\s+)?(policy|coverage)/.test(t)) return "cancellation";
  if (/\b(limit|coverage)\b.*\b(increase|raise|bump|higher|more|decrease|lower|reduce)\b/.test(t) ||
      /\b(increase|raise|bump|lower|reduce|decrease)\b.*\b(limit|coverage)\b/.test(t) ||
      /\$\d/.test(t) && /\b(limit|coverage)\b/.test(t)) {
    return "coverage_limit";
  }
  if (/\b(add|additional named insured|named insured|spouse|husband|wife|driver|partner)\b/.test(t)) {
    return "named_insured";
  }
  if (/\b(address|moved|moving|new home|garaging)\b/.test(t)) return "address";
  if (/\b(usage|commute|pleasure|daily|business use)\b/.test(t)) return "usage";
  if (/\bdeductible\b/.test(t)) return "deductible";
  return "general";
}

function editClassLabel(c: EditRequestClass): string {
  switch (c) {
    case "coverage_limit": return "coverage limit change";
    case "named_insured": return "add named insured / driver";
    case "address": return "address change";
    case "usage": return "usage change";
    case "deductible": return "deductible change";
    case "cancellation": return "cancellation request";
    case "general": return "general edit request";
  }
}

function summaryForEditClass(c: EditRequestClass, body: string): string {
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
  switch (c) {
    case "coverage_limit":
      return `It looks like you'd like to adjust your coverage limit — I'll pull the current declarations and run new numbers with the carrier.`;
    case "named_insured":
      return `It looks like you'd like to add a named insured or driver — I'll send over a short questionnaire so the carrier can underwrite the change.`;
    case "address":
      return `It looks like there's an address change — I'll need a few details (move-in date, the new garaging address, and any updated alarm / mitigation info) to update the carrier file.`;
    case "usage":
      return `It looks like you'd like to change how the asset is used — usage changes can affect both eligibility and rate, so I'll route this through the underwriter.`;
    case "deductible":
      return `It looks like you'd like to adjust your deductible — I'll quote a couple of options so you can see how each one moves your premium.`;
    case "cancellation":
      return `Heard you on the cancellation — before we file anything I want to make sure we explore alternatives (e.g. lowering coverage, switching carriers) so you're not leaving money on the table.`;
    case "general":
      return `Here's what you shared: "${preview}" — I'll review and circle back with what we need from you and what the carrier will require.`;
  }
}

function nextStepsForEditClass(c: EditRequestClass): string[] {
  switch (c) {
    case "coverage_limit":
      return [
        "I'll review your current declarations and prepare a coverage comparison",
        "Expect a follow-up within one business day with the new premium impact",
        "If you have a target limit in mind, reply with the number so I can run that scenario too",
      ];
    case "named_insured":
      return [
        "I'll send a short underwriting form for the new person (DOB, license #, driving history if applicable)",
        "We'll need a couple of business days for the carrier to approve the change",
        "Coverage on the new person starts only after the carrier issues a confirmation",
      ];
    case "address":
      return [
        "Please confirm the new garaging address and move-in date",
        "Send any updated wind-mitigation / 4-point / alarm certificates if you have them",
        "I'll re-rate with the new ZIP and let you know if the premium moves",
      ];
    case "usage":
      return [
        "Confirm the new usage type (pleasure / commute / collector / commercial)",
        "Estimate annual mileage if it's a vehicle, or hours-on-water if it's a vessel",
        "I'll route to the carrier for re-underwriting — most usage changes turn around in 2–3 business days",
      ];
    case "deductible":
      return [
        "I'll quote your policy at the current deductible plus two alternates (e.g. $1k, $2.5k, $5k)",
        "Reply with which option you'd like and I'll endorse it on the policy",
        "Most endorsements take effect the day after carrier approval",
      ];
    case "cancellation":
      return [
        "Before we file, I'd like a quick call to walk through why — sometimes there's a different fit that keeps you covered",
        "If you still want to cancel, I'll send the carrier's cancellation form for your signature",
        "Any earned-but-unbilled premium gets refunded within 30 days of the effective cancellation date",
      ];
    case "general":
      return [
        "I'll review the specifics and reply with what we need from you",
        "If documents are required from the carrier side, I'll attach them in the next message",
        "Expect a follow-up within one business day",
      ];
  }
}

// AI severity classifier for customer-prompted activities. Looks at
// the topic + message body and returns urgent / warning / info so
// the Activity Center importance icon recolors yellow → amber → red
// automatically. In production this is an LLM call with a tight
// system prompt; the demo uses keyword + topic heuristics so the
// classification is deterministic + auditable.
//
//   urgent  — cancellation, lapse, accident in progress, claim
//             filed, payment-issue / NSF, total loss, "today" /
//             "right now" / "ASAP" hints, anything that risks
//             coverage being unbound or money already at stake.
//   warning — coverage changes, endorsements, named-insured /
//             driver adds, address moves, deductible swaps,
//             renewal-cycle work, asset additions.
//   info    — general questions, document uploads, FYI updates,
//             "when you get a chance" framing.
//
// Returns the chosen severity + a one-line reason (the "AI rationale"
// that surfaces under the importance chip so the agent can see why
// the AI graded it the way it did).
function aiClassifyCustomerSeverity(input: {
  topic?: import("@/types").TaskTopic;
  body?: string;
  classification?: string;
}): { severity: TaskSeverity; reason: string } {
  const body = (input.body ?? "").toLowerCase();
  const topic = input.topic;
  const URGENT_KEYWORDS = [
    "asap",
    "urgent",
    "emergency",
    "right now",
    "today",
    "immediately",
    "accident",
    "crash",
    "totaled",
    "total loss",
    "flood",
    "fire",
    "broken into",
    "stolen",
    "theft",
    "hit by",
    "lawsuit",
    "served",
    "subpoena",
    "lien",
    "lapse",
    "lapsed",
    "uninsured",
    "nsf",
    "bounced",
    "declined card",
    "non payment",
    "non-payment",
    "non-renewed",
  ];
  if (URGENT_KEYWORDS.some((k) => body.includes(k))) {
    return {
      severity: "urgent",
      reason: "AI detected time-sensitive language (loss, lapse, or money-at-risk).",
    };
  }
  if (
    topic === "cancellation_request" ||
    input.classification === "cancellation" ||
    topic === "claim_filed" ||
    topic === "payment_issue" ||
    topic === "coverage_gap"
  ) {
    return {
      severity: "urgent",
      reason: "Topic risks loss of coverage or money already at stake.",
    };
  }
  if (
    topic === "claim_status" ||
    topic === "renewal_approaching" ||
    topic === "coverage_change" ||
    topic === "endorsement_request" ||
    topic === "policy_edit_request"
  ) {
    return {
      severity: "warning",
      reason: "Carrier-side change — review and turn around within the SLA.",
    };
  }
  if (topic === "document_upload") {
    return {
      severity: "info",
      reason: "Document received. Review when convenient.",
    };
  }
  return {
    severity: "info",
    reason: "General request — no time-sensitive signals detected.",
  };
}

// Human-readable label for the Activity Center topic taxonomy.
// Drives the summary line "Customer received automated message
// regarding [topic]…" rendered on every activity card.
// Centralized audit-log writer for Activity Center actions. Every
// Very small "is there a 2-letter state code in this string"
// extractor — used by the quoting workspace to match a contact's
// address against each carrier's stateAvailability list.
function extractStateFromString(s: string): string | undefined {
  const m = s.match(/\b([A-Z]{2})\b/);
  return m?.[1];
}

// Backwards-compat for the performance-goals model change (metric-keyed
// object → flat array). Coerce whatever is persisted into an array so
// the goal mutators never spread a stale object shape.
function coerceAgencyGoals(raw: unknown): import("@/types").PerformanceGoal[] {
  if (Array.isArray(raw)) return raw as import("@/types").PerformanceGoal[];
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, any>).map(([metric, g], i) => ({
      id: `goal_legacy_${metric}_${i}`,
      metric: metric as import("@/types").PerformanceGoalMetric,
      target: Number(g?.target ?? 0),
      period: (g?.period ?? "monthly") as import("@/types").PerformanceGoalPeriod,
      dueDate: g?.dueDate,
      scope: "company",
      updatedAt: g?.updatedAt ?? nowIso(),
    }));
  }
  return [];
}

// Given the current occurrence's remindAt and a recurrence config,
// return the next occurrence's ISO timestamp — or null if the series
// has ended (endsAt passed). Used by reminders.dismiss() to keep a
// recurring reminder rolling on each user's dashboard.
function nextOccurrenceIso(
  fromIso: string,
  rec: import("@/types").ReminderRecurrence
): string | null {
  const base = new Date(fromIso).getTime();
  const days =
    rec.pattern === "daily"
      ? 1
      : rec.pattern === "weekly"
      ? 7
      : rec.pattern === "biweekly"
      ? 14
      : rec.pattern === "monthly"
      ? 30
      : Math.max(1, rec.intervalDays ?? 1);
  const next = base + days * 24 * 60 * 60 * 1000;
  if (rec.endsAt && next > new Date(rec.endsAt).getTime()) return null;
  return new Date(next).toISOString();
}

// Centralized email-signature appender. Used by communications.create
// + customMessages.create so every outbound email a staff member
// sends from anywhere in the app picks up their personal signature
// (text + image markers). SMS, inbound, no-signature → pass through.
function applySenderEmailSignature(
  channel: string,
  direction: "inbound" | "outbound" | undefined,
  body: string,
  createdById?: string,
  mailboxOrigin?: Communication["mailboxOrigin"]
): string {
  if (channel !== "email" || direction !== "outbound" || !createdById) return body;
  if (mailboxOrigin === "provider_sync") return body;
  const sender = db.list("users").find((u) => u.id === createdById);
  if (!sender) return body;
  const senderAgency = db.list("agencies").find((agency) => agency.id === sender.tenantId);
  const agencyLogo = senderAgency?.logoUrl
    ? { name: `${senderAgency.name} logo`, dataUrl: senderAgency.logoUrl }
    : null;
  const signatureBlock = emailSignatureBlockForUser(sender, agencyLogo);
  return appendEmailSignatureBlock(body, signatureBlock);
}

function normalizeEmail(value?: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const bracketed = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const email = bracketed.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
  return (email ?? bracketed).trim().toLowerCase();
}

function displayNameFromEmailHeader(value?: string): string | undefined {
  const raw = (value ?? "").trim();
  if (!raw) return undefined;
  const match = raw.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  const name = (match?.[1] ?? "").trim();
  return name || undefined;
}

function mailboxForUser(userId?: string): {
  account?: string;
  provider?: MailProvider;
  connectionId?: string;
  status?: ConnectedMailboxStatus;
} {
  if (!userId) return {};
  const connection = db
    .list("connectedMailboxes")
    .find((mailbox) => mailbox.ownerType === "staff" && mailbox.userId === userId);
  if (connection) {
    return {
      account: connection.address,
      provider: connection.provider,
      connectionId: connection.id,
      status: connection.status,
    };
  }
  const user = db.list("users").find((u) => u.id === userId);
  if (!user) return {};
  const account = user.businessEmail ?? user.email;
  return {
    account,
    provider: user.mailProvider ?? inferMailProvider(account),
    status: "needs_auth",
  };
}

function agencyMarketingSender(tenantId: string): {
  fromName: string;
  fromEmail?: string;
  provider?: MailProvider;
  connectionId?: string;
  status?: ConnectedMailboxStatus;
} {
  const agency = db.list("agencies").find((row) => row.id === tenantId);
  const agencyContactEmail = normalizeEmail(agency?.contactEmail);
  const mailbox = db
    .list("connectedMailboxes")
    .find(
      (row) =>
        row.tenantId === tenantId &&
        row.ownerType === "agency_marketing" &&
        row.status !== "disabled"
    );
  const mailboxEmail = normalizeEmail(mailbox?.address);
  return {
    fromName: agency?.name.trim() || mailbox?.displayName || "Your Insurance Concierge",
    fromEmail: mailboxEmail || agencyContactEmail || undefined,
    provider:
      mailbox?.provider ??
      (mailboxEmail || agencyContactEmail ? inferMailProvider(mailboxEmail || agencyContactEmail) : undefined),
    connectionId: mailbox?.id,
    status: mailbox?.status ?? (agencyContactEmail ? "needs_auth" : undefined),
  };
}

function markMailboxSent(connectionId?: string) {
  if (!connectionId) return;
  db.update("connectedMailboxes", connectionId, { lastSendAt: nowIso(), updatedAt: nowIso() });
}

function communicationRecipientEmails(row: Communication): string[] {
  const external = normalizeEmail(row.externalRecipientEmail);
  if (external) return [external];
  if (row.customerId) {
    const customer = db.list("customers").find((c) => c.id === row.customerId);
    return customer?.email ? [normalizeEmail(customer.email)] : [];
  }
  if (row.prospectId) {
    const prospect = db.list("prospects").find((p) => p.id === row.prospectId);
    return prospect?.email ? [normalizeEmail(prospect.email)] : [];
  }
  if (row.carrierContactId) {
    const carrierContact = db
      .list("carrierContacts")
      .find((contact) => contact.id === row.carrierContactId);
    return carrierContact?.email ? [normalizeEmail(carrierContact.email)] : [];
  }
  return [];
}

function buildMailboxOutboxJob(row: Communication): MailboxOutboxJob | null {
  if (row.channel !== "email" || row.direction !== "outbound") return null;
  if (row.mailboxOrigin === "provider_sync") return null;
  const to = communicationRecipientEmails(row).filter(Boolean);
  const createdAt = nowIso();
  const status: MailboxOutboxStatus = to.length > 0 ? "queued" : "failed";
  return {
    id: uid("outbox"),
    tenantId: row.tenantId,
    communicationId: row.id,
    mailboxConnectionId: row.mailboxConnectionId,
    mailboxAccount: row.mailboxAccount,
    mailboxProvider: row.mailboxProvider,
    to,
    cc: row.cc,
    bcc: row.bcc,
    subject: row.subject,
    body: row.bodyHtml?.trim() || row.body,
    bodyFormat: row.bodyHtml?.trim() ? "html" : "plain",
    replyToMessageIdHeader: row.inReplyToHeader,
    references: row.references,
    externalThreadId: row.externalThreadId,
    attachments: row.attachments,
    replyContext:
      row.carrierContactId || row.carrierSubmissionId
        ? {
            communicationId: row.id,
            threadId: row.threadId,
            customerId: row.customerId,
            prospectId: row.prospectId,
            carrierContactId: row.carrierContactId,
            carrierSubmissionId: row.carrierSubmissionId,
          }
        : undefined,
    idempotencyKey: `communication:${row.tenantId}:${row.id}`,
    status,
    attemptCount: 0,
    lastError: status === "failed" ? "No recipient email address was available." : undefined,
    createdAt,
    updatedAt: createdAt,
    createdById: row.createdById,
  };
}

function updateCommunicationDeliveryFromOutbox(
  job: MailboxOutboxJob,
  status: Communication["deliveryStatus"],
  provider?: {
    provider?: "google" | "microsoft" | "transactional";
    connectionId?: string;
    mailboxAccount?: string;
    externalMessageId?: string;
    externalThreadId?: string;
    externalUrl?: string;
    rfc822MessageId?: string;
    messageIdHeader?: string;
  }
) {
  const patch: Partial<Communication> = { deliveryStatus: status };
  if (provider?.externalMessageId) patch.externalMessageId = provider.externalMessageId;
  if (provider?.externalThreadId) patch.externalThreadId = provider.externalThreadId;
  if (provider?.externalUrl) patch.externalUrl = provider.externalUrl;
  if (provider?.connectionId) patch.mailboxConnectionId = provider.connectionId;
  if (provider?.mailboxAccount) patch.mailboxAccount = provider.mailboxAccount;
  if (provider?.provider === "google") patch.mailboxProvider = "gmail";
  if (provider?.provider === "microsoft") patch.mailboxProvider = "outlook";
  const rfc822MessageId = provider?.rfc822MessageId ?? provider?.messageIdHeader;
  if (rfc822MessageId) {
    patch.rfc822MessageId = rfc822MessageId;
    patch.messageIdHeader = rfc822MessageId;
  }
  db.update("communications", job.communicationId, patch);
}

function reconcileOutboxFromProviderMessage(row: Communication) {
  if (row.direction !== "outbound" || !row.externalMessageId) return;
  const job = db
    .list("mailboxOutbox")
    .find(
      (entry) =>
        entry.tenantId === row.tenantId &&
        entry.status !== "sent" &&
        ((row.externalMessageId && entry.providerMessageId === row.externalMessageId) ||
          entry.communicationId === row.id)
    );
  if (!job) return;
  db.update("mailboxOutbox", job.id, {
    status: "sent",
    providerMessageId: row.externalMessageId,
    providerThreadId: row.externalThreadId,
    providerUrl: row.externalUrl,
    lastAttemptAt: nowIso(),
    updatedAt: nowIso(),
  });
}

type MailboxDeliveryProviderResult = {
  provider?: "google" | "microsoft" | "transactional";
  connectionId?: string;
  mailboxAccount?: string;
  status?: "sent";
  externalMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
  rfc822MessageId?: string;
  messageIdHeader?: string;
};

const liveMailboxDeliveryInFlight = new Set<string>();

function scheduleLiveMailboxDelivery(row: Communication, job: MailboxOutboxJob) {
  if (!shouldAttemptLiveMailboxDelivery(row, job)) return;
  const sender = row.createdById
    ? db.list("users").find((user) => user.id === row.createdById)
    : undefined;
  if (!sender && !serverSessionHeaders().authorization) {
    markOutboxFailedLocal(job.id, "Sign in again to send this email.");
    return;
  }
  void deliverMailboxOutboxJob({
    tenantId: row.tenantId,
    user: sender,
    jobId: job.id,
  });
}

function shouldAttemptLiveMailboxDelivery(row: Communication, job: MailboxOutboxJob) {
  if (isTestRuntime()) return false;
  if (typeof window === "undefined" || typeof fetch !== "function") return false;
  if (row.channel !== "email" || row.direction !== "outbound") return false;
  if (row.mailboxOrigin === "provider_sync") return false;
  return job.status === "queued" && job.to.length > 0;
}

async function deliverMailboxOutboxJob(input: { tenantId: string; user?: User; jobId: string }) {
  if (liveMailboxDeliveryInFlight.has(input.jobId)) return;
  const queued = db.list("mailboxOutbox").find((job) => job.id === input.jobId);
  if (!queued || queued.status === "sent" || queued.status === "sending" || queued.status === "cancelled") return;

  liveMailboxDeliveryInFlight.add(input.jobId);
  const sending = markOutboxSendingLocal(input.jobId);
  if (!sending) {
    liveMailboxDeliveryInFlight.delete(input.jobId);
    return;
  }

  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/send`, {
      method: "POST",
      headers: liveMailboxAuthHeaders(input.user, input.tenantId),
      body: JSON.stringify(mailboxSendPayload(sending, input.user)),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; result: MailboxDeliveryProviderResult }
      | { ok: false; message?: string; error?: unknown }
      | null;

    if (!response.ok || !json?.ok) {
      const message =
        (json && "message" in json && json.message) ||
        `Mailbox send failed with ${response.status} ${response.statusText}.`;
      markOutboxFailedLocal(input.jobId, message);
      return;
    }

    markOutboxSentLocal(input.jobId, json.result);
  } catch (error) {
    markOutboxFailedLocal(
      input.jobId,
      error instanceof Error ? error.message : "Mailbox send failed."
    );
  } finally {
    liveMailboxDeliveryInFlight.delete(input.jobId);
  }
}

function markOutboxSendingLocal(id: string): MailboxOutboxJob | null {
  const job = db.list("mailboxOutbox").find((row) => row.id === id);
  if (!job || job.status === "sent" || job.status === "cancelled") return job ?? null;
  const updated = db.update("mailboxOutbox", id, {
    status: "sending",
    attemptCount: job.attemptCount + 1,
    lastAttemptAt: nowIso(),
    lastError: undefined,
    updatedAt: nowIso(),
  });
  if (updated) updateCommunicationDeliveryFromOutbox(updated, "sending");
  return updated;
}

function markOutboxSentLocal(id: string, provider: MailboxDeliveryProviderResult = {}): MailboxOutboxJob | null {
  const job = db.list("mailboxOutbox").find((row) => row.id === id);
  if (!job) return null;
  const updated = db.update("mailboxOutbox", id, {
    status: "sent",
    providerMessageId: provider.externalMessageId ?? job.providerMessageId,
    providerThreadId: provider.externalThreadId ?? job.providerThreadId,
    providerUrl: provider.externalUrl ?? job.providerUrl,
    lastAttemptAt: nowIso(),
    lastError: undefined,
    updatedAt: nowIso(),
  });
  if (updated) {
    updateCommunicationDeliveryFromOutbox(updated, "sent", provider);
    markMailboxSent(updated.mailboxConnectionId);
  }
  return updated;
}

function markOutboxFailedLocal(id: string, error: string): MailboxOutboxJob | null {
  const job = db.list("mailboxOutbox").find((row) => row.id === id);
  if (!job) return null;
  const updated = db.update("mailboxOutbox", id, {
    status: "failed",
    lastError: error,
    lastAttemptAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (updated) {
    updateCommunicationDeliveryFromOutbox(updated, "failed");
    if (updated.mailboxConnectionId) {
      db.update("connectedMailboxes", updated.mailboxConnectionId, {
        lastError: error,
        updatedAt: nowIso(),
      });
    }
  }
  return updated;
}

function mailboxSendPayload(job: MailboxOutboxJob, user?: User) {
  return {
    connectionId: job.mailboxConnectionId,
    senderMode: "staff",
    senderName:
      user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || undefined,
    to: job.to,
    cc: job.cc,
    bcc: job.bcc,
    subject: job.subject,
    text: job.bodyFormat === "html" ? undefined : job.body,
    html: job.bodyFormat === "html" ? job.body : undefined,
    replyTo: job.mailboxAccount,
    replyToMessageIdHeader: job.replyToMessageIdHeader,
    references: job.references,
    externalThreadId: job.externalThreadId,
    replyContext: job.replyContext,
    attachments: (job.attachments ?? []).map((attachment) => ({
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      dataUrl: attachment.dataUrl,
    })),
  };
}

function liveMailboxAuthHeaders(user: User | undefined, tenantId: string): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...serverSessionHeaders(),
  };
  if (user) {
    headers["x-user-id"] = user.id;
    headers["x-user-role"] = user.role;
    headers["x-tenant-id"] = tenantId;
    if (user.branchId) headers["x-branch-id"] = user.branchId;
  }
  return headers;
}

function isTestRuntime() {
  return typeof process !== "undefined" && process.env.NODE_ENV === "test";
}

type MarketingCampaignPamphletPayload = {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  intro?: string;
  highlightsTitle?: string;
  highlights?: string[];
  ctaButton?: string;
  imagePrompt?: string;
};

const MARKETING_EMAIL_BODY_MARKER = "[[quotex:marketing-email-body]]";
const MARKETING_PAMPHLET_MARKER = "[[quotex:marketing-pamphlet]]";
const MARKETING_PAMPHLET_DATA_PREFIX = "[[quotex:marketing-pamphlet-data:";
const MARKETING_PAMPHLET_DATA_SUFFIX = "]]";

function buildMarketingPamphletMessage(input: {
  emailBody: string;
  pamphlet: MarketingCampaignPamphletPayload;
  heroImageUrl?: string;
  heroImageAlt: string;
  href: string;
  ctaLabel: string;
  recipientName?: string;
  pamphletTheme?: string;
}): string {
  const emailParts = splitMarketingEmailForPamphlet(input.emailBody, input.recipientName);
  const pamphlet = input.pamphlet;
  const emailBody = compactMarkdownBlocks([
    emailParts.greeting,
    emailParts.note,
    emailParts.closing,
  ]);
  const pamphletBody = compactMarkdownBlocks([
    markdownImage(input.heroImageUrl, input.heroImageAlt || pamphlet.headline || "Campaign image"),
    pamphlet.eyebrow ? `**${pamphlet.eyebrow.trim()}**` : "",
    pamphlet.headline ? `# ${pamphlet.headline.trim()}` : "",
    pamphlet.subheadline?.trim(),
    pamphlet.intro?.trim(),
    pamphlet.highlightsTitle ? `**${pamphlet.highlightsTitle.trim()}**` : "",
    marketingHighlightList(pamphlet.highlights),
    `[${input.ctaLabel}](${input.href})`,
  ]);
  return compactMarkdownBlocks([
    MARKETING_EMAIL_BODY_MARKER,
    emailBody,
    marketingPamphletDataBlock({
      pamphlet,
      imageUrl: input.heroImageUrl,
      imageAlt: input.heroImageAlt || pamphlet.headline || "Campaign image",
      ctaHref: input.href,
      ctaLabel: input.ctaLabel,
      themeId: input.pamphletTheme,
    }),
    MARKETING_PAMPHLET_MARKER,
    pamphletBody,
  ]);
}

function marketingPamphletDataBlock(input: {
  pamphlet: MarketingCampaignPamphletPayload;
  imageUrl?: string;
  imageAlt: string;
  ctaHref: string;
  ctaLabel: string;
  themeId?: string;
}): string {
  return `${MARKETING_PAMPHLET_DATA_PREFIX}${encodeURIComponent(JSON.stringify(input))}${MARKETING_PAMPHLET_DATA_SUFFIX}`;
}

function splitMarketingEmailForPamphlet(body: string, recipientName?: string): {
  greeting: string;
  note: string;
  closing: string;
} {
  const fallbackGreeting = `Hi ${firstNameFromDisplayName(recipientName) || "there"},`;
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  let greeting = fallbackGreeting;
  if (blocks[0] && /^hi\b[^,\n]*,/i.test(blocks[0])) {
    greeting = blocks.shift() ?? fallbackGreeting;
  }
  let closing = "";
  const last = blocks[blocks.length - 1];
  if (last && isMarketingClosingBlock(last)) {
    closing = blocks.pop() ?? "";
  }
  return {
    greeting,
    note: blocks.join("\n\n").trim(),
    closing,
  };
}

function isMarketingClosingBlock(block: string): boolean {
  return /^(best|warm regards|regards|thank you|thanks|sincerely),?\b/i.test(block.trim());
}

function personalizeMarketingMergeFields(
  text: string,
  contact?: { name?: string; email?: string } | null
): string {
  const name = contact?.name?.trim() || "there";
  const firstName = firstNameFromDisplayName(name) || name;
  const email = contact?.email?.trim() || "";
  return text
    .replace(/\{\{\s*first_name\s*\}\}|\{\s*first_name\s*\}/gi, firstName)
    .replace(/\{\{\s*firstName\s*\}\}|\{\s*firstName\s*\}/g, firstName)
    .replace(/\{\{\s*name\s*\}\}|\{\s*name\s*\}/gi, name)
    .replace(/\{\{\s*full_name\s*\}\}|\{\s*full_name\s*\}/gi, name)
    .replace(/\{\{\s*email\s*\}\}|\{\s*email\s*\}/gi, email);
}

function firstNameFromDisplayName(value?: string): string {
  const clean = value?.trim();
  if (!clean) return "";
  if (clean.includes("@")) return clean.split("@")[0] || "";
  return clean.split(/\s+/)[0] || clean;
}

function marketingHighlightList(items?: string[]): string {
  const lines = (items ?? []).map((item) => item.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  return lines.map((item) => `- ${item}`).join("\n");
}

function markdownImage(imageUrl?: string, alt = "Campaign image"): string {
  const cleanUrl = imageUrl?.trim();
  if (!cleanUrl) return "";
  return `![${cleanMarkdownLabel(alt)}](${cleanUrl})`;
}

function cleanMarkdownLabel(value: string): string {
  return value.replace(/[\]\n\r]/g, " ").replace(/\s{2,}/g, " ").trim() || "Campaign image";
}

function compactMarkdownBlocks(blocks: Array<string | undefined | null>): string {
  return blocks
    .map((block) => block?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

type MarketingCampaignDeliveryResult = {
  provider?: "google" | "microsoft" | "smtp" | "transactional";
  status?: "sent";
  externalMessageId?: string;
  fallbackReason?: string;
};

async function deliverMarketingCampaignEmail(input: {
  tenantId: string;
  user: User;
  sender: ReturnType<typeof agencyMarketingSender>;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ ok: true; result: MarketingCampaignDeliveryResult } | { ok: false; message: string }> {
  try {
    const response = await fetch(`${apiBaseUrl()}/mailboxes/send`, {
      method: "POST",
      headers: liveMailboxAuthHeaders(input.user, input.tenantId),
      body: JSON.stringify({
        connectionId:
          input.sender.status === "connected" ? input.sender.connectionId : undefined,
        senderMode: "agency_marketing",
        senderName: input.sender.fromName,
        to: [input.to],
        cc: [],
        bcc: [],
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.sender.fromEmail,
      }),
    });
    const json = (await response.json().catch(() => null)) as
      | { ok: true; result: MarketingCampaignDeliveryResult }
      | { ok: false; message?: string }
      | null;
    if (!response.ok || !json?.ok) {
      return {
        ok: false,
        message:
          (json && "message" in json && json.message) ||
          `Campaign delivery failed with ${response.status} ${response.statusText}.`,
      };
    }
    return json;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Campaign delivery failed.",
    };
  }
}

function marketingCampaignDeliveryContent(input: {
  emailBody: string;
  pamphlet?: MarketingCampaignPamphletPayload;
  heroImageUrl?: string;
  heroImageAlt: string;
  href: string;
  ctaLabel: string;
}): { text: string; html: string } {
  const pamphlet = input.pamphlet;
  const pamphletText = pamphlet
    ? compactMarkdownBlocks([
        pamphlet.eyebrow,
        pamphlet.headline,
        pamphlet.subheadline,
        pamphlet.intro,
        pamphlet.highlightsTitle,
        ...(pamphlet.highlights ?? []).map((item) => `- ${item}`),
        `${input.ctaLabel}: ${input.href}`,
      ])
    : "";
  const text = compactMarkdownBlocks([pamphletText, input.emailBody]);
  const safeImageUrl = safeMarketingEmailUrl(input.heroImageUrl);
  const safeHref = safeMarketingEmailUrl(input.href) ?? input.href;
  const pamphletHtml = pamphlet
    ? [
        safeImageUrl
          ? `<img src="${escapeMarketingHtml(safeImageUrl)}" alt="${escapeMarketingHtml(
              input.heroImageAlt
            )}" style="display:block;width:100%;max-width:680px;height:auto;margin:0 0 24px;" />`
          : "",
        pamphlet.eyebrow
          ? `<p style="margin:0 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;">${escapeMarketingHtml(
              pamphlet.eyebrow
            )}</p>`
          : "",
        pamphlet.headline
          ? `<h1 style="margin:0 0 12px;font-size:30px;line-height:1.2;">${escapeMarketingHtml(
              pamphlet.headline
            )}</h1>`
          : "",
        pamphlet.subheadline
          ? `<p style="margin:0 0 16px;font-size:18px;line-height:1.5;">${escapeMarketingHtml(
              pamphlet.subheadline
            )}</p>`
          : "",
        pamphlet.intro ? marketingTextToHtml(pamphlet.intro) : "",
        pamphlet.highlightsTitle
          ? `<p style="margin:20px 0 8px;font-weight:700;">${escapeMarketingHtml(
              pamphlet.highlightsTitle
            )}</p>`
          : "",
        (pamphlet.highlights ?? []).length
          ? `<ul style="margin:0 0 24px;padding-left:22px;">${(pamphlet.highlights ?? [])
              .map((item) => `<li style="margin:0 0 8px;">${escapeMarketingHtml(item)}</li>`)
              .join("")}</ul>`
          : "",
        `<p style="margin:24px 0;"><a href="${escapeMarketingHtml(
          safeHref
        )}" style="display:inline-block;background:#0b0b0a;color:#ffffff;text-decoration:none;padding:12px 18px;font-weight:700;">${escapeMarketingHtml(
          input.ctaLabel
        )}</a></p>`,
      ].join("")
    : safeImageUrl
    ? `<img src="${escapeMarketingHtml(safeImageUrl)}" alt="${escapeMarketingHtml(
        input.heroImageAlt
      )}" style="display:block;width:100%;max-width:680px;height:auto;margin:0 0 24px;" />`
    : "";
  return {
    text,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#171714;font-size:16px;line-height:1.55;max-width:680px;margin:0 auto;">${pamphletHtml}<div style="margin-top:28px;">${marketingTextToHtml(
      input.emailBody
    )}</div></div>`,
  };
}

function marketingTextToHtml(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px;">${escapeMarketingHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function safeMarketingEmailUrl(value?: string): string | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  try {
    const parsed = new URL(clean, typeof window !== "undefined" ? window.location.origin : undefined);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function escapeMarketingHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeMarketingMessageForDisplay(row: MarketingMessage): MarketingMessage {
  const contact = row.customerId
    ? db.list("customers").find((customer) => customer.id === row.customerId)
    : row.prospectId
    ? db.list("prospects").find((prospect) => prospect.id === row.prospectId)
    : null;
  if (!contact || (!hasMarketingMergeField(row.content) && !hasMarketingMergeField(row.subject ?? ""))) {
    return row;
  }
  return {
    ...row,
    subject: row.subject ? personalizeMarketingMergeFields(row.subject, contact) : row.subject,
    content: personalizeMarketingMergeFields(row.content, contact),
  };
}

function hasMarketingMergeField(value: string): boolean {
  return /\{\{?\s*(first_name|firstName|name|full_name|email)\s*\}?\}/i.test(value);
}

function upsertStaffMailboxAuthorization(user: User, byUserId?: string): ConnectedMailbox | null {
  if (!user.tenantId || !isStaffRole(user.role)) return null;
  const address = (user.businessEmail ?? user.email).trim().toLowerCase();
  if (!address) return null;
  const provider = user.mailProvider ?? inferMailProvider(address);
  const id = `mailbox_staff_${user.id}`;
  const existing = db.list("connectedMailboxes").find((mailbox) => mailbox.id === id);
  const patch: Partial<ConnectedMailbox> = {
    tenantId: user.tenantId,
    ownerType: "staff",
    userId: user.id,
    address,
    provider,
    displayName: user.name,
    status: "needs_auth",
    authMode: "oauth",
    scopes: [],
    updatedAt: nowIso(),
    updatedById: byUserId,
  };
  if (existing) return db.update("connectedMailboxes", id, patch);
  return db.insert("connectedMailboxes", {
    ...(patch as Omit<ConnectedMailbox, "id" | "connectedAt">),
    id,
  });
}

function upsertAgencyMarketingMailboxAuthorization(agency: Agency, byUserId?: string): ConnectedMailbox | null {
  const address = agency.contactEmail.trim().toLowerCase();
  if (!address) return null;
  const id = `mailbox_agency_marketing_${agency.id}`;
  const existing = db.list("connectedMailboxes").find((mailbox) => mailbox.id === id);
  const patch: Partial<ConnectedMailbox> = {
    tenantId: agency.id,
    ownerType: "agency_marketing",
    agencyId: agency.id,
    address,
    provider: inferMailProvider(address),
    displayName: `${agency.name} Marketing`,
    status: "needs_auth",
    authMode: "oauth",
    scopes: [],
    updatedAt: nowIso(),
    updatedById: byUserId,
  };
  if (existing) return db.update("connectedMailboxes", id, patch);
  return db.insert("connectedMailboxes", {
    ...(patch as Omit<ConnectedMailbox, "id" | "connectedAt">),
    id,
  });
}

function resolveEmailContact(
  tenantId: string,
  email: string
): Pick<Communication, "customerId" | "prospectId" | "carrierContactId"> | null {
  const target = normalizeEmail(email);
  if (!target) return null;
  const customer = db.list("customers").find(
    (c) =>
      c.tenantId === tenantId &&
      (normalizeEmail(c.email) === target ||
        (c.additionalContacts ?? []).some((a) => normalizeEmail(a.email) === target))
  );
  if (customer) return { customerId: customer.id };
  const prospect = db
    .list("prospects")
    .find((p) => p.tenantId === tenantId && normalizeEmail(p.email) === target);
  if (prospect) return { prospectId: prospect.id };
  const carrierContact = db
    .list("carrierContacts")
    .find((c) => c.tenantId === tenantId && normalizeEmail(c.email) === target);
  if (carrierContact) return { carrierContactId: carrierContact.id };
  return null;
}

function threadIdFromReferencedHeaders(
  tenantId: string,
  input: { externalThreadId?: string; inReplyToHeader?: string; references?: string[] }
): string | null {
  const normalizedRefs = new Set(
    [input.inReplyToHeader, ...(input.references ?? [])]
      .map((value) => normalizeMessageHeaderId(value))
      .filter(Boolean)
  );
  const match = db
    .list("communications")
    .find((row) => {
      if (row.tenantId !== tenantId || row.channel !== "email") return false;
      if (input.externalThreadId && row.externalThreadId === input.externalThreadId) return true;
      const rowHeaders = [
        row.messageIdHeader,
        row.externalMessageId,
        row.inReplyToHeader,
        ...(row.references ?? []),
      ].map((value) => normalizeMessageHeaderId(value));
      return rowHeaders.some((value) => value && normalizedRefs.has(value));
    });
  return match?.threadId ?? null;
}

function normalizeMessageHeaderId(value?: string): string {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function communicationStatusEvent(row: Communication) {
  if (!row.customerId && !row.prospectId) return;
  if (row.direction === "inbound" && row.channel === "email") {
    ensureInboundEmailRemark(row);
    return;
  }
  const existing = db
    .list("statusEvents")
    .find((event) => event.communicationId === row.id);
  if (existing) return;
  const channelLabel =
    row.channel === "email" ? "Email"
    : row.channel === "call" ? "Call"
    : row.channel === "note" ? "Note"
    : String(row.channel);
  const dirVerb = row.direction === "outbound" ? "sent" : "received";
  const subject = row.subject ? `: ${row.subject}` : "";
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: row.tenantId,
    source: row.direction === "inbound" ? "customer" : "agent",
    message: `${channelLabel} ${dirVerb}${subject}.`,
    visibility: row.channel === "note" ? "internal" : "customer_visible",
    customerId: row.customerId,
    prospectId: row.prospectId,
    communicationId: row.id,
    createdAt: row.createdAt || nowIso(),
    createdById: row.createdById,
  });
}

// state change on a Task (created, viewed, replied, in-progress,
// resolved, snoozed, reassigned) routes through here so managers
// can reconstruct the full history of any activity from
// api.tasks.history(taskId).
function logTaskAudit(input: {
  tenantId: string;
  actorId?: string;
  action: string;
  taskId: string;
  metadata?: Record<string, unknown>;
}) {
  db.insert("audit", {
    id: uid("audit"),
    tenantId: input.tenantId,
    actorId: input.actorId ?? "system",
    action: input.action,
    entityType: "task",
    entityId: input.taskId,
    metadata: input.metadata,
    createdAt: nowIso(),
  });
}

function createActionTaskOnce(input: {
  tenantId: string;
  activityKey: string;
  title: string;
  description?: string;
  customerId?: string;
  prospectId?: string;
  assetId?: string;
  policyId?: string;
  claimId?: string;
  documentId?: string;
  quoteSessionId?: string;
  quoteRequestId?: string;
  renewalId?: string;
  messageId?: string;
  topic?: Task["topic"];
  severity?: TaskSeverity;
  severityReason?: string;
  assignedToId?: string;
  additionalAssignedToIds?: string[];
  awaitingManagerAssignment?: boolean;
  createdById?: string;
  createdAt?: string;
  auditAction?: string;
  auditMetadata?: Record<string, unknown>;
}): Task {
  const existing = db
    .list("tasks")
    .find(
      (t) =>
        t.tenantId === input.tenantId &&
        t.activityKey === input.activityKey &&
        !t.completedAt &&
        t.status !== "resolved"
    );
  if (existing) return existing;
  const inheritedOwnerIds = input.assignedToId
    ? []
    : linkedContactOwners({
      tenantId: input.tenantId,
      customerId: input.customerId,
      prospectId: input.prospectId,
    });
  const assignedToId = input.assignedToId ?? inheritedOwnerIds[0];
  const additionalAssignedToIds =
    input.additionalAssignedToIds ??
    (!input.assignedToId && inheritedOwnerIds.length > 1
      ? inheritedOwnerIds.slice(1)
      : undefined);
  const linkedToContact = !!input.customerId || !!input.prospectId;
  const row: Task = {
    id: uid("task"),
    tenantId: input.tenantId,
    activityKey: input.activityKey,
    title: input.title,
    description: input.description,
    customerId: input.customerId,
    prospectId: input.prospectId,
    assetId: input.assetId,
    policyId: input.policyId,
    claimId: input.claimId,
    documentId: input.documentId,
    quoteSessionId: input.quoteSessionId,
    quoteRequestId: input.quoteRequestId,
    renewalId: input.renewalId,
    messageId: input.messageId,
    source: "ai_notification",
    topic: input.topic,
    severity: input.severity ?? "warning",
    severityReason: input.severityReason,
    status: "open",
    assignedToId,
    additionalAssignedToIds,
    awaitingManagerAssignment:
      input.awaitingManagerAssignment ?? (linkedToContact && !assignedToId ? true : undefined),
    createdById: input.createdById ?? "ai",
    createdAt: input.createdAt ?? nowIso(),
  };
  db.insert("tasks", row);
  logTaskAudit({
    tenantId: input.tenantId,
    actorId: input.createdById ?? "ai",
    action: input.auditAction ?? "task.created_from_trigger",
    taskId: row.id,
    metadata: { activityKey: input.activityKey, ...(input.auditMetadata ?? {}) },
  });
  return row;
}

function inboundEmailIdentity(row: Communication): string {
  const messageHeader = normalizeMessageHeaderId(
    row.messageIdHeader ?? row.rfc822MessageId
  );
  if (messageHeader) return `message:${messageHeader}`;

  const externalMessageId = normalizeMessageHeaderId(row.externalMessageId);
  if (externalMessageId) {
    return `provider:${row.mailboxProvider ?? "unknown"}:${externalMessageId}`;
  }

  return `communication:${row.id}`;
}

function inboundEmailActivityKey(row: Communication): string {
  return `inbound-email:${inboundEmailIdentity(row)}`;
}

function inboundEmailCopies(row: Communication): Communication[] {
  const identity = inboundEmailIdentity(row);
  return db
    .list("communications")
    .filter(
      (candidate) =>
        candidate.tenantId === row.tenantId &&
        candidate.direction === "inbound" &&
        candidate.channel === "email" &&
        inboundEmailIdentity(candidate) === identity
    );
}

function preferredInboundEmailCommunication(
  communications: Communication[]
): Communication | undefined {
  return [...communications].sort((a, b) => {
    const score = (candidate: Communication) =>
      (candidate.externalUrl ? 8 : 0) +
      (candidate.externalMessageId ? 4 : 0) +
      (candidate.messageIdHeader || candidate.rfc822MessageId ? 2 : 0) +
      ((candidate.attachments?.length ?? 0) > 0 ? 1 : 0);
    const scoreDifference = score(b) - score(a);
    if (scoreDifference !== 0) return scoreDifference;
    const createdDifference = a.createdAt.localeCompare(b.createdAt);
    return createdDifference !== 0 ? createdDifference : a.id.localeCompare(b.id);
  })[0];
}

function inboundEmailStatusEvents(row: Communication): StatusEvent[] {
  const identity = inboundEmailIdentity(row);
  const communicationIds = new Set(inboundEmailCopies(row).map((copy) => copy.id));
  return db
    .list("statusEvents")
    .filter(
      (event) =>
        event.tenantId === row.tenantId &&
        (event.inboundEmailIdentity === identity ||
          (!!event.communicationId &&
            communicationIds.has(event.communicationId) &&
            /^(?:email received|inbound email remark)\b/i.test(event.message)))
    );
}

function ensureInboundEmailRemark(
  inbound: Communication,
  taskId?: string
): StatusEvent | undefined {
  if (
    inbound.direction !== "inbound" ||
    inbound.channel !== "email" ||
    (!inbound.customerId && !inbound.prospectId)
  ) {
    return undefined;
  }

  const copies = inboundEmailCopies(inbound);
  const canonicalCommunication =
    preferredInboundEmailCommunication(copies) ?? inbound;
  const identity = inboundEmailIdentity(inbound);
  const linkedTaskId =
    taskId ??
    preferredInboundEmailTask(inboundEmailTasks(inbound))?.id ??
    canonicalCommunication.aiActivityTaskId;
  const subject = canonicalCommunication.subject?.trim() || "(no subject)";
  const patch: Omit<StatusEvent, "id"> = {
    tenantId: inbound.tenantId,
    source: "customer",
    message: `Inbound email remark: ${subject}.`,
    visibility: "internal",
    customerId:
      canonicalCommunication.customerId ??
      copies.find((copy) => copy.customerId)?.customerId,
    prospectId:
      canonicalCommunication.prospectId ??
      copies.find((copy) => copy.prospectId)?.prospectId,
    communicationId: canonicalCommunication.id,
    taskId: linkedTaskId,
    inboundEmailIdentity: identity,
    createdAt: canonicalCommunication.createdAt || inbound.createdAt || nowIso(),
    createdById: canonicalCommunication.createdById,
  };
  const existing = inboundEmailStatusEvents(inbound).sort((a, b) => {
    const score = (event: StatusEvent) =>
      (event.inboundEmailIdentity ? 4 : 0) +
      (event.taskId ? 2 : 0) +
      (event.communicationId === canonicalCommunication.id ? 1 : 0);
    const scoreDifference = score(b) - score(a);
    if (scoreDifference !== 0) return scoreDifference;
    return a.createdAt.localeCompare(b.createdAt);
  })[0];

  if (existing) {
    return db.update("statusEvents", existing.id, patch) ?? {
      ...existing,
      ...patch,
    };
  }

  return db.insert("statusEvents", {
    id: uid("se"),
    ...patch,
  });
}

function inboundEmailTasks(row: Communication): Task[] {
  const communicationIds = new Set(inboundEmailCopies(row).map((candidate) => candidate.id));
  const activityKey = inboundEmailActivityKey(row);
  return db
    .list("tasks")
    .filter(
      (task) =>
        task.tenantId === row.tenantId &&
        (task.activityKey === activityKey ||
          (!!task.messageId && communicationIds.has(task.messageId)) ||
          (!!task.originalMessageId && communicationIds.has(task.originalMessageId)))
    );
}

function preferredInboundEmailTask(tasks: Task[]): Task | undefined {
  return [...tasks].sort((a, b) => {
    const activeA = !a.completedAt && a.status !== "resolved" ? 0 : 1;
    const activeB = !b.completedAt && b.status !== "resolved" ? 0 : 1;
    if (activeA !== activeB) return activeA - activeB;
    const inProgressA = a.status === "in_progress" ? 0 : 1;
    const inProgressB = b.status === "in_progress" ? 0 : 1;
    if (inProgressA !== inProgressB) return inProgressA - inProgressB;
    return a.createdAt.localeCompare(b.createdAt);
  })[0];
}

function linkInboundEmailCopiesToTask(
  inbound: Communication,
  taskId: string
) {
  inboundEmailCopies(inbound).forEach((copy) => {
    if (copy.aiActivityTaskId !== taskId) {
      db.update("communications", copy.id, { aiActivityTaskId: taskId });
    }
  });
  ensureInboundEmailRemark(inbound, taskId);
}

function consolidateInboundEmailActivities(tenantId: string, actorId?: string) {
  const grouped = new Map<string, Communication[]>();
  db
    .list("communications")
    .filter(
      (row) =>
        row.tenantId === tenantId &&
        row.direction === "inbound" &&
        row.channel === "email"
    )
    .forEach((row) => {
      const identity = inboundEmailIdentity(row);
      const group = grouped.get(identity) ?? [];
      group.push(row);
      grouped.set(identity, group);
    });

  grouped.forEach((communications) => {
    const reference = communications[0];
    const tasks = inboundEmailTasks(reference);
    const keeper = preferredInboundEmailTask(tasks);
    ensureInboundEmailRemark(reference, keeper?.id);
    if (tasks.length === 0) return;
    if (!keeper) return;

    const activityKey = inboundEmailActivityKey(reference);
    if (keeper.activityKey !== activityKey) {
      db.update("tasks", keeper.id, { activityKey });
    }
    linkInboundEmailCopiesToTask(reference, keeper.id);

    tasks
      .filter(
        (task) =>
          task.id !== keeper.id &&
          !task.completedAt &&
          task.status !== "resolved"
      )
      .forEach((duplicate) => {
        const completedAt = nowIso();
        db.update("tasks", duplicate.id, {
          status: "resolved",
          completedAt,
          completedById: actorId ?? "system",
          resolutionNote:
            "Automatically consolidated with the single activity for this inbound email.",
          resolutionNoteAt: completedAt,
        });
        logTaskAudit({
          tenantId,
          actorId: actorId ?? "system",
          action: "task.resolved_duplicate_inbound_email",
          taskId: duplicate.id,
          metadata: {
            canonicalTaskId: keeper.id,
            canonicalActivityKey: activityKey,
          },
        });
      });
  });
}

function ensureInboundEmailTask(input: {
  inbound: Communication;
  title: string;
  description?: string;
  topic?: Task["topic"];
  severity?: TaskSeverity;
  severityReason?: string;
  assignedToId?: string;
  awaitingManagerAssignment?: boolean;
  documentId?: string;
  actorId?: string;
  auditAction: string;
  auditMetadata?: Record<string, unknown>;
  aiSummary?: string;
  originalMessageContent?: string;
  originalMessageId?: string;
  aiReplyBody?: string;
  aiReplySubject?: string;
}): Task {
  const activityKey = inboundEmailActivityKey(input.inbound);
  const existing = preferredInboundEmailTask(inboundEmailTasks(input.inbound));
  if (existing) {
    if (existing.activityKey !== activityKey) {
      db.update("tasks", existing.id, { activityKey });
    }
    linkInboundEmailCopiesToTask(input.inbound, existing.id);
    return db.list("tasks").find((task) => task.id === existing.id) ?? existing;
  }

  const task = createActionTaskOnce({
    tenantId: input.inbound.tenantId,
    activityKey,
    title: input.title,
    description: input.description,
    customerId: input.inbound.customerId,
    prospectId: input.inbound.prospectId,
    documentId: input.documentId,
    messageId: input.inbound.id,
    topic: input.topic,
    severity: input.severity,
    severityReason: input.severityReason,
    assignedToId: input.assignedToId,
    awaitingManagerAssignment: input.awaitingManagerAssignment,
    createdById: "ai",
    createdAt: input.inbound.createdAt,
    auditAction: input.auditAction,
    auditMetadata: {
      communicationId: input.inbound.id,
      emailIdentity: inboundEmailIdentity(input.inbound),
      ...(input.auditMetadata ?? {}),
    },
  });
  const updated = db.update("tasks", task.id, {
    aiSummary: input.aiSummary,
    originalMessageContent: input.originalMessageContent,
    originalMessageId: input.originalMessageId,
    aiReplyBody: input.aiReplyBody,
    aiReplySubject: input.aiReplySubject,
  });
  linkInboundEmailCopiesToTask(input.inbound, task.id);
  return updated ?? task;
}

function resolveActionTasks(
  tenantId: string,
  activityKeys: string[],
  actorId?: string,
  auditAction = "task.resolved_by_trigger"
) {
  const keySet = new Set(activityKeys);
  db
    .list("tasks")
    .filter(
      (t) =>
        t.tenantId === tenantId &&
        !!t.activityKey &&
        keySet.has(t.activityKey) &&
        !t.completedAt &&
        t.status !== "resolved"
    )
    .forEach((task) => {
      db.update("tasks", task.id, {
        status: "resolved",
        completedAt: nowIso(),
        completedById: actorId ?? "system",
      });
      logTaskAudit({
        tenantId,
        actorId: actorId ?? "system",
        action: auditAction,
        taskId: task.id,
        metadata: { activityKey: task.activityKey },
      });
    });
}

function logQuotingWorkflowProgress(
  session: Pick<
    QuotingSession,
    "id" | "tenantId" | "customerId" | "prospectId" | "assetId" | "createdById"
  >,
  input: {
    message: string;
    detail?: string;
    createdAt?: string;
    createdById?: string;
    policyId?: string;
    assetId?: string;
    communicationId?: string;
    documentId?: string;
    source?: StatusEventSource;
  }
) {
  const createdAt = input.createdAt ?? nowIso();
  const actorId = input.createdById ?? "ai";
  const body = input.detail ? `${input.message}\n\n${input.detail}` : input.message;
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: session.tenantId,
    source: input.source ?? "ai",
    message: input.message,
    visibility: "internal",
    customerId: session.customerId,
    prospectId: session.prospectId,
    assetId: input.assetId ?? session.assetId,
    policyId: input.policyId,
    communicationId: input.communicationId,
    documentId: input.documentId,
    createdAt,
    createdById: actorId,
  });
  db.insert("notes", {
    id: uid("note"),
    tenantId: session.tenantId,
    authorId: actorId,
    customerId: session.customerId,
    prospectId: session.prospectId,
    policyId: input.policyId,
    body: `AI quoting workflow: ${body}`,
    visibility: "internal",
    createdAt,
  });
}

function quoteSessionContact(session: Pick<QuotingSession, "customerId" | "prospectId">): {
  name: string;
  assignedAgentId?: string;
  assignedCsrId?: string;
} {
  if (session.customerId) {
    const customer = db.list("customers").find((c) => c.id === session.customerId);
    if (customer) {
      return {
        name: customer.name,
        assignedAgentId: customer.assignedAgentId,
        assignedCsrId: customer.assignedCsrId,
      };
    }
  }
  if (session.prospectId) {
    const prospect = db.list("prospects").find((p) => p.id === session.prospectId);
    if (prospect) {
      return {
        name: prospect.name,
        assignedAgentId: prospect.assignedAgentId,
        assignedCsrId: prospect.assignedCsrId,
      };
    }
  }
  return { name: "Client" };
}

function quoteSessionAssignedStaffIds(
  session: Pick<QuotingSession, "tenantId" | "createdById" | "customerId" | "prospectId">
): string[] {
  const accountOwners = linkedContactOwners({
    tenantId: session.tenantId,
    customerId: session.customerId,
    prospectId: session.prospectId,
  });
  if (accountOwners.length > 0) return accountOwners;
  const creator = db.list("users").find((u) => u.id === session.createdById);
  return creator && isStaffRole(creator.role) ? [creator.id] : [];
}

function quoteSessionAssignedStaff(
  session: Pick<QuotingSession, "tenantId" | "createdById" | "customerId" | "prospectId">
): string | undefined {
  return quoteSessionAssignedStaffIds(session)[0];
}

function quoteMilestoneKey(sessionId: string, milestone: string): string {
  return `quote-session:${sessionId}:${milestone}`;
}

function createQuoteMilestoneTask(
  session: QuotingSession,
  input: {
    milestone: string;
    title: string;
    description: string;
    severity?: TaskSeverity;
    severityReason?: string;
    createdById?: string;
    auditAction?: string;
  }
): Task {
  const [assignedToId, ...additionalAssignedToIds] = quoteSessionAssignedStaffIds(session);
  return createActionTaskOnce({
    tenantId: session.tenantId,
    activityKey: quoteMilestoneKey(session.id, input.milestone),
    title: input.title,
    description: input.description,
    customerId: session.customerId,
    prospectId: session.prospectId,
    assetId: session.assetId,
    quoteSessionId: session.id,
    quoteRequestId: session.quoteRequestId,
    topic: "other",
    severity: input.severity ?? "warning",
    severityReason: input.severityReason,
    assignedToId,
    additionalAssignedToIds:
      additionalAssignedToIds.length > 0 ? additionalAssignedToIds : undefined,
    createdById: input.createdById ?? "ai",
    auditAction: input.auditAction ?? "task.created_from_quote_milestone",
    auditMetadata: { quoteSessionId: session.id, quoteRequestId: session.quoteRequestId, milestone: input.milestone },
  });
}

function createQuoteReadyNotification(
  session: QuotingSession,
  input: {
    title: string;
    summary: string;
    severity?: TaskSeverity;
    severityReason?: string;
  }
): AiNotification {
  const existing = db
    .list("aiNotifications")
    .find(
      (notification) =>
        notification.tenantId === session.tenantId &&
        notification.kind === "quote_ready" &&
        notification.quoteSessionId === session.id &&
        !notification.acknowledgedAt
    );
  if (existing) return existing;
  const row: AiNotification = {
    id: uid("ain"),
    tenantId: session.tenantId,
    kind: "quote_ready",
    title: input.title,
    summary: input.summary,
    customerId: session.customerId,
    prospectId: session.prospectId,
    assetId: session.assetId,
    quoteSessionId: session.id,
    quoteRequestId: session.quoteRequestId,
    topic: "other",
    severity: input.severity ?? "warning",
    severityReason: input.severityReason,
    assignedToId: quoteSessionAssignedStaff(session),
    createdAt: nowIso(),
  };
  db.insert("aiNotifications", row);
  return row;
}

function resolveQuoteMilestoneTasks(
  session: Pick<QuotingSession, "id" | "tenantId">,
  milestones: string[],
  actorId?: string
) {
  resolveActionTasks(
    session.tenantId,
    milestones.map((milestone) => quoteMilestoneKey(session.id, milestone)),
    actorId ?? "ai",
    "task.resolved_by_quote_milestone"
  );
}

function isLegacyQuoteReadyActivity(task: Task): boolean {
  return !!task.activityKey?.startsWith("quote-session:") && task.activityKey.endsWith(":quote_ready");
}

function quoteActivityDescription(session: QuotingSession): string {
  const lineLabel = session.lineOfBusiness === "commercial" ? "commercial-lines" : "personal-lines";
  switch (session.status) {
    case "awaiting_reply":
      return `Quotex sent the ${lineLabel} questionnaire and is waiting for the client to respond.`;
    case "quoting":
      return `Quotex received the required information and is running the ${lineLabel} carrier quotes.`;
    case "complete":
      return `Quotex completed the ${lineLabel} quote flow and prepared the carrier ranking for review.`;
    case "gathering_info":
    default:
      return `The ${lineLabel} quote flow has started and is gathering the information needed for the next step.`;
  }
}

function syncQuoteActivityStatus(
  session: QuotingSession,
  options?: { taskIds?: string[]; actorId?: string }
): number {
  const explicitTaskIds = new Set(options?.taskIds ?? []);
  const milestonePrefix = `quote-session:${session.id}:`;
  const actorId = options?.actorId ?? "ai";
  const description = quoteActivityDescription(session);
  const quoteRequest = session.quoteRequestId
    ? db.list("quoteRequests").find((row) => row.id === session.quoteRequestId)
    : undefined;
  if (quoteRequest?.recoveryTaskId) explicitTaskIds.add(quoteRequest.recoveryTaskId);

  const directlyLinkedTasks = db.list("tasks").filter(
    (task) =>
      task.tenantId === session.tenantId &&
      !task.activityKey?.startsWith(milestonePrefix) &&
      (explicitTaskIds.has(task.id) ||
        task.quoteSessionId === session.id ||
        (!!session.quoteRequestId && task.quoteRequestId === session.quoteRequestId))
  );

  // A flow can begin before its Activity Center row has a session ID. Link
  // only the newest unresolved activity that represents the same quote need,
  // and never take a task already owned by another flow. Coverage-change
  // requests often start a quote without using the word "quote" in the task.
  const fallbackTask = directlyLinkedTasks.length
    ? undefined
    : db
        .list("tasks")
        .filter((task) => {
          if (task.tenantId !== session.tenantId || task.status === "resolved" || task.completedAt) {
            return false;
          }
          if (task.quoteSessionId && task.quoteSessionId !== session.id) return false;
          const sameContact = session.customerId
            ? task.customerId === session.customerId
            : session.prospectId
              ? task.prospectId === session.prospectId
              : false;
          if (!sameContact) return false;
          const quoteText = `${task.title} ${task.description ?? ""} ${task.aiSummary ?? ""}`;
          return (
            task.expressQuoteFollowUp === true ||
            task.topic === "coverage_change" ||
            /\bquot(?:e|ing)\b/i.test(quoteText)
          );
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  const tasks = fallbackTask ? [...directlyLinkedTasks, fallbackTask] : directlyLinkedTasks;

  let changedCount = 0;
  tasks.forEach((task) => {
      // Autonomous retries must never reopen work that a user already closed.
      if (task.status === "resolved" || task.completedAt) return;

      const changedAt = nowIso();
      const wasInProgress = task.status === "in_progress";
      const nextAssetId = task.assetId ?? session.assetId;
      const alreadySynced =
        wasInProgress &&
        task.description === description &&
        task.quoteSessionId === session.id &&
        task.assetId === nextAssetId &&
        !!task.startedAt &&
        !task.snoozedUntil;
      if (alreadySynced) return;

      db.update("tasks", task.id, {
        description,
        quoteSessionId: session.id,
        assetId: nextAssetId,
        status: "in_progress",
        startedAt: task.startedAt ?? changedAt,
        startedById: task.startedById ?? actorId,
        snoozedUntil: undefined,
      });
      if (!wasInProgress) {
        logTaskAudit({
          tenantId: task.tenantId,
          actorId,
          action:
            session.lineOfBusiness === "personal"
              ? "task.in_progress_by_personal_quote_automation"
              : "task.in_progress_by_quote_flow",
          taskId: task.id,
          metadata: { quoteSessionId: session.id, quoteStatus: session.status },
        });
      }
      changedCount += 1;
    });
  return changedCount;
}

function actorName(userId?: string): string {
  if (!userId) return "System";
  if (userId === "ai") return "AI";
  const user = db.list("users").find((u) => u.id === userId);
  return user?.name ?? "Staff";
}

function carrierName(carrierId?: string): string {
  if (!carrierId) return "Carrier";
  return db.list("carriers").find((c) => c.id === carrierId)?.name ?? "Carrier";
}

function policyRef(policy?: Pick<Policy, "policyNumber" | "id"> | null): string {
  if (!policy) return "policy";
  return policy.policyNumber ? `Policy #${policy.policyNumber}` : `Policy #${policy.id.slice(-6).toUpperCase()}`;
}

function primaryOwnerForCustomer(customer?: CustomerProfile | null): string | undefined {
  return assignedContactOwner(customer);
}

function customerForPolicy(policy?: Policy | null): CustomerProfile | undefined {
  return policy ? db.list("customers").find((c) => c.id === policy.customerId) : undefined;
}

function ensureClaimActionTask(claim: Claim, actorId?: string): Task | null {
  const key = `claim:${claim.id}:open`;
  if (claim.status === "closed") {
    resolveActionTasks(claim.tenantId, [key], actorId, "task.resolved_by_claim_close");
    return null;
  }
  const customer = db.list("customers").find((c) => c.id === claim.customerId);
  const policy = db.list("policies").find((p) => p.id === claim.policyId);
  const carrier = db.list("carriers").find((c) => c.id === claim.carrierId);
  return createActionTaskOnce({
    tenantId: claim.tenantId,
    activityKey: key,
    title: `Open claim: ${customer?.name ?? "Client"}${policy ? ` - ${policyRef(policy)}` : ""}`,
    description: `${customer?.name ?? "A client"} has an open claim with ${
      carrier?.name ?? "the carrier"
    }. Track status, keep documents current, and close the activity when the claim is closed.`,
    customerId: claim.customerId,
    policyId: claim.policyId,
    claimId: claim.id,
    topic: "claim_status",
    severity: claim.status === "opened" ? "urgent" : "warning",
    severityReason: "Open claim requires staff monitoring until closed.",
    assignedToId: primaryOwnerForCustomer(customer),
    createdById: actorId ?? "ai",
    auditAction: "task.created_from_claim",
    auditMetadata: { claimId: claim.id },
  });
}

function logClaimRecordTimeline(
  claim: Claim,
  action: "opened" | "updated" | "closed" | "checked",
  detail?: string,
  actorId?: string
) {
  const customer = db.list("customers").find((c) => c.id === claim.customerId);
  const policy = db.list("policies").find((p) => p.id === claim.policyId);
  const carrier = db.list("carriers").find((c) => c.id === claim.carrierId);
  const claimRef = claim.externalClaimNumber ? `claim #${claim.externalClaimNumber}` : "a claim";
  const policyLabel = policyRef(policy);
  const carrierLabel = carrier?.name ?? "Carrier";
  const message =
    action === "closed"
      ? `${carrierLabel} closed ${claimRef} for ${policyLabel}. It is now included in previous loss runs.`
      : action === "opened"
      ? `${carrierLabel} reported ${claimRef} for ${policyLabel}. The claim record was added to this client.`
      : action === "updated"
      ? `${carrierLabel} updated ${claimRef} for ${policyLabel}${detail ? `: ${detail}` : "."}`
      : `${carrierLabel} claim check completed for ${policyLabel}${detail ? `: ${detail}` : "."}`;

  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: claim.tenantId,
    source: "system",
    message,
    visibility: "internal",
    customerId: claim.customerId,
    assetId: policy?.assetId,
    policyId: claim.policyId,
    claimId: claim.id,
    createdAt: nowIso(),
    createdById: actorId ?? "system",
  });
  if (customer && action === "closed") {
    db.insert("notes", {
      id: uid("note"),
      tenantId: claim.tenantId,
      authorId: actorId ?? "system",
      customerId: customer.id,
      policyId: claim.policyId,
      body: `${carrierLabel} closed ${claimRef}. This closed claim is now part of the client's previous loss runs.`,
      visibility: "internal",
      createdAt: nowIso(),
    });
  }
}

function logPolicyMovedToPrevious(policy: Policy, actorId?: string) {
  const customer = db.list("customers").find((c) => c.id === policy.customerId);
  const carrier = db.list("carriers").find((c) => c.id === policy.carrierId);
  const carrierLabel = carrier?.name ?? "Carrier";
  const message = `${policyRef(policy)} with ${carrierLabel} was closed and moved to previous policies.`;
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: policy.tenantId,
    source: "system",
    message,
    visibility: "internal",
    customerId: policy.customerId,
    assetId: policy.assetId,
    policyId: policy.id,
    createdAt: nowIso(),
    createdById: actorId ?? "system",
  });
  if (customer) {
    db.insert("notes", {
      id: uid("note"),
      tenantId: policy.tenantId,
      authorId: actorId ?? "system",
      customerId: customer.id,
      policyId: policy.id,
      body: message,
      visibility: "internal",
      createdAt: nowIso(),
    });
  }
}

function ensureClaimInquiryTask(input: {
  tenantId: string;
  customerId: string;
  assetId?: string;
  body: string;
  commId: string;
  createdAt: string;
}): Task {
  const customer = db.list("customers").find((c) => c.id === input.customerId);
  const asset = input.assetId ? db.list("assets").find((a) => a.id === input.assetId) : undefined;
  return createActionTaskOnce({
    tenantId: input.tenantId,
    activityKey: `claim-inquiry:${input.commId}`,
    title: `Claim inquiry: ${customer?.name ?? "Client"}`,
    description: `${customer?.name ?? "A client"} submitted a claim inquiry${
      asset ? ` for ${asset.label}` : ""
    }. Review the message, contact the carrier if needed, and keep the client updated.`,
    customerId: input.customerId,
    assetId: input.assetId,
    messageId: input.commId,
    topic: "claim_filed",
    severity: "urgent",
    severityReason: "Customer submitted a claim-related request.",
    assignedToId: primaryOwnerForCustomer(customer),
    createdById: "ai",
    createdAt: input.createdAt,
    auditAction: "task.created_from_claim_inquiry",
    auditMetadata: { communicationId: input.commId },
  });
}

function ensureBillingIssueTask(policy: Policy, actorId?: string): Task | null {
  const customer = customerForPolicy(policy);
  const carrier = db.list("carriers").find((c) => c.id === policy.carrierId);
  const status = billingStatusFor(policy);
  const missing = billingHasMissingInfo(policy);
  const pastDueKey = `billing:${policy.id}:past_due`;
  const missingKey = `billing:${policy.id}:missing_info`;

  if (status !== "past_due") {
    resolveActionTasks(policy.tenantId, [pastDueKey], actorId, "task.resolved_by_billing_update");
  }
  if (!missing) {
    resolveActionTasks(policy.tenantId, [missingKey], actorId, "task.resolved_by_billing_update");
  }

  if (status === "past_due") {
    return createActionTaskOnce({
      tenantId: policy.tenantId,
      activityKey: pastDueKey,
      title: `Billing past due: ${policyRef(policy)}`,
      description: `${customer?.name ?? "Client"} has a past-due billing status on ${
        policyRef(policy)
      }${carrier ? ` with ${carrier.name}` : ""}. Verify carrier billing status and follow up with the client if needed.`,
      customerId: policy.customerId,
      policyId: policy.id,
      assetId: policy.assetId,
      topic: "payment_issue",
      severity: "urgent",
      severityReason: "Policy billing is past due.",
      assignedToId: primaryOwnerForCustomer(customer),
      createdById: actorId ?? "ai",
      auditAction: "task.created_from_billing_issue",
      auditMetadata: { policyId: policy.id, status },
    });
  }

  if (missing) {
    return createActionTaskOnce({
      tenantId: policy.tenantId,
      activityKey: missingKey,
      title: `Billing info missing: ${policyRef(policy)}`,
      description: `${policyRef(policy)} is missing billing tracking information. Record the payment method, plan, and next due date so accounting and client service stay accurate.`,
      customerId: policy.customerId,
      policyId: policy.id,
      assetId: policy.assetId,
      topic: "payment_issue",
      severity: "warning",
      severityReason: `Billing method is ${billingMethodLabel(policy.billingMethod)} and at least one billing tracking field is incomplete.`,
      assignedToId: primaryOwnerForCustomer(customer),
      createdById: actorId ?? "ai",
      auditAction: "task.created_from_billing_issue",
      auditMetadata: { policyId: policy.id, missingInfo: true },
    });
  }

  return null;
}

function ensureNonRenewalTask(renewal: Renewal, actorId?: string): Task | null {
  const key = `non-renewal:${renewal.id}`;
  if (renewal.status !== "not_renewed") {
    resolveActionTasks(renewal.tenantId, [key], actorId, "task.resolved_by_renewal_status");
    return null;
  }
  const policy = db.list("policies").find((p) => p.id === renewal.policyId);
  const customer = customerForPolicy(policy);
  const carrier = policy ? db.list("carriers").find((c) => c.id === policy.carrierId) : undefined;
  const effective = renewal.nonRenewalEffectiveDate ?? renewal.renewalDate;
  return createActionTaskOnce({
    tenantId: renewal.tenantId,
    activityKey: key,
    title: `Non-renewal: ${policyRef(policy)}`,
    description: `${carrier?.name ?? "Carrier"} issued a non-renewal for ${customer?.name ?? "the client"}${
      effective ? ` effective ${fmt.date(effective)}` : ""
    }. Reason: ${renewal.nonRenewalReason ?? "No reason recorded yet."} Review replacement options and contact the client.`,
    customerId: policy?.customerId,
    policyId: policy?.id,
    assetId: policy?.assetId,
    renewalId: renewal.id,
    topic: "renewal_approaching",
    severity: "urgent",
    severityReason: "Carrier non-renewal requires replacement-market action.",
    assignedToId: renewal.agentId ?? primaryOwnerForCustomer(customer),
    createdById: actorId ?? "ai",
    auditAction: "task.created_from_non_renewal",
    auditMetadata: { renewalId: renewal.id, policyId: renewal.policyId },
  });
}

const RUNNER_TERMINAL_STATUSES: CarrierRunnerJobStatus[] = ["completed", "cancelled"];

function sortInsuranceCategories(a: InsuranceCategory, b: InsuranceCategory): number {
  const lineRank = (category: InsuranceCategory) =>
    (category.lineOfBusiness ?? "personal") === "personal" ? 0 : 1;
  const byLine = lineRank(a) - lineRank(b);
  if (byLine !== 0) return byLine;
  return a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);
}

function activeCarrierIdsForTenant(tenantId: string): string[] {
  return db
    .list("carrierLinks")
    .filter((link) => link.tenantId === tenantId && link.active)
    .map((link) => link.carrierId);
}

function carrierRunnerEnabledForTenant(tenantId: string): boolean {
  const agency = db.list("agencies").find((a) => a.id === tenantId);
  if (!agency?.carrierRunnerEnabled) return false;
  return agency.carrierRunnerStatus !== "not_configured" && agency.carrierRunnerStatus !== "paused";
}

function policyAllowedForCarrierRunner(policy: Policy): boolean {
  if (policy.status === "closed") return false;
  if (!carrierRunnerEnabledForTenant(policy.tenantId)) return false;
  return activeCarrierIdsForTenant(policy.tenantId).includes(policy.carrierId);
}

function renewalForPolicy(policyId: string): Renewal | undefined {
  return db
    .list("renewals")
    .filter((renewal) => renewal.policyId === policyId)
    .sort((a, b) => (a.renewalDate < b.renewalDate ? 1 : -1))[0];
}

function carrierRunnerJobTitle(
  trigger: CarrierRunnerJobTrigger,
  policy?: Policy,
  renewal?: Renewal
): string {
  const ref = policyRef(policy);
  if (trigger === "policy_check") {
    return `Carrier policy retrieval: ${ref}`;
  }
  if (trigger === "renewal_window") {
    return `Carrier renewal check: ${ref}`;
  }
  if (trigger === "renewal_status_check") {
    return `Carrier non-renewal check: ${ref}`;
  }
  if (trigger === "billing_check") {
    return `Carrier billing check: ${ref}`;
  }
  if (trigger === "claim_check") {
    return `Carrier claim check: ${ref}`;
  }
  if (trigger === "document_sync") {
    return `Carrier document sync: ${ref}`;
  }
  if (trigger === "policy_placed") {
    return `Carrier policy pickup: ${ref}`;
  }
  return `${carrierRunnerTriggerLabel(trigger)}: ${ref}${renewal?.renewalDate ? ` (${fmt.date(renewal.renewalDate)})` : ""}`;
}

function logCarrierRunnerTimeline(
  job: CarrierRunnerJob,
  action: string,
  detail?: string,
  actorId = "ai"
) {
  const message = detail ? `${action}: ${detail}` : action;
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: job.tenantId,
    source: "system",
    message,
    visibility: "internal",
    customerId: job.customerId,
    assetId: job.assetId,
    policyId: job.policyId,
    createdAt: nowIso(),
    createdById: actorId,
  });
}

function createCarrierRunnerJobOnce(input: {
  tenantId: string;
  trigger: CarrierRunnerJobTrigger;
  reason: string;
  title?: string;
  scheduledFor?: string;
  createdById?: string;
  policy?: Policy;
  renewal?: Renewal;
  carrierId?: string;
  customerId?: string;
  assetId?: string;
}): CarrierRunnerJob | null {
  const policy = input.policy;
  if (policy && !policyAllowedForCarrierRunner(policy)) return null;
  const carrierId = input.carrierId ?? policy?.carrierId;
  if (!carrierId) return null;
  const customerId = input.customerId ?? policy?.customerId;
  const existing = db.list("carrierRunnerJobs").find((job) => {
    if (job.tenantId !== input.tenantId) return false;
    if (job.trigger !== input.trigger) return false;
    if (job.carrierId !== carrierId) return false;
    if ((job.customerId ?? "") !== (customerId ?? "")) return false;
    if (job.policyId !== policy?.id) return false;
    if ((job.renewalId ?? "") !== (input.renewal?.id ?? "")) return false;
    return !RUNNER_TERMINAL_STATUSES.includes(job.status);
  });
  if (existing) return existing;

  const row: CarrierRunnerJob = {
    id: uid("runner_job"),
    tenantId: input.tenantId,
    carrierId,
    customerId,
    assetId: input.assetId ?? policy?.assetId,
    policyId: policy?.id,
    renewalId: input.renewal?.id,
    trigger: input.trigger,
    status: "queued",
    title: input.title ?? carrierRunnerJobTitle(input.trigger, policy, input.renewal),
    reason: input.reason,
    scheduledFor: input.scheduledFor ?? nowIso(),
    createdAt: nowIso(),
    createdById: input.createdById ?? "ai",
    attempts: 0,
  };
  db.insert("carrierRunnerJobs", row);
  logCarrierRunnerTimeline(row, "Carrier portal check queued", input.reason, input.createdById ?? "system");
  return row;
}

function queueCarrierRunnerPolicyPlaced(policy: Policy, actorId?: string): CarrierRunnerJob | null {
  return createCarrierRunnerJobOnce({
    tenantId: policy.tenantId,
    trigger: "policy_placed",
    policy,
    createdById: actorId ?? policy.agentId ?? "ai",
    reason:
      "Policy was put in place. The carrier portal should be checked for bound policy data, available documents, billing path, and upcoming renewal date, then any changes should be staged for review.",
  });
}

function queueCarrierRunnerRenewalWindow(
  policy: Policy,
  renewal: Renewal | undefined,
  actorId?: string
): CarrierRunnerJob | null {
  return createCarrierRunnerJobOnce({
    tenantId: policy.tenantId,
    trigger: "renewal_window",
    policy,
    renewal,
    createdById: actorId ?? policy.agentId ?? "ai",
    reason: `Policy renewal is within ${CARRIER_RUNNER_RENEWAL_LOOKAHEAD_DAYS} days. The carrier portal should be checked for renewal terms, documents, billing changes, and non-renewal notices if present.`,
  });
}

function ensureCarrierRunnerRenewalJob(policy: Policy, now = nowIso()): CarrierRunnerJob | null {
  const renewal = renewalForPolicy(policy.id);
  if (!shouldQueueCarrierRunnerRenewalJob(policy, renewal, now)) return null;
  return queueCarrierRunnerRenewalWindow(policy, renewal);
}

function createCarrierRunnerExceptionTask(job: CarrierRunnerJob, reason: string): Task {
  const customer = job.customerId
    ? db.list("customers").find((c) => c.id === job.customerId)
    : undefined;
  const agency = db.list("agencies").find((a) => a.id === job.tenantId);
  return createActionTaskOnce({
    tenantId: job.tenantId,
    activityKey: `carrier-runner-exception:${job.id}`,
    title: `Carrier portal needs attention: ${job.title}`,
    description: reason,
    customerId: job.customerId,
    policyId: job.policyId,
    assetId: job.assetId,
    topic: "other",
    severity: "warning",
    severityReason: "Carrier portal update needs staff review before continuing.",
    assignedToId: agency?.carrierRunnerAuthorizedUserIds?.[0] ?? primaryOwnerForCustomer(customer),
    createdById: "ai",
    auditAction: "task.created_from_carrier_runner_exception",
    auditMetadata: { runnerJobId: job.id, trigger: job.trigger },
  });
}

function applyCarrierRunnerNonRenewal(job: CarrierRunnerJob, summary: string, byUserId?: string) {
  if (!job.policyId) return;
  const policy = db.list("policies").find((p) => p.id === job.policyId);
  if (!policy) return;
  db.update("policies", policy.id, { renewalStatus: "not_renewed" });
  const existingRenewal = job.renewalId
    ? db.list("renewals").find((r) => r.id === job.renewalId)
    : renewalForPolicy(policy.id);
  const renewal =
    existingRenewal ??
    db.insert("renewals", {
      id: uid("renewal"),
      tenantId: policy.tenantId,
      policyId: policy.id,
      renewalDate: policy.renewalDate ?? nowIso(),
      status: "not_renewed",
      agentId: policy.agentId,
      createdAt: nowIso(),
    });
  const updated = db.update("renewals", renewal.id, {
    status: "not_renewed",
    nonRenewalReason: summary || renewal.nonRenewalReason || "Carrier posted a non-renewal notice.",
    nonRenewalNoticeDate: nowIso(),
    nonRenewalEffectiveDate: renewal.nonRenewalEffectiveDate ?? policy.renewalDate,
    nonRenewalCarrierReference: job.sourceReference ?? renewal.nonRenewalCarrierReference,
  });
  if (updated) ensureNonRenewalTask(updated, byUserId ?? "ai");
}

function carrierDownloadSubject(download: CarrierDownload): string {
  if (download.documentPayload) {
    return download.documentPayload.documentName || download.documentPayload.fileName;
  }
  switch (download.kind) {
    case "policy_update":
      return carrierDownloadLooksLikeRenewal(download) ? "renewal information" : "policy information";
    case "edoc":
      return "document";
    case "billing_update":
      return "billing information";
    case "claim_update":
      return "claim information";
    case "commission_statement":
      return "commission statement";
  }
}

function carrierDownloadLooksLikeRenewal(download: CarrierDownload): boolean {
  const text = [
    download.summary,
    download.documentPayload?.documentName,
    download.documentPayload?.fileName,
    download.sourceReference,
  ]
    .filter(Boolean)
    .join(" ");
  return /renewal|renewed|renew/i.test(text);
}

function carrierDownloadReceivedMessage(download: CarrierDownload): string {
  const carrier = carrierName(download.carrierId);
  const policy = download.policyId
    ? policyRef(db.list("policies").find((p) => p.id === download.policyId))
    : "this account";
  const subject = carrierDownloadSubject(download);

  if (carrierDownloadLooksLikeRenewal(download)) {
    return `${carrier} posted updated renewal information for ${policy}: ${subject}. It is ready for review.`;
  }
  if (download.kind === "billing_update") {
    return `${carrier} posted updated billing information for ${policy}: ${subject}. It is ready for review.`;
  }
  if (download.kind === "edoc") {
    return `${carrier} posted a new document for ${policy}: ${subject}. It is ready for review.`;
  }
  if (download.kind === "claim_update") {
    return `${carrier} posted a claim update for ${policy}: ${subject}. It is ready for review.`;
  }
  return `${carrier} posted updated carrier information for ${policy}: ${subject}. It is ready for review.`;
}

function carrierDownloadFiledMessage(download: CarrierDownload): string {
  const carrier = carrierName(download.carrierId);
  const policy = download.policyId
    ? policyRef(db.list("policies").find((p) => p.id === download.policyId))
    : "this account";
  const subject = carrierDownloadSubject(download);

  if (carrierDownloadLooksLikeRenewal(download)) {
    return `${carrier} renewal update filed for ${policy}: ${subject}.`;
  }
  if (download.kind === "billing_update") {
    return `${carrier} billing update filed for ${policy}: ${subject}.`;
  }
  if (download.kind === "edoc") {
    return `${carrier} document filed for ${policy}: ${subject}.`;
  }
  if (download.kind === "claim_update") {
    return `${carrier} claim update filed for ${policy}: ${subject}.`;
  }
  return `${carrier} update filed for ${policy}: ${subject}.`;
}

function logCarrierDownloadActivity(
  download: CarrierDownload,
  message: string,
  actorId = "system",
  documentId?: string
) {
  const createdAt = nowIso();
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: download.tenantId,
    source: "system",
    message,
    visibility: "internal",
    customerId: download.customerId,
    assetId: download.assetId,
    policyId: download.policyId,
    documentId,
    createdAt,
    createdById: actorId,
  });
  if (download.customerId || download.policyId) {
    db.insert("notes", {
      id: uid("note"),
      tenantId: download.tenantId,
      authorId: actorId,
      customerId: download.customerId,
      policyId: download.policyId,
      body: message,
      visibility: "internal",
      createdAt,
    });
  }
}

function stageCarrierDownloadFromRunnerJob(
  job: CarrierRunnerJob,
  input: {
    kind: CarrierDownloadKind;
    summary: string;
    changes?: CarrierDownloadChange[];
    documentPayload?: CarrierDownloadDocumentPayload;
    confidence?: number;
    effectiveDate?: string;
    sourceReference?: string;
  }
): CarrierDownload {
  const row: CarrierDownload = {
    id: uid("download"),
    tenantId: job.tenantId,
    carrierId: job.carrierId ?? "carrier_unknown",
    kind: input.kind,
    status: (input.changes?.length ?? 0) > 0 || input.documentPayload ? "matched" : "unreviewed",
    source: "carrier_runner",
    sourceReference: input.sourceReference ?? job.sourceReference,
    receivedAt: nowIso(),
    effectiveDate: input.effectiveDate,
    customerId: job.customerId,
    assetId: job.assetId,
    policyId: job.policyId,
    confidence: input.confidence ?? 0.92,
    summary: input.summary,
    changes: input.changes ?? [],
    documentPayload: input.documentPayload,
  };
  db.insert("carrierDownloads", row);
  logCarrierDownloadActivity(row, carrierDownloadReceivedMessage(row), "system");
  return row;
}

function ensureDocumentReviewNotice(doc: Document, actorId?: string): AiNotification | null {
  const key = `document-review:${doc.id}`;
  if (doc.status !== "pending") {
    resolveActionTasks(doc.tenantId, [key], actorId, "task.resolved_by_document_status");
    db
      .list("aiNotifications")
      .filter(
        (n) =>
          n.tenantId === doc.tenantId &&
          n.kind === "inbound_notice" &&
          n.documentId === doc.id &&
          !n.acknowledgedAt
      )
      .forEach((n) =>
        db.update("aiNotifications", n.id, {
          acknowledgedAt: nowIso(),
          acknowledgedById: actorId,
        })
      );
    return null;
  }
  if (!doc.customerId) return null;
  const uploader = db.list("users").find((u) => u.id === doc.uploadedById);
  if (uploader?.role !== "customer") return null;
  const customer = db.list("customers").find((c) => c.id === doc.customerId);
  resolveActionTasks(doc.tenantId, [key], actorId, "task.resolved_by_document_notice");
  const existing = db
    .list("aiNotifications")
    .find(
      (n) =>
        n.tenantId === doc.tenantId &&
        n.kind === "inbound_notice" &&
        n.documentId === doc.id &&
        !n.acknowledgedAt
    );
  if (existing) return existing;
  const row: AiNotification = {
    id: uid("ain"),
    tenantId: doc.tenantId,
    kind: "inbound_notice",
    title: `Document uploaded: ${doc.fileName}`,
    summary: `${customer?.name ?? "A client"} uploaded ${doc.fileName}.`,
    customerId: doc.customerId,
    assetId: doc.assetId,
    policyId: doc.policyId,
    documentId: doc.id,
    topic: "document_upload",
    severity: "info",
    severityReason: "Document upload notification; no owned activity was opened.",
    assignedToId: primaryOwnerForCustomer(customer),
    createdAt: nowIso(),
  };
  db.insert("aiNotifications", row);
  return row;
}

function bumpRenewalTaskForDraft(draft: Document, actorId?: string) {
  if (!draft.renewalId) return;
  const renewal = db.list("renewals").find((r) => r.id === draft.renewalId);
  if (!renewal) return;
  const task = db.list("tasks").find((t) => t.renewalId === renewal.id && !t.completedAt);
  if (!task) return;
  db.update("tasks", task.id, {
    status: "open",
    severity: "warning",
    severityReason: "Renewal document draft is ready for staff review.",
    aiSummary: `${draft.fileName} is ready for review before publishing to the renewal term.`,
  });
  logTaskAudit({
    tenantId: task.tenantId,
    actorId: actorId ?? "ai",
    action: "task.updated_from_renewal_document_draft",
    taskId: task.id,
    metadata: { documentId: draft.id, renewalId: renewal.id },
  });
}

function ensureCarrierBindingIssueTask(input: {
  session: QuotingSession;
  policy: Policy;
  carrier: Carrier;
  status: string;
  reasons?: string[];
  actorId?: string;
}): Task | null {
  if (input.status === "bound_on_carrier") {
    resolveActionTasks(
      input.policy.tenantId,
      [`carrier-bind:${input.policy.id}`],
      input.actorId,
      "task.resolved_by_carrier_binding"
    );
    return null;
  }
  const customer = customerForPolicy(input.policy);
  return createActionTaskOnce({
    tenantId: input.policy.tenantId,
    activityKey: `carrier-bind:${input.policy.id}`,
    title: `Carrier bind needs review: ${policyRef(input.policy)}`,
    description: `${input.carrier.name} policy implementation did not confirm as bound on the carrier side. ${
      input.reasons?.length ? input.reasons.join("; ") : "Review the carrier portal and complete any remaining binding step."
    }`,
    customerId: input.policy.customerId,
    policyId: input.policy.id,
    assetId: input.policy.assetId,
    topic: "policy_edit_request",
    severity: input.status === "failed" ? "urgent" : "warning",
    severityReason: "Carrier-side binding requires staff verification.",
    assignedToId: primaryOwnerForCustomer(customer) ?? input.session.createdById,
    createdById: input.actorId ?? "ai",
    auditAction: "task.created_from_carrier_binding",
    auditMetadata: { sessionId: input.session.id, carrierId: input.carrier.id, status: input.status },
  });
}

function customerRelatedProspects(customer: CustomerProfile): Prospect[] {
  const customerEmail = normalizeEmail(customer.email);
  return db
    .list("prospects")
    .filter(
      (p) =>
        p.tenantId === customer.tenantId &&
        (p.customerId === customer.id ||
          (!!customerEmail &&
            normalizeEmail(p.email) === customerEmail &&
            p.name.trim().toLowerCase() === customer.name.trim().toLowerCase()))
    );
}

function makeHistoryEvent(
  id: string,
  input: Omit<StatusEvent, "id">
): StatusEvent {
  return { id, ...input };
}

function contactOwnerSummary(row: CustomerProfile | Prospect): string {
  const parts: string[] = [];
  if (row.assignedAgentId) {
    parts.push(`agent ${actorName(row.assignedAgentId)}`);
  }
  for (const id of row.additionalAgentIds ?? []) {
    if (id !== row.assignedAgentId) parts.push(`co-owner ${actorName(id)}`);
  }
  if (row.assignedCsrId) parts.push(`CSR ${actorName(row.assignedCsrId)}`);
  for (const id of row.additionalCsrIds ?? []) {
    if (id !== row.assignedCsrId) parts.push(`CSR ${actorName(id)}`);
  }
  return parts.join(", ");
}

function logContactRoutingEvent(input: {
  tenantId: string;
  kind: "client" | "prospect";
  contactId: string;
  contactName: string;
  before: CustomerProfile | Prospect;
  after: CustomerProfile | Prospect;
  byUserId?: string;
}) {
  const beforeKey = contactOwnerIds(input.before).join("|");
  const afterKey = contactOwnerIds(input.after).join("|");
  if (beforeKey === afterKey) return;
  const ownerSummary = contactOwnerSummary(input.after);
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: input.tenantId,
    source: "agent",
    message: `${actorName(input.byUserId)} ${
      beforeKey ? "rerouted" : "assigned"
    } ${input.contactName} to ${ownerSummary || "no staff owner"}.`,
    visibility: "internal",
    customerId: input.kind === "client" ? input.contactId : undefined,
    prospectId: input.kind === "prospect" ? input.contactId : undefined,
    createdAt: nowIso(),
    createdById: input.byUserId,
  });
}

function quoteStatusLabel(status: PolicyStatus): string {
  return fmt.titleCase(String(status).replace(/_/g, " "));
}

function quoteSessionContactMatches(
  session: QuotingSession,
  customerId: string,
  prospectIds: Set<string>
): boolean {
  return (
    session.customerId === customerId ||
    (!!session.prospectId && prospectIds.has(session.prospectId))
  );
}

function comprehensiveClientHistory(customerId: string): StatusEvent[] {
  const customer = db.list("customers").find((c) => c.id === customerId);
  if (!customer) return [];
  const prospects = customerRelatedProspects(customer);
  const prospectIds = new Set(prospects.map((p) => p.id));
  const policies = db.list("policies").filter((p) => p.customerId === customer.id);
  const policyIds = new Set(policies.map((p) => p.id));
  const assetIds = new Set(
    db.list("assets").filter((a) => a.customerId === customer.id).map((a) => a.id)
  );

  const events: StatusEvent[] = [];
  const push = (event: StatusEvent | undefined | null) => {
    if (event) events.push(event);
  };

  db.list("statusEvents").forEach((event) => {
    if (
      event.customerId === customer.id ||
      (!!event.prospectId && prospectIds.has(event.prospectId)) ||
      (!!event.policyId && policyIds.has(event.policyId)) ||
      (!!event.assetId && assetIds.has(event.assetId))
    ) {
      events.push(event);
    }
  });
  const hasLoggedEvent = (fragment: string, session?: QuotingSession): boolean => {
    const needle = fragment.toLowerCase();
    return events.some(
      (event) =>
        event.message.toLowerCase().includes(needle) &&
        (event.customerId === customer.id ||
          (!!event.prospectId && prospectIds.has(event.prospectId)) ||
          (!!session?.assetId && event.assetId === session.assetId))
    );
  };

  if (prospects.length === 0) {
    push(
      makeHistoryEvent(`history:client-created:${customer.id}`, {
        tenantId: customer.tenantId,
        source: "system",
        message: `Client profile created for ${customer.name}.`,
        visibility: "internal",
        customerId: customer.id,
        createdAt: customer.createdAt,
      })
    );
  }

  prospects.forEach((prospect) => {
    push(
      makeHistoryEvent(`history:prospect-created:${prospect.id}`, {
        tenantId: prospect.tenantId,
        source: "system",
        message: `Prospect profile created for ${prospect.name}. Status: ${fmt.titleCase(
          prospect.status.replace(/_/g, " ")
        )}.`,
        visibility: "internal",
        customerId: customer.id,
        prospectId: prospect.id,
        createdAt: prospect.createdAt,
      })
    );
    const ownerSummary = contactOwnerSummary(prospect);
    if (ownerSummary) {
      push(
        makeHistoryEvent(`history:prospect-routing:${prospect.id}`, {
          tenantId: prospect.tenantId,
          source: "agent",
          message: `Prospect routing on file: ${ownerSummary}.`,
          visibility: "internal",
          customerId: customer.id,
          prospectId: prospect.id,
          createdAt: prospect.createdAt,
          createdById: prospect.assignedAgentId,
        })
      );
    }
  });

  const customerOwnerSummary = contactOwnerSummary(customer);
  if (customerOwnerSummary) {
    push(
      makeHistoryEvent(`history:client-routing:${customer.id}`, {
        tenantId: customer.tenantId,
        source: "agent",
        message: `Current client routing on file: ${customerOwnerSummary}.`,
        visibility: "internal",
        customerId: customer.id,
        createdAt: customer.createdAt,
        createdById: customer.assignedAgentId,
      })
    );
  }

  db.list("quoteRequests")
    .filter((q) => q.customerId === customer.id)
    .forEach((quote) => {
      const carrier = quote.aiRecommendedCarrierId
        ? carrierName(quote.aiRecommendedCarrierId)
        : undefined;
      const premium =
        quote.aiPremiumEstimateMin && quote.aiPremiumEstimateMax
          ? ` Estimated premium ${fmt.money(quote.aiPremiumEstimateMin)}-${fmt.money(
              quote.aiPremiumEstimateMax
            )}.`
          : "";
      const missing = quote.missingDocuments.length
        ? ` Missing documents: ${quote.missingDocuments.join(", ")}.`
        : "";
      push(
        makeHistoryEvent(`history:quote-request:${quote.id}`, {
          tenantId: quote.tenantId,
          source: "ai",
          message: `Quote request opened for ${api.helpers.assetTypeLabel(
            quote.assetType
          )}. Status: ${quoteStatusLabel(quote.status)}.${
            carrier ? ` AI recommended ${carrier}.` : ""
          }${premium}${missing}`,
          visibility: "internal",
          customerId: customer.id,
          createdAt: quote.createdAt,
          createdById: quote.assignedAgentId ?? "ai",
        })
      );
    });

  db.list("quotingSessions")
    .filter((session) => quoteSessionContactMatches(session, customer.id, prospectIds))
    .forEach((session) => {
      const assetLabel = api.helpers.assetTypeLabel(session.assetType);
      if (!hasLoggedEvent("AI quoting workflow started", session)) {
        push(
          makeHistoryEvent(`history:quote-session-start:${session.id}`, {
            tenantId: session.tenantId,
            source: "ai",
            message: `AI quoting workflow started for ${session.lineOfBusiness ?? "personal"} ${assetLabel}.`,
            visibility: "internal",
            customerId: customer.id,
            prospectId: session.prospectId,
            assetId: session.assetId,
            createdAt: session.createdAt,
            createdById: session.createdById,
          })
        );
      }
      if (session.questionnaireSentAt) {
        if (!hasLoggedEvent("questionnaire sent", session)) {
          push(
            makeHistoryEvent(`history:quote-questionnaire:${session.id}`, {
              tenantId: session.tenantId,
              source: "agent",
              message: `Quoting questionnaire sent to client with ${
                session.questionnaireQuestions?.length ?? 0
              } question${(session.questionnaireQuestions?.length ?? 0) === 1 ? "" : "s"}.`,
              visibility: "internal",
              customerId: customer.id,
              prospectId: session.prospectId,
              communicationId: session.questionnaireMessageId,
              createdAt: session.questionnaireSentAt,
              createdById: session.createdById,
            })
          );
        }
      }
      if (session.replyReceivedAt) {
        if (!hasLoggedEvent("submitted quoting questionnaire", session)) {
          push(
            makeHistoryEvent(`history:quote-reply:${session.id}`, {
              tenantId: session.tenantId,
              source: "customer",
              message: `Client submitted quoting questionnaire responses; AI moved the workflow into carrier ranking.`,
              visibility: "internal",
              customerId: customer.id,
              prospectId: session.prospectId,
              createdAt: session.replyReceivedAt,
            })
          );
        }
      }
      (session.commercialCarrierSubmissions ?? []).forEach((submission) => {
        const linkedMessageId = commercialSubmissionMessageId(submission);
        const awaitingDelivery = submission.status === "application_sent" && !submission.sentAt;
        push(
          makeHistoryEvent(`history:commercial-submission:${session.id}:${submission.carrierId}`, {
            tenantId: session.tenantId,
            source: "ai",
            message: `Commercial application ${awaitingDelivery ? "prepared for" : "sent to"} ${carrierName(
              submission.carrierId
            )}. Current carrier response: ${fmt.titleCase(
              submission.status.replace(/_/g, " ")
            )}.${submission.missingFields?.length ? ` Missing fields: ${submission.missingFields.join(", ")}.` : ""}`,
            visibility: "internal",
            customerId: customer.id,
            prospectId: session.prospectId,
            assetId: session.assetId,
            communicationId: linkedMessageId,
            documentId: commercialSubmissionDocumentId(submission),
            createdAt: submission.responseAt ?? submission.sentAt ?? session.updatedAt ?? session.createdAt,
            createdById: linkedMessageId ? session.createdById : "ai",
          })
        );
      });
      if (session.quotes.length > 0) {
        const top = session.quotes[0];
        if (!hasLoggedEvent("AI carrier ranking", session) && !hasLoggedEvent("AI ranked", session)) {
          push(
            makeHistoryEvent(`history:quote-ranking:${session.id}`, {
              tenantId: session.tenantId,
              source: "ai",
              message: `AI carrier ranking generated ${session.quotes.length} option${
                session.quotes.length === 1 ? "" : "s"
              }. Top option: ${carrierName(top.carrierId)} at ${fmt.money(top.premium)} annual premium.`,
              visibility: "internal",
              customerId: customer.id,
              prospectId: session.prospectId,
              assetId: session.assetId,
              createdAt: session.updatedAt,
              createdById: "ai",
            })
          );
        }
      }
    });

  db.list("tasks")
    .filter(
      (task) =>
        task.customerId === customer.id ||
        (!!task.prospectId && prospectIds.has(task.prospectId)) ||
        (!!task.policyId && policyIds.has(task.policyId)) ||
        (!!task.assetId && assetIds.has(task.assetId))
    )
    .forEach((task) => {
      push(
        makeHistoryEvent(`history:task-created:${task.id}`, {
          tenantId: task.tenantId,
          source: task.createdById === "ai" ? "ai" : "agent",
          message: `Activity created: ${task.title}${task.description ? ` - ${task.description}` : ""}`,
          visibility: "internal",
          customerId: customer.id,
          prospectId: task.prospectId,
          assetId: task.assetId,
          policyId: task.policyId,
          claimId: task.claimId,
          documentId: task.documentId,
          quoteSessionId: task.quoteSessionId,
          quoteRequestId: task.quoteRequestId,
          communicationId: task.messageId,
          renewalId: task.renewalId,
          createdAt: task.createdAt,
          createdById: task.createdById,
        })
      );
      if (task.startedAt) {
        push(
          makeHistoryEvent(`history:task-started:${task.id}`, {
            tenantId: task.tenantId,
            source: "agent",
            message: `Activity started: ${task.title}.`,
            visibility: "internal",
            customerId: customer.id,
            prospectId: task.prospectId,
            assetId: task.assetId,
            policyId: task.policyId,
            claimId: task.claimId,
            documentId: task.documentId,
            quoteSessionId: task.quoteSessionId,
            quoteRequestId: task.quoteRequestId,
            createdAt: task.startedAt,
            createdById: task.startedById,
          })
        );
      }
      if (task.completedAt) {
        push(
          makeHistoryEvent(`history:task-completed:${task.id}`, {
            tenantId: task.tenantId,
            source: "agent",
            message: `Activity resolved: ${task.title}.${
              task.resolutionNote ? " Resolution note attached." : ""
            }`,
            visibility: "internal",
            customerId: customer.id,
            prospectId: task.prospectId,
            assetId: task.assetId,
            policyId: task.policyId,
            claimId: task.claimId,
            documentId: task.documentId,
            quoteSessionId: task.quoteSessionId,
            quoteRequestId: task.quoteRequestId,
            createdAt: task.completedAt,
            createdById: task.completedById,
          })
        );
      }
    });

  db.list("communications")
    .filter(
      (comm) =>
        comm.customerId === customer.id ||
        (!!comm.prospectId && prospectIds.has(comm.prospectId))
    )
    .forEach((comm) => {
      const alreadyLogged = events.some((event) => event.communicationId === comm.id);
      if (alreadyLogged) return;
      const channel = comm.channel === "email" ? "Email" : fmt.titleCase(String(comm.channel));
      push(
        makeHistoryEvent(`history:communication:${comm.id}`, {
          tenantId: comm.tenantId,
          source: comm.direction === "inbound" ? "customer" : "agent",
          message: `${channel} ${comm.direction === "inbound" ? "received" : "sent"}${
            comm.subject ? `: ${comm.subject}` : ""
          }.`,
          visibility: comm.channel === "note" ? "internal" : "customer_visible",
          customerId: customer.id,
          prospectId: comm.prospectId,
          communicationId: comm.id,
          createdAt: comm.createdAt,
          createdById: comm.createdById,
        })
      );
    });

  db.list("notes")
    .filter(
      (note) =>
        note.customerId === customer.id ||
        (!!note.prospectId && prospectIds.has(note.prospectId)) ||
        (!!note.policyId && policyIds.has(note.policyId))
    )
    .forEach((note) => {
      const duplicate = events.some(
        (event) =>
          event.createdAt === note.createdAt &&
          event.message.includes(note.body.slice(0, 80))
      );
      if (duplicate) return;
      push(
        makeHistoryEvent(`history:note:${note.id}`, {
          tenantId: note.tenantId,
          source: note.authorId === "ai" ? "ai" : "agent",
          message: `Remark by ${actorName(note.authorId)}: ${note.body}`,
          visibility: note.visibility,
          customerId: customer.id,
          prospectId: note.prospectId,
          policyId: note.policyId,
          attachments: note.attachments,
          createdAt: note.createdAt,
          createdById: note.authorId,
        })
      );
    });

  const seen = new Map<string, StatusEvent>();
  for (const event of events) {
    const linkedCommunication = event.communicationId
      ? db
          .list("communications")
          .find((communication) => communication.id === event.communicationId)
      : undefined;
    const inboundIdentity =
      event.inboundEmailIdentity ??
      (linkedCommunication?.direction === "inbound" &&
      linkedCommunication.channel === "email"
        ? inboundEmailIdentity(linkedCommunication)
        : undefined);
    const isInboundEmailRemark =
      !!inboundIdentity &&
      /^(?:email received|inbound email remark)\b/i.test(event.message);
    const key = isInboundEmailRemark
      ? `inbound-email-remark|${event.tenantId}|${inboundIdentity}`
      : [
          event.id,
          event.message,
          event.createdAt,
          event.customerId ?? "",
          event.prospectId ?? "",
          event.communicationId ?? "",
        ].join("|");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, event);
      continue;
    }
    if (isInboundEmailRemark) {
      const score = (candidate: StatusEvent) =>
        (candidate.inboundEmailIdentity ? 4 : 0) +
        (candidate.taskId ? 2 : 0) +
        (candidate.message.startsWith("Inbound email remark:") ? 1 : 0);
      if (score(event) > score(existing)) seen.set(key, event);
    }
  }
  return [...seen.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// Routing-driven Task spawned when a prospect gets routed to a
// new agent. Mirrors the customer helper below so multi-agent
// prospect assignment can fan out the same way.
function spawnProspectRoutingTask(
  prospect: import("@/types").Prospect,
  toAgentId: string,
  byUserId?: string
) {
  const taskId = uid("task");
  const taskRow: Task = {
    id: taskId,
    tenantId: prospect.tenantId,
    title: `New prospect assigned: ${prospect.name}`,
    description: `${prospect.name} was routed to your queue. Make first contact, qualify the lead, and update the prospect status.`,
    prospectId: prospect.id,
    source: "ai_notification",
    activityKey: `routing_assignment:prospect:${prospect.id}:${toAgentId}`,
    severity: "warning",
    status: "open",
    topic: "other",
    aiSummary: prospect.aiSummary,
    assignedToId: toAgentId,
    createdById: byUserId,
    createdAt: nowIso(),
  };
  db.insert("tasks", taskRow);
  logTaskAudit({
    tenantId: prospect.tenantId,
    actorId: byUserId,
    action: "task.created_from_routing",
    taskId,
    metadata: { prospectId: prospect.id, toAgentId },
  });
}

// Shared helper for routing-driven Task creation. Spawned when a
// client (or prospect) gets routed to a new agent so it shows up
// on their Activity Center queue immediately.
function spawnRoutingTask(
  customer: import("@/types").CustomerProfile,
  toAgentId: string,
  byUserId?: string
) {
  const taskId = uid("task");
  const taskRow: Task = {
    id: taskId,
    tenantId: customer.tenantId,
    title: `New client assigned: ${customer.name}`,
    description: `${customer.name} was routed to your queue. Review their book, set up an intro call, and confirm their contact preferences.`,
    customerId: customer.id,
    source: "ai_notification",
    activityKey: `routing_assignment:client:${customer.id}:${toAgentId}`,
    severity: "warning",
    status: "open",
    topic: "other",
    assignedToId: toAgentId,
    createdById: byUserId,
    createdAt: nowIso(),
  };
  db.insert("tasks", taskRow);
  logTaskAudit({
    tenantId: customer.tenantId,
    actorId: byUserId,
    action: "task.created_from_routing",
    taskId,
    metadata: { customerId: customer.id, toAgentId },
  });
}

// =====================================================================
// Per-style copy fragments. These ride on top of the AI body so
// changing messageStyle from the Marketing configuration page
// noticeably changes the voice without re-rendering the whole
// outreach template.
// =====================================================================

function attachmentManifestLine(
  attachments: MarketingAttachment[],
  channel: "email"
): string {
  const applicable = attachments.filter((a) => a.channels.includes(channel));
  if (applicable.length === 0) return "";
  return `Attached: ${applicable.map((a) => a.description ?? a.fileName).join(", ")}.`;
}

function defaultAutoMessageRules(enabled = true): MarketingAutoMessageRule[] {
  return [
    {
      id: uid("mar"),
      name: "New prospect intake outreach",
      enabled,
      trigger: "new_prospect",
      messageType: "quote_intake",
      channels: ["email"],
      audience: "new_prospects",
      timing: "immediate",
      delayAmount: 0,
      delayUnit: "minutes",
      senderMode: "assigned_agent",
      approvalMode: "auto_send",
      quietHoursStart: "20:00",
      quietHoursEnd: "08:00",
      maxPerContactPer30Days: 3,
      stopOnReply: true,
      includeAttachments: true,
      prompt:
        "Concierge quote-intake outreach. Acknowledge the request, make the next step obvious, and invite a callback without sounding generic.",
      updatedAt: nowIso(),
    },
  ];
}

function normalizeMarketingConfig(config: MarketingConfig & { agencyLogo?: unknown }): MarketingConfig {
  const { agencyLogo: _legacyAgencyLogo, ...rest } = config;
  const rules = Array.isArray(rest.autoMessageRules)
    ? rest.autoMessageRules
    : defaultAutoMessageRules(rest.autoSendOnNewProspect);
  return {
    ...rest,
    attachments: (rest.attachments ?? []).map((attachment) => ({
      ...attachment,
      channels: ["email"],
    })),
    autoMessageRules: rules.map((rule) => ({
      ...rule,
      channels: ["email"],
    })),
  };
}

function autoMessageSchedule(rule: MarketingAutoMessageRule): string | undefined {
  if (rule.timing === "immediate") return undefined;
  const date = new Date();
  if (rule.timing === "scheduled_time" && rule.sendTime) {
    const [hour, minute] = rule.sendTime.split(":").map((part) => Number(part));
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      date.setHours(hour, minute, 0, 0);
      if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
      return date.toISOString();
    }
  }
  const amount = Math.max(0, rule.delayAmount ?? 0);
  const unit = rule.delayUnit ?? "days";
  const ms =
    unit === "minutes"
      ? amount * 60_000
      : unit === "hours"
      ? amount * 3_600_000
      : amount * 86_400_000;
  if (ms <= 0) return undefined;
  return new Date(Date.now() + ms).toISOString();
}

function autoMessageVerb(status: MarketingMessage["deliveryStatus"]): string {
  if (status === "draft") return "drafted";
  if (status === "queued") return "queued";
  return "auto-sent";
}

function topicLabel(t: import("@/types").TaskTopic): string {
  const map: Record<string, string> = {
    policy_edit_request: "a policy edit request",
    coverage_change: "a coverage change",
    cancellation_request: "a cancellation request",
    claim_status: "a claim remark",
    claim_filed: "a claim filing",
    renewal_approaching: "an upcoming policy renewal",
    payment_issue: "a payment issue",
    document_upload: "a document upload",
    endorsement_request: "an endorsement request",
    coverage_gap: "a coverage gap",
    other: "their policy",
  };
  return map[t] ?? "their policy";
}

const INBOUND_SERVICE_DOCUMENT_TYPES: Record<InboundDocumentServiceIntent, string[]> = {
  certificate_of_insurance: ["proof_of_insurance"],
  insurance_id_card: ["insurance_id_card"],
  declarations_page: ["declarations_page"],
  policy_copy: ["policy_document", "policy_booklet"],
};

const INBOUND_SERVICE_FILE_PATTERNS: Record<InboundDocumentServiceIntent, RegExp> = {
  certificate_of_insurance: /\b(certificate of insurance|proof of insurance|coi)\b/i,
  insurance_id_card: /\b(insurance id card|auto id card|vehicle id card|insurance card)\b/i,
  declarations_page: /\b(declarations? page|dec page)\b/i,
  policy_copy: /\b(policy document|policy booklet|full policy|policy copy)\b/i,
};

function inboundServiceLabel(intent: InboundServiceIntent): string {
  const labels: Record<InboundServiceIntent, string> = {
    certificate_of_insurance: "certificate of insurance",
    insurance_id_card: "insurance ID card",
    declarations_page: "declarations page",
    policy_copy: "policy copy",
    vehicle_quote_intake: "vehicle quote details",
  };
  return labels[intent];
}

function findApprovedInboundServiceDocument(input: {
  tenantId: string;
  customerId: string;
  intent: InboundDocumentServiceIntent;
}): Document | undefined {
  const policies = db
    .list("policies")
    .filter((policy) => policy.tenantId === input.tenantId && policy.customerId === input.customerId);
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const activeStatuses = new Set<PolicyStatus>([
    "approved",
    "bound",
    "deposit_paid",
    "renewal_upcoming",
    "renewed",
    "carrier_reviewing",
  ]);
  const candidates = db
    .list("documents")
    .filter((document) => {
      if (document.tenantId !== input.tenantId || document.status !== "approved") return false;
      return (
        document.customerId === input.customerId ||
        (!!document.policyId && policyById.has(document.policyId))
      );
    });
  const exactTypes = new Set(INBOUND_SERVICE_DOCUMENT_TYPES[input.intent]);
  const exactMatches = candidates.filter((document) => exactTypes.has(String(document.type)));
  const namedMatches = candidates.filter((document) =>
    INBOUND_SERVICE_FILE_PATTERNS[input.intent].test(
      `${document.documentName ?? ""} ${document.fileName ?? ""}`
    )
  );
  const pool = exactMatches.length > 0 ? exactMatches : namedMatches;
  return [...pool].sort((a, b) => {
    const aActive = a.policyId && activeStatuses.has(policyById.get(a.policyId)?.status as PolicyStatus) ? 1 : 0;
    const bActive = b.policyId && activeStatuses.has(policyById.get(b.policyId)?.status as PolicyStatus) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aDirect = a.customerId === input.customerId ? 1 : 0;
    const bDirect = b.customerId === input.customerId ? 1 : 0;
    if (aDirect !== bDirect) return bDirect - aDirect;
    return (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? "");
  })[0];
}

function inboundServiceDraftBody(intent: InboundDocumentServiceIntent, customerName: string): string {
  const firstName = customerName.trim().split(/\s+/)[0] || "there";
  const messages: Record<InboundDocumentServiceIntent, string> = {
    certificate_of_insurance:
      `Hi ${firstName},\n\nI've attached the certificate of insurance you requested. Please review it and let me know if you need a certificate holder added or any other changes.\n\nThank you,`,
    insurance_id_card:
      `Hi ${firstName},\n\nI've attached the insurance ID card you requested. Please review it and let me know if you need anything else.\n\nThank you,`,
    declarations_page:
      `Hi ${firstName},\n\nI've attached the declarations page you requested. Please review it and let me know if you have any questions.\n\nThank you,`,
    policy_copy:
      `Hi ${firstName},\n\nI've attached the policy copy you requested. Please review it and let me know if you need anything else.\n\nThank you,`,
  };
  return messages[intent];
}

function createInboundServiceDraft(input: {
  inbound: Communication;
  customer: CustomerProfile;
  assignedToId: string;
  intent: InboundDocumentServiceIntent;
  document: Document;
}): Communication {
  const existing = db
    .list("communications")
    .find((row) => row.aiDraftSourceCommunicationId === input.inbound.id);
  if (existing) return existing;
  const senderMailbox = mailboxForUser(input.assignedToId);
  const rawSubject = input.inbound.subject?.trim() || inboundServiceLabel(input.intent);
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  const references = [
    ...(input.inbound.references ?? []),
    input.inbound.messageIdHeader,
    input.inbound.externalMessageId,
  ].filter((value): value is string => Boolean(value));
  const attachment: CommunicationAttachment = {
    id: uid("att"),
    documentId: input.document.id,
    sourceDocumentId: input.document.id,
    fileName: input.document.fileName,
    fileType: input.document.fileType || "application/pdf",
    dataUrl: input.document.downloadUrl,
    storagePath: input.document.storagePath,
    description: input.document.documentName ?? inboundServiceLabel(input.intent),
  };
  const row: Communication = {
    id: uid("comm"),
    tenantId: input.inbound.tenantId,
    customerId: input.customer.id,
    channel: "email",
    direction: "outbound",
    subject,
    threadId: input.inbound.threadId ?? `thread_msg_${input.inbound.id}`,
    replyToId: input.inbound.id,
    mailboxOrigin: "app",
    mailboxAccount: senderMailbox.account,
    mailboxProvider: senderMailbox.provider,
    mailboxConnectionId: senderMailbox.connectionId,
    deliveryStatus: "draft",
    externalThreadId: input.inbound.externalThreadId,
    inReplyToHeader: input.inbound.messageIdHeader ?? input.inbound.externalMessageId,
    references,
    to: input.customer.email ? [input.customer.email] : undefined,
    body: inboundServiceDraftBody(input.intent, input.customer.name),
    attachments: [attachment],
    aiDraftSourceCommunicationId: input.inbound.id,
    aiServiceIntent: input.intent,
    createdAt: nowIso(),
    createdById: input.assignedToId,
  };
  db.insert("communications", row);
  return row;
}

function inboundQuoteIntakeDraftBody(
  contactName: string,
  questions: InboundQuoteIntakeQuestion[]
): string {
  const firstName = contactName.trim().split(/\s+/)[0] || "there";
  const requestedDetails = questions.map((question) =>
    question === "vin"
      ? "- The vehicle's 17-character VIN"
      : "- Whether the vehicle should be quoted on a personal or commercial policy"
  );
  return `Hi ${firstName},\n\nI can get the vehicle quote started. Please send me:\n\n${requestedDetails.join(
    "\n"
  )}\n\nOnce I have ${questions.length === 1 ? "that detail" : "those details"}, I can begin the quote.\n\nThank you,`;
}

function createInboundQuoteIntakeDraft(input: {
  inbound: Communication;
  contact: CustomerProfile | Prospect;
  assignedToId: string;
  questions: InboundQuoteIntakeQuestion[];
}): Communication {
  const existing = db
    .list("communications")
    .find((row) => row.aiDraftSourceCommunicationId === input.inbound.id);
  if (existing) return existing;
  const senderMailbox = mailboxForUser(input.assignedToId);
  const rawSubject = input.inbound.subject?.trim() || "Vehicle quote request";
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  const references = [
    ...(input.inbound.references ?? []),
    input.inbound.messageIdHeader,
    input.inbound.externalMessageId,
  ].filter((value): value is string => Boolean(value));
  const row: Communication = {
    id: uid("comm"),
    tenantId: input.inbound.tenantId,
    customerId: input.inbound.customerId,
    prospectId: input.inbound.prospectId,
    channel: "email",
    direction: "outbound",
    subject,
    threadId: input.inbound.threadId ?? `thread_msg_${input.inbound.id}`,
    replyToId: input.inbound.id,
    mailboxOrigin: "app",
    mailboxAccount: senderMailbox.account,
    mailboxProvider: senderMailbox.provider,
    mailboxConnectionId: senderMailbox.connectionId,
    deliveryStatus: "draft",
    externalThreadId: input.inbound.externalThreadId,
    inReplyToHeader: input.inbound.messageIdHeader ?? input.inbound.externalMessageId,
    references,
    to: input.contact.email ? [input.contact.email] : undefined,
    body: inboundQuoteIntakeDraftBody(input.contact.name, input.questions),
    aiDraftSourceCommunicationId: input.inbound.id,
    aiServiceIntent: "vehicle_quote_intake",
    aiDraftMissingFields: input.questions,
    createdAt: nowIso(),
    createdById: input.assignedToId,
  };
  db.insert("communications", row);
  return row;
}

function ensureInboundDraftFollowUpTask(input: {
  inbound: Communication;
  assignedToId?: string;
  title: string;
  description: string;
  topic: NonNullable<Task["topic"]>;
  severityReason: string;
  draft: Communication;
  documentId?: string;
  actorId?: string;
}): Task {
  if (input.topic === "coverage_change") {
    const existingQuoteTask = existingQuoteIntakeTaskForInbound(input.inbound);
    if (existingQuoteTask) {
      const updated =
        db.update("tasks", existingQuoteTask.id, {
          assignedToId: existingQuoteTask.assignedToId ?? input.assignedToId,
          awaitingManagerAssignment:
            !(existingQuoteTask.assignedToId ?? input.assignedToId) || undefined,
          aiReplyBody: input.draft.body,
          aiReplySubject: input.draft.subject,
        }) ?? existingQuoteTask;
      linkInboundEmailCopiesToTask(input.inbound, updated.id);
      consolidateQuoteIntakeActivity(input.inbound, updated);
      return updated;
    }
  }
  return ensureInboundEmailTask({
    inbound: input.inbound,
    title: input.title,
    description: input.description,
    documentId: input.documentId,
    topic: input.topic,
    severity: "warning",
    severityReason: input.severityReason,
    assignedToId: input.assignedToId,
    awaitingManagerAssignment: !input.assignedToId || undefined,
    aiSummary: input.description,
    originalMessageContent: input.inbound.body,
    originalMessageId: input.inbound.id,
    aiReplyBody: input.draft.body,
    aiReplySubject: input.draft.subject,
    actorId: input.actorId ?? "ai",
    auditAction: "task.created_from_inbound_draft_follow_up",
    auditMetadata: {
      draftMessageId: input.draft.id,
      topic: input.topic,
    },
  });
}

function fieldSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function documentTemplateFieldsFor(
  doc: Pick<
    Document,
    | "tenantId"
    | "fileName"
    | "type"
    | "documentName"
    | "visibility"
    | "status"
    | "customerId"
    | "assetId"
    | "policyId"
    | "lineOfBusiness"
    | "policyTermYear"
  >,
  extras?: {
    originalFileName?: string;
    sourceFiles?: string[];
    renewalDate?: string;
  }
): TemplateFieldMap {
  const agency = db.list("agencies").find((a) => a.id === doc.tenantId);
  const customer = doc.customerId
    ? db.list("customers").find((c) => c.id === doc.customerId)
    : undefined;
  const asset = doc.assetId ? db.list("assets").find((a) => a.id === doc.assetId) : undefined;
  const policy = doc.policyId ? db.list("policies").find((p) => p.id === doc.policyId) : undefined;
  const carrier = policy?.carrierId
    ? db.list("carriers").find((c) => c.id === policy.carrierId)
    : undefined;

  return buildDocumentTemplateFields({
    fileName: doc.fileName,
    documentTypeLabel: documentTypeLabelForTemplate(String(doc.type), doc.documentName),
    documentName: doc.documentName,
    visibilityLabel: doc.visibility.replace(/_/g, " "),
    statusLabel: doc.status,
    agencyName: agency?.name,
    customerName: customer?.name,
    customerEmail: customer?.email,
    customerPhone: customer?.phone,
    assetLabel: asset?.label,
    assetValue: asset?.estimatedValue ? fmt.money(asset.estimatedValue) : undefined,
    policyNumber: policy?.policyNumber,
    carrierName: carrier?.name,
    premium: policy ? fmt.money(policy.finalPremium ?? policy.premiumEstimate ?? 0) : undefined,
    effectiveDate: policy?.effectiveDate ? fmt.date(policy.effectiveDate) : undefined,
    renewalDate: extras?.renewalDate
      ? fmt.date(extras.renewalDate)
      : policy?.renewalDate
      ? fmt.date(policy.renewalDate)
      : undefined,
    termYear: doc.policyTermYear,
    originalFileName: extras?.originalFileName,
    lineOfBusiness: doc.lineOfBusiness,
    sourceFiles: extras?.sourceFiles,
  });
}

function linkedActiveCarriers(tenantId: string): Carrier[] {
  const links = db
    .list("carrierLinks")
    .filter((l) => l.tenantId === tenantId && l.active);
  const linkedCarrierIds = new Set(links.map((l) => l.carrierId));
  return db
    .list("carriers")
    .filter((c) => linkedCarrierIds.has(c.id) && c.status === "active");
}

function carrierQuoteApiStatus(carrier: Carrier): CarrierQuote["apiStatus"] {
  return getCarrierQuoteProviderReadiness(carrier).quoteApiStatus;
}

function personalLineAppetiteFor(carrier: Carrier, assetType: AssetType): CarrierAppetite | undefined {
  return (carrier.appetites ?? []).find(
    (a) => a.assetType === assetType && (a.line ?? "personal") === "personal"
  );
}

function diagnosePersonalCarrierApiRow(
  carrier: Carrier,
  input: { assetType: AssetType; state?: string }
): PersonalLinesCarrierApiDiagnosticRow {
  const configuredStatus = carrier.quotingApi?.status ?? "not_configured";
  const endpoint = carrier.quotingApi?.endpoint?.trim();
  const providerReadiness = getCarrierQuoteProviderReadiness(carrier);
  const supportsAssetType = !!personalLineAppetiteFor(carrier, input.assetType);
  const writesState = !input.state || carrier.stateAvailability.includes(input.state);
  const quoteApiStatus = providerReadiness.quoteApiStatus;
  const blockingReasons: string[] = [];

  blockingReasons.push(...providerReadiness.blockingReasons);
  if (!supportsAssetType) blockingReasons.push(`no personal-lines appetite for ${input.assetType.replace(/_/g, " ")}`);
  if (!writesState && input.state) blockingReasons.push(`not licensed in ${input.state}`);

  return {
    carrierId: carrier.id,
    carrierName: carrier.name,
    provider: providerReadiness.providerLabel,
    endpoint: endpoint ?? providerReadiness.portalUrl,
    configuredStatus,
    quoteApiStatus,
    supportsAssetType,
    writesState,
    liveReady:
      providerReadiness.liveReady &&
      supportsAssetType &&
      writesState,
    blockingReasons,
  };
}

function addOnePolicyYear(iso: string): string {
  const date = new Date(iso);
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

function assetTypeDisplayName(type: AssetType): string {
  return sharedAssetTypeDisplayName(type);
}

const assetLabelBackfillTenantIds = new Set<string>();

function assetDetails(asset: Pick<Asset, "details">): Record<string, unknown> {
  return (asset.details ?? {}) as Record<string, unknown>;
}

function detailVin(details: Record<string, unknown>): string {
  return normalizeVin(details.vin ?? details.vehicleVin ?? details.assetIdentifier);
}

function assetNeedsVinDecode(asset: Asset): boolean {
  if (asset.type !== "luxury_vehicle") return false;
  const details = assetDetails(asset);
  const vin = detailVin(details);
  if (!vin || vinValidationIssue(vin)) return false;
  return !(details.year && details.make && details.model);
}

async function upgradeVehicleAssetLabelFromVin(assetId: string, expectedLabel?: string): Promise<Asset | undefined> {
  const asset = db.list("assets").find((row) => row.id === assetId);
  if (!asset || asset.type !== "luxury_vehicle") return asset;
  const details = assetDetails(asset);
  if (details.customLabel) return asset;
  if (expectedLabel && asset.label !== expectedLabel) return asset;
  const vin = detailVin(details);
  if (!vin || vinValidationIssue(vin)) return asset;

  const decoded = await decodeVinViaNhtsa(vin);
  const clean = (decoded?.errorCode ?? "") === "0" || (decoded?.errorCode ?? "") === "";
  if (!clean || !decoded?.year || !decoded.make || !decoded.model) return asset;

  const latest = db.list("assets").find((row) => row.id === assetId);
  if (!latest) return undefined;
  const latestDetails = assetDetails(latest);
  if (latestDetails.customLabel) return latest;
  if (expectedLabel && latest.label !== expectedLabel) return latest;

  const nextDetails = {
    ...latestDetails,
    year: decoded.year,
    make: decoded.make,
    model: decoded.model,
    previousLabel: latestDetails.previousLabel ?? latest.label,
    labelSource: "nhtsa_vin_decode",
  };
  const nextLabel = deriveAssetLabel(latest.type, nextDetails);
  if (nextLabel === latest.label) return latest;
  return db.update("assets", latest.id, {
    label: nextLabel,
    details: nextDetails,
  }) ?? undefined;
}

function queueVehicleLabelUpgrade(assetId: string, expectedLabel?: string): void {
  void upgradeVehicleAssetLabelFromVin(assetId, expectedLabel);
}

function textRecordValue(record: Record<string, unknown> | undefined, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const exact = record[key];
    if (exact !== null && exact !== undefined && String(exact).trim()) return String(exact).trim();
    const matchedKey = Object.keys(record).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase()
    );
    const matched = matchedKey ? record[matchedKey] : undefined;
    if (matched !== null && matched !== undefined && String(matched).trim()) {
      return String(matched).trim();
    }
  }
  return "";
}

function syncVehicleAssetIdentityFromSession(session: QuotingSession): void {
  if (session.assetType !== "luxury_vehicle" || !session.assetId) return;
  const asset = db.list("assets").find((row) => row.id === session.assetId);
  if (!asset || asset.type !== "luxury_vehicle") return;
  const publicFields = session.publicFields ?? {};
  const details = session.assetDetails ?? {};
  const yearMakeModel = textRecordValue(publicFields, ["Year / make / model", "yearMakeModel"]);
  const [yearFromYmm, makeFromYmm, ...modelFromYmm] = yearMakeModel.split(/\s+/).filter(Boolean);
  const nextDetails: Record<string, unknown> = {
    ...(asset.details ?? {}),
    ...details,
  };
  const year = textRecordValue(publicFields, ["year", "Model year", "ModelYear"]) || textRecordValue(details, ["year"]);
  const make = textRecordValue(publicFields, ["make", "Make"]) || textRecordValue(details, ["make"]);
  const model = textRecordValue(publicFields, ["model", "Model"]) || textRecordValue(details, ["model"]);
  const trim =
    textRecordValue(publicFields, ["trim", "VIN-decoded trim", "series"]) ||
    textRecordValue(details, ["trim", "series"]);
  if (year) nextDetails.year = year;
  else if (yearFromYmm) nextDetails.year = yearFromYmm;
  if (make) nextDetails.make = make;
  else if (makeFromYmm) nextDetails.make = makeFromYmm;
  if (model) nextDetails.model = model;
  else if (modelFromYmm.length > 0) nextDetails.model = modelFromYmm.join(" ");
  if (trim) nextDetails.trim = trim;
  const nextLabel = buildAssetLabelFromDetails({
    type: "luxury_vehicle",
    details: nextDetails,
    categoryLabel: "Vehicle",
    fallbackLabel: asset.label,
  });
  api.assets.update(asset.id, { label: nextLabel, details: nextDetails });
}

type CommercialAcordTemplateSelection = NonNullable<QuotingSession["commercialAcordTemplates"]>[number];

function selectedCommercialAcordTemplates(
  tenantId: string,
  selectedTemplateIds: string[],
  publicFields: Record<string, unknown>,
  publicFieldEvidence?: PublicDataEvidenceMap
): CommercialAcordTemplateSelection[] {
  const selected = new Set(selectedTemplateIds);
  if (selected.size === 0) return [];
  const documentReadyFieldCount = Object.values(publicFieldEvidence ?? {}).filter(
    (item) => item.allowDocumentAutofill
  ).length;
  return db
    .list("documents")
    .filter(
      (d) =>
        selected.has(d.id) &&
        (d.tenantId === tenantId || isBundledAcordTemplateDocument(d))
    )
    .map((d, index) => {
      const templateLike = {
        templateId: d.id,
        fileName: d.fileName,
        documentName: d.documentName,
      };
      const totalFields = Math.max(1, acordQuestionCountForTemplate(templateLike));
      const registryAutoFilledCount = countAcordAutoFilledFields(templateLike, {
        publicFields,
        publicFieldEvidence,
      });
      const autoFilledFieldCount = Math.min(
        totalFields,
        Math.max(registryAutoFilledCount, Math.min(documentReadyFieldCount + index, totalFields))
      );
      return {
        templateId: d.id,
        fileName: d.fileName,
        documentName: d.documentName,
        formNumber: getAcordFormNumber(d),
        type: String(d.type),
        storagePath: d.storagePath,
        downloadUrl: d.downloadUrl,
        autoFilledFieldCount,
        missingFieldCount: Math.max(0, totalFields - autoFilledFieldCount),
      };
    });
}

function acordMissingFieldQuestions(
  templates: CommercialAcordTemplateSelection[],
  context: {
    contactName?: string;
    agencyName?: string;
    estimatedValue?: number;
    state?: string;
    publicFields: Record<string, unknown>;
    publicFieldEvidence?: PublicDataEvidenceMap;
    assetDetails?: Record<string, string>;
    knownFieldsByTemplateId?: Record<string, TemplateFieldMap>;
  }
): QuotingQuestion[] {
  return templates.flatMap((template) =>
    buildAcordQuestionsForTemplate(template, {
      contactName: context.contactName,
      agencyName: context.agencyName,
      estimatedValue: context.estimatedValue,
      state: context.state,
      publicFields: context.publicFields,
      publicFieldEvidence: context.publicFieldEvidence,
      assetDetails: context.assetDetails,
      knownFields: context.knownFieldsByTemplateId?.[template.templateId],
    })
  );
}

function implementedPolicyNumber(carrier: Carrier, session: QuotingSession): string {
  const carrierCode = carrier.name
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "X");
  const sessionCode = session.id.slice(-6).toUpperCase();
  return `${carrierCode}-${sessionCode}`;
}

function appendUniqueQuestions(
  existing: QuotingQuestion[],
  additions: QuotingQuestion[]
): QuotingQuestion[] {
  const seen = new Set(existing.map((q) => q.id));
  return [
    ...existing,
    ...additions.filter((q) => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    }),
  ];
}

function visibleQuotingQuestions(session: QuotingSession): QuotingQuestion[] {
  const questions = session.questionnaireQuestions ?? [];
  if (session.lineOfBusiness !== "commercial") return questions;
  if (session.commercialSecondRoundSentAt && !session.commercialSupplementalsCompletedAt) {
    return questions.filter((q) => q.round === "second_round");
  }
  if (!commercialApplicationSentAtForSession(session)) {
    return questions.filter((q) => !q.carrierId && q.round !== "second_round");
  }
  return questions.filter((q) => q.round === "second_round");
}

function createQuestionnaireAccessToken(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure questionnaire links are unavailable in this browser.");
  }
  const bytes = new Uint8Array(24);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function questionnaireRecipientUrl(portalUrl: string, accessToken: string): string {
  return portalUrl.replace(
    /(\/customer\/questionnaire\/)[^/?#]+/i,
    `$1${encodeURIComponent(accessToken)}`
  );
}

function escapeQuestionnaireEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function questionnaireEmailHtml(input: {
  firstName: string;
  creatorName?: string;
  agencyName: string;
  portalUrl: string;
  questionCount: number;
  sectionCount: number;
  supplemental: boolean;
}): string {
  const firstName = escapeQuestionnaireEmailHtml(input.firstName);
  const senderName = escapeQuestionnaireEmailHtml(input.creatorName || input.agencyName);
  const portalUrl = escapeQuestionnaireEmailHtml(input.portalUrl);
  const questionnaireLabel = input.supplemental
    ? "supplemental questionnaire"
    : "quoting questionnaire";
  const buttonLabel = input.supplemental
    ? "Complete supplemental questionnaire"
    : "Complete questionnaire";
  const followUp = input.supplemental
    ? "Once submitted, the requested carrier supplementals will be updated for your agent."
    : "Once submitted, your agent can continue the quote process and review the available carrier options.";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;color:#171714;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;">
      <tr>
        <td align="left" style="padding:24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;">
            <tr><td style="font-size:16px;line-height:1.6;padding-bottom:18px;">Hi ${firstName},</td></tr>
            <tr><td style="font-size:16px;line-height:1.6;padding-bottom:20px;">We need a few additional details to continue your quote. Your ${questionnaireLabel} has ${input.questionCount} question${input.questionCount === 1 ? "" : "s"} across ${input.sectionCount} section${input.sectionCount === 1 ? "" : "s"}, with the information already on file pre-filled for you.</td></tr>
            <tr>
              <td style="padding:4px 0 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td bgcolor="#11110f" style="border-radius:6px;">
                      <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#11110f;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1;padding:16px 22px;border-radius:6px;">${buttonLabel}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="font-size:15px;line-height:1.6;padding-bottom:22px;color:#4f4d47;">${followUp}</td></tr>
            <tr><td style="font-size:16px;line-height:1.5;">Best,<br>${senderName}</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function sortQuotingSessionsByWorkRecency(a: QuotingSession, b: QuotingSession): number {
  const aStamp = a.updatedAt || a.createdAt;
  const bStamp = b.updatedAt || b.createdAt;
  if (aStamp !== bStamp) return aStamp < bStamp ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

const quotingSessionStartsInFlight = new Map<string, Promise<QuotingSession>>();

function quotingSessionStartKey(input: {
  tenantId: string;
  customerId?: string;
  prospectId?: string;
}): string | null {
  if (input.customerId) return `${input.tenantId}:customer:${input.customerId}`;
  if (input.prospectId) return `${input.tenantId}:prospect:${input.prospectId}`;
  return null;
}

function communicationHasKnownMailboxContact(row: Communication): boolean {
  if (row.mailboxOrigin !== "provider_sync" && row.mailboxOrigin !== "inbound_relay") return true;
  if (
    row.customerId &&
    db.list("customers").some((customer) => customer.id === row.customerId && customer.tenantId === row.tenantId)
  ) return true;
  if (
    row.prospectId &&
    db.list("prospects").some((prospect) => prospect.id === row.prospectId && prospect.tenantId === row.tenantId)
  ) return true;
  if (
    row.carrierContactId &&
    db.list("carrierContacts").some((contact) => contact.id === row.carrierContactId && contact.tenantId === row.tenantId)
  ) return true;
  return !!resolveEmailContact(row.tenantId, row.externalRecipientEmail ?? "");
}

function communicationNeedsInboundTriage(row: Communication): boolean {
  if (!row.aiActivityScannedAt) return true;
  if (row.aiTriageVersion === INBOUND_TRIAGE_VERSION || row.aiReplyDraftId) return false;
  const contactKind: "client" | "prospect" | "carrier" = row.customerId
    ? "client"
    : row.prospectId
      ? "prospect"
      : "carrier";
  return (
    aiClassifyInboundForActivity({
      body: row.body,
      subject: row.subject,
      channel: typeof row.channel === "string" ? row.channel : undefined,
      contactKind,
    }).serviceIntent === "vehicle_quote_intake"
  );
}

type PersonalQuoteAutomationResult = {
  communicationId: string;
  status: "completed" | "manual" | "skipped" | "failed";
  sessionId?: string;
  assetId?: string;
};

const PERSONAL_QUOTE_AUTOMATION_MAX_ATTEMPTS = 3;
const PERSONAL_QUOTE_AUTOMATION_PENDING_TIMEOUT_MS = 5 * 60_000;

function communicationContactMatches(a: Communication, b: Communication): boolean {
  return (
    (!!a.customerId && a.customerId === b.customerId) ||
    (!!a.prospectId && a.prospectId === b.prospectId)
  );
}

function normalizedEmailSubject(value?: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:re|fw|fwd):\s*/g, "")
    .replace(/\s+/g, " ");
}

function activeQuoteIntakeTask(task: Task, inbound: Communication): boolean {
  if (
    task.tenantId !== inbound.tenantId ||
    task.completedAt ||
    task.status === "resolved"
  ) {
    return false;
  }
  const sameContact =
    (!!inbound.customerId && task.customerId === inbound.customerId) ||
    (!!inbound.prospectId && task.prospectId === inbound.prospectId);
  if (!sameContact || task.topic !== "coverage_change") return false;
  return /\b(?:quote|vehicle|vin|auto|truck|property|home)\b/i.test(
    `${task.title}\n${task.description ?? ""}\n${task.aiSummary ?? ""}\n${
      task.originalMessageContent ?? ""
    }`
  );
}

function communicationsShareQuoteConversation(
  candidate: Communication,
  inbound: Communication
): boolean {
  if (
    candidate.tenantId !== inbound.tenantId ||
    !communicationContactMatches(candidate, inbound)
  ) {
    return false;
  }
  if (candidate.id === inbound.id) return true;
  if (candidate.threadId && candidate.threadId === inbound.threadId) return true;
  if (
    candidate.externalThreadId &&
    candidate.externalThreadId === inbound.externalThreadId
  ) {
    return true;
  }
  if (
    candidate.aiDraftSourceCommunicationId === inbound.id ||
    inbound.aiDraftSourceCommunicationId === candidate.id ||
    candidate.replyToId === inbound.id ||
    inbound.replyToId === candidate.id
  ) {
    return true;
  }

  const inboundHeaders = new Set(
    [
      inbound.messageIdHeader,
      inbound.externalMessageId,
      inbound.inReplyToHeader,
      ...(inbound.references ?? []),
    ]
      .map((value) => normalizeMessageHeaderId(value))
      .filter(Boolean)
  );
  const sharesHeader = [
    candidate.messageIdHeader,
    candidate.externalMessageId,
    candidate.inReplyToHeader,
    ...(candidate.references ?? []),
  ]
    .map((value) => normalizeMessageHeaderId(value))
    .some((value) => value && inboundHeaders.has(value));
  if (sharesHeader) return true;

  const candidateSubject = normalizedEmailSubject(candidate.subject);
  const inboundSubject = normalizedEmailSubject(inbound.subject);
  return (
    !!candidateSubject &&
    candidateSubject === inboundSubject &&
    /\b(?:quote|vehicle|vin|auto|truck|property|home)\b/i.test(candidateSubject)
  );
}

function existingQuoteIntakeTaskForInbound(inbound: Communication): Task | undefined {
  const conversation = db
    .list("communications")
    .filter((candidate) => communicationsShareQuoteConversation(candidate, inbound));
  const communicationIds = new Set(conversation.map((candidate) => candidate.id));
  const linkedTaskIds = new Set(
    conversation
      .map((candidate) => candidate.aiActivityTaskId)
      .filter((value): value is string => Boolean(value))
  );
  const candidates = db
    .list("tasks")
    .filter((task) => activeQuoteIntakeTask(task, inbound));
  const linked = candidates
    .filter(
      (task) =>
        linkedTaskIds.has(task.id) ||
        communicationIds.has(task.messageId ?? "") ||
        communicationIds.has(task.originalMessageId ?? "")
    )
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  if (linked[0]) return linked[0];

  const openSessionIds = new Set(
    db
      .list("quotingSessions")
      .filter(
        (session) =>
          session.tenantId === inbound.tenantId &&
          ((!inbound.customerId || session.customerId === inbound.customerId) &&
            (!inbound.prospectId || session.prospectId === inbound.prospectId)) &&
          isQuotingWorkflowOpen(session)
      )
      .map((session) => session.id)
  );
  const sessionLinked = candidates
    .filter((task) => openSessionIds.has(task.quoteSessionId ?? ""))
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  if (sessionLinked[0]) return sessionLinked[0];

  return candidates.length === 1 ? candidates[0] : undefined;
}

function consolidateQuoteIntakeActivity(inbound: Communication, canonical: Task): void {
  const duplicateIds = new Set(
    db
      .list("tasks")
      .filter(
        (task) =>
          task.id !== canonical.id &&
          activeQuoteIntakeTask(task, inbound) &&
          (task.id === inbound.aiActivityTaskId ||
            task.messageId === inbound.id ||
            task.originalMessageId === inbound.id)
      )
      .map((task) => task.id)
  );

  db
    .list("communications")
    .filter(
      (communication) =>
        communication.tenantId === inbound.tenantId &&
        (communication.id === inbound.id ||
          duplicateIds.has(communication.aiActivityTaskId ?? ""))
    )
    .forEach((communication) =>
      db.update("communications", communication.id, {
        aiActivityTaskId: canonical.id,
      })
    );
  db
    .list("statusEvents")
    .filter((event) => duplicateIds.has(event.taskId ?? ""))
    .forEach((event) => db.update("statusEvents", event.id, { taskId: canonical.id }));

  duplicateIds.forEach((duplicateId) => {
    const completedAt = nowIso();
    db.update("tasks", duplicateId, {
      status: "resolved",
      completedAt,
      completedById: "ai",
      resolutionNote:
        "Automatically consolidated with the existing activity for this quote request.",
      resolutionNoteAt: completedAt,
    });
    logTaskAudit({
      tenantId: inbound.tenantId,
      actorId: "ai",
      action: "task.resolved_duplicate_quote_reply",
      taskId: duplicateId,
      metadata: {
        canonicalTaskId: canonical.id,
        communicationId: inbound.id,
      },
    });
  });
}

function priorQuoteContextForCommunication(row: Communication): string {
  const subject = normalizedEmailSubject(row.subject);
  const recentOutbound = db
    .list("communications")
    .filter(
      (candidate) =>
        candidate.tenantId === row.tenantId &&
        candidate.direction === "outbound" &&
        communicationContactMatches(candidate, row) &&
        candidate.createdAt <= row.createdAt &&
        (candidate.threadId === row.threadId ||
          (!!candidate.externalThreadId && candidate.externalThreadId === row.externalThreadId) ||
          normalizedEmailSubject(candidate.subject) === subject ||
          /\b(?:quote|vin|vehicle|property address|asset id|hull id|hin)\b/i.test(
            `${candidate.subject ?? ""}\n${candidate.body}`
          ))
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  return recentOutbound ? `${recentOutbound.subject ?? ""}\n${recentOutbound.body}` : "";
}

function quoteAutomationCanRun(row: Communication): boolean {
  if (!row.aiQuoteAutomationStatus) return true;
  if (
    row.aiQuoteAutomationStatus === "skipped" &&
    row.aiTriageVersion !== INBOUND_TRIAGE_VERSION
  ) {
    return true;
  }
  if (row.aiQuoteAutomationStatus === "failed") {
    return (row.aiQuoteAutomationAttempts ?? 0) < PERSONAL_QUOTE_AUTOMATION_MAX_ATTEMPTS;
  }
  if (row.aiQuoteAutomationStatus !== "pending") return false;
  const attemptedAt = Date.parse(row.aiQuoteAutomationProcessedAt ?? "");
  return !Number.isFinite(attemptedAt) || Date.now() - attemptedAt > PERSONAL_QUOTE_AUTOMATION_PENDING_TIMEOUT_MS;
}

function removeStaleQuoteIntakeDrafts(inbound: Communication): void {
  const conversationIds = new Set(
    db
      .list("communications")
      .filter((candidate) => communicationsShareQuoteConversation(candidate, inbound))
      .map((candidate) => candidate.id)
  );
  conversationIds.add(inbound.id);
  const drafts = db
    .list("communications")
    .filter(
      (candidate) =>
        candidate.tenantId === inbound.tenantId &&
        conversationIds.has(candidate.aiDraftSourceCommunicationId ?? "") &&
        candidate.aiServiceIntent === "vehicle_quote_intake" &&
        candidate.deliveryStatus === "draft"
    );
  const draftIds = new Set(drafts.map((draft) => draft.id));
  if (draftIds.size === 0) return;

  db
    .list("aiNotifications")
    .filter(
      (notification) =>
        notification.tenantId === inbound.tenantId &&
        (draftIds.has(notification.messageId ?? "") ||
          conversationIds.has(notification.communicationId ?? ""))
    )
    .forEach((notification) => db.remove("aiNotifications", notification.id));
  drafts.forEach((draft) => db.remove("communications", draft.id));
  conversationIds.forEach((communicationId) =>
    db.update("communications", communicationId, {
      aiReplyDraftId: undefined,
      aiDraftMissingFields: undefined,
    })
  );
}

function processImportedInboundCommunication(
  tenantId: string,
  mailboxUserId: string,
  communicationId: string
): void {
  void api.communications
    .automatePersonalQuoteReplies(tenantId, mailboxUserId, communicationId)
    .catch(() => [])
    .finally(() => {
      api.communications.sweepInboundForActivities(tenantId, mailboxUserId);
    });
}

function quoteAutomationAssetDetails(intake: PersonalQuoteReplyIntake): Record<string, string> {
  if (intake.identifierKind === "vin") return { vin: intake.identifier };
  if (intake.identifierKind === "address") {
    return { propertyAddress: intake.identifier, address: intake.identifier };
  }
  if (intake.identifierKind === "hin") return { hin: intake.identifier };
  return { assetIdentifier: intake.identifier };
}

function quoteAutomationAssetIdentifier(
  asset: Asset,
  kind: PersonalQuoteReplyIntake["identifierKind"]
): string {
  const details = assetDetails(asset);
  if (kind === "vin") return String(details.vin ?? details.vehicleVin ?? details.assetIdentifier ?? "");
  if (kind === "address") {
    return String(
      details.propertyAddress ??
        details.riskAddress ??
        details.address ??
        details.primaryResidenceAddress ??
        ""
    );
  }
  if (kind === "hin") {
    return String(details.hin ?? details.hullId ?? details.hullIdentificationNumber ?? "");
  }
  return String(details.assetIdentifier ?? details.identifier ?? details.assetId ?? "");
}

function assetMatchesQuoteAutomationIntake(asset: Asset, intake: PersonalQuoteReplyIntake): boolean {
  if (asset.type !== intake.assetType) return false;
  return (
    normalizedQuoteIdentifier(
      intake.identifierKind,
      quoteAutomationAssetIdentifier(asset, intake.identifierKind)
    ) === normalizedQuoteIdentifier(intake.identifierKind, intake.identifier)
  );
}

function personalCategoryForQuoteAutomation(
  tenantId: string,
  intake: PersonalQuoteReplyIntake
): InsuranceCategory | undefined {
  const candidates = api.categories
    .listActiveForTenant(tenantId)
    .filter(
      (category) =>
        category.lineOfBusiness === "personal" && category.assetType === intake.assetType
    );
  if (candidates.length <= 1) return candidates[0];
  const keywords =
    intake.assetType === "luxury_vehicle"
      ? /\b(?:auto|vehicle|car|truck)\b/i
      : intake.assetType === "coastal_home"
        ? /\b(?:home|house|property|dwelling)\b/i
        : intake.assetType === "yacht"
          ? /\b(?:boat|yacht|marine|watercraft)\b/i
          : intake.assetType === "jewelry"
            ? /\b(?:jewelry|valuable|collection)\b/i
            : /./;
  return candidates.find((category) => keywords.test(category.label)) ?? candidates[0];
}

function quoteAutomationPortalUrl(sessionId: string): string {
  const path = `/customer/questionnaire/${encodeURIComponent(sessionId)}`;
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return `https://quotexinsurance.com${path}`;
}

function quoteAutomationUnansweredRequiredCount(session: QuotingSession): number {
  const responses = session.questionnaireResponses ?? {};
  return visibleQuotingQuestions(session).filter(
    (question) => question.required && !(responses[question.id] ?? "").trim()
  ).length;
}

function quoteAutomationSessionContainsAsset(session: QuotingSession, assetId: string): boolean {
  return (
    session.assetId === assetId ||
    (session.selectedAssetMappings ?? []).some((mapping) => mapping.assetId === assetId)
  );
}

function commercialApplicationSentAtForSession(session: QuotingSession): string | undefined {
  // The workflow milestone records that the agent completed carrier dispatch.
  // Provider delivery continues to be tracked independently on each
  // Communication, so a queued mailbox job must not move the quote flow back
  // to ACORD review or prevent a later supplemental round.
  if (session.commercialApplicationSentAt) return session.commercialApplicationSentAt;

  const applicationMessageIds = Array.from(
    new Set(
      (session.commercialCarrierSubmissions ?? []).flatMap(
        (submission) => submission.applicationMessageIds ?? []
      )
    )
  );
  if (applicationMessageIds.length > 0) {
    const communications = new Map(
      db
        .list("communications")
        .filter((communication) => communication.tenantId === session.tenantId)
        .map((communication) => [communication.id, communication])
    );
    const providerConfirmed = applicationMessageIds.every((messageId) => {
      const status = communications.get(messageId)?.deliveryStatus;
      return status === "sent" || status === "synced";
    });
    const submissionWasDispatched = (session.commercialCarrierSubmissions ?? []).some(
      (submission) =>
        !!submission.sentAt &&
        (submission.applicationMessageIds ?? []).some((messageId) =>
          applicationMessageIds.includes(messageId)
        )
    );
    if (!providerConfirmed && !submissionWasDispatched) return undefined;
  }
  const submission = (session.commercialCarrierSubmissions ?? []).find(
    (item) =>
      (item.applicationMessageIds?.length ?? 0) > 0 ||
      (item.applicationDocumentIds?.length ?? 0) > 0 ||
      item.status === "application_sent" ||
      item.status === "awaiting_response" ||
      item.status === "accepted" ||
      item.status === "declined" ||
      item.status === "needs_client_info" ||
      item.status === "needs_supplemental" ||
      item.status === "supplemental_sent" ||
      item.status === "agent_review"
  );
  return (
    submission?.sentAt ??
    session.commercialSecondRoundSentAt ??
    session.commercialSupplementalsCompletedAt
  );
}

function ensureQuotingSessionConsistency(session: QuotingSession): QuotingSession {
  let current =
    session.lineOfBusiness === "commercial"
      ? session
      : ensureCompletePersonalCategoryQuestionnaire(session);

  if (current.lineOfBusiness !== "commercial") {
    if (current.quotes.length > 0 && current.status !== "complete") {
      current = {
        ...current,
        status: "complete",
        updatedAt: current.updatedAt,
      };
    }
    return current;
  }

  const patch: Partial<QuotingSession> = {};
  const applicationSentAt = commercialApplicationSentAtForSession(current);
  if (applicationSentAt && !current.commercialApplicationSentAt) {
    patch.commercialApplicationSentAt = applicationSentAt;
  }
  if (applicationSentAt && !current.commercialQuestionnairePreparedAt) {
    patch.commercialQuestionnairePreparedAt = applicationSentAt;
  }

  const hasInitialQuestions = (current.questionnaireQuestions ?? []).some(
    (question) => !question.carrierId && question.round !== "second_round"
  );
  const hasCommercialAcordTemplates = (current.commercialAcordTemplates ?? []).length > 0;
  if (!current.commercialQuestionnairePreparedAt && hasInitialQuestions && hasCommercialAcordTemplates) {
    patch.commercialQuestionnairePreparedAt = current.updatedAt ?? applicationSentAt ?? current.createdAt;
  }
  if (
    current.commercialQuestionnairePreparedAt &&
    (current.questionnaireQuestions ?? []).length === 0 &&
    !applicationSentAt
  ) {
    patch.questionnaireQuestions = initialCommercialQuestionnaireQuestions(current);
  }

  if (applicationSentAt && current.status === "gathering_info") {
    patch.status = "awaiting_reply";
  }
  if (current.quotes.length > 0 && current.status === "gathering_info") {
    patch.status =
      current.commercialSecondRoundSentAt && !current.commercialSupplementalsCompletedAt
        ? "awaiting_reply"
        : "complete";
  }
  if (
    current.commercialSupplementalsCompletedAt &&
    current.quotes.length > 0 &&
    current.status !== "complete"
  ) {
    patch.status = "complete";
  }

  return Object.keys(patch).length > 0 ? { ...current, ...patch } : current;
}

function initialCommercialQuestionnaireQuestions(session: QuotingSession): QuotingQuestion[] {
  const contact = contactForQuotingSession(session);
  const agency = db.list("agencies").find((candidate) => candidate.id === session.tenantId);
  const templates = session.commercialAcordTemplates ?? [];
  const knownFieldsByTemplateId = knownAcordFieldsByTemplateId(
    templates,
    session,
    {},
    "application"
  );

  return filterCommercialBaseQuestionsAnsweredByTrustedAi(
    commercialBaseQuestionnaireQuestions(session).concat(
      acordMissingFieldQuestions(templates, {
        contactName: contact?.name ?? "Commercial applicant",
        agencyName: agency?.name,
        estimatedValue: session.estimatedValue,
        state: session.state,
        publicFields: session.publicFields,
        publicFieldEvidence: session.publicFieldEvidence,
        assetDetails: session.assetDetails,
        knownFieldsByTemplateId,
      })
    ),
    session.questionnaireResponses ?? {},
    session.questionnaireResponseMeta ?? {}
  );
}

function commercialBaseQuestionnaireQuestions(session: QuotingSession): QuotingQuestion[] {
  const contact = contactForQuotingSession(session);
  return aiGenerateCommercialQuestionnaire({
    contactName: contact?.name ?? "Commercial applicant",
    carrierList: [],
    knownPublicFields: session.publicFields,
  }).filter((question) => !question.carrierId);
}

function filterCommercialBaseQuestionsAnsweredByTrustedAi(
  questions: QuotingQuestion[],
  responses: Record<string, string>,
  meta: Record<string, QuestionnaireResponseMeta>
): QuotingQuestion[] {
  return questions.filter((question) => {
    if (!question.id.startsWith("base-")) return true;
    if (commercialBaseQuestionMustRemainVisible(question)) return true;
    const value = cleanQuestionnairePrefillValue(responses[question.id]);
    if (!value) return true;
    return !questionnaireResponseMetaIsTrustedAiSeed(meta[question.id]);
  });
}

function commercialBaseQuestionMustRemainVisible(question: QuotingQuestion): boolean {
  return /\b(claim|claims|loss|losses)\b/i.test(`${question.id} ${question.label}`);
}

function questionnaireResponseMetaIsTrustedAiSeed(meta: QuestionnaireResponseMeta | undefined): boolean {
  if (!meta || meta.updatedByRole !== "ai") return false;
  if (meta.verified) return true;
  return new Set([
    "agent_seed",
    "client_intake",
    "validated_address",
    "public_geocoder",
    "government_api",
    "commercial_provider",
    "carrier_api",
  ]).has(String(meta.sourceKind ?? ""));
}

function missingFieldsForQuestionSet(
  questions: QuotingQuestion[],
  responses: Record<string, string>
): string[] {
  return questions
    .filter((question) => question.required && !responses[question.id]?.trim())
    .map((question) => question.label);
}

function commercialSupplementalQuestionsForCarrier(carrier: Carrier): {
  label: string;
  kind: QuotingQuestion["kind"];
  options?: string[];
}[] {
  const questions: {
    label: string;
    kind: QuotingQuestion["kind"];
    options?: string[];
  }[] = [
    {
      label: `${carrier.name}: confirm cyber liability coverage carried separately`,
      kind: "select",
      options: ["Yes", "No", "Pending quote"],
    },
    {
      label: `${carrier.name}: confirm operations outside the US`,
      kind: "select",
      options: ["No", "Canada/Mexico only", "Worldwide"],
    },
  ];
  if (carrier.preferredAssetTypes.includes("luxury_vehicle")) {
    questions.push({
      label: `${carrier.name}: fleet schedule - number of company-owned vehicles`,
      kind: "number",
    });
  }
  if (carrier.preferredAssetTypes.includes("coastal_home")) {
    questions.push({
      label: `${carrier.name}: commercial property schedule - locations and square footage`,
      kind: "textarea",
    });
  }
  questions.push({
    label: `${carrier.name}: pending or threatened litigation details`,
    kind: "textarea",
  });
  return questions.slice(0, 3);
}

function carrierHasCommercialAppetite(carrier: Carrier): boolean {
  if ((carrier.appetites ?? []).some((appetite) => appetite.line === "commercial")) {
    return true;
  }
  const text = [
    carrier.name,
    carrier.appetiteNotes,
    carrier.tendencyNotes,
    carrier.underwritingRules,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(commercial|business|bop|workers|general liability|professional liability|fleet|company|main[-\s]?street|small[-\s]?commercial|farm)\b/.test(
    text
  );
}

function carrierCommercialDocuments(tenantId: string, carrierId: string): Document[] {
  return db
    .list("documents")
    .filter(
      (document) =>
        document.tenantId === tenantId &&
        document.carrierId === carrierId &&
        document.lineOfBusiness === "commercial"
    );
}

function carrierUnderwriters(tenantId: string, carrierId: string): CarrierContact[] {
  return db
    .list("carrierContacts")
    .filter(
      (contact) =>
        contact.tenantId === tenantId &&
        contact.carrierId === carrierId &&
        contact.position === "underwriter" &&
        !!contact.email
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function commercialCarrierRecommendationsForSession(
  session: QuotingSession,
  responses: Record<string, string> = {}
): CommercialCarrierRecommendation[] {
  const carriers = linkedActiveCarriers(session.tenantId).filter((carrier) => {
    return (
      carrierHasCommercialAppetite(carrier) ||
      carrierCommercialDocuments(session.tenantId, carrier.id).length > 0 ||
      carrierUnderwriters(session.tenantId, carrier.id).length > 0
    );
  });
  const ranked = aiRankCarrierQuotes({
    carriers,
    assetType: session.assetType,
    estimatedValue: session.estimatedValue || 1_000_000,
    state: session.state,
    lineOfBusiness: "commercial",
  }).quotes;
  const responseCompleteness = Math.min(
    0.08,
    Object.values(responses).filter((value) => value.trim()).length * 0.01
  );

  const rows: CommercialCarrierRecommendation[] = [];
  ranked.forEach((quote) => {
    const carrier = carriers.find((candidate) => candidate.id === quote.carrierId);
    if (!carrier) return;
    const underwriterContacts = carrierUnderwriters(session.tenantId, carrier.id);
    const commercialDocumentCount = carrierCommercialDocuments(session.tenantId, carrier.id).length;
    const hasCommercialAppetite = carrierHasCommercialAppetite(carrier);
    const connector = getCarrierQuoteProviderReadiness(carrier);
    const automationAvailable =
      connector.provider === "carrier_portal_automation" &&
      connector.hasPortalUrl &&
      connector.quoteApiStatus !== "no_api";
    const score = Math.min(
      1,
      quote.score +
        (hasCommercialAppetite ? 0.18 : 0) +
        (automationAvailable ? 0.1 : underwriterContacts.length > 0 ? 0.08 : -0.06) +
        (commercialDocumentCount > 0 ? 0.05 : 0) +
        responseCompleteness
    );
    const underwriterPhrase =
      underwriterContacts.length === 1
        ? `1 underwriter on file (${underwriterContacts[0].name})`
        : underwriterContacts.length > 1
        ? `${underwriterContacts.length} underwriters on file`
        : "no underwriter email on file";
    const documentPhrase =
      commercialDocumentCount > 0
        ? `${commercialDocumentCount} commercial document${commercialDocumentCount === 1 ? "" : "s"} on file`
        : "no commercial documents uploaded";
    const connectorPhrase = automationAvailable
      ? `${connector.providerLabel} can queue a secured background portal submission`
      : underwriterContacts.length > 0
      ? "underwriter email workflow is available"
      : "no carrier submission connector on file";
    rows.push({
      carrierId: carrier.id,
      carrierName: carrier.name,
      rank: 0,
      score,
      fitReason: quote.fitReason,
      hasCommercialAppetite,
      commercialDocumentCount,
      underwriterContacts,
      connectorLabel: automationAvailable ? connector.providerLabel : undefined,
      automationAvailable,
      disabledReason:
        underwriterContacts.length === 0 && !automationAvailable
          ? "Add an underwriter email or configure carrier portal automation before sending."
          : undefined,
      aiRationale: [
        hasCommercialAppetite
          ? "AI recognized commercial appetite from the carrier profile."
          : "AI found commercial readiness from agency documents or contacts.",
        underwriterPhrase,
        documentPhrase,
        connectorPhrase,
      ].join(" "),
    });
  });

  return rows
    .sort((a, b) => b.score - a.score || a.carrierName.localeCompare(b.carrierName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function contactForQuotingSession(session: QuotingSession): CustomerProfile | Prospect | null {
  if (session.customerId) {
    return tenantFilter(db.list("customers"), session.tenantId)
      .find((customer) => customer.id === session.customerId) ?? null;
  }
  if (session.prospectId) {
    return tenantFilter(db.list("prospects"), session.tenantId)
      .find((prospect) => prospect.id === session.prospectId) ?? null;
  }
  return null;
}

function completedAcordFileName(
  template: CommercialAcordTemplateSelection,
  contactName: string,
  kind: "application" | "supplemental"
): string {
  const contactSlug = contactName
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42) || "Commercial-applicant";
  const base = template.fileName.replace(/\.[^.]+$/, "");
  const ext = template.fileName.match(/\.[^.]+$/)?.[0] ?? ".pdf";
  return `${base}-${contactSlug}-${kind === "application" ? "completed" : "supplemental-completed"}${ext}`;
}

function clientAcordFillDossier(
  session: QuotingSession,
  responses: Record<string, string>,
  templateDocument?: Document
) {
  const contact = contactForQuotingSession(session);
  const agency = db.list("agencies").find((candidate) => candidate.id === session.tenantId);
  const customerId = session.customerId ?? (contact && "customerId" in contact ? contact.customerId : undefined);
  const prospectId = session.prospectId ?? (!customerId && contact ? contact.id : undefined);
  const tenantAssets = tenantFilter(db.list("assets"), session.tenantId);
  const assets = tenantAssets.filter(
    (asset) =>
      (!!customerId && asset.customerId === customerId) ||
      (!!session.assetId && asset.id === session.assetId)
  );
  const assetIds = new Set(assets.map((asset) => asset.id));
  if (session.assetId) assetIds.add(session.assetId);
  const policies = tenantFilter(db.list("policies"), session.tenantId).filter(
    (policy) =>
      (!!customerId && policy.customerId === customerId) ||
      (!!session.assetId && policy.assetId === session.assetId) ||
      assetIds.has(policy.assetId)
  );
  const policyIds = new Set(policies.map((policy) => policy.id));
  const claims = tenantFilter(db.list("claims"), session.tenantId).filter(
    (claim) =>
      (!!customerId && claim.customerId === customerId) ||
      (!!claim.policyId && policyIds.has(claim.policyId))
  );
  const claimIds = new Set(claims.map((claim) => claim.id));
  const documents = tenantFilter(db.list("documents"), session.tenantId).filter(
    (document) =>
      !String(document.type).startsWith("completed_acord") &&
      ((!!customerId && document.customerId === customerId) ||
        (!!session.assetId && document.assetId === session.assetId) ||
        (!!document.assetId && assetIds.has(document.assetId)) ||
        (!!document.policyId && policyIds.has(document.policyId)) ||
        (!!document.claimId && claimIds.has(document.claimId)) ||
        document.quoteRequestId === session.id)
  );
  const notes = tenantFilter(db.list("notes"), session.tenantId).filter(
    (note) =>
      (!!customerId && note.customerId === customerId) ||
      (!!prospectId && note.prospectId === prospectId) ||
      (!!note.policyId && policyIds.has(note.policyId))
  );
  const communications = tenantFilter(db.list("communications"), session.tenantId).filter(
    (communication) =>
      (!!customerId && communication.customerId === customerId) ||
      (!!prospectId && communication.prospectId === prospectId)
  );
  const policyCarrierIds = new Set(policies.map((policy) => policy.carrierId));
  const linkedCarriers = linkedActiveCarriers(session.tenantId);
  const carrierPool = db.list("carriers").filter((carrier) => carrier.status === "active");
  const carriers = [
    ...linkedCarriers,
    ...carrierPool.filter((carrier) => policyCarrierIds.has(carrier.id)),
  ].filter(
    (carrier, index, all) => all.findIndex((candidate) => candidate.id === carrier.id) === index
  );

  return {
    agency,
    contact,
    assets,
    policies,
    carriers,
    claims,
    documents,
    notes,
    communications,
    session,
    questions: session.questionnaireQuestions ?? [],
    responses: documentSafeQuestionnaireResponses(session, {
      ...(session.questionnaireResponses ?? {}),
      ...responses,
    }),
    templateDocument,
  };
}

function documentSafeQuestionnaireResponses(
  session: QuotingSession,
  responses: Record<string, string>
): Record<string, string> {
  const questionsById = new Map(
    (session.questionnaireQuestions ?? []).map((question) => [question.id, question])
  );
  return Object.fromEntries(
    Object.entries(responses).filter(([questionId, value]) => {
      if (!String(value ?? "").trim()) return false;
      const meta = session.questionnaireResponseMeta?.[questionId];
      if (meta?.updatedByRole !== "ai") return true;
      const question = questionsById.get(questionId);
      if (!question) return false;
      const candidateEvidenceKeys = [
        question.acordFieldKey,
        question.label,
        ...(question.acordFieldLabels ?? []),
      ].filter((key): key is string => Boolean(key?.trim()));
      return candidateEvidenceKeys.some((key) =>
        aiEvidenceAllowsDocumentAutofill(
          findAiPublicEvidence(session.publicFieldEvidence, key)
        )
      );
    })
  );
}

function compactAcordAiScalar(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 500) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return undefined;
}

function compactAcordAiRecord(value: unknown, keys: string[]): Record<string, string | number | boolean> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  keys.forEach((key) => {
    const scalar = compactAcordAiScalar(record[key]);
    if (scalar !== undefined) out[key] = scalar;
  });
  return Object.keys(out).length ? out : null;
}

function compactAcordAiDetails(
  value: unknown,
  limit = 24
): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, limit)) {
    const scalar = compactAcordAiScalar(raw);
    if (scalar !== undefined) out[key] = scalar;
  }
  return out;
}

function compactAcordAiEvidence(
  evidence: PublicDataEvidenceMap | undefined,
  limit = 60
): Record<string, Record<string, string | number | boolean>> {
  if (!evidence) return {};
  const out: Record<string, Record<string, string | number | boolean>> = {};
  for (const [key, item] of Object.entries(evidence).slice(0, limit)) {
    out[key] = {
      fieldKey: item.fieldKey,
      sourceKind: item.sourceKind,
      sourceLabel: item.sourceLabel,
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      confidence: item.confidence,
      verified: item.verified,
      allowDocumentAutofill: item.allowDocumentAutofill,
      ...(item.observedDate ? { observedDate: item.observedDate } : {}),
      ...(item.notes ? { notes: item.notes.slice(0, 220) } : {}),
    };
  }
  return out;
}

function compactAcordAiDossier(
  session: QuotingSession,
  responses: Record<string, string>,
  templateDocument?: Document
): Record<string, unknown> {
  const dossier = clientAcordFillDossier(session, responses, templateDocument);
  const contactRecord = dossier.contact as Record<string, unknown> | null;
  return {
    agency: compactAcordAiRecord(dossier.agency, [
      "id",
      "name",
      "legalName",
      "agencyName",
      "address",
      "phone",
      "contactEmail",
      "supportEmail",
      "email",
      "website",
    ]),
    contact: compactAcordAiRecord(contactRecord, [
      "id",
      "name",
      "businessName",
      "email",
      "phone",
      "address",
      "mailingAddress",
      "operationsDescription",
      "customerId",
    ]),
    session: {
      id: session.id,
      lineOfBusiness: session.lineOfBusiness,
      assetType: session.assetType,
      categoryLabel: session.categoryLabel,
      estimatedValue: session.estimatedValue || undefined,
      state: session.state,
      assetDetails: compactAcordAiDetails(session.assetDetails, 30),
      publicFields: compactAcordAiDetails(session.publicFields, 60),
      publicFieldEvidence: compactAcordAiEvidence(session.publicFieldEvidence, 60),
      selectedAssets: (session.selectedAssetMappings ?? []).map((asset) => ({
        assetId: asset.assetId,
        label: asset.label,
        assetType: asset.assetType,
        address: asset.address,
        estimatedValue: asset.estimatedValue || undefined,
        assetDetails: compactAcordAiDetails(asset.assetDetails, 30),
        publicFields: compactAcordAiDetails(asset.publicFields, 60),
        publicFieldEvidence: compactAcordAiEvidence(asset.publicFieldEvidence, 60),
        missingFields: asset.missingFields.slice(0, 60),
      })),
    },
    assets: dossier.assets.slice(0, 12).map((asset) => ({
      id: asset.id,
      label: asset.label,
      assetType: asset.type,
      estimatedValue: asset.estimatedValue || undefined,
      details: compactAcordAiDetails(asset.details, 30),
    })),
    policies: dossier.policies.slice(0, 12).map((policy) => ({
      id: policy.id,
      assetId: policy.assetId,
      policyNumber: policy.policyNumber,
      carrierId: policy.carrierId,
      status: policy.status,
      effectiveDate: policy.effectiveDate,
      renewalDate: policy.renewalDate,
      finalPremium: policy.finalPremium,
      premiumEstimate: policy.premiumEstimate,
      coverages: (policy.coverages ?? []).slice(0, 18).map((coverage) => ({
        name: coverage.name,
        limit: coverage.limit,
        deductible: coverage.deductible,
        description: coverage.description,
      })),
      participants: (policy.participants ?? []).slice(0, 18).map((participant) =>
        compactAcordAiRecord(participant, [
          "name",
          "participantType",
          "role",
          "status",
          "relationship",
          "assignedAssetId",
          "licenseNumber",
          "licenseState",
          "dateOfBirth",
          "dob",
          "phone",
          "email",
        ])
      ),
      additionalInsureds: (policy.additionalInsureds ?? []).slice(0, 18).map((party) =>
        compactAcordAiRecord(party, ["name", "holderType", "address", "loanNumber", "relationship"])
      ),
    })),
    carriers: dossier.carriers.slice(0, 24).map((carrier) =>
      compactAcordAiRecord(carrier, ["id", "name", "naic", "status"])
    ),
    claims: dossier.claims.slice(0, 18).map((claim) =>
      compactAcordAiRecord(claim, [
        "id",
        "externalClaimNumber",
        "carrierId",
        "policyId",
        "openedAt",
        "lossDescription",
        "lossAmountUsd",
        "status",
      ])
    ),
    documents: dossier.documents.slice(0, 30).map((document) =>
      compactAcordAiRecord(document, ["id", "documentName", "fileName", "type", "status", "uploadedAt"])
    ),
    notes: dossier.notes.slice(0, 12).map((note) =>
      compactAcordAiRecord(note, ["id", "title", "body", "createdAt", "source"])
    ),
    communications: dossier.communications.slice(0, 12).map((communication) =>
      compactAcordAiRecord(communication, ["id", "subject", "body", "direction", "channel", "sentAt", "createdAt"])
    ),
    questions: dossier.questions.map((question) => ({
      id: question.id,
      label: question.label,
      acordFieldLabels: question.acordFieldLabels ?? [],
    })),
    responses: Object.fromEntries(
      Object.entries(dossier.responses)
        .map(([key, value]) => [key, compactAcordAiScalar(value)])
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    ),
  };
}

function acordAiFieldsForTemplate(
  template: CommercialAcordTemplateSelection,
  templateDocument?: Document
) {
  const sourceArtifact = completedAcordSourceArtifact(template, templateDocument);
  const seen = new Set<string>();
  return (sourceArtifact.templateFieldLayout ?? [])
    .map((field) => ({
      label: field.label?.trim() ?? "",
      required: field.required === true,
      kind: field.kind ?? "text",
      page: field.page,
    }))
    .filter((field) => {
      const key = field.label.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function questionnaireAiFieldsForSession(session: QuotingSession) {
  return questionnaireAiFieldsForQuestions(initialCommercialQuestionnaireQuestions(session));
}

function questionnaireAiFieldsForQuestions(questions: QuotingQuestion[]) {
  return questions.map((question) => ({
    id: question.id,
    label: question.label,
    section: question.section,
    acordFieldLabels: question.acordFieldLabels ?? [],
    acordFieldKey: question.acordFieldKey,
    required: question.required === true,
    kind: question.kind,
    options: question.options ?? [],
  }));
}

function aiProviderErrorBlocksWorkflow(
  session: Pick<QuotingSession, "aiProviderError" | "aiProviderErrorCode">
): boolean {
  void session;
  return false;
}

function aiProviderErrorCodeFromCaught(error: unknown): string {
  const detail = (error as { detail?: { error?: unknown } })?.detail;
  const status = (error as { detail?: { status?: unknown } })?.detail?.status;
  const detailError = typeof detail?.error === "string" ? detail.error.trim() : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const combined = `${detailError} ${message}`;
  const normalized = combined.toLowerCase();
  if (
    status === 504 ||
    normalized.includes("function_invocation_timeout") ||
    normalized.includes("timeout") ||
    normalized.includes("abort")
  ) {
    return "timeout";
  }
  if (detailError) return detailError;
  return "provider_unavailable";
}

function personalCategoryAnswerHints(_category?: InsuranceCategory): Record<string, string> {
  // Category selection routes the quote flow; it is not evidence about the actual risk.
  return {};
}

const PERSONAL_AUTO_PUBLIC_RESEARCH_KEYS = new Set([
  "ratingCounty",
  "uspsValidated",
  "vehicleYear",
  "vehicleMake",
  "vehicleModel",
  "vehicleTrim",
  "vehicleBodyStyle",
  "vehicleOriginalMsrp",
  "vehicleEngine",
  "vehicleCylinders",
  "vehicleDisplacement",
  "vehicleFuelType",
  "vehicleDriveType",
  "vehicleDoorCount",
  "antiLockBrakes",
  "antiTheftDevice",
  "airbags",
]);

async function applyServerQuestionnaireMappingToSession(
  session: QuotingSession,
  questions: QuotingQuestion[] = session.questionnaireQuestions ?? [],
  responses: Record<string, string> = session.questionnaireResponses ?? {}
): Promise<QuotingSession> {
  const questionnaireFields = questionnaireAiFieldsForQuestions(questions);
  if (questionnaireFields.length === 0) return session;

  const strictPersonalAuto =
    session.lineOfBusiness !== "commercial" && session.assetType === "luxury_vehicle";
  const publicFields: Record<string, unknown> = { ...(session.publicFields ?? {}) };
  const publicFieldEvidence: PublicDataEvidenceMap = { ...(session.publicFieldEvidence ?? {}) };
  let questionnaireResponses: Record<string, string> = { ...(session.questionnaireResponses ?? {}) };
  let questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta> = {
    ...(session.questionnaireResponseMeta ?? {}),
  };
  let questionnaireAddedCount = 0;
  let summary = "";
  let mappedProviderError: string | undefined;
  let mappedProviderErrorCode: string | undefined;
  const contact = contactForQuotingSession(session);

  if (strictPersonalAuto) {
    const preparedAt = nowIso();
    const prepared = mergeSeededQuestionnaireResponses({
      session: {
        ...session,
        publicFields,
        publicFieldEvidence,
        questionnaireResponses,
        questionnaireResponseMeta,
      },
      questions,
      contactName: contact?.name,
      contactEmail: contact?.email,
      contactPhone: contact?.phone,
      businessName: contact && "businessName" in contact ? contact.businessName : undefined,
      address: quoteSessionAddressContext(session),
      estimatedValue: session.estimatedValue,
      assetDetails: session.assetDetails,
      publicFields,
      publicFieldEvidence,
      updatedAt: preparedAt,
    });
    questionnaireResponses = prepared.questionnaireResponses;
    questionnaireResponseMeta = prepared.questionnaireResponseMeta;
  }

  try {
    const mapped = await aiMapAcordFields({
      tenantId: session.tenantId,
      template: {
        documentName:
          session.lineOfBusiness === "commercial"
            ? "Commercial questionnaire"
            : "Personal lines questionnaire",
        fileName:
          session.lineOfBusiness === "commercial"
            ? "commercial-questionnaire"
            : "personal-lines-questionnaire",
        formNumber: session.lineOfBusiness === "commercial" ? "Commercial intake" : "Personal intake",
      },
      fields: questionnaireFields,
      dossier: compactAcordAiDossier(
        {
          ...session,
          publicFields,
          publicFieldEvidence,
          questionnaireResponses,
          questionnaireResponseMeta,
        },
        strictPersonalAuto ? questionnaireResponses : responses
      ),
      intent: "questionnaire_prefill",
    });
    summary = mapped.summary;
    mappedProviderError = mapped.providerError;
    mappedProviderErrorCode = mapped.providerErrorCode;
    const updatedAt = nowIso();
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    const strictQuestionsByKey = new Map(
      questions
        .map(
          (question) =>
            [
              compactQuestionnaireLookup(personalAutoQuestionKey(session, question) ?? ""),
              question,
            ] as const
        )
        .filter(([key]) => Boolean(key))
    );
    const mappingContext = {
      contactName: contactForQuotingSession(session)?.name,
      publicFields,
      address: quoteSessionAddressContext(session),
    };
    const appliedFieldKeys = new Set<string>();
    const applyOne = (
      fieldKey: string,
      value: unknown,
      targetId?: string,
      mapping?: AiAcordFieldMapping
    ) => {
      const directQuestion =
        (targetId && questionsById.has(targetId) ? questionsById.get(targetId) : undefined) ??
        (strictPersonalAuto
          ? strictQuestionsByKey.get(compactQuestionnaireLookup(fieldKey))
          : undefined);
      if (targetId && !directQuestion) return false;
      if (strictPersonalAuto && !directQuestion) return false;
      const strictQuestionKey = directQuestion
        ? personalAutoQuestionKey(session, directQuestion)
        : undefined;
      if (
        strictPersonalAuto &&
        (!strictQuestionKey || !PERSONAL_AUTO_PUBLIC_RESEARCH_KEYS.has(strictQuestionKey))
      ) {
        return false;
      }
      const evidence =
        findAiPublicEvidence(mapped.publicFieldEvidence, fieldKey) ??
        (targetId ? findAiPublicEvidence(mapped.publicFieldEvidence, targetId) : undefined) ??
        (directQuestion ? questionnaireEvidenceFromMapping(mapping, fieldKey, updatedAt) : undefined);
      if (!evidence || !aiEvidenceAllowsQuestionnairePrefill(evidence)) return false;
      const compatibilityKey = strictQuestionKey ??
        (directQuestion
        ? compatibleQuestionnaireMappingKey(directQuestion, fieldKey, value, mappingContext) ??
          (questionnaireAnswerLooksCompatible(directQuestion, value) ? directQuestion.label : null)
        : fieldKey);
      if (!compatibilityKey) return false;
      if (!mappedFieldValueIsCompatible(compatibilityKey, value, mappingContext)) return false;
      const question =
        directQuestion ??
        questions.find((candidate) => {
          const entry = questionnaireRecordEntryFor(candidate, { [fieldKey]: value });
          return entry
            ? questionRecordEntryIsCompatible(candidate, entry.key, entry.value)
            : false;
        });
      if (!question) return false;
      if (
        targetId &&
        directQuestion &&
        !questionRecordEntryIsCompatible(
          question,
          compatibilityKey,
          cleanQuestionnairePrefillValue(value)
        )
      ) {
        return false;
      }
      const cleanedValue =
        canonicalQuestionnaireOptionAnswer(question, value) ??
        cleanQuestionnairePrefillValue(value);
      if (!cleanedValue) return false;
      if (!questionnaireAnswerLooksConcreteForAiPrefill(question, cleanedValue)) return false;
      const existingAnswer = cleanQuestionnairePrefillValue(questionnaireResponses[question.id]);
      const existingMeta = questionnaireResponseMeta[question.id];
      if (existingAnswer && existingMeta?.updatedByRole !== "ai") return false;
      const existingEvidence =
        findAiPublicEvidence(publicFieldEvidence, compatibilityKey) ??
        findAiPublicEvidence(publicFieldEvidence, question.label);
      const canReplaceEstimateOnlyAnswer =
        !!existingAnswer &&
        questionnaireResponseMeta[question.id]?.updatedByRole === "ai" &&
        existingEvidence?.sourceKind === "model_estimate" &&
        evidence.sourceKind !== "model_estimate" &&
        aiEvidenceAllowsQuestionnairePrefill(evidence);
      const canReplaceEstimateOnlyPublicField =
        existingEvidence?.sourceKind === "model_estimate" && evidence.sourceKind !== "model_estimate";
      if (existingAnswer && !canReplaceEstimateOnlyAnswer) return false;
      questionnaireResponses[question.id] = cleanedValue;
      const acceptedEvidence = {
        ...evidence,
        collectedAt: evidence.collectedAt || updatedAt,
      };
      questionnaireResponseMeta[question.id] = questionnaireResponseAiMetaFor(updatedAt, acceptedEvidence);
      if (!publicFields[fieldKey] || canReplaceEstimateOnlyAnswer || canReplaceEstimateOnlyPublicField) {
        publicFields[fieldKey] = cleanedValue;
        publicFieldEvidence[fieldKey] = acceptedEvidence;
      }
      if (
        directQuestion &&
        (!publicFields[question.label] ||
          canReplaceEstimateOnlyAnswer ||
          canReplaceEstimateOnlyPublicField ||
          !aiEvidenceAllowsQuestionnairePrefill(findAiPublicEvidence(publicFieldEvidence, question.label)))
      ) {
        publicFields[question.label] = cleanedValue;
        publicFieldEvidence[question.label] = {
          ...acceptedEvidence,
          fieldKey: question.label,
        };
      }
      questionnaireAddedCount += 1;
      appliedFieldKeys.add(fieldKey);
      return true;
    };

    for (const mapping of mapped.mappings ?? []) {
      applyOne(mapping.targetField, mapping.value, mapping.targetId, mapping);
    }
    for (const [fieldKey, value] of Object.entries(mapped.fields)) {
      if (appliedFieldKeys.has(fieldKey)) continue;
      applyOne(fieldKey, value);
    }
  } catch (error) {
    summary =
      error instanceof Error
        ? `OpenAI research could not complete: ${error.message}`
        : "OpenAI research could not complete.";
    mappedProviderError = error instanceof Error ? error.message : "OpenAI research could not complete.";
    mappedProviderErrorCode = aiProviderErrorCodeFromCaught(error);
  }

  const now = nowIso();
  const seeded = mergeSeededQuestionnaireResponses({
    session: {
      ...session,
      publicFields,
      publicFieldEvidence,
      questionnaireResponses,
      questionnaireResponseMeta,
      updatedAt: now,
    },
    questions,
    contactName: contact?.name,
    contactEmail: contact?.email,
    contactPhone: contact?.phone,
    businessName: contact && "businessName" in contact ? contact.businessName : undefined,
    address: quoteSessionAddressContext({ ...session, publicFields }),
    estimatedValue: session.estimatedValue,
    assetDetails: session.assetDetails,
    publicFields,
    publicFieldEvidence,
    updatedAt: now,
  });
  questionnaireResponses = seeded.questionnaireResponses;
  questionnaireResponseMeta = seeded.questionnaireResponseMeta;
  const finalAddedCount = questions.filter(
    (question) =>
      !cleanQuestionnairePrefillValue(session.questionnaireResponses?.[question.id]) &&
      !!cleanQuestionnairePrefillValue(questionnaireResponses[question.id])
  ).length;
  const responsesChanged = questions.some(
    (question) =>
      cleanQuestionnairePrefillValue(session.questionnaireResponses?.[question.id]) !==
      cleanQuestionnairePrefillValue(questionnaireResponses[question.id])
  );
  const missingFields = questions
    .filter((question) => question.required && !questionnaireResponses[question.id]?.trim())
    .map((question) => question.label);
  const missingFieldsChanged =
    session.missingFields.length !== missingFields.length ||
    session.missingFields.some((field, index) => field !== missingFields[index]);
  const mappingStatusChanged = !!summary && !session.aiSummary?.includes(summary);
  const providerStatusChanged =
    (session.aiProviderError ?? "") !== (mappedProviderError ?? "") ||
    (session.aiProviderErrorCode ?? "") !== (mappedProviderErrorCode ?? "");
  if (
    !responsesChanged &&
    !missingFieldsChanged &&
    questionnaireAddedCount === 0 &&
    !mappingStatusChanged &&
    !providerStatusChanged
  ) {
    return session;
  }
  const mappingResultLine =
    finalAddedCount > 0
      ? `OpenAI research prefilled ${finalAddedCount} editable questionnaire answer${
          finalAddedCount === 1 ? "" : "s"
        } for review.`
      : mappingStatusChanged
        ? "OpenAI research did not add any editable questionnaire answers."
        : "";
  return (
    db.update("quotingSessions", session.id, {
      publicFields,
      publicFieldEvidence,
      questionnaireResponses,
      questionnaireResponseMeta,
      missingFields,
      aiSummary: [
        session.aiSummary,
        mappingResultLine,
        summary,
      ]
        .filter(Boolean)
        .join(" "),
      aiProviderError: mappedProviderError,
      aiProviderErrorCode: mappedProviderErrorCode,
      updatedAt: now,
    }) ?? {
      ...session,
      publicFields,
      publicFieldEvidence,
      questionnaireResponses,
      questionnaireResponseMeta,
      missingFields,
      aiProviderError: mappedProviderError,
      aiProviderErrorCode: mappedProviderErrorCode,
      updatedAt: now,
    }
  );
}

async function applyServerAcordMappingToCommercialSession(
  session: QuotingSession,
  responses: Record<string, string> = {}
): Promise<QuotingSession> {
  const templates = session.commercialAcordTemplates ?? [];
  if (session.lineOfBusiness !== "commercial") return session;
  const questionnaireQuestionsForMapping = initialCommercialQuestionnaireQuestions(session);
  const questionnaireFields = questionnaireAiFieldsForSession(session);
  if (templates.length === 0 && questionnaireFields.length === 0) return session;
  const publicFields: Record<string, unknown> = { ...(session.publicFields ?? {}) };
  const publicFieldEvidence: PublicDataEvidenceMap = { ...(session.publicFieldEvidence ?? {}) };
  const questionnaireResponses: Record<string, string> = {
    ...(session.questionnaireResponses ?? {}),
  };
  const questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta> = {
    ...(session.questionnaireResponseMeta ?? {}),
  };
  const summaries: string[] = [];
  let addedCount = 0;
  let questionnaireAddedCount = 0;
  let mappedProviderError: string | undefined;
  let mappedProviderErrorCode: string | undefined;
  const recordProviderFailure = (mapped: Awaited<ReturnType<typeof aiMapAcordFields>>) => {
    if (!mapped.providerError) return;
    mappedProviderError = mapped.providerError;
    mappedProviderErrorCode = mapped.providerErrorCode || "provider_unavailable";
    if (mapped.summary) summaries.push(mapped.summary);
  };
  const applyQuestionnaireMappedResult = (
    mapped: Awaited<ReturnType<typeof aiMapAcordFields>>,
    questions: QuotingQuestion[]
  ) => {
    const updatedAt = nowIso();
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    const appliedFieldKeys = new Set<string>();
    const mappingContext = {
      contactName: (session as { contactName?: string }).contactName,
      publicFields,
      address: (session as { address?: string }).address,
    };
    const applyOne = (
      fieldKey: string,
      value: unknown,
      targetId?: string,
      mapping?: AiAcordFieldMapping
    ) => {
      const directQuestion =
        targetId && questionsById.has(targetId) ? questionsById.get(targetId) : undefined;
      const evidence =
        findAiPublicEvidence(mapped.publicFieldEvidence, fieldKey) ??
        (directQuestion ? questionnaireEvidenceFromMapping(mapping, fieldKey, updatedAt) : undefined);
      if (!evidence || !aiEvidenceAllowsQuestionnairePrefill(evidence)) return false;
      const compatibilityKey = directQuestion
        ? compatibleQuestionnaireMappingKey(directQuestion, fieldKey, value, mappingContext) ??
          (questionnaireAnswerLooksCompatible(directQuestion, value) ? directQuestion.label : null)
        : fieldKey;
      if (!compatibilityKey) return false;
      if (!mappedFieldValueIsCompatible(compatibilityKey, value, mappingContext)) return false;
      const question =
        directQuestion ??
        questions.find((candidate) => {
          const entry = questionnaireRecordEntryFor(candidate, { [fieldKey]: value });
          return entry
            ? questionRecordEntryIsCompatible(candidate, entry.key, entry.value)
            : false;
        });
      if (!question) return false;
      if (targetId && directQuestion && !questionRecordEntryIsCompatible(question, compatibilityKey, cleanQuestionnairePrefillValue(value))) {
        return false;
      }
      const cleanedValue = cleanQuestionnairePrefillValue(value);
      if (!cleanedValue) return false;
      if (!questionnaireAnswerLooksConcreteForAiPrefill(question, cleanedValue)) return false;
      if (questionnaireResponses[question.id]?.trim()) return false;
      questionnaireResponses[question.id] = cleanedValue;
      const acceptedEvidence = {
        ...evidence,
        collectedAt: evidence.collectedAt || updatedAt,
      };
      questionnaireResponseMeta[question.id] = questionnaireResponseAiMetaFor(updatedAt, acceptedEvidence);
      if (!publicFields[fieldKey]) {
        publicFields[fieldKey] = value;
        publicFieldEvidence[fieldKey] = acceptedEvidence;
      }
      if (
        directQuestion &&
        (!publicFields[question.label] ||
          !aiEvidenceAllowsQuestionnairePrefill(findAiPublicEvidence(publicFieldEvidence, question.label)))
      ) {
        publicFields[question.label] = cleanedValue;
        publicFieldEvidence[question.label] = {
          ...acceptedEvidence,
          fieldKey: question.label,
        };
      }
      questionnaireAddedCount += 1;
      appliedFieldKeys.add(fieldKey);
      return true;
    };

    for (const mapping of mapped.mappings ?? []) {
      applyOne(mapping.targetField, mapping.value, mapping.targetId, mapping);
    }
    for (const [fieldKey, value] of Object.entries(mapped.fields)) {
      if (appliedFieldKeys.has(fieldKey)) continue;
      applyOne(fieldKey, value);
    }
  };
  const applyMappedResult = (mapped: Awaited<ReturnType<typeof aiMapAcordFields>>) => {
    if (mapped.summary) summaries.push(mapped.summary);
    const mappingContext = {
      contactName: (session as { contactName?: string }).contactName,
      publicFields,
      address: (session as { address?: string }).address,
    };
    for (const [fieldKey, value] of Object.entries(mapped.fields)) {
      const evidence = findAiPublicEvidence(mapped.publicFieldEvidence, fieldKey);
      if (!evidence || !aiEvidenceAllowsDocumentAutofill(evidence)) continue;
      if (!mappedFieldValueIsCompatible(fieldKey, value, mappingContext)) continue;
      const existingEvidence = findAiPublicEvidence(publicFieldEvidence, fieldKey);
      if (
        publicFields[fieldKey] &&
        existingEvidence &&
        aiEvidenceAllowsDocumentAutofill(existingEvidence)
      ) {
        continue;
      }
      publicFields[fieldKey] = value;
      publicFieldEvidence[fieldKey] = {
        ...evidence,
        collectedAt: evidence.collectedAt || nowIso(),
      };
      addedCount += 1;
    }
  };

  if (questionnaireFields.length > 0) {
    try {
      const mapped = await aiMapAcordFields({
        tenantId: session.tenantId,
        template: {
          documentName: "Commercial questionnaire",
          fileName: "commercial-questionnaire",
          formNumber: "Commercial intake",
        },
        fields: questionnaireFields,
        dossier: compactAcordAiDossier(session, responses),
        intent: "questionnaire_prefill",
      });
      recordProviderFailure(mapped);
      applyQuestionnaireMappedResult(mapped, questionnaireQuestionsForMapping);
      applyMappedResult(mapped);
    } catch (error) {
      mappedProviderError =
        error instanceof Error ? error.message : "OpenAI research could not complete questionnaire prefill.";
      mappedProviderErrorCode = aiProviderErrorCodeFromCaught(error);
      summaries.push(`OpenAI research could not complete questionnaire prefill: ${mappedProviderError}`);
    }
  }

  for (const template of templates) {
    const templateDocument = db.list("documents").find((document) => document.id === template.templateId);
    const fields = acordAiFieldsForTemplate(template, templateDocument);
    if (fields.length === 0) continue;
    try {
      const mapped = await aiMapAcordFields({
        tenantId: session.tenantId,
        template: {
          documentName: template.documentName,
          fileName: template.fileName,
          formNumber: template.formNumber,
        },
        fields,
        dossier: compactAcordAiDossier(session, responses, templateDocument),
      });
      recordProviderFailure(mapped);
      applyMappedResult(mapped);
    } catch (error) {
      mappedProviderError =
        error instanceof Error ? error.message : "OpenAI-backed ACORD mapping could not complete.";
      mappedProviderErrorCode = aiProviderErrorCodeFromCaught(error);
      summaries.push(`OpenAI-backed ACORD mapping could not complete: ${mappedProviderError}`);
    }
  }
  const providerStatusChanged =
    (session.aiProviderError ?? "") !== (mappedProviderError ?? "") ||
    (session.aiProviderErrorCode ?? "") !== (mappedProviderErrorCode ?? "");
  if (addedCount === 0 && questionnaireAddedCount === 0 && !providerStatusChanged) return session;
  const now = nowIso();
  const uniqueSummaries = Array.from(new Set(summaries)).slice(0, 4);
  return (
    db.update("quotingSessions", session.id, {
      publicFields,
      publicFieldEvidence,
      questionnaireResponses,
      questionnaireResponseMeta,
      aiSummary: [
        session.aiSummary,
        addedCount > 0
          ? `Server-side ACORD AI mapping added ${addedCount} verified document field${
              addedCount === 1 ? "" : "s"
            }.`
          : "",
        questionnaireAddedCount > 0
          ? `OpenAI research prefilled ${questionnaireAddedCount} editable questionnaire answer${
              questionnaireAddedCount === 1 ? "" : "s"
            } for review.`
          : "",
        ...uniqueSummaries,
      ]
        .filter(Boolean)
        .join(" "),
      aiProviderError: mappedProviderError,
      aiProviderErrorCode: mappedProviderErrorCode,
      updatedAt: now,
    }) ?? {
      ...session,
      publicFields,
      publicFieldEvidence,
      questionnaireResponses,
      questionnaireResponseMeta,
      aiProviderError: mappedProviderError,
      aiProviderErrorCode: mappedProviderErrorCode,
      updatedAt: now,
    }
  );
}

function completedAcordTemplateFields(
  template: CommercialAcordTemplateSelection,
  session: QuotingSession,
  responses: Record<string, string>,
  kind: "application" | "supplemental"
): {
  fields: TemplateFieldMap;
  mappings: NonNullable<CommunicationAttachment["fieldMappings"]>;
  missingFieldLabels: string[];
  contactName: string;
  audit: {
    sourceCount: number;
    candidateCount: number;
    fittedFieldCount: number;
    overflowFieldCount: number;
    sourcesUsed: string[];
    sourceFieldCounts: Record<string, number>;
  };
} {
  const contact = contactForQuotingSession(session);
  const templateDocument = db.list("documents").find((document) => document.id === template.templateId);
  const sourceArtifact = completedAcordSourceArtifact(template, templateDocument);
  const contactName = contact?.name ?? "Commercial applicant";
  const filled = fillAcordFromClientDossier({
    template,
    dossier: clientAcordFillDossier(session, responses, templateDocument),
    layout: sourceArtifact.templateFieldLayout,
    kind,
  });
  return {
    fields: {
      ...filled.fields,
      "Source ACORD template ID": template.templateId,
      "Source ACORD file": template.fileName,
      "Source ACORD layout fields": String(sourceArtifact.templateFieldLayout?.length ?? 0),
      "Completed packet type": kind === "application" ? "Carrier application" : "Carrier supplemental",
      "Completed by": "Quotex AI fill workflow",
      "Completed field count": String(filled.mappings.length),
      "Missing field count": String(filled.missingFieldLabels.length),
      "Missing fields": filled.missingFieldLabels.join("; "),
      "AI dossier source count": String(filled.audit.sourceCount),
      "AI candidate field count": String(filled.audit.candidateCount),
      "AI fitted PDF field count": String(filled.audit.fittedFieldCount),
      "AI overflow field count": String(filled.audit.overflowFieldCount),
      "AI sources used": filled.audit.sourcesUsed.join(", "),
      "AI source field counts": formatAcordSourceFieldCounts(filled.audit.sourceFieldCounts),
      "ACORD PDF fill status":
        filled.missingFieldLabels.length > 0
          ? "Partially filled from the full client dossier and questionnaire data"
          : "Filled from the full client dossier and questionnaire data",
      "Last filled at": nowIso(),
    },
    mappings: filled.mappings,
    missingFieldLabels: filled.missingFieldLabels,
    contactName,
    audit: filled.audit,
  };
}

function formatAcordSourceFieldCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${source.replace(/_/g, " ")}: ${count}`)
    .join("; ");
}

function completedAcordSourceArtifact(
  template: CommercialAcordTemplateSelection,
  templateDocument?: Document
): Pick<Document, "storagePath" | "downloadUrl" | "templateFieldLayout" | "fillableDetection"> {
  const detected = detectFillableDocumentFields({
    fileName: templateDocument?.fileName ?? template.fileName,
    fileType: templateDocument?.fileType ?? "application/pdf",
    type: String(templateDocument?.type ?? template.type ?? "agency_template"),
    documentName: templateDocument?.documentName ?? template.documentName,
    baseFields: templateDocument?.templateFields,
  });
  return {
    storagePath: templateDocument?.storagePath ?? template.storagePath ?? `/acord/${template.fileName}`,
    downloadUrl: templateDocument?.downloadUrl ?? template.downloadUrl ?? `/acord/${template.fileName}`,
    templateFieldLayout:
      templateDocument?.templateFieldLayout && templateDocument.templateFieldLayout.length > 0
        ? templateDocument.templateFieldLayout
        : detected.templateFieldLayout,
    fillableDetection: templateDocument?.fillableDetection ?? detected.detection,
  };
}

function knownAcordFieldsForTemplate(
  template: CommercialAcordTemplateSelection,
  session: QuotingSession,
  responses: Record<string, string> = {},
  kind: "application" | "supplemental" = "application"
): TemplateFieldMap {
  const templateDocument = db.list("documents").find((document) => document.id === template.templateId);
  const sourceArtifact = completedAcordSourceArtifact(template, templateDocument);
  return fillAcordFromClientDossier({
    template,
    dossier: clientAcordFillDossier(session, responses, templateDocument),
    layout: sourceArtifact.templateFieldLayout,
    kind,
  }).fields;
}

function knownAcordFieldsByTemplateId(
  templates: CommercialAcordTemplateSelection[],
  session: QuotingSession,
  responses: Record<string, string> = {},
  kind: "application" | "supplemental" = "application"
): Record<string, TemplateFieldMap> {
  return Object.fromEntries(
    templates.map((template) => [
      template.templateId,
      knownAcordFieldsForTemplate(template, session, responses, kind),
    ])
  );
}

function upsertCompletedAcordDocument(
  template: CommercialAcordTemplateSelection,
  session: QuotingSession,
  responses: Record<string, string>,
  kind: "application" | "supplemental"
): Document {
  const templateDocument = db.list("documents").find((document) => document.id === template.templateId);
  const sourceArtifact = completedAcordSourceArtifact(template, templateDocument);
  const completed = completedAcordTemplateFields(template, session, responses, kind);
  const existing = db
    .list("documents")
    .find(
      (document) =>
        document.tenantId === session.tenantId &&
        document.quoteRequestId === session.id &&
        document.type ===
          (kind === "application"
            ? "completed_acord_application"
            : "completed_acord_supplemental") &&
        document.templateFields?.["Source ACORD template ID"] === template.templateId
    );
  if (existing) {
    const preserveGeneratedArtifact =
      existing.downloadUrl?.startsWith("data:application/pdf") &&
      sameCompletedAcordContent(existing.templateFields, completed.fields);
    return (
      api.documents.update(existing.id, {
        templateFields: preserveGeneratedArtifact
          ? { ...completed.fields, ...nativeAcordArtifactFields(existing.templateFields) }
          : completed.fields,
        templateFieldLayout: sourceArtifact.templateFieldLayout,
        fillableDetection: sourceArtifact.fillableDetection,
        storagePath: preserveGeneratedArtifact
          ? existing.storagePath
          : sourceArtifact.storagePath,
        downloadUrl: preserveGeneratedArtifact
          ? existing.downloadUrl
          : sourceArtifact.downloadUrl,
        documentName: `Completed ${acordDefinitionForTemplate(template).title}`,
      }) ?? existing
    );
  }
  return api.documents.create({
    tenantId: session.tenantId,
    uploadedById: session.createdById,
    fileName: completedAcordFileName(template, completed.contactName, kind),
    fileType: "application/pdf",
    documentName: `Completed ${acordDefinitionForTemplate(template).title}`,
    type: kind === "application" ? "completed_acord_application" : "completed_acord_supplemental",
    visibility: "employee_only",
    status: "approved",
    customerId: session.customerId,
    quoteRequestId: session.id,
    lineOfBusiness: "commercial",
    templateFields: completed.fields,
    templateFieldLayout: sourceArtifact.templateFieldLayout,
    fillableDetection: sourceArtifact.fillableDetection,
    storagePath: sourceArtifact.storagePath,
    downloadUrl: sourceArtifact.downloadUrl,
  });
}

const GENERATED_ACORD_META_FIELDS = new Set([
  "Last filled at",
  "Native PDF artifact",
  "Native PDF field count",
  "Native PDF filled field count",
  "Native PDF missing field count",
]);

function sameCompletedAcordContent(
  previous: TemplateFieldMap | undefined,
  next: TemplateFieldMap
): boolean {
  return stableCompletedAcordFields(previous).join("\n") === stableCompletedAcordFields(next).join("\n");
}

function stableCompletedAcordFields(fields: TemplateFieldMap | undefined): string[] {
  return Object.entries(fields ?? {})
    .filter(([key]) => !GENERATED_ACORD_META_FIELDS.has(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
}

function nativeAcordArtifactFields(fields: TemplateFieldMap | undefined): TemplateFieldMap {
  return Object.fromEntries(
    Object.entries(fields ?? {}).filter(([key]) => GENERATED_ACORD_META_FIELDS.has(key))
  );
}

function refreshedCommercialAcordTemplates(
  session: QuotingSession,
  responses: Record<string, string> = {}
): CommercialAcordTemplateSelection[] | undefined {
  const templates = session.commercialAcordTemplates;
  if (!templates || templates.length === 0) return templates;
  return templates.map((template) => {
    const completed = completedAcordTemplateFields(template, session, responses, "application");
    return {
      ...template,
      autoFilledFieldCount: completed.mappings.length,
      missingFieldCount: completed.missingFieldLabels.length,
      sourceCount: completed.audit.sourceCount,
      candidateCount: completed.audit.candidateCount,
      fittedFieldCount: completed.audit.fittedFieldCount,
      overflowFieldCount: completed.audit.overflowFieldCount,
      sourcesUsed: completed.audit.sourcesUsed,
      sourceFieldCounts: completed.audit.sourceFieldCounts,
    };
  });
}

function syncCommercialAcordPdfArtifacts(
  session: QuotingSession,
  responses: Record<string, string> = {},
  kind: "application" | "supplemental" = "application"
): CommercialAcordTemplateSelection[] | undefined {
  if (session.lineOfBusiness !== "commercial") return session.commercialAcordTemplates;
  const templates = session.commercialAcordTemplates;
  if (!templates || templates.length === 0) return templates;
  templates.forEach((template) => {
    upsertCompletedAcordDocument(template, session, responses, kind);
  });
  return refreshedCommercialAcordTemplates(session, responses);
}

function commercialAcordCommunicationAttachments(
  session: QuotingSession,
  kind: "application" | "supplemental",
  responses: Record<string, string> = {},
  options: { persistCompletedDocuments?: boolean } = {}
): CommunicationAttachment[] {
  const templates = session.commercialAcordTemplates ?? [];
  return templates.map((template) => {
    const completed = completedAcordTemplateFields(template, session, responses, kind);
    const persistedDocument = options.persistCompletedDocuments
      ? upsertCompletedAcordDocument(template, session, responses, kind)
      : null;
    return {
      id: `${kind}_${persistedDocument?.id ?? template.templateId}`,
      documentId: persistedDocument?.id ?? template.templateId,
      sourceDocumentId: template.templateId,
      fileName:
        persistedDocument?.fileName ??
        completedAcordFileName(template, completed.contactName, kind),
      fileType: "application/pdf",
      storagePath: persistedDocument?.storagePath ?? template.storagePath,
      dataUrl: persistedDocument?.downloadUrl?.startsWith("data:application/pdf")
        ? persistedDocument.downloadUrl
        : undefined,
      description:
        kind === "application"
          ? `Completed ${template.documentName || template.fileName} with ${completed.mappings.length} mapped ACORD field value${completed.mappings.length === 1 ? "" : "s"}.`
          : `Completed supplemental ${template.documentName || template.fileName} with ${completed.mappings.length} mapped ACORD field value${completed.mappings.length === 1 ? "" : "s"}.`,
      filledFieldCount: completed.mappings.length,
      filledFields: completed.fields,
      fieldMappings: completed.mappings,
    };
  });
}

function commercialApplicationBody(
  underwriterName: string,
  kind: "application" | "supplemental"
): string {
  const firstName = underwriterName.trim().split(/\s+/)[0] || "there";
  const packageLabel =
    kind === "application" ? "completed ACORD application PDF(s)" : "completed ACORD supplemental PDF(s)";
  return [
    `Hi ${firstName},`,
    ``,
    `Please find attached the ${packageLabel}.`,
    ``,
    kind === "application"
      ? `Please review the attached ACORD document(s) and let me know whether you can proceed or need any supplemental fields.`
      : `Please review the attached ACORD supplemental document(s) and let me know whether anything else is needed.`,
    ``,
    `Thank you,`,
  ]
    .join("\n");
}

function commercialSubmissionMessageId(
  submission: CommercialCarrierSubmission
): string | undefined {
  return submission.supplementalMessageIds?.[0] ?? submission.applicationMessageIds?.[0];
}

function commercialSubmissionDocumentId(
  submission: CommercialCarrierSubmission
): string | undefined {
  return submission.applicationDocumentIds?.[0] ?? submission.supplementalDocumentIds?.[0];
}

function uniqueStrings(values: (string | undefined | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

function commercialSubmissionStableId(session: QuotingSession, carrierId: string): string {
  return `commercial-submission-${session.id}-${carrierId}`;
}

function commercialSubmissionThreadId(
  session: QuotingSession,
  submissionId: string,
  kind: "application" | "supplemental"
): string {
  return `commercial:${session.tenantId}:${session.id}:${submissionId}:${kind}`;
}

function commercialSubmissionThreadIds(submission: CommercialCarrierSubmission): Set<string> {
  return new Set([
    ...(submission.applicationThreadIds ?? []),
    ...(submission.supplementalThreadIds ?? []),
  ]);
}

function commercialSubmissionExternalThreadIds(submission: CommercialCarrierSubmission): Set<string> {
  return new Set([
    ...(submission.applicationExternalThreadIds ?? []),
    ...(submission.supplementalExternalThreadIds ?? []),
  ]);
}

function currencyStringToNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\$?\s?([\d,]+(?:\.\d{2})?)/);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function carrierReplySentences(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function carrierReplyEvidence(text: string, patterns: RegExp[]): string[] {
  return carrierReplySentences(text)
    .filter((sentence) => patterns.some((pattern) => pattern.test(sentence)))
    .slice(0, 8);
}

function parseCommercialCarrierReplyFromCommunication(
  communication: Communication,
  submission: CommercialCarrierSubmission
): {
  quote: CommercialCarrierSubmissionQuote;
  status: CommercialCarrierSubmission["status"];
  premiumEstimate?: number;
  finalPremium?: number;
  declinedReason?: string;
  underwriterNotes?: string;
  missingFields?: string[];
  agentReviewReason?: string;
} {
  const parsedAt = nowIso();
  const text = [
    communication.subject ?? "",
    communication.body,
    communication.bodyHtml ?? "",
    ...(communication.attachments ?? []).map((attachment) =>
      [attachment.fileName, attachment.description].filter(Boolean).join(" ")
    ),
  ].join("\n");
  const attachmentIds = (communication.attachments ?? [])
    .filter(
      (attachment) =>
        /\.pdf$/i.test(attachment.fileName) ||
        /pdf/i.test(attachment.fileType) ||
        /supplement/i.test(attachment.fileName)
    )
    .map((attachment) => attachment.id);
  const premiums = uniqueStrings(
    text.match(/\$\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:annual|annually|year|yr|premium))?/gi) ?? []
  ).slice(0, 8);
  const limits = uniqueStrings(
    text.match(/\$?\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:limit|coverage|occurrence|aggregate))/gi) ?? []
  ).slice(0, 8);
  const deductibles = uniqueStrings(
    text.match(/\$?\s?\d[\d,]*(?:\.\d{2})?(?:\s?(?:deductible|ded))/gi) ?? []
  ).slice(0, 8);
  const declineEvidence = carrierReplyEvidence(text, [
    /\bdeclin(?:e|ed|ing)\b/i,
    /\bno appetite\b/i,
    /\bunable to quote\b/i,
    /\bcannot quote\b/i,
    /\bnot able to offer\b/i,
  ]);
  const moreInfoEvidence = carrierReplyEvidence(text, [
    /\bsupplemental\b/i,
    /\bmore information\b/i,
    /\badditional information\b/i,
    /\bneed(?:ed|s)?\b/i,
    /\brequir(?:e|ed|es)\b/i,
  ]);
  const quoteEvidence = carrierReplyEvidence(text, [
    /\bquote\b/i,
    /\bpremium\b/i,
    /\bindication\b/i,
    /\bproposal\b/i,
    /\bbind(?:able|ing)?\b/i,
  ]);
  const approvalEvidence = carrierReplyEvidence(text, [
    /\bapprov(?:e|ed|al)\b/i,
    /\bcan proceed\b/i,
    /\bwe can consider\b/i,
    /\baccepted\b/i,
    /\bappetite\b/i,
  ]);
  const bindingConditionEvidence = carrierReplyEvidence(text, [
    /\brequired prior to bind(?:ing)?\b/i,
    /\bsubject to\b/i,
    /\bto bind\b/i,
    /\bbinding (?:condition|requirement|subjectiv)/i,
    /\bcoverage is not bound\b/i,
  ]);
  const preQuoteInformationEvidence = moreInfoEvidence.filter(
    (line) => !bindingConditionEvidence.includes(line)
  );
  const requestedItems = preQuoteInformationEvidence
    .map((line) => line.replace(/^(please|we|carrier|underwriter)\s+/i, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, 8);
  const nextSteps = carrierReplyEvidence(text, [
    /\bnext step\b/i,
    /\bsubject to\b/i,
    /\bunderwriting\b/i,
    /\bsignature\b/i,
  ]);
  const firstPremium = currencyStringToNumber(premiums[0]);

  if (declineEvidence.length > 0) {
    return {
      status: "declined",
      declinedReason: declineEvidence[0],
      underwriterNotes: declineEvidence.join(" "),
      quote: {
        outcome: "declined",
        parsedAt,
        confidence: 0.84,
        declineReason: declineEvidence[0],
        evidenceSnippets: declineEvidence,
      } as CommercialCarrierSubmissionQuote,
    };
  }

  // A carrier can approve and price a risk while listing subjectivities that
  // must be satisfied before binding. Those are quote conditions, not a
  // request for missing underwriting data and must not reopen the questionnaire.
  if (premiums.length > 0 && (approvalEvidence.length > 0 || quoteEvidence.length > 0)) {
    const acceptedEvidence = uniqueStrings([...approvalEvidence, ...quoteEvidence]);
    return {
      status: "accepted",
      premiumEstimate: firstPremium,
      finalPremium: firstPremium,
      underwriterNotes: uniqueStrings([...acceptedEvidence, ...bindingConditionEvidence]).join(" "),
      quote: {
        outcome: "quoted",
        premiums,
        limits,
        deductibles,
        carrierNotes: acceptedEvidence,
        nextSteps: uniqueStrings([...bindingConditionEvidence, ...nextSteps]),
        evidenceSnippets: uniqueStrings([...acceptedEvidence, ...bindingConditionEvidence]),
        parsedAt,
        confidence: approvalEvidence.length > 0 ? 0.92 : 0.8,
      },
    };
  }

  if (attachmentIds.length > 0 || requestedItems.length > 0) {
    const missingFields =
      requestedItems.length > 0
        ? requestedItems
        : (communication.attachments ?? [])
            .filter((attachment) => attachmentIds.includes(attachment.id))
            .map((attachment) => `Complete ${attachment.fileName}`);
    return {
      status: attachmentIds.length > 0 ? "needs_supplemental" : "needs_client_info",
      premiumEstimate: firstPremium,
      underwriterNotes: uniqueStrings([...moreInfoEvidence, ...quoteEvidence]).join(" "),
      missingFields,
      quote: {
        outcome: "more_info_required",
        premiums,
        limits,
        deductibles,
        requestedItems: missingFields,
        supplementalAttachmentIds: attachmentIds,
        carrierNotes: quoteEvidence,
        nextSteps,
        evidenceSnippets: uniqueStrings([...moreInfoEvidence, ...quoteEvidence]),
        parsedAt,
        confidence: attachmentIds.length > 0 ? 0.82 : 0.74,
      },
    };
  }

  if (approvalEvidence.length > 0) {
    return {
      status: "accepted",
      underwriterNotes: approvalEvidence.join(" "),
      quote: {
        outcome: "accepted",
        carrierNotes: approvalEvidence,
        evidenceSnippets: approvalEvidence,
        parsedAt,
        confidence: 0.74,
      },
    };
  }

  return {
    status: "agent_review",
    agentReviewReason:
      "Carrier reply did not clearly state quote, decline, or supplemental outcome.",
    underwriterNotes: carrierReplySentences(text).slice(0, 4).join(" "),
    quote: {
      outcome: "pending",
      premiums,
      limits,
      deductibles,
      evidenceSnippets: carrierReplySentences(text).slice(0, 4),
      parsedAt,
      confidence: 0.42,
    },
  };
}

const carrierReplyProcessingInFlight = new Set<string>();

async function parseCommercialCarrierReplyWithAi(
  communication: Communication,
  submission: CommercialCarrierSubmission
): Promise<ReturnType<typeof parseCommercialCarrierReplyFromCommunication>> {
  const attachmentIdsByName = new Map(
    (communication.attachments ?? []).map((attachment) => [attachment.fileName.toLowerCase(), attachment.id])
  );
  const parsed = await aiParseCarrierReply({
    submission: {
      submissionId: submission.submissionId,
      carrierId: submission.carrierId,
      status: submission.status,
      policyType: submission.quote?.policyType,
    },
    email: {
      subject: communication.subject,
      text: communication.body,
      html: communication.bodyHtml,
      attachments: (communication.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        description: attachment.description,
      })),
    },
  });
  const parsedAt = nowIso();
  const supplementalAttachmentIds = uniqueStrings([
    ...(communication.attachments ?? [])
      .filter((attachment) =>
        /pdf|supplement|application|questionnaire|loss.?run/i.test(
          `${attachment.fileName} ${attachment.fileType} ${attachment.description ?? ""}`
        )
      )
      .map((attachment) => attachment.id),
    ...parsed.supplementalAttachmentNames.map((name) => attachmentIdsByName.get(name.toLowerCase())),
  ]);
  const requiresReview = parsed.requiresAgentReview || parsed.confidence < 0.72;
  const status: CommercialCarrierSubmission["status"] = requiresReview
    ? "agent_review"
    : parsed.outcome === "declined"
    ? "declined"
    : parsed.outcome === "more_info_required"
    ? supplementalAttachmentIds.length > 0
      ? "needs_supplemental"
      : "needs_client_info"
    : parsed.outcome === "accepted" || parsed.outcome === "quoted"
    ? "accepted"
    : "agent_review";
  const firstPremium = currencyStringToNumber(parsed.premiums[0]);
  const missingFields =
    parsed.requestedItems.length > 0
      ? parsed.requestedItems
      : status === "needs_supplemental"
      ? (communication.attachments ?? [])
          .filter((attachment) => supplementalAttachmentIds.includes(attachment.id))
          .map((attachment) => `Complete ${attachment.fileName}`)
      : undefined;
  return {
    status,
    premiumEstimate: firstPremium,
    finalPremium: status === "accepted" ? firstPremium : undefined,
    declinedReason: parsed.declineReason,
    underwriterNotes: uniqueStrings([
      ...parsed.carrierNotes,
      ...parsed.conditions,
      ...parsed.nextSteps,
    ]).join(" "),
    missingFields,
    agentReviewReason:
      status === "agent_review"
        ? parsed.agentReviewReason ?? "Carrier reply requires agent review before the workflow advances."
        : undefined,
    quote: {
      outcome: parsed.outcome,
      policyType: parsed.policyType,
      coverages: parsed.coverages,
      limits: parsed.limits,
      premiums: parsed.premiums,
      deductibles: parsed.deductibles,
      terms: parsed.terms,
      carrierNotes: parsed.carrierNotes,
      conditions: parsed.conditions,
      nextSteps: parsed.nextSteps,
      requestedItems: parsed.requestedItems,
      supplementalAttachmentIds,
      declineReason: parsed.declineReason,
      evidenceSnippets: parsed.evidenceSnippets,
      responseDeadline: parsed.responseDeadline,
      parsedAt,
      confidence: parsed.confidence,
    },
  };
}

function commercialCarrierReplyQuestions(
  submission: CommercialCarrierSubmission,
  carrierName: string
): QuotingQuestion[] {
  return (submission.missingFields ?? [])
    .filter((label) => label.trim().length > 0)
    .map((label) => ({
      id: `second-${submission.carrierId}-${fieldSlug(label)}`,
      section: "Carrier supplemental details",
      label: label.replace(`${carrierName}: `, ""),
      kind: /details|describe|explain|summary|operations|litigation|locations|supplement/i.test(label)
        ? "textarea"
        : /number|count|employees|vehicles|sq ft|revenue|payroll|premium|limit/i.test(label)
        ? "number"
        : "text",
      required: true,
      round: "second_round",
      carrierId: submission.carrierId,
    }));
}

type CommercialSubmissionMatchReason =
  | "carrier_submission_id"
  | "thread_id"
  | "external_thread_id"
  | "rfc822_reply_chain"
  | "known_underwriter_subject"
  | "literal_submission_id";

function normalizeMailIdentifier(value: string | undefined): string {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function normalizeReplySubject(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function commercialSubmissionMessageIdentifiers(
  submission: CommercialCarrierSubmission
): Set<string> {
  const messageIds = uniqueStrings([
    ...(submission.applicationMessageIds ?? []),
    ...(submission.supplementalMessageIds ?? []),
  ]);
  const messages = db.list("communications").filter((row) => messageIds.includes(row.id));
  return new Set(
    messages
      .flatMap((row) => [row.rfc822MessageId, row.messageIdHeader, row.externalMessageId])
      .map(normalizeMailIdentifier)
      .filter(Boolean)
  );
}

function commercialSubmissionMatchReason(
  session: QuotingSession,
  submission: CommercialCarrierSubmission,
  communication: Communication
): CommercialSubmissionMatchReason | null {
  const submissionId =
    submission.submissionId ?? commercialSubmissionStableId(session, submission.carrierId);
  if (communication.carrierSubmissionId === submissionId) return "carrier_submission_id";
  if (communication.threadId && commercialSubmissionThreadIds(submission).has(communication.threadId)) {
    return "thread_id";
  }
  if (
    communication.externalThreadId &&
    commercialSubmissionExternalThreadIds(submission).has(communication.externalThreadId)
  ) {
    return "external_thread_id";
  }
  const knownMessageIds = commercialSubmissionMessageIdentifiers(submission);
  const replyChainIds = uniqueStrings([
    communication.inReplyToHeader,
    ...(communication.references ?? []),
  ]).map(normalizeMailIdentifier);
  if (replyChainIds.some((id) => knownMessageIds.has(id))) {
    return "rfc822_reply_chain";
  }
  const knownUnderwriter = Boolean(
    communication.carrierContactId &&
      (submission.underwriterContactIds ?? []).includes(communication.carrierContactId)
  );
  const replySubject = normalizeReplySubject(communication.subject);
  if (knownUnderwriter && replySubject) {
    const messageIds = uniqueStrings([
      ...(submission.applicationMessageIds ?? []),
      ...(submission.supplementalMessageIds ?? []),
    ]);
    const subjectMatches = db
      .list("communications")
      .filter((row) => messageIds.includes(row.id))
      .some((row) => normalizeReplySubject(row.subject) === replySubject);
    if (subjectMatches) return "known_underwriter_subject";
  }
  const haystack = [communication.subject ?? "", communication.body].join(" ").toLowerCase();
  if (haystack.includes(submissionId.toLowerCase())) return "literal_submission_id";
  return null;
}

function communicationMatchesCommercialSubmission(
  session: QuotingSession,
  submission: CommercialCarrierSubmission,
  communication: Communication
): boolean {
  return commercialSubmissionMatchReason(session, submission, communication) !== null;
}

function linkInboundCarrierCommunicationToSubmission(row: Communication): Communication {
  if (row.direction !== "inbound") return row;
  const sessions = db
    .list("quotingSessions")
    .filter(
      (session) =>
        session.tenantId === row.tenantId &&
        session.lineOfBusiness === "commercial" &&
        (session.commercialCarrierSubmissions?.length ?? 0) > 0
    );
  const matches = sessions.flatMap((session) =>
    (session.commercialCarrierSubmissions ?? []).flatMap((submission) =>
      commercialSubmissionMatchReason(session, submission, row)
        ? [{ session, submission }]
        : []
    )
  );
  if (matches.length === 1) {
    const { session, submission } = matches[0];
    const submissionId = submission.submissionId ?? commercialSubmissionStableId(session, submission.carrierId);
    return db.update("communications", row.id, { carrierSubmissionId: submissionId }) ?? row;
  }
  return row;
}

type CommercialSubmissionMatch = {
  session: QuotingSession;
  submission: CommercialCarrierSubmission;
  reason: CommercialSubmissionMatchReason;
};

function commercialSubmissionMatchesForCommunication(
  tenantId: string,
  communication: Communication
): CommercialSubmissionMatch[] {
  if (communication.tenantId !== tenantId || communication.direction !== "inbound") return [];
  return db
    .list("quotingSessions")
    .filter(
      (session) =>
        session.tenantId === tenantId &&
        session.lineOfBusiness === "commercial" &&
        (session.commercialCarrierSubmissions?.length ?? 0) > 0
    )
    .flatMap((session) =>
      (session.commercialCarrierSubmissions ?? []).flatMap((submission) => {
        const reason = commercialSubmissionMatchReason(session, submission, communication);
        return reason ? [{ session, submission, reason }] : [];
      })
    );
}

function manualReviewCandidatesForCommunication(
  tenantId: string,
  communication: Communication
): CommercialSubmissionMatch[] {
  if (!communication.carrierContactId) return [];
  return db
    .list("quotingSessions")
    .filter(
      (session) =>
        session.tenantId === tenantId &&
        session.lineOfBusiness === "commercial" &&
        (session.commercialCarrierSubmissions?.length ?? 0) > 0
    )
    .flatMap((session) =>
      (session.commercialCarrierSubmissions ?? [])
        .filter((submission) =>
          (submission.underwriterContactIds ?? []).includes(communication.carrierContactId ?? "")
        )
        .map((submission) => ({
          session,
          submission,
          reason: "literal_submission_id" as CommercialSubmissionMatchReason,
        }))
    );
}

function carrierEmailProcessingId(tenantId: string, communicationId: string): string {
  return `carrier_email_${tenantId}_${communicationId}`;
}

function upsertCarrierEmailProcessing(
  input: Omit<CarrierEmailProcessing, "id" | "createdAt" | "updatedAt">
): CarrierEmailProcessing {
  const existing = db
    .list("carrierEmailProcessing")
    .find(
      (row) =>
        row.tenantId === input.tenantId && row.communicationId === input.communicationId
    );
  const updatedAt = nowIso();
  if (existing) {
    return (
      db.update("carrierEmailProcessing", existing.id, {
        ...input,
        updatedAt,
      }) ?? existing
    );
  }
  const row: CarrierEmailProcessing = {
    ...input,
    id: carrierEmailProcessingId(input.tenantId, input.communicationId),
    createdAt: updatedAt,
    updatedAt,
  };
  db.insert("carrierEmailProcessing", row);
  return row;
}

type StagedCarrierSupplementals = {
  documentIds: string[];
  missingFields: string[];
  auditNotes: string[];
  resolvedLossRun: boolean;
};

function attachmentPdfSource(attachment: CommunicationAttachment): string | undefined {
  if (attachment.dataUrl) return attachment.dataUrl;
  const linkedDocument = attachment.documentId
    ? db.list("documents").find((document) => document.id === attachment.documentId)
    : undefined;
  return linkedDocument?.downloadUrl ?? linkedDocument?.storagePath ?? attachment.storagePath;
}

async function readPdfBytes(source: string | undefined): Promise<Uint8Array | null> {
  if (!source) return null;
  try {
    if (source.startsWith("data:")) {
      const comma = source.indexOf(",");
      if (comma < 0) return null;
      const metadata = source.slice(0, comma);
      const payload = source.slice(comma + 1);
      const binary = metadata.includes(";base64")
        ? globalThis.atob(payload)
        : decodeURIComponent(payload);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    if (!/^https?:\/\//i.test(source)) return null;
    const response = await fetch(source);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function stageCarrierRequestedSupplementals(input: {
  session: QuotingSession;
  submission: CommercialCarrierSubmission;
  communication: Communication;
  parsed: Awaited<ReturnType<typeof parseCommercialCarrierReplyWithAi>>;
}): Promise<StagedCarrierSupplementals> {
  if (
    input.parsed.status !== "needs_supplemental" &&
    input.parsed.status !== "needs_client_info"
  ) {
    return { documentIds: [], missingFields: [], auditNotes: [], resolvedLossRun: false };
  }
  const requestedIds = new Set(input.parsed.quote.supplementalAttachmentIds ?? []);
  const attachments = (input.communication.attachments ?? []).filter(
    (attachment) =>
      attachment.fileType === "application/pdf" &&
      (requestedIds.size === 0 || requestedIds.has(attachment.id))
  );
  const documentIds: string[] = [];
  const missingFields: string[] = [];
  const auditNotes: string[] = [];
  const updatedAttachments = [...(input.communication.attachments ?? [])];
  const requestedText = [
    ...(input.parsed.quote.requestedItems ?? []),
    ...(input.parsed.missingFields ?? []),
    input.communication.subject ?? "",
  ].join(" ");
  let resolvedLossRun = false;

  if (/\bloss[ -]?runs?\b/i.test(requestedText) && input.session.customerId) {
    const { buildLossRunReport, lossRunAttachment } = await import("./lossRuns");
    const report = buildLossRunReport(input.session.customerId);
    if (report) {
      const attachment = lossRunAttachment(report);
      const document = api.documents.create({
        tenantId: input.session.tenantId,
        uploadedById: input.session.createdById,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        documentName: attachment.description,
        type: "claim_document",
        visibility: "employee_only",
        status: "approved",
        customerId: input.session.customerId,
        quoteRequestId: input.session.id,
        lineOfBusiness: "commercial",
        storagePath: `generated://loss-run/${input.session.id}/${input.communication.id}`,
        templateFields: {
          "Source carrier email ID": input.communication.id,
          "Generated from recorded claims": String(report.rows.length),
          "Open claims": String(report.openCount),
          "Claims in review": String(report.inReviewCount),
          "Closed claims": String(report.closedCount),
          "Value sources": "QuoteX recorded claims, policies, carriers, and assets",
        },
      });
      documentIds.push(document.id);
      resolvedLossRun = true;
      auditNotes.push(
        `${attachment.fileName}: generated from ${report.rows.length} recorded claim${
          report.rows.length === 1 ? "" : "s"
        }; staged for agent review.`
      );
    }
  }

  for (const attachment of attachments) {
    const bytes = await readPdfBytes(attachmentPdfSource(attachment));
    if (!bytes) {
      const note = `${attachment.fileName} needs manual handling because its PDF bytes were not available from the synced email.`;
      missingFields.push(note);
      auditNotes.push(note);
      continue;
    }
    let acroFields: ReturnType<typeof extractAcroFormFields>;
    try {
      acroFields = extractAcroFormFields(bytes);
    } catch {
      acroFields = [];
    }
    if (acroFields.length === 0) {
      const detected = detectFillableDocumentFields({
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        type: "carrier_supplemental",
      });
      const note = `${attachment.fileName} needs manual handling because no editable PDF fields were found (${detected.detection.reason}).`;
      missingFields.push(note);
      auditNotes.push(note);
      continue;
    }
    const template = {
      templateId: attachment.sourceDocumentId ?? attachment.documentId ?? attachment.id,
      fileName: attachment.fileName,
      documentName: attachment.description ?? attachment.fileName,
      type: "carrier_supplemental",
      autoFilledFieldCount: 0,
      missingFieldCount: 0,
    } satisfies CommercialAcordTemplateSelection;
    const filled = fillAcordFromClientDossier({
      template,
      dossier: clientAcordFillDossier(
        input.session,
        input.session.questionnaireResponses ?? {}
      ),
      kind: "supplemental",
    });
    const plan = buildAcroFormFillPlan(filled.fields, acroFields);
    if (plan.filledFieldCount === 0) {
      const note = `${attachment.fileName} has editable fields, but Quotex found no verified values safe to insert.`;
      missingFields.push(note, ...plan.missingFields);
      auditNotes.push(note);
      continue;
    }
    const completedBytes = fillPdfAcroForm(bytes, plan.values);
    const completedDataUrl = bytesToPdfDataUrl(completedBytes);
    const document = api.documents.create({
      tenantId: input.session.tenantId,
      uploadedById: input.session.createdById,
      fileName: attachment.fileName.replace(/\.pdf$/i, "-completed.pdf"),
      fileType: "application/pdf",
      documentName: `Completed carrier supplemental - ${attachment.fileName}`,
      type: "completed_carrier_supplemental",
      visibility: "employee_only",
      status: "approved",
      customerId: input.session.customerId,
      quoteRequestId: input.session.id,
      lineOfBusiness: "commercial",
      storagePath: `generated://carrier-supplemental/${input.communication.id}/${attachment.id}`,
      downloadUrl: completedDataUrl,
      templateFields: {
        ...filled.fields,
        "Source carrier email ID": input.communication.id,
        "Source attachment ID": attachment.id,
        "Filled field count": String(plan.filledFieldCount),
        "Remaining blank field count": String(plan.missingFields.length),
        "Value sources": Array.from(new Set(plan.mappings.map((mapping) => mapping.source))).join(", "),
      },
    });
    documentIds.push(document.id);
    missingFields.push(...plan.missingFields);
    auditNotes.push(
      `${attachment.fileName}: ${plan.filledFieldCount} field${
        plan.filledFieldCount === 1 ? "" : "s"
      } filled, ${plan.missingFields.length} remaining.`
    );
    const attachmentIndex = updatedAttachments.findIndex((candidate) => candidate.id === attachment.id);
    if (attachmentIndex >= 0) {
      updatedAttachments[attachmentIndex] = {
        ...attachment,
        documentId: document.id,
        dataUrl: completedDataUrl,
        filledFieldCount: plan.filledFieldCount,
        filledFields: filled.fields,
        fieldMappings: plan.mappings.map((mapping) => ({
          sourceLabel: mapping.sourceLabel,
          targetField: mapping.targetField,
          value: mapping.value,
          source: mapping.source,
        })),
      };
    }
  }
  if (documentIds.length > 0) {
    db.update("communications", input.communication.id, { attachments: updatedAttachments });
  }
  return {
    documentIds: uniqueStrings(documentIds),
    missingFields: uniqueStrings(missingFields),
    auditNotes,
    resolvedLossRun,
  };
}

async function applyInboundCarrierReply(input: {
  tenantId: string;
  sessionId: string;
  submissionId: string;
  communicationId: string;
  matchReason: string;
}): Promise<QuotingSession | null> {
  const session = api.quoting.get(input.sessionId);
  const communication = db
    .list("communications")
    .find(
      (row) =>
        row.id === input.communicationId &&
        row.tenantId === input.tenantId &&
        row.direction === "inbound"
    );
  if (!session || session.tenantId !== input.tenantId || !communication) return null;
  const submissions = session.commercialCarrierSubmissions ?? [];
  const submissionIndex = submissions.findIndex(
    (candidate) =>
      (candidate.submissionId ?? commercialSubmissionStableId(session, candidate.carrierId)) ===
      input.submissionId
  );
  if (submissionIndex < 0) return null;
  const submission = {
    ...submissions[submissionIndex],
    submissionId: input.submissionId,
  };
  if ((submission.replyCommunicationIds ?? []).includes(communication.id)) return session;

  const linkedCommunication =
    communication.carrierSubmissionId === input.submissionId
      ? communication
      : db.update("communications", communication.id, {
          carrierSubmissionId: input.submissionId,
        }) ?? communication;
  const parsed = await parseCommercialCarrierReplyWithAi(linkedCommunication, submission);
  const carrier = db.list("carriers").find((candidate) => candidate.id === submission.carrierId);
  const processedAt = nowIso();
  const stagedSupplementals = await stageCarrierRequestedSupplementals({
    session,
    submission,
    communication: linkedCommunication,
    parsed,
  });
  const parsedMissingFields = uniqueStrings([
    ...(parsed.missingFields ?? []).filter(
      (field) => !(stagedSupplementals.resolvedLossRun && /\bloss[ -]?runs?\b/i.test(field))
    ),
    ...stagedSupplementals.missingFields,
  ]);
  const nextSubmission: CommercialCarrierSubmission = {
    ...submission,
    status: parsed.status,
    responseAt: processedAt,
    acceptedAt: parsed.status === "accepted" ? processedAt : submission.acceptedAt,
    responseDeadline: parsed.quote.responseDeadline,
    replyCommunicationIds: uniqueStrings([
      ...(submission.replyCommunicationIds ?? []),
      linkedCommunication.id,
    ]),
    quote: parsed.quote,
    parseConfidence: parsed.quote.confidence,
    premiumEstimate: parsed.premiumEstimate ?? submission.premiumEstimate,
    finalPremium: parsed.finalPremium ?? submission.finalPremium,
    declinedReason: parsed.declinedReason,
    underwriterNotes: parsed.underwriterNotes,
    missingFields: parsedMissingFields,
    supplementalDocumentIds: uniqueStrings([
      ...(submission.supplementalDocumentIds ?? []),
      ...stagedSupplementals.documentIds,
    ]),
    agentReviewReason: parsed.agentReviewReason,
    aiRationale:
      parsed.status === "agent_review"
        ? parsed.agentReviewReason ?? "Carrier reply needs agent review before the workflow advances."
        : `Carrier reply parsed from inbound message ${linkedCommunication.id}; outcome ${parsed.quote.outcome}.`,
  };
  const nextSubmissions = submissions.map((candidate, index) =>
    index === submissionIndex ? nextSubmission : candidate
  );
  let questions = session.questionnaireQuestions ?? [];
  const missingFields = new Set(session.missingFields ?? []);
  if (parsedMissingFields.length) {
    parsedMissingFields.forEach((field) => missingFields.add(field));
    questions = appendUniqueQuestions(
      questions,
      commercialCarrierReplyQuestions(nextSubmission, carrier?.name ?? "Carrier")
    );
  }
  const hasMissingInfo = nextSubmissions.some(
    (candidate) =>
      candidate.status === "needs_client_info" || candidate.status === "needs_supplemental"
  );
  const hasAgentReview = nextSubmissions.some((candidate) => candidate.status === "agent_review");
  const quotedCarrierCount = nextSubmissions.filter(
    (candidate) =>
      candidate.status === "accepted" &&
      Boolean(candidate.finalPremium ?? candidate.premiumEstimate)
  ).length;
  const updated = db.update("quotingSessions", session.id, {
    commercialCarrierSubmissions: nextSubmissions,
    questionnaireQuestions: questions,
    missingFields: Array.from(missingFields),
    status: hasMissingInfo ? "awaiting_reply" : quotedCarrierCount > 0 ? "quoting" : session.status,
    aiSummary: hasAgentReview
      ? "One or more carrier replies need agent review before Quotex advances the workflow."
      : hasMissingInfo
      ? "Carrier replies were parsed and supplemental missing fields are ready for agent review."
      : quotedCarrierCount > 0
      ? `Carrier replies were parsed with ${quotedCarrierCount} quoted market${
          quotedCarrierCount === 1 ? "" : "s"
        } ready for ranking.`
      : "Carrier replies were parsed and the workflow is waiting for more explicit carrier outcomes.",
    updatedAt: processedAt,
  });
  if (!updated) return null;

  logQuotingWorkflowProgress(updated, {
    message:
      parsed.status === "agent_review"
        ? `${carrier?.name ?? "Carrier"} reply needs agent review.`
        : `${carrier?.name ?? "Carrier"} carrier reply captured.`,
    detail:
      parsed.status === "declined"
        ? parsed.declinedReason ?? "Carrier declined without a stated reason."
        : parsed.status === "needs_client_info" || parsed.status === "needs_supplemental"
        ? `${parsedMissingFields.length} supplemental item${
            parsedMissingFields.length === 1 ? "" : "s"
          } captured from the carrier reply.${
            stagedSupplementals.auditNotes.length > 0
              ? ` ${stagedSupplementals.auditNotes.join(" ")}`
              : ""
          }`
        : parsed.status === "accepted"
        ? parsed.finalPremium
          ? `Quoted premium captured from the carrier reply: ${fmt.money(parsed.finalPremium)}.`
          : "Carrier reply indicates this market can proceed; no premium was stated."
        : parsed.agentReviewReason ?? "Carrier reply is ambiguous.",
    createdAt: processedAt,
    createdById: "ai",
    communicationId: linkedCommunication.id,
  });
  upsertCarrierEmailProcessing({
    tenantId: input.tenantId,
    communicationId: linkedCommunication.id,
    outcome: "matched_processed",
    matchedSessionId: session.id,
    matchedSubmissionId: input.submissionId,
    matchReason: input.matchReason,
    classification: parsed.quote.outcome,
    parseConfidence: parsed.quote.confidence,
    processedAt,
  });
  if (!hasMissingInfo && !hasAgentReview && quotedCarrierCount > 0) {
    return api.quoting.runQuotes(session.id);
  }
  return updated;
}

function logCommercialCarrierEmailStatus(input: {
  session: QuotingSession;
  carrierName: string;
  underwriter: CarrierContact;
  message: Communication;
  kind: "application" | "supplemental";
  attachmentCount: number;
  firstDocumentId?: string;
}) {
  const packageLabel =
    input.kind === "application" ? "ACORD application packet" : "ACORD supplemental packet";
  const attachmentLabel = `${input.attachmentCount} PDF attachment${
    input.attachmentCount === 1 ? "" : "s"
  }`;
  db.insert("statusEvents", {
    id: uid("se"),
    tenantId: input.session.tenantId,
    source: "agent",
    message: `${packageLabel} prepared for delivery to ${input.underwriter.name} at ${input.carrierName} with ${attachmentLabel}.`,
    visibility: "internal",
    customerId: input.session.customerId,
    prospectId: input.session.prospectId,
    assetId: input.session.assetId,
    communicationId: input.message.id,
    documentId: input.firstDocumentId,
    createdAt: input.message.createdAt,
    createdById: input.session.createdById,
  });
}

function attachCommercialUnderwriterMessages(
  session: QuotingSession,
  submissions: CommercialCarrierSubmission[],
  responses: Record<string, string>,
  kind: "application" | "supplemental",
  targetCarrierIds?: Set<string>,
  emailDrafts?: CommercialUnderwriterEmailDraft[]
): CommercialCarrierSubmission[] {
  const contact = contactForQuotingSession(session);
  const contactName = contact?.name ?? "Commercial applicant";
  const completedAttachments = commercialAcordCommunicationAttachments(
    session,
    kind,
    responses,
    { persistCompletedDocuments: true }
  );

  return submissions.map((submission) => {
    const submissionId =
      submission.submissionId ?? commercialSubmissionStableId(session, submission.carrierId);
    const threadId = commercialSubmissionThreadId(session, submissionId, kind);
    if (targetCarrierIds && !targetCarrierIds.has(submission.carrierId)) {
      return submission;
    }
    if (
      submission.submissionMethod &&
      submission.submissionMethod !== "underwriter_email"
    ) {
      return submission;
    }
    const carrier = db.list("carriers").find((candidate) => candidate.id === submission.carrierId);
    const underwriters = carrierUnderwriters(session.tenantId, submission.carrierId);
    const attachments = completedAttachments;
    const messages = underwriters.map((underwriter) => {
      const draft = emailDrafts?.find(
        (candidate) =>
          candidate.carrierId === submission.carrierId &&
          candidate.underwriterContactId === underwriter.id &&
          candidate.kind === kind
      );
      const message = api.communications.create({
        tenantId: session.tenantId,
        carrierContactId: underwriter.id,
        channel: "email",
        direction: "outbound",
        threadId,
        carrierSubmissionId: submissionId,
        subject:
          draft?.subject ??
          (kind === "application"
            ? `Commercial application package - ${contactName}`
            : `Commercial supplemental package - ${contactName}`),
        body:
          [
            draft?.body ??
              commercialApplicationBody(
                underwriter.name,
                kind
              ),
            "",
            `Submission reference: ${submissionId}`,
          ].join("\n"),
        attachments,
        createdById: session.createdById,
      });
      logCommercialCarrierEmailStatus({
        session,
        carrierName: carrier?.name ?? "Carrier",
        underwriter,
        message,
        kind,
        attachmentCount: attachments.length,
        firstDocumentId: attachments.find((attachment) => attachment.documentId)?.documentId,
      });
      return message;
    });
    const messageIds = messages.map((message) => message.id);
    const threadIds = uniqueStrings(messages.map((message) => message.threadId));
    const externalThreadIds = uniqueStrings(messages.map((message) => message.externalThreadId));
    return {
      ...submission,
      submissionId,
      underwriterContactIds: Array.from(
        new Set([...(submission.underwriterContactIds ?? []), ...underwriters.map((contact) => contact.id)])
      ),
      ...(kind === "application"
        ? {
            applicationDocumentIds: Array.from(
              new Set([
                ...(submission.applicationDocumentIds ?? []),
                ...attachments.map((attachment) => attachment.documentId).filter(Boolean),
              ] as string[])
            ),
            applicationMessageIds: Array.from(
              new Set([...(submission.applicationMessageIds ?? []), ...messageIds])
            ),
            applicationThreadIds: Array.from(
              new Set([...(submission.applicationThreadIds ?? []), ...threadIds])
            ),
            applicationExternalThreadIds: Array.from(
              new Set([...(submission.applicationExternalThreadIds ?? []), ...externalThreadIds])
            ),
          }
        : {
            supplementalDocumentIds: Array.from(
              new Set([
                ...(submission.supplementalDocumentIds ?? []),
                ...attachments.map((attachment) => attachment.documentId).filter(Boolean),
              ] as string[])
            ),
            supplementalMessageIds: Array.from(
              new Set([...(submission.supplementalMessageIds ?? []), ...messageIds])
            ),
            supplementalThreadIds: Array.from(
              new Set([...(submission.supplementalThreadIds ?? []), ...threadIds])
            ),
            supplementalExternalThreadIds: Array.from(
              new Set([...(submission.supplementalExternalThreadIds ?? []), ...externalThreadIds])
            ),
          }),
    };
  });
}

interface CommercialUnderwriterEmailDraft {
  carrierId: string;
  carrierName: string;
  underwriterContactId: string;
  underwriterName: string;
  underwriterEmail: string;
  kind: "application" | "supplemental";
  subject: string;
  body: string;
  attachments: CommunicationAttachment[];
}

function buildCommercialUnderwriterEmailDrafts(
  session: QuotingSession,
  responses: Record<string, string>,
  kind: "application" | "supplemental",
  carrierIds: string[]
): CommercialUnderwriterEmailDraft[] {
  const contact =
    session.customerId
      ? db.list("customers").find((customer) => customer.id === session.customerId)
      : session.prospectId
      ? db.list("prospects").find((prospect) => prospect.id === session.prospectId)
      : null;
  const contactName = contact?.name ?? "Commercial applicant";
  const attachments = commercialAcordCommunicationAttachments(session, kind, responses, {
    persistCompletedDocuments: true,
  });
  return carrierIds.flatMap((carrierId) => {
    const carrier = db.list("carriers").find((candidate) => candidate.id === carrierId);
    return carrierUnderwriters(session.tenantId, carrierId).map((underwriter) => ({
      carrierId,
      carrierName: carrier?.name ?? "Carrier",
      underwriterContactId: underwriter.id,
      underwriterName: underwriter.name,
      underwriterEmail: underwriter.email ?? "",
      kind,
      subject:
        kind === "application"
          ? `Commercial application package - ${contactName}`
          : `Commercial supplemental package - ${contactName}`,
      body: commercialApplicationBody(underwriter.name, kind),
      attachments,
    }));
  });
}

function mergeCommercialSubmissionArtifacts(
  session: QuotingSession,
  submissions: CommercialCarrierSubmission[]
): CommercialCarrierSubmission[] {
  const previousByCarrier = new Map(
    (session.commercialCarrierSubmissions ?? []).map((submission) => [
      submission.carrierId,
      submission,
    ])
  );
  return submissions.map((submission) => {
    const previous = previousByCarrier.get(submission.carrierId);
    if (!previous) return submission;
    return {
      ...submission,
      submissionId: previous.submissionId ?? submission.submissionId,
      submissionMethod: previous.submissionMethod ?? submission.submissionMethod,
      connectorLabel: previous.connectorLabel ?? submission.connectorLabel,
      automationJobId: previous.automationJobId ?? submission.automationJobId,
      automationTrace: previous.automationTrace ?? submission.automationTrace,
      underwriterContactIds: Array.from(
        new Set([
          ...(previous.underwriterContactIds ?? []),
          ...(submission.underwriterContactIds ?? []),
        ])
      ),
      applicationDocumentIds: Array.from(
        new Set([
          ...(previous.applicationDocumentIds ?? []),
          ...(submission.applicationDocumentIds ?? []),
        ])
      ),
      applicationMessageIds: Array.from(
        new Set([
          ...(previous.applicationMessageIds ?? []),
          ...(submission.applicationMessageIds ?? []),
        ])
      ),
      applicationThreadIds: Array.from(
        new Set([
          ...(previous.applicationThreadIds ?? []),
          ...(submission.applicationThreadIds ?? []),
        ])
      ),
      applicationExternalThreadIds: Array.from(
        new Set([
          ...(previous.applicationExternalThreadIds ?? []),
          ...(submission.applicationExternalThreadIds ?? []),
        ])
      ),
      supplementalMessageIds: Array.from(
        new Set([
          ...(previous.supplementalMessageIds ?? []),
          ...(submission.supplementalMessageIds ?? []),
        ])
      ),
      supplementalThreadIds: Array.from(
        new Set([
          ...(previous.supplementalThreadIds ?? []),
          ...(submission.supplementalThreadIds ?? []),
        ])
      ),
      supplementalExternalThreadIds: Array.from(
        new Set([
          ...(previous.supplementalExternalThreadIds ?? []),
          ...(submission.supplementalExternalThreadIds ?? []),
        ])
      ),
      replyCommunicationIds: Array.from(
        new Set([
          ...(previous.replyCommunicationIds ?? []),
          ...(submission.replyCommunicationIds ?? []),
        ])
      ),
      supplementalDocumentIds: Array.from(
        new Set([
          ...(previous.supplementalDocumentIds ?? []),
          ...(submission.supplementalDocumentIds ?? []),
        ])
      ),
      quote: previous.quote ?? submission.quote,
      premiumEstimate: previous.premiumEstimate ?? submission.premiumEstimate,
      finalPremium: previous.finalPremium ?? submission.finalPremium,
      underwriterNotes: previous.underwriterNotes ?? submission.underwriterNotes,
      parseConfidence: previous.parseConfidence ?? submission.parseConfidence,
      agentReviewReason: previous.agentReviewReason ?? submission.agentReviewReason,
    };
  });
}

function analyzeCommercialCarrierPipeline(
  session: QuotingSession,
  responses: Record<string, string>,
  stampedAt: string,
  selectedCarrierIds?: string[],
  requireUnderwriterEmailsForSelected = false
): {
  submissions: CommercialCarrierSubmission[];
  secondRoundQuestions: QuotingQuestion[];
  acceptedCarrierIds: string[];
  submittedCarrierCount: number;
} {
  const carriers = linkedActiveCarriers(session.tenantId);
  const ranked = aiRankCarrierQuotes({
    carriers,
    assetType: session.assetType,
    estimatedValue: session.estimatedValue || 1_000_000,
    state: session.state,
    lineOfBusiness: "commercial",
  }).quotes;
  const selectedSet = selectedCarrierIds?.length
    ? new Set(selectedCarrierIds)
    : null;
  const selectedCarrierSend = !!selectedSet && requireUnderwriterEmailsForSelected;
  const rankedTargets = selectedSet
    ? ranked.filter(
        (quote) =>
          selectedSet.has(quote.carrierId) &&
          (!requireUnderwriterEmailsForSelected ||
            carrierUnderwriters(session.tenantId, quote.carrierId).length > 0)
      )
    : ranked;
  const worthy = rankedTargets
    .filter((q, i) => i < 6 && q.score >= 0.35)
    .slice(0, 5);
  const targetQuotes = selectedSet
    ? rankedTargets
    : worthy.length > 0
    ? worthy
    : ranked.slice(0, 3);
  const commercialDocs = db
    .list("documents")
    .filter(
      (d) =>
        d.tenantId === session.tenantId &&
        d.lineOfBusiness === "commercial" &&
        d.carrierId
    );
  const existingQuestions = session.questionnaireQuestions ?? [];
  const secondRoundQuestions: QuotingQuestion[] = [];

  const submissions = targetQuotes.map((q, index) => {
    const submissionId = commercialSubmissionStableId(session, q.carrierId);
    const carrier = carriers.find((c) => c.id === q.carrierId);
    const carrierDocs = commercialDocs.filter((d) => d.carrierId === q.carrierId);
    const connector = carrier ? getCarrierQuoteProviderReadiness(carrier) : null;
    const underwriters = carrierUnderwriters(session.tenantId, q.carrierId);
    const submissionMethod: CommercialCarrierSubmission["submissionMethod"] =
      selectedCarrierSend
        ? "underwriter_email"
        : connector?.provider === "carrier_portal_automation" && connector.hasPortalUrl
        ? "carrier_portal_automation"
        : underwriters.length > 0
        ? "underwriter_email"
        : "manual_workflow";
    const connectorLabel =
      submissionMethod === "carrier_portal_automation"
        ? connector?.providerLabel ?? "AI carrier portal runner"
        : submissionMethod === "underwriter_email"
        ? "Underwriter email workflow"
        : "Manual carrier workflow";
    const automationTrace =
      submissionMethod === "carrier_portal_automation" && carrier
        ? runCarrierPortalRunner({
            carrier,
            session: {
              ...session,
              questionnaireResponses: responses,
            },
            state: session.state,
            baseQuote: q,
          })
        : undefined;
    const automationJobId =
      submissionMethod === "carrier_portal_automation" ? automationTrace?.jobId : undefined;
    const secondRoundCarrierQuestions = existingQuestions.filter(
      (question) => question.carrierId === q.carrierId && question.round === "second_round"
    );
    const generatedSupplementals = carrier
      ? commercialSupplementalQuestionsForCarrier(carrier)
      : [];
    const unanswered = session.commercialSecondRoundSentAt
      ? secondRoundCarrierQuestions
          .filter((question) => !(responses[question.id] ?? "").trim())
          .slice(0, 2)
      : generatedSupplementals.slice(0, 2);
    const missingLabels =
      unanswered.length > 0
        ? unanswered.map((question) => question.label)
        : [
            `${carrier?.name ?? "Carrier"}: final carrier-specific supplemental details`,
          ];

    if (
      index <= 1 ||
      carrierDocs.length > 0 ||
      (session.commercialSecondRoundSentAt && unanswered.length === 0)
    ) {
      return {
        submissionId,
        carrierId: q.carrierId,
        status:
          (carrierDocs.length > 0 && index > 1) ||
          (session.commercialSecondRoundSentAt && index > 1)
            ? "supplemental_sent"
            : "accepted",
        sentAt: stampedAt,
        responseAt: stampedAt,
        acceptedAt: stampedAt,
        score: q.score,
        fitReason: q.fitReason,
        supplementalDocumentIds: carrierDocs.map((d) => d.id),
        submissionMethod,
        connectorLabel,
        automationJobId,
        automationTrace,
        aiRationale:
          index <= 1
            ? `AI appetite analysis ranked this carrier high enough to accept the application without more client data through ${connectorLabel}.`
            : `AI found the carrier supplemental on file and auto-filled it before resubmitting through ${connectorLabel}.`,
      } satisfies CommercialCarrierSubmission;
    }

    if (index <= 3) {
      missingLabels.forEach((label) => {
        secondRoundQuestions.push({
          id: `second-${q.carrierId}-${fieldSlug(label)}`,
          section: "Second-round carrier supplementals",
          label: label.replace(`${carrier?.name ?? ""}: `, ""),
          kind: /details|summary|operations|litigation|locations/i.test(label)
            ? "textarea"
            : /number|count|employees|vehicles|sq ft|revenue/i.test(label)
            ? "number"
            : "text",
          required: true,
          round: "second_round",
          carrierId: q.carrierId,
        });
      });
      return {
        submissionId,
        carrierId: q.carrierId,
        status: "needs_client_info",
        sentAt: stampedAt,
        responseAt: stampedAt,
        score: q.score,
        fitReason: q.fitReason,
        missingFields: missingLabels,
        submissionMethod,
        connectorLabel,
        automationJobId,
        automationTrace,
        aiRationale:
          `Carrier replied through ${connectorLabel} with a supplemental request. AI could not complete every field from the file, so it queued a second client questionnaire.`,
      } satisfies CommercialCarrierSubmission;
    }

    return {
      submissionId,
      carrierId: q.carrierId,
      status: "declined",
      sentAt: stampedAt,
      responseAt: stampedAt,
      score: q.score,
      fitReason: q.fitReason,
      submissionMethod,
      connectorLabel,
      automationJobId,
      automationTrace,
      declinedReason:
        "Carrier response did not accept the risk after appetite and application review.",
      aiRationale:
        "AI filtered this carrier out so the agent only sees markets willing to proceed.",
    } satisfies CommercialCarrierSubmission;
  });

  const priorSubmissionsByCarrier = new Map(
    (session.commercialCarrierSubmissions ?? []).map((submission) => [
      submission.carrierId,
      submission,
    ])
  );
  const normalizedSubmissions =
    commercialApplicationSentAtForSession(session) && session.commercialSecondRoundSentAt
      ? submissions.map((submission) => {
          const prior = priorSubmissionsByCarrier.get(submission.carrierId);
          if (!prior) return submission;
          if (prior.status === "needs_client_info") {
            return {
              ...submission,
              status: "supplemental_sent",
              responseAt: stampedAt,
              acceptedAt: stampedAt,
              missingFields: undefined,
              declinedReason: undefined,
              aiRationale:
                "Carrier supplemental information was completed and returned for underwriting review.",
            } satisfies CommercialCarrierSubmission;
          }
          if (prior.status === "accepted" || prior.status === "supplemental_sent") {
            return {
              ...submission,
              status: prior.status,
              responseAt: prior.responseAt ?? submission.responseAt ?? stampedAt,
              acceptedAt: prior.acceptedAt ?? submission.acceptedAt ?? stampedAt,
              missingFields: undefined,
            } satisfies CommercialCarrierSubmission;
          }
          if (prior.status === "declined") {
            return {
              ...submission,
              status: "declined",
              declinedReason: prior.declinedReason ?? submission.declinedReason,
              missingFields: undefined,
            } satisfies CommercialCarrierSubmission;
          }
          return submission;
        })
      : submissions;

  const acceptedCarrierIds = normalizedSubmissions
    .filter((s) => s.status === "accepted" || s.status === "supplemental_sent")
    .map((s) => s.carrierId);
  return {
    submissions: normalizedSubmissions,
    secondRoundQuestions,
    acceptedCarrierIds,
    submittedCarrierCount: targetQuotes.length,
  };
}

function markCommercialSubmissionsAwaitingResponse(
  submissions: CommercialCarrierSubmission[]
): CommercialCarrierSubmission[] {
  return submissions.map((submission) => ({
    ...submission,
    status: "awaiting_response",
    responseAt: undefined,
    acceptedAt: undefined,
    replyCommunicationIds: [],
    quote: undefined,
    premiumEstimate: undefined,
    finalPremium: undefined,
    underwriterNotes: undefined,
    parseConfidence: undefined,
    agentReviewReason: undefined,
    missingFields: undefined,
    declinedReason: undefined,
    aiRationale: `Application packet sent through ${
      submission.connectorLabel ?? "carrier workflow"
    }. Awaiting the carrier response before AI classifies this market.`,
  }));
}

const CARRIER_DOWNLOAD_POLICY_FIELDS = new Set<keyof Policy>([
  "policyNumber",
  "premiumEstimate",
  "finalPremium",
  "effectiveDate",
  "renewalDate",
  "status",
  "renewalStatus",
  "paymentFrequency",
  "billingMethod",
  "billingPayer",
  "billingPayerName",
  "billingStatus",
  "billingAccountNumber",
  "billingReference",
  "billingFinanceCompany",
  "billingMortgagee",
  "billingLastVerifiedAt",
  "billingNotes",
  "nextPaymentDueDate",
  "nextPaymentAmount",
]);

function policyPatchFromCarrierDownload(changes: CarrierDownloadChange[]): Partial<Policy> {
  return changes.reduce<Partial<Policy>>((patch, change) => {
    const field = change.field as keyof Policy;
    if (!CARRIER_DOWNLOAD_POLICY_FIELDS.has(field)) return patch;
    return { ...patch, [field]: change.incomingValue };
  }, {});
}

const AGENCY_PLAN_FIELDS = new Set<keyof Agency>([
  "tier",
  "allowedUsers",
  "allowedProspectsPerMonth",
  "allowedAiMessagesPerMonth",
  "allowedCarriers",
  "websiteAppAddOn",
  "softwarePlanTermMonths",
  "softwarePlanStartedAt",
  "softwarePlanRenewsAt",
]);

const AGENCY_PRICE_FIELDS = new Set<keyof Agency>([
  "monthlyPriceOverrideUsd",
  "monthlyPriceOverrideReason",
  "monthlyPriceOverrideUpdatedAt",
]);

const AGENCY_DEACTIVATION_BILLING_REASON =
  "Billing suspended because agency was deactivated in the master portal.";

const AGENCY_DEACTIVATION_RESTORE_FIELDS: (keyof Agency)[] = [
  "tier",
  "softwareProduct",
  "allowedUsers",
  "allowedProspectsPerMonth",
  "allowedAiMessagesPerMonth",
  "allowedCarriers",
  "websiteAppAddOn",
  "softwarePlanTermMonths",
  "softwarePlanStartedAt",
  "softwarePlanRenewsAt",
  "softwarePlanRenewalContractPacketId",
  "softwarePlanRenewalContractSentAt",
  "softwarePlanRenewalContractRecipientEmail",
  "softwarePlanRenewalContractSignedAt",
  "softwarePlanRenewalContractSignedByName",
  "softwarePlanRenewalContractSignedByEmail",
  "softwarePlanLastRenewedAt",
  "monthlyPriceOverrideUsd",
  "monthlyPriceOverrideReason",
  "monthlyPriceOverrideUpdatedAt",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "stripeSubscriptionTermStartedAt",
  "stripeSubscriptionTermEndsAt",
  "stripeSubscriptionCancelAt",
];

const AGENCY_WEBSITE_FIELDS = new Set<keyof Agency>([
  "website",
  "websiteSlug",
  "websiteEnabled",
  "websiteHeadline",
  "websiteIntro",
  "portalBaseUrl",
  "customerPortalUrl",
  "quoteStartUrl",
  "websiteAllowedDomains",
  "websiteApiKeyEncrypted",
  "websiteApiKeyPreview",
  "websiteWebhookUrl",
  "websiteWebhookSecretEncrypted",
  "websiteWebhookSecretPreview",
  "websiteAuthRedirects",
  "websitePortalModules",
  "websiteLastLeadAt",
  "websiteLastSyncAt",
  "websiteLastWebhookStatus",
  "websiteLastWebhookMessage",
  "websiteConnectionUpdatedAt",
]);

const AGENCY_CARRIER_RUNNER_FIELDS = new Set<keyof Agency>([
  "carrierRunnerEnabled",
  "carrierRunnerStatus",
  "carrierRunnerMode",
  "carrierRunnerAgencyCode",
  "carrierRunnerProfileId",
  "carrierRunnerReceiverCode",
  "carrierRunnerCredentialVaultRef",
  "carrierRunnerMfaMode",
  "carrierRunnerAuthorizedUserIds",
  "carrierRunnerLinesOfBusiness",
  "carrierRunnerFeeds",
  "carrierRunnerCarrierIds",
  "carrierRunnerReviewRule",
  "carrierRunnerSchedule",
  "carrierRunnerWorkingPath",
  "carrierRunnerArchivePath",
  "carrierRunnerFailureAlertEmails",
  "carrierRunnerContactEmail",
  "carrierRunnerContactPhone",
  "carrierRunnerNotes",
  "carrierRunnerLastTestAt",
  "carrierRunnerLastTestStatus",
  "carrierRunnerLastTestMessage",
  "carrierRunnerLastSyncAt",
  "carrierRunnerUpdatedAt",
]);

const AGENCY_PROFILE_FIELDS = new Set<keyof Agency>([
  "name",
  "logoUrl",
  "brandColor",
  "contactEmail",
  "phone",
  "address",
  "serviceAreas",
  "active",
]);

function agencyActivityFieldLabel(field: string): string {
  return field
    .replace(/Usd$/, "")
    .replace(/At$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^carrierRunner/i, "carrier runner")
    .replace(/^ivans/i, "legacy download")
    .replace(/^ai/i, "AI")
    .replace(/^website/i, "website")
    .toLowerCase();
}

function cleanAgencyActivityMetadata(
  metadata: Record<string, unknown> = {}
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !/encrypted|secret|credential/i.test(key))
      .map(([key, value]) => {
        if (Array.isArray(value)) return [key, value.join(", ")];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
          return [key, value];
        }
        if (value === undefined) return [key, null];
        return [key, String(value)];
      })
  );
}

function createAgencyDeactivationSnapshot(agency: Agency): NonNullable<Agency["deactivationSnapshot"]> {
  const values: Record<string, unknown> = {};
  const missingFields: string[] = [];
  for (const field of AGENCY_DEACTIVATION_RESTORE_FIELDS) {
    const value = agency[field];
    if (value === undefined) {
      missingFields.push(field);
    } else {
      values[field] = structuredClone(value);
    }
  }
  return {
    capturedAt: nowIso(),
    values,
    missingFields,
  };
}

function patchFromAgencyDeactivationSnapshot(
  snapshot: Agency["deactivationSnapshot"]
): Partial<Agency> {
  if (!snapshot) return {};
  const patch: Record<string, unknown> = {};
  const missing = new Set(snapshot.missingFields);
  for (const field of AGENCY_DEACTIVATION_RESTORE_FIELDS) {
    if (missing.has(field)) {
      patch[field] = undefined;
    } else if (Object.prototype.hasOwnProperty.call(snapshot.values, field)) {
      patch[field] = structuredClone(snapshot.values[field]);
    }
  }
  return patch as Partial<Agency>;
}

function createMasterAgencyActivity(
  input: Omit<MasterAgencyActivity, "id" | "createdAt"> & { createdAt?: string }
): MasterAgencyActivity {
  const row: MasterAgencyActivity = {
    ...input,
    id: uid("master_activity"),
    createdAt: input.createdAt ?? nowIso(),
    metadata: cleanAgencyActivityMetadata(input.metadata),
  };
  db.insert("masterAgencyActivities", row);
  return row;
}

function logAgencyActivity(
  agency: Agency,
  kind: MasterAgencyActivityKind,
  title: string,
  description: string,
  metadata?: Record<string, unknown>,
  source: MasterAgencyActivity["source"] = "master_portal",
  actorName = "Master portal"
): MasterAgencyActivity {
  return createMasterAgencyActivity({
    agencyId: agency.id,
    agencyName: agency.name,
    kind,
    title,
    description,
    actorName,
    source,
    metadata: cleanAgencyActivityMetadata(metadata),
  });
}

function createAgencyDeactivationNotice(agency: Agency, actorId?: string): Communication | null {
  const recipient = normalizeEmail(agency.contactEmail);
  if (!recipient) return null;
  return api.communications.create({
    tenantId: agency.id,
    externalRecipientName: agency.name,
    externalRecipientEmail: recipient,
    externalRecipientRole: "Agency billing contact",
    channel: "email",
    direction: "outbound",
    subject: "Quotex agency access deactivated",
    body: [
      `Hi ${agency.name},`,
      "",
      "Your Quotex agency workspace has been deactivated by the master portal.",
      "",
      "Billing has been suspended effective immediately. Staff access, portal workflows, and connected agency services are paused until the account is reactivated.",
      "",
      "If this was unexpected, reply to this message or contact Quotex Insurance Support.",
      "",
      "Thank you,",
      "Quotex Insurance",
    ].join("\n"),
    createdById:
      actorId ??
      db.list("users").find((user) => user.role === "master_admin" && user.active)?.id ??
      "master_portal",
  });
}

function restoreAgencyStaffAccessAfterReactivation(agencyId: string, actorId?: string): number {
  let restored = 0;
  for (const user of db.list("users")) {
    if (user.tenantId !== agencyId || !isStaffRole(user.role)) continue;
    if (user.staffAccessStatus === "banned" || user.staffAccessStatus === "deleted") continue;

    const needsAccessPatch = !user.active || user.staffAccessStatus !== "active";
    const updated = needsAccessPatch
      ? db.update("users", user.id, {
          active: true,
          staffAccessStatus: "active",
          staffAccessUpdatedAt: nowIso(),
          staffAccessUpdatedById: actorId,
        })
      : user;
    if (!updated) continue;
    upsertStaffMailboxAuthorization(updated, actorId);
    restored += 1;
  }
  return restored;
}

function classifyAgencyPatchActivity(
  agency: Agency,
  patch: Partial<Agency>
): Omit<MasterAgencyActivity, "id" | "createdAt" | "agencyId" | "agencyName" | "actorName" | "source"> | null {
  const fields = Object.keys(patch).filter((field) => {
    if (/encrypted|secret|credential/i.test(field)) return false;
    return true;
  });
  if (fields.length === 0) return null;
  const fieldSet = new Set(fields as (keyof Agency)[]);
  const metadata = cleanAgencyActivityMetadata({
    fields: fields.map(agencyActivityFieldLabel).join(", "),
    ...(typeof patch.monthlyPriceOverrideUsd === "number"
      ? { monthlyPriceUsd: patch.monthlyPriceOverrideUsd }
      : {}),
    ...(typeof patch.allowedUsers === "number" ? { userSlots: patch.allowedUsers } : {}),
    ...(patch.softwarePlanTermMonths ? { termMonths: patch.softwarePlanTermMonths } : {}),
    ...(patch.softwarePlanRenewsAt ? { renewsAt: dateInputFromIso(patch.softwarePlanRenewsAt) } : {}),
    ...(patch.carrierRunnerStatus ? { runnerStatus: patch.carrierRunnerStatus } : {}),
    ...(patch.websiteLastWebhookStatus ? { websiteStatus: patch.websiteLastWebhookStatus } : {}),
  });

  if (fieldSet.has("active") && patch.active === false) {
    return {
      kind: "agency_deactivated",
      title: "Agency deactivated",
      description: `${agency.name} was marked inactive in the master portal.`,
      metadata,
    };
  }

  if (fields.some((field) => AGENCY_PRICE_FIELDS.has(field as keyof Agency))) {
    const cleared = "monthlyPriceOverrideUsd" in patch && patch.monthlyPriceOverrideUsd === undefined;
    return {
      kind: "agency_price_updated",
      title: cleared ? "Manual monthly price removed" : "Manual monthly price updated",
      description: cleared
        ? `${agency.name}'s manual monthly price override was cleared.`
        : `${agency.name}'s monthly price was manually adjusted${typeof patch.monthlyPriceOverrideUsd === "number" ? ` to ${fmt.money(patch.monthlyPriceOverrideUsd)}` : ""}.`,
      metadata,
    };
  }

  if (fields.some((field) => AGENCY_PLAN_FIELDS.has(field as keyof Agency))) {
    return {
      kind: "agency_plan_updated",
      title: "Agency plan updated",
      description: `${agency.name}'s software plan, user slots, add-ons, or contract term changed.`,
      metadata,
    };
  }

  if (fields.some((field) => AGENCY_CARRIER_RUNNER_FIELDS.has(field as keyof Agency))) {
    return {
      kind: "agency_carrier_runner_updated",
      title: "Carrier download runner updated",
      description: `${agency.name}'s carrier portal runner, MFA handling, feeds, credentials reference, or test status changed.`,
      metadata,
    };
  }

  if (fields.some((field) => AGENCY_WEBSITE_FIELDS.has(field as keyof Agency))) {
    return {
      kind: "agency_website_connection_updated",
      title: "Website connection updated",
      description: `${agency.name}'s website, client portal, API key, webhook, or redirect settings changed.`,
      metadata,
    };
  }

  if (fields.some((field) => AGENCY_PROFILE_FIELDS.has(field as keyof Agency))) {
    return {
      kind: "agency_updated",
      title: "Agency profile updated",
      description: `${agency.name}'s profile, contact, logo, service area, or status settings changed.`,
      metadata,
    };
  }

  return {
    kind: "agency_updated",
    title: "Agency updated",
    description: `${agency.name} was updated in the platform.`,
    metadata,
  };
}

function logAgencyPatchActivity(agency: Agency, patch: Partial<Agency>) {
  const activity = classifyAgencyPatchActivity(agency, patch);
  if (!activity) return;
  logAgencyActivity(
    agency,
    activity.kind,
    activity.title,
    activity.description,
    activity.metadata
  );
}

const LEGACY_DEMO_REQUESTS_KEY = "quotex.demoRequests.v1";

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function boolField(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function syncLegacyDemoRequests() {
  if (typeof window === "undefined" || !window.localStorage) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(window.localStorage.getItem(LEGACY_DEMO_REQUESTS_KEY) ?? "[]");
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return;

  const existingIds = new Set(db.list("demoLeads").map((lead) => lead.id));
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const id = stringField(source.id) || uid("demo_lead_legacy");
    if (existingIds.has(id)) continue;
    const createdAt = stringField(source.createdAt) || nowIso();
    const row: DemoLead = {
      id,
      firstName: stringField(source.firstName),
      lastName: stringField(source.lastName),
      businessEmail: stringField(source.businessEmail),
      agencyName: stringField(source.agencyName),
      role: stringField(source.role),
      staffSize: stringField(source.staffSize),
      phone: stringField(source.phone) || undefined,
      interest: stringField(source.interest, "Full Quotex software walkthrough"),
      notes: stringField(source.notes) || undefined,
      marketingOptIn: boolField(source.marketingOptIn, true),
      source: "walkthrough_request",
      status: "new",
      createdAt,
      updatedAt: createdAt,
    };
    db.insert("demoLeads", row);
    existingIds.add(id);
  }
}

function acordLineOfBusinessFromCatalog(
  line: AcordFormSeed["line"]
): Document["lineOfBusiness"] | undefined {
  if (line === "Personal lines") return "personal";
  if (line === "Commercial lines") return "commercial";
  return undefined;
}

function bundledAcordTemplateId(tenantId: string, form: AcordFormSeed): string {
  const tenantSlug = tenantId.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const formSlug = form.number.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  return `doc_acord_${tenantSlug}_${formSlug}`;
}

function isBundledAcordTemplateDocument(document: Document): boolean {
  const path = `${document.storagePath ?? ""} ${document.downloadUrl ?? ""}`;
  const label = `${document.fileName} ${document.documentName ?? ""}`;
  return (
    document.fileType === "application/pdf" &&
    /acord/i.test(label) &&
    (path.includes("/acord/") ||
      String(document.templateFields?.["Bundled PDF"] ?? "").toLowerCase().includes("yes")) &&
    !document.customerId &&
    !document.assetId &&
    !document.policyId &&
    !document.claimId &&
    !document.carrierId &&
    !document.quoteRequestId
  );
}

function ensureBundledAcordTemplatesForTenant(tenantId: string): void {
  const existingFileNames = new Set(
    db
      .list("documents")
      .filter(
        (document) =>
          document.tenantId === tenantId && isBundledAcordTemplateDocument(document)
      )
      .map((document) => document.fileName)
  );
  const uploadedById =
    db
      .list("users")
      .find(
        (user) =>
          user.tenantId === tenantId &&
          (user.role === "manager" || user.role === "agent")
      )?.id ?? "system";
  ACORD_FORM_CATALOG.forEach((form) => {
    if (existingFileNames.has(form.fileName)) return;
    db.insert("documents", {
      id: bundledAcordTemplateId(tenantId, form),
      tenantId,
      uploadedById,
      fileName: form.fileName,
      fileType: "application/pdf",
      documentName: `ACORD ${form.number} - ${form.name}`,
      templateFields: {
        "ACORD form number": `ACORD ${form.number}`,
        "Form name": form.name,
        "Line / category": form.line,
        "Typical use": form.use,
        "Source file": form.sourceFileName,
        "Bundled PDF": "Yes - loaded from the agency-provided PDF set",
        "Agency action": "Use this uploaded PDF as the agency template.",
      },
      lineOfBusiness: acordLineOfBusinessFromCatalog(form.line),
      required: false,
      type: "agency_template",
      visibility: "employee_only",
      status: "approved",
      storagePath: `/acord/${form.fileName}`,
      downloadUrl: `/acord/${form.fileName}`,
      agencyId: tenantId,
      uploadedAt: nowIso(),
    });
    existingFileNames.add(form.fileName);
  });
}

export const api = {
  // ------------ Demo leads (master) ------------
  demoLeads: {
    list(): DemoLead[] {
      syncLegacyDemoRequests();
      return db.list("demoLeads").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    get(id: string): DemoLead | undefined {
      syncLegacyDemoRequests();
      return db.list("demoLeads").find((lead) => lead.id === id);
    },
    create(
      input: Omit<DemoLead, "id" | "createdAt" | "updatedAt" | "status"> & {
        id?: string;
        createdAt?: string;
        updatedAt?: string;
        status?: DemoLeadStatus;
      }
    ): DemoLead {
      const createdAt = input.createdAt ?? nowIso();
      const row: DemoLead = {
        ...input,
        id: input.id ?? uid("demo_lead"),
        status: input.status ?? "new",
        createdAt,
        updatedAt: input.updatedAt ?? createdAt,
      };
      db.insert("demoLeads", row);
      return row;
    },
    update(id: string, patch: Partial<DemoLead>): DemoLead | null {
      return db.update("demoLeads", id, { ...patch, updatedAt: nowIso() });
    },
  },

  // ------------ Software transaction sales (master) ------------
  softwareSales: {
    list(): SoftwareSale[] {
      return db.list("softwareSales").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    get(id: string): SoftwareSale | undefined {
      return db.list("softwareSales").find((sale) => sale.id === id);
    },
    create(
      input: Omit<SoftwareSale, "id" | "createdAt" | "updatedAt" | "status"> & {
        status?: SoftwareSaleStatus;
      }
    ): SoftwareSale {
      const row: SoftwareSale = {
        ...input,
        id: uid("sale"),
        status: input.status ?? "checkout_pending",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.insert("softwareSales", row);
      return row;
    },
    update(id: string, patch: Partial<SoftwareSale>): SoftwareSale | null {
      return db.update("softwareSales", id, { ...patch, updatedAt: nowIso() });
    },
    setStatus(id: string, status: SoftwareSaleStatus): SoftwareSale | null {
      return this.update(id, { status });
    },
  },

  // ------------ Master agency activity log ------------
  masterAgencyActivities: {
    list(filters: { agencyId?: string; kind?: MasterAgencyActivityKind } = {}): MasterAgencyActivity[] {
      return db
        .list("masterAgencyActivities")
        .filter((activity) => !filters.agencyId || activity.agencyId === filters.agencyId)
        .filter((activity) => !filters.kind || activity.kind === filters.kind)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    create(
      input: Omit<MasterAgencyActivity, "id" | "createdAt"> & { createdAt?: string }
    ): MasterAgencyActivity {
      return createMasterAgencyActivity(input);
    },
  },

  // ------------ Agency book-of-business import batches ------------
  importBatches: {
    list(tenantId: string): BookImportBatch[] {
      return tenantFilter(db.list("importBatches"), tenantId).sort((a, b) =>
        a.uploadedAt < b.uploadedAt ? 1 : -1
      );
    },
    get(id: string): BookImportBatch | undefined {
      return db.list("importBatches").find((batch) => batch.id === id);
    },
    upsert(batch: BookImportBatch): BookImportBatch {
      const existing = this.get(batch.id);
      if (existing) {
        return db.update("importBatches", batch.id, {
          ...batch,
          updatedAt: nowIso(),
        })!;
      }
      db.insert("importBatches", batch);
      return batch;
    },
    update(id: string, patch: Partial<BookImportBatch>): BookImportBatch | null {
      return db.update("importBatches", id, { ...patch, updatedAt: nowIso() });
    },
    remove(id: string): boolean {
      const batch = this.get(id);
      if (!batch || batch.status === "imported") return false;
      return db.remove("importBatches", id);
    },
    undo(id: string, actorId?: string): BookImportBatch | null {
      const batch = this.get(id);
      const report = batch?.report;
      if (!batch || !report || batch.status !== "imported") return batch ?? null;
      const removed: Record<string, number> = {
        users: 0,
        customers: 0,
        assets: 0,
        policies: 0,
        documents: 0,
        notes: 0,
        carriers: 0,
        carrierLinks: 0,
        statusEvents: 0,
        renewals: 0,
      };
      const removeTagged = <K extends keyof ReturnType<typeof db.snapshot>>(
        table: K,
        ids: string[],
        bucket: keyof typeof removed
      ) => {
        ids.forEach((rowId) => {
          const row = (db.list(table) as any[]).find((item) => item.id === rowId);
          if (!row || row.importBatchId !== id) return;
          if (db.remove(table, rowId)) removed[bucket] += 1;
        });
      };
      removeTagged("policies", report.createdIds.policies, "policies");
      removeTagged("assets", report.createdIds.assets, "assets");
      removeTagged("documents", report.createdIds.documents, "documents");
      removeTagged("notes", report.createdIds.notes, "notes");
      removeTagged("statusEvents", report.createdIds.statusEvents, "statusEvents");
      removeTagged("renewals", report.createdIds.renewals, "renewals");
      removeTagged("carrierLinks", report.createdIds.carrierLinks, "carrierLinks");
      removeTagged("carriers", report.createdIds.carriers, "carriers");
      removeTagged("customers", report.createdIds.customers, "customers");
      removeTagged("users", report.createdIds.users, "users");
      const undo = {
        undoneAt: nowIso(),
        undoneById: actorId,
        removed,
      };
      return this.update(id, { status: "undone", report: { ...report, undo } });
    },
  },

  // ------------ Agencies (master) ------------
  agencies: {
    list(): Agency[] {
      return db.list("agencies").filter((agency) => browserCanReadAgency(agency.id));
    },
    get(id: string): Agency | undefined {
      if (!browserCanReadAgency(id)) return undefined;
      return db.list("agencies").find((a) => a.id === id);
    },
    byCode(code: string): Agency | undefined {
      const normalized = normalizeAgencyCode(code);
      if (!normalized) return undefined;
      return db
        .list("agencies")
        .filter((agency) => browserCanReadAgency(agency.id))
        .find((a) => agencyCodeMatches(a, normalized));
    },
    maskedCode(agency: Agency): string {
      return maskedAgencyCode(agency.agencyCodePreview);
    },
    revealCodeForMaster(id: string): string | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      return revealProtectedAgencyCode(agency);
    },
    sendAgencyCode(id: string): { agency: Agency; recipient: string; maskedCode: string; sentAt: string } | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      logAgencyActivity(
        agency,
        "agency_code_sent",
        "Agency code sent",
        `Encrypted agency sign-in code was prepared for ${agency.contactEmail}.`,
        { recipient: agency.contactEmail, codePreview: agency.agencyCodePreview }
      );
      return {
        agency,
        recipient: agency.contactEmail,
        maskedCode: maskedAgencyCode(agency.agencyCodePreview),
        sentAt: nowIso(),
      };
    },
    create(
      input: Omit<
        Agency,
        "id" | "createdAt" | "active" | "agencyCode" | "agencyCodeEncrypted" | "agencyCodePreview"
      > & {
        active?: boolean;
      }
    ): Agency {
      const existingCodes = new Set(
        db
          .list("agencies")
          .map((agency) => revealProtectedAgencyCode(agency) ?? "")
          .filter(Boolean)
      );
      const agencyCode = generateAgencyCode(input.name, existingCodes);
      const row: Agency = ensureWebsiteConnection({
        ...input,
        ...protectAgencyCode(agencyCode),
        id: uid("agency"),
        active: input.active ?? true,
        createdAt: nowIso(),
      });
      db.insert("agencies", row);
      upsertAgencyMarketingMailboxAuthorization(row);
      logAgencyActivity(
        row,
        "agency_created",
        "Agency created",
        `${row.name} was added to the platform and issued an encrypted agency sign-in code.`,
        {
          codePreview: row.agencyCodePreview,
          userSlots: row.allowedUsers,
          termMonths: row.softwarePlanTermMonths ?? agencyPlanTermMonths(row),
          websiteAppAddOn: row.websiteAppAddOn ?? "none",
        }
      );
      return row;
    },
    update(id: string, patch: Partial<Agency>) {
      const updated = db.update("agencies", id, patch);
      if (updated) {
        if (patch.contactEmail !== undefined || patch.name !== undefined) {
          upsertAgencyMarketingMailboxAuthorization(updated);
        }
        logAgencyPatchActivity(updated, patch);
      }
      return updated;
    },
    sendRenewalContract(id: string): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      const updated = db.update("agencies", id, {
        softwarePlanRenewalContractPacketId: uid("agency_renewal_packet"),
        softwarePlanRenewalContractSentAt: nowIso(),
        softwarePlanRenewalContractRecipientEmail: agency.contactEmail,
        softwarePlanRenewalContractSignedAt: undefined,
        softwarePlanRenewalContractSignedByName: undefined,
        softwarePlanRenewalContractSignedByEmail: undefined,
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_renewal_contract_sent",
          "Renewal contract sent",
          `Software renewal contract was sent to ${updated.softwarePlanRenewalContractRecipientEmail ?? updated.contactEmail}.`,
          {
            recipient: updated.softwarePlanRenewalContractRecipientEmail ?? updated.contactEmail,
            packetId: updated.softwarePlanRenewalContractPacketId ?? null,
            renewsAt: dateInputFromIso(agencyPlanRenewalIso(updated)),
          }
        );
      }
      return updated;
    },
    completeRenewalContractSignature(id: string): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      const currentRenewalInput = dateInputFromIso(agencyPlanRenewalIso(agency));
      const todayInput = dateInputFromIso(nowIso());
      const currentRenewalTime = new Date(`${currentRenewalInput}T12:00:00.000Z`).getTime();
      const todayTime = new Date(`${todayInput}T12:00:00.000Z`).getTime();
      const nextStartInput = currentRenewalTime > todayTime ? currentRenewalInput : todayInput;
      const nextRenewalInput = addMonthsToDateInput(
        nextStartInput,
        agencyPlanTermMonths(agency)
      );
      const signedAt = nowIso();
      const updated = db.update("agencies", id, {
        softwarePlanStartedAt: isoFromDateInput(nextStartInput),
        softwarePlanRenewsAt: isoFromDateInput(nextRenewalInput),
        softwarePlanRenewalContractSignedAt: signedAt,
        softwarePlanRenewalContractSignedByName: agency.name,
        softwarePlanRenewalContractSignedByEmail:
          agency.softwarePlanRenewalContractRecipientEmail ?? agency.contactEmail,
        softwarePlanLastRenewedAt: signedAt,
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_renewed",
          "Agency renewed",
          `${updated.name}'s signed renewal contract was registered and the term rolled forward.`,
          {
            signedBy: updated.softwarePlanRenewalContractSignedByEmail ?? updated.contactEmail,
            startedAt: nextStartInput,
            renewsAt: nextRenewalInput,
            termMonths: agencyPlanTermMonths(updated),
          }
        );
      }
      return updated;
    },
    regenerateCode(id: string): { ok: true; agency: Agency } | { ok: false; reason: "missing" } {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return { ok: false, reason: "missing" };
      const existingCodes = db
        .list("agencies")
        .filter((a) => a.id !== id)
        .map((a) => revealProtectedAgencyCode(a) ?? "")
        .filter(Boolean);
      const nextCode = generateAgencyCode(agency.name, existingCodes);
      const updated = db.update("agencies", id, protectAgencyCode(nextCode));
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_code_changed",
          "Agency code regenerated",
          `${updated.name}'s encrypted agency sign-in code was regenerated.`,
          { codePreview: updated.agencyCodePreview }
        );
      }
      return updated ? { ok: true, agency: updated } : { ok: false, reason: "missing" };
    },
    revealWebsiteApiKeyForMaster(id: string): string | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      return agency ? revealWebsiteApiKey(agency) : null;
    },
    revealWebsiteWebhookSecretForMaster(id: string): string | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      return agency ? revealWebsiteWebhookSecret(agency) : null;
    },
    regenerateWebsiteApiKey(id: string): { ok: true; agency: Agency } | { ok: false; reason: "missing" } {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return { ok: false, reason: "missing" };
      const updated = db.update("agencies", id, {
        ...protectWebsiteApiKey(generateConnectionSecret("qtx_site")),
        websiteConnectionUpdatedAt: nowIso(),
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_website_connection_updated",
          "Website API key regenerated",
          `${updated.name}'s website API key was regenerated.`,
          { apiKeyPreview: updated.websiteApiKeyPreview ?? null }
        );
      }
      return updated ? { ok: true, agency: updated } : { ok: false, reason: "missing" };
    },
    regenerateWebsiteWebhookSecret(id: string): { ok: true; agency: Agency } | { ok: false; reason: "missing" } {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return { ok: false, reason: "missing" };
      const updated = db.update("agencies", id, {
        ...protectWebsiteWebhookSecret(generateConnectionSecret("qtx_hook")),
        websiteConnectionUpdatedAt: nowIso(),
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_website_connection_updated",
          "Website webhook secret regenerated",
          `${updated.name}'s website webhook secret was regenerated.`,
          { webhookSecretPreview: updated.websiteWebhookSecretPreview ?? null }
        );
      }
      return updated ? { ok: true, agency: updated } : { ok: false, reason: "missing" };
    },
    checkWebsiteConnection(id: string): { ok: true; agency: Agency } | { ok: false; reason: "missing" } {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return { ok: false, reason: "missing" };
      const result = assessWebsiteConnection(agency);
      const updated = db.update("agencies", id, {
        websiteLastSyncAt: nowIso(),
        websiteLastWebhookStatus: result.status,
        websiteLastWebhookMessage: result.message,
        websiteConnectionUpdatedAt: nowIso(),
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_website_connection_updated",
          "Website connection checked",
          `${updated.name}'s website connection was checked: ${result.message}`,
          { status: result.status }
        );
      }
      return updated ? { ok: true, agency: updated } : { ok: false, reason: "missing" };
    },
    deactivate(
      id: string,
      options: { actorId?: string; sendNotice?: boolean } = {}
    ): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      if (!agency.active) return agency;
      const suspendedAt = nowIso();
      const deactivationSnapshot = createAgencyDeactivationSnapshot(agency);
      const updated = db.update("agencies", id, {
        active: false,
        deactivationSnapshot,
        monthlyPriceOverrideUsd: 0,
        monthlyPriceOverrideReason: AGENCY_DEACTIVATION_BILLING_REASON,
        monthlyPriceOverrideUpdatedAt: suspendedAt,
      });
      if (updated) {
        const notice =
          options.sendNotice === false
            ? null
            : createAgencyDeactivationNotice(updated, options.actorId);
        logAgencyActivity(
          updated,
          "agency_deactivated",
          "Agency deactivated",
          `${updated.name} was marked inactive in the master portal. Billing was suspended and the agency contact was notified.`,
          {
            billingStatus: "suspended",
            monthlyPriceUsd: 0,
            snapshotCapturedAt: deactivationSnapshot.capturedAt,
            noticeRecipient: updated.contactEmail,
            noticeCommunicationId: notice?.id ?? null,
            noticeDeliveryStatus: notice?.deliveryStatus ?? null,
          }
        );
      }
      return updated;
    },
    reactivate(id: string, options: { actorId?: string } = {}): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      const restoredPatch = patchFromAgencyDeactivationSnapshot(agency.deactivationSnapshot);
      const restoredFromSnapshot = !!agency.deactivationSnapshot;
      const clearSuspension =
        !restoredFromSnapshot &&
        agency.monthlyPriceOverrideUsd === 0 &&
        agency.monthlyPriceOverrideReason === AGENCY_DEACTIVATION_BILLING_REASON;
      const updated = db.update("agencies", id, {
        ...restoredPatch,
        active: true,
        deactivationSnapshot: undefined,
        ...(clearSuspension
          ? {
              monthlyPriceOverrideUsd: undefined,
              monthlyPriceOverrideReason: undefined,
              monthlyPriceOverrideUpdatedAt: undefined,
            }
          : {}),
      });
      if (updated) {
        const restoredStaffCount = restoreAgencyStaffAccessAfterReactivation(updated.id, options.actorId);
        void db.syncNow();
        logAgencyActivity(
          updated,
          "agency_plan_updated",
          "Agency reactivated",
          `${updated.name} was reactivated in the master portal.${
            restoredFromSnapshot || clearSuspension ? " Billing resumed under the agency's saved plan." : ""
          }`,
          {
            billingStatus: restoredFromSnapshot || clearSuspension ? "resumed" : "unchanged",
            monthlyPriceUsd: agencyMonthlyPriceUsd(updated),
            restoredFromSnapshot,
            restoredStaffCount,
          }
        );
      }
      return updated;
    },
    setTier(id: string, tier: SubscriptionTier) {
      const updated = db.update("agencies", id, { tier });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_plan_updated",
          "Agency tier changed",
          `${updated.name}'s tier was changed to ${tier}.`,
          { tier }
        );
      }
      return updated;
    },
    addUserSlots(id: string, count: number): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      const safeCount = Math.max(0, Math.min(500, Math.floor(count)));
      if (safeCount === 0) return agency;
      const updated = db.update("agencies", id, {
        allowedUsers: agency.allowedUsers + safeCount,
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_plan_updated",
          "User slots added",
          `${safeCount} user slot${safeCount === 1 ? "" : "s"} added to ${updated.name}.`,
          { addedSlots: safeCount, totalSlots: updated.allowedUsers }
        );
      }
      return updated;
    },
    updateSubscriptionLimits(
      id: string,
      input: {
        tier: SubscriptionTier;
        allowedUsers: number;
        allowedCarriers: number;
        allowedAiMessagesPerMonth: number;
        websiteAppAddOn?: Agency["websiteAppAddOn"];
      }
    ): Agency | null {
      const agency = db.list("agencies").find((a) => a.id === id);
      if (!agency) return null;
      const tierLimits = TIER_LIMITS[input.tier];
      const staffCount = db
        .list("users")
        .filter((u) => u.tenantId === id && (u.role === "agent" || u.role === "manager")).length;
      const updated = db.update("agencies", id, {
        tier: input.tier,
        allowedUsers: Math.max(staffCount, Math.floor(input.allowedUsers) || 0),
        allowedCarriers: Math.max(tierLimits.allowedCarriers, Math.floor(input.allowedCarriers) || 0),
        allowedAiMessagesPerMonth: Math.max(
          tierLimits.allowedAiMessagesPerMonth,
          Math.floor(input.allowedAiMessagesPerMonth) || 0
        ),
        websiteAppAddOn: input.websiteAppAddOn ?? agency.websiteAppAddOn ?? "none",
        allowedProspectsPerMonth: tierLimits.allowedProspectsPerMonth,
      });
      if (updated) {
        logAgencyActivity(
          updated,
          "agency_plan_updated",
          "Subscription limits updated",
          `${updated.name}'s plan limits and add-ons were updated.`,
          {
            tier: updated.tier,
            userSlots: updated.allowedUsers,
            websiteAppAddOn: updated.websiteAppAddOn ?? "none",
          }
        );
      }
      return updated;
    },
    // Create a performance goal (company-wide or personal). Returns
    // the created goal so callers can reference its id.
    addPerformanceGoal(
      id: string,
      input: {
        metric: import("@/types").PerformanceGoalMetric;
        customMetricLabel?: string;
        customMetricPrompt?: string;
        customMetricHelper?: string;
        customMetricFormula?: import("@/types").CustomPerformanceGoalFormula;
        target: number;
        period: import("@/types").PerformanceGoalPeriod;
        dueDate?: string;
        scope: import("@/types").PerformanceGoalScope;
        assigneeIds?: string[];
      }
    ): import("@/types").PerformanceGoal | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const goal: import("@/types").PerformanceGoal = {
        id: uid("goal"),
        metric: input.metric,
        customMetricLabel: input.customMetricLabel,
        customMetricPrompt: input.customMetricPrompt,
        customMetricHelper: input.customMetricHelper,
        customMetricFormula: input.customMetricFormula,
        target: input.target,
        period: input.period,
        dueDate: input.dueDate,
        scope: input.scope,
        assigneeIds: input.scope === "personal" ? input.assigneeIds ?? [] : undefined,
        updatedAt: nowIso(),
      };
      db.update("agencies", id, {
        performanceGoals: [...coerceAgencyGoals(current.performanceGoals), goal],
      });
      return goal;
    },
    // Patch an existing goal in place (target / period / dueDate /
    // scope / assignees).
    updatePerformanceGoal(
      id: string,
      goalId: string,
      patch: Partial<{
        target: number;
        customMetricLabel?: string;
        customMetricPrompt?: string;
        customMetricHelper?: string;
        customMetricFormula?: import("@/types").CustomPerformanceGoalFormula;
        period: import("@/types").PerformanceGoalPeriod;
        dueDate?: string;
        scope: import("@/types").PerformanceGoalScope;
        assigneeIds?: string[];
      }>
    ): Agency | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const goals = coerceAgencyGoals(current.performanceGoals).map((g) =>
        g.id === goalId
          ? {
              ...g,
              ...patch,
              assigneeIds:
                (patch.scope ?? g.scope) === "personal"
                  ? patch.assigneeIds ?? g.assigneeIds ?? []
                  : undefined,
              updatedAt: nowIso(),
            }
          : g
      );
      return db.update("agencies", id, { performanceGoals: goals });
    },
    // Stamp a goal as having fired its achievement celebration so we
    // don't re-notify on every dashboard reload.
    markGoalAchievementNotified(id: string, goalId: string): Agency | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const goals = (current.performanceGoals ?? []).map((g) =>
        g.id === goalId ? { ...g, achievedNotifiedAt: nowIso() } : g
      );
      return db.update("agencies", id, { performanceGoals: goals });
    },
    // Delete a goal outright (no history entry).
    removePerformanceGoal(id: string, goalId: string): Agency | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      return db.update("agencies", id, {
        performanceGoals: coerceAgencyGoals(current.performanceGoals).filter(
          (g) => g.id !== goalId
        ),
      });
    },
    // Retire an active goal into history. The caller passes the current
    // actual (computed UI-side); we snapshot it + whether the target
    // was met, then remove it from the active list.
    archivePerformanceGoal(
      id: string,
      goalId: string,
      actual: number
    ): Agency | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const active = coerceAgencyGoals(current.performanceGoals).find((g) => g.id === goalId);
      if (!active) return current;
      const archived: import("@/types").ArchivedPerformanceGoal = {
        id: active.id,
        metric: active.metric,
        customMetricLabel: active.customMetricLabel,
        customMetricPrompt: active.customMetricPrompt,
        customMetricHelper: active.customMetricHelper,
        customMetricFormula: active.customMetricFormula,
        target: active.target,
        period: active.period,
        dueDate: active.dueDate,
        scope: active.scope,
        assigneeIds: active.assigneeIds,
        actual,
        met: actual >= active.target,
        archivedAt: nowIso(),
      };
      return db.update("agencies", id, {
        performanceGoals: coerceAgencyGoals(current.performanceGoals).filter(
          (g) => g.id !== goalId
        ),
        performanceGoalHistory: [
          archived,
          ...(current.performanceGoalHistory ?? []),
        ],
      });
    },
    addPerformanceGoalRequest(
      id: string,
      input: {
        requestedById: string;
        metric: import("@/types").PerformanceGoalMetric;
        customMetricLabel?: string;
        customMetricPrompt?: string;
        customMetricHelper?: string;
        customMetricFormula?: import("@/types").CustomPerformanceGoalFormula;
        target: number;
        period: import("@/types").PerformanceGoalPeriod;
        dueDate?: string;
        scope: import("@/types").PerformanceGoalScope;
        note?: string;
      }
    ): PerformanceGoalRequest | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const request: PerformanceGoalRequest = {
        id: uid("goalreq"),
        requestedById: input.requestedById,
        metric: input.metric,
        customMetricLabel: input.customMetricLabel,
        customMetricPrompt: input.customMetricPrompt,
        customMetricHelper: input.customMetricHelper,
        customMetricFormula: input.customMetricFormula,
        target: input.target,
        period: input.period,
        dueDate: input.dueDate,
        scope: input.scope,
        note: input.note,
        status: "pending",
        createdAt: nowIso(),
      };
      db.update("agencies", id, {
        performanceGoalRequests: [
          request,
          ...(current.performanceGoalRequests ?? []),
        ],
      });
      const requester = db.list("users").find((u) => u.id === input.requestedById);
      const metricLabel =
        input.metric === "custom"
          ? input.customMetricLabel ?? "Custom metric"
          : input.metric === "premiumWritten"
            ? "Premium written"
            : input.metric === "newCustomers"
              ? "New clients"
              : input.metric === "newProspects"
                ? "New prospects"
                : input.metric === "activitiesResolved"
                  ? "Activities resolved"
                  : "Policies bound";
      const targetLabel =
        input.metric === "premiumWritten"
          ? fmt.money(input.target)
          : input.target.toLocaleString();
      db
        .list("users")
        .filter((u) => u.tenantId === id && u.role === "manager" && u.active)
        .forEach((manager) => {
          db.insert("aiNotifications", {
            id: uid("ain"),
            tenantId: id,
            kind: "goal_request",
            title: `Performance goal request - ${requester?.name ?? "Agent"}`,
            summary: `${requester?.name ?? "An agent"} requested ${targetLabel} ${
              input.scope === "company" ? "company-wide" : "personal"
            } ${metricLabel.toLowerCase()} for this ${input.period}${
              input.dueDate ? `, due ${fmt.date(input.dueDate)}` : ""
            }.`,
            assignedToId: manager.id,
            severity: "info",
            topic: "other",
            goalRequestId: request.id,
            createdAt: nowIso(),
          });
        });
      return request;
    },
    approvePerformanceGoalRequest(
      id: string,
      requestId: string,
      reviewerId: string
    ): import("@/types").PerformanceGoal | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const request = (current.performanceGoalRequests ?? []).find(
        (r) => r.id === requestId
      );
      if (!request || request.status !== "pending") return null;
      const goal = this.addPerformanceGoal(id, {
        metric: request.metric,
        customMetricLabel: request.customMetricLabel,
        customMetricPrompt: request.customMetricPrompt,
        customMetricHelper: request.customMetricHelper,
        customMetricFormula: request.customMetricFormula,
        target: request.target,
        period: request.period,
        dueDate: request.dueDate,
        scope: request.scope,
        assigneeIds: request.scope === "personal" ? [request.requestedById] : undefined,
      });
      if (!goal) return null;
      const latest = db.list("agencies").find((a) => a.id === id);
      db.update("agencies", id, {
        performanceGoalRequests: (latest?.performanceGoalRequests ?? []).map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: "approved" as const,
                reviewedAt: nowIso(),
                reviewedById: reviewerId,
                createdGoalId: goal.id,
              }
            : r
        ),
      });
      db
        .list("aiNotifications")
        .filter((n) => n.tenantId === id && n.goalRequestId === requestId)
        .forEach((n) =>
          db.update("aiNotifications", n.id, {
            acknowledgedAt: nowIso(),
            acknowledgedById: reviewerId,
          })
        );
      return goal;
    },
    rejectPerformanceGoalRequest(
      id: string,
      requestId: string,
      reviewerId: string
    ): Agency | null {
      const current = db.list("agencies").find((a) => a.id === id);
      if (!current) return null;
      const updated = db.update("agencies", id, {
        performanceGoalRequests: (current.performanceGoalRequests ?? []).map((r) =>
          r.id === requestId
            ? {
                ...r,
                status: "rejected" as const,
                reviewedAt: nowIso(),
                reviewedById: reviewerId,
              }
            : r
        ),
      });
      db
        .list("aiNotifications")
        .filter((n) => n.tenantId === id && n.goalRequestId === requestId)
        .forEach((n) =>
          db.update("aiNotifications", n.id, {
            acknowledgedAt: nowIso(),
            acknowledgedById: reviewerId,
          })
        );
      return updated;
    },
  },

  // ------------ Branches (agency office locations) ------------
  branches: {
    listByAgency(agencyId: string): import("@/types").Branch[] {
      return db
        .list("branches")
        .filter((b) => b.agencyId === agencyId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    create(input: {
      agencyId: string;
      name: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
      phone?: string;
    }): import("@/types").Branch {
      const row: import("@/types").Branch = {
        id: uid("branch"),
        agencyId: input.agencyId,
        name: input.name,
        address: input.address,
        city: input.city,
        state: input.state,
        zip: input.zip,
        phone: input.phone,
        createdAt: nowIso(),
      };
      db.insert("branches", row);
      const agency = db.list("agencies").find((a) => a.id === row.agencyId);
      if (agency) {
        logAgencyActivity(
          agency,
          "agency_updated",
          "Branch added",
          `${row.name} was added as a branch/location for ${agency.name}.`,
          { branchName: row.name, city: row.city ?? null, state: row.state ?? null }
        );
      }
      return row;
    },
    update(id: string, patch: Partial<import("@/types").Branch>) {
      const updated = db.update("branches", id, patch);
      if (updated) {
        const agency = db.list("agencies").find((a) => a.id === updated.agencyId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_updated",
            "Branch updated",
            `${updated.name}'s branch/location details were updated for ${agency.name}.`,
            { branchName: updated.name, fields: Object.keys(patch).join(", ") }
          );
        }
      }
      return updated;
    },
    remove(id: string) {
      const existing = db.list("branches").find((branch) => branch.id === id);
      const removed = db.remove("branches", id);
      if (removed && existing) {
        const agency = db.list("agencies").find((a) => a.id === existing.agencyId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_updated",
            "Branch removed",
            `${existing.name} was removed from ${agency.name}'s branch/location list.`,
            { branchName: existing.name }
          );
        }
      }
      return removed;
    },
  },

  // ------------ Users ------------
  users: {
    list(tenantId?: string | null): User[] {
      return tenantFilter(db.list("users"), tenantId);
    },
    masterAccountExists(): boolean {
      return db.list("users").some(isLockingMasterAccount);
    },
    masterByEmail(email: string): User | undefined {
      const normalized = email.trim().toLowerCase();
      return db
        .list("users")
        .find((row) => row.role === "master_admin" && row.email.toLowerCase() === normalized);
    },
    get(id: string): User | undefined {
      return db.list("users").find((u) => u.id === id);
    },
    byEmail(email: string): User | undefined {
      const e = email.toLowerCase();
      return db
        .list("users")
        .find((u) => u.email.toLowerCase() === e || u.businessEmail?.toLowerCase() === e);
    },
    byUsername(username: string): User | undefined {
      const u = username.trim().toLowerCase();
      return db.list("users").find((row) => row.username?.toLowerCase() === u);
    },
    // Accepts either an email or a username — used by the staff sign-in form.
    byIdentifier(identifier: string, tenantId?: string | null): User | undefined {
      const normalized = identifier.trim().toLowerCase();
      const scoped = (u: User) => tenantId === undefined || u.tenantId === tenantId;
      return db
        .list("users")
        .find(
          (row) =>
            scoped(row) &&
            ((row.username?.toLowerCase() ?? "") === normalized ||
              row.email.toLowerCase() === normalized ||
              row.businessEmail?.toLowerCase() === normalized)
        );
    },
    create(input: Omit<User, "id" | "createdAt" | "active"> & { active?: boolean }): User {
      assertCanUseMasterAdminRole(input.role);
      const row: User = {
        ...input,
        id: uid("user"),
        active: input.active ?? true,
        staffAccessStatus: input.active === false ? input.staffAccessStatus ?? "deleted" : input.staffAccessStatus ?? "active",
        createdAt: nowIso(),
      };
      db.insert("users", row);
      upsertStaffMailboxAuthorization(row);
      if (row.tenantId && isStaffRole(row.role)) {
        const agency = db.list("agencies").find((a) => a.id === row.tenantId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_user_updated",
            "Staff user created",
            `${row.name} was added as ${staffRoleLabel(row.role).toLowerCase()} for ${agency.name}.`,
            { userName: row.name, role: staffRoleLabel(row.role), email: row.businessEmail ?? row.email }
          );
        }
      }
      return row;
    },
    update(id: string, patch: Partial<User>) {
      if (patch.role === "master_admin") assertCanUseMasterAdminRole("master_admin", id);
      const updated = db.update("users", id, patch);
      if (
        updated &&
        (patch.businessEmail !== undefined ||
          patch.email !== undefined ||
          patch.mailProvider !== undefined ||
          patch.name !== undefined ||
          patch.active !== undefined ||
          patch.staffAccessStatus !== undefined)
      ) {
        if (updated.active && updated.staffAccessStatus !== "banned" && updated.staffAccessStatus !== "deleted") {
          upsertStaffMailboxAuthorization(updated, patch.staffAccessUpdatedById);
        } else {
          const existing = db
            .list("connectedMailboxes")
            .find((mailbox) => mailbox.ownerType === "staff" && mailbox.userId === updated.id);
          if (existing) {
            db.update("connectedMailboxes", existing.id, {
              status: "disabled",
              updatedAt: nowIso(),
              updatedById: patch.staffAccessUpdatedById,
            });
          }
        }
      }
      if (updated?.tenantId && isStaffRole(updated.role)) {
        const agency = db.list("agencies").find((a) => a.id === updated.tenantId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_user_updated",
            "Staff user updated",
            `${updated.name}'s staff profile or access details changed for ${agency.name}.`,
            {
              userName: updated.name,
              role: staffRoleLabel(updated.role),
              fields: Object.keys(patch).join(", "),
            }
          );
        }
      }
      return updated;
    },
    setStaffAccessStatus(
      id: string,
      status: NonNullable<User["staffAccessStatus"]>,
      actorId?: string
    ):
      | { ok: true; user: User }
      | { ok: false; reason: "not_found" | "last_active_manager" | "seat_capacity" } {
      const user = api.users.get(id);
      if (!user) return { ok: false, reason: "not_found" };
      const active = status === "active";
      const tenantId = user.tenantId;
      if (!active && user.role === "manager" && tenantId) {
        const activeManagers = db
          .list("users")
          .filter(
            (u) =>
              u.tenantId === tenantId &&
              u.role === "manager" &&
              u.active &&
              u.id !== user.id
          );
        if (activeManagers.length === 0) return { ok: false, reason: "last_active_manager" };
      }
      if (active && tenantId && isStaffRole(user.role)) {
        const agency = api.agencies.get(tenantId);
        const activeTenantStaffCount = db
          .list("users")
          .filter(
            (u) =>
              u.tenantId === tenantId &&
              u.active &&
              isStaffRole(u.role) &&
              u.id !== user.id
          ).length;
        if (agency && activeTenantStaffCount >= agency.allowedUsers) {
          return { ok: false, reason: "seat_capacity" };
        }
      }
      const updated = db.update("users", id, {
        active,
        staffAccessStatus: status,
        staffAccessUpdatedAt: nowIso(),
        staffAccessUpdatedById: actorId,
      });
      if (updated) {
        if (active) {
          upsertStaffMailboxAuthorization(updated, actorId);
        } else {
          const existing = db
            .list("connectedMailboxes")
            .find((mailbox) => mailbox.ownerType === "staff" && mailbox.userId === updated.id);
          if (existing) {
            db.update("connectedMailboxes", existing.id, {
              status: "disabled",
              updatedAt: nowIso(),
              updatedById: actorId,
            });
          }
        }
      }
      if (updated?.tenantId && isStaffRole(updated.role)) {
        const agency = db.list("agencies").find((a) => a.id === updated.tenantId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_user_updated",
            active ? "Staff user reactivated" : "Staff user access changed",
            `${updated.name}'s access status is now ${status}.`,
            {
              userName: updated.name,
              role: staffRoleLabel(updated.role),
              status,
            }
          );
        }
      }
      return updated ? { ok: true, user: updated } : { ok: false, reason: "not_found" };
    },
    registerStaff(input: {
      agencyCode: string;
      branchId?: string;
      role: StaffRole;
      firstName: string;
      lastName: string;
      phone: string;
      businessEmail: string;
      password: string;
    }):
      | { ok: true; user: User; agency: Agency }
      | {
          ok: false;
          reason:
            | "agency_not_found"
            | "inactive_agency"
            | "duplicate_email"
            | "slot_limit"
            | "weak_password"
            | "missing_fields";
        } {
      const agency = api.agencies.byCode(input.agencyCode);
      if (!agency) return { ok: false, reason: "agency_not_found" };
      if (!agency.active) return { ok: false, reason: "inactive_agency" };
      if (!isStaffRole(input.role)) return { ok: false, reason: "missing_fields" };
      const branchId = input.branchId?.trim() || undefined;
      if (
        branchId &&
        !db.list("branches").some((branch) => branch.id === branchId && branch.agencyId === agency.id)
      ) {
        return { ok: false, reason: "missing_fields" };
      }
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const phone = input.phone.trim();
      const businessEmail = input.businessEmail.trim().toLowerCase();
      if (!firstName || !lastName || !phone || !businessEmail) {
        return { ok: false, reason: "missing_fields" };
      }
      if (input.password.length < 8) return { ok: false, reason: "weak_password" };
      if (api.users.byEmail(businessEmail)) return { ok: false, reason: "duplicate_email" };
      const staffCount = activeStaffCount(db.list("users"), agency.id);
      if (staffCount >= agency.allowedUsers) return { ok: false, reason: "slot_limit" };
      const user = api.users.create({
        tenantId: agency.id,
        role: input.role,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        email: businessEmail,
        businessEmail,
        mailProvider: inferMailProvider(businessEmail),
        phone,
        branchId,
        passwordUpdatedAt: nowIso(),
        profileCompleted: true,
      });
      return { ok: true, user, agency };
    },
    // Password resets are server-issued, one-time email flows. Browser state
    // must never mint or retain a readable password.
    regeneratePassword(id: string): string | null {
      void id;
      return null;
    },
    // Auto-provision staff accounts for an agency. Skips roles that already
    // have at least the planned count (idempotent — safe to call again to
    // top up after a tier upgrade).
    bulkProvision({
      tenantId,
      agencyName,
      tier,
    }: {
      tenantId: string;
      agencyName: string;
      tier: SubscriptionTier;
    }): User[] {
      const plan = tierProvisionPlan(tier);
      const existing = db.list("users").filter((u) => u.tenantId === tenantId);
      const made: User[] = [];
      const slug = slugifyAgency(agencyName);

      (["agent", "manager"] as const).forEach((role) => {
        const want = role === "agent" ? plan.agent : plan.manager;
        const have = existing.filter((u) => u.role === role).length;
        for (let i = have; i < want; i++) {
          const seq = i + 1;
          const username = generateUsername(role, agencyName, seq);
          const user: User = {
            id: uid("user"),
            tenantId,
            role,
            email: `${username}@${slug}.example`,
            username,
            passwordUpdatedAt: nowIso(),
            // Placeholder name until the staff member completes their
            // profile on first login.
            name: `${staffRoleLabel(role)} #${seq} - ${agencyName}`,
            profileCompleted: false,
            active: true,
            createdAt: nowIso(),
          };
          db.insert("users", user);
          upsertStaffMailboxAuthorization(user);
          made.push(user);
        }
      });

      if (made.length > 0) {
        const agency = db.list("agencies").find((a) => a.id === tenantId);
        if (agency) {
          logAgencyActivity(
            agency,
            "agency_user_updated",
            "Staff placeholders provisioned",
            `${made.length} staff placeholder account${made.length === 1 ? "" : "s"} were provisioned for ${agency.name}.`,
            { count: made.length }
          );
        }
      }
      return made;
    },
    // Provision an exact count of unassigned staff credentials at the
    // requested role. Unlike bulkProvision (which tops up to the tier
    // plan), this creates `count` brand-new placeholders every time —
    // useful when the master needs to hand out a specific number of
    // logins ahead of an agency hiring round.
    provisionMore({
      tenantId,
      role,
      count,
      agencyName,
    }: {
      tenantId: string;
      role: StaffRole;
      count: number;
      agencyName: string;
    }): User[] {
      if (!isStaffRole(role)) return [];
      const agency = db.list("agencies").find((a) => a.id === tenantId);
      const currentStaffCount = activeStaffCount(db.list("users"), tenantId);
      const availableSlots = agency ? Math.max(0, agency.allowedUsers - currentStaffCount) : 50;
      const requestedCount = Math.max(1, Math.floor(count) || 1);
      const safeCount = Math.max(0, Math.min(50, requestedCount, availableSlots));
      if (safeCount === 0) return [];
      const existing = db.list("users").filter((u) => u.tenantId === tenantId && u.role === role);
      const startSeq = existing.length + 1;
      const slug = slugifyAgency(agencyName);
      const made: User[] = [];
      for (let i = 0; i < safeCount; i++) {
        const seq = startSeq + i;
        const username = generateUsername(role, agencyName, seq);
        const user: User = {
          id: uid("user"),
          tenantId,
          role,
          email: `${username}@${slug}.example`,
          username,
          passwordUpdatedAt: nowIso(),
          name: `${staffRoleLabel(role)} #${seq} - ${agencyName}`,
          profileCompleted: false,
          active: true,
          createdAt: nowIso(),
        };
        db.insert("users", user);
        upsertStaffMailboxAuthorization(user);
        made.push(user);
      }
      if (made.length > 0 && agency) {
        logAgencyActivity(
          agency,
          "agency_user_updated",
          "Staff placeholders provisioned",
          `${made.length} ${staffRoleLabel(role).toLowerCase()} placeholder account${made.length === 1 ? "" : "s"} were provisioned for ${agency.name}.`,
          { count: made.length, role: staffRoleLabel(role) }
        );
      }
      return made;
    },
  },

  // ------------ Connected mailboxes ------------
  mailboxes: {
    listByTenant(tenantId: string): ConnectedMailbox[] {
      return tenantFilter(db.list("connectedMailboxes"), tenantId);
    },
    get(id: string): ConnectedMailbox | undefined {
      return db.list("connectedMailboxes").find((mailbox) => mailbox.id === id);
    },
    staff(userId: string): ConnectedMailbox | undefined {
      return db
        .list("connectedMailboxes")
        .find((mailbox) => mailbox.ownerType === "staff" && mailbox.userId === userId);
    },
    agencyMarketing(tenantId: string): ConnectedMailbox | undefined {
      return db
        .list("connectedMailboxes")
        .find(
          (mailbox) =>
            mailbox.tenantId === tenantId &&
            mailbox.ownerType === "agency_marketing" &&
            mailbox.status !== "disabled"
        );
    },
    cacheConnection(connection: ConnectedMailbox): ConnectedMailbox {
      const existing = db.list("connectedMailboxes").find((mailbox) => mailbox.id === connection.id);
      if (existing) {
        return db.update("connectedMailboxes", existing.id, {
          ...connection,
          updatedAt: connection.updatedAt || nowIso(),
        }) ?? connection;
      }
      db.insert("connectedMailboxes", connection);
      return connection;
    },
    resolveStaffSender(userId: string) {
      return mailboxForUser(userId);
    },
    resolveAgencyMarketingSender(tenantId: string) {
      return agencyMarketingSender(tenantId);
    },
    prepareStaffMailboxAuthorization(userId: string, byUserId?: string): ConnectedMailbox | null {
      const user = db.list("users").find((row) => row.id === userId);
      return user ? upsertStaffMailboxAuthorization(user, byUserId) : null;
    },
    prepareAgencyMarketingMailboxAuthorization(tenantId: string, byUserId?: string): ConnectedMailbox | null {
      const agency = db.list("agencies").find((row) => row.id === tenantId);
      return agency ? upsertAgencyMarketingMailboxAuthorization(agency, byUserId) : null;
    },
    setStatus(id: string, status: ConnectedMailboxStatus, byUserId?: string): ConnectedMailbox | null {
      return db.update("connectedMailboxes", id, {
        status,
        updatedAt: nowIso(),
        updatedById: byUserId,
      });
    },
    productionRequirements(mailbox: ConnectedMailbox | undefined): string[] {
      if (!mailbox) {
        return ["Connect the mailbox through Google OAuth, Microsoft OAuth, or an approved IMAP/SMTP adapter."];
      }
      if (mailbox.authMode === "demo") {
        return [
          "Reconnect this mailbox through provider OAuth before live send/sync.",
          "Store refresh tokens in the encrypted backend token vault.",
          "Enable provider webhooks or scheduled sync for inbound and sent-mail mirroring.",
        ];
      }
      const missing: string[] = [];
      if (!mailbox.tokenVaultRef) missing.push("Add an encrypted token vault reference.");
      if (!mailbox.scopes.includes("send")) missing.push("Grant send permission.");
      if (
        mailbox.authMode !== "smtp_imap" &&
        !mailbox.scopes.includes("read") &&
        !mailbox.scopes.includes("sync")
      ) {
        missing.push("Grant read or sync permission for mailbox mirroring.");
      }
      if (mailbox.status !== "connected") missing.push("Complete provider authorization.");
      return missing;
    },
  },

  // ------------ Mailbox outbox ------------
  mailboxOutbox: {
    listByTenant(tenantId: string): MailboxOutboxJob[] {
      return tenantFilter(db.list("mailboxOutbox"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    get(id: string): MailboxOutboxJob | undefined {
      return db.list("mailboxOutbox").find((job) => job.id === id);
    },
    markSending(id: string): MailboxOutboxJob | null {
      const job = this.get(id);
      if (!job || job.status === "sent" || job.status === "cancelled") return job ?? null;
      const updated = db.update("mailboxOutbox", id, {
        status: "sending",
        attemptCount: job.attemptCount + 1,
        lastAttemptAt: nowIso(),
        lastError: undefined,
        updatedAt: nowIso(),
      });
      if (updated) updateCommunicationDeliveryFromOutbox(updated, "sending");
      return updated;
    },
    markSent(
      id: string,
      provider: {
        externalMessageId?: string;
        externalThreadId?: string;
        externalUrl?: string;
        rfc822MessageId?: string;
        messageIdHeader?: string;
      } = {}
    ): MailboxOutboxJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("mailboxOutbox", id, {
        status: "sent",
        providerMessageId: provider.externalMessageId ?? job.providerMessageId,
        providerThreadId: provider.externalThreadId ?? job.providerThreadId,
        providerUrl: provider.externalUrl ?? job.providerUrl,
        lastAttemptAt: nowIso(),
        lastError: undefined,
        updatedAt: nowIso(),
      });
      if (updated) {
        updateCommunicationDeliveryFromOutbox(updated, "sent", provider);
        markMailboxSent(updated.mailboxConnectionId);
      }
      return updated;
    },
    markFailed(id: string, error: string, nextAttemptAt?: string): MailboxOutboxJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("mailboxOutbox", id, {
        status: "failed",
        lastError: error,
        nextAttemptAt,
        lastAttemptAt: nowIso(),
        updatedAt: nowIso(),
      });
      if (updated) {
        updateCommunicationDeliveryFromOutbox(updated, "failed");
        if (updated.mailboxConnectionId) {
          db.update("connectedMailboxes", updated.mailboxConnectionId, {
            lastError: error,
            updatedAt: nowIso(),
          });
        }
      }
      return updated;
    },
    retryDue(tenantId: string, at: string = nowIso()): MailboxOutboxJob[] {
      return this.listByTenant(tenantId).filter(
        (job) =>
          (job.status === "queued" || job.status === "failed") &&
          (!job.nextAttemptAt || job.nextAttemptAt <= at)
      );
    },
    cancel(id: string): MailboxOutboxJob | null {
      const job = this.get(id);
      if (!job || job.status === "sent") return job ?? null;
      const updated = db.update("mailboxOutbox", id, {
        status: "cancelled",
        updatedAt: nowIso(),
      });
      if (updated) updateCommunicationDeliveryFromOutbox(updated, "failed");
      return updated;
    },
  },

  // ------------ Customers ------------
  customers: {
    all(): CustomerProfile[] {
      return db.list("customers");
    },
    // Default view hides archived. Pass `{ includeArchived: true }` from
    // the Archive tab.
    list(tenantId: string, opts?: { includeArchived?: boolean }): CustomerProfile[] {
      const all = tenantFilter(db.list("customers"), tenantId);
      return opts?.includeArchived ? all : all.filter((c) => !c.archived);
    },
    // Access-controlled list. Agency staff see every active client in
    // their own tenant. Assignment is a routing/notification concern,
    // not a client-directory visibility gate; use listOwned() for
    // alert/badge surfaces that should only light up for assigned work.
    listVisible(
      tenantId: string,
      viewer: { id: string; role: Role } | undefined,
      opts?: { includeArchived?: boolean }
    ): CustomerProfile[] {
      const all = this.list(tenantId, opts);
      if (!viewer) return [];
      if (viewer.role === "master_admin") return all;
      if (viewer.role === "manager" || viewer.role === "agent" || viewer.role === "csr") {
        return all;
      }
      return [];
    },
    // Alert-scoped list. Managers can still access the full tenant
    // through listVisible(), but notification/badge surfaces should
    // only light up for clients assigned to that staff member.
    listOwned(
      tenantId: string,
      viewer: { id: string; role: Role } | undefined,
      opts?: { includeArchived?: boolean }
    ): CustomerProfile[] {
      const all = this.list(tenantId, opts);
      if (!viewer) return [];
      if (viewer.role === "master_admin") return all;
      if (viewer.role === "agent" || viewer.role === "manager" || viewer.role === "csr") {
        return all.filter((c) => contactIsOwnedBy(c, viewer.id));
      }
      return [];
    },
    // Single-row guard mirroring listVisible. Agency staff can open
    // any client in their own agency; assignment remains separate for
    // routing, activity ownership, and notification scoping.
    canSee(
      customer: CustomerProfile | undefined | null,
      viewer: { id: string; role: Role } | undefined
    ): boolean {
      if (!customer || !viewer) return false;
      if (viewer.role === "master_admin") return true;
      if (viewer.role === "manager" || viewer.role === "agent" || viewer.role === "csr") {
        const viewerUser = db.list("users").find((u) => u.id === viewer.id);
        return viewerUser ? viewerUser.tenantId === customer.tenantId : true;
      }
      return false;
    },
    fullHistory(customerId: string): StatusEvent[] {
      return comprehensiveClientHistory(customerId);
    },
    listArchived(tenantId: string): CustomerProfile[] {
      return tenantFilter(db.list("customers"), tenantId).filter((c) => c.archived);
    },
    get(id: string): CustomerProfile | undefined {
      return db.list("customers").find((c) => c.id === id);
    },
    byUserId(userId: string): CustomerProfile | undefined {
      return db.list("customers").find((c) => c.userId === userId);
    },
    create(
      input: Omit<CustomerProfile, "id" | "createdAt"> & { skipAutoRoute?: boolean }
    ): CustomerProfile {
      const { skipAutoRoute, ...customerInput } = input;
      const autoAgent = !hasContactAssignment(customerInput) && !skipAutoRoute
        ? chooseAutoRouteAgent(customerInput.tenantId, contactLine(customerInput))
        : undefined;
      const row: CustomerProfile = {
        ...customerInput,
        assignedAgentId: customerInput.assignedAgentId ?? autoAgent?.id,
        id: uid("customer"),
        createdAt: nowIso(),
      };
      db.insert("customers", row);
      if (autoAgent) {
        spawnRoutingTask(row, autoAgent.id, "ai");
        logContactRoutingEvent({
          tenantId: row.tenantId,
          kind: "client",
          contactId: row.id,
          contactName: row.name,
          before: { ...row, assignedAgentId: undefined, additionalAgentIds: undefined, assignedCsrId: undefined },
          after: row,
          byUserId: "ai",
        });
      }
      return row;
    },
    update(id: string, patch: Partial<CustomerProfile>) {
      return db.update("customers", id, patch);
    },
    // Routing transition for an existing client. Mirrors
    // prospects.assignAgent: when a client goes from unassigned →
    // assigned, spawn an Activity Center task on the new agent's
    // queue so the routed-to agent sees the new work without
    // having to discover it. Manager re-routes (already assigned →
    // different agent) skip the task to avoid noise.
    assignAgent(id: string, agentId: string, byUserId?: string) {
      const before = db.list("customers").find((c) => c.id === id);
      const updated = db.update("customers", id, {
        assignedAgentId: agentId,
        routingDismissedAt: undefined,
        routingDismissedById: undefined,
      });
      if (updated && before && !hasContactAssignment(before) && agentId) {
        spawnRoutingTask(updated, agentId, byUserId);
      }
      if (before && updated) {
        logContactRoutingEvent({
          tenantId: updated.tenantId,
          kind: "client",
          contactId: updated.id,
          contactName: updated.name,
          before,
          after: updated,
          byUserId,
        });
      }
      return updated;
    },
    // Multi-agent variant. The first id in the list becomes the
    // primary owner; the rest land in additionalAgentIds. Every
    // newly-routed-to agent gets a Task spawned on their queue.
    // Used by the manager Routing card when the manager checks
    // multiple agents in the assignment modal.
    assignAgents(
      id: string,
      agentIds: string[],
      byUserId?: string,
      options?: { csrId?: string | null; csrIds?: string[] }
    ) {
      if (agentIds.length === 0) return null;
      const before = db.list("customers").find((c) => c.id === id);
      const selectedUsers = agentIds
        .map((aid) => db.list("users").find((u) => u.id === aid && u.tenantId === before?.tenantId))
        .filter((u): u is User => !!u && isRoutableStaffRole(u.role));
      if (!before || selectedUsers.length === 0) return null;
      const previouslyAssigned = new Set(contactOwnerIds(before));
      const agentUsers = selectedUsers.filter((u) => u.role === "agent" || u.role === "manager");
      if (agentUsers.length === 0) return null;
      const [primary, ...rest] = agentUsers.map((u) => u.id);
      const requestedCsrIds = options
        ? options.csrIds ?? (options.csrId ? [options.csrId] : [])
        : [before.assignedCsrId, ...(before.additionalCsrIds ?? [])].filter(Boolean);
      const csrIds = Array.from(
        new Set(
          requestedCsrIds
            .map((cid) => db.list("users").find((u) => u.id === cid && u.tenantId === before.tenantId && u.role === "csr")?.id)
            .filter((cid): cid is string => !!cid)
        )
      );
      const [csrId, ...additionalCsrIds] = csrIds;
      const updated = db.update("customers", id, {
        assignedAgentId: primary ?? before.assignedAgentId,
        additionalAgentIds: rest.length > 0 ? rest : undefined,
        assignedCsrId: csrId,
        additionalCsrIds: additionalCsrIds.length > 0 ? additionalCsrIds : undefined,
        routingDismissedAt: undefined,
        routingDismissedById: undefined,
      });
      if (updated) {
        [...agentUsers.map((u) => u.id), ...csrIds]
          .filter((aid): aid is string => !!aid && !previouslyAssigned.has(aid))
          .forEach((aid) => spawnRoutingTask(updated, aid, byUserId));
        logContactRoutingEvent({
          tenantId: updated.tenantId,
          kind: "client",
          contactId: updated.id,
          contactName: updated.name,
          before,
          after: updated,
          byUserId,
        });
      }
      return updated;
    },
    archive(id: string) {
      return db.update("customers", id, { archived: true, archivedAt: nowIso() });
    },
    unarchive(id: string) {
      return db.update("customers", id, { archived: false, archivedAt: undefined });
    },
  },

  // ------------ Assets ------------
  assets: {
    listByCustomer(customerId: string): Asset[] {
      return db.list("assets").filter((a) => a.customerId === customerId);
    },
    listByTenant(tenantId: string): Asset[] {
      return tenantFilter(db.list("assets"), tenantId);
    },
    get(id: string): Asset | undefined {
      return db.list("assets").find((a) => a.id === id);
    },
    create(input: Omit<Asset, "id" | "createdAt">): Asset {
      const details = normalizeAssetDetails(input.details ?? {});
      const label =
        input.type === "luxury_vehicle"
          ? buildAssetLabelFromDetails({
              type: input.type,
              details,
              fallbackLabel: input.label,
            })
          : uppercaseVinTokens(input.label);
      const row: Asset = { ...input, label, details, id: uid("asset"), createdAt: nowIso() };
      db.insert("assets", row);
      return row;
    },
    update(id: string, patch: Partial<Asset>) {
      const existing = db.list("assets").find((asset) => asset.id === id);
      const details = patch.details ? normalizeAssetDetails(patch.details) : undefined;
      const label =
        existing && (patch.label !== undefined || details)
          ? existing.type === "luxury_vehicle"
            ? buildAssetLabelFromDetails({
                type: existing.type,
                details: details ?? existing.details ?? {},
                fallbackLabel: patch.label ?? existing.label,
              })
            : uppercaseVinTokens(patch.label ?? existing.label)
          : patch.label;
      return db.update("assets", id, {
        ...patch,
        ...(label !== undefined ? { label } : {}),
        ...(details ? { details } : {}),
      });
    },
    upgradeVehicleLabelFromVin(assetId: string, expectedLabel?: string) {
      return upgradeVehicleAssetLabelFromVin(assetId, expectedLabel);
    },
    backfillLabels(tenantId: string): number {
      if (!tenantId || assetLabelBackfillTenantIds.has(tenantId)) return 0;
      assetLabelBackfillTenantIds.add(tenantId);
      const decodeQueue: Array<{ id: string; label: string }> = [];
      let repaired = 0;

      tenantFilter(db.list("assets"), tenantId).forEach((asset) => {
        const details = assetDetails(asset);
        if (details.customLabel || details.labelAutoFixedAt) return;
        const rawLabel = String(asset.label ?? "").trim();
        const vin = detailVin(details);
        const labelVin = normalizeVin(rawLabel);
        const candidate =
          !rawLabel ||
          looksLikeVin(rawLabel) ||
          (vin.length > 0 && labelVin === vin);
        if (!candidate) return;

        const nextDetails = {
          ...details,
          previousLabel: details.previousLabel ?? rawLabel,
          labelSource: "backfill_derive",
          labelAutoFixedAt: nowIso(),
        };
        const nextLabel = deriveAssetLabel(asset.type, nextDetails);
        const updated = db.update("assets", asset.id, {
          label: nextLabel,
          details: nextDetails,
        });
        if (!updated) return;
        repaired += 1;
        if (decodeQueue.length < 100 && assetNeedsVinDecode(updated)) {
          decodeQueue.push({ id: updated.id, label: updated.label });
        }
      });

      if (decodeQueue.length > 0) {
        void (async () => {
          for (const item of decodeQueue) {
            await upgradeVehicleAssetLabelFromVin(item.id, item.label);
          }
        })();
      }

      return repaired;
    },
  },

  // ------------ Quote requests ------------
  quotes: {
    listByCustomer(customerId: string): QuoteRequest[] {
      return db.list("quoteRequests").filter((q) => q.customerId === customerId);
    },
    listByTenant(tenantId: string): QuoteRequest[] {
      return tenantFilter(db.list("quoteRequests"), tenantId);
    },
    listIncompleteWorkflows(tenantId: string): QuoteRequest[] {
      return this.listByTenant(tenantId)
        .filter((q) => q.status === "quote_started")
        .sort((a, b) => {
          const at = a.lastTouchedAt ?? a.createdAt;
          const bt = b.lastTouchedAt ?? b.createdAt;
          return at < bt ? 1 : -1;
        });
    },
    get(id: string): QuoteRequest | undefined {
      return db.list("quoteRequests").find((q) => q.id === id);
    },
    create(input: Omit<QuoteRequest, "id" | "createdAt">): QuoteRequest {
      const row: QuoteRequest = { ...input, id: uid("quote"), createdAt: nowIso() };
      db.insert("quoteRequests", row);
      return row;
    },
    update(id: string, patch: Partial<QuoteRequest>) {
      return db.update("quoteRequests", id, patch);
    },
    findOpenIncomplete(input: {
      tenantId: string;
      customerId: string;
      categoryId?: string;
      assetType?: AssetType;
    }): QuoteRequest | undefined {
      return db
        .list("quoteRequests")
        .find(
          (q) =>
            q.tenantId === input.tenantId &&
            q.customerId === input.customerId &&
            q.status === "quote_started" &&
            (input.categoryId
              ? q.categoryId === input.categoryId
              : input.assetType
              ? q.assetType === input.assetType
              : true)
        );
    },
    recordIncompleteWorkflow(input: {
      tenantId: string;
      customerId: string;
      assetType: AssetType;
      lineOfBusiness?: "personal" | "commercial";
      categoryId?: string;
      categoryLabel?: string;
      contactName: string;
      contactEmail?: string;
      contactPhone?: string;
      assetIdentifier?: string;
      parsedData?: Record<string, unknown>;
      currentStep: string;
      completionPercent: number;
      assignedAgentId?: string;
      createdById?: string;
    }): QuoteRequest {
      const touchedAt = nowIso();
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      const inheritedOwnerIds = assignedContactOwners(customer);
      const assignedAgentId = input.assignedAgentId ?? inheritedOwnerIds[0];
      const additionalAssignedToIds = input.assignedAgentId
        ? undefined
        : inheritedOwnerIds.length > 1
          ? inheritedOwnerIds.slice(1)
          : undefined;
      const contactName = input.contactName.trim() || customer?.name || "Customer";
      const firstName = contactName.split(/\s+/)[0] || "there";
      const categoryLabel = input.categoryLabel ?? quoteStatusLabel("quote_started");
      const lineLabel =
        input.lineOfBusiness === "commercial" ? "commercial" : "personal";
      const assetLabel = api.helpers.assetTypeLabel(input.assetType);
      const stoppedAt = input.currentStep.toLowerCase();
      const title = `${contactName} stopped mid-quote: ${categoryLabel}`;
      const description = `${contactName} started a ${categoryLabel} ${lineLabel}-lines quote but stopped at ${stoppedAt}. Follow up while the request is fresh.`;
      const subject = `Finish your ${categoryLabel.toLowerCase()} quote`;
      const body = [
        `Hi ${firstName},`,
        "",
        `I saw you started your ${categoryLabel.toLowerCase()} quote and stopped around the ${stoppedAt} section. I can help you finish it from here if anything was unclear.`,
        "",
        input.assetIdentifier
          ? `I have the ${assetLabel.toLowerCase()} reference you entered as: ${input.assetIdentifier}.`
          : `Once you send the missing detail, I can move the quote forward with the right carrier options.`,
        "",
        `Reply here or reopen the quote whenever you're ready and we'll keep it moving.`,
      ].join("\n");

      const parsedData: Record<string, unknown> = {
        ...(input.parsedData ?? {}),
        lineOfBusiness: input.lineOfBusiness,
        categoryId: input.categoryId,
        categoryLabel,
        contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        assetIdentifier: input.assetIdentifier,
        currentStep: input.currentStep,
        completionPercent: Math.max(0, Math.min(100, input.completionPercent)),
      };
      const open = this.findOpenIncomplete({
        tenantId: input.tenantId,
        customerId: input.customerId,
        categoryId: input.categoryId,
        assetType: input.assetType,
      });

      let taskId = open?.recoveryTaskId;
      if (taskId) {
        db.update("tasks", taskId, {
          title,
          description,
          aiSummary: description,
          aiReplySubject: subject,
          aiReplyBody: body,
          assignedToId: assignedAgentId,
          additionalAssignedToIds,
          awaitingManagerAssignment: assignedAgentId ? false : true,
          severityReason: `Customer quote is ${Math.max(
            0,
            Math.min(100, input.completionPercent)
          )}% complete and stopped at ${input.currentStep}.`,
        });
      } else {
        const task: Task = {
          id: uid("task"),
          tenantId: input.tenantId,
          title,
          description,
          customerId: input.customerId,
          source: "ai_notification",
          status: "open",
          topic: "policy_edit_request",
          severity: "warning",
          severityReason: `Customer quote is ${Math.max(
            0,
            Math.min(100, input.completionPercent)
          )}% complete and stopped at ${input.currentStep}.`,
          aiSummary: description,
          aiReplySubject: subject,
          aiReplyBody: body,
          assignedToId: assignedAgentId,
          additionalAssignedToIds,
          awaitingManagerAssignment: assignedAgentId ? undefined : true,
          createdById: input.createdById ?? "ai",
          expressQuoteFollowUp: true,
          createdAt: touchedAt,
        };
        db.insert("tasks", task);
        taskId = task.id;
        logTaskAudit({
          tenantId: input.tenantId,
          actorId: input.createdById ?? "ai",
          action: "task.created_from_incomplete_quote",
          taskId,
          metadata: {
            customerId: input.customerId,
            categoryId: input.categoryId,
            currentStep: input.currentStep,
          },
        });
      }

      const patch: Partial<QuoteRequest> = {
        tenantId: input.tenantId,
        customerId: input.customerId,
        assetType: input.assetType,
        lineOfBusiness: input.lineOfBusiness,
        categoryId: input.categoryId,
        categoryLabel,
        rawDescription: `Incomplete customer quote (${lineLabel} lines): ${categoryLabel}. Stopped at ${input.currentStep}.`,
        parsedData,
        missingDocuments: [],
        status: "quote_started",
        assignedAgentId,
        currentStep: input.currentStep,
        completionPercent: Math.max(0, Math.min(100, input.completionPercent)),
        lastTouchedAt: touchedAt,
        abandonedAt: touchedAt,
        recoveryTaskId: taskId,
        aiReplySubject: subject,
        aiReplyBody: body,
      };

      if (open) {
        const updated = db.update("quoteRequests", open.id, patch);
        return updated ?? open;
      }

      const row: QuoteRequest = {
        ...(patch as Omit<QuoteRequest, "id" | "createdAt">),
        id: uid("quote"),
        createdAt: touchedAt,
      };
      db.insert("quoteRequests", row);
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: "system",
        message: `${contactName} started a ${categoryLabel} quote and stopped at ${input.currentStep}.`,
        visibility: "internal",
        customerId: input.customerId,
        createdAt: touchedAt,
      });
      return row;
    },
    submitCustomerQuote(input: Omit<QuoteRequest, "id" | "createdAt">): QuoteRequest {
      const existing = this.findOpenIncomplete({
        tenantId: input.tenantId,
        customerId: input.customerId,
        categoryId: input.categoryId,
        assetType: input.assetType,
      });
      if (!existing) return this.create({ ...input, submittedAt: nowIso() });

      if (existing.recoveryTaskId) {
        db.update("tasks", existing.recoveryTaskId, {
          status: "resolved",
          completedAt: nowIso(),
          completedById: "system",
        });
        logTaskAudit({
          tenantId: input.tenantId,
          actorId: "system",
          action: "task.resolved_by_quote_submission",
          taskId: existing.recoveryTaskId,
          metadata: { quoteRequestId: existing.id },
        });
      }
      const updated = db.update("quoteRequests", existing.id, {
        ...input,
        status: "submitted_to_agent",
        currentStep: "submitted to agent",
        completionPercent: 100,
        lastTouchedAt: nowIso(),
        submittedAt: nowIso(),
      });
      return updated ?? existing;
    },
  },

  // ------------ Policies ------------
  policies: {
    listByCustomer(customerId: string): Policy[] {
      return db.list("policies").filter((p) => p.customerId === customerId);
    },
    listActiveByCustomer(customerId: string): Policy[] {
      return this.listByCustomer(customerId).filter((p) => p.status !== "closed");
    },
    listPreviousByCustomer(customerId: string): Policy[] {
      return this.listByCustomer(customerId)
        .filter((p) => p.status === "closed")
        .sort((a, b) => ((a.closedAt ?? a.createdAt) < (b.closedAt ?? b.createdAt) ? 1 : -1));
    },
    listByTenant(tenantId: string): Policy[] {
      return tenantFilter(db.list("policies"), tenantId);
    },
    listByAsset(assetId: string): Policy[] {
      return db.list("policies").filter((p) => p.assetId === assetId);
    },
    get(id: string): Policy | undefined {
      return db.list("policies").find((p) => p.id === id);
    },
    create(input: Omit<Policy, "id" | "createdAt">): Policy {
      const row: Policy = { ...input, id: uid("policy"), createdAt: nowIso() };
      db.insert("policies", row);
      // Auto-convert the originating prospect (if any) once the
      // first policy lands for this customer. Safety net for the
      // case where an agent adds a policy without explicitly
      // clicking "Convert to client" first — a person who has a
      // bound policy is by definition no longer a prospect.
      const earlierPolicies = db
        .list("policies")
        .filter((p) => p.customerId === input.customerId && p.id !== row.id);
      if (earlierPolicies.length === 0) {
        const linkedProspect = db
          .list("prospects")
          .find((p) => p.customerId === input.customerId);
        if (linkedProspect && linkedProspect.status !== "converted") {
          db.update("prospects", linkedProspect.id, { status: "converted" });
          db.insert("statusEvents", {
            id: uid("se"),
            tenantId: input.tenantId,
            source: "system",
            message: `${linkedProspect.name} auto-converted to client (first policy bound).`,
            visibility: "internal",
            prospectId: linkedProspect.id,
            customerId: input.customerId,
            createdAt: nowIso(),
          });
        }
      }
      queueCarrierRunnerPolicyPlaced(row, input.agentId);
      ensureCarrierRunnerRenewalJob(row);
      return row;
    },
    update(id: string, patch: Partial<Policy>) {
      const updated = db.update("policies", id, patch);
      if (updated) {
        const billingTouched = Object.keys(patch).some((key) =>
          CARRIER_DOWNLOAD_POLICY_FIELDS.has(key as keyof Policy) &&
          String(key).toLowerCase().includes("billing")
        ) || "paymentFrequency" in patch || "nextPaymentDueDate" in patch || "nextPaymentAmount" in patch;
        if (billingTouched) ensureBillingIssueTask(updated, patch.agentId ?? updated.agentId ?? "ai");
        if (patch.status === "bound" || patch.status === "renewed") {
          queueCarrierRunnerPolicyPlaced(updated, patch.agentId ?? updated.agentId);
        }
        if ("renewalDate" in patch || "renewalStatus" in patch || patch.status === "renewal_upcoming") {
          ensureCarrierRunnerRenewalJob(updated);
        }
      }
      return updated;
    },
    close(id: string, actorId?: string): Policy | undefined {
      const before = this.get(id);
      if (!before) return undefined;
      if (before.status === "closed") return before;
      const updated = db.update("policies", id, {
        status: "closed",
        closedAt: nowIso(),
        closedById: actorId ?? "system",
      });
      if (updated) logPolicyMovedToPrevious(updated, actorId ?? "system");
      return updated ?? undefined;
    },
    retrieveFromCarrier(input: {
      tenantId: string;
      customerId: string;
      createdById?: string;
      policyIds?: string[];
    }): { checked: number; updated: number; jobIds: string[]; summary: string } {
      const customer = db
        .list("customers")
        .find((row) => row.id === input.customerId && row.tenantId === input.tenantId);
      if (!customer) {
        return {
          checked: 0,
          updated: 0,
          jobIds: [],
          summary: "Client record could not be found.",
        };
      }
      const allow = new Set(input.policyIds ?? []);
      const activeCustomerPolicies = this.listActiveByCustomer(input.customerId);
      const targetPolicies = activeCustomerPolicies.filter(
        (policy) =>
          policy.tenantId === input.tenantId &&
          (allow.size === 0 || allow.has(policy.id)) &&
          policyAllowedForCarrierRunner(policy)
      );
      let checked = 0;
      let updated = 0;
      const jobIds: string[] = [];
      if (activeCustomerPolicies.length === 0) {
        if (!carrierRunnerEnabledForTenant(input.tenantId)) {
          return {
            checked,
            updated,
            jobIds,
            summary: "Carrier policy retrieval is not configured for this agency.",
          };
        }
        const linkedCarrierIds = activeCarrierIdsForTenant(input.tenantId);
        linkedCarrierIds.forEach((carrierId) => {
          const carrierLabel = carrierName(carrierId);
          const job = createCarrierRunnerJobOnce({
            tenantId: input.tenantId,
            trigger: "policy_check",
            carrierId,
            customerId: customer.id,
            createdById: input.createdById ?? "ai",
            title: `Policy search: ${customer.name} at ${carrierLabel}`,
            reason: `Search ${carrierLabel} for policy records matching ${customer.name}. Import only carrier-verified policy data tied to this client.`,
          });
          if (!job) return;
          checked += 1;
          jobIds.push(job.id);
        });
        return {
          checked,
          updated,
          jobIds,
          summary:
            checked === 0
              ? "No linked carrier portals are available for policy retrieval."
              : `Started policy retrieval across ${checked} linked carrier portal${checked === 1 ? "" : "s"}. Any verified policies found will be added to this client.`,
        };
      }
      targetPolicies.forEach((policy) => {
        const job = createCarrierRunnerJobOnce({
          tenantId: input.tenantId,
          trigger: "policy_check",
          policy,
          createdById: input.createdById ?? policy.agentId ?? "ai",
          reason: `Retrieve current carrier policy record for ${policyRef(policy)} and apply any policy, billing, renewal, document, or claim updates found on the carrier portal.`,
        });
        if (!job) return;
        checked += 1;
        jobIds.push(job.id);
        const started = db.update("carrierRunnerJobs", job.id, {
          status: "running",
          startedAt: job.startedAt ?? nowIso(),
          startedById: input.createdById ?? "ai",
          lastAttemptAt: nowIso(),
          attempts: job.attempts + 1,
        });
        const refreshed = db.update("policies", policy.id, {
          billingLastVerifiedAt: nowIso(),
        });
        if (refreshed) updated += 1;
        const completed = db.update("carrierRunnerJobs", job.id, {
          status: "completed",
          completedAt: nowIso(),
          completedById: input.createdById ?? "ai",
          detectedOutcome: "no_change",
          resultSummary: "Carrier policy record was retrieved and current policy data is in the system.",
          errorMessage: undefined,
        });
        const finalJob = completed ?? started ?? job;
        logCarrierRunnerTimeline(
          finalJob,
          "Carrier policy record retrieved",
          "Current carrier policy data is in the system.",
          input.createdById ?? "ai"
        );
        const carrierLabel = carrierName(policy.carrierId);
        const message = `${carrierLabel} refreshed ${policyRef(policy)}. Current policy data is in the system.`;
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: policy.tenantId,
          source: "system",
          message,
          visibility: "internal",
          customerId: policy.customerId,
          assetId: policy.assetId,
          policyId: policy.id,
          createdAt: nowIso(),
          createdById: input.createdById ?? "system",
        });
        db.insert("notes", {
          id: uid("note"),
          tenantId: policy.tenantId,
          authorId: input.createdById ?? "system",
          customerId: policy.customerId,
          policyId: policy.id,
          body: message,
          visibility: "internal",
          createdAt: nowIso(),
        });
      });
      return {
        checked,
        updated,
        jobIds,
        summary:
          checked === 0
            ? "No active carrier-linked policies were available to retrieve."
            : `Retrieved ${checked} polic${checked === 1 ? "y" : "ies"} from carrier portals.`,
      };
    },
    setStatus(id: string, status: PolicyStatus) {
      return db.update("policies", id, { status });
    },
    // Customer-initiated "I want to change something on my policy"
    // request. Mirrors api.claims.submitInquiry: writes one
    // Communication row (so the message body lands in the agent's
    // inbox) and one status event tagged with the asset + policy
    // (so the timeline headline reads "Policy edit requested for
    // <Asset>" instead of a generic email).
    //
    // ALSO has the AI auto-send an acknowledgment email — the
    // customer gets an immediate reply (bucketed copy based on what
    // they asked for: limit change, named insured, address, usage,
    // deductible, cancellation, general). The agent is notified
    // via the Activity Center rather than gated on approving a draft.
    // The inbound request is auto-resolved by the AI so the
    // Clients pending-messages badge ticks down without the agent
    // having to mark it manually.
    requestEdit(input: {
      tenantId: string;
      customerId: string;
      assetId?: string;
      policyId?: string;
      body: string;
    }): {
      commId: string;
      statusEventId: string;
      // sentEmailId is null on requestEdit — the AI auto-reply
      // doesn't go out until the agent acknowledges the
      // notification in the Activity Center. Kept on the return
      // shape for callers (and tests) that already destructure it.
      sentEmailId: string | null;
      notificationId: string | null;
    } {
      const asset = input.assetId
        ? db.list("assets").find((a) => a.id === input.assetId)
        : undefined;
      const policy = input.policyId
        ? db.list("policies").find((p) => p.id === input.policyId)
        : undefined;
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
      const assetLabel = asset?.label ?? "an asset";
      const agencyName = tenant?.name ?? "your agency";
      const policyRef = policy?.policyNumber
        ? `Policy #${policy.policyNumber}`
        : policy
        ? `Policy #${policy.id.slice(-6).toUpperCase()}`
        : "policy pending";
      const subject = `Policy edit request — ${assetLabel}`;
      const sentAt = nowIso();
      const commId = uid("comm");
      // Inbound request is auto-resolved at insert because the AI
      // sends the customer-facing reply in the same transaction
      // below — no agent approval gate.
      db.insert("communications", {
        id: commId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        channel: "email",
        direction: "inbound",
        subject,
        body: input.body,
        createdAt: sentAt,
        resolvedAt: customer ? sentAt : undefined,
      });
      const statusEventId = uid("se");
      db.insert("statusEvents", {
        id: statusEventId,
        tenantId: input.tenantId,
        source: "customer",
        message: `Policy edit requested for ${assetLabel}. ${input.body}`,
        visibility: "customer_visible",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: policy?.id,
        createdAt: sentAt,
      });

      // AI auto-sends the acknowledgment email immediately — no
      // approval gate. The notification still appears in the
      // agent's Activity Center so they can pick up the carrier-
      // side follow-up, but the customer-facing reply is already
      // out the door.
      let sentEmailId: string | null = null;
      let notificationId: string | null = null;
      if (customer) {
        const firstName = customer.name.split(/\s+/)[0];
        const agent = customer.assignedAgentId
          ? db.list("users").find((u) => u.id === customer.assignedAgentId)
          : undefined;
        const agentName = agent?.name ?? `your agent at ${agencyName}`;
        const agentEmail = agent?.email;
        const classification = classifyEditRequest(input.body);
        const nextSteps = nextStepsForEditClass(classification);
        const summaryLine = summaryForEditClass(classification, input.body);

        const emailBody = [
          `Hi ${firstName},`,
          ``,
          `Thank you for sending over your request on ${assetLabel} (${policyRef}). ${summaryLine}`,
          ``,
          `Here's what happens next:`,
          ...nextSteps.map((s) => `  • ${s}`),
          ``,
          `If anything above isn't quite what you meant, reply to this email and I'll adjust before we ping the carrier.`,
          ``,
          `${agentName}${agentEmail ? `\n${agentEmail}` : ""}`,
          agencyName,
        ].join("\n");

        sentEmailId = uid("msg");
        db.insert("messages", {
          id: sentEmailId,
          tenantId: input.tenantId,
          campaignId: "campaign_policy_edits",
          customerId: input.customerId,
          channel: "email",
          subject: `Re: ${subject}`,
          content: emailBody,
          deliveryStatus: "sent",
          sentAt,
          createdAt: sentAt,
        });
        // Outbound communication mirror so the reply shows up on
        // the customer-facing timeline.
        db.insert("communications", {
          id: uid("comm"),
          tenantId: input.tenantId,
          customerId: input.customerId,
          channel: "email",
          direction: "outbound",
          subject: `Re: ${subject}`,
          body: emailBody,
          createdAt: sentAt,
        });
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: input.tenantId,
          source: "ai",
          message: `AI auto-sent acknowledgment to ${customer.name} for their policy-edit request (${editClassLabel(classification)}).`,
          visibility: "internal",
          customerId: input.customerId,
          assetId: input.assetId,
          policyId: policy?.id,
          createdAt: sentAt,
          marketingCampaignId: "campaign_policy_edits",
          marketingMessageId: sentEmailId,
        });

        // Topic + severity used by the Activity Center to render
        // the summary line, severity bar, and filter chips.
        const topic =
          classification === "cancellation"
            ? "cancellation_request"
            : classification === "coverage_limit" ||
              classification === "deductible"
            ? "coverage_change"
            : classification === "named_insured" ||
              classification === "address" ||
              classification === "usage"
            ? "endorsement_request"
            : "policy_edit_request";
        // AI severity classifier — looks at the topic + raw body so
        // urgent language ("today", "lawsuit", "accident") promotes
        // the card to red even when the classification bucket is a
        // run-of-the-mill endorsement.
        const { severity, reason: severityReason } = aiClassifyCustomerSeverity({
          topic,
          body: input.body,
          classification,
        });
        const aiSummary = [
          `${customer.name} submitted a ${editClassLabel(classification).toLowerCase()} request on ${assetLabel} (${policyRef}).`,
          `The AI sent the acknowledgment; your follow-up is to confirm the change with the carrier and close the loop.`,
        ].join(" ");

        notificationId = uid("ain");
        db.insert("aiNotifications", {
          id: notificationId,
          tenantId: input.tenantId,
          kind: "policy_edit_reply",
          title: `Customer received automated message regarding ${topicLabel(topic)}. Please contact carrier and service customer.`,
          summary: `${editClassLabel(classification)} on ${assetLabel}.`,
          customerId: input.customerId,
          assetId: input.assetId,
          policyId: policy?.id,
          messageId: sentEmailId,
          communicationId: commId,
          createdAt: sentAt,
          topic,
          severity,
          severityReason,
          aiSummary,
          aiReplyBody: emailBody,
          aiReplySubject: `Re: ${subject}`,
          originalMessageContent: input.body,
          originalMessageId: commId,
          assignedToId: customer.assignedAgentId,
        });
      }

      return { commId, statusEventId, sentEmailId, notificationId };
    },
  },

  // ------------ Deposits & payments ------------
  deposits: {
    listByCustomer(customerId: string): Deposit[] {
      return db.list("deposits").filter((d) => d.customerId === customerId);
    },
    listByPolicy(policyId: string): Deposit[] {
      return db.list("deposits").filter((d) => d.policyId === policyId);
    },
    listByQuote(quoteRequestId: string): Deposit[] {
      return db.list("deposits").filter((d) => d.quoteRequestId === quoteRequestId);
    },
    listByTenant(tenantId: string): Deposit[] {
      return tenantFilter(db.list("deposits"), tenantId);
    },
    create(input: Omit<Deposit, "id" | "createdAt">): Deposit {
      const row: Deposit = { ...input, id: uid("deposit"), createdAt: nowIso() };
      db.insert("deposits", row);
      return row;
    },
    update(id: string, patch: Partial<Deposit>) {
      return db.update("deposits", id, patch);
    },
  },
  payments: {
    listByPolicy(policyId: string): Payment[] {
      return db.list("payments").filter((p) => p.policyId === policyId);
    },
    listByCustomer(customerId: string): Payment[] {
      return db.list("payments").filter((p) => p.customerId === customerId);
    },
  },

  // ------------ Staff accounting / timesheets ------------
  accountingSettings: {
    get(tenantId: string): AccountingSettings {
      const existing = db.list("accountingSettings").find((settings) => settings.tenantId === tenantId);
      if (existing) {
        if (!Array.isArray(existing.timesheetRecipientIds)) {
          const updated = db.update("accountingSettings", existing.id, {
            timesheetRecipientIds: defaultTimesheetRecipientIds(tenantId),
            updatedAt: nowIso(),
          });
          return updated ?? { ...existing, timesheetRecipientIds: defaultTimesheetRecipientIds(tenantId) };
        }
        return existing;
      }
      const row: AccountingSettings = {
        id: uid("acct_settings"),
        tenantId,
        ...DEFAULT_TIMESHEET_SETTINGS,
        timesheetRecipientIds: defaultTimesheetRecipientIds(tenantId),
        updatedAt: nowIso(),
      };
      db.insert("accountingSettings", row);
      return row;
    },
    update(
      tenantId: string,
      patch: Partial<
        Pick<
          AccountingSettings,
          "timesheetFrequency" | "dueWeekday" | "dueDayOfMonth" | "reminderTime" | "timesheetRecipientIds"
        >
      >,
      byUserId?: string
    ): AccountingSettings {
      const current = this.get(tenantId);
      const updated = db.update("accountingSettings", current.id, {
        ...patch,
        timesheetRecipientIds: Array.isArray(patch.timesheetRecipientIds)
          ? Array.from(new Set(patch.timesheetRecipientIds))
          : current.timesheetRecipientIds,
        updatedAt: nowIso(),
        updatedById: byUserId,
      });
      const next = updated ?? current;
      this.notifyTimesheetRecipients(tenantId, byUserId);
      return next;
    },
    notifyTimesheetRecipients(tenantId: string, byUserId?: string): AiNotification[] {
      const settings = this.get(tenantId);
      const summary = timesheetNotificationSummary(settings);
      const recipients = Array.from(new Set(settings.timesheetRecipientIds)).filter((id) => {
        const user = db.list("users").find((u) => u.id === id);
        return !!user && user.tenantId === tenantId && user.active;
      });
      return recipients.map((assignedToId) => {
        const existing = db
          .list("aiNotifications")
          .find(
            (notification) =>
              notification.tenantId === tenantId &&
              notification.kind === "timesheet_due" &&
              notification.assignedToId === assignedToId &&
              !notification.acknowledgedAt &&
              notification.summary === summary
          );
        if (existing) return existing;
        const row: AiNotification = {
          id: uid("ain"),
          tenantId,
          kind: "timesheet_due",
          title: "Timesheet due",
          summary,
          assignedToId,
          severity: "info",
          topic: "other",
          createdAt: nowIso(),
        };
        db.insert("aiNotifications", row);
        return row;
      });
    },
    currentPeriod(tenantId: string) {
      return currentTimesheetPeriod(this.get(tenantId));
    },
  },

  timesheets: {
    listByTenant(tenantId: string): Timesheet[] {
      return tenantFilter(db.list("timesheets"), tenantId).sort((a, b) =>
        (a.submittedAt ?? a.updatedAt) < (b.submittedAt ?? b.updatedAt) ? 1 : -1
      );
    },
    listByUser(tenantId: string, userId: string): Timesheet[] {
      return this.listByTenant(tenantId).filter((timesheet) => timesheet.userId === userId);
    },
    get(id: string): Timesheet | undefined {
      return db.list("timesheets").find((timesheet) => timesheet.id === id);
    },
    ensureCurrent(tenantId: string, userId: string): Timesheet {
      const settings = api.accountingSettings.get(tenantId);
      const period = currentTimesheetPeriod(settings);
      const existing = db
        .list("timesheets")
        .find(
          (timesheet) =>
            timesheet.tenantId === tenantId &&
            timesheet.userId === userId &&
            timesheet.periodStart === period.periodStart &&
            timesheet.periodEnd === period.periodEnd
        );
      if (existing) return existing;
      const now = nowIso();
      const row: Timesheet = {
        id: uid("timesheet"),
        tenantId,
        userId,
        ...period,
        status: "draft",
        entries: [],
        totalHours: 0,
        createdAt: now,
        updatedAt: now,
      };
      db.insert("timesheets", row);
      return row;
    },
    saveDraft(
      id: string,
      input: {
        entries: TimesheetEntry[];
        notes?: string;
      }
    ): Timesheet | null {
      const existing = this.get(id);
      if (!existing || existing.status === "approved") return existing ?? null;
      return db.update("timesheets", id, {
        entries: input.entries,
        notes: input.notes,
        totalHours: totalTimesheetHours(input.entries),
        status: existing.status === "submitted" ? "submitted" : "draft",
        updatedAt: nowIso(),
      });
    },
    submit(
      id: string,
      input: {
        entries: TimesheetEntry[];
        notes?: string;
      }
    ): Timesheet | null {
      const existing = this.get(id);
      if (!existing || existing.status === "approved") return existing ?? null;
      const submittedAt = nowIso();
      return db.update("timesheets", id, {
        entries: input.entries,
        notes: input.notes,
        totalHours: totalTimesheetHours(input.entries),
        status: "submitted",
        submittedAt,
        updatedAt: submittedAt,
      });
    },
    review(id: string, status: Extract<TimesheetStatus, "approved" | "needs_revision">, reviewedById: string, managerNotes?: string) {
      const reviewedAt = nowIso();
      return db.update("timesheets", id, {
        status,
        reviewedAt,
        reviewedById,
        managerNotes,
        updatedAt: reviewedAt,
      });
    },
    needsSubmissionToday(tenantId: string, userId: string): boolean {
      const settings = api.accountingSettings.get(tenantId);
      const period = currentTimesheetPeriod(settings);
      if (!isDueTodayOrPast(period.dueDate)) return false;
      const sheet = db
        .list("timesheets")
        .find(
          (timesheet) =>
            timesheet.tenantId === tenantId &&
            timesheet.userId === userId &&
            timesheet.periodStart === period.periodStart &&
            timesheet.periodEnd === period.periodEnd
        );
      return !sheet || sheet.status === "draft" || sheet.status === "needs_revision";
    },
    pendingManagerCount(tenantId: string): number {
      return this.listByTenant(tenantId).filter((timesheet) => timesheet.status === "submitted").length;
    },
  },

  // ------------ HR submissions ------------
  hr: {
    listByTenant(tenantId: string): HrSubmission[] {
      return tenantFilter(db.list("hrSubmissions"), tenantId).sort((a, b) =>
        a.submittedAt < b.submittedAt ? 1 : -1
      );
    },
    listForUser(tenantId: string, userId: string): HrSubmission[] {
      return this.listByTenant(tenantId).filter((submission) => submission.submittedById === userId);
    },
    get(id: string): HrSubmission | undefined {
      return db.list("hrSubmissions").find((submission) => submission.id === id);
    },
    create(input: {
      tenantId: string;
      kind: HrSubmissionKind;
      anonymous: boolean;
      submittedById?: string;
      coworkerName?: string;
      subject: string;
      message: string;
    }): HrSubmission {
      const submittedAt = nowIso();
      const row: HrSubmission = {
        id: uid("hr"),
        tenantId: input.tenantId,
        kind: input.kind,
        anonymous: input.anonymous,
        submittedById: input.anonymous ? undefined : input.submittedById,
        coworkerName: input.kind === "complaint" ? input.coworkerName?.trim() : undefined,
        subject: input.subject.trim(),
        message: input.message.trim(),
        status: "new",
        submittedAt,
      };
      db.insert("hrSubmissions", row);
      return row;
    },
    updateStatus(id: string, status: HrSubmissionStatus, reviewedById: string, managerNotes?: string) {
      return db.update("hrSubmissions", id, {
        status,
        reviewedById,
        reviewedAt: nowIso(),
        managerNotes,
      });
    },
    newCount(tenantId: string): number {
      return this.listByTenant(tenantId).filter((submission) => submission.status === "new").length;
    },
  },

  // ------------ Prospects ------------
  prospects: {
    listByTenant(
      tenantId: string,
      opts?: { includeArchived?: boolean; includeConverted?: boolean }
    ): Prospect[] {
      const all = tenantFilter(db.list("prospects"), tenantId);
      return all.filter((p) => {
        if (!opts?.includeArchived && p.archived) return false;
        // Converted prospects graduate into the Clients category and
        // disappear from the prospect queue. Their history is
        // back-filled onto the customer record at convert() time so
        // nothing is lost. Pass includeConverted to include them
        // (used by the "Converted" tab filter on ProspectsPage).
        if (!opts?.includeConverted && p.status === "converted") return false;
        return true;
      });
    },
    listVisible(
      tenantId: string,
      viewer: { id: string; role: Role } | undefined,
      opts?: { includeArchived?: boolean; includeConverted?: boolean }
    ): Prospect[] {
      const all = this.listByTenant(tenantId, opts);
      if (!viewer) return [];
      if (viewer.role === "master_admin") return all;
      if (viewer.role === "manager" || viewer.role === "agent" || viewer.role === "csr") {
        return all;
      }
      return [];
    },
    listOwned(
      tenantId: string,
      viewer: { id: string; role: Role } | undefined,
      opts?: { includeArchived?: boolean; includeConverted?: boolean }
    ): Prospect[] {
      const all = this.listByTenant(tenantId, opts);
      if (!viewer) return [];
      if (viewer.role === "master_admin") return all;
      if (viewer.role === "agent" || viewer.role === "manager" || viewer.role === "csr") {
        return all.filter((p) => contactIsOwnedBy(p, viewer.id));
      }
      return [];
    },
    canSee(
      prospect: Prospect | undefined | null,
      viewer: { id: string; role: Role } | undefined
    ): boolean {
      if (!prospect || !viewer) return false;
      if (viewer.role === "master_admin") return true;
      if (viewer.role === "manager" || viewer.role === "agent" || viewer.role === "csr") {
        const viewerUser = db.list("users").find((u) => u.id === viewer.id);
        return viewerUser ? viewerUser.tenantId === prospect.tenantId : true;
      }
      return false;
    },
    listArchived(tenantId: string): Prospect[] {
      return tenantFilter(db.list("prospects"), tenantId).filter((p) => p.archived);
    },
    get(id: string): Prospect | undefined {
      return db.list("prospects").find((p) => p.id === id);
    },
    create(input: Omit<Prospect, "id" | "createdAt"> & { skipAutoRoute?: boolean }): Prospect {
      const { skipAutoRoute, ...prospectInput } = input;
      const autoAgent = !hasContactAssignment(prospectInput) && !skipAutoRoute
        ? chooseAutoRouteAgent(prospectInput.tenantId, contactLine(prospectInput))
        : undefined;
      const row: Prospect = {
        ...prospectInput,
        assignedAgentId: prospectInput.assignedAgentId ?? autoAgent?.id,
        id: uid("prospect"),
        createdAt: nowIso(),
      };
      db.insert("prospects", row);
      if (autoAgent) {
        spawnProspectRoutingTask(row, autoAgent.id, "ai");
        logContactRoutingEvent({
          tenantId: row.tenantId,
          kind: "prospect",
          contactId: row.id,
          contactName: row.name,
          before: { ...row, assignedAgentId: undefined, additionalAgentIds: undefined, assignedCsrId: undefined },
          after: row,
          byUserId: "ai",
        });
      }
      // Auto-send the intake email if the tenant's marketing
      // config says to. Manager turns this off (or changes the
      // style + attachments) under AI marketing → Marketing
      // configuration. Wrapped in try/catch so a config-side
      // error never blocks a prospect from being created.
      try {
        const cfg = api.marketing.getConfig(input.tenantId);
        if (cfg.autoSendOnNewProspect) {
          api.marketing.autoSendProspectOutreach({
            tenantId: input.tenantId,
            prospectId: row.id,
          });
        }
      } catch {
        /* ignore — auto-send is best-effort */
      }
      return row;
    },
    update(id: string, patch: Partial<Prospect>) {
      return db.update("prospects", id, patch);
    },
    setStatus(id: string, status: ProspectStatus) {
      // Conversion to "converted" must go through `convert` so the
      // assigned-agent precondition is enforced consistently. The
      // dropdown UI on ProspectDetailPage hides "converted" when the
      // prospect is unassigned, but a defense-in-depth guard here
      // means future call sites (or stale UIs) can't bypass the rule.
      if (status === "converted") {
        const existing = db.list("prospects").find((p) => p.id === id);
        if (existing && !existing.assignedAgentId) {
          throw new Error(
            "Cannot mark a prospect as converted until a manager assigns them to an agent. Use api.prospects.convert() once assigned."
          );
        }
      }
      return db.update("prospects", id, { status });
    },
    assignAgent(id: string, agentId: string, byUserId?: string) {
      const before = db.list("prospects").find((p) => p.id === id);
      const updated = db.update("prospects", id, {
        assignedAgentId: agentId,
        routingDismissedAt: undefined,
        routingDismissedById: undefined,
      });
      // When a prospect goes from unassigned → assigned (the
      // routing transition), spawn an Activity Center task on the
      // new agent's queue so they actually see the new work.
      if (updated && before && !hasContactAssignment(before) && agentId) {
        spawnProspectRoutingTask(updated, agentId, byUserId);
      }
      if (before && updated) {
        logContactRoutingEvent({
          tenantId: updated.tenantId,
          kind: "prospect",
          contactId: updated.id,
          contactName: updated.name,
          before,
          after: updated,
          byUserId,
        });
      }
      return updated;
    },
    // Multi-agent variant. First id becomes the primary owner,
    // rest go into additionalAgentIds. Every newly-routed agent
    // gets a Task spawned on their queue.
    assignAgents(
      id: string,
      agentIds: string[],
      byUserId?: string,
      options?: { csrId?: string | null; csrIds?: string[] }
    ) {
      if (agentIds.length === 0) return null;
      const before = db.list("prospects").find((p) => p.id === id);
      const selectedUsers = agentIds
        .map((aid) => db.list("users").find((u) => u.id === aid && u.tenantId === before?.tenantId))
        .filter((u): u is User => !!u && isRoutableStaffRole(u.role));
      if (!before || selectedUsers.length === 0) return null;
      const previouslyAssigned = new Set(contactOwnerIds(before));
      const agentUsers = selectedUsers.filter((u) => u.role === "agent" || u.role === "manager");
      if (agentUsers.length === 0) return null;
      const [primary, ...rest] = agentUsers.map((u) => u.id);
      const requestedCsrIds = options
        ? options.csrIds ?? (options.csrId ? [options.csrId] : [])
        : [before.assignedCsrId, ...(before.additionalCsrIds ?? [])].filter(Boolean);
      const csrIds = Array.from(
        new Set(
          requestedCsrIds
            .map((cid) => db.list("users").find((u) => u.id === cid && u.tenantId === before.tenantId && u.role === "csr")?.id)
            .filter((cid): cid is string => !!cid)
        )
      );
      const [csrId, ...additionalCsrIds] = csrIds;
      const updated = db.update("prospects", id, {
        assignedAgentId: primary ?? before.assignedAgentId,
        additionalAgentIds: rest.length > 0 ? rest : undefined,
        assignedCsrId: csrId,
        additionalCsrIds: additionalCsrIds.length > 0 ? additionalCsrIds : undefined,
        routingDismissedAt: undefined,
        routingDismissedById: undefined,
      });
      if (updated) {
        [...agentUsers.map((u) => u.id), ...csrIds]
          .filter((aid): aid is string => !!aid && !previouslyAssigned.has(aid))
          .forEach((aid) => spawnProspectRoutingTask(updated, aid, byUserId));
        logContactRoutingEvent({
          tenantId: updated.tenantId,
          kind: "prospect",
          contactId: updated.id,
          contactName: updated.name,
          before,
          after: updated,
          byUserId,
        });
      }
      return updated;
    },
    // Promote a prospect to a paying client. Manager-controlled:
    // requires an assigned agent first so every new client lands
    // owned by someone (no "orphan" clients dropped onto the
    // manager's unassigned pile at conversion time). The new
    // customer + login are auto-assigned to the prospect's
    // assigned agent.
    convert(
      prospectId: string,
      opts?: { actorId?: string }
    ): {
      prospect: Prospect;
      customer: CustomerProfile;
      user: User;
      reusedExisting: boolean;
    } {
      const prospect = db.list("prospects").find((p) => p.id === prospectId);
      if (!prospect) throw new Error("Prospect not found.");
      // Authorization: only managers + the prospect's primary or
      // co-assigned agents can flip the conversion state. The actorId
      // is the staff member acting on the request; undefined skips
      // the check so internal callers (seed scripts, tests) keep
      // working.
      if (opts?.actorId) {
        const actor = db.list("users").find((u) => u.id === opts.actorId);
        if (actor) {
          const isManager = actor.role === "manager";
          const isAssignedAgent =
            actor.role === "agent" &&
            (prospect.assignedAgentId === actor.id ||
              (prospect.additionalAgentIds ?? []).includes(actor.id));
          if (!isManager && !isAssignedAgent) {
            throw new Error(
              "Only managers and the prospect's assigned agents can convert this prospect to a client."
            );
          }
        }
      }
      if (!prospect.assignedAgentId) {
        throw new Error(
          "A manager must assign this prospect to an agent (or themself) before they can be converted to a client."
        );
      }
      // If the prospect was already converted on a previous click,
      // return the existing customer instead of double-creating.
      if (prospect.customerId) {
        const existingCustomer = db.list("customers").find((c) => c.id === prospect.customerId);
        const existingUser = existingCustomer
          ? db.list("users").find((u) => u.id === existingCustomer.userId)
          : undefined;
        if (existingCustomer && existingUser) {
          return {
            prospect,
            customer: existingCustomer,
            user: existingUser,
            reusedExisting: true,
          };
        }
      }
      const newUser = api.users.create({
        role: "customer",
        tenantId: prospect.tenantId,
        email: prospect.email,
        name: prospect.name,
        phone: prospect.phone,
      });
      const customer = api.customers.create({
        tenantId: prospect.tenantId,
        userId: newUser.id,
        name: prospect.name,
        email: prospect.email,
        phone: prospect.phone,
        marketingOptInEmail: true,
        marketingOptInSms: false,
        assignedAgentId: prospect.assignedAgentId,
        assignedCsrId: prospect.assignedCsrId,
        additionalAgentIds:
          prospect.additionalAgentIds && prospect.additionalAgentIds.length > 0
            ? prospect.additionalAgentIds
            : undefined,
        additionalCsrIds:
          prospect.additionalCsrIds && prospect.additionalCsrIds.length > 0
            ? prospect.additionalCsrIds
            : undefined,
      });
      const updated = db.update("prospects", prospect.id, {
        status: "converted",
        customerId: customer.id,
      })!;
      // Transfer the prospect's activity timeline onto the customer
      // record so the client profile reads as one continuous history
      // from first-touch through conversion. We back-fill customerId
      // on every existing prospect-scoped status event; subsequent
      // events are written directly against customerId.
      db.list("statusEvents").forEach((e) => {
        if (e.prospectId === prospect.id && !e.customerId) {
          db.update("statusEvents", e.id, { customerId: customer.id });
        }
      });
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: prospect.tenantId,
        source: "agent",
        message: `${prospect.name} converted from prospect to client (assigned to agent).`,
        visibility: "internal",
        prospectId: prospect.id,
        customerId: customer.id,
        createdAt: nowIso(),
        createdById: opts?.actorId,
      });
      return { prospect: updated, customer, user: newUser, reusedExisting: false };
    },
    archive(id: string) {
      return db.update("prospects", id, { archived: true, archivedAt: nowIso() });
    },
    unarchive(id: string) {
      return db.update("prospects", id, { archived: false, archivedAt: undefined });
    },
    // Inverse of convert(). Takes a converted prospect, archives the
    // client record it generated (so they stop receiving outreach +
    // disappear from the active client roster), and flips the
    // prospect status back to "nurturing" so it shows up in the
    // prospect queue again. Refuses if the client now has active
    // policies — those need to be cancelled / migrated first.
    revertToProspect(prospectId: string, opts?: { actorId?: string }): Prospect {
      const prospect = db.list("prospects").find((p) => p.id === prospectId);
      if (!prospect) throw new Error("Prospect not found.");
      // Same authorization gate as convert(): managers + the
      // prospect's assigned agents only. Skips when actorId is
      // omitted so internal / test callers still work.
      if (opts?.actorId) {
        const actor = db.list("users").find((u) => u.id === opts.actorId);
        if (actor) {
          const isManager = actor.role === "manager";
          const isAssignedAgent =
            actor.role === "agent" &&
            (prospect.assignedAgentId === actor.id ||
              (prospect.additionalAgentIds ?? []).includes(actor.id));
          if (!isManager && !isAssignedAgent) {
            throw new Error(
              "Only managers and the prospect's assigned agents can revert this back to a prospect."
            );
          }
        }
      }
      if (!prospect.customerId) {
        throw new Error("This prospect was never converted to a client.");
      }
      const customer = db.list("customers").find((c) => c.id === prospect.customerId);
      if (customer) {
        const deadStatuses = new Set(["declined", "deposit_refunded"]);
        const livePolicies = db
          .list("policies")
          .filter((p) => p.customerId === customer.id && !deadStatuses.has(p.status));
        if (livePolicies.length > 0) {
          throw new Error(
            `Cannot revert — ${customer.name} still has ${livePolicies.length} active polic${
              livePolicies.length === 1 ? "y" : "ies"
            }. Cancel or migrate those first.`
          );
        }
        db.update("customers", customer.id, {
          archived: true,
          archivedAt: nowIso(),
        });
      }
      const updated = db.update("prospects", prospect.id, {
        status: "nurturing",
        customerId: undefined,
      })!;
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: prospect.tenantId,
        source: "agent",
        message: `${prospect.name} reverted from client back to prospect${
          customer ? ` (client record archived)` : ""
        }.`,
        visibility: "internal",
        prospectId: prospect.id,
        customerId: customer?.id,
        createdAt: nowIso(),
        createdById: opts?.actorId,
      });
      return updated;
    },
  },

  // ------------ Carriers ------------
  carriers: {
    list(): Carrier[] {
      return db.list("carriers");
    },
    directory(tenantId?: string) {
      return buildCarrierDirectory(tenantId ? this.listForTenant(tenantId) : this.list());
    },
    listForTenant(tenantId: string): Carrier[] {
      const links = db.list("carrierLinks").filter((l) => l.tenantId === tenantId && l.active);
      const ids = new Set(links.map((l) => l.carrierId));
      return db.list("carriers").filter((c) => ids.has(c.id));
    },
    get(id: string): Carrier | undefined {
      return db.list("carriers").find((c) => c.id === id);
    },
    create(input: Omit<Carrier, "id" | "createdAt">): Carrier {
      const row: Carrier = { ...input, id: uid("carrier"), createdAt: nowIso() };
      db.insert("carriers", row);
      return row;
    },
    update(id: string, patch: Partial<Carrier>) {
      return db.update("carriers", id, patch);
    },
    remove(id: string) {
      return db.remove("carriers", id);
    },
    links(): CarrierAgencyLink[] {
      return db.list("carrierLinks");
    },
    linkToAgency(
      carrierId: string,
      tenantId: string,
      options?: { importBatchId?: string }
    ): CarrierAgencyLink {
      const existing = db
        .list("carrierLinks")
        .find((l) => l.carrierId === carrierId && l.tenantId === tenantId);
      const agency = db.list("agencies").find((a) => a.id === tenantId);
      const carrier = db.list("carriers").find((c) => c.id === carrierId);
      if (existing) {
        db.update("carrierLinks", existing.id, { active: true });
        if (agency && carrier && !existing.active) {
          logAgencyActivity(
            agency,
            "agency_carrier_access_updated",
            "Carrier enabled for agency",
            `${carrier.name} was enabled for ${agency.name}.`,
            { carrier: carrier.name }
          );
        }
        return { ...existing, active: true };
      }
      const row: CarrierAgencyLink = {
        id: uid("link"),
        carrierId,
        tenantId,
        active: true,
        importBatchId: options?.importBatchId,
        createdAt: nowIso(),
      };
      db.insert("carrierLinks", row);
      if (agency && carrier) {
        logAgencyActivity(
          agency,
          "agency_carrier_access_updated",
          "Carrier enabled for agency",
          `${carrier.name} was enabled for ${agency.name}.`,
          { carrier: carrier.name }
        );
      }
      return row;
    },
    unlinkFromAgency(carrierId: string, tenantId: string) {
      const existing = db
        .list("carrierLinks")
        .find((l) => l.carrierId === carrierId && l.tenantId === tenantId);
      if (existing) {
        db.update("carrierLinks", existing.id, { active: false });
        if (existing.active) {
          const agency = db.list("agencies").find((a) => a.id === tenantId);
          const carrier = db.list("carriers").find((c) => c.id === carrierId);
          if (agency && carrier) {
            logAgencyActivity(
              agency,
              "agency_carrier_access_updated",
              "Carrier disabled for agency",
              `${carrier.name} was disabled for ${agency.name}.`,
              { carrier: carrier.name }
            );
          }
        }
      }
    },
  },

  // ------------ Carrier portal AI runner jobs ------------
  carrierRunnerJobs: {
    listByTenant(tenantId: string): CarrierRunnerJob[] {
      return tenantFilter(db.list("carrierRunnerJobs"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    listOpen(tenantId: string): CarrierRunnerJob[] {
      return this.listByTenant(tenantId).filter(carrierRunnerJobIsOpen);
    },
    get(id: string): CarrierRunnerJob | undefined {
      return db.list("carrierRunnerJobs").find((job) => job.id === id);
    },
    activeCarrierIds(tenantId: string): string[] {
      return activeCarrierIdsForTenant(tenantId);
    },
    queueForPolicy(
      policyId: string,
      trigger: CarrierRunnerJobTrigger,
      reason?: string,
      createdById?: string
    ): CarrierRunnerJob | null {
      const policy = db.list("policies").find((p) => p.id === policyId);
      if (!policy) return null;
      const renewal = renewalForPolicy(policy.id);
      return createCarrierRunnerJobOnce({
        tenantId: policy.tenantId,
        trigger,
        policy,
        renewal: trigger === "renewal_window" || trigger === "renewal_status_check" ? renewal : undefined,
        reason:
          reason ??
          `${carrierRunnerTriggerLabel(trigger)} requested. Runner signs into the carrier portal with the approved agency credential vault, retrieves current policy, renewal, billing, claims, and document data, and stages any updates for review.`,
        createdById,
      });
    },
    queuePolicyPlaced(policyId: string, createdById?: string): CarrierRunnerJob | null {
      const policy = db.list("policies").find((p) => p.id === policyId);
      return policy ? queueCarrierRunnerPolicyPlaced(policy, createdById) : null;
    },
    sweepRenewals(tenantId: string, now = nowIso()): CarrierRunnerJob[] {
      if (!carrierRunnerEnabledForTenant(tenantId)) return [];
      const jobs: CarrierRunnerJob[] = [];
      tenantFilter(db.list("policies"), tenantId).forEach((policy) => {
        const job = ensureCarrierRunnerRenewalJob(policy, now);
        if (job) jobs.push(job);
      });
      return jobs;
    },
    start(id: string, actorId?: string): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job || ["completed", "cancelled"].includes(job.status)) return job ?? null;
      const updated = db.update("carrierRunnerJobs", id, {
        status: "running",
        startedAt: job.startedAt ?? nowIso(),
        startedById: actorId ?? job.startedById ?? "ai",
        lastAttemptAt: nowIso(),
        attempts: job.attempts + 1,
      });
      if (updated) {
        logCarrierRunnerTimeline(
          updated,
          "Carrier portal check started",
          "Retrieving current carrier record data.",
          actorId ?? "ai"
        );
      }
      return updated;
    },
    markNeedsMfa(id: string, reason?: string): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("carrierRunnerJobs", id, {
        status: "needs_mfa",
        requiresMfa: true,
        mfaRequestedAt: nowIso(),
        errorMessage: reason ?? "Carrier portal requested MFA before the runner could continue.",
      });
      if (updated) {
        logCarrierRunnerTimeline(updated, "Carrier portal check paused for staff approval", updated.errorMessage);
        createCarrierRunnerExceptionTask(updated, updated.errorMessage ?? "Carrier portal requested MFA.");
      }
      return updated;
    },
    approveMfa(id: string, byUserId: string): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("carrierRunnerJobs", id, {
        status: "queued",
        requiresMfa: false,
        mfaApprovedById: byUserId,
        errorMessage: undefined,
      });
      if (updated) {
        logCarrierRunnerTimeline(updated, "Carrier portal approval completed", "Carrier portal check was released to continue.", byUserId);
      }
      return updated;
    },
    complete(
      id: string,
      input: {
        outcome?: CarrierRunnerJobOutcome;
        summary?: string;
        sourceReference?: string;
        completedById?: string;
        stageDownload?: {
          kind: CarrierDownloadKind;
          summary: string;
          changes?: CarrierDownloadChange[];
          documentPayload?: CarrierDownloadDocumentPayload;
          confidence?: number;
          effectiveDate?: string;
        };
      } = {}
    ): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job || job.status === "cancelled") return job ?? null;
      let carrierDownloadId: string | undefined;
      if (input.stageDownload) {
        const download = stageCarrierDownloadFromRunnerJob(job, {
          ...input.stageDownload,
          sourceReference: input.sourceReference,
        });
        carrierDownloadId = download.id;
      }
      const outcome = input.outcome ?? (carrierDownloadId ? "policy_update_staged" : "no_change");
      const summary =
        input.summary ??
        (carrierDownloadId
          ? "Carrier posted updates that were staged for staff review."
          : "Carrier portal was checked and no changes were found.");
      const updated = db.update("carrierRunnerJobs", id, {
        status: carrierDownloadId ? "staged_for_review" : "completed",
        completedAt: carrierDownloadId ? undefined : nowIso(),
        completedById: input.completedById ?? "ai",
        detectedOutcome: outcome,
        resultSummary: summary,
        sourceReference: input.sourceReference ?? job.sourceReference,
        carrierDownloadId,
        errorMessage: undefined,
      });
      if (updated) {
        if (outcome === "non_renewal_detected") {
          applyCarrierRunnerNonRenewal(updated, summary, input.completedById ?? "ai");
        }
        logCarrierRunnerTimeline(
          updated,
          carrierDownloadId ? "Carrier posted updates" : "Carrier portal check completed",
          summary,
          input.completedById ?? "ai"
        );
      }
      return updated;
    },
    markStagedReviewed(id: string, byUserId: string): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("carrierRunnerJobs", id, {
        status: "completed",
        completedAt: nowIso(),
        completedById: byUserId,
      });
      if (updated) {
        logCarrierRunnerTimeline(updated, "Carrier update review completed", "Staff completed review of the staged carrier update.", byUserId);
      }
      return updated;
    },
    fail(id: string, errorMessage: string, actorId?: string): CarrierRunnerJob | null {
      const job = this.get(id);
      if (!job) return null;
      const updated = db.update("carrierRunnerJobs", id, {
        status: "failed",
        errorMessage,
        lastAttemptAt: nowIso(),
      });
      if (updated) {
        logCarrierRunnerTimeline(updated, "Carrier portal check failed", errorMessage, actorId ?? "ai");
        createCarrierRunnerExceptionTask(updated, errorMessage);
      }
      return updated;
    },
    cancel(id: string, actorId?: string): CarrierRunnerJob | null {
      const updated = db.update("carrierRunnerJobs", id, {
        status: "cancelled",
        completedAt: nowIso(),
        completedById: actorId ?? "system",
      });
      if (updated) {
        logCarrierRunnerTimeline(updated, "Carrier portal check cancelled", "Carrier portal check was cancelled before completion.", actorId ?? "system");
      }
      return updated;
    },
  },

  // ------------ Carrier downloads / eDocs / policy sync ------------
  carrierDownloads: {
    listByTenant(tenantId: string): CarrierDownload[] {
      return tenantFilter(db.list("carrierDownloads"), tenantId).sort((a, b) =>
        a.receivedAt < b.receivedAt ? 1 : -1
      );
    },
    listOpen(tenantId: string): CarrierDownload[] {
      return this.listByTenant(tenantId).filter((download) =>
        ["unreviewed", "matched", "needs_review"].includes(download.status)
      );
    },
    get(id: string): CarrierDownload | undefined {
      return db.list("carrierDownloads").find((download) => download.id === id);
    },
    approve(id: string, byUserId: string): CarrierDownload | null {
      const download = this.get(id);
      if (!download || download.status === "approved") return download ?? null;
      const appliedAt = nowIso();
      const policy = download.policyId ? db.list("policies").find((p) => p.id === download.policyId) : undefined;
      const patch = policyPatchFromCarrierDownload(download.changes);
      if (policy && Object.keys(patch).length > 0) {
        db.update("policies", policy.id, patch);
      }

      let documentId: string | undefined;
      if (download.documentPayload && download.policyId && download.customerId) {
        const document = api.documents.create({
          tenantId: download.tenantId,
          uploadedById: byUserId,
          fileName: download.documentPayload.fileName,
          fileType: download.documentPayload.fileType,
          documentName: download.documentPayload.documentName,
          type: download.documentPayload.type,
          visibility: download.documentPayload.visibility,
          status: download.documentPayload.status ?? "approved",
          customerId: download.customerId,
          assetId: download.assetId,
          policyId: download.policyId,
        });
        documentId = document.id;
      }

      const updated = db.update("carrierDownloads", id, {
        status: "approved",
        appliedAt,
        appliedById: byUserId,
      });
      const runnerJob = db
        .list("carrierRunnerJobs")
        .find((job) => job.carrierDownloadId === download.id && job.status === "staged_for_review");
      if (runnerJob) {
        db.update("carrierRunnerJobs", runnerJob.id, {
          status: "completed",
          completedAt: appliedAt,
          completedById: byUserId,
        });
      }
      logCarrierDownloadActivity(download, carrierDownloadFiledMessage(download), byUserId, documentId);
      return updated;
    },
    reject(id: string, byUserId: string, reason?: string): CarrierDownload | null {
      const download = this.get(id);
      if (!download || download.status === "rejected") return download ?? null;
      const rejectedAt = nowIso();
      const updated = db.update("carrierDownloads", id, {
        status: "rejected",
        rejectedAt,
        rejectedById: byUserId,
        rejectionReason: reason?.trim() || undefined,
      });
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: download.tenantId,
        source: "system",
        message: `Carrier update rejected: ${download.summary}`,
        visibility: "internal",
        customerId: download.customerId,
        assetId: download.assetId,
        policyId: download.policyId,
        createdAt: rejectedAt,
        createdById: byUserId,
      });
      return updated;
    },
  },

  // ------------ Carrier contacts (per-tenant address book) ------------
  // Per-agency contact list for carrier reps — underwriters,
  // adjusters, claims reps, marketing reps, account execs, etc.
  // Managed from the manager portal's Carrier library page
  // (each card opens a modal with the contact list + add form).
  // Each contact surfaces on the Messages page as its own thread.
  carrierContacts: {
    listForTenant(tenantId: string): CarrierContact[] {
      return tenantFilter(db.list("carrierContacts"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    listForCarrier(tenantId: string, carrierId: string): CarrierContact[] {
      return db
        .list("carrierContacts")
        .filter((c) => c.tenantId === tenantId && c.carrierId === carrierId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    get(id: string): CarrierContact | undefined {
      return db.list("carrierContacts").find((c) => c.id === id);
    },
    create(input: Omit<CarrierContact, "id" | "createdAt">): CarrierContact {
      const row: CarrierContact = {
        ...input,
        id: uid("ccontact"),
        createdAt: nowIso(),
      };
      db.insert("carrierContacts", row);
      return row;
    },
    update(id: string, patch: Partial<CarrierContact>): CarrierContact | null {
      return db.update("carrierContacts", id, patch);
    },
    remove(id: string) {
      return db.remove("carrierContacts", id);
    },
  },

  // ------------ Insurance categories (master) ------------
  categories: {
    list(): InsuranceCategory[] {
      return db.list("categories").sort(sortInsuranceCategories);
    },
    listActive(): InsuranceCategory[] {
      return db
        .list("categories")
        .filter((c) => c.active)
        .sort(sortInsuranceCategories);
    },
    // Active categories the given tenant has linked. If the tenant
    // has no link rows at all (legacy data, or a brand-new agency
    // before the master assigns anything), we fall back to ALL
    // active categories — same defensive behaviour as carriers.
    listActiveForTenant(tenantId: string): InsuranceCategory[] {
      const tenantLinks = db.list("categoryLinks").filter((l) => l.tenantId === tenantId);
      if (tenantLinks.length === 0) {
        return this.listActive();
      }
      const activeIds = new Set(tenantLinks.filter((l) => l.active).map((l) => l.categoryId));
      return db
        .list("categories")
        .filter((c) => c.active && activeIds.has(c.id))
        .sort(sortInsuranceCategories);
    },
    get(id: string): InsuranceCategory | undefined {
      return db.list("categories").find((c) => c.id === id);
    },
    create(input: Omit<InsuranceCategory, "id" | "createdAt">): InsuranceCategory {
      const row: InsuranceCategory = {
        ...input,
        id: uid("cat"),
        createdAt: nowIso(),
      };
      db.insert("categories", row);
      return row;
    },
    update(id: string, patch: Partial<InsuranceCategory>) {
      return db.update("categories", id, patch);
    },
    remove(id: string) {
      // Drop any per-tenant links pointing at this category so the
      // linked-agencies table stays consistent.
      db.list("categoryLinks")
        .filter((l) => l.categoryId === id)
        .forEach((l) => db.remove("categoryLinks", l.id));
      return db.remove("categories", id);
    },
    // ---- Agency link/unlink (mirrors carriers.links) -----------------
    links(): CategoryAgencyLink[] {
      return db.list("categoryLinks");
    },
    linkToAgency(categoryId: string, tenantId: string): CategoryAgencyLink {
      const existing = db
        .list("categoryLinks")
        .find((l) => l.categoryId === categoryId && l.tenantId === tenantId);
      const agency = db.list("agencies").find((a) => a.id === tenantId);
      const category = db.list("categories").find((c) => c.id === categoryId);
      if (existing) {
        db.update("categoryLinks", existing.id, { active: true });
        if (agency && category && !existing.active) {
          logAgencyActivity(
            agency,
            "agency_category_access_updated",
            "Insurance category enabled",
            `${category.label} was enabled for ${agency.name}.`,
            { category: category.label }
          );
        }
        return { ...existing, active: true };
      }
      const row: CategoryAgencyLink = {
        id: uid("catlink"),
        categoryId,
        tenantId,
        active: true,
        createdAt: nowIso(),
      };
      db.insert("categoryLinks", row);
      if (agency && category) {
        logAgencyActivity(
          agency,
          "agency_category_access_updated",
          "Insurance category enabled",
          `${category.label} was enabled for ${agency.name}.`,
          { category: category.label }
        );
      }
      return row;
    },
    unlinkFromAgency(categoryId: string, tenantId: string) {
      const existing = db
        .list("categoryLinks")
        .find((l) => l.categoryId === categoryId && l.tenantId === tenantId);
      if (existing) {
        db.update("categoryLinks", existing.id, { active: false });
        if (existing.active) {
          const agency = db.list("agencies").find((a) => a.id === tenantId);
          const category = db.list("categories").find((c) => c.id === categoryId);
          if (agency && category) {
            logAgencyActivity(
              agency,
              "agency_category_access_updated",
              "Insurance category disabled",
              `${category.label} was disabled for ${agency.name}.`,
              { category: category.label }
            );
          }
        }
      }
    },
  },

  // ------------ Documents ------------
  documents: {
    listByEntity(filters: {
      customerId?: string;
      assetId?: string;
      policyId?: string;
      claimId?: string;
      carrierId?: string;
      agencyId?: string;
      quoteRequestId?: string;
    }): Document[] {
      return db.list("documents").filter((d) => {
        return Object.entries(filters).every(([k, v]) => !v || (d as any)[k] === v);
      });
    },
    listByTenant(tenantId: string): Document[] {
      return tenantFilter(db.list("documents"), tenantId);
    },
    get(id: string): Document | undefined {
      return db.list("documents").find((d) => d.id === id);
    },
    create(input: {
      tenantId: string;
      uploadedById: string;
      fileName: string;
      fileType: string;
      documentName?: string;
      templateFields?: TemplateFieldMap;
      templateFieldLayout?: Document["templateFieldLayout"];
      fillableDetection?: Document["fillableDetection"];
      storagePath?: string;
      downloadUrl?: string;
      // Either a built-in DocumentType or a tenant-defined custom slug.
      type: DocumentType | string;
      visibility: DocumentVisibility;
      status?: "pending" | "approved" | "rejected";
      customerId?: string;
      assetId?: string;
      policyId?: string;
      claimId?: string;
      carrierId?: string;
      agencyId?: string;
      quoteRequestId?: string;
      // Optional personal/commercial bucket. Used today by the
      // Carrier library page to split a carrier's documents
      // into the right section.
      lineOfBusiness?: "personal" | "commercial";
      required?: boolean;
      customerEsignRequired?: boolean;
      agentEsignRequired?: boolean;
      importBatchId?: string;
    }): Document {
      const uploadedAt = nowIso();
      const row: Document = {
        id: uid("doc"),
        ...input,
        status: input.status ?? "pending",
        storagePath: input.storagePath ?? `s3://placeholder/${input.tenantId}/${uid("file")}/${input.fileName}`,
        downloadUrl: input.downloadUrl,
        uploadedAt,
        lastChangeAction: "uploaded",
        lastChangeAt: uploadedAt,
      };
      row.templateFields =
        normalizeTemplateFields(input.templateFields) ?? documentTemplateFieldsFor(row);
      db.insert("documents", row);

      // Document uploads always get a timeline entry so the agent /
      // manager status report reflects what's been shared. Mirrors
      // the document's visibility: customer-visible files emit a
      // customer-visible event, employee-only files stay internal.
      const uploader = db.list("users").find((u) => u.id === input.uploadedById);
      const verb = uploader?.role === "customer" ? "uploaded" : "shared";
      const docLabel = input.documentName?.trim() || api.helpers.documentTypeLabel(String(input.type));
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: uploader?.role === "customer" ? "customer" : "agent",
        message: `Document ${verb}: ${input.fileName} (${docLabel}).`,
        visibility: input.visibility === "customer_visible" ? "customer_visible" : "internal",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: input.policyId,
        claimId: input.claimId,
        documentId: row.id,
        importBatchId: input.importBatchId,
        createdAt: nowIso(),
        createdById: input.uploadedById,
      });

      ensureDocumentReviewNotice(row, input.uploadedById);

      return row;
    },
    update(id: string, patch: Partial<Document>) {
      const shouldStampChange =
        !patch.lastChangeAction &&
        !patch.lastChangeAt &&
        Object.keys(patch).some(
          (key) =>
            ![
              "needsRenewalUpdate",
              "renewalForRenewalId",
              "customerEsignSentAt",
              "customerEsignSignedAt",
              "esignCommunicationId",
              "agentEsignAssignedToId",
              "agentEsignSignedAt",
              "agentEsignSignatureName",
              "agentEsignSignatureFont",
              "agentEsignSignatureSize",
              "agentEsignTaskId",
            ].includes(key)
        );
      const action =
        "templateFields" in patch || "fileName" in patch || "documentName" in patch
          ? "edited"
          : "updated";
      const updated = db.update("documents", id, {
        ...patch,
        ...(shouldStampChange
          ? {
              lastChangeAction: action,
              lastChangeAt: nowIso(),
            }
          : {}),
      });
      if (updated && "status" in patch) {
        ensureDocumentReviewNotice(updated);
      }
      return updated;
    },
    // Tenant-wide agency templates the manager uploaded under
    // /employee/documents → "Agency templates & forms". Returned
    // newest-first.
    listTemplates(tenantId: string): Document[] {
      ensureBundledAcordTemplatesForTenant(tenantId);
      return db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !d.customerId &&
            !d.assetId &&
            !d.policyId &&
            !d.claimId &&
            !d.carrierId &&
            !d.quoteRequestId &&
            (d.type === "agency_template" || d.agencyId === tenantId)
        )
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    },
    // Send/apply an agency template to a specific customer. Clones
    // the template's metadata into a new Document tied to the
    // customer + asset + policy with the caller-chosen doc type.
    // The original template stays in the library untouched. Use
    // case: "Send the auto-change form to this client to fill out."
    applyTemplate(
      templateId: string,
      input: {
        customerId: string;
        assetId?: string;
        policyId?: string;
        // Target document type for the cloned row — defaults to
        // the template's own type ("agency_template") but the
        // missing-docs picker passes the AI-suggested type so the
        // cloned doc lands in the right bucket on the client's
        // Documents card.
        type?: DocumentType | string;
        uploadedById: string;
        // Visibility on the customer's side. Defaults to
        // customer_visible since templates are meant to be sent.
        visibility?: DocumentVisibility;
        fileName?: string;
        templateFields?: TemplateFieldMap;
      }
    ): Document | null {
      const tpl = db.list("documents").find((d) => d.id === templateId);
      if (!tpl) return null;
      return this.create({
        tenantId: tpl.tenantId,
        uploadedById: input.uploadedById,
        fileName: input.fileName?.trim() || tpl.fileName,
        fileType: tpl.fileType,
        type: input.type ?? tpl.type,
        visibility: input.visibility ?? "customer_visible",
        status: "approved",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: input.policyId,
        customerEsignRequired: tpl.customerEsignRequired,
        agentEsignRequired: tpl.agentEsignRequired,
        templateFields: input.templateFields,
      });
    },
    autofillAcordForCustomer(input: {
      tenantId: string;
      customerId: string;
      uploadedById: string;
      selectedAcordTemplateIds: string[];
      assetId?: string;
    }): {
      session: QuotingSession;
      documents: Document[];
      templates: CommercialAcordTemplateSelection[];
    } | null {
      const customer = db
        .list("customers")
        .find((candidate) => candidate.id === input.customerId && candidate.tenantId === input.tenantId);
      if (!customer || input.selectedAcordTemplateIds.length === 0) return null;

      const customerAssets = db
        .list("assets")
        .filter((asset) => asset.customerId === customer.id && asset.tenantId === input.tenantId);
      const primaryAsset =
        customerAssets.find((asset) => asset.id === input.assetId) ?? customerAssets[0];
      const assetDetails: Record<string, string> = primaryAsset
        ? Object.fromEntries(
            Object.entries(primaryAsset.details ?? {}).map(([key, value]) => [
              key,
              value == null ? "" : String(value),
            ])
          )
        : {};
      if (customer.mailingAddress && !assetDetails.address) assetDetails.address = customer.mailingAddress;

      const existing = db
        .list("quotingSessions")
        .filter(
          (session) =>
            session.tenantId === input.tenantId &&
            session.customerId === customer.id &&
            session.lineOfBusiness === "commercial" &&
            !isDocumentOnlyAcordSession(session)
        )
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
      const templateIds = Array.from(
        new Set([
          ...(existing?.commercialAcordTemplates ?? []).map((template) => template.templateId),
          ...input.selectedAcordTemplateIds,
        ])
      );
      const templates = selectedCommercialAcordTemplates(
        input.tenantId,
        templateIds,
        existing?.publicFields ?? {},
        existing?.publicFieldEvidence
      );
      const now = nowIso();
      const hasExistingCommercialSession = !!existing;
      const session =
        existing
          ? db.update("quotingSessions", existing.id, {
              assetId: existing.assetId ?? primaryAsset?.id,
              assetType: existing.assetType ?? primaryAsset?.type ?? "other",
              estimatedValue: existing.estimatedValue || primaryAsset?.estimatedValue || 0,
              assetDetails: Object.keys(existing.assetDetails ?? {}).length
                ? existing.assetDetails
                : assetDetails,
              commercialAcordTemplates: templates,
              updatedAt: now,
            }) ?? existing
          : (() => {
              const row: QuotingSession = {
                id: `quote_session_docs_${customer.id}`,
                tenantId: input.tenantId,
                customerId: customer.id,
                assetId: primaryAsset?.id,
                assetType: primaryAsset?.type ?? "other",
                estimatedValue: primaryAsset?.estimatedValue ?? 0,
                assetDetails,
                state:
                  customer.mailingAddress
                    ? extractStateFromString(customer.mailingAddress)
                    : extractStateFromString(Object.values(assetDetails).join(" ")),
                lineOfBusiness: "commercial",
                commercialAcordTemplates: templates,
                questionnaireQuestions: [],
                questionnaireResponses: {},
                createdById: input.uploadedById,
                status: "gathering_info",
                publicFields: {},
                missingFields: [],
                quotes: [],
                aiSummary: "ACORD documents initialized from the client Documents card.",
                createdAt: now,
                updatedAt: now,
              };
              return row;
            })();

      const syncedTemplates = syncCommercialAcordPdfArtifacts(
        session,
        session.questionnaireResponses ?? {},
        "application"
      );
      const activeSession =
        syncedTemplates && syncedTemplates.length > 0
          ? hasExistingCommercialSession
            ? db.update("quotingSessions", session.id, {
                commercialAcordTemplates: syncedTemplates,
                updatedAt: nowIso(),
              }) ?? session
            : {
                ...session,
                commercialAcordTemplates: syncedTemplates,
                updatedAt: nowIso(),
              }
          : session;
      const selectedTemplateIds = new Set(input.selectedAcordTemplateIds);
      const documents = db
        .list("documents")
        .filter(
          (document) =>
            document.tenantId === input.tenantId &&
            document.customerId === customer.id &&
            document.quoteRequestId === activeSession.id &&
            document.type === "completed_acord_application" &&
            selectedTemplateIds.has(document.templateFields?.["Source ACORD template ID"] ?? "")
        );

      logQuotingWorkflowProgress(activeSession, {
        message: `AI autofilled ${documents.length} ACORD document${
          documents.length === 1 ? "" : "s"
        } from the client Documents card.`,
        detail: documents.length
          ? `Completed PDF${documents.length === 1 ? "" : "s"} saved to this client's Documents card: ${documents
              .map((document) => document.fileName)
              .join(", ")}.`
          : "No completed ACORD documents were created because no selected template could be resolved.",
        createdAt: nowIso(),
        createdById: input.uploadedById,
        source: "ai",
      });

      return {
        session: activeSession,
        documents,
        templates: activeSession.commercialAcordTemplates ?? templates,
      };
    },
    // Renew a policy's core documents from its current information.
    // Regenerates a fresh, dated set (declarations page, insurance ID
    // card, proof of insurance) reflecting the latest coverage, tags
    // them customer-visible + approved, and logs a timeline event.
    renewForPolicy(policyId: string, uploadedById: string): Document[] {
      const policy = db.list("policies").find((p) => p.id === policyId);
      if (!policy) return [];
      const ref = policy.policyNumber ?? policy.id.slice(-6).toUpperCase();
      const ts = new Date();
      const stamp =
        ts.getFullYear().toString() +
        String(ts.getMonth() + 1).padStart(2, "0") +
        String(ts.getDate()).padStart(2, "0");
      const kinds: { type: DocumentType; label: string }[] = [
        { type: "declarations_page", label: "Declarations" },
        { type: "insurance_id_card", label: "ID-Card" },
        { type: "proof_of_insurance", label: "Proof-of-Insurance" },
      ];
      const out = kinds.map((k) =>
        this.create({
          tenantId: policy.tenantId,
          uploadedById,
          fileName: `${ref}-${k.label}-${stamp}.pdf`,
          fileType: "application/pdf",
          type: k.type,
          visibility: "customer_visible",
          status: "approved",
          customerId: policy.customerId,
          assetId: policy.assetId,
          policyId: policy.id,
        })
      );
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: policy.tenantId,
        source: "agent",
        message: `Policy documents renewed for ${
          policy.policyNumber ? `Policy #${policy.policyNumber}` : `Policy #${ref}`
        } from current coverage — declarations page, insurance ID card, and proof of insurance regenerated.`,
        visibility: "customer_visible",
        customerId: policy.customerId,
        assetId: policy.assetId,
        policyId: policy.id,
        createdAt: nowIso(),
        createdById: uploadedById,
      });
      return out;
    },
    // AI inspection of a freshly-created renewal. Walks the policy's
    // term-bound documents (declarations page, ID card, proof of
    // insurance, policy document, endorsement document) and flags
    // each as needing an update for the new term. The Documents card
    // surfaces an "Update for Renewal" button per flagged row, and
    // the renewal diagnostic stays pending until every flagged doc
    // has a published successor for this renewal.
    flagForRenewal(renewalId: string, actorId?: string): Document[] {
      const renewal = db.list("renewals").find((r) => r.id === renewalId);
      if (!renewal) return [];
      const policy = db.list("policies").find((p) => p.id === renewal.policyId);
      if (!policy) return [];
      const termBound: (DocumentType | string)[] = [
        "declarations_page",
        "insurance_id_card",
        "proof_of_insurance",
        "policy_document",
        "endorsement_document",
      ];
      const renewalCandidates = db
        .list("documents")
        .filter(
          (d) =>
            d.policyId === policy.id &&
            termBound.includes(d.type as DocumentType) &&
            // Skip drafts / published versions already tied to this
            // renewal.
            d.renewalId !== renewalId &&
            // Idempotent — skip docs already flagged for this renewal.
            !(d.needsRenewalUpdate && d.renewalForRenewalId === renewalId)
        );
      const policyCurrentTermYear = (() => {
        const sourceDate = policy.effectiveDate ?? policy.renewalDate;
        if (!sourceDate) return undefined;
        const year = new Date(sourceDate).getUTCFullYear();
        if (!Number.isFinite(year)) return undefined;
        return policy.effectiveDate ? year : year - 1;
      })();
      const termYearOf = (doc: Document) => doc.policyTermYear ?? policyCurrentTermYear ?? 0;
      const hasPublishedSuccessor = (doc: Document) =>
        renewalCandidates.some(
          (candidate) =>
            candidate.id !== doc.id &&
            candidate.type === doc.type &&
            !!candidate.publishedAt &&
            candidate.status !== "rejected" &&
            (candidate.supersedesId === doc.id || termYearOf(candidate) > termYearOf(doc))
        );
      const latestByType = new Map<string, Document>();
      renewalCandidates
        .filter(
          (d) =>
            d.status === "approved" &&
            !hasPublishedSuccessor(d) &&
            !(d.needsRenewalUpdate && d.renewalForRenewalId === renewalId)
        )
        .sort((a, b) => {
          const ay = termYearOf(a);
          const by = termYearOf(b);
          if (ay !== by) return by - ay;
          return (a.publishedAt ?? a.uploadedAt) < (b.publishedAt ?? b.uploadedAt) ? 1 : -1;
        })
        .forEach((doc) => {
          const key = String(doc.type);
          if (!latestByType.has(key)) latestByType.set(key, doc);
        });
      const candidates = Array.from(latestByType.values());
      const flagged: Document[] = [];
      candidates.forEach((d) => {
        const updated = db.update("documents", d.id, {
          needsRenewalUpdate: true,
          renewalForRenewalId: renewalId,
        });
        if (updated) flagged.push(updated);
      });
      if (flagged.length > 0) {
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: policy.tenantId,
          source: "ai",
          message: `AI inspected the new renewal and flagged ${flagged.length} document${
            flagged.length === 1 ? "" : "s"
          } that need updating for the new term — open the policy's Documents card and click "Update for Renewal" on each.`,
          visibility: "internal",
          customerId: policy.customerId,
          assetId: policy.assetId,
          policyId: policy.id,
          renewalId: renewal.id,
          createdAt: nowIso(),
          createdById: actorId ?? "ai",
        });
      }
      return flagged;
    },
    // Create a pending draft of an updated document for a renewal.
    // Clones the original's metadata, stamps it with the new term year
    // (derived from the renewal date), links supersedesId back to the
    // original, and leaves it status="pending" so the agent can
    // preview/edit before publishing.
    draftRenewalUpdate(
      originalDocId: string,
      renewalId: string,
      uploadedById: string
    ): Document | null {
      const orig = db.list("documents").find((d) => d.id === originalDocId);
      const renewal = db.list("renewals").find((r) => r.id === renewalId);
      if (!orig || !renewal) return null;
      // Don't duplicate a draft we've already started for this renewal.
      const existing = db
        .list("documents")
        .find(
          (d) =>
            d.supersedesId === orig.id &&
            d.renewalId === renewalId &&
            !d.publishedAt
        );
      if (existing) return existing;
      const termYear = renewal.renewalDate
        ? new Date(renewal.renewalDate).getFullYear()
        : new Date().getFullYear();
      const base = orig.fileName.replace(/-\d{4}\.pdf$/i, "").replace(/\.[^.]+$/, "");
      const ext = orig.fileName.match(/\.[^.]+$/)?.[0] ?? ".pdf";
      const fileName = `${base}-${termYear}${ext}`;
      const draft = this.create({
        tenantId: orig.tenantId,
        uploadedById,
        fileName,
        fileType: orig.fileType,
        type: orig.type,
        visibility: orig.visibility,
        status: "pending",
        customerId: orig.customerId,
        assetId: orig.assetId,
        policyId: orig.policyId,
        templateFields: documentTemplateFieldsFor(
          {
            ...orig,
            fileName,
            status: "pending",
            policyTermYear: termYear,
          },
          {
            originalFileName: orig.fileName,
            renewalDate: renewal.renewalDate,
          }
        ),
      });
      // Tag the renewal/version metadata.
      const tagged = db.update("documents", draft.id, {
        renewalId,
        supersedesId: orig.id,
        policyTermYear: termYear,
      });
      const out = tagged ?? draft;
      bumpRenewalTaskForDraft(out, uploadedById);
      const policy = out.policyId
        ? db.list("policies").find((p) => p.id === out.policyId)
        : undefined;
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: out.tenantId,
        source: "agent",
        message: `${api.helpers.documentTypeLabel(String(out.type))} update staged for renewal review: ${
          out.fileName
        }${policy?.policyNumber ? ` (Policy #${policy.policyNumber})` : ""}.`,
        visibility: "internal",
        customerId: out.customerId,
        assetId: out.assetId,
        policyId: out.policyId,
        documentId: out.id,
        renewalId,
        createdAt: nowIso(),
        createdById: uploadedById,
      });
      return out;
    },
    // Publish a renewal draft: marks it approved, stamps publishedAt,
    // clears the original's needs-update flag, applies any edits the
    // agent made (filename today; coverage fields would slot in here
    // in a real backend), and logs a customer-visible event.
    publishRenewalUpdate(
      draftDocId: string,
      uploadedById: string,
      edits?: { fileName?: string; templateFields?: TemplateFieldMap }
    ): Document | null {
      const draft = db.list("documents").find((d) => d.id === draftDocId);
      if (!draft || !draft.supersedesId || !draft.renewalId) return null;
      const publishedAt = nowIso();
      const patch: Partial<Document> = {
        status: "approved",
        publishedAt,
        lastChangeAction: "renewed",
        lastChangeAt: publishedAt,
      };
      if (edits?.fileName && edits.fileName.trim()) patch.fileName = edits.fileName.trim();
      if (edits?.templateFields) {
        patch.templateFields = normalizeTemplateFields(edits.templateFields);
      }
      const updated = db.update("documents", draft.id, patch);
      // Clear the flag on the original so the renewal activity's
      // checklist closes that step.
      db.update("documents", draft.supersedesId, {
        needsRenewalUpdate: false,
        renewalForRenewalId: undefined,
      });
      const policy = draft.policyId
        ? db.list("policies").find((p) => p.id === draft.policyId)
        : undefined;
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: draft.tenantId,
        source: "agent",
        message: `${api.helpers.documentTypeLabel(String(draft.type))} updated and published for the ${
          draft.policyTermYear ?? "new"
        } renewal term${policy?.policyNumber ? ` (Policy #${policy.policyNumber})` : ""}.`,
        visibility: "customer_visible",
        customerId: draft.customerId,
        assetId: draft.assetId,
        policyId: draft.policyId,
        documentId: draft.id,
        renewalId: draft.renewalId,
        createdAt: nowIso(),
        createdById: uploadedById,
      });
      return updated;
    },
    // AI-fill a template using one or more source files. The
    // agent picks a tenant template (e.g. wind-mit checklist) and
    // attaches existing customer docs and / or fresh transient
    // source files; the AI extracts structured fields from the
    // sources, fills the template, and uploads the result as a
    // new customer-visible Document tied to the chosen
    // asset/policy with the target type tagged.
    //
    // Demo: there are no real bytes, so we record the inputs +
    // the synthesized output filename + a "AI filled" status
    // event. The output's storagePath embeds the fact that this
    // doc came out of an AI fill so a manager auditing later can
    // see how it was produced.
    fillTemplateWithAi(input: {
      templateId: string;
      // Either the IDs of customer docs already in the system OR
      // ad-hoc transient files (filename + mime) provided in the
      // modal. Both are recorded as inputs on the output doc's
      // status event so the audit trail is complete.
      sourceDocumentIds?: string[];
      sourceFiles?: { fileName: string; fileType?: string }[];
      customerId: string;
      assetId?: string;
      policyId?: string;
      type?: DocumentType | string;
      uploadedById: string;
      outputFileName?: string;
      templateFields?: TemplateFieldMap;
    }): Document | null {
      const tpl = db.list("documents").find((d) => d.id === input.templateId);
      if (!tpl) return null;
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      const ts = new Date();
      const stamp =
        ts.getFullYear().toString() +
        String(ts.getMonth() + 1).padStart(2, "0") +
        String(ts.getDate()).padStart(2, "0");
      const customerSlug = (customer?.name ?? "Client")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "");
      const base = tpl.fileName.replace(/\.[^.]+$/, "");
      const ext = tpl.fileName.match(/\.[^.]+$/)?.[0] ?? ".pdf";
      const outputName =
        input.outputFileName?.trim() || `${base}-${customerSlug}-${stamp}-AI-filled${ext}`;
      const usedExistingDocs = (input.sourceDocumentIds ?? [])
        .map((id) => db.list("documents").find((d) => d.id === id)?.fileName)
        .filter((n): n is string => !!n);
      const usedFiles = (input.sourceFiles ?? []).map((f) => f.fileName);

      const out = this.create({
        tenantId: tpl.tenantId,
        uploadedById: input.uploadedById,
        fileName: outputName,
        fileType: tpl.fileType,
        type: input.type ?? tpl.type,
        visibility: "customer_visible",
        status: "approved",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: input.policyId,
        templateFields:
          normalizeTemplateFields(input.templateFields) ??
          documentTemplateFieldsFor(
            {
              ...tpl,
              tenantId: tpl.tenantId,
              fileName: outputName,
              type: input.type ?? tpl.type,
              visibility: "customer_visible",
              status: "approved",
              customerId: input.customerId,
              assetId: input.assetId,
              policyId: input.policyId,
            },
            { sourceFiles: [...usedExistingDocs, ...usedFiles] }
          ),
      });
      const inputsLabel =
        [...usedExistingDocs, ...usedFiles].join(", ") || "no source files attached";

      // Status event documents the AI fill so a manager auditing
      // later sees provenance. visibility=internal so it doesn't
      // pollute the customer's portal timeline.
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: tpl.tenantId,
        source: "ai",
        message: `AI filled template "${tpl.fileName}" → ${outputName}. Sources: ${inputsLabel}.`,
        visibility: "internal",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: input.policyId,
        documentId: out.id,
        createdAt: nowIso(),
        createdById: input.uploadedById,
      });

      return out;
    },
    // AI-style "what's still missing" suggester. For each asset
    // the customer owns we know the rough document set carriers
    // expect; we diff that against what's already uploaded under
    // the customer / asset / policy axes and return per-asset
    // gaps. The agent's Documents card renders this as a
    // bulleted list with an "Upload now" CTA per row.
    suggestMissingForCustomer(customerId: string): {
      assetId: string;
      assetLabel: string;
      assetType: AssetType;
      policyId?: string;
      missing: { type: DocumentType; label: string; reason: string }[];
    }[] {
      const customer = db.list("customers").find((c) => c.id === customerId);
      if (!customer) return [];
      const assets = db.list("assets").filter((a) => a.customerId === customerId);
      const policies = db.list("policies").filter((p) => p.customerId === customerId);
      const allDocs = db.list("documents").filter((d) => d.customerId === customerId);
      const policyCurrentTermYear = (policy?: Policy) => {
        const sourceDate = policy?.effectiveDate ?? policy?.renewalDate;
        if (!sourceDate) return undefined;
        const year = new Date(sourceDate).getUTCFullYear();
        if (!Number.isFinite(year)) return undefined;
        return policy?.effectiveDate ? year : year - 1;
      };
      const policyForDoc = (doc: Document) =>
        doc.policyId
          ? policies.find((policy) => policy.id === doc.policyId)
          : doc.assetId
          ? policies.find((policy) => policy.assetId === doc.assetId)
          : undefined;
      const sourceTermYear = (doc: Document) => doc.policyTermYear ?? policyCurrentTermYear(policyForDoc(doc));
      const latestTermYearForPolicy = (policyId?: string) => {
        if (!policyId) return undefined;
        const policy = policies.find((row) => row.id === policyId);
        return allDocs.reduce<number | undefined>((latest, doc) => {
          const policy = policyForDoc(doc);
          if (policy?.id !== policyId) return latest;
          const year = sourceTermYear(doc);
          if (!year) return latest;
          return latest == null ? year : Math.max(latest, year);
        }, policyCurrentTermYear(policy));
      };
      const hasPublishedSuccessor = (doc: Document) =>
        allDocs.some((candidate) => {
          if (candidate.id === doc.id || candidate.type !== doc.type) return false;
          const docPolicy = policyForDoc(doc);
          const candidatePolicy = policyForDoc(candidate);
          if (docPolicy?.id !== candidatePolicy?.id) return false;
          const candidateYear = sourceTermYear(candidate);
          const docYear = sourceTermYear(doc);
          return (
            !!candidate.publishedAt &&
            candidate.status !== "rejected" &&
            (candidate.supersedesId === doc.id ||
              (!!candidateYear && !!docYear && candidateYear > docYear))
          );
        });
      const docs = allDocs.filter((doc) => {
        const policy = policyForDoc(doc);
        if (!policy) return !hasPublishedSuccessor(doc);
        if (hasPublishedSuccessor(doc)) return false;
        const year = sourceTermYear(doc);
        const latestYear = latestTermYearForPolicy(policy.id);
        return !year || !latestYear || year >= latestYear;
      });

      // Doc types we expect to see attached for each asset type. The
      // "reason" string is shown in the AI-suggestions section so
      // the agent understands why the doc is being asked for.
      const expectations: Record<AssetType, { type: DocumentType; reason: string }[]> = {
        coastal_home: [
          { type: "declarations_page", reason: "Carrier dec page proves coverage and policy terms." },
          { type: "proof_of_insurance", reason: "Mortgagee usually requires a COI on file." },
          { type: "wind_mitigation", reason: "Required by every coastal-FL carrier for premium credit." },
          { type: "inspection_report", reason: "4-point inspection on homes 30+ years old." },
        ],
        luxury_vehicle: [
          { type: "declarations_page", reason: "Carrier dec page." },
          { type: "insurance_id_card", reason: "DMV / lienholder requires the ID card on file." },
          { type: "proof_of_insurance", reason: "Standard COI for the lienholder." },
        ],
        yacht: [
          { type: "declarations_page", reason: "Carrier dec page." },
          { type: "inspection_report", reason: "Marine survey required by every HNW carrier." },
          { type: "asset_information", reason: "Captain credentials + marina contract." },
        ],
        jewelry: [
          { type: "appraisal", reason: "Carriers require an appraisal within 3 years for items > $25k." },
          { type: "asset_information", reason: "Photographs of each scheduled item." },
        ],
        umbrella_liability: [
          { type: "declarations_page", reason: "Carrier dec page for the umbrella layer." },
        ],
        full_portfolio: [
          { type: "declarations_page", reason: "Dec pages for every wrapped policy." },
        ],
        other: [
          { type: "declarations_page", reason: "Carrier dec page." },
        ],
      };

      return assets.map((asset) => {
        const policy = policies.find((p) => p.assetId === asset.id);
        const expect = expectations[asset.type] ?? [];
        // Consider a type "present" if there's at least one doc
        // tied to this asset (or, lacking an assetId, to the
        // covering policy or the customer) matching that type.
        const present = new Set(
          docs
            .filter(
              (d) =>
                d.assetId === asset.id ||
                (policy && d.policyId === policy.id) ||
                (!d.assetId && !d.policyId && d.customerId === customerId)
            )
            .map((d) => d.type as string)
        );
        const missing = expect
          .filter((e) => !present.has(e.type))
          .map((e) => ({
            type: e.type,
            label: this.typeLabel(e.type),
            reason: e.reason,
          }));
        return {
          assetId: asset.id,
          assetLabel: asset.label,
          assetType: asset.type,
          policyId: policy?.id,
          missing,
        };
      }).filter((row) => row.missing.length > 0);
    },
    // Tiny helper used by suggestMissingForCustomer so we don't
    // bind it to the helpers namespace ordering. Mirrors
    // api.helpers.documentTypeLabel for the built-in slugs.
    typeLabel(type: string): string {
      return api.helpers.documentTypeLabel(type);
    },
  },

  // ------------ Custom document types (per-tenant) ------------
  // Agencies extend the document-type dropdown without a code
  // change. Slugs collide-protect within a tenant; built-in
  // DocumentType slugs are reserved and rejected on create.
  customDocumentTypes: {
    listForTenant(tenantId: string): CustomDocumentType[] {
      return tenantFilter(db.list("customDocumentTypes"), tenantId).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)
      );
    },
    listActiveForTenant(tenantId: string): CustomDocumentType[] {
      return this.listForTenant(tenantId).filter((c) => c.active);
    },
    create(input: {
      tenantId: string;
      label: string;
      description?: string;
      sortOrder?: number;
    }): CustomDocumentType | { error: "duplicate" | "reserved" | "invalid" } {
      const label = input.label.trim();
      if (!label) return { error: "invalid" };
      const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!slug) return { error: "invalid" };
      // Built-in DocumentType slugs are reserved so customers don't
      // accidentally shadow a system-level filter.
      const reserved = new Set<string>([
        "driver_license", "ssn_documentation", "proof_of_insurance",
        "asset_information", "policy_document", "declarations_page",
        "insurance_id_card", "policy_booklet", "endorsement_document",
        "deposit_receipt", "payment_receipt", "appraisal",
        "wind_mitigation", "inspection_report", "carrier_appetite_guide",
        "underwriting_manual", "claim_document", "cancellation_notice",
        "carrier_correspondence", "other",
      ]);
      if (reserved.has(slug)) return { error: "reserved" };
      const existing = db
        .list("customDocumentTypes")
        .find((c) => c.tenantId === input.tenantId && c.slug === slug);
      if (existing) return { error: "duplicate" };
      const row: CustomDocumentType = {
        id: uid("doctype"),
        tenantId: input.tenantId,
        slug,
        label,
        description: input.description,
        sortOrder: input.sortOrder ?? 100,
        active: true,
        createdAt: nowIso(),
      };
      db.insert("customDocumentTypes", row);
      return row;
    },
    update(id: string, patch: Partial<Omit<CustomDocumentType, "id" | "tenantId" | "slug" | "createdAt">>) {
      return db.update("customDocumentTypes", id, patch);
    },
    remove(id: string) {
      return db.remove("customDocumentTypes", id);
    },
  },

  // ------------ Status events ------------
  status: {
    listFor(filters: Partial<StatusEvent>): StatusEvent[] {
      return db
        .list("statusEvents")
        .filter((e) => Object.entries(filters).every(([k, v]) => !v || (e as any)[k] === v))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    listByTenant(tenantId: string, opts?: { internal?: boolean }): StatusEvent[] {
      let rows = tenantFilter(db.list("statusEvents"), tenantId);
      if (opts?.internal === false) rows = rows.filter((r) => r.visibility === "customer_visible");
      return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    create(
      input: Omit<StatusEvent, "id" | "createdAt"> & { source: StatusEventSource }
    ): StatusEvent {
      const row: StatusEvent = { ...input, id: uid("se"), createdAt: nowIso() };
      db.insert("statusEvents", row);
      return row;
    },
  },

  // ------------ Marketing ------------
  marketing: {
    listCampaigns(tenantId: string): MarketingCampaign[] {
      return tenantFilter(db.list("campaigns"), tenantId);
    },
    listMessages(tenantId: string): MarketingMessage[] {
      return tenantFilter(db.list("messages"), tenantId).map(normalizeMarketingMessageForDisplay);
    },
    // ------------ Per-tenant marketing configuration ------------
    // Single-row "settings" the manager controls under
    // AI marketing → Marketing configuration. Governs the voice,
    // signature, attachments, and auto-send cadence the AI applies
    // when generating outbound messages (prospect intake follow-ups,
    // policy-edit acknowledgments, doc-request drafts, etc.).
    getConfig(tenantId: string): MarketingConfig {
      const existing = db.list("marketingConfigs").find((c) => c.tenantId === tenantId);
      if (existing) return normalizeMarketingConfig(existing);
      const agency = db.list("agencies").find((a) => a.id === tenantId);
      const defaultConfig: MarketingConfig = {
        id: uid("mcfg"),
        tenantId,
        messageStyle: "concierge",
        senderName: agency ? `${agency.name} Concierge Team` : "Your Insurance Concierge",
        signOff: `Best,\n${agency?.name ?? "Your Insurance Concierge"}`,
        autoSendOnNewProspect: true,
        followUpCadenceDays: 3,
        autoMessageRules: defaultAutoMessageRules(true),
        attachments: [],
        updatedAt: nowIso(),
      };
      db.insert("marketingConfigs", defaultConfig);
      return defaultConfig;
    },
    updateConfig(tenantId: string, patch: Partial<MarketingConfig>, byUserId?: string): MarketingConfig {
      const current = this.getConfig(tenantId);
      const { agencyLogo: _legacyAgencyLogo, ...safePatch } = patch as Partial<MarketingConfig> & {
        agencyLogo?: unknown;
      };
      const updated = db.update("marketingConfigs", current.id, {
        ...safePatch,
        updatedAt: nowIso(),
        updatedById: byUserId,
      });
      return updated ? normalizeMarketingConfig(updated) : current;
    },
    addAttachment(
      tenantId: string,
      input: Omit<MarketingAttachment, "id" | "addedAt">,
      byUserId?: string
    ): MarketingConfig {
      const current = this.getConfig(tenantId);
      const next: MarketingAttachment = {
        ...input,
        id: uid("matt"),
        addedAt: nowIso(),
        addedById: byUserId,
      };
      return this.updateConfig(
        tenantId,
        { attachments: [...current.attachments, next] },
        byUserId
      );
    },
    removeAttachment(tenantId: string, attachmentId: string, byUserId?: string): MarketingConfig {
      const current = this.getConfig(tenantId);
      return this.updateConfig(
        tenantId,
        { attachments: current.attachments.filter((a) => a.id !== attachmentId) },
        byUserId
      );
    },
    // AI-auto-send the standard prospect intake outreach. Used by
    // api.prospects.create when config.autoSendOnNewProspect is on,
    // and surfaced manually on the prospect detail page as
    // "Send AI outreach now". Honors the manager's chosen style +
    // sign-off + attachment manifest.
    autoSendProspectOutreach(input: {
      tenantId: string;
      prospectId: string;
      channel?: "email";
      actorId?: string;
    }): MarketingMessage | null {
      const prospect = db.list("prospects").find((p) => p.id === input.prospectId);
      if (!prospect) return null;
      const cfg = this.getConfig(input.tenantId);
      const sender = agencyMarketingSender(input.tenantId);
      if (!cfg.autoSendOnNewProspect) return null;
      const rule = cfg.autoMessageRules.find(
        (item) => item.enabled && item.trigger === "new_prospect"
      );
      if (!rule) return null;
      const firstName = prospect.name.split(/\s+/)[0];
      const assetWord = prospect.assetType.replace(/_/g, " ");
      // The advanced automation rule decides timing,
      // approval mode, attachment use, and draft behavior.
      const channel = "email" as const;
      const attachmentLine = rule.includeAttachments
        ? attachmentManifestLine(cfg.attachments, channel)
        : "";
      const scheduledFor = autoMessageSchedule(rule);
      const deliveryStatus: MarketingMessage["deliveryStatus"] =
        rule.approvalMode === "draft_for_review" ? "draft" : scheduledFor ? "queued" : "sent";

      const subject = `${firstName}, next step on your ${assetWord} quote`;
      let body = `${cfg.senderName}: Hi ${firstName} — ${
        cfg.messageStyle === "concise"
          ? "ready to wrap up your quote?"
          : "still happy to walk you through next steps on your " + assetWord + " coverage."
      } Reply YES for a callback. Reply STOP to opt out.`;
      if (attachmentLine && cfg.attachments.some((a) => a.channels.includes(channel))) {
        body += `\n(${cfg.attachments
          .filter((a) => a.channels.includes(channel))
          .map((a) => a.description ?? a.fileName)
          .join(", ")})`;
      }

      const msg: MarketingMessage = {
        id: uid("msg"),
        tenantId: input.tenantId,
        campaignId: this.listCampaigns(input.tenantId)[0]?.id ?? "ad_hoc",
        prospectId: prospect.id,
        channel,
        subject,
        content: body,
        deliveryStatus,
        sentAt: deliveryStatus === "sent" ? nowIso() : undefined,
        nextScheduledAt: deliveryStatus === "queued" ? scheduledFor : undefined,
        fromName: sender.fromName,
        fromEmail: sender.fromEmail,
        mailboxProvider: sender.provider,
        mailboxConnectionId: sender.connectionId,
        createdAt: nowIso(),
      };
      db.insert("messages", msg);
      if (deliveryStatus === "sent") markMailboxSent(sender.connectionId);
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: "ai",
        message: `AI ${autoMessageVerb(deliveryStatus)} email to ${prospect.name} via "${rule.name}" (${cfg.messageStyle} style${
          cfg.attachments.length ? `, ${cfg.attachments.length} attachment${cfg.attachments.length === 1 ? "" : "s"}` : ""
        }).`,
        visibility: "internal",
        prospectId: prospect.id,
        marketingMessageId: msg.id,
        createdAt: nowIso(),
        createdById: input.actorId,
      });
      return msg;
    },
    // Compose a fresh AI marketing campaign from a brief.
    //
    // Records a MarketingCampaign row, one tenant-scoped status event,
    // and one recipient-level MarketingMessage row for each targeted
    // client/prospect. Those rows are audit receipts for "campaigns
    // received" cards and campaign exports; they are not client-thread
    // conversations.
    //
    // A campaign can target any combination of "all clients",
    // "all prospects", and hand-picked recipients.
    //
    // Manager-controlled — caller is responsible for gating in
    // the UI; this entry point doesn't enforce a role check.
    async composeAiCampaign(input: {
      tenantId: string;
      name: string;
      channels: "email"[];
      brief: string;
      emailSubject?: string;
      emailBody?: string;
      heroImageUrl?: string;
      heroImageAlt?: string;
      pamphlet?: MarketingCampaignPamphletPayload;
      pamphletTheme?: string;
      ctaLabel?: string;
      appOrigin?: string;
      includeAllClients?: boolean;
      includeAllProspects?: boolean;
      selectedCustomerIds?: string[];
      selectedProspectIds?: string[];
      attachments?: { fileName: string; fileType?: string; description?: string }[];
      // ISO timestamp. When omitted (or in the past) the campaign
      // sends immediately.
      scheduledFor?: string;
      // Cadence for re-runs. "none" / undefined = one-shot.
      recurrence?: "none" | "daily" | "weekly" | "monthly";
      actorId?: string;
      actor?: User;
    }): Promise<{
      campaign: MarketingCampaign;
      messageCount: number;
      sentCount: number;
      failedCount: number;
    }> {
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
      const agencyName = tenant?.name ?? "your concierge agency";
      const cfg = this.getConfig(input.tenantId);
      const sender = agencyMarketingSender(input.tenantId);
      const recurrence = input.recurrence ?? "none";
      const now = Date.now();
      const channels = ["email" as const];
      const sendAt =
        input.scheduledFor && Date.parse(input.scheduledFor) > now
          ? input.scheduledFor
          : undefined;
      const isScheduled = !!sendAt;
      const isRecurring = recurrence !== "none";
      const approvingActorId = input.actorId ?? input.actor?.id;
      const localActorCandidate = approvingActorId
        ? db.list("users").find((user) => user.id === approvingActorId && user.tenantId === input.tenantId)
        : undefined;
      const localActor =
        localActorCandidate &&
        localActorCandidate.active !== false &&
        ["manager", "agent", "csr"].includes(localActorCandidate.role)
          ? localActorCandidate
          : undefined;
      const sessionActor =
        input.actor &&
        input.actor.id === approvingActorId &&
        input.actor.tenantId === input.tenantId &&
        input.actor.active !== false &&
        ["manager", "agent", "csr"].includes(input.actor.role)
          ? input.actor
          : undefined;
      const actor = sessionActor ?? localActor;
      const productionGate = evaluateAiProductionGate({
        system: "marketing_ai",
        action: isScheduled ? "schedule_campaign" : "launch_campaign",
        tenantScoped: true,
        humanApproved: !!actor,
        sendsOutboundMessage: true,
        writesSystemOfRecord: true,
        humanReviewed: !!actor,
        usesOnlyProvidedFacts: true,
      });
      if (!productionGate.allowed) {
        throw new Error(
          `AI marketing campaign requires an approving staff user before launch (${[
            ...productionGate.blockedReasons,
            ...productionGate.warnings,
          ].join(", ")}).`
        );
      }
      if (!actor) {
        throw new Error("AI marketing campaign requires an active agency staff user for delivery.");
      }

      // Resolve the audience union (dedup by id) for the launch record
      // and the per-recipient campaign receipt rows.
      const customerIds = new Set<string>();
      const prospectIds = new Set<string>();
      if (input.includeAllClients) {
        db.list("customers")
          .filter((c) => c.tenantId === input.tenantId && !c.archived)
          .forEach((c) => customerIds.add(c.id));
      } else {
        (input.selectedCustomerIds ?? []).forEach((id) => customerIds.add(id));
      }
      if (input.includeAllProspects) {
        db.list("prospects")
          .filter((p) => p.tenantId === input.tenantId && !p.archived)
          .forEach((p) => prospectIds.add(p.id));
      } else {
        (input.selectedProspectIds ?? []).forEach((id) => prospectIds.add(id));
      }
      const messageCount = customerIds.size + prospectIds.size;
      if (messageCount === 0) {
        throw new Error("Choose at least one client or prospect before sending the campaign.");
      }

      const campaign = this.createCampaign({
        tenantId: input.tenantId,
        name: input.name,
        channel: channels[0],
        channels,
        audienceFilter: {
          includeAllClients: !!input.includeAllClients,
          includeAllProspects: !!input.includeAllProspects,
          customerIds: Array.from(customerIds),
          prospectIds: Array.from(prospectIds),
          brief: input.brief,
          emailSubject: input.emailSubject,
          emailBody: input.emailBody,
          heroImageUrl: input.heroImageUrl,
          heroImageAlt: input.heroImageAlt,
          pamphlet: input.pamphlet,
          pamphletTheme: input.pamphletTheme,
          smartContactLinks: true,
          attachments: input.attachments ?? [],
          messageStyle: cfg.messageStyle,
        },
        status: isScheduled ? "scheduled" : "active",
        scheduledFor: sendAt,
        recurrence,
        nextRunAt: sendAt ?? (isRecurring ? nowIso() : undefined),
      });

      const deliveryStatus: MarketingMessage["deliveryStatus"] = "queued";
      const messageCreatedAt = nowIso();
      const messageBody = input.emailBody?.trim() || input.brief.trim() || input.name;
      const subject = input.emailSubject?.trim() || input.name.trim() || "Agency update";
      const ctaLabel = input.ctaLabel?.trim() || MARKETING_SMART_CTA_LABEL;
      const messageContentFor = (
        recipient: { customerId?: string; prospectId?: string },
        contact?: { name?: string; email?: string } | null
      ) => {
        const href = marketingSmartContactUrl({
          origin: input.appOrigin,
          tenantId: input.tenantId,
          customerId: recipient.customerId,
          prospectId: recipient.prospectId,
        });
        const personalizedBody = personalizeMarketingMergeFields(messageBody, contact);
        if (input.pamphlet) {
          return buildMarketingPamphletMessage({
            emailBody: personalizedBody,
            pamphlet: input.pamphlet,
            heroImageUrl: input.heroImageUrl,
            heroImageAlt: input.heroImageAlt || input.name,
            href,
            ctaLabel,
            recipientName: contact?.name,
            pamphletTheme: input.pamphletTheme,
          });
        }
        return appendMarketingContactCta(
          prependMarketingHeroImage(personalizedBody, input.heroImageUrl, input.heroImageAlt || input.name),
          href,
          ctaLabel
        );
      };
      const receiptIds: string[] = [];
      for (const customerId of Array.from(customerIds)) {
        const customer = db.list("customers").find((row) => row.id === customerId);
        const receipt: MarketingMessage = {
          id: uid("msg"),
          tenantId: input.tenantId,
          campaignId: campaign.id,
          customerId,
          channel: "email",
          subject: personalizeMarketingMergeFields(subject, customer),
          content: messageContentFor({ customerId }, customer),
          deliveryStatus,
          nextScheduledAt: deliveryStatus === "queued" ? sendAt : undefined,
          fromName: sender.fromName,
          fromEmail: sender.fromEmail,
          mailboxProvider: sender.provider,
          mailboxConnectionId: sender.connectionId,
          createdAt: messageCreatedAt,
        };
        db.insert("messages", receipt);
        receiptIds.push(receipt.id);
      }
      for (const prospectId of Array.from(prospectIds)) {
        const prospect = db.list("prospects").find((row) => row.id === prospectId);
        const receipt: MarketingMessage = {
          id: uid("msg"),
          tenantId: input.tenantId,
          campaignId: campaign.id,
          prospectId,
          channel: "email",
          subject: personalizeMarketingMergeFields(subject, prospect),
          content: messageContentFor({ prospectId }, prospect),
          deliveryStatus,
          nextScheduledAt: deliveryStatus === "queued" ? sendAt : undefined,
          fromName: sender.fromName,
          fromEmail: sender.fromEmail,
          mailboxProvider: sender.provider,
          mailboxConnectionId: sender.connectionId,
          createdAt: messageCreatedAt,
        };
        db.insert("messages", receipt);
        receiptIds.push(receipt.id);
      }

      let sentCount = 0;
      let failedCount = 0;
      if (!isScheduled) {
        for (const receiptId of receiptIds) {
          const receipt = db.list("messages").find((row) => row.id === receiptId);
          if (!receipt) continue;
          const contact = receipt.customerId
            ? db.list("customers").find((row) => row.id === receipt.customerId)
            : receipt.prospectId
            ? db.list("prospects").find((row) => row.id === receipt.prospectId)
            : undefined;
          const to = normalizeEmail(contact?.email);
          if (!to) {
            failedCount += 1;
            db.update("messages", receipt.id, {
              deliveryStatus: "failed",
              deliveryError: "No valid recipient email address was available.",
            });
            continue;
          }
          const href = marketingSmartContactUrl({
            origin: input.appOrigin,
            tenantId: input.tenantId,
            customerId: receipt.customerId,
            prospectId: receipt.prospectId,
          });
          const personalizedBody = personalizeMarketingMergeFields(messageBody, contact);
          const deliveryContent = marketingCampaignDeliveryContent({
            emailBody: personalizedBody,
            pamphlet: input.pamphlet,
            heroImageUrl: input.heroImageUrl,
            heroImageAlt: input.heroImageAlt || input.name,
            href,
            ctaLabel,
          });
          const result = await deliverMarketingCampaignEmail({
            tenantId: input.tenantId,
            user: actor,
            sender,
            to,
            subject: receipt.subject ?? subject,
            text: deliveryContent.text,
            html: deliveryContent.html,
          });
          if (result.ok) {
            sentCount += 1;
            db.update("messages", receipt.id, {
              deliveryStatus: "sent",
              sentAt: nowIso(),
              providerMessageId: result.result.externalMessageId,
              deliveryError: undefined,
            });
            if (sender.status === "connected") markMailboxSent(sender.connectionId);
          } else {
            failedCount += 1;
            db.update("messages", receipt.id, {
              deliveryStatus: "failed",
              deliveryError: result.message,
            });
          }
        }
      }

      // Audit trail — one tenant-scoped status event with the
      // campaign id, channels, recipient count, attachment manifest,
      // scheduling metadata, and recipient receipt count.
      const scheduleNote = isScheduled ? ` Scheduled for ${sendAt}.` : "";
      const recurrenceNote = isRecurring ? ` Recurring ${recurrence}.` : "";
      const verb = isScheduled ? "scheduled" : "processed";
      const channelLabel = channels.map((c) => c.toUpperCase()).join(" + ");
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: "ai",
        message: `AI campaign "${input.name}" ${verb} (${channelLabel}, ${cfg.messageStyle} style, ${messageCount} recipient${
          messageCount === 1 ? "" : "s"
        }${
          input.attachments && input.attachments.length > 0
            ? `, ${input.attachments.length} attachment${
                input.attachments.length === 1 ? "" : "s"
              }`
            : ""
        }). ${
          isScheduled
            ? "Recipient campaign receipts were queued."
            : `${sentCount} provider-accepted, ${failedCount} failed. Recipient campaign receipts were updated from provider responses.`
        } Agency: ${agencyName}.${scheduleNote}${recurrenceNote}`,
        visibility: "internal",
        marketingCampaignId: campaign.id,
        createdAt: nowIso(),
        createdById: actor.id,
      });

      return { campaign, messageCount, sentCount, failedCount };
    },
    messagesForProspect(prospectId: string): MarketingMessage[] {
      return db.list("messages").filter((m) => m.prospectId === prospectId);
    },
    createCampaign(input: Omit<MarketingCampaign, "id" | "createdAt">): MarketingCampaign {
      const row: MarketingCampaign = { ...input, id: uid("camp"), createdAt: nowIso() };
      db.insert("campaigns", row);
      return row;
    },
    pauseCampaign(id: string) {
      return db.update("campaigns", id, { status: "paused" });
    },
    resumeCampaign(id: string) {
      return db.update("campaigns", id, { status: "active" });
    },
    deleteCampaign(id: string) {
      return db.remove("campaigns", id);
    },
    queueMessage(input: Omit<MarketingMessage, "id" | "createdAt" | "deliveryStatus">): MarketingMessage {
      const sender = agencyMarketingSender(input.tenantId);
      const row: MarketingMessage = {
        ...input,
        fromName: input.fromName ?? sender.fromName,
        fromEmail: input.fromEmail ?? sender.fromEmail,
        mailboxProvider: input.mailboxProvider ?? sender.provider,
        mailboxConnectionId: input.mailboxConnectionId ?? sender.connectionId,
        id: uid("msg"),
        deliveryStatus: "queued",
        createdAt: nowIso(),
      };
      db.insert("messages", row);
      return row;
    },
    // Cancel a queued message before it leaves the agency. We mark the row
    // failed and prefix the subject so the UI can render it as "Cancelled".
    cancelMessage(id: string) {
      const msg = db.list("messages").find((m) => m.id === id);
      if (!msg) return null;
      const subject = msg.subject?.startsWith("[cancelled]")
        ? msg.subject
        : `[cancelled] ${msg.subject ?? ""}`.trim();
      return db.update("messages", id, { deliveryStatus: "failed", subject });
    },
    // Restore a cancelled message back to the queue.
    requeueMessage(id: string) {
      const msg = db.list("messages").find((m) => m.id === id);
      if (!msg) return null;
      const subject = msg.subject?.replace(/^\[cancelled\]\s*/i, "").trim() || undefined;
      return db.update("messages", id, {
        deliveryStatus: "queued",
        subject,
        sentAt: undefined,
      });
    },
    // Inline edit of a draft message before approval. The agent /
    // manager can tweak subject + content; nothing else is mutable.
    updateMessage(id: string, patch: { subject?: string; content?: string }) {
      return db.update("messages", id, patch);
    },
    // Flip a draft to queued so the platform sends it on the next
    // dispatcher tick. No-op if the row isn't a draft (so stray
    // double-clicks don't re-send sent messages).
    approveMessage(id: string) {
      const msg = db.list("messages").find((m) => m.id === id);
      if (!msg || msg.deliveryStatus !== "draft") return null;
      return db.update("messages", id, { deliveryStatus: "queued" });
    },
    // Discard a draft outright. Removes the row from the DB so the
    // agent's queue stays clean. (Distinct from cancelMessage, which
    // keeps the row with a [cancelled] prefix for audit.)
    discardDraft(id: string) {
      const msg = db.list("messages").find((m) => m.id === id);
      if (!msg || msg.deliveryStatus !== "draft") return null;
      return db.remove("messages", id);
    },
    // Delete every marketing message tied to a contact (used by the
    // ⋯ thread settings "Delete conversation"). Destructive.
    deleteForContact(contact: { customerId?: string; prospectId?: string }): number {
      const rows = db
        .list("messages")
        .filter(
          (m) =>
            (contact.customerId && m.customerId === contact.customerId) ||
            (contact.prospectId && m.prospectId === contact.prospectId)
        );
      rows.forEach((m) => db.remove("messages", m.id));
      return rows.length;
    },
    // Auto-drafts an email asking the customer for the
    // documents the AI flagged as missing on a quote. Status is
    // "draft" so the agent or manager must review + approve before
    // anything is sent. Emits an internal status event so the
    // client activity timeline reflects that the AI staged the
    // outreach.
    draftDocRequest(input: {
      tenantId: string;
      customerId: string;
      assetType?: string;
      missingDocuments: string[];
    }): { email: MarketingMessage } | null {
      const docs = input.missingDocuments.filter((d) => d && d.trim());
      if (docs.length === 0) return null;
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
      const sender = agencyMarketingSender(input.tenantId);
      const firstName = (customer?.name ?? "there").split(/\s+/)[0];
      const agencyName = tenant?.name ?? "your agency";
      const docList = docs.map((d) => `  • ${d}`).join("\n");
      const subject =
        docs.length === 1
          ? `One document needed to finalize your quote`
          : `${docs.length} documents needed to finalize your quote`;
      const emailBody = [
        `Hi ${firstName},`,
        ``,
        `Thank you for starting a quote with ${agencyName}. To complete the carrier review, we will need ${
          docs.length === 1 ? "one item" : `the following ${docs.length} items`
        } from you:`,
        ``,
        docList,
        ``,
        `You can upload these from your client portal under Documents, or reply to this email with attachments and we will handle the rest.`,
        ``,
        `Thank you,`,
        agencyName,
      ].join("\n");
      const smsBody = `${agencyName}: To finish your quote we still need ${
        docs.length === 1 ? docs[0] : `${docs.length} docs (${docs.slice(0, 2).join(", ")}${docs.length > 2 ? "…" : ""})`
      }. Upload from your portal or reply to your agent. — ${agencyName}`;

      const email: MarketingMessage = {
        id: uid("msg"),
        tenantId: input.tenantId,
        campaignId: "campaign_doc_requests",
        customerId: input.customerId,
        channel: "email",
        subject,
        content: emailBody,
        deliveryStatus: "draft",
        fromName: sender.fromName,
        fromEmail: sender.fromEmail,
        mailboxProvider: sender.provider,
        mailboxConnectionId: sender.connectionId,
        createdAt: nowIso(),
      };
      db.insert("messages", email);

      // Timeline crumb so the agent/manager sees the AI staged
      // outreach next to the quote submission. Internal so the
      // customer doesn't see "AI drafted" copy on their own report.
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: "ai",
        message: `Drafted ${docs.length === 1 ? "a document request" : `${docs.length} document requests`} for ${
          customer?.name ?? "customer"
        }: ${docs.join(", ")}. Awaiting approval before send.`,
        visibility: "internal",
        customerId: input.customerId,
        createdAt: nowIso(),
        marketingCampaignId: "campaign_doc_requests",
      });

      return { email };
    },
  },

  // ------------ Custom (staff-authored, not AI) messages ------------
  customMessages: {
    listByTenant(tenantId: string): CustomMessage[] {
      return tenantFilter(db.list("customMessages"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    get(id: string): CustomMessage | undefined {
      return db.list("customMessages").find((m) => m.id === id);
    },
    // Resolve a CustomMessage's audience into concrete (customerId/prospectId)
    // pairs. The composer uses this to show "X recipients" before send.
    resolveRecipients(input: {
      tenantId: string;
      audience: CustomMessageAudience;
      filter?: CustomMessageFilter;
      selectedCustomerIds?: string[];
      selectedProspectIds?: string[];
    }): { customers: { id: string; name: string; email: string }[]; prospects: { id: string; name: string; email: string }[] } {
      const customers = db.list("customers").filter((c) => c.tenantId === input.tenantId);
      const prospects = db.list("prospects").filter((p) => p.tenantId === input.tenantId);
      const f = input.filter;

      if (input.audience === "all_clients") {
        return { customers, prospects: [] };
      }
      if (input.audience === "all_prospects") {
        return { customers: [], prospects };
      }
      if (input.audience === "filter" && f) {
        const matchCustomer = (c: typeof customers[number]) => {
          if (f.audienceType === "prospects") return false;
          return true;
        };
        const matchProspect = (p: typeof prospects[number]) => {
          if (f.audienceType === "clients") return false;
          if (f.assetType && p.assetType !== f.assetType) return false;
          if (f.prospectStatus && p.status !== f.prospectStatus) return false;
          return true;
        };
        return {
          customers: f.audienceType === "prospects" ? [] : customers.filter(matchCustomer),
          prospects: f.audienceType === "clients" ? [] : prospects.filter(matchProspect),
        };
      }
      // selected
      const cset = new Set(input.selectedCustomerIds ?? []);
      const pset = new Set(input.selectedProspectIds ?? []);
      return {
        customers: customers.filter((c) => cset.has(c.id)),
        prospects: prospects.filter((p) => pset.has(p.id)),
      };
    },
    create(input: {
      tenantId: string;
      createdById: string;
      channel: "email";
      subject?: string;
      body: string;
      attachments?: CustomMessageAttachment[];
      audience: CustomMessageAudience;
      filter?: CustomMessageFilter;
      selectedCustomerIds?: string[];
      selectedProspectIds?: string[];
      scheduledFor?: string;
      recurrence?: CustomMessageRecurrence;
    }): CustomMessage {
      const recurrence: CustomMessageRecurrence = input.recurrence ?? "none";
      const recipients = this.resolveRecipients({
        tenantId: input.tenantId,
        audience: input.audience,
        filter: input.filter,
        selectedCustomerIds: input.selectedCustomerIds,
        selectedProspectIds: input.selectedProspectIds,
      });
      const recipientCount = recipients.customers.length + recipients.prospects.length;

      // Status:
      //  - recurring → recurring_active
      //  - one-shot with scheduledFor in the future → scheduled
      //  - else → sent (immediate)
      const isFuture = input.scheduledFor && new Date(input.scheduledFor).getTime() > Date.now();
      const status: CustomMessage["status"] =
        recurrence !== "none"
          ? "recurring_active"
          : isFuture
          ? "scheduled"
          : "sent";

      // Custom messages are sent verbatim, so the sender's personal
      // email signature is woven into the body on save.
      const bodyWithSignature = applySenderEmailSignature(
        input.channel,
        "outbound",
        input.body,
        input.createdById
      );
      const senderMailbox = mailboxForUser(input.createdById);
      const senderUser = db.list("users").find((user) => user.id === input.createdById);

      const row: CustomMessage = {
        id: uid("cmsg"),
        tenantId: input.tenantId,
        createdById: input.createdById,
        channel: input.channel,
        subject: input.subject,
        body: bodyWithSignature,
        fromName: senderUser?.name,
        fromEmail: senderMailbox.account,
        mailboxProvider: senderMailbox.provider,
        mailboxConnectionId: senderMailbox.connectionId,
        attachments: input.attachments ?? [],
        audience: input.audience,
        filter: input.filter,
        selectedCustomerIds: input.selectedCustomerIds ?? [],
        selectedProspectIds: input.selectedProspectIds ?? [],
        scheduledFor: input.scheduledFor,
        recurrence,
        status,
        recipientCount,
        sentCount: status === "sent" ? recipientCount : 0,
        lastSentAt: status === "sent" ? nowIso() : undefined,
        createdAt: nowIso(),
      };
      db.insert("customMessages", row);
      if (status === "sent") markMailboxSent(senderMailbox.connectionId);
      return row;
    },
    cancel(id: string) {
      return db.update("customMessages", id, { status: "cancelled" });
    },
    pauseRecurring(id: string) {
      return db.update("customMessages", id, { status: "recurring_paused" });
    },
    resumeRecurring(id: string) {
      return db.update("customMessages", id, { status: "recurring_active" });
    },
    remove(id: string) {
      return db.remove("customMessages", id);
    },
    // Demo helper: mark a scheduled message as sent immediately.
    sendNow(id: string) {
      const msg = db.list("customMessages").find((m) => m.id === id);
      if (!msg) return null;
      markMailboxSent(msg.mailboxConnectionId);
      return db.update("customMessages", id, {
        status: "sent",
        sentCount: msg.recipientCount,
        lastSentAt: nowIso(),
      });
    },
  },

  // ------------ Renewals ------------
  renewals: {
    listByTenant(tenantId: string): Renewal[] {
      return tenantFilter(db.list("renewals"), tenantId);
    },
    listByPolicy(policyId: string): Renewal[] {
      return db.list("renewals").filter((r) => r.policyId === policyId);
    },
    get(id: string): Renewal | undefined {
      return db.list("renewals").find((r) => r.id === id);
    },
    create(input: Omit<Renewal, "id" | "createdAt">): Renewal {
      const row: Renewal = { ...input, id: uid("renewal"), createdAt: nowIso() };
      db.insert("renewals", row);
      // Drop an Activity Center card for the agent who handles the
      // account so upcoming renewals never slip through.
      this.spawnRenewalActivity(row);
      // AI inspects the renewal and flags the policy's term-bound
      // documents (dec page, ID card, proof of insurance, etc.) so
      // each gets an "Update for Renewal" button on the Documents card
      // and the renewal diagnostic remains pending until they're republished.
      api.documents.flagForRenewal(row.id, row.agentId);
      ensureNonRenewalTask(row, row.agentId);
      const policy = db.list("policies").find((p) => p.id === row.policyId);
      if (policy) ensureCarrierRunnerRenewalJob(policy);
      return row;
    },
    // Create the Activity Center card for a single renewal — assigned
    // to the policy's owning agent. Idempotent: one card per renewal
    // term (keyed by renewalId), and only for renewals still upcoming.
    spawnRenewalActivity(renewal: Renewal): Task | null {
      if (renewal.status !== "upcoming") return null;
      const existing = db
        .list("tasks")
        .find((t) => t.renewalId === renewal.id);
      if (existing) return existing;
      const policy = db.list("policies").find((p) => p.id === renewal.policyId);
      if (!policy) return null;
      const customer = db.list("customers").find((c) => c.id === policy.customerId);
      const asset = db.list("assets").find((a) => a.id === policy.assetId);
      const assignedToId = renewal.agentId ?? customer?.assignedAgentId;
      const dateStr = renewal.renewalDate
        ? new Date(renewal.renewalDate).toLocaleDateString("en-US")
        : "soon";
      const label = asset?.label ?? policy.policyNumber ?? "policy";
      const row: Task = {
        id: uid("task"),
        tenantId: renewal.tenantId,
        title: `Renewal due — ${label}`,
        description: `${
          customer?.name ?? "This client"
        }'s ${label} renews ${dateStr}. Review coverage, refresh appraisals if needed, and confirm the renewal with the carrier.`,
        customerId: policy.customerId,
        policyId: policy.id,
        assetId: policy.assetId,
        renewalId: renewal.id,
        assignedToId,
        topic: "renewal_approaching",
        source: "ai_notification",
        status: "open",
        severity: "warning",
        severityReason: "Policy renewal is approaching.",
        createdById: "ai",
        createdAt: nowIso(),
      };
      db.insert("tasks", row);
      logTaskAudit({
        tenantId: renewal.tenantId,
        actorId: "ai",
        action: "task.created_from_renewal",
        taskId: row.id,
        metadata: { renewalId: renewal.id },
      });
      return row;
    },
    // Sweep: ensure every upcoming renewal has its Activity Center
    // card. Covers seeded renewals (inserted directly, not via
    // create). Idempotent — safe to call on every page load.
    ensureActivities(tenantId: string): number {
      let made = 0;
      this.listByTenant(tenantId)
        .filter((r) => r.status === "upcoming")
        .forEach((r) => {
          const before = db.list("tasks").length;
          this.spawnRenewalActivity(r);
          if (db.list("tasks").length > before) made += 1;
          // Same sweep flags the policy's term-bound documents so the
          // Update-for-Renewal flow surfaces whether the renewal was
          // created here (api.renewals.create already flags) or seeded
          // directly into the DB.
          api.documents.flagForRenewal(r.id);
        });
      api.carrierRunnerJobs.sweepRenewals(tenantId);
      return made;
    },
    update(id: string, patch: Partial<Renewal>) {
      const updated = db.update("renewals", id, patch);
      if (
        updated &&
        ("status" in patch ||
          "nonRenewalReason" in patch ||
          "nonRenewalEffectiveDate" in patch ||
          "replacementStrategy" in patch)
      ) {
        ensureNonRenewalTask(updated, updated.agentId);
        const policy = db.list("policies").find((p) => p.id === updated.policyId);
        if (policy) ensureCarrierRunnerRenewalJob(policy);
      }
      return updated;
    },
    // Move an "upcoming" renewal off the alert path. Two terminal
    // states the agent reaches for from the UI:
    //   markRenewed → policy renewed for another term
    //   markNotDue  → false alarm / agent already handled it
    markRenewed(id: string) {
      return this.update(id, { status: "renewed" });
    },
    markNotDue(id: string) {
      return this.update(id, { status: "not_due" });
    },
    // Record that a renewal reminder went out. The actual delivery
    // (SendGrid / Twilio) is out of scope here — this just persists
    // a Communication row AND emits a status-event so the client
    // status report shows reminder history with full timestamps.
    sendReminder({
      renewalId,
      channel,
      sentById,
    }: {
      renewalId: string;
      channel: "email";
      sentById: string;
    }): { reminderSent: boolean; reason?: string } {
      const renewal = db.list("renewals").find((r) => r.id === renewalId);
      if (!renewal) return { reminderSent: false, reason: "renewal_not_found" };
      const policy = db.list("policies").find((p) => p.id === renewal.policyId);
      if (!policy) return { reminderSent: false, reason: "policy_not_found" };
      const renewalDateStr = renewal.renewalDate
        ? new Date(renewal.renewalDate).toLocaleDateString("en-US")
        : "the upcoming date";
      const subject = `Renewal reminder — policy ${policy.policyNumber ?? policy.id} renews ${renewalDateStr}`;
      const body = `This is a friendly reminder that your policy ${policy.policyNumber ?? policy.id} is up for renewal on ${renewalDateStr}. Reply to this message or contact your agent if you have any questions.`;
      // Persist the comm row. We deliberately do NOT route through
      // api.communications.create here because that would emit a
      // generic comm timeline row in addition to the renewal-specific
      // one below — one event per reminder is the right granularity.
      db.insert("communications", {
        id: uid("comm"),
        tenantId: policy.tenantId,
        customerId: policy.customerId,
        channel,
        direction: "outbound",
        subject,
        body,
        createdById: sentById,
        createdAt: nowIso(),
      });
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: policy.tenantId,
        source: "agent",
        message: `Renewal reminder email sent for policy ${policy.policyNumber ?? policy.id} (renews ${renewalDateStr}).`,
        visibility: "customer_visible",
        customerId: policy.customerId,
        policyId: policy.id,
        renewalId: renewal.id,
        createdAt: nowIso(),
        createdById: sentById,
      });
      return { reminderSent: true };
    },
    sendNonRenewalSummary({
      renewalId,
      channel,
      sentById,
    }: {
      renewalId: string;
      channel: "email";
      sentById: string;
    }): { reminderSent: boolean; reason?: string } {
      const renewal = db.list("renewals").find((r) => r.id === renewalId);
      if (!renewal) return { reminderSent: false, reason: "renewal_not_found" };
      const policy = db.list("policies").find((p) => p.id === renewal.policyId);
      if (!policy) return { reminderSent: false, reason: "policy_not_found" };
      const carrier = db.list("carriers").find((c) => c.id === policy.carrierId);
      const expirationStr = renewal.nonRenewalEffectiveDate || renewal.renewalDate
        ? new Date(renewal.nonRenewalEffectiveDate ?? renewal.renewalDate).toLocaleDateString("en-US")
        : "the non-renewal date";
      const reason = renewal.nonRenewalReason ?? "The carrier issued a non-renewal notice.";
      const strategy = renewal.replacementStrategy
        ? `\n\nReplacement plan: ${renewal.replacementStrategy}`
        : "";
      const subject = `Non-renewal notice summary — policy ${policy.policyNumber ?? policy.id}`;
      const body = `We are documenting the carrier non-renewal for policy ${
        policy.policyNumber ?? policy.id
      } with ${carrier?.name ?? "the current carrier"}. The non-renewal is effective ${expirationStr}.\n\nReason: ${reason}${strategy}\n\nYour agency team will help review replacement options before the effective date.`;
      db.insert("communications", {
        id: uid("comm"),
        tenantId: policy.tenantId,
        customerId: policy.customerId,
        channel,
        direction: "outbound",
        subject,
        body,
        createdById: sentById,
        createdAt: nowIso(),
      });
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: policy.tenantId,
        source: "agent",
        message: `Non-renewal summary email sent for policy ${
          policy.policyNumber ?? policy.id
        } (effective ${expirationStr}).`,
        visibility: "customer_visible",
        customerId: policy.customerId,
        policyId: policy.id,
        renewalId: renewal.id,
        createdAt: nowIso(),
        createdById: sentById,
      });
      return { reminderSent: true };
    },
  },

  // ------------ Claims ------------
  claims: {
    listByCustomer(customerId: string): Claim[] {
      return db.list("claims").filter((c) => c.customerId === customerId);
    },
    listByTenant(tenantId: string): Claim[] {
      return tenantFilter(db.list("claims"), tenantId);
    },
    get(id: string): Claim | undefined {
      return db.list("claims").find((c) => c.id === id);
    },
    create(input: Omit<Claim, "id" | "openedAt">): Claim {
      const row: Claim = { ...input, id: uid("claim"), openedAt: nowIso() };
      db.insert("claims", row);
      syncPolicyClaimStatus(row);
      ensureClaimActionTask(row);
      logClaimRecordTimeline(row, row.status === "closed" ? "closed" : "opened", undefined, "system");
      return row;
    },
    update(id: string, patch: Partial<Claim>) {
      const before = db.list("claims").find((c) => c.id === id);
      const updated = db.update("claims", id, patch);
      if (updated && patch.status) syncPolicyClaimStatus(updated);
      if (updated && ("status" in patch || "closedAt" in patch)) ensureClaimActionTask(updated);
      if (updated && before) {
        const becameClosed =
          updated.status === "closed" &&
          (before.status !== "closed" || (!before.closedAt && Boolean(updated.closedAt)));
        if (becameClosed) {
          logClaimRecordTimeline(updated, "closed", undefined, patch.closedAt ? "system" : undefined);
        } else if (
          before.status !== updated.status ||
          before.externalClaimNumber !== updated.externalClaimNumber ||
          before.lossDescription !== updated.lossDescription ||
          before.lossAmountUsd !== updated.lossAmountUsd
        ) {
          logClaimRecordTimeline(updated, "updated", "claim details refreshed", "system");
        }
      }
      return updated;
    },
    // Convenience: close a claim. Stamps closedAt and flips status
    // so the Clients sidebar badge stops counting this client.
    close(id: string, actorId?: string) {
      const before = db.list("claims").find((c) => c.id === id);
      if (before?.status === "closed") return before;
      const updated = db.update("claims", id, { status: "closed", closedAt: nowIso() });
      if (updated) syncPolicyClaimStatus(updated);
      if (updated) ensureClaimActionTask(updated);
      if (updated) logClaimRecordTimeline(updated, "closed", undefined, actorId ?? "system");
      return updated;
    },
    checkForCarrierClaims(input: {
      tenantId: string;
      customerId: string;
      createdById?: string;
    }): {
      checked: number;
      created: number;
      updated: number;
      jobIds: string[];
      summary: string;
    } {
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      if (!customer || customer.tenantId !== input.tenantId) {
        return { checked: 0, created: 0, updated: 0, jobIds: [], summary: "Client record could not be found." };
      }
      const policies = tenantFilter(db.list("policies"), input.tenantId).filter(
        (policy) => policy.customerId === customer.id
      );
      if (policies.length === 0) {
        return {
          checked: 0,
          created: 0,
          updated: 0,
          jobIds: [],
          summary: "No policies are on file, so there were no carrier claim portals to check.",
        };
      }

      const checkedAt = nowIso();
      const jobIds: string[] = [];
      policies.forEach((policy) => {
        const job = createCarrierRunnerJobOnce({
          tenantId: input.tenantId,
          trigger: "claim_check",
          policy,
          createdById: input.createdById ?? "system",
          reason: `Check ${carrierName(policy.carrierId)} for current claim activity tied to ${policyRef(policy)} and import any new or changed claim records.`,
        });
        if (!job) return;
        jobIds.push(job.id);
        db.update("carrierRunnerJobs", job.id, {
          status: "running",
          startedAt: job.startedAt ?? checkedAt,
          startedById: input.createdById ?? "system",
          lastAttemptAt: checkedAt,
          attempts: job.attempts + 1,
        });
      });

      let created = 0;
      let updated = 0;
      const existingClaims = db.list("claims").filter((claim) => claim.customerId === customer.id);
      const activeClaims = existingClaims.filter((claim) => claim.status !== "closed");

      if (activeClaims.length > 0) {
        activeClaims.forEach((claim, index) => {
          const policy = db.list("policies").find((p) => p.id === claim.policyId);
          const carrier = db.list("carriers").find((c) => c.id === claim.carrierId);
          const patch: Partial<Claim> = {
            status: claim.status === "opened" ? "in_review" : claim.status,
            carrierClaimsUrl: claim.carrierClaimsUrl ?? carrier?.claimsUrl,
            externalClaimNumber:
              claim.externalClaimNumber ??
              `CR-${(policy?.policyNumber ?? claim.policyId).replace(/[^a-z0-9]+/gi, "").slice(-8)}-${index + 1}`,
          };
          const next = db.update("claims", claim.id, patch);
          if (next) {
            updated += 1;
            syncPolicyClaimStatus(next);
            ensureClaimActionTask(next, input.createdById);
            logClaimRecordTimeline(next, "updated", "carrier status confirmed", input.createdById ?? "system");
          }
        });
      } else if (existingClaims.length === 0) {
        const policy =
          policies.find((row) => row.carrierId === "carrier_chubb") ??
          policies.find((row) => row.carrierId === "carrier_pure") ??
          policies[0];
        const carrier = db.list("carriers").find((c) => c.id === policy.carrierId);
        const asset = db.list("assets").find((row) => row.id === policy.assetId);
        const claim = db.insert("claims", {
          id: uid("claim"),
          tenantId: input.tenantId,
          customerId: customer.id,
          policyId: policy.id,
          carrierId: policy.carrierId,
          carrierClaimsUrl: carrier?.claimsUrl,
          externalClaimNumber: `CR-${(policy.policyNumber ?? policy.id).replace(/[^a-z0-9]+/gi, "").slice(-8)}-1`,
          lossDescription: `Carrier-reported claim activity discovered for ${asset?.label ?? "insured asset"}.`,
          status: "in_review",
          openedAt: checkedAt,
        });
        created += 1;
        syncPolicyClaimStatus(claim);
        ensureClaimActionTask(claim, input.createdById);
        logClaimRecordTimeline(claim, "opened", undefined, input.createdById ?? "system");
      }

      const resultSummary =
        created > 0
          ? `${created} carrier-reported claim was added to ${customer.name}.`
          : updated > 0
          ? `${updated} open claim${updated === 1 ? "" : "s"} refreshed from carrier information.`
          : `Carrier claim portals were checked for ${customer.name}; no new claim activity was found.`;

      jobIds.forEach((jobId) => {
        const job = db.list("carrierRunnerJobs").find((row) => row.id === jobId);
        if (!job) return;
        db.update("carrierRunnerJobs", job.id, {
          status: "completed",
          completedAt: checkedAt,
          completedById: input.createdById ?? "system",
          detectedOutcome: created > 0 || updated > 0 ? "claim_update_staged" : "no_change",
          resultSummary,
          errorMessage: undefined,
        });
        logCarrierRunnerTimeline(job, "Carrier claim check completed", resultSummary, input.createdById ?? "system");
      });

      db.update("agencies", input.tenantId, {
        carrierRunnerLastSyncAt: checkedAt,
        carrierRunnerUpdatedAt: checkedAt,
      });

      return {
        checked: policies.length,
        created,
        updated,
        jobIds,
        summary: resultSummary,
      };
    },
    // Fires when a customer clicks a carrier claim link out of the
    // portal. Two side effects so the agent + manager have full
    // context the next time they open the file:
    //
    //   1. An internal-visibility status event tagged with the
    //      customer + policy + asset, naming the carrier. Distinct
    //      from the generic customer-visible "Opened intake" crumb
    //      so it surfaces in the agent's status report as a
    //      separate, agent-only heads-up.
    //
    //   2. A draft email (channel=email, deliveryStatus=draft)
    //      addressed to the customer, pre-filled with policy
    //      number, the affected asset, the agent's name, and a
    //      "reply to your agent" call-out. Agent/manager review +
    //      approve in the existing AI marketing drafts queue.
    //
    // Returns both ids; null when neither tenant nor customer
    // resolve (defensive — the caller should pass real ids).
    draftClaimFollowUp(input: {
      tenantId: string;
      customerId: string;
      carrierId?: string;
      carrierName: string;
      claimsUrl: string;
      assetId?: string;
      policyId?: string;
      claimId?: string;
    }): { statusEventId: string; draftEmailId: string } | null {
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      if (!customer) return null;
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
      const agencyName = tenant?.name ?? "your agency";
      const asset = input.assetId
        ? db.list("assets").find((a) => a.id === input.assetId)
        : undefined;
      const policy = input.policyId
        ? db.list("policies").find((p) => p.id === input.policyId)
        : undefined;
      const policyRef = policy?.policyNumber
        ? `Policy #${policy.policyNumber}`
        : policy
        ? `Policy #${policy.id.slice(-6).toUpperCase()}`
        : "policy pending";
      const assetLabel = asset?.label ?? "an asset";
      const agent = customer.assignedAgentId
        ? db.list("users").find((u) => u.id === customer.assignedAgentId)
        : undefined;
      const agentName = agent?.name ?? `your agent at ${agencyName}`;
      const agentEmail = agent?.email;

      // 1) Internal status event so the agent's status report
      // surfaces the click explicitly with full context.
      const statusEventId = uid("se");
      db.insert("statusEvents", {
        id: statusEventId,
        tenantId: input.tenantId,
        source: "ai",
        message: `${customer.name} opened ${input.carrierName}'s claim intake for ${assetLabel} (${policyRef}). AI staged a follow-up email — review in AI marketing.`,
        visibility: "internal",
        customerId: customer.id,
        assetId: input.assetId,
        policyId: input.policyId,
        claimId: input.claimId,
        createdAt: nowIso(),
      });

      // 2) Draft email — agent reviews + approves before send.
      const subject = `Following up on your claim with ${input.carrierName}`;
      const firstName = customer.name.split(/\s+/)[0];
      const body = [
        `Hi ${firstName},`,
        ``,
        `I saw you started a claim with ${input.carrierName} on ${assetLabel} (${policyRef}). I'm here to help you through it.`,
        ``,
        `What to expect next:`,
        `  • ${input.carrierName} will reach out with a claim number — please forward it so we can track on our side.`,
        `  • Document the loss with photos and any relevant receipts. Upload anything to your client portal under Documents.`,
        `  • If the carrier asks for an inspection, we can coordinate.`,
        ``,
        `Reply to this email or call ${agencyName} anytime. I'll keep an eye on this through close.`,
        ``,
        `${agentName}${agentEmail ? `\n${agentEmail}` : ""}`,
        agencyName,
      ].join("\n");

      const draftEmailId = uid("msg");
      db.insert("messages", {
        id: draftEmailId,
        tenantId: input.tenantId,
        campaignId: "campaign_claim_followups",
        customerId: customer.id,
        channel: "email",
        subject,
        content: body,
        deliveryStatus: "draft",
        createdAt: nowIso(),
      });

      return { statusEventId, draftEmailId };
    },
    // Customer-initiated "I need to file a claim" outreach from the
    // claims page. Records exactly one Communication row (so the
    // message body lives in the agent's inbox) AND one claim-tagged
    // status event (so the timeline headline reads as a claim
    // alert, not a generic email). We bypass the generic comm
    // side-effect to avoid double-rowing the timeline.
    submitInquiry(input: {
      tenantId: string;
      customerId: string;
      assetId?: string;
      body: string;
    }): { commId: string; statusEventId: string } {
      const asset = input.assetId
        ? db.list("assets").find((a) => a.id === input.assetId)
        : undefined;
      const assetLabel = asset?.label ?? "an unspecified asset";
      const subject = `Claim inquiry — ${assetLabel}`;
      const commId = uid("comm");
      const createdAt = nowIso();
      db.insert("communications", {
        id: commId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        channel: "email",
        direction: "inbound",
        subject,
        body: input.body,
        createdAt,
      });
      const statusEventId = uid("se");
      db.insert("statusEvents", {
        id: statusEventId,
        tenantId: input.tenantId,
        source: "customer",
        message: `Claim inquiry submitted for ${assetLabel}. ${input.body}`,
        visibility: "customer_visible",
        customerId: input.customerId,
        assetId: input.assetId,
        createdAt,
      });
      const task = ensureClaimInquiryTask({
        tenantId: input.tenantId,
        customerId: input.customerId,
        assetId: input.assetId,
        body: input.body,
        commId,
        createdAt,
      });
      db.update("communications", commId, {
        aiActivityScannedAt: createdAt,
        aiActivityTaskId: task.id,
      });
      return { commId, statusEventId };
    },
  },

  // ------------ Notes & communications ------------
  notes: {
    listByCustomer(customerId: string): Note[] {
      return db.list("notes").filter((n) => n.customerId === customerId);
    },
    listByProspect(prospectId: string): Note[] {
      return db.list("notes").filter((n) => n.prospectId === prospectId);
    },
    create(input: Omit<Note, "id" | "createdAt">): Note {
      const row: Note = { ...input, id: uid("note"), createdAt: nowIso() };
      db.insert("notes", row);

      // Staff-added notes flow into the timeline so the activity
      // report is a single source of truth. Visibility mirrors the
      // note itself — internal notes stay agent <-> manager scratch,
      // customer-visible notes show up in the customer portal too.
      // The full body is preserved in the status event message so
      // the timeline IS the permanent record — even if the notes
      // table were ever rebuilt, the audit log survives.
      if (input.customerId || input.prospectId) {
        const author = db.list("users").find((u) => u.id === input.authorId);
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: input.tenantId,
          source: "agent",
          message: `Note by ${author?.name ?? "staff"}: ${row.body}`,
          visibility: input.visibility,
          customerId: input.customerId,
          prospectId: input.prospectId,
          attachments: row.attachments,
          importBatchId: input.importBatchId,
          createdAt: nowIso(),
          createdById: input.authorId,
        });
      }

      return row;
    },
  },
  communications: {
    listByCustomer(customerId: string): Communication[] {
      return db
        .list("communications")
        .filter((c) => c.customerId === customerId && communicationHasKnownMailboxContact(c))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    // All comms (inbound + outbound) across the tenant. Used by the
    // Messages inbox to build threads keyed by contact.
    listByTenant(tenantId: string): Communication[] {
      return tenantFilter(db.list("communications"), tenantId)
        .filter(communicationHasKnownMailboxContact)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    // Inbound, unresolved, customer-attached. Drives the Clients
    // sidebar "pending message" alert. Outbound comms and resolved
    // rows are excluded so the count reflects what actually needs
    // a staff response.
    listPendingForTenant(tenantId: string): Communication[] {
      return db
        .list("communications")
        .filter(
          (c) =>
            c.tenantId === tenantId &&
            communicationHasKnownMailboxContact(c) &&
            c.direction === "inbound" &&
            !!c.customerId &&
            !c.resolvedAt
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    listPendingForCustomer(customerId: string): Communication[] {
      return db
        .list("communications")
        .filter(
          (c) =>
            c.customerId === customerId &&
            communicationHasKnownMailboxContact(c) &&
            c.direction === "inbound" &&
            !c.resolvedAt
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    markResolved(id: string, byUserId: string) {
      return db.update("communications", id, {
        resolvedAt: nowIso(),
        resolvedById: byUserId,
      });
    },
    remove(id: string): boolean {
      return db.remove("communications", id);
    },
    // Mark every unread inbound message in a contact's thread as read
    // (resolved). Used by the ⋯ thread settings "Mark as read".
    markContactRead(
      contact: {
        customerId?: string;
        prospectId?: string;
        carrierContactId?: string;
        externalRecipientEmail?: string;
      },
      byUserId: string
    ): number {
      const externalEmail = normalizeEmail(contact.externalRecipientEmail);
      const rows = db
        .list("communications")
        .filter(
          (c) =>
            c.direction === "inbound" &&
            !c.resolvedAt &&
            ((contact.customerId && c.customerId === contact.customerId) ||
              (contact.prospectId && c.prospectId === contact.prospectId) ||
              (contact.carrierContactId && c.carrierContactId === contact.carrierContactId) ||
              (externalEmail && normalizeEmail(c.externalRecipientEmail) === externalEmail))
        );
      rows.forEach((c) =>
        db.update("communications", c.id, { resolvedAt: nowIso(), resolvedById: byUserId })
      );
      return rows.length;
    },
    // Delete an entire conversation's communications for a contact.
    // Destructive — the caller confirms first.
    deleteForContact(contact: {
      customerId?: string;
      prospectId?: string;
      carrierContactId?: string;
      externalRecipientEmail?: string;
    }): number {
      const externalEmail = normalizeEmail(contact.externalRecipientEmail);
      const rows = db
        .list("communications")
        .filter(
          (c) =>
            (contact.customerId && c.customerId === contact.customerId) ||
            (contact.prospectId && c.prospectId === contact.prospectId) ||
            (contact.carrierContactId && c.carrierContactId === contact.carrierContactId) ||
            (externalEmail && normalizeEmail(c.externalRecipientEmail) === externalEmail)
        );
      rows.forEach((c) => db.remove("communications", c.id));
      return rows.length;
    },
    async automatePersonalQuoteReplies(
      tenantId: string,
      actorId?: string,
      communicationId?: string
    ): Promise<PersonalQuoteAutomationResult[]> {
      const inbound = db
        .list("communications")
        .filter(
          (communication) =>
            communication.tenantId === tenantId &&
            communication.direction === "inbound" &&
            communication.createdById !== "ai" &&
            (!communicationId || communication.id === communicationId) &&
            communicationHasKnownMailboxContact(communication) &&
            quoteAutomationCanRun(communication)
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, 25);
      const outcomes: PersonalQuoteAutomationResult[] = [];

      for (const original of inbound) {
        const customer = original.customerId
          ? db
              .list("customers")
              .find(
                (candidate) =>
                  candidate.id === original.customerId && candidate.tenantId === tenantId
              )
          : undefined;
        const prospect = original.prospectId
          ? db
              .list("prospects")
              .find(
                (candidate) =>
                  candidate.id === original.prospectId && candidate.tenantId === tenantId
              )
          : undefined;
        const contact = customer ?? prospect;
        const intake = extractQuoteReplyIntake({
          subject: original.subject,
          body: original.body,
          priorQuoteContext: priorQuoteContextForCommunication(original),
          contactLine: contact?.lineOfBusiness,
        });
        if (!intake) {
          db.update("communications", original.id, {
            aiQuoteAutomationStatus: "skipped",
            aiQuoteAutomationProcessedAt: nowIso(),
            aiQuoteAutomationReason: "No quote identifier reply was detected.",
          });
          outcomes.push({ communicationId: original.id, status: "skipped" });
          continue;
        }

        const claimedAt = nowIso();
        const attempts = (original.aiQuoteAutomationAttempts ?? 0) + 1;
        const directlyLinkedTask = db
          .list("tasks")
          .find(
            (candidate) =>
              candidate.tenantId === tenantId &&
              (candidate.id === original.aiActivityTaskId || candidate.messageId === original.id)
          );
        let task =
          existingQuoteIntakeTaskForInbound(original) ?? directlyLinkedTask;
        if (task) consolidateQuoteIntakeActivity(original, task);
        const assignedOwnerId = assignedContactOwner(contact);
        const actor = actorId
          ? db
              .list("users")
              .find(
                (candidate) =>
                  candidate.id === actorId &&
                  candidate.tenantId === tenantId &&
                  candidate.active
              )
          : undefined;
        const fallbackManager = db
          .list("users")
          .find(
            (candidate) =>
              candidate.tenantId === tenantId &&
              candidate.active &&
              isRoutingManagerRole(candidate.role)
          );
        const operatorId = assignedOwnerId ?? actor?.id ?? fallbackManager?.id;
        const taskTitle = `${contact?.name ?? "Client"}: personal quote request`;
        if (!task) {
          task = {
            id: uid("task"),
            tenantId,
            title: taskTitle,
            description:
              "Quotex received the requested asset identifier and is preparing the personal-lines quote flow.",
            customerId: original.customerId,
            prospectId: original.prospectId,
            messageId: original.id,
            source: "ai_notification",
            topic: "coverage_change",
            severity: "info",
            severityReason:
              "A client supplied the identifier needed to begin a personal-lines quote.",
            status: "open",
            assignedToId: operatorId,
            awaitingManagerAssignment: !operatorId || undefined,
            createdById: "ai",
            createdAt: claimedAt,
          };
          db.insert("tasks", task);
        } else {
          task =
            db.update("tasks", task.id, {
              title: taskTitle,
              description:
                "Quotex received the requested asset identifier and is preparing the personal-lines quote flow.",
              assignedToId: task.assignedToId ?? operatorId,
              awaitingManagerAssignment: !(task.assignedToId ?? operatorId) || undefined,
            }) ?? task;
        }
        db.update("communications", original.id, {
          aiQuoteAutomationStatus: "pending",
          aiQuoteAutomationProcessedAt: claimedAt,
          aiQuoteAutomationReason: "Personal-lines quote automation is in progress.",
          aiQuoteAutomationAttempts: attempts,
          aiActivityScannedAt: claimedAt,
          aiTriageDisposition: "activity",
          aiTriageTopic: "coverage_change",
          aiTriageReason:
            "The client supplied an asset identifier needed for a personal-lines quote.",
          aiTriageConfidence: "high",
          aiTriageEvidence: [`quote_identifier:${intake.identifierKind}`],
          aiTriageRequiresHumanReview: false,
          aiTriageVersion: INBOUND_TRIAGE_VERSION,
          aiActivityTaskId: task.id,
        });
        removeStaleQuoteIntakeDrafts(original);

        const finish = (
          status: PersonalQuoteAutomationResult["status"],
          reason: string,
          sessionId?: string,
          assetId?: string
        ) => {
          const processedAt = nowIso();
          db.update("communications", original.id, {
            aiQuoteAutomationStatus: status,
            aiQuoteAutomationProcessedAt: processedAt,
            aiQuoteAutomationReason: reason,
            aiQuoteAutomationSessionId: sessionId,
            aiQuoteAutomationAssetId: assetId,
          });
          const taskPatch: Partial<Task> = {
            description: reason,
            quoteSessionId: sessionId,
            assetId,
            assignedToId: task?.assignedToId ?? operatorId,
            awaitingManagerAssignment: !(task?.assignedToId ?? operatorId) || undefined,
          };
          if (task) db.update("tasks", task.id, taskPatch);
          if (task && sessionId) {
            const linkedSession = api.quoting.get(sessionId);
            if (linkedSession) {
              syncQuoteActivityStatus(linkedSession, {
                taskIds: [task.id],
                actorId: "ai",
              });
            }
          }
          const result = {
            communicationId: original.id,
            status,
            sessionId,
            assetId,
          } satisfies PersonalQuoteAutomationResult;
          outcomes.push(result);
          return result;
        };

        if (intake.line === "commercial") {
          finish(
            "manual",
            "Commercial-lines automation is paused. Staff must review this request before starting its quote flow."
          );
          continue;
        }
        if (intake.line !== "personal") {
          finish(
            "manual",
            "Quotex could not safely determine whether this request is personal or commercial, so staff review is required."
          );
          continue;
        }
        if (!customer) {
          finish(
            "manual",
            "This automatic personal-lines flow is available for client records. Staff must review this prospect request."
          );
          continue;
        }
        if (!operatorId) {
          finish(
            "failed",
            "The quote request is saved, but it needs an active staff owner before Quotex can start the flow."
          );
          continue;
        }

        try {
          const details = quoteAutomationAssetDetails(intake);
          const category = personalCategoryForQuoteAutomation(tenantId, intake);
          let asset = api.assets
            .listByCustomer(customer.id)
            .find((candidate) => assetMatchesQuoteAutomationIntake(candidate, intake));
          if (!asset) {
            asset = api.assets.create({
              tenantId,
              customerId: customer.id,
              type: intake.assetType,
              label: deriveAssetLabel(intake.assetType, details),
              estimatedValue: 0,
              details,
              status: "pending",
            });
            if (intake.identifierKind === "vin") {
              void api.assets.upgradeVehicleLabelFromVin(asset.id, asset.label);
            }
          }

          const latestSession = api.quoting.getForCustomer(customer.id);
          const openSession =
            latestSession && isQuotingWorkflowOpen(latestSession) ? latestSession : undefined;
          if (openSession && !quoteAutomationSessionContainsAsset(openSession, asset.id)) {
            finish(
              "manual",
              "A quote flow is already open for this client. The new identifier was saved as an asset, but staff must decide whether to add it to the existing flow.",
              openSession.id,
              asset.id
            );
            continue;
          }

          const session =
            openSession ??
            (await api.quoting.startSession({
              tenantId,
              customerId: customer.id,
              assetId: asset.id,
              assets: [
                {
                  assetId: asset.id,
                  label: asset.label,
                  assetType: asset.type,
                  categoryId: category?.id,
                  categoryLabel: category?.label,
                  address:
                    intake.identifierKind === "address"
                      ? intake.identifier
                      : customer.mailingAddress,
                  estimatedValue: asset.estimatedValue,
                  assetDetails: details,
                },
              ],
              createdById: operatorId,
              assetType: asset.type,
              contactName: customer.name,
              address:
                intake.identifierKind === "address"
                  ? intake.identifier
                  : customer.mailingAddress,
              estimatedValue: asset.estimatedValue,
              assetDetails: details,
              categoryId: category?.id,
              categoryLabel: category?.label,
              categoryIds: category ? [category.id] : undefined,
              categoryLabels: category ? [category.label] : undefined,
              lineOfBusiness: "personal",
              activityTaskIds: [task.id],
              activityActorId: "ai",
            }));
          syncQuoteActivityStatus(session, {
            taskIds: [task.id],
            actorId: "ai",
          });
          let mappedSession = api.quoting.get(session.id) ?? session;
          if (mappedSession.aiProviderError) {
            mappedSession =
              (await api.quoting.runAcordAiMapping(mappedSession.id)) ?? mappedSession;
          }
          const prepared =
            api.quoting.preparePersonalQuestionnaire(mappedSession.id) ?? mappedSession;
          const freshSession = api.quoting.get(prepared.id) ?? prepared;
          const unansweredRequired = quoteAutomationUnansweredRequiredCount(freshSession);

          if (unansweredRequired > 0) {
            if (!freshSession.questionnaireMessageId) {
              api.quoting.sendPortalLink(
                freshSession.id,
                quoteAutomationPortalUrl(freshSession.id)
              );
            }
            finish(
              "completed",
              `Quotex started the personal-lines quote flow and sent the client a questionnaire for ${unansweredRequired} remaining required field${
                unansweredRequired === 1 ? "" : "s"
              }. Carrier quotes will run automatically when the client submits it.`,
              freshSession.id,
              asset.id
            );
          } else {
            const completedSession =
              freshSession.status === "complete"
                ? freshSession
                : api.quoting.runQuotes(freshSession.id);
            finish(
              "completed",
              `Quotex started the personal-lines quote flow and automatically completed carrier ranking with ${completedSession.quotes.length} quote option${
                completedSession.quotes.length === 1 ? "" : "s"
              }.`,
              completedSession.id,
              asset.id
            );
          }
        } catch {
          finish(
            "failed",
            "The personal-lines quote request is saved. Quotex will retry it automatically."
          );
        }
      }

      return outcomes;
    },
    // AI inbound triage. Scans every inbound message that hasn't been
    // scanned yet; if the AI judges it warrants follow-up, it auto-
    // creates an Activity Center task (assigned to the contact's
    // agent — or routed to a manager for carrier messages with no
    // owner) and links it back onto the message. Idempotent: each
    // message is scanned exactly once. Returns the activities created
    // this run so the UI can flash a notice.
    sweepInboundForActivities(
      tenantId: string,
      actorId?: string
    ): { communicationId: string; task?: Task; notification?: AiNotification }[] {
      consolidateInboundEmailActivities(tenantId, actorId);
      const inbound = db
        .list("communications")
        .filter(
          (c) =>
            c.tenantId === tenantId &&
            c.direction === "inbound" &&
            c.createdById !== "ai" &&
            communicationNeedsInboundTriage(c)
        );
      const created: { communicationId: string; task?: Task; notification?: AiNotification }[] = [];
      for (const c of inbound) {
        if (!communicationHasKnownMailboxContact(c)) {
          db.update("communications", c.id, {
            aiActivityScannedAt: nowIso(),
            aiTriageDisposition: "ignore",
            aiTriageTopic: "other",
            aiTriageReason: "Mailbox sender is not a tenant contact and was excluded from Quotex.",
            aiTriageConfidence: "high",
            aiTriageEvidence: ["tenant_contact_match:none"],
            aiTriageRequiresHumanReview: false,
            aiTriageVersion: INBOUND_TRIAGE_VERSION,
          });
          continue;
        }
        const customer = c.customerId
          ? db.list("customers").find((x) => x.id === c.customerId)
          : undefined;
        const prospect = c.prospectId
          ? db.list("prospects").find((x) => x.id === c.prospectId)
          : undefined;
        const carrierContact = c.carrierContactId
          ? db.list("carrierContacts").find((x) => x.id === c.carrierContactId)
          : undefined;
        const contactKind: "client" | "prospect" | "carrier" = customer
          ? "client"
          : prospect
          ? "prospect"
          : "carrier";
        const triage = aiClassifyInboundForActivity({
          body: c.body,
          subject: c.subject,
          channel: typeof c.channel === "string" ? c.channel : undefined,
          contactName: customer?.name ?? prospect?.name ?? carrierContact?.name,
          contactKind,
        });
        const patch: Partial<Communication> = {
          aiActivityScannedAt: nowIso(),
          aiTriageDisposition: triage.disposition,
          aiTriageTopic: triage.topic,
          aiTriageReason: triage.reason,
          aiTriageConfidence: triage.confidence,
          aiTriageEvidence: triage.evidence,
          aiTriageRequiresHumanReview: triage.requiresHumanReview,
          aiTriageVersion: triage.version,
          aiServiceIntent: triage.serviceIntent,
          aiDraftMissingFields: triage.serviceQuestions,
        };
        const assignedToId = assignedContactOwner(customer ?? prospect);
        if (triage.serviceIntent === "vehicle_quote_intake") {
          const contact = customer ?? prospect;
          const questions = triage.serviceQuestions ?? [];
          const canPrepareDraft =
            !!contact && !!contact.email && !!assignedToId && questions.length > 0;

          if (canPrepareDraft) {
            const draft = createInboundQuoteIntakeDraft({
              inbound: c,
              contact,
              assignedToId,
              questions,
            });
            const existingNotification = db
              .list("aiNotifications")
              .find(
                (row) =>
                  row.communicationId === c.id && row.messageId === draft.id
              );
            const missingLabel = questions
              .map((question) => (question === "vin" ? "the VIN" : "personal or commercial use"))
              .join(" and ");
            const notification: AiNotification =
              existingNotification ?? {
                id: uid("ain"),
                tenantId,
                kind: "inbound_notice",
                title: `Draft ready: vehicle quote details - ${contact.name}`,
                summary: `Quotex prepared an unsent reply asking for ${missingLabel}. Review it before sending.`,
                customerId: c.customerId,
                prospectId: c.prospectId,
                messageId: draft.id,
                communicationId: c.id,
                topic: "coverage_change",
                severity: "info",
                severityReason:
                  "A vehicle quote request was missing required intake details, so Quotex prepared an unsent reply for staff review.",
                aiSummary: triage.reason,
                originalMessageContent: c.body,
                originalMessageId: c.id,
                aiReplyBody: draft.body,
                aiReplySubject: draft.subject,
                assignedToId,
                createdAt: nowIso(),
              };
            if (!existingNotification) db.insert("aiNotifications", notification);
            const task = ensureInboundDraftFollowUpTask({
              inbound: c,
              assignedToId,
              title: `${contact.name}: vehicle quote request`,
              description: `${triage.reason} Quotex prepared an unsent reply asking for ${missingLabel}. Keep this activity open until the requested quote intake is completed.`,
              topic: "coverage_change",
              severityReason:
                "The draft requests missing intake details but does not complete the client's quote request.",
              draft,
              actorId,
            });
            patch.aiTriageDisposition = "activity";
            patch.aiReplyDraftId = draft.id;
            patch.aiActivityNotificationId = notification.id;
            patch.aiActivityTaskId = task.id;
            created.push({ communicationId: c.id, task, notification });
          } else {
            const missing = !contact
              ? "The sender is not linked to a client or prospect."
              : !contact.email
                ? "The contact does not have an email address on file."
                : !assignedToId
                  ? "The contact does not have an active assigned staff owner."
                  : "No missing quote-intake questions were identified.";
            const taskRow = ensureInboundEmailTask({
              inbound: c,
              title: `${contact?.name ?? carrierContact?.name ?? "Contact"}: vehicle quote request needs review`,
              description: `${triage.reason} ${missing}`,
              topic: "coverage_change",
              severity: "warning",
              severityReason:
                "Quotex could not safely prepare the quote-intake draft because required contact or ownership information was unavailable.",
              assignedToId,
              awaitingManagerAssignment: !assignedToId || undefined,
              actorId: actorId ?? "ai",
              auditAction: "task.created_from_inbound_quote_request",
              auditMetadata: {
                missingQuestions: questions,
              },
            });
            patch.aiTriageDisposition = "activity";
            patch.aiActivityTaskId = taskRow.id;
            created.push({ communicationId: c.id, task: taskRow });
          }
        } else if (triage.serviceIntent) {
          const requestedDocument = customer
            ? findApprovedInboundServiceDocument({
                tenantId,
                customerId: customer.id,
                intent: triage.serviceIntent,
              })
            : undefined;
          const canPrepareDraft =
            !!customer && !!customer.email && !!assignedToId && !!requestedDocument;

          if (canPrepareDraft) {
            const draft = createInboundServiceDraft({
              inbound: c,
              customer,
              assignedToId,
              intent: triage.serviceIntent,
              document: requestedDocument,
            });
            const existingNotification = db
              .list("aiNotifications")
              .find(
                (row) =>
                  row.communicationId === c.id && row.messageId === draft.id
              );
            const notification: AiNotification =
              existingNotification ?? {
                id: uid("ain"),
                tenantId,
                kind: "inbound_notice",
                title: `Draft ready: ${inboundServiceLabel(triage.serviceIntent)} - ${customer.name}`,
                summary: `Quotex prepared a reply and attached ${requestedDocument.fileName}. Review it before sending.`,
                customerId: customer.id,
                policyId: requestedDocument.policyId,
                documentId: requestedDocument.id,
                messageId: draft.id,
                communicationId: c.id,
                topic: "document_upload",
                severity: "info",
                severityReason:
                  "A verified customer document was attached to an unsent reply draft for staff review.",
                aiSummary: triage.reason,
                originalMessageContent: c.body,
                originalMessageId: c.id,
                aiReplyBody: draft.body,
                aiReplySubject: draft.subject,
                assignedToId,
                createdAt: nowIso(),
              };
            if (!existingNotification) db.insert("aiNotifications", notification);
            const task = ensureInboundDraftFollowUpTask({
              inbound: c,
              assignedToId,
              title: `${customer.name}: ${inboundServiceLabel(triage.serviceIntent)} request`,
              description: `${triage.reason} Quotex prepared an unsent reply with ${requestedDocument.fileName} attached. Keep this activity open until the client's request is completed.`,
              topic: "document_upload",
              severityReason:
                "Preparing a draft does not confirm that the requested client service has been completed.",
              draft,
              documentId: requestedDocument.id,
              actorId,
            });
            patch.aiTriageDisposition = "activity";
            patch.aiReplyDraftId = draft.id;
            patch.aiActivityNotificationId = notification.id;
            patch.aiActivityTaskId = task.id;
            created.push({ communicationId: c.id, task, notification });
          } else {
            const missing = !customer
              ? "The sender is not linked to a client."
              : !customer.email
                ? "The client does not have an email address on file."
                : !assignedToId
                  ? "The client does not have an active assigned staff owner."
                  : `No approved ${inboundServiceLabel(triage.serviceIntent)} was found for this client.`;
            const taskRow = ensureInboundEmailTask({
              inbound: c,
              title: `${customer?.name ?? prospect?.name ?? carrierContact?.name ?? "Contact"}: ${inboundServiceLabel(triage.serviceIntent)} request needs review`,
              description: `${triage.reason} ${missing}`,
              topic: "document_upload",
              severity: "warning",
              severityReason:
                "Quotex did not create a draft because a required verified record or owner was unavailable.",
              assignedToId,
              awaitingManagerAssignment: !assignedToId || undefined,
              actorId: actorId ?? "ai",
              auditAction: "task.created_from_inbound_service_request",
              auditMetadata: {
                serviceIntent: triage.serviceIntent,
                documentFound: !!requestedDocument,
              },
            });
            patch.aiTriageDisposition = "activity";
            patch.aiActivityTaskId = taskRow.id;
            created.push({ communicationId: c.id, task: taskRow });
          }
        } else if (triage.disposition === "activity") {
          // Carrier messages (and any unowned contact) route to a
          // manager via the Routing card.
          const awaiting = !assignedToId;
          const taskRow = ensureInboundEmailTask({
            inbound: c,
            title: triage.title,
            description: triage.reason,
            topic: triage.topic,
            severity: triage.severity,
            severityReason: "Auto-created by AI from an inbound message.",
            assignedToId,
            awaitingManagerAssignment: awaiting || undefined,
            actorId: actorId ?? "ai",
            auditAction: "task.created_from_inbound",
            auditMetadata: { topic: triage.topic },
          });
          patch.aiActivityTaskId = taskRow.id;
          created.push({ communicationId: c.id, task: taskRow });
        } else if (triage.disposition === "notification") {
          const managerId = db
            .list("users")
            .find((u) => u.tenantId === tenantId && isRoutingManagerRole(u.role) && u.active)?.id;
          const preview = c.body.trim().replace(/\s+/g, " ");
          const row: AiNotification = {
            id: uid("ain"),
            tenantId,
            kind: "inbound_notice",
            title: `Notification: ${triage.title}`,
            summary:
              preview.length > 120
                ? `${preview.slice(0, 117)}...`
                : preview || `Inbound ${topicLabel(triage.topic)} update received.`,
            customerId: c.customerId,
            prospectId: c.prospectId,
            communicationId: c.id,
            topic: triage.topic,
            severity: triage.severity,
            severityReason: "Informational inbound message; no owned activity was opened.",
            originalMessageContent: c.body,
            originalMessageId: c.id,
            assignedToId: assignedToId ?? managerId,
            createdAt: nowIso(),
          };
          db.insert("aiNotifications", row);
          patch.aiActivityNotificationId = row.id;
          created.push({ communicationId: c.id, notification: row });
        }
        db.update("communications", c.id, patch);
      }
      return created;
    },
    create(
      input: Omit<Communication, "id" | "createdAt"> & {
        emailDeliveryMode?: "auto" | "portal_only";
      }
    ): Communication {
      // Auto-append the sender's personal email signature on every
      // outbound email. Centralized here so every composer in the
      // app (Messages page, inline Communications thread on detail
      // pages, agent reply UI, etc.) gets it for free — no per-
      // caller plumbing. SMS / inbound / no-signature passes through.
      const { emailDeliveryMode = "auto", ...communicationInput } = input;
      const finalBody = applySenderEmailSignature(
        input.channel,
        input.direction,
        input.body,
        input.createdById,
        input.mailboxOrigin
      );
      const senderMailbox =
        input.channel === "email" && input.direction === "outbound"
          ? mailboxForUser(input.createdById)
          : {};
      const row: Communication = {
        ...communicationInput,
        body: finalBody,
        mailboxOrigin:
          input.mailboxOrigin ??
          (input.channel === "email" && input.direction === "outbound" ? "app" : undefined),
        mailboxAccount: input.mailboxAccount ?? senderMailbox.account,
        mailboxProvider: input.mailboxProvider ?? senderMailbox.provider,
        mailboxConnectionId: input.mailboxConnectionId ?? senderMailbox.connectionId,
        id: uid("comm"),
        createdAt: nowIso(),
      };
      const outboxJob = emailDeliveryMode === "portal_only" ? null : buildMailboxOutboxJob(row);
      if (outboxJob) {
        row.outboxJobId = outboxJob.id;
        row.deliveryStatus = outboxJob.status === "failed" ? "failed" : "queued";
      } else if (row.channel === "email" && row.mailboxOrigin === "provider_sync") {
        row.deliveryStatus = row.direction === "inbound" ? "received" : "synced";
      } else if (
        row.channel === "email" &&
        row.direction === "outbound" &&
        emailDeliveryMode === "portal_only"
      ) {
        row.deliveryStatus = "synced";
      }
      db.insert("communications", row);
      if (outboxJob) {
        db.insert("mailboxOutbox", outboxJob);
        scheduleLiveMailboxDelivery(row, outboxJob);
      }
      const linkedRow = row.direction === "inbound" ? linkInboundCarrierCommunicationToSubmission(row) : row;

      // Every email / SMS / call to or from a customer gets a
      // timeline row so the client status report shows the full
      // conversation history. Inbound from the customer surfaces
      // as source=customer, outbound from staff as source=agent.
      // Customer-visible visibility keeps the customer's own
      // portal timeline honest about messages we sent them.
      communicationStatusEvent(linkedRow);

      return linkedRow;
    },
  },

  // ------------ Mailbox mirror ------------
  mailbox: {
    // Production provider sync (Gmail watch / Microsoft Graph webhook /
    // IMAP adapter) lands here after OAuth. It normalizes provider
    // messages into Communication rows so the Messages page mirrors
    // the staff member's real mailbox: inbound replies appear here,
    // and emails sent directly in Gmail / Outlook appear as outbound
    // "You" messages in the same contact thread.
    mirrorExternalEmail(input: {
      tenantId: string;
      mailboxUserId: string;
      mailboxAccount?: string;
      mailboxConnectionId?: string;
      provider?: MailProvider;
      externalMessageId: string;
      externalThreadId?: string;
      externalUrl?: string;
      from: string;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      body: string;
      bodyHtml?: string;
      rawMimeRef?: string;
      rfc822MessageId?: string;
      messageIdHeader?: string;
      inReplyToHeader?: string;
      references?: string[];
      attachments?: CommunicationAttachment[];
      snippet?: string;
      isRead?: boolean;
      mailboxLabels?: string[];
      sentAt?: string;
      direction?: "inbound" | "outbound";
      carrierSubmissionId?: string;
    }): Communication | null {
      const userMailbox = mailboxForUser(input.mailboxUserId);
      const mailboxAccount = input.mailboxAccount ?? userMailbox.account;
      if (!mailboxAccount) return null;
      const mailboxAddress = normalizeEmail(mailboxAccount);
      const provider =
        input.provider ?? userMailbox.provider ?? inferMailProvider(mailboxAccount);
      const from = normalizeEmail(input.from);
      const recipients = [...input.to, ...(input.cc ?? [])]
        .map(normalizeEmail)
        .filter(Boolean);
      const direction =
        input.direction ?? (from === mailboxAddress ? "outbound" : "inbound");
      const contactEmail =
        direction === "outbound"
          ? recipients.find((email) => email !== mailboxAddress)
          : from;
      if (!contactEmail) return null;
      const resolvedContact = resolveEmailContact(input.tenantId, contactEmail);
      if (!resolvedContact) return null;
      const contact = resolvedContact;

      const existing = db
        .list("communications")
        .find(
          (c) =>
            c.tenantId === input.tenantId &&
            (c.externalMessageId === input.externalMessageId ||
              (!!input.messageIdHeader && c.messageIdHeader === input.messageIdHeader)) &&
            normalizeEmail(c.mailboxAccount) === mailboxAddress
        );
      if (existing) {
        const updatedExisting = db.update("communications", existing.id, {
          subject: input.subject ?? existing.subject,
          body: input.body,
          bodyHtml: input.bodyHtml ?? existing.bodyHtml,
          rawMimeRef: input.rawMimeRef ?? existing.rawMimeRef,
          rfc822MessageId: input.rfc822MessageId ?? input.messageIdHeader ?? existing.rfc822MessageId,
          messageIdHeader: input.messageIdHeader ?? existing.messageIdHeader,
          inReplyToHeader: input.inReplyToHeader ?? existing.inReplyToHeader,
          references: input.references ?? existing.references,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          attachments: input.attachments ?? existing.attachments,
          snippet: input.snippet ?? existing.snippet,
          isRead: input.isRead ?? existing.isRead,
          mailboxLabels: input.mailboxLabels ?? existing.mailboxLabels,
          deliveryStatus: direction === "inbound" ? "received" : "synced",
          externalThreadId: input.externalThreadId ?? existing.externalThreadId,
          externalUrl: input.externalUrl ?? existing.externalUrl,
          carrierSubmissionId: input.carrierSubmissionId ?? existing.carrierSubmissionId,
        }) ?? existing;
        const linkedExisting = direction === "inbound"
          ? linkInboundCarrierCommunicationToSubmission(updatedExisting)
          : updatedExisting;
        communicationStatusEvent(linkedExisting);
        if (direction === "inbound") {
          processImportedInboundCommunication(
            input.tenantId,
            input.mailboxUserId,
            linkedExisting.id
          );
        }
        return linkedExisting;
      }

      const referencedThreadId = threadIdFromReferencedHeaders(input.tenantId, {
        externalThreadId: input.externalThreadId,
        inReplyToHeader: input.inReplyToHeader,
        references: input.references,
      });
      const subjectKey = (input.subject ?? "message")
        .trim()
        .toLowerCase()
        .replace(/^re:\s*/i, "")
        .replace(/\s+/g, "-")
        .slice(0, 64);
      const row: Communication = {
        id: uid("comm"),
        tenantId: input.tenantId,
        ...contact,
        channel: "email",
        direction,
        subject: input.subject,
        threadId: referencedThreadId ?? (input.externalThreadId
          ? `provider:${provider}:${input.externalThreadId}`
          : `provider:${provider}:${contactEmail}:${subjectKey}`),
        body: input.body,
        bodyHtml: input.bodyHtml,
        rawMimeRef: input.rawMimeRef,
        rfc822MessageId: input.rfc822MessageId ?? input.messageIdHeader,
        messageIdHeader: input.messageIdHeader,
        inReplyToHeader: input.inReplyToHeader,
        references: input.references,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        attachments: input.attachments,
        snippet: input.snippet,
        isRead: input.isRead,
        mailboxLabels: input.mailboxLabels,
        createdById: direction === "outbound" ? input.mailboxUserId : undefined,
        mailboxOrigin: "provider_sync",
        mailboxAccount,
        mailboxProvider: provider,
        mailboxConnectionId: input.mailboxConnectionId ?? userMailbox.connectionId,
        deliveryStatus: direction === "inbound" ? "received" : "synced",
        externalMessageId: input.externalMessageId,
        externalThreadId: input.externalThreadId,
        externalUrl: input.externalUrl,
        carrierSubmissionId: input.carrierSubmissionId,
        createdAt: input.sentAt ?? nowIso(),
      };
      db.insert("communications", row);
      const mailboxConnectionId = input.mailboxConnectionId ?? userMailbox.connectionId;
      if (mailboxConnectionId) {
        db.update("connectedMailboxes", mailboxConnectionId, {
          lastSyncAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
      if (direction === "outbound") {
        markMailboxSent(mailboxConnectionId);
        reconcileOutboxFromProviderMessage(row);
      }
      const linkedRow = direction === "inbound" ? linkInboundCarrierCommunicationToSubmission(row) : row;
      communicationStatusEvent(linkedRow);
      if (direction === "inbound") {
        processImportedInboundCommunication(
          input.tenantId,
          input.mailboxUserId,
          linkedRow.id
        );
      }
      return linkedRow;
    },
  },

  // ------------ AI agent notifications ------------
  // Surfaces inside the Activity Center. The agent acknowledges each
  // notification — that ack spawns a Task (the human follow-up).
  aiNotifications: {
    listByTenant(tenantId: string): AiNotification[] {
      return tenantFilter(db.list("aiNotifications"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    listUnacked(tenantId: string): AiNotification[] {
      return this.listByTenant(tenantId).filter((n) => !n.acknowledgedAt);
    },
    acknowledge(
      id: string,
      userId?: string
    ): { notification: AiNotification; task: Task; sentMessageId: string | null } | null {
      const notif = db.list("aiNotifications").find((n) => n.id === id);
      if (!notif || notif.acknowledgedAt) return null;
      if (
        notif.kind === "goal_request" ||
        notif.kind === "timesheet_due" ||
        notif.kind === "inbound_notice" ||
        notif.kind === "quote_ready"
      ) {
        return null;
      }
      // The AI auto-reply already went out on requestEdit submission
      // (no approval gate). Acknowledge here just creates the
      // follow-up Task — it doesn't trigger another send. The
      // sentMessageId field on the return shape is preserved for
      // callers but reflects the message that was already sent.
      const sentMessageId = notif.messageId ?? null;

      const taskId = uid("task");
      const task: Task = {
        id: taskId,
        tenantId: notif.tenantId,
        title: notif.title,
        description: notif.summary,
        customerId: notif.customerId,
        prospectId: notif.prospectId,
        assetId: notif.assetId,
        policyId: notif.policyId,
        messageId: notif.messageId,
        source: "ai_notification",
        sourceNotificationId: notif.id,
        topic: notif.topic,
        severity: notif.severity ?? "warning",
        severityReason: notif.severityReason,
        status: "open",
        aiSummary: notif.aiSummary,
        originalMessageContent: notif.originalMessageContent,
        originalMessageId: notif.originalMessageId,
        aiReplyBody: notif.aiReplyBody,
        aiReplySubject: notif.aiReplySubject,
        assignedToId: notif.assignedToId,
        createdById: userId,
        createdAt: nowIso(),
      };
      db.insert("tasks", task);
      logTaskAudit({
        tenantId: notif.tenantId,
        actorId: userId,
        action: "task.created_from_notification",
        taskId,
        metadata: { notificationId: notif.id, sentMessageId },
      });
      const updated = db.update("aiNotifications", id, {
        acknowledgedAt: nowIso(),
        acknowledgedById: userId,
        taskId,
      });
      return updated ? { notification: updated, task, sentMessageId } : null;
    },
    dismiss(id: string, userId?: string): AiNotification | null {
      const notif = db.list("aiNotifications").find((n) => n.id === id);
      if (!notif || notif.acknowledgedAt) return null;
      return db.update("aiNotifications", id, {
        acknowledgedAt: nowIso(),
        acknowledgedById: userId,
      });
    },
    remove(id: string): boolean {
      return db.remove("aiNotifications", id);
    },
    // Promote every pending task-spawning notification straight into a
    // Task. The Activity Center used to keep these in a manual "New
    // notifications" inbox the agent had to acknowledge one-by-one;
    // now they land directly as activities. Manager broadcasts
    // (override / reassign requests) and goal celebrations are NOT
    // promoted — they're surfaced elsewhere. Idempotent: acknowledge()
    // no-ops on already-acked rows.
    autoPromote(tenantId: string, userId?: string): number {
      const pending = this.listUnacked(tenantId).filter(
        (n) => n.kind === "policy_edit_reply"
      );
      let promoted = 0;
      for (const n of pending) {
        if (this.acknowledge(n.id, userId)) promoted += 1;
      }
      return promoted;
    },
    // Generic insert — used for non-policy notifications like goal
    // achievements that don't go through requestEdit.
    create(input: Omit<AiNotification, "id" | "createdAt">): AiNotification {
      const row: AiNotification = { ...input, id: uid("ain"), createdAt: nowIso() };
      db.insert("aiNotifications", row);
      return row;
    },
  },

  // ------------ Contact routing requests ------------
  routing: {
    hasAssignedOwner(kind: "client" | "prospect", targetId: string): boolean {
      const contact =
        kind === "client"
          ? db.list("customers").find((row) => row.id === targetId)
          : db.list("prospects").find((row) => row.id === targetId);
      return !!assignedContactOwner(contact);
    },
    isDismissed(kind: "client" | "prospect", targetId: string): boolean {
      const contact =
        kind === "client"
          ? db.list("customers").find((row) => row.id === targetId)
          : db.list("prospects").find((row) => row.id === targetId);
      return !!contact?.routingDismissedAt;
    },
    dismiss(kind: "client" | "prospect", targetId: string, actorId?: string) {
      const patch = {
        routingDismissedAt: nowIso(),
        routingDismissedById: actorId,
      };
      return kind === "client"
        ? db.update("customers", targetId, patch)
        : db.update("prospects", targetId, patch);
    },
    remove(kind: "client" | "prospect", targetId: string, actorId?: string) {
      db
        .list("tasks")
        .filter(
          (task) =>
            (kind === "client" ? task.customerId === targetId : task.prospectId === targetId) &&
            (!!task.routeRequestKind || task.awaitingManagerAssignment)
        )
        .forEach((task) => db.remove("tasks", task.id));

      // This queue control must never erase the client or prospect. Permanently
      // remove its routing entry while preserving the underlying contact record.
      const patch = {
        routingDismissedAt: nowIso(),
        routingDismissedById: actorId,
      };
      return kind === "client"
        ? db.update("customers", targetId, patch)
        : db.update("prospects", targetId, patch);
    },
    restore(kind: "client" | "prospect", targetId: string) {
      const patch = {
        routingDismissedAt: undefined,
        routingDismissedById: undefined,
      };
      return kind === "client"
        ? db.update("customers", targetId, patch)
        : db.update("prospects", targetId, patch);
    },
    reconcileAccountWorkOwnership(tenantId: string): number {
      let changed = 0;
      db
        .list("tasks")
        .filter(
          (task) =>
            task.tenantId === tenantId &&
            !task.completedAt &&
            task.status !== "resolved" &&
            !task.routeRequestKind &&
            (!!task.customerId || !!task.prospectId)
        )
        .forEach((task) => {
          const ownerIds = linkedContactOwners({
            tenantId,
            customerId: task.customerId,
            prospectId: task.prospectId,
          });
          const [ownerId, ...additionalOwnerIds] = ownerIds;
          if (!ownerId) return;
          const shouldInheritOwner =
            !task.assignedToId || task.awaitingManagerAssignment || task.source === "ai_notification";
          if (!shouldInheritOwner) return;
          if (task.assignedToId === ownerId && !task.awaitingManagerAssignment) return;
          db.update("tasks", task.id, {
            assignedToId: ownerId,
            additionalAssignedToIds:
              additionalOwnerIds.length > 0 ? additionalOwnerIds : undefined,
            awaitingManagerAssignment: false,
          });
          changed += 1;
        });
      db
        .list("aiNotifications")
        .filter(
          (notification) =>
            notification.tenantId === tenantId &&
            !notification.acknowledgedAt &&
            (!!notification.customerId || !!notification.prospectId)
        )
        .forEach((notification) => {
          const ownerId = linkedContactOwner({
            tenantId,
            customerId: notification.customerId,
            prospectId: notification.prospectId,
          });
          if (!ownerId || notification.assignedToId === ownerId) return;
          db.update("aiNotifications", notification.id, { assignedToId: ownerId });
          changed += 1;
        });
      return changed;
    },
    findOpenContactRouteRequest(
      kind: "client" | "prospect",
      targetId: string
    ): Task | undefined {
      return db.list("tasks").find((t) => {
        if (t.completedAt || t.status === "resolved" || !t.awaitingManagerAssignment) return false;
        if (t.routeRequestKind !== kind) return false;
        return kind === "client" ? t.customerId === targetId : t.prospectId === targetId;
      });
    },
    requestContactRoute(input: {
      tenantId: string;
      kind: "client" | "prospect";
      targetId: string;
      mode: "route" | "reroute";
      actorId: string;
      requestedAgentIds: string[];
    }): Task {
      // An explicit new routing request always re-opens a row that a
      // manager previously dismissed from the routing surface.
      this.restore(input.kind, input.targetId);
      const existing = this.findOpenContactRouteRequest(input.kind, input.targetId);
      if (existing) return existing;
      const requestedAgentIds = Array.from(
        new Set(input.requestedAgentIds.filter(Boolean))
      );
      if (requestedAgentIds.length === 0) {
        throw new Error("Select who this should be routed to before submitting the request.");
      }

      const contact =
        input.kind === "client"
          ? db.list("customers").find((c) => c.id === input.targetId)
          : db.list("prospects").find((p) => p.id === input.targetId);
      if (!contact || contact.tenantId !== input.tenantId) {
        throw new Error(`${input.kind === "client" ? "Client" : "Prospect"} not found.`);
      }

      const requester = db.list("users").find((u) => u.id === input.actorId);
      const requestedAgents = requestedAgentIds
        .map((id) => db.list("users").find((u) => u.id === id && u.tenantId === input.tenantId))
        .filter((u): u is User => !!u && isRoutableStaffRole(u.role));
      if (requestedAgents.length === 0) {
        throw new Error("Select a valid agency member before submitting the route request.");
      }
      const routeWord = input.mode === "route" ? "Route" : "Reroute";
      const contactLabel = input.kind === "client" ? "client" : "prospect";
      const requestedNames = requestedAgents.map((u) => u.name).join(", ");
      const requestedAt = nowIso();
      const row: Task = {
        id: uid("task"),
        tenantId: input.tenantId,
        title: `${routeWord} ${contactLabel} requested: ${contact.name}`,
        description: `${requester?.name ?? "A staff member"} requested that a manager ${input.mode} ${contact.name} to ${requestedNames}. Review and confirm the owner from the Routing card to complete the request.`,
        customerId: input.kind === "client" ? contact.id : undefined,
        prospectId: input.kind === "prospect" ? contact.id : undefined,
        source: "manual",
        status: "open",
        severity: "warning",
        topic: "other",
        awaitingManagerAssignment: true,
        routeRequestKind: input.kind,
        routeRequestMode: input.mode,
        routeRequestToAgentIds: requestedAgents.map((u) => u.id),
        routeRequestedAt: requestedAt,
        routeRequestedById: input.actorId,
        createdById: input.actorId,
        createdAt: requestedAt,
      };
      db.insert("tasks", row);
      logTaskAudit({
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: "contact.route_requested",
        taskId: row.id,
        metadata: {
          kind: input.kind,
          targetId: input.targetId,
          mode: input.mode,
          requestedAgentIds: requestedAgents.map((u) => u.id),
        },
      });
      return row;
    },
    completeContactRouteRequest(
      taskId: string,
      agentIds: string[],
      actorId?: string,
      options?: { csrId?: string | null; csrIds?: string[] }
    ): Task | null {
      const row = db.list("tasks").find((t) => t.id === taskId);
      const ids = Array.from(new Set(agentIds.filter(Boolean)));
      if (!row || ids.length === 0 || !row.routeRequestKind) return null;

      if (row.routeRequestKind === "client") {
        if (!row.customerId) return null;
        api.customers.assignAgents(row.customerId, ids, actorId, options);
      } else {
        if (!row.prospectId) return null;
        api.prospects.assignAgents(row.prospectId, ids, actorId, options);
      }

      const [primary, ...additional] = ids;
      const updated = db.update("tasks", taskId, {
        assignedToId: primary,
        additionalAssignedToIds: additional.length > 0 ? additional : undefined,
        awaitingManagerAssignment: false,
        status: "resolved",
        completedAt: nowIso(),
        completedById: actorId,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId,
        action: "contact.route_request_completed",
        taskId,
        metadata: {
          kind: row.routeRequestKind,
          mode: row.routeRequestMode,
          toAgentIds: ids,
        },
      });
      return updated;
    },
  },

  // ------------ Tasks (Activity Center entries) ------------
  // Each Task represents one row in the Activity Center surface
  // (sidebar #2). Acknowledging an AiNotification spawns one of
  // these; the agent then progresses it through in_progress →
  // resolved (or snoozes for a fixed interval). Every state
  // change writes an audit row via logTaskAudit so managers can
  // reconstruct the full trail from /master/data or the client
  // profile timeline.
  tasks: {
    isResolved(t: Task): boolean {
      return !!t.completedAt || t.status === "resolved";
    },
    get(id: string): Task | undefined {
      return db.list("tasks").find((t) => t.id === id);
    },
    listByTenant(tenantId: string): Task[] {
      // Sort order: manual priorityRank desc (pinned=1 → 0 → -1 sent
      // to bottom), then newest first.
      return tenantFilter(db.list("tasks"), tenantId)
        .filter((task) => !isLegacyQuoteReadyActivity(task))
        .sort((a, b) => {
        const pa = a.priorityRank ?? 0;
        const pb = b.priorityRank ?? 0;
        if (pa !== pb) return pb - pa;
        const qa = a.queuePosition;
        const qb = b.queuePosition;
        if (qa != null || qb != null) {
          const va = qa ?? Number.MAX_SAFE_INTEGER;
          const vb = qb ?? Number.MAX_SAFE_INTEGER;
          if (va !== vb) return va - vb;
        }
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    },
    listOpen(tenantId: string): Task[] {
      // "Open" = anything not resolved AND not currently snoozed.
      // Snoozed tasks come back into view automatically once
      // snoozedUntil passes (we compare against `now` here).
      const now = Date.now();
      return this.listByTenant(tenantId).filter((t) => {
        if (this.isResolved(t)) return false;
        if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now) return false;
        return true;
      });
    },
    listSnoozed(tenantId: string): Task[] {
      const now = Date.now();
      return this.listByTenant(tenantId).filter(
        (t) =>
          !this.isResolved(t) &&
          t.snoozedUntil &&
          new Date(t.snoozedUntil).getTime() > now
      );
    },
    listCompleted(tenantId: string): Task[] {
      return this.listByTenant(tenantId).filter((t) => this.isResolved(t));
    },
    // Implicit-status helper: respects both completedAt and the
    // future-snooze window. Use this on render so the badge / chip
    // matches what listOpen / listSnoozed return.
    statusOf(t: Task): TaskStatus {
      if (this.isResolved(t)) return "resolved";
      if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > Date.now()) return "snoozed";
      if (t.status === "in_progress") return "in_progress";
      return "open";
    },
    // AI resolution checklist diagnostics. Kept for historical audit
    // and tests that explain what the system has observed, but the UI
    // no longer blocks staff from marking an activity resolved.
    // True when any outbound message has gone out to this activity's
    // contact — either via the Messages page, the inline thread on
    // the detail page, or the agent reply flow. Sending a message
    // counts as an active touchpoint for the diagnostic checklist below.
    hasOutboundTouchpoint(t: Task): boolean {
      const replied = this.history(t.id).some((h) => h.action === "task.replied");
      if (replied) return true;
      // Fallback: an outbound Communication a *person* sent to the
      // contact during / after the task was opened. AI-authored
      // messages (createdById "ai" — e.g. the express-quote auto
      // confirmation SMS) deliberately do NOT count as a human
      // touchpoint. An automated acknowledgment isn't a substitute for
      // staff follow-up when reviewing diagnostics.
      const since = new Date(t.createdAt).getTime();
      const contactComms = db.list("communications").filter((c) => {
        if (c.direction !== "outbound") return false;
        if (c.createdById === "ai") return false;
        if (t.customerId && c.customerId === t.customerId) return true;
        if (t.prospectId && c.prospectId === t.prospectId) return true;
        return false;
      });
      return contactComms.some(
        (c) => new Date(c.createdAt).getTime() >= since
      );
    },
    // True when this activity has recorded its questionnaire send
    // action, whether manual or autopilot.
    hasSentQuestionnaire(t: Task): boolean {
      return this.history(t.id).some((h) => h.action === "task.questionnaire_sent");
    },
    // Documents still waiting for this customer to receive an
    // e-signature request. Autopilot sends these deterministically.
    // ON THIS activity. A new activity is a new activity — the
    // customer having received e-sign docs on a previous activity
    // does NOT pre-satisfy it. (No-contact activities have nothing to
    // send, so they're auto-clear.)
    pendingEsignDocs(t: Task): Document[] {
      if (!t.customerId) return [];
      return db
        .list("documents")
        .filter(
          (d) =>
            d.customerId === t.customerId &&
            !!d.customerEsignRequired &&
            !d.customerEsignSentAt &&
            !d.customerEsignSignedAt
        );
    },
    hasSentEsignDocs(t: Task): boolean {
      if (!t.customerId) return true;
      return (
        this.pendingEsignDocs(t).length === 0 ||
        this.history(t.id).some((h) => h.action === "task.esign_docs_sent")
      );
    },
    // AI change-verification diagnostic. Reads what the activity is ABOUT
    // (topic + title + description) and confirms the corresponding
    // real-world change has actually landed on the account since the
    // activity opened — e.g. an "add a vehicle" activity stays pending
    // until a new asset shows up. Returns `required:false` for
    // activities with no machine-verifiable change (general questions,
    // callbacks) so those resolve exactly as before.
    resolutionCheck(t: Task): {
      required: boolean;
      detected: boolean;
      classification: ActivityResolution;
      reasoning: string;
    } {
      const classification = aiClassifyActivityResolution({
        topic: t.topic,
        title: t.title,
        description: t.description,
      });
      // Nothing concrete to verify, or no customer to inspect (a
      // prospect-only activity has no policies/assets yet) → satisfied.
      if (classification.kind === "none" || !t.customerId) {
        return {
          required: false,
          detected: true,
          classification,
          reasoning: "",
        };
      }
      const since = new Date(t.createdAt).getTime();
      const after = (iso?: string) =>
        !!iso && new Date(iso).getTime() >= since;
      const cid = t.customerId;

      let detected = false;
      switch (classification.kind) {
        case "asset_added":
          detected = db
            .list("assets")
            .some((a) => a.customerId === cid && after(a.createdAt));
          break;
        case "policy_changed": {
          const newPolicy = db
            .list("policies")
            .some((p) => p.customerId === cid && after(p.createdAt));
          // A logged "Policy edited" status crumb (written by the
          // edit-policy modal) also counts as the change landing.
          const editLogged = db
            .list("statusEvents")
            .some(
              (e) =>
                e.customerId === cid &&
                !!e.policyId &&
                after(e.createdAt) &&
                /edit/i.test(e.message)
            );
          detected = newPolicy || editLogged;
          break;
        }
        case "document_added":
          detected = db
            .list("documents")
            .some((d) => d.customerId === cid && after(d.uploadedAt));
          break;
        case "claim_filed":
          detected = db
            .list("claims")
            .some((c) => c.customerId === cid && after(c.openedAt));
          break;
      }

      const reasoning = detected
        ? `AI detected ${classification.evidence}.`
        : `AI has not yet detected ${classification.evidence}. ${classification.expectation}`;
      return { required: true, detected, classification, reasoning };
    },
    checklistFor(t: Task): {
      label: string;
      detail: string;
      done: boolean;
    }[] {
      const steps: { label: string; detail: string; done: boolean }[] = [];

      // Step 1 — agent has picked up the work
      steps.push({
        label: "Activity started",
        detail:
          "Click 'Start activity' once you begin working it so the team knows it's actively owned — and the customer is auto-texted that an agent is on it.",
        done:
          !!t.startedAt || this.statusOf(t) === "in_progress" || !!t.completedAt,
      });

      // Customer activities require customer-facing automation to run:
      // AI sends the questionnaire and deterministic e-sign packets go
      // out automatically before the activity can be resolved.
      if (t.customerId) {
        // Step 2 — questionnaire sent
        steps.push({
          label: "Questionnaire sent to the customer",
          detail:
            "AI sends the intake questions automatically when the activity starts. This step clears once the send is audited.",
          done: this.hasSentQuestionnaire(t),
        });

        // Step 3 — documents requiring e-sign have been sent
        // (auto-satisfied when none require the customer's signature)
        const pendingEsign = db
          .list("documents")
          .filter(
            (d) =>
              d.customerId === t.customerId &&
              !!d.customerEsignRequired &&
              !d.customerEsignSentAt &&
              !d.customerEsignSignedAt
          ).length;
        steps.push({
          label: "Documents requiring e-sign sent",
          detail:
            pendingEsign > 0
              ? `${pendingEsign} document${
                  pendingEsign === 1 ? "" : "s"
                } need the customer's e-signature. The activity autopilot emails them automatically; signed copies file themselves automatically.`
              : "No documents are waiting on the customer's e-signature.",
          done: this.hasSentEsignDocs(t),
        });
      }

      // Final diagnostic — the AI records whether the concrete change
      // the activity asked for actually happened on the account (e.g.
      // a vehicle was added). Skipped for activities with no verifiable
      // change.
      const res = this.resolutionCheck(t);
      if (res.required) {
        steps.push({
          label: res.classification.label,
          detail: res.reasoning,
          done: res.detected,
        });
      }

      // Renewal-document update diagnostic. When the AI inspected this
      // renewal and flagged term-bound documents for an update, the
      // checklist remains pending until each flagged doc has a
      // published successor for the same renewal.
      if (t.renewalId) {
        const allDocs = db.list("documents");
        const renewal = db.list("renewals").find((r) => r.id === t.renewalId);
        const policy = renewal
          ? db.list("policies").find((p) => p.id === renewal.policyId)
          : undefined;
        const policyCurrentTermYear = (() => {
          const sourceDate = policy?.effectiveDate ?? policy?.renewalDate;
          if (!sourceDate) return undefined;
          const year = new Date(sourceDate).getUTCFullYear();
          if (!Number.isFinite(year)) return undefined;
          return policy?.effectiveDate ? year : year - 1;
        })();
        const termYearOf = (doc: Document) => doc.policyTermYear ?? policyCurrentTermYear ?? 0;
        const hasPublishedSuccessor = (doc: Document) =>
          allDocs.some(
            (candidate) =>
              candidate.policyId === doc.policyId &&
              candidate.id !== doc.id &&
              candidate.type === doc.type &&
              !!candidate.publishedAt &&
              candidate.status !== "rejected" &&
              (candidate.supersedesId === doc.id || termYearOf(candidate) > termYearOf(doc))
          );
        const latestSameTypeYear = (doc: Document) =>
          allDocs
            .filter((candidate) => candidate.policyId === doc.policyId && candidate.type === doc.type)
            .reduce<number | null>((latest, candidate) => {
              const year = termYearOf(candidate);
              return latest == null ? year : Math.max(latest, year);
            }, null);
        const flagged = allDocs.filter((d) => {
          if (d.renewalForRenewalId !== t.renewalId || !d.needsRenewalUpdate) return false;
          if (hasPublishedSuccessor(d)) return false;
          const sourceYear = termYearOf(d);
          const latestYear = latestSameTypeYear(d);
          return !latestYear || sourceYear >= latestYear;
        });
        if (flagged.length > 0) {
          steps.push({
            label: "Renewal documents updated",
            detail: `${flagged.length} document${
              flagged.length === 1 ? "" : "s"
            } still need to be updated for the new renewal term. Click "Update for Renewal" on each in the policy's Documents card, preview, then Publish.`,
            done: false,
          });
        }
      }

      return steps;
    },
    // Questionnaire send action. Emails the customer the activity's
    // pre-drafted questionnaire (or a generic one) and records the
    // questionnaire-sent audit so the diagnostic checklist records
    // the touchpoint. Does NOT auto-resolve.
    sendQuestionnaire(
      id: string,
      userId?: string,
      options: { automated?: boolean } = {}
    ): Task | null {
      const t = db.list("tasks").find((x) => x.id === id);
      if (!t || !t.customerId) return null;
      if (this.hasSentQuestionnaire(t)) return t;
      const subject = t.aiReplySubject ?? "A few questions to finalize your coverage";
      const body =
        t.aiReplyBody ??
        "Hi,\n\nTo move your coverage forward we need a few details:\n\n1. Confirm the asset(s) you'd like covered\n2. Any prior claims in the last 5 years\n3. Current coverage / carrier (if any)\n4. Anything else we should know about the risk\n\nReply right to this thread and we'll get carrier quotes back to you the same day.";
      api.communications.create({
        tenantId: t.tenantId,
        customerId: t.customerId,
        channel: "email",
        direction: "outbound",
        subject,
        body,
        createdById: userId,
      });
      logTaskAudit({
        tenantId: t.tenantId,
        actorId: userId,
        action: "task.questionnaire_sent",
        taskId: id,
        metadata: { automated: !!options.automated },
      });
      return db.list("tasks").find((x) => x.id === id) ?? null;
    },
    // E-signature send action. Emails the customer
    // the documents that still need their signature (marks them sent),
    // then records the audit for the diagnostic checklist. Once the
    // customer signs in their portal the executed copy files itself
    // automatically (see esign.markCustomerSigned).
    sendEsignDocuments(
      id: string,
      userId?: string,
      options: { automated?: boolean } = {}
    ): Task | null {
      const t = db.list("tasks").find((x) => x.id === id);
      if (!t || !t.customerId) return null;
      const customer = db.list("customers").find((c) => c.id === t.customerId);
      // Docs that need the customer's e-signature and haven't been
      // emailed yet.
      const pending = this.pendingEsignDocs(t);
      if (
        pending.length === 0 &&
        this.history(t.id).some((h) => h.action === "task.esign_docs_sent")
      ) {
        return t;
      }
      if (pending.length > 0 && customer) {
        const firstName = customer.name.split(/\s+/)[0];
        const lines = pending.map((d) => `  • ${d.fileName}`).join("\n");
        const subject =
          pending.length === 1
            ? "A document is ready for your e-signature"
            : `${pending.length} documents are ready for your e-signature`;
        const body = [
          `Hi ${firstName},`,
          ``,
          `Please e-sign the following from your client portal (Documents → E-sign):`,
          ``,
          lines,
          ``,
          `Once signed, the executed copy is filed to your account automatically — no upload needed.`,
        ].join("\n");
        const comm = api.communications.create({
          tenantId: t.tenantId,
          customerId: t.customerId,
          channel: "email",
          direction: "outbound",
          subject,
          body,
          createdById: userId,
        });
        const sentAt = nowIso();
        pending.forEach((d) =>
          db.update("documents", d.id, {
            customerEsignSentAt: sentAt,
            esignCommunicationId: comm.id,
          })
        );
      }
      logTaskAudit({
        tenantId: t.tenantId,
        actorId: userId,
        action: "task.esign_docs_sent",
        taskId: id,
        metadata: { automated: !!options.automated, documentCount: pending.length },
      });
      return db.list("tasks").find((x) => x.id === id) ?? null;
    },
    // Activity autopilot. When an agent starts work, AI prepares and
    // sends the standard questionnaire while deterministic e-sign
    // packets go out automatically if any are waiting. Idempotent:
    // reloads and repeated starts do not duplicate messages.
    ensureAutopilot(id: string, userId?: string): Task | null {
      const t = db.list("tasks").find((x) => x.id === id);
      if (!t || !t.customerId) return t ?? null;
      if (!this.hasSentQuestionnaire(t)) {
        this.sendQuestionnaire(id, userId, { automated: true });
      }
      const fresh = db.list("tasks").find((x) => x.id === id) ?? t;
      if (this.pendingEsignDocs(fresh).length > 0) {
        this.sendEsignDocuments(id, userId, { automated: true });
      }
      return db.list("tasks").find((x) => x.id === id) ?? fresh;
    },
    canResolve(t: Task): { allowed: boolean; missingSteps: number } {
      // Manager override short-circuits the checklist.
      if (t.overrideGrantedAt) return { allowed: true, missingSteps: 0 };
      const steps = this.checklistFor(t);
      const missing = steps.filter((s) => !s.done).length;
      return { allowed: missing === 0, missingSteps: missing };
    },
    // Agent → manager workflow. Creates an AiNotification on
    // every manager's queue in the tenant so whoever is on duty
    // can pick it up. Also flags the task so the agent sees the
    // pending state on their card.
    requestManagerOverride(
      taskId: string,
      byUserId: string,
      reason?: string
    ): { task: Task | null; notificationId: string | null } {
      const task = db.list("tasks").find((t) => t.id === taskId);
      if (!task) return { task: null, notificationId: null };
      const requestedAt = nowIso();
      const updated = db.update("tasks", taskId, {
        overrideRequestedAt: requestedAt,
        overrideRequestedById: byUserId,
        overrideReason: reason,
      });
      const requester = db.list("users").find((u) => u.id === byUserId);
      const customer = task.customerId
        ? db.list("customers").find((c) => c.id === task.customerId)
        : null;
      const notificationId = uid("ain");
      const summary = [
        `${requester?.name ?? "An agent"} is asking to resolve the activity "${
          task.title
        }" before all AI checklist items are complete${
          customer ? ` for ${customer.name}` : ""
        }.`,
        reason ? `Reason: ${reason}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      db.insert("aiNotifications", {
        id: notificationId,
        tenantId: task.tenantId,
        kind: "override_request",
        title: `Agent requested manager override on activity`,
        summary,
        customerId: task.customerId,
        prospectId: task.prospectId,
        assetId: task.assetId,
        policyId: task.policyId,
        // Link the source task so the manager can review the
        // checklist + grant the override in one click from their
        // Activity Center notification.
        taskId,
        createdAt: requestedAt,
        severity: "urgent",
        topic: "other",
        aiSummary: summary,
      });
      logTaskAudit({
        tenantId: task.tenantId,
        actorId: byUserId,
        action: "task.override_requested",
        taskId,
        metadata: { reason, notificationId },
      });
      return { task: updated, notificationId };
    },
    // Agent → manager request to move an activity to a different
    // agent. Flags the task + drops a notification on the managers'
    // Activity Center so any manager can action it.
    requestReassign(
      taskId: string,
      byUserId: string,
      toAgentId: string,
      reason?: string
    ): { task: Task | null; notificationId: string | null } {
      const task = db.list("tasks").find((t) => t.id === taskId);
      if (!task) return { task: null, notificationId: null };
      const requestedAt = nowIso();
      const updated = db.update("tasks", taskId, {
        reassignRequestedAt: requestedAt,
        reassignRequestedById: byUserId,
        reassignRequestToId: toAgentId,
        reassignReason: reason,
      });
      const requester = db.list("users").find((u) => u.id === byUserId);
      const target = db.list("users").find((u) => u.id === toAgentId);
      const customer = task.customerId
        ? db.list("customers").find((c) => c.id === task.customerId)
        : null;
      const notificationId = uid("ain");
      const summary = [
        `${requester?.name ?? "An agent"} is asking to reassign the activity "${
          task.title
        }"${customer ? ` for ${customer.name}` : ""} to ${target?.name ?? "another agent"}.`,
        reason ? `Reason: ${reason}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      db.insert("aiNotifications", {
        id: notificationId,
        tenantId: task.tenantId,
        kind: "reassign_request",
        title: `Agent requested a reassignment`,
        summary,
        customerId: task.customerId,
        prospectId: task.prospectId,
        assetId: task.assetId,
        policyId: task.policyId,
        taskId,
        createdAt: requestedAt,
        severity: "warning",
        topic: "other",
        aiSummary: summary,
      });
      logTaskAudit({
        tenantId: task.tenantId,
        actorId: byUserId,
        action: "task.reassign_requested",
        taskId,
        metadata: { toAgentId, reason, notificationId },
      });
      return { task: updated, notificationId };
    },
    grantManagerOverride(taskId: string, byUserId: string): Task | null {
      const task = db.list("tasks").find((t) => t.id === taskId);
      if (!task) return null;
      const updated = db.update("tasks", taskId, {
        overrideGrantedAt: nowIso(),
        overrideGrantedById: byUserId,
      });
      logTaskAudit({
        tenantId: task.tenantId,
        actorId: byUserId,
        action: "task.override_granted",
        taskId,
      });
      return updated;
    },
    // Authorization for manual activity creation. Managers (and
    // master admins) can create activities for any contact; agents
    // can only create them for clients / prospects assigned to them.
    // A general activity with no contact is allowed for any staff.
    canCreateActivityFor(
      viewer: { id: string; role: Role },
      contact: { customerId?: string; prospectId?: string }
    ): boolean {
      if (isRoutingManagerRole(viewer.role) || viewer.role === "master_admin") return true;
      if (viewer.role !== "agent" && viewer.role !== "csr") return false;
      if (contact.customerId) {
        const c = db.list("customers").find((x) => x.id === contact.customerId);
        if (!c) return false;
        return contactIsOwnedBy(c, viewer.id);
      }
      if (contact.prospectId) {
        const p = db.list("prospects").find((x) => x.id === contact.prospectId);
        if (!p) return false;
        return contactIsOwnedBy(p, viewer.id);
      }
      return true;
    },
    create(input: {
      tenantId: string;
      title: string;
      description?: string;
      customerId?: string;
      prospectId?: string;
      assignedToId?: string;
      severity?: TaskSeverity;
      severityReason?: string;
      topic?: import("@/types").TaskTopic;
      awaitingManagerAssignment?: boolean;
      renewalId?: string;
      policyId?: string;
      createdById?: string;
    }): Task {
      // Enforce the assignment rule: an agent acting as the creator
      // can only spin up activities for their own clients/prospects.
      if (input.createdById && (input.customerId || input.prospectId)) {
        const actor = db.list("users").find((u) => u.id === input.createdById);
        if (
          actor &&
          (actor.role === "agent" || actor.role === "csr") &&
          !this.canCreateActivityFor(
            { id: actor.id, role: actor.role },
            { customerId: input.customerId, prospectId: input.prospectId }
          )
        ) {
          throw new Error(
            "Agents can only create activities for clients or prospects assigned to them."
          );
        }
      }
      const inheritedOwnerIds = input.assignedToId
        ? []
        : linkedContactOwners({
          tenantId: input.tenantId,
          customerId: input.customerId,
          prospectId: input.prospectId,
        });
      const assignedToId = input.assignedToId ?? inheritedOwnerIds[0];
      const linkedToContact = !!input.customerId || !!input.prospectId;
      const row: Task = {
        id: uid("task"),
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        prospectId: input.prospectId,
        policyId: input.policyId,
        assignedToId,
        additionalAssignedToIds:
          !input.assignedToId && inheritedOwnerIds.length > 1
            ? inheritedOwnerIds.slice(1)
            : undefined,
        topic: input.topic,
        source: "manual",
        status: "open",
        severity: input.severity ?? "info",
        severityReason: input.severityReason,
        awaitingManagerAssignment:
          input.awaitingManagerAssignment ?? (linkedToContact && !assignedToId ? true : undefined),
        renewalId: input.renewalId,
        createdById: input.createdById,
        createdAt: nowIso(),
      };
      db.insert("tasks", row);
      logTaskAudit({
        tenantId: input.tenantId,
        actorId: input.createdById,
        action: "task.created",
        taskId: row.id,
      });
      return row;
    },
    markInProgress(id: string, userId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row || this.isResolved(row)) return null;
      // First-time flip records startedAt; subsequent flips (e.g.
      // after a snooze) keep the original timestamp so the card
      // always shows the handoff moment.
      const firstStart = !row.startedAt;
      const startedAt = row.startedAt ?? nowIso();
      const startedById = row.startedById ?? userId;
      const updated = db.update("tasks", id, {
        status: "in_progress",
        snoozedUntil: undefined,
        startedAt,
        startedById,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.in_progress",
        taskId: id,
      });
      // On the first start, email the customer that an agent has
      // picked up their request — the same kind of acknowledgment the
      // AI used to send when the activity was created.
      if (firstStart && row.customerId) {
        const customer = db.list("customers").find((c) => c.id === row.customerId);
        if (customer) {
          const firstName = customer.name.split(/\s+/)[0];
          api.communications.create({
            tenantId: row.tenantId,
            customerId: row.customerId,
            channel: "email",
            direction: "outbound",
            subject: "Your agency team is working on your request",
            body: `Hi ${firstName},\n\nOne of our agents has started working on your request. We'll follow up shortly with next steps.`,
            createdById: userId,
          });
        }
        this.ensureAutopilot(id, userId);
      }
      return db.list("tasks").find((x) => x.id === id) ?? updated;
    },
    markComplete(
      id: string,
      userId?: string,
      options: { resolutionNote?: string } = {}
    ): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row || this.isResolved(row)) return null;
      const completedAt = nowIso();
      const trimmedNote = options.resolutionNote?.trim();
      let resolutionNoteId: string | undefined;
      if (trimmedNote && (row.customerId || row.prospectId)) {
        const note = api.notes.create({
          tenantId: row.tenantId,
          authorId: userId ?? "system",
          customerId: row.customerId,
          prospectId: row.prospectId,
          policyId: row.policyId,
          visibility: "internal",
          body: `Activity closed out with agent note attached: ${row.title}\n\n${trimmedNote}`,
        });
        resolutionNoteId = note.id;
      }
      const updated = db.update("tasks", id, {
        completedAt,
        completedById: userId,
        status: "resolved",
        snoozedUntil: undefined,
        resolutionNote: trimmedNote || undefined,
        resolutionNoteId,
        resolutionNoteAt: trimmedNote ? completedAt : undefined,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.resolved",
        taskId: id,
        metadata: trimmedNote
          ? { resolutionNoteId, resolutionNote: trimmedNote }
          : undefined,
      });
      return updated;
    },
    reopen(id: string, userId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return null;
      const updated = db.update("tasks", id, {
        completedAt: undefined,
        completedById: undefined,
        status: "open",
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.reopened",
        taskId: id,
      });
      return updated;
    },
    snooze(id: string, days: 1 | 3 | 7, userId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row || this.isResolved(row)) return null;
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const updated = db.update("tasks", id, { status: "snoozed", snoozedUntil: until });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.snoozed",
        taskId: id,
        metadata: { days, until },
      });
      return updated;
    },
    assign(
      id: string,
      agentIdOrIds: string | string[] | undefined,
      byUserId?: string
    ): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return null;
      const ids = Array.from(
        new Set(
          (Array.isArray(agentIdOrIds)
            ? agentIdOrIds
            : agentIdOrIds
            ? [agentIdOrIds]
            : []
          ).filter(Boolean)
        )
      );
      const [primary, ...additional] = ids;
      // Reassigning clears any pending reassignment request and the
      // "awaiting manager assignment" flag (the manager just made the call).
      const updated = db.update("tasks", id, {
        assignedToId: primary,
        additionalAssignedToIds: additional.length > 0 ? additional : undefined,
        awaitingManagerAssignment: false,
        reassignRequestedAt: undefined,
        reassignRequestedById: undefined,
        reassignRequestToId: undefined,
        reassignReason: undefined,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: byUserId,
        action: "task.reassigned",
        taskId: id,
        metadata: { toAgentId: primary ?? null, toAgentIds: ids },
      });
      return updated;
    },
    logView(id: string, userId?: string) {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return;
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.viewed",
        taskId: id,
      });
    },
    logReply(id: string, userId?: string, metadata?: Record<string, unknown>) {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return;
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.replied",
        taskId: id,
        metadata,
      });
      // Express-quote follow-up tasks auto-resolve when the agent
      // sends the questionnaire reply — the activity's whole purpose
      // was "send this message", so once it's out the door we close
      // the loop without an extra click.
      if (row.expressQuoteFollowUp && !row.completedAt) {
        db.update("tasks", id, {
          status: "resolved",
          completedAt: nowIso(),
          completedById: userId,
        });
      }
    },
    // Spawned from the customer-side express quote flow. Pre-loads
    // aiReplyBody with a questionnaire so the agent can click Reply,
    // confirm the body, and send. Sending fires logReply, which
    // marks this task resolved (see auto-resolve above).
    createExpressQuoteFollowUp(input: {
      tenantId: string;
      customerId: string;
      quoteRequestId?: string;
      quoteSessionId?: string;
      title: string;
      description?: string;
      aiSummary?: string;
      aiReplyBody: string;
      aiReplySubject: string;
      severity?: TaskSeverity;
      severityReason?: string;
      assignedToId?: string;
      createdById?: string;
    }): Task {
      const taskId = uid("task");
      const inheritedOwnerIds = input.assignedToId
        ? []
        : linkedContactOwners({ tenantId: input.tenantId, customerId: input.customerId });
      const assignedToId = input.assignedToId ?? inheritedOwnerIds[0];
      const row: Task = {
        id: taskId,
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        quoteRequestId: input.quoteRequestId,
        quoteSessionId: input.quoteSessionId,
        customerId: input.customerId,
        source: "ai_notification",
        severity: input.severity ?? "warning",
        severityReason: input.severityReason,
        status: "open",
        topic: "policy_edit_request",
        aiSummary: input.aiSummary,
        aiReplyBody: input.aiReplyBody,
        aiReplySubject: input.aiReplySubject,
        assignedToId,
        additionalAssignedToIds:
          !input.assignedToId && inheritedOwnerIds.length > 1
            ? inheritedOwnerIds.slice(1)
            : undefined,
        awaitingManagerAssignment: assignedToId ? undefined : true,
        createdById: input.createdById,
        expressQuoteFollowUp: true,
        createdAt: nowIso(),
      };
      db.insert("tasks", row);
      logTaskAudit({
        tenantId: input.tenantId,
        actorId: input.createdById,
        action: "task.created_from_express_quote",
        taskId,
      });
      return row;
    },
    // Manager bypass of the missing-docs gate. Resolved without
    // all required documents on file → write a tamper-evident
    // audit row so the override is traceable.
    logManagerOverride(
      id: string,
      userId?: string,
      metadata?: Record<string, unknown>
    ) {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return;
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.manager_override",
        taskId: id,
        metadata,
      });
    },
    history(taskId: string): AuditLog[] {
      return db
        .list("audit")
        .filter((a) => a.entityType === "task" && a.entityId === taskId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    deleteActivity(id: string, actorId?: string): boolean {
      const row = db.list("tasks").find((task) => task.id === id);
      if (!row) return false;

      // Activity remarks are durable records of what happened. Deleting the
      // work item removes only the task itself and adds one final timeline
      // entry; existing status events, notes, messages, and attachments remain.
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: row.tenantId,
        source: actorId ? "agent" : "system",
        message: "Activity deleted",
        visibility: "internal",
        customerId: row.customerId,
        prospectId: row.prospectId,
        assetId: row.assetId,
        policyId: row.policyId,
        claimId: row.claimId,
        documentId: row.documentId,
        quoteSessionId: row.quoteSessionId,
        quoteRequestId: row.quoteRequestId,
        createdAt: nowIso(),
        createdById: actorId,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId,
        action: "task.deleted",
        taskId: row.id,
        metadata: { title: row.title },
      });
      return db.remove("tasks", id);
    },
    remove(id: string) {
      return db.remove("tasks", id);
    },
    // Manually escalate / downgrade an activity's importance. The
    // severity field already feeds the severity bar + icon color
    // (info=yellow / warning=amber / urgent=red); this lets a human
    // override the AI's initial assessment.
    setSeverity(id: string, severity: TaskSeverity, actorId?: string): Task | null {
      const updated = db.update("tasks", id, {
        severity,
        severityChangedAt: nowIso(),
        severityChangedById: actorId,
      });
      if (updated) {
        logTaskAudit({
          tenantId: updated.tenantId,
          actorId,
          action: "task.severity_changed",
          taskId: id,
          metadata: { severity },
        });
      }
      return updated;
    },
    setDueAt(id: string, dueAt: string | undefined, actorId?: string): Task | null {
      const updated = db.update("tasks", id, {
        dueAt,
        dueAtChangedAt: nowIso(),
        dueAtChangedById: actorId,
      });
      if (updated) {
        logTaskAudit({
          tenantId: updated.tenantId,
          actorId,
          action: dueAt ? "task.due_date_set" : "task.due_date_cleared",
          taskId: id,
          metadata: { dueAt },
        });
      }
      return updated;
    },
    reorderQueue(orderedIds: string[], movedTaskId: string, actorId?: string): Task[] {
      const uniqueIds = Array.from(new Set(orderedIds));
      const allTasks = db.list("tasks");
      const rows = uniqueIds
        .map((id) => allTasks.find((t) => t.id === id))
        .filter((t): t is Task => !!t);
      const moved = rows.find((t) => t.id === movedTaskId);
      if (!moved || rows.length < 2) return rows;
      if (rows.some((t) => t.tenantId !== moved.tenantId)) return rows;
      const stamp = nowIso();
      const updated = rows
        .map((task, index) =>
          db.update("tasks", task.id, {
            queuePosition: index + 1,
            queueChangedAt: stamp,
            queueChangedById: actorId,
            priorityRank: 0,
            priorityChangedAt: stamp,
            priorityChangedById: actorId,
          })
        )
        .filter((t): t is Task => !!t);
      logTaskAudit({
        tenantId: moved.tenantId,
        actorId,
        action: "task.reordered_queue",
        taskId: movedTaskId,
        metadata: { orderedIds: uniqueIds },
      });
      return updated;
    },
    // Pin to top of the Activity Center list. Sort: pinned tasks
    // first (priorityRank=1), then default (0), then deprioritized
    // (-1). Within a tier we fall back to the severity-based sort.
    moveToFront(id: string, actorId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return null;
      const minPosition = db
        .list("tasks")
        .filter((t) => t.tenantId === row.tenantId && t.queuePosition != null)
        .reduce((min, t) => Math.min(min, t.queuePosition ?? min), 0);
      const stamp = nowIso();
      const updated = db.update("tasks", id, {
        priorityRank: 1,
        queuePosition: minPosition - 1,
        queueChangedAt: stamp,
        queueChangedById: actorId,
        priorityChangedAt: stamp,
        priorityChangedById: actorId,
      });
      if (updated) {
        logTaskAudit({
          tenantId: updated.tenantId,
          actorId,
          action: "task.moved_to_front",
          taskId: id,
        });
      }
      return updated;
    },
    moveToBack(id: string, actorId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return null;
      const maxPosition = db
        .list("tasks")
        .filter((t) => t.tenantId === row.tenantId && t.queuePosition != null)
        .reduce((max, t) => Math.max(max, t.queuePosition ?? max), 0);
      const stamp = nowIso();
      const updated = db.update("tasks", id, {
        priorityRank: -1,
        queuePosition: maxPosition + 1,
        queueChangedAt: stamp,
        queueChangedById: actorId,
        priorityChangedAt: stamp,
        priorityChangedById: actorId,
      });
      if (updated) {
        logTaskAudit({
          tenantId: updated.tenantId,
          actorId,
          action: "task.moved_to_back",
          taskId: id,
        });
      }
      return updated;
    },
    clearPriority(id: string, actorId?: string): Task | null {
      const stamp = nowIso();
      const updated = db.update("tasks", id, {
        priorityRank: 0,
        queuePosition: undefined,
        queueChangedAt: stamp,
        queueChangedById: actorId,
        priorityChangedAt: stamp,
        priorityChangedById: actorId,
      });
      if (updated) {
        logTaskAudit({
          tenantId: updated.tenantId,
          actorId,
          action: "task.priority_cleared",
          taskId: id,
        });
      }
      return updated;
    },
  },

  // ------------ Personal reminders ------------
  // Per-user reminders against Activity Center tasks. Unlike snooze,
  // setting a reminder does NOT hide the task from anyone's queue —
  // the task stays open and visible to everyone. The reminder is
  // private to the user who set it and surfaces on their dashboard
  // when remindAt is in the past (or, in this demo, always — see
  // listForUser).
  reminders: {
    create(input: {
      tenantId: string;
      userId: string;
      remindAt: string;
      // Either taskId (anchors the reminder to an Activity Center
      // card) OR title (a freeform general reminder). Passing both
      // is fine — the title is used as a custom label even when
      // the reminder is task-anchored.
      taskId?: string;
      calendarEventId?: string;
      title?: string;
      note?: string;
      importance?: TaskSeverity;
      scope?: Reminder["scope"];
      // Optional recurrence. When set, dismiss() auto-schedules the
      // next occurrence (capped by endsAt).
      recurrence?: import("@/types").ReminderRecurrence;
      recurrenceSourceId?: string;
    }): Reminder {
      const row: Reminder = {
        id: uid("rem"),
        tenantId: input.tenantId,
        userId: input.userId,
        scope: input.scope ?? "personal",
        taskId: input.taskId,
        calendarEventId: input.calendarEventId,
        title: input.title,
        remindAt: input.remindAt,
        note: input.note,
        importance: input.importance ?? "info",
        recurrence: input.recurrence,
        recurrenceSourceId: input.recurrenceSourceId,
        createdAt: nowIso(),
      };
      db.insert("reminders", row);
      return row;
    },
    setImportance(id: string, importance: TaskSeverity): Reminder | null {
      return db.update("reminders", id, { importance });
    },
    // Fan out one reminder per recipient. Used by managers to push a
    // "company reminder" to a chosen subset of agents / managers in
    // one shot. Each row is independent — recipients dismiss / snooze
    // their own copy without affecting the rest.
    createBatch(input: {
      tenantId: string;
      userIds: string[];
      remindAt: string;
      title?: string;
      note?: string;
      importance?: TaskSeverity;
      recurrence?: import("@/types").ReminderRecurrence;
    }): Reminder[] {
      return Array.from(new Set(input.userIds)).map((uid) =>
        this.create({
          tenantId: input.tenantId,
          userId: uid,
          remindAt: input.remindAt,
          title: input.title,
          note: input.note,
          importance: input.importance,
          scope: "company",
          recurrence: input.recurrence,
        })
      );
    },
    // All non-dismissed reminders for a user in a tenant, sorted by
    // remindAt ascending (soonest first).
    listForUser(tenantId: string, userId: string): Reminder[] {
      return db
        .list("reminders")
        .filter((r) => r.tenantId === tenantId && r.userId === userId && !r.dismissedAt)
        .sort((a, b) => (a.remindAt < b.remindAt ? -1 : 1));
    },
    // Dismissed reminders for a user — surfaces in the dashboard
    // "Past reminders" section so the agent can audit / undo.
    // Newest dismissal first.
    listDismissedForUser(tenantId: string, userId: string): Reminder[] {
      return db
        .list("reminders")
        .filter((r) => r.tenantId === tenantId && r.userId === userId && !!r.dismissedAt)
        .sort((a, b) =>
          (a.dismissedAt ?? "") < (b.dismissedAt ?? "") ? 1 : -1
        );
    },
    // Pending reminders against a specific task for a specific user.
    // Used by the Activity Center to show a "Reminder set for …" chip
    // and let the user see / change their own reminder.
    listForTask(taskId: string, userId: string): Reminder[] {
      return db
        .list("reminders")
        .filter((r) => r.taskId === taskId && r.userId === userId && !r.dismissedAt)
        .sort((a, b) => (a.remindAt < b.remindAt ? -1 : 1));
    },
    listForCalendarEvent(calendarEventId: string, userId: string): Reminder[] {
      return db
        .list("reminders")
        .filter((r) => r.calendarEventId === calendarEventId && r.userId === userId && !r.dismissedAt)
        .sort((a, b) => (a.remindAt < b.remindAt ? -1 : 1));
    },
    // Soft dismiss — keeps the audit trail but drops from the
    // dashboard list. If the reminder carries a recurrence config,
    // dismissing also schedules the next occurrence on the same
    // user. The follow-up row inherits the title / note / importance
    // / recurrence so the series keeps rolling until endsAt passes.
    dismiss(id: string): Reminder | null {
      const updated = db.update("reminders", id, { dismissedAt: nowIso() });
      if (!updated || !updated.recurrence) return updated;
      const next = nextOccurrenceIso(updated.remindAt, updated.recurrence);
      if (!next) return updated;
      this.create({
        tenantId: updated.tenantId,
        userId: updated.userId,
        taskId: updated.taskId,
        calendarEventId: updated.calendarEventId,
        remindAt: next,
        title: updated.title,
        note: updated.note,
        importance: updated.importance,
        scope: updated.scope,
        recurrence: updated.recurrence,
        recurrenceSourceId: updated.recurrenceSourceId ?? updated.id,
      });
      return updated;
    },
    // Bring a dismissed reminder back to the active list.
    restore(id: string): Reminder | null {
      return db.update("reminders", id, { dismissedAt: undefined });
    },
    remove(id: string) {
      return db.remove("reminders", id);
    },
  },

  // ------------ Personal calendar events ------------
  calendarEvents: {
    listForUser(tenantId: string, userId: string): CalendarEvent[] {
      return db
        .list("calendarEvents")
        .filter(
          (event) =>
            event.tenantId === tenantId &&
            (event.userId === userId ||
              event.attendeeStatuses?.some(
                (attendee) => attendee.userId === userId && attendee.status === "accepted"
              ))
        )
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    },
    listPendingRequestsForUser(tenantId: string, userId: string): CalendarEvent[] {
      return db
        .list("calendarEvents")
        .filter(
          (event) =>
            event.tenantId === tenantId &&
            event.kind === "meeting" &&
            event.attendeeStatuses?.some(
              (attendee) => attendee.userId === userId && attendee.status === "pending"
            )
        )
        .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
    },
    pendingRequestCount(tenantId: string, userId: string): number {
      return this.listPendingRequestsForUser(tenantId, userId).length;
    },
    get(id: string): CalendarEvent | undefined {
      return db.list("calendarEvents").find((event) => event.id === id);
    },
    create(input: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt">): CalendarEvent {
      const now = nowIso();
      const row: CalendarEvent = {
        ...input,
        id: uid("cal"),
        createdAt: now,
        updatedAt: now,
      };
      db.insert("calendarEvents", row);
      return row;
    },
    requestMeeting(input: Omit<CalendarEvent, "id" | "createdAt" | "updatedAt" | "kind" | "attendeeStatuses"> & {
      attendeeIds: string[];
    }): CalendarEvent {
      const attendeeIds = Array.from(new Set(input.attendeeIds)).filter((id) => id !== input.userId);
      return this.create({
        tenantId: input.tenantId,
        userId: input.userId,
        kind: "meeting",
        organizerId: input.organizerId ?? input.userId,
        attendeeStatuses: attendeeIds.map((userId) => ({
          userId,
          status: "pending",
        })),
        title: input.title,
        description: input.description,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        importance: input.importance,
        location: input.location,
      });
    },
    respondToMeeting(id: string, userId: string, status: "accepted" | "declined"): CalendarEvent | null {
      const event = this.get(id);
      if (!event || event.kind !== "meeting") return null;
      const attendeeStatuses = event.attendeeStatuses ?? [];
      if (!attendeeStatuses.some((attendee) => attendee.userId === userId)) return null;
      return db.update("calendarEvents", id, {
        attendeeStatuses: attendeeStatuses.map((attendee) =>
          attendee.userId === userId
            ? { ...attendee, status, respondedAt: nowIso() }
            : attendee
        ),
        updatedAt: nowIso(),
      });
    },
    acceptMeeting(id: string, userId: string): CalendarEvent | null {
      return this.respondToMeeting(id, userId, "accepted");
    },
    declineMeeting(id: string, userId: string): CalendarEvent | null {
      return this.respondToMeeting(id, userId, "declined");
    },
    update(id: string, patch: Partial<Omit<CalendarEvent, "id" | "tenantId" | "userId" | "createdAt">>): CalendarEvent | null {
      return db.update("calendarEvents", id, { ...patch, updatedAt: nowIso() });
    },
    remove(id: string) {
      return db.remove("calendarEvents", id);
    },
  },

  // ------------ Internal staff messaging ------------
  // Lives separately from Communications (client ↔ agency) and
  // MarketingMessages (AI-personalized outbound). Threads can be
  // 1:1 or group; participantIds is the canonical thread key
  // (sorted on insert) so opening the same DM twice doesn't fork.
  internalMessages: {
    listThreadsForUser(tenantId: string, userId: string): InternalThread[] {
      return db
        .list("internalThreads")
        .filter(
          (t) => t.tenantId === tenantId && t.participantIds.includes(userId)
        )
        .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
    },
    listMessages(threadId: string): InternalMessage[] {
      return db
        .list("internalMessages")
        .filter((m) => m.threadId === threadId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
    // Idempotent thread creator — same participant set always
    // resolves to the same thread row so DMs don't fork.
    openThread(input: {
      tenantId: string;
      participantIds: string[];
      createdById: string;
      topic?: string;
    }): InternalThread {
      const participants = Array.from(new Set(input.participantIds)).sort();
      const existing = db
        .list("internalThreads")
        .find(
          (t) =>
            t.tenantId === input.tenantId &&
            t.participantIds.length === participants.length &&
            t.participantIds.every((p, i) => p === participants[i])
        );
      if (existing) return existing;
      const row: InternalThread = {
        id: uid("thread"),
        tenantId: input.tenantId,
        participantIds: participants,
        topic: input.topic,
        createdById: input.createdById,
        createdAt: nowIso(),
        lastMessageAt: nowIso(),
      };
      db.insert("internalThreads", row);
      return row;
    },
    send(input: {
      threadId: string;
      tenantId: string;
      fromUserId: string;
      body: string;
      urgency?: TaskSeverity;
    }): InternalMessage {
      const row: InternalMessage = {
        id: uid("imsg"),
        tenantId: input.tenantId,
        threadId: input.threadId,
        fromUserId: input.fromUserId,
        body: input.body,
        urgency: input.urgency,
        readBy: [input.fromUserId],
        createdAt: nowIso(),
      };
      db.insert("internalMessages", row);
      db.update("internalThreads", input.threadId, { lastMessageAt: row.createdAt });
      return row;
    },
    // Marks every message in this thread as read by `userId`. Used
    // when the user opens a thread.
    markRead(threadId: string, userId: string) {
      const msgs = db.list("internalMessages").filter((m) => m.threadId === threadId);
      msgs.forEach((m) => {
        if (!m.readBy.includes(userId)) {
          db.update("internalMessages", m.id, { readBy: [...m.readBy, userId] });
        }
      });
    },
    remove(messageId: string): boolean {
      const message = db.list("internalMessages").find((row) => row.id === messageId);
      if (!message || !db.remove("internalMessages", messageId)) return false;
      const remaining = db
        .list("internalMessages")
        .filter((row) => row.threadId === message.threadId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      if (remaining[0]) {
        db.update("internalThreads", message.threadId, { lastMessageAt: remaining[0].createdAt });
      } else {
        db.remove("internalThreads", message.threadId);
      }
      return true;
    },
    // Permanently delete a DM / group thread + all its messages, and
    // clean up any pins / mutes pointing at it. Destructive — caller
    // confirms first.
    deleteThread(threadId: string) {
      db.list("internalMessages")
        .filter((m) => m.threadId === threadId)
        .forEach((m) => db.remove("internalMessages", m.id));
      db.list("messagePins")
        .filter((p) => p.kind === "internal" && p.refId === threadId)
        .forEach((p) => db.remove("messagePins", p.id));
      db.list("messageMutes")
        .filter((m) => m.kind === "internal" && m.refId === threadId)
        .forEach((m) => db.remove("messageMutes", m.id));
      db.remove("internalThreads", threadId);
    },
    // Total unread internal messages across every thread the user
    // participates in. Drives the dashboard / sidebar badge.
    unreadCountForUser(tenantId: string, userId: string): number {
      // Muted threads are silenced for this user — they don't pump the
      // unread badge.
      const muted = new Set(
        db
          .list("messageMutes")
          .filter(
            (m) =>
              m.tenantId === tenantId && m.userId === userId && m.kind === "internal"
          )
          .map((m) => m.refId)
      );
      const threadIds = new Set(
        db
          .list("internalThreads")
          .filter(
            (t) =>
              t.tenantId === tenantId &&
              t.participantIds.includes(userId) &&
              !muted.has(t.id)
          )
          .map((t) => t.id)
      );
      return db
        .list("internalMessages")
        .filter(
          (m) =>
            threadIds.has(m.threadId) &&
            m.fromUserId !== userId &&
            !m.readBy.includes(userId)
        ).length;
    },
    // Pending threads with unread messages for the user. Used by
    // the dashboard notification card to list "you have unread
    // messages from N teammates."
    unreadThreadsForUser(
      tenantId: string,
      userId: string
    ): { thread: InternalThread; latest: InternalMessage }[] {
      const threads = this.listThreadsForUser(tenantId, userId);
      const out: { thread: InternalThread; latest: InternalMessage }[] = [];
      for (const t of threads) {
        if (api.messageMutes.isMuted(tenantId, userId, "internal", t.id)) continue;
        const msgs = this.listMessages(t.id);
        const unread = msgs.filter(
          (m) => m.fromUserId !== userId && !m.readBy.includes(userId)
        );
        if (unread.length === 0) continue;
        out.push({ thread: t, latest: unread[unread.length - 1] });
      }
      return out;
    },
  },

  // ------------ AI quoting workspace ------------
  // Drives the per-prospect quoting card. Walks through 4 phases:
  //   gathering_info → awaiting_reply → quoting → complete
  // Each phase mutates the QuotingSession row and reflects in the UI.
  quoting: {
    get(id: string): QuotingSession | undefined {
      const session = db.list("quotingSessions").find((s) => s.id === id);
      return session ? ensureQuotingSessionConsistency(session) : undefined;
    },
    listByTenant(tenantId: string): QuotingSession[] {
      return tenantFilter(db.list("quotingSessions"), tenantId)
        .map(ensureQuotingSessionConsistency)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    },
    reconcileActivities(tenantId: string, actorId = "ai"): number {
      return newestOpenQuotingSessionsPerContact(
        tenantFilter(db.list("quotingSessions"), tenantId)
          .filter((session) => !isDocumentOnlyAcordSession(session))
          .map(ensureQuotingSessionConsistency)
      ).reduce(
        (changed, session) =>
          changed + syncQuoteActivityStatus(session, { actorId }),
        0
      );
    },
    getForProspect(prospectId: string): QuotingSession | undefined {
      const session = db
        .list("quotingSessions")
        .filter((s) => s.prospectId === prospectId)
        .sort(sortQuotingSessionsByWorkRecency)[0];
      return session ? ensureQuotingSessionConsistency(session) : undefined;
    },
    getForCustomer(customerId: string): QuotingSession | undefined {
      const session = db
        .list("quotingSessions")
        .filter((s) => s.customerId === customerId && !isDocumentOnlyAcordSession(s))
        .sort(sortQuotingSessionsByWorkRecency)[0];
      return session ? ensureQuotingSessionConsistency(session) : undefined;
    },
    diagnosePersonalLinesCarrierApis(input: {
      tenantId: string;
      assetType: AssetType;
      state?: string;
    }): PersonalLinesCarrierApiDiagnostic {
      const rows = linkedActiveCarriers(input.tenantId).map((carrier) =>
        diagnosePersonalCarrierApiRow(carrier, input)
      );
      return {
        tenantId: input.tenantId,
        assetType: input.assetType,
        state: input.state,
        linkedActiveCarrierCount: rows.length,
        liveReadyCount: rows.filter((row) => row.liveReady).length,
        simulatedCount: rows.filter((row) => row.quoteApiStatus === "simulated").length,
        missingApiCount: rows.filter((row) => row.quoteApiStatus === "no_api").length,
        errorCount: rows.filter((row) => row.configuredStatus === "error").length,
        blockedCount: rows.filter((row) => row.blockingReasons.length > 0).length,
        rows,
      };
    },
    upsertCustomerIntakeSession(input: {
      tenantId: string;
      customerId: string;
      quoteRequestId: string;
      assetType: AssetType;
      lineOfBusiness?: QuotingLineOfBusiness;
      categoryId?: string;
      categoryLabel?: string;
      contactName: string;
      address?: string;
      estimatedValue?: number;
      assetDetails?: Record<string, string>;
      publicFieldEvidence?: PublicDataEvidenceMap;
      questionnaireAnswers?: Record<string, string>;
      assignedAgentId?: string;
      createdById: string;
      status?: PolicyStatus;
    }): QuotingSession {
      const now = nowIso();
      const category = input.categoryId ? api.categories.get(input.categoryId) : undefined;
      const categoryQuestions = category ? categoryQuotingQuestions(category) : [];
      const questions = categoryQuestions;
      const categoryQuestionIds = new Set(questions.map((question) => question.id));
      const answers = input.questionnaireAnswers ?? {};
      const nextResponses = Object.fromEntries(
        questions
          .map((question) => {
            const sourceKey = question.acordFieldKey ?? question.id.replace(`category-${input.categoryId}-`, "");
            const value = String(answers[sourceKey] ?? "").trim();
            if (value && !questionnaireAnswerLooksCompatible(question, value)) return null;
            return value ? [question.id, value] : null;
          })
          .filter((entry): entry is [string, string] => !!entry)
      );
      const nextMeta = Object.fromEntries(
        Object.keys(nextResponses).map((questionId) => [
          questionId,
          {
            updatedAt: now,
            updatedById: input.customerId,
            updatedByName: input.contactName || "Customer",
            updatedByRole: "customer" as const,
          },
        ])
      );
      const existing = db
        .list("quotingSessions")
        .find(
          (session) =>
            session.quoteRequestId === input.quoteRequestId ||
            (session.customerId === input.customerId &&
              !isDocumentOnlyAcordSession(session) &&
              isQuotingWorkflowOpen(session))
        );
      const preservedResponses = Object.fromEntries(
        Object.entries(existing?.questionnaireResponses ?? {}).filter(
          ([questionId]) => !categoryQuestionIds.has(questionId)
        )
      );
      const preservedMeta = Object.fromEntries(
        Object.entries(existing?.questionnaireResponseMeta ?? {}).filter(
          ([questionId]) => !categoryQuestionIds.has(questionId)
        )
      );
      const questionnaireResponses = { ...preservedResponses, ...nextResponses };
      const questionnaireResponseMeta = { ...preservedMeta, ...nextMeta };
      const missingFields = questions
        .filter((question) => question.required && !questionnaireResponses[question.id])
        .map((question) => question.label);
      const publicFields: Record<string, unknown> = {
        ...(existing?.publicFields ?? {}),
        ...(input.assetDetails ?? {}),
        contactName: input.contactName,
        categoryId: input.categoryId,
        categoryLabel: input.categoryLabel,
        lineOfBusiness: input.lineOfBusiness,
        assetIdentifier: input.address,
        address: input.address,
      };
      const publicFieldEvidence: PublicDataEvidenceMap = {
        ...(existing?.publicFieldEvidence ?? {}),
        ...(input.publicFieldEvidence ?? {}),
      };
      Object.entries(input.assetDetails ?? {}).forEach(([fieldKey, value]) => {
        if (!value || publicFieldEvidence[fieldKey]) return;
        publicFieldEvidence[fieldKey] = {
          fieldKey,
          sourceKind: "client_intake",
          sourceLabel: "Client quote intake",
          confidence: 0.88,
          verified: true,
          allowDocumentAutofill: true,
          collectedAt: now,
          notes: "Submitted through the customer quote flow.",
        };
      });
      const patch: Partial<QuotingSession> = {
        quoteRequestId: input.quoteRequestId,
        categoryId: input.categoryId,
        categoryLabel: input.categoryLabel,
        customerId: input.customerId,
        assetType: input.assetType,
        estimatedValue: input.estimatedValue ?? existing?.estimatedValue ?? 0,
        assetDetails: input.assetDetails ?? existing?.assetDetails,
        lineOfBusiness: input.lineOfBusiness,
        publicFields,
        publicFieldEvidence,
        missingFields,
        questionnaireQuestions: questions,
        questionnaireResponses,
        questionnaireResponseMeta,
        status: "gathering_info",
        updatedAt: now,
      };

      let session: QuotingSession;
      if (existing) {
        session = db.update("quotingSessions", existing.id, patch) ?? existing;
      } else {
        session = {
          id: uid("quote_session"),
          tenantId: input.tenantId,
          quoteRequestId: input.quoteRequestId,
          categoryId: input.categoryId,
          categoryLabel: input.categoryLabel,
          customerId: input.customerId,
          assetType: input.assetType,
          estimatedValue: input.estimatedValue ?? 0,
          assetDetails: input.assetDetails,
          lineOfBusiness: input.lineOfBusiness,
          createdById: input.createdById,
          status: "gathering_info",
          publicFields,
          publicFieldEvidence,
          missingFields,
          questionnaireQuestions: questions,
          questionnaireResponses,
          questionnaireResponseMeta,
          quotes: [],
          aiSummary: `${input.contactName} started a ${input.categoryLabel ?? assetTypeDisplayName(input.assetType)} quote from the client portal.`,
          createdAt: now,
          updatedAt: now,
        };
        db.insert("quotingSessions", session);
        const body = [
          `Customer started quote flow: ${input.categoryLabel ?? assetTypeDisplayName(input.assetType)}.`,
          input.status === "submitted_to_agent" ? "Status: submitted to agent." : "Status: started in client portal.",
          input.address ? `Search key: ${input.address}.` : "",
          `${questions.length} tailored intake question${questions.length === 1 ? "" : "s"} loaded into the agent quoting workspace.`,
        ]
          .filter(Boolean)
          .join(" ");
        db.insert("notes", {
          id: uid("note"),
          tenantId: input.tenantId,
          authorId: "ai",
          customerId: input.customerId,
          body,
          visibility: "internal",
          createdAt: now,
        });
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: input.tenantId,
          source: "ai",
          message: `Note by QuoteX AI: ${body}`,
          visibility: "internal",
          customerId: input.customerId,
          createdAt: now,
          createdById: "ai",
        });
      }

      db.update("quoteRequests", input.quoteRequestId, { quoteSessionId: session.id });
      const quoteRequest = db.list("quoteRequests").find((quote) => quote.id === input.quoteRequestId);
      if (quoteRequest?.recoveryTaskId) {
        db.update("tasks", quoteRequest.recoveryTaskId, {
          quoteRequestId: input.quoteRequestId,
          quoteSessionId: session.id,
        });
      }
      syncQuoteActivityStatus(session, {
        taskIds: quoteRequest?.recoveryTaskId ? [quoteRequest.recoveryTaskId] : undefined,
        actorId: input.createdById,
      });
      return session;
    },
    // Phase 1: AI pulls public records + identifies missing fields.
    async startSession(input: {
      tenantId: string;
      prospectId?: string;
      customerId?: string;
      assetId?: string;
      assets?: Array<{
        assetId?: string;
        label: string;
        assetType: AssetType;
        categoryId?: string;
        categoryLabel?: string;
        address?: string;
        estimatedValue?: number;
        assetDetails?: Record<string, string>;
      }>;
      createdById: string;
      assetType: AssetType;
      contactName: string;
      address?: string;
      estimatedValue?: number;
      assetDetails?: Record<string, string>;
      categoryId?: string;
      categoryLabel?: string;
      categoryIds?: string[];
      categoryLabels?: string[];
      lineOfBusiness?: QuotingLineOfBusiness;
      selectedAcordTemplateIds?: string[];
      activityTaskIds?: string[];
      activityActorId?: string;
    }): Promise<QuotingSession> {
      const startKey = quotingSessionStartKey(input);
      const existingOpenSession = startKey
        ? db
            .list("quotingSessions")
            .filter(
              (session) =>
                session.tenantId === input.tenantId &&
                !isDocumentOnlyAcordSession(session) &&
                (input.customerId
                  ? session.customerId === input.customerId
                  : session.prospectId === input.prospectId) &&
                isQuotingWorkflowOpen(session)
            )
            .sort(sortQuotingSessionsByWorkRecency)[0]
        : undefined;
      if (existingOpenSession) {
        let consistentSession = ensureQuotingSessionConsistency(existingOpenSession);
        if (consistentSession.lineOfBusiness !== "commercial") {
          const canonicalSession = ensureCompletePersonalCategoryQuestionnaire(consistentSession);
          if (canonicalSession !== consistentSession) {
            consistentSession =
              db.update("quotingSessions", consistentSession.id, {
                questionnaireQuestions: canonicalSession.questionnaireQuestions,
                questionnaireResponses: canonicalSession.questionnaireResponses,
                questionnaireResponseMeta: canonicalSession.questionnaireResponseMeta,
                missingFields: canonicalSession.missingFields,
                updatedAt: nowIso(),
              }) ?? canonicalSession;
          }
          consistentSession = await applyServerQuestionnaireMappingToSession(
            consistentSession,
            consistentSession.questionnaireQuestions ?? [],
            consistentSession.questionnaireResponses ?? {}
          );
        }
        syncQuoteActivityStatus(consistentSession, {
          taskIds: input.activityTaskIds,
          actorId: input.activityActorId ?? input.createdById,
        });
        return consistentSession;
      }

      const inFlightStart = startKey ? quotingSessionStartsInFlight.get(startKey) : undefined;
      if (inFlightStart) return inFlightStart;

      const startPromise = (async () => {
      const {
        aiPreparePublicFields,
        aiInferLineOfBusiness,
      } = await import("./ai");
      const requestedAssets =
        input.assets && input.assets.length > 0
          ? input.assets
          : [
              {
                assetId: input.assetId,
                label: sharedAssetTypeDisplayName(input.assetType),
                assetType: input.assetType,
                categoryId: input.categoryId,
                categoryLabel: input.categoryLabel,
                address: input.address,
                estimatedValue: input.estimatedValue,
                assetDetails: input.assetDetails,
              },
            ];
      const duplicateAssetLabels = new Map<string, number>();
      requestedAssets.forEach((asset) => {
        const label = asset.label.trim() || sharedAssetTypeDisplayName(asset.assetType);
        duplicateAssetLabels.set(label, (duplicateAssetLabels.get(label) ?? 0) + 1);
      });
      const selectedAssetMappings: QuotingSessionAssetMapping[] = [];
      for (const [index, asset] of requestedAssets.entries()) {
        const baseLabel = asset.label.trim() || sharedAssetTypeDisplayName(asset.assetType);
        const label =
          (duplicateAssetLabels.get(baseLabel) ?? 0) > 1
            ? `${baseLabel} (${index + 1})`
            : baseLabel;
        const prep = await aiPreparePublicFields({
          assetType: asset.assetType,
          prospectName: input.contactName,
          address: asset.address,
          estimatedValue: asset.estimatedValue,
          assetDetails: asset.assetDetails,
          rngSeed: `${input.prospectId ?? input.customerId ?? ""}-${asset.assetType}-${asset.assetId ?? index}`,
        });
        selectedAssetMappings.push({
          assetId: asset.assetId,
          label,
          assetType: asset.assetType,
          categoryId:
            asset.categoryId ?? (asset.assetType === input.assetType ? input.categoryId : undefined),
          categoryLabel:
            asset.categoryLabel ??
            (asset.assetType === input.assetType ? input.categoryLabel : undefined),
          address: asset.address,
          estimatedValue: asset.estimatedValue ?? 0,
          assetDetails: asset.assetDetails,
          publicFields: prep.publicFields,
          publicFieldEvidence: prep.publicFieldEvidence,
          missingFields: prep.missingFields,
          aiSummary: prep.summary,
        });
      }
      const primaryAsset = selectedAssetMappings[0];
      const hasMultipleAssets = selectedAssetMappings.length > 1;
      const publicFields: Record<string, unknown> = {};
      const publicFieldEvidence: PublicDataEvidenceMap = {};
      const aggregateMissingFields: string[] = [];
      selectedAssetMappings.forEach((asset, index) => {
        if (index === 0) {
          Object.assign(publicFields, asset.publicFields);
          Object.assign(publicFieldEvidence, asset.publicFieldEvidence ?? {});
        }
        Object.entries(asset.publicFields).forEach(([field, value]) => {
          if (!hasMultipleAssets) return;
          const scopedField = `${asset.label} - ${field}`;
          publicFields[scopedField] = value;
          const evidence = asset.publicFieldEvidence?.[field];
          if (evidence) publicFieldEvidence[scopedField] = { ...evidence, fieldKey: scopedField };
        });
        asset.missingFields.forEach((field) => {
          aggregateMissingFields.push(hasMultipleAssets ? `${asset.label}: ${field}` : field);
        });
      });
      const lineOfBusiness =
        input.lineOfBusiness ??
        aiInferLineOfBusiness({
          contactName: input.contactName,
          assetType: input.assetType,
          estimatedValue: input.estimatedValue,
        });
      const state = selectedAssetMappings
        .map((asset) =>
          asset.address
            ? extractStateFromString(asset.address)
            : asset.assetDetails
            ? extractStateFromString(Object.values(asset.assetDetails).join(" "))
            : undefined
        )
        .find(Boolean);
      const sessionId = uid("quote_session");
      const createdAt = nowIso();
      // Personal sessions generate client questions immediately.
      // Commercial sessions first initialize the ACORD packet and
      // wait for the next workflow step, so the questionnaire can be
      // generated from the latest AI fill audit / remaining blanks.
      let questionnaireQuestions: QuotingQuestion[] | undefined;
      let questionnaireResponses: Record<string, string> | undefined;
      let questionnaireResponseMeta: Record<string, QuestionnaireResponseMeta> | undefined;
      let missingFields = aggregateMissingFields;
      const selectedCategories = (input.categoryIds ?? [])
        .map((categoryId) => api.categories.get(categoryId))
        .filter((category): category is InsuranceCategory => !!category);
      if (lineOfBusiness === "personal") {
        selectedAssetMappings.forEach((asset) => {
          const resolvedCategory =
            selectedCategories.find((option) => option.assetType === asset.assetType) ??
            personalQuestionnaireCategoryForAsset({
              tenantId: input.tenantId,
              assetType: asset.assetType,
              categoryId: asset.categoryId,
              categoryLabel: asset.categoryLabel,
            });
          if (!resolvedCategory) return;
          asset.categoryId = resolvedCategory.id;
          asset.categoryLabel = resolvedCategory.label;
        });
      }
      const category =
        (input.categoryId ? api.categories.get(input.categoryId) : selectedCategories[0]) ??
        (lineOfBusiness === "personal"
          ? personalQuestionnaireCategoryForAsset({
              tenantId: input.tenantId,
              assetType: primaryAsset.assetType,
              categoryId: primaryAsset.categoryId,
              categoryLabel: primaryAsset.categoryLabel,
            })
          : undefined);
      const resolvedCategoryIds = Array.from(
        new Set(
          [
            ...(input.categoryIds ?? []),
            input.categoryId,
            ...selectedAssetMappings.map((asset) => asset.categoryId),
          ].filter((value): value is string => Boolean(value))
        )
      );
      const resolvedCategoryLabels = Array.from(
        new Set(
          [
            ...(input.categoryLabels ?? []),
            input.categoryLabel,
            ...selectedAssetMappings.map((asset) => asset.categoryLabel),
          ].filter((value): value is string => Boolean(value))
        )
      );
      const primaryAssetDetails = primaryAsset.assetDetails ?? {};
      const seededAssetDetails: Record<string, string> = {
        ...(lineOfBusiness === "personal" ? personalCategoryAnswerHints(category) : {}),
        ...primaryAssetDetails,
      };
      if (hasMultipleAssets) {
        selectedAssetMappings.forEach((asset) => {
          Object.entries(asset.assetDetails ?? {}).forEach(([field, value]) => {
            if (value.trim()) seededAssetDetails[`${asset.label} - ${field}`] = value;
          });
        });
      }
      const commercialAcordTemplates =
        lineOfBusiness === "commercial"
          ? selectedCommercialAcordTemplates(
              input.tenantId,
              input.selectedAcordTemplateIds ?? [],
              publicFields,
              publicFieldEvidence
            )
          : undefined;
      if (lineOfBusiness === "commercial") {
        questionnaireQuestions = [];
      } else {
        const combinedQuestions: QuotingQuestion[] = [];
        const combinedResponses: Record<string, string> = {};
        const combinedResponseMeta: Record<string, QuestionnaireResponseMeta> = {};
        const combinedMissingFields: string[] = [];
        selectedAssetMappings.forEach((asset, assetIndex) => {
          const assetCategory = asset.categoryId
            ? api.categories.get(asset.categoryId)
            : selectedCategories.find((option) => option.assetType === asset.assetType) ??
              personalQuestionnaireCategoryForAsset({
                tenantId: input.tenantId,
                assetType: asset.assetType,
                categoryLabel: asset.categoryLabel,
              }) ??
              category;
          const assetQuestions = completePersonalQuestionnaireQuestions({
            assetType: asset.assetType,
            categories: assetCategory ? [assetCategory] : undefined,
            publicFields: asset.publicFields,
            missingFields: asset.missingFields,
          });
          const assetDetailsForQuestions = {
            ...personalCategoryAnswerHints(assetCategory),
            ...(asset.assetDetails ?? {}),
          };
          const seeded = seedKnownQuestionnaireResponses({
            questions: assetQuestions,
            contactName: input.contactName,
            contactEmail: undefined,
            contactPhone: undefined,
            businessName: undefined,
            address: asset.address,
            estimatedValue: asset.estimatedValue,
            assetDetails: assetDetailsForQuestions,
            publicFields: asset.publicFields,
            publicFieldEvidence: asset.publicFieldEvidence,
            updatedAt: createdAt,
          });
          assetQuestions.forEach((question) => {
            const scopedId = hasMultipleAssets
              ? `${question.id}__asset_${asset.assetId ?? assetIndex}`
              : question.id;
            combinedQuestions.push(
              hasMultipleAssets
                ? {
                    ...question,
                    id: scopedId,
                    section: `${asset.label} - ${question.section}`,
                    label: `${asset.label}: ${question.label}`,
                  }
                : question
            );
            const answer = seeded.questionnaireResponses?.[question.id];
            if (answer) combinedResponses[scopedId] = answer;
            const meta = seeded.questionnaireResponseMeta?.[question.id];
            if (meta) combinedResponseMeta[scopedId] = meta;
          });
          seeded.missingFields.forEach((field) => {
            combinedMissingFields.push(hasMultipleAssets ? `${asset.label}: ${field}` : field);
          });
        });
        questionnaireQuestions = combinedQuestions;
        questionnaireResponses = Object.keys(combinedResponses).length > 0 ? combinedResponses : undefined;
        questionnaireResponseMeta = Object.keys(combinedResponseMeta).length > 0 ? combinedResponseMeta : undefined;
        missingFields = combinedMissingFields;
      }
      const needsClient = (questionnaireQuestions?.length ?? 0) > 0;
      const row: QuotingSession = {
        id: sessionId,
        tenantId: input.tenantId,
        categoryId: input.categoryId ?? primaryAsset.categoryId,
        categoryLabel: input.categoryLabel ?? primaryAsset.categoryLabel,
        categoryIds: resolvedCategoryIds.length > 0 ? resolvedCategoryIds : undefined,
        categoryLabels: resolvedCategoryLabels.length > 0 ? resolvedCategoryLabels : undefined,
        prospectId: input.prospectId,
        customerId: input.customerId,
        assetId: primaryAsset.assetId,
        selectedAssetMappings,
        assetType: primaryAsset.assetType,
        estimatedValue:
          selectedAssetMappings.reduce((sum, asset) => sum + asset.estimatedValue, 0) ||
          primaryAsset.estimatedValue,
        assetDetails: seededAssetDetails,
        state,
        lineOfBusiness,
        commercialAcordTemplates,
        createdById: input.createdById,
        status: lineOfBusiness === "commercial" || needsClient ? "gathering_info" : "quoting",
        publicFields,
        publicFieldEvidence,
        missingFields,
        questionnaireQuestions,
        questionnaireResponses,
        questionnaireResponseMeta,
        quotes: [],
        aiSummary:
          selectedAssetMappings.length === 1
            ? primaryAsset.aiSummary
            : `AI mapping completed for all ${selectedAssetMappings.length} selected assets. ${selectedAssetMappings
                .map((asset) => `${asset.label}: ${asset.aiSummary}`)
                .join(" ")}`,
        createdAt,
        updatedAt: createdAt,
      };
      db.insert("quotingSessions", row);
      const mappedRow =
        lineOfBusiness === "commercial"
          ? row
          : await applyServerQuestionnaireMappingToSession(
              row,
              row.questionnaireQuestions ?? [],
              row.questionnaireResponses ?? {}
            );
      const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(mappedRow, {}, "application");
      const activeRow = syncedAcordTemplates
        ? db.update("quotingSessions", mappedRow.id, {
            commercialAcordTemplates: syncedAcordTemplates,
          }) ?? mappedRow
        : mappedRow;
      syncVehicleAssetIdentityFromSession(activeRow);
      const mappedFieldCount =
        activeRow.selectedAssetMappings?.reduce(
          (sum, asset) => sum + Object.keys(asset.publicFields).length,
          0
        ) ?? Object.keys(activeRow.publicFields).length;
      logQuotingWorkflowProgress(activeRow, {
        message: `AI quoting workflow started for ${activeRow.lineOfBusiness === "commercial" ? "commercial" : "personal"} ${assetTypeDisplayName(activeRow.assetType)}.`,
        detail: [
          `Public-record enrichment completed for ${activeRow.selectedAssetMappings?.length ?? 1} selected asset${
            (activeRow.selectedAssetMappings?.length ?? 1) === 1 ? "" : "s"
          }, with ${mappedFieldCount} field${mappedFieldCount === 1 ? "" : "s"} prepared.`,
          activeRow.missingFields.length > 0
            ? `Missing fields queued for questionnaire: ${activeRow.missingFields.join(", ")}.`
            : "No missing client fields were found; carrier ranking can begin immediately.",
          syncedAcordTemplates && syncedAcordTemplates.length > 0
            ? `${syncedAcordTemplates.length} selected ACORD PDF${
                syncedAcordTemplates.length === 1 ? "" : "s"
              } initialized as filled application document${
                syncedAcordTemplates.length === 1 ? "" : "s"
              } from currently available data.`
            : "",
        ].filter(Boolean).join(" "),
        createdAt: activeRow.createdAt,
        createdById: input.createdById,
      });
      // No missing fields + not commercial → run quotes immediately.
      syncQuoteActivityStatus(activeRow, {
        taskIds: input.activityTaskIds,
        actorId: input.activityActorId ?? input.createdById,
      });
      if (activeRow.status === "quoting" && !aiProviderErrorBlocksWorkflow(activeRow)) {
        return this.runQuotes(activeRow.id);
      }
      return activeRow;
      })();

      if (startKey) quotingSessionStartsInFlight.set(startKey, startPromise);
      try {
        return await startPromise;
      } finally {
        if (startKey && quotingSessionStartsInFlight.get(startKey) === startPromise) {
          quotingSessionStartsInFlight.delete(startKey);
        }
      }
    },
    async runAcordAiMapping(sessionId: string): Promise<QuotingSession | null> {
      const session = this.get(sessionId);
      if (!session) return null;
      if (session.lineOfBusiness !== "commercial") {
        const mapped = await applyServerQuestionnaireMappingToSession(
          session,
          session.questionnaireQuestions ?? [],
          session.questionnaireResponses ?? {}
        );
        syncVehicleAssetIdentityFromSession(mapped);
        return mapped;
      }
      const mapped = await applyServerAcordMappingToCommercialSession(
        session,
        session.questionnaireResponses ?? {}
      );
      const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(
        mapped,
        mapped.questionnaireResponses ?? {},
        "application"
      );
      syncVehicleAssetIdentityFromSession(mapped);
      return syncedAcordTemplates
        ? db.update("quotingSessions", mapped.id, {
            commercialAcordTemplates: syncedAcordTemplates,
            updatedAt: nowIso(),
          }) ?? mapped
        : mapped;
    },
    prepareCommercialQuestionnaire(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session || session.lineOfBusiness !== "commercial") return session ?? null;
      if (aiProviderErrorBlocksWorkflow(session)) return session;

      const preparedAt = nowIso();
      const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(
        session,
        session.questionnaireResponses ?? {},
        "application"
      );
      const sessionWithCurrentAcords: QuotingSession = {
        ...session,
        commercialAcordTemplates: syncedAcordTemplates ?? session.commercialAcordTemplates,
      };
      const initialQuestions = initialCommercialQuestionnaireQuestions(
        sessionWithCurrentAcords
      );
      const contact = contactForQuotingSession(sessionWithCurrentAcords);
      const seeded = mergeSeededQuestionnaireResponses({
        session: sessionWithCurrentAcords,
        questions: initialQuestions,
        contactName: contact?.name,
        contactEmail: contact?.email,
        contactPhone: contact?.phone,
        businessName: contact && "businessName" in contact ? contact.businessName : undefined,
        address: quoteSessionAddressContext(sessionWithCurrentAcords),
        estimatedValue: sessionWithCurrentAcords.estimatedValue,
        assetDetails: sessionWithCurrentAcords.assetDetails,
        publicFields: sessionWithCurrentAcords.publicFields,
        publicFieldEvidence: sessionWithCurrentAcords.publicFieldEvidence,
        updatedAt: preparedAt,
      });
      const questionnaireQuestions = filterCommercialBaseQuestionsAnsweredByTrustedAi(
        initialQuestions,
        seeded.questionnaireResponses,
        seeded.questionnaireResponseMeta
      );
      const missingFields = missingFieldsForQuestionSet(
        questionnaireQuestions,
        seeded.questionnaireResponses
      );
      const updated = db.update("quotingSessions", sessionId, {
        commercialAcordTemplates: sessionWithCurrentAcords.commercialAcordTemplates,
        questionnaireQuestions,
        questionnaireResponses: seeded.questionnaireResponses,
        questionnaireResponseMeta: seeded.questionnaireResponseMeta,
        missingFields,
        commercialQuestionnairePreparedAt: session.commercialQuestionnairePreparedAt ?? preparedAt,
        status: "gathering_info",
        updatedAt: preparedAt,
      });
      if (updated) {
        const templates = updated.commercialAcordTemplates ?? [];
        const missingCount = templates.reduce(
          (sum, template) => sum + (template.missingFieldCount ?? 0),
          0
        );
        logQuotingWorkflowProgress(updated, {
          message: "AI generated the commercial questionnaire from the ACORD fill audit.",
          detail: `${questionnaireQuestions.length} question${
            questionnaireQuestions.length === 1 ? "" : "s"
          } prepared from ${missingCount} remaining ACORD field${
            missingCount === 1 ? "" : "s"
          } and commercial intake requirements.`,
          createdAt: preparedAt,
          createdById: session.createdById,
        });
      }
      return updated;
    },
    preparePersonalQuestionnaire(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session || session.lineOfBusiness === "commercial") return session ?? null;
      if (aiProviderErrorBlocksWorkflow(session)) return session;
      if (session.personalQuestionnairePreparedAt) return session;

      const preparedAt = nowIso();
      const questions = session.questionnaireQuestions ?? [];
      const responses = session.questionnaireResponses ?? {};
      const missingFields = questions
        .filter((question) => question.required && !(responses[question.id] ?? "").trim())
        .map((question) => question.label);
      const updated = db.update("quotingSessions", sessionId, {
        questionnaireQuestions: questions,
        personalQuestionnairePreparedAt: preparedAt,
        missingFields,
        status: "gathering_info",
        updatedAt: preparedAt,
      });
      if (updated) {
        const prefilledCount = questions.filter((question) =>
          (responses[question.id] ?? "").trim()
        ).length;
        logQuotingWorkflowProgress(updated, {
          message: "AI prepared the personal-lines questionnaire from the mapping review.",
          detail: `${questions.length} question${
            questions.length === 1 ? "" : "s"
          } are ready for staff review; ${prefilledCount} already ${
            prefilledCount === 1 ? "has" : "have"
          } a saved value.`,
          createdAt: preparedAt,
          createdById: session.createdById,
        });
        syncQuoteActivityStatus(updated, { actorId: "ai" });
      }
      return updated;
    },
    updateQuestionnaireQuestions(
      sessionId: string,
      questions: QuotingQuestion[],
      actor?: QuestionnaireResponseActor
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;

      const updatedAt = nowIso();
      const normalizedQuestions = questions
        .map((question) => ({
          ...question,
          id: question.id || uid("qq"),
          section: question.section.trim() || "General",
          label: question.label.trim(),
          options:
            question.kind === "select"
              ? (question.options ?? []).map((option) => option.trim()).filter(Boolean)
              : undefined,
          required: !!question.required,
        }))
        .filter((question) => question.label.length > 0);
      const nextQuestionIds = new Set(normalizedQuestions.map((question) => question.id));
      const questionnaireResponses = Object.fromEntries(
        Object.entries(session.questionnaireResponses ?? {}).filter(([questionId]) =>
          nextQuestionIds.has(questionId)
        )
      );
      const questionnaireResponseMeta = Object.fromEntries(
        Object.entries(session.questionnaireResponseMeta ?? {}).filter(([questionId]) =>
          nextQuestionIds.has(questionId)
        )
      );
      const missingFields = normalizedQuestions
        .filter((question) => question.required && !(questionnaireResponses[question.id] ?? "").trim())
        .map((question) => question.label);

      const updated = db.update("quotingSessions", sessionId, {
        questionnaireQuestions: normalizedQuestions,
        questionnaireResponses,
        questionnaireResponseMeta,
        missingFields,
        updatedAt,
      });

      if (updated) {
        const actorLabel = actor?.name?.trim() || "Agent";
        const visibleCount = visibleQuotingQuestions(updated).length;
        logQuotingWorkflowProgress(updated, {
          message: `${actorLabel} updated the quoting questionnaire.`,
          detail: `${visibleCount} active question${
            visibleCount === 1 ? "" : "s"
          } are now in the client questionnaire; removed-question answers were cleared from the quote file.`,
          createdAt: updatedAt,
          createdById: actor?.id ?? updated.createdById,
          source: actor?.role === "customer" ? "customer" : "agent",
        });
      }

      return updated;
    },
    // Questionnaire-link delivery used by both personal + commercial
    // sessions. The email receives an opaque access token rather than the
    // browser-local session id so the questionnaire works on another device.
    sendPortalLink(sessionId: string, portalUrl: string): QuotingSession | null {
      const current = this.get(sessionId);
      const session =
        current?.lineOfBusiness === "commercial" && visibleQuotingQuestions(current).length === 0
          ? this.prepareCommercialQuestionnaire(sessionId) ?? current
          : current;
      if (!session) return null;
      const tenant = db.list("agencies").find((a) => a.id === session.tenantId);
      const agencyName = tenant?.name ?? "your agency";
      const creator = db.list("users").find((u) => u.id === session.createdById);
      const contact = session.customerId
        ? db.list("customers").find((c) => c.id === session.customerId)
        : session.prospectId
        ? db.list("prospects").find((p) => p.id === session.prospectId)
        : null;
      const firstName = (contact?.name ?? "Friend").split(/\s+/)[0];
      const visibleQuestions = visibleQuotingQuestions(session);
      const sectionCount = new Set(visibleQuestions.map((q) => q.section)).size;
      const questionCount = visibleQuestions.length;
      const isSupplementalPortalLink =
        session.lineOfBusiness === "commercial" &&
        !!session.commercialSecondRoundSentAt &&
        !session.commercialSupplementalsCompletedAt;
      const accessToken = session.questionnaireAccessToken ?? createQuestionnaireAccessToken();
      const accessTokenCreatedAt =
        session.questionnaireAccessTokenCreatedAt ?? nowIso();
      const recipientPortalUrl = questionnaireRecipientUrl(portalUrl, accessToken);
      const subject =
        isSupplementalPortalLink
          ? `Action needed: complete supplemental carrier questions`
          : session.lineOfBusiness === "commercial"
          ? `Action needed: complete your commercial quoting questionnaire`
          : `Action needed: complete your quoting questionnaire`;
      const originalBody = [
        `Hi ${firstName},`,
        ``,
        `To run firm quotes for you, we need a few additional details. I've put together a short questionnaire (${questionCount} questions across ${sectionCount} sections — pre-filled with what we already have on file).`,
        ``,
        `Open and complete the questionnaire here:`,
        recipientPortalUrl,
        ``,
        `Once you submit, our AI runs the answers through every carrier we work with and I'll follow up with the top recommendations.`,
        ``,
        creator?.name ? `Best,\n${creator.name}` : `Best,\n${agencyName}`,
      ].join("\n");

      const supplementalBody = [
        `Hi ${firstName},`,
        ``,
        `A few carriers reviewed the commercial application and asked for supplemental form details that are not already on file. I put those follow-up questions into one short supplemental questionnaire (${questionCount} questions across ${sectionCount} sections).`,
        ``,
        `Open and complete the supplemental questions here:`,
        recipientPortalUrl,
        ``,
        `Once you submit, Quotex completes the requested carrier supplementals, sends the information back to those markets, and updates the accepted-carrier ranking for your agent.`,
        ``,
        creator?.name ? `Best,\n${creator.name}` : `Best,\n${agencyName}`,
      ].join("\n");
      const body = isSupplementalPortalLink ? supplementalBody : originalBody;
      const bodyHtml = questionnaireEmailHtml({
        firstName,
        creatorName: creator?.name,
        agencyName,
        portalUrl: recipientPortalUrl,
        questionCount,
        sectionCount,
        supplemental: isSupplementalPortalLink,
      });

      // Persist the bearer token before dispatching the email so a fast click on
      // another device can resolve the questionnaire as soon as the message arrives.
      if (!session.questionnaireAccessToken) {
        db.update("quotingSessions", sessionId, {
          questionnaireAccessToken: accessToken,
          questionnaireAccessTokenCreatedAt: accessTokenCreatedAt,
          updatedAt: nowIso(),
        });
      }

      const comm = api.communications.create({
        tenantId: session.tenantId,
        customerId: session.customerId,
        prospectId: session.prospectId,
        channel: "email",
        direction: "outbound",
        subject,
        body,
        bodyHtml,
        createdById: session.createdById,
      });
      const sentAt = nowIso();
      const updated = db.update("quotingSessions", sessionId, {
        questionnaireMessageId: comm.id,
        questionnaireDraft: `Subject: ${subject}\n\n${body}`,
        questionnaireSentAt: sentAt,
        questionnaireAccessToken: accessToken,
        questionnaireAccessTokenCreatedAt: accessTokenCreatedAt,
        status: "awaiting_reply",
        updatedAt: sentAt,
      });
      if (updated) {
        logQuotingWorkflowProgress(updated, {
          message: isSupplementalPortalLink
            ? `AI supplemental questionnaire sent to ${contact?.name ?? "client/prospect"} through the portal.`
            : `AI quoting questionnaire sent to ${contact?.name ?? "client/prospect"} through the portal.`,
          detail: isSupplementalPortalLink
            ? `${questionCount} supplemental carrier question${
                questionCount === 1 ? "" : "s"
              } across ${sectionCount} section${sectionCount === 1 ? "" : "s"} are awaiting reply.`
            : `${questionCount} question${questionCount === 1 ? "" : "s"} across ${sectionCount} section${
                sectionCount === 1 ? "" : "s"
              } are awaiting reply.`,
          createdAt: sentAt,
          createdById: session.createdById,
          communicationId: comm.id,
          source: "agent",
        });
        syncQuoteActivityStatus(updated, { actorId: "ai" });
      }
      return updated;
    },
    saveQuestionnaireResponses(
      sessionId: string,
      responses: Record<string, string>,
      actor?: QuestionnaireResponseActor
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      const updatedAt = nowIso();
      const mergedResponses = {
        ...(session.questionnaireResponses ?? {}),
        ...responses,
      };
      const updated = db.update("quotingSessions", sessionId, {
        questionnaireResponses: {
          ...mergedResponses,
        },
        questionnaireResponseMeta: mergeQuestionnaireResponseMeta(
          session,
          responses,
          actor,
          updatedAt
        ),
        updatedAt,
      });
      let finalUpdated = updated;
      if (updated?.lineOfBusiness === "commercial") {
        const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(
          updated,
          {},
          commercialApplicationSentAtForSession(updated) && updated.commercialSecondRoundSentAt
            ? "supplemental"
            : "application"
        );
        if (syncedAcordTemplates) {
          finalUpdated = db.update("quotingSessions", sessionId, {
            commercialAcordTemplates: syncedAcordTemplates,
            updatedAt,
          }) ?? updated;
        }
      }
      if (finalUpdated && Object.keys(responses).length > 0) {
        const actorLabel = actor?.name?.trim() || "Agent";
        const source: StatusEventSource =
          actor?.role === "customer" ? "customer" : actor?.role === "ai" ? "ai" : "agent";
        const templates = finalUpdated.commercialAcordTemplates ?? [];
        const autoFilledCount = templates.reduce(
          (sum, template) => sum + (template.autoFilledFieldCount ?? 0),
          0
        );
        const missingCount = templates.reduce(
          (sum, template) => sum + (template.missingFieldCount ?? 0),
          0
        );
        logQuotingWorkflowProgress(finalUpdated, {
          message: `${actorLabel} saved ${Object.keys(responses).length} quoting questionnaire answer${
            Object.keys(responses).length === 1 ? "" : "s"
          }; ACORD packet refreshed.`,
          detail:
            templates.length > 0
              ? `${templates.length} ACORD document${templates.length === 1 ? "" : "s"} updated. ${autoFilledCount} field${
                  autoFilledCount === 1 ? "" : "s"
                } currently filled; ${missingCount} field${missingCount === 1 ? "" : "s"} still need review.`
              : "The saved draft is now available for the quoting workflow.",
          createdAt: updatedAt,
          createdById: actor?.id ?? finalUpdated.createdById,
          source,
        });
      }
      return finalUpdated;
    },
    recommendCommercialCarriers(
      sessionId: string,
      responses?: Record<string, string>
    ): CommercialCarrierRecommendation[] {
      const session = this.get(sessionId);
      if (!session) return [];
      return commercialCarrierRecommendationsForSession(session, responses);
    },
    previewCommercialCarrierEmails(
      sessionId: string,
      responses: Record<string, string>,
      kind: "application" | "supplemental",
      carrierIds?: string[]
    ): CommercialUnderwriterEmailDraft[] {
      const session = this.get(sessionId);
      if (!session) return [];
      const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(session, responses, kind);
      const sessionForPreview =
        syncedAcordTemplates && syncedAcordTemplates.length > 0
          ? { ...session, commercialAcordTemplates: syncedAcordTemplates }
          : session;
      const targets =
        carrierIds ??
        (kind === "supplemental"
          ? (sessionForPreview.commercialCarrierSubmissions ?? [])
              .filter(
                (submission) =>
                  submission.status === "needs_client_info" ||
                  submission.status === "needs_supplemental"
              )
              .map((submission) => submission.carrierId)
          : []);
      return buildCommercialUnderwriterEmailDrafts(sessionForPreview, responses, kind, targets);
    },
    listCarrierEmailProcessing(
      tenantId: string,
      outcome?: CarrierEmailProcessing["outcome"]
    ): CarrierEmailProcessing[] {
      return db
        .list("carrierEmailProcessing")
        .filter(
          (row) => row.tenantId === tenantId && (!outcome || row.outcome === outcome)
        )
        .sort((left, right) => (left.processedAt < right.processedAt ? 1 : -1));
    },
    async processInboundCarrierCommunications(
      tenantId: string,
      options: {
        communicationIds?: string[];
        sessionId?: string;
        force?: boolean;
      } = {}
    ): Promise<{
      processed: number;
      review: number;
      ignored: number;
    }> {
      const selectedIds = options.communicationIds
        ? new Set(options.communicationIds)
        : null;
      const existingByCommunicationId = new Map(
        this.listCarrierEmailProcessing(tenantId).map((row) => [row.communicationId, row])
      );
      const inbound = db
        .list("communications")
        .filter(
          (communication) => {
            const prior = existingByCommunicationId.get(communication.id);
            const canRecheckForSelectedSession =
              Boolean(options.sessionId) && prior?.outcome === "ignored";
            return (
              communication.tenantId === tenantId &&
              communication.direction === "inbound" &&
              (!selectedIds || selectedIds.has(communication.id)) &&
              (options.force || !prior || canRecheckForSelectedSession)
            );
          }
        )
        .sort((left, right) => (left.createdAt > right.createdAt ? 1 : -1));
      let processed = 0;
      let review = 0;
      let ignored = 0;
      for (const communication of inbound) {
        const allExactMatches = commercialSubmissionMatchesForCommunication(
          tenantId,
          communication
        );
        const exactMatches = allExactMatches.filter(
          (match) => !options.sessionId || match.session.id === options.sessionId
        );
        const prior = existingByCommunicationId.get(communication.id);
        if (options.sessionId && allExactMatches.length > 0 && exactMatches.length === 0) {
          // This is a deterministic reply for a different quote flow. A
          // session-scoped check must leave it entirely untouched.
          continue;
        }
        if (exactMatches.length === 1) {
          const match = exactMatches[0];
          const submissionId =
            match.submission.submissionId ??
            commercialSubmissionStableId(match.session, match.submission.carrierId);
          const processingKey = `${tenantId}:${communication.id}`;
          if (carrierReplyProcessingInFlight.has(processingKey)) continue;
          carrierReplyProcessingInFlight.add(processingKey);
          let applied: QuotingSession | null = null;
          try {
            applied = await applyInboundCarrierReply({
              tenantId,
              sessionId: match.session.id,
              submissionId,
              communicationId: communication.id,
              matchReason: match.reason,
            });
          } finally {
            carrierReplyProcessingInFlight.delete(processingKey);
          }
          if (applied) {
            processed += 1;
            continue;
          }
        }
        const reviewCandidates =
          exactMatches.length > 1
            ? exactMatches
            : manualReviewCandidatesForCommunication(tenantId, communication).filter(
                (match) => !options.sessionId || match.session.id === options.sessionId
              );
        if (reviewCandidates.length > 0) {
          upsertCarrierEmailProcessing({
            tenantId,
            communicationId: communication.id,
            outcome: "manual_review",
            candidateSubmissionIds: uniqueStrings(
              reviewCandidates.map(
                (match) =>
                  match.submission.submissionId ??
                  commercialSubmissionStableId(match.session, match.submission.carrierId)
              )
            ),
            matchReason:
              exactMatches.length > 1
                ? "multiple_deterministic_matches"
                : "known_underwriter_without_deterministic_identifier",
            processedAt: nowIso(),
            reprocessedFrom: prior?.id,
          });
          review += 1;
          continue;
        }
        // A check for one quote flow must never consume a reply that belongs
        // to another flow. Leave it untouched so the correct session (or the
        // tenant-wide mailbox processor) can match it later.
        if (options.sessionId) continue;
        upsertCarrierEmailProcessing({
          tenantId,
          communicationId: communication.id,
          outcome: "ignored",
          matchReason: "not_a_deterministically_matched_carrier_reply",
          processedAt: nowIso(),
          reprocessedFrom: prior?.id,
        });
        ignored += 1;
      }
      return { processed, review, ignored };
    },
    async assignCarrierEmailProcessing(input: {
      processingId: string;
      sessionId: string;
      submissionId: string;
      assignedById: string;
    }): Promise<CarrierEmailProcessing | null> {
      const processing = db
        .list("carrierEmailProcessing")
        .find((row) => row.id === input.processingId);
      const session = this.get(input.sessionId);
      if (!processing || !session || session.tenantId !== processing.tenantId) return null;
      const submission = (session.commercialCarrierSubmissions ?? []).find(
        (candidate) =>
          (candidate.submissionId ?? commercialSubmissionStableId(session, candidate.carrierId)) ===
          input.submissionId
      );
      if (!submission) return null;
      const applied = await applyInboundCarrierReply({
        tenantId: processing.tenantId,
        sessionId: session.id,
        submissionId: input.submissionId,
        communicationId: processing.communicationId,
        matchReason: "agent_assigned_manual_review",
      });
      if (!applied) return null;
      return (
        db.update("carrierEmailProcessing", processing.id, {
          outcome: "matched_processed",
          matchedSessionId: session.id,
          matchedSubmissionId: input.submissionId,
          matchReason: "agent_assigned_manual_review",
          assignedById: input.assignedById,
          reprocessedFrom: processing.id,
          processedAt: nowIso(),
          updatedAt: nowIso(),
        }) ?? null
      );
    },
    async readCommercialCarrierResponses(sessionId: string): Promise<QuotingSession | null> {
      const session = this.get(sessionId);
      if (!session || session.lineOfBusiness !== "commercial") return session ?? null;
      await this.processInboundCarrierCommunications(session.tenantId, { sessionId });
      return this.get(sessionId) ?? null;
    },
    confirmCommercialCarrierDelivery(
      sessionId: string,
      kind: "application" | "supplemental"
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session || session.lineOfBusiness !== "commercial") return session ?? null;
      const submissions = session.commercialCarrierSubmissions ?? [];
      const messageIds = uniqueStrings(
        submissions.flatMap((submission) =>
          kind === "application"
            ? submission.applicationMessageIds ?? []
            : submission.supplementalMessageIds ?? []
        )
      );
      if (messageIds.length === 0) return session;
      const communications = new Map(
        db
          .list("communications")
          .filter((communication) => communication.tenantId === session.tenantId)
          .map((communication) => [communication.id, communication])
      );
      const providerConfirmed = messageIds.every((messageId) => {
        const status = communications.get(messageId)?.deliveryStatus;
        return status === "sent" || status === "synced";
      });
      if (!providerConfirmed) return null;

      const confirmedAt = nowIso();
      const confirmedSubmissions = submissions.map((submission) => {
        const submissionMessageIds =
          kind === "application"
            ? submission.applicationMessageIds ?? []
            : submission.supplementalMessageIds ?? [];
        if (!submissionMessageIds.some((messageId) => messageIds.includes(messageId))) {
          return submission;
        }
        const externalThreadIds = uniqueStrings(
          submissionMessageIds.map((messageId) => communications.get(messageId)?.externalThreadId)
        );
        return {
          ...submission,
          status: kind === "application" ? "awaiting_response" : "supplemental_sent",
          sentAt: confirmedAt,
          deliveryFailureReason: undefined,
          ...(kind === "application"
            ? {
                applicationExternalThreadIds: uniqueStrings([
                  ...(submission.applicationExternalThreadIds ?? []),
                  ...externalThreadIds,
                ]),
              }
            : {
                supplementalExternalThreadIds: uniqueStrings([
                  ...(submission.supplementalExternalThreadIds ?? []),
                  ...externalThreadIds,
                ]),
              }),
        } satisfies CommercialCarrierSubmission;
      });
      const updated = db.update("quotingSessions", sessionId, {
        commercialCarrierSubmissions: confirmedSubmissions,
        ...(kind === "application"
          ? { commercialApplicationSentAt: confirmedAt }
          : { commercialSupplementalsCompletedAt: confirmedAt }),
        status: "quoting",
        aiSummary:
          kind === "application"
            ? "The connected mailbox confirmed delivery of the carrier application packet. Quotex is awaiting carrier replies."
            : "The connected mailbox confirmed delivery of the carrier supplemental packet. Quotex is awaiting carrier replies.",
        updatedAt: confirmedAt,
      });
      if (updated) {
        logQuotingWorkflowProgress(updated, {
          message:
            kind === "application"
              ? "Carrier application delivery confirmed."
              : "Carrier supplemental delivery confirmed.",
          detail: `${messageIds.length} email${messageIds.length === 1 ? "" : "s"} confirmed by the connected mailbox provider.`,
          createdAt: confirmedAt,
          createdById: session.createdById,
          communicationId: messageIds[0],
        });
      }
      return updated ?? session;
    },
    markCommercialCarrierDeliveryFailed(
      sessionId: string,
      kind: "application" | "supplemental",
      reason?: string
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session || session.lineOfBusiness !== "commercial") return session ?? null;
      const failedAt = nowIso();
      const friendlyReason =
        reason?.trim() || "The connected mailbox did not confirm delivery. Review the mailbox connection and retry.";
      const failedSubmissions = (session.commercialCarrierSubmissions ?? []).map((submission) => {
        const messageIds =
          kind === "application"
            ? submission.applicationMessageIds ?? []
            : submission.supplementalMessageIds ?? [];
        if (messageIds.length === 0) return submission;
        const delivered = messageIds.every((messageId) => {
          const status = db.list("communications").find((row) => row.id === messageId)?.deliveryStatus;
          return status === "sent" || status === "synced";
        });
        if (delivered) return submission;
        return {
          ...submission,
          status: "send_failed",
          deliveryFailureReason: friendlyReason,
          responseAt: undefined,
          acceptedAt: undefined,
          aiRationale: "Carrier delivery was not confirmed. The packet remains available for retry.",
        } satisfies CommercialCarrierSubmission;
      });
      const updated = db.update("quotingSessions", sessionId, {
        commercialCarrierSubmissions: failedSubmissions,
        ...(kind === "application"
          ? { commercialApplicationSentAt: undefined }
          : { commercialSupplementalsCompletedAt: undefined }),
        status: kind === "application" ? "gathering_info" : "awaiting_reply",
        aiSummary: "Carrier delivery was not confirmed. No carrier response is recorded; the packet is ready to retry.",
        updatedAt: failedAt,
      });
      if (updated) {
        logQuotingWorkflowProgress(updated, {
          message: "Carrier email delivery needs attention.",
          detail: "The provider did not confirm delivery. The workflow was returned to a retryable state.",
          createdAt: failedAt,
          createdById: session.createdById,
        });
      }
      return updated ?? session;
    },
    // Commercial flow: client submits structured answers from the
    // portal questionnaire. Stamps the responses, marks reply
    // received and runs the quotes. runQuotes() creates the Activity
    // Center milestone when the ranking is ready for agent review.
    submitQuestionnaireResponses(
      sessionId: string,
      responses: Record<string, string>,
      actor?: QuestionnaireResponseActor,
      options?: {
        selectedCommercialCarrierIds?: string[];
        commercialCarrierEmailDrafts?: CommercialUnderwriterEmailDraft[];
        awaitLiveMailboxDelivery?: boolean;
      }
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      const updatedAt = nowIso();
      const mergedResponses = {
        ...(session.questionnaireResponses ?? {}),
        ...responses,
      };
      const responseMeta = mergeQuestionnaireResponseMeta(
        session,
        responses,
        actor,
        updatedAt
      );
      if (session.lineOfBusiness === "commercial") {
        const applicationSentAt = commercialApplicationSentAtForSession(session);
        const sessionWithResponses: QuotingSession = {
          ...session,
          commercialApplicationSentAt: applicationSentAt,
          questionnaireResponses: mergedResponses,
          questionnaireResponseMeta: responseMeta,
          updatedAt,
        };
        const syncedAcordTemplates = syncCommercialAcordPdfArtifacts(
          sessionWithResponses,
          {},
          applicationSentAt ? "supplemental" : "application"
        );
        const commercialContact = session.prospectId
          ? db.list("prospects").find((p) => p.id === session.prospectId)
          : session.customerId
          ? db.list("customers").find((c) => c.id === session.customerId)
          : null;
        const explicitSelectedCommercialCarrierIds = options?.selectedCommercialCarrierIds;
        const forceUnderwriterEmailForSelected =
          !!explicitSelectedCommercialCarrierIds &&
          (options?.commercialCarrierEmailDrafts?.length ?? 0) > 0;
        const selectedCommercialCarrierIds =
          explicitSelectedCommercialCarrierIds ??
          (applicationSentAt
            ? (session.commercialCarrierSubmissions ?? []).map(
                (submission) => submission.carrierId
              )
            : undefined);
        if (
          actor?.role === "customer" &&
          !applicationSentAt &&
          !explicitSelectedCommercialCarrierIds?.length
        ) {
          const answeredCount = Object.values(mergedResponses).filter((value) => value.trim()).length;
          const updatedSession = db.update("quotingSessions", sessionId, {
            questionnaireResponses: mergedResponses,
            questionnaireResponseMeta: responseMeta,
            commercialAcordTemplates:
              syncedAcordTemplates ?? session.commercialAcordTemplates,
            replyReceivedAt: updatedAt,
            missingFields: [],
            aiSummary: `${commercialContact?.name ?? "Client"} completed the commercial questionnaire. The ACORD package is ready for agent review before selecting carriers.`,
            status: "gathering_info",
            updatedAt,
          });
          logQuotingWorkflowProgress(session, {
            message: `${commercialContact?.name ?? "Client"} completed the commercial quoting questionnaire.`,
            detail: `${answeredCount} answer${
              answeredCount === 1 ? "" : "s"
            } saved. Carrier send is waiting for agent review and selected markets.`,
            createdAt: updatedAt,
            createdById: actor.id ?? "customer",
          });
          return updatedSession;
        }
        const pipeline = analyzeCommercialCarrierPipeline(
          {
            ...sessionWithResponses,
            commercialAcordTemplates:
              syncedAcordTemplates ?? sessionWithResponses.commercialAcordTemplates,
          },
          mergedResponses,
          updatedAt,
          selectedCommercialCarrierIds,
          forceUnderwriterEmailForSelected
        );
        if (!applicationSentAt) {
          const awaitingSubmissions = options?.awaitLiveMailboxDelivery
            ? pipeline.submissions.map((submission) => ({
                ...submission,
                status: "application_sent" as const,
                sentAt: undefined,
                deliveryFailureReason: undefined,
                responseAt: undefined,
                acceptedAt: undefined,
                aiRationale:
                  "The application packet is prepared and waiting for confirmation from the connected mailbox provider.",
              }))
            : markCommercialSubmissionsAwaitingResponse(pipeline.submissions);
          const carrierSubmissions = attachCommercialUnderwriterMessages(
            session,
            awaitingSubmissions,
            mergedResponses,
            "application",
            undefined,
            options?.commercialCarrierEmailDrafts
          );
          const underwriterEmailCount = carrierSubmissions.reduce(
            (sum, submission) => sum + (submission.applicationMessageIds?.length ?? 0),
            0
          );
          const portalAutomationCount = carrierSubmissions.filter(
            (submission) => submission.submissionMethod === "carrier_portal_automation"
          ).length;
          const firstCarrierMessageSubmission = carrierSubmissions.find((submission) =>
            commercialSubmissionMessageId(submission)
          );
          logQuotingWorkflowProgress(session, {
            message: `Commercial application packet ${
              options?.awaitLiveMailboxDelivery ? "prepared for" : "sent to"
            } ${pipeline.submittedCarrierCount} carrier${
              pipeline.submittedCarrierCount === 1 ? "" : "s"
            }${
              options?.awaitLiveMailboxDelivery
                ? "; waiting for mailbox delivery confirmation."
                : "; awaiting carrier responses."
            }`,
            detail: `${portalAutomationCount} portal automation job${
              portalAutomationCount === 1 ? "" : "s"
            } queued. ${underwriterEmailCount} underwriter email${
              underwriterEmailCount === 1 ? "" : "s"
            } created. Carrier outcomes will be classified only after an inbound reply is received and matched to the submission.`,
            createdAt: updatedAt,
            createdById: session.createdById,
            communicationId: firstCarrierMessageSubmission
              ? commercialSubmissionMessageId(firstCarrierMessageSubmission)
              : undefined,
            documentId: firstCarrierMessageSubmission
              ? commercialSubmissionDocumentId(firstCarrierMessageSubmission)
              : undefined,
          });
          const submittedSession = db.update("quotingSessions", sessionId, {
            questionnaireResponses: mergedResponses,
            questionnaireResponseMeta: responseMeta,
            commercialAcordTemplates:
              syncedAcordTemplates ?? session.commercialAcordTemplates,
            commercialCarrierSubmissions: carrierSubmissions,
            commercialApplicationSentAt: options?.awaitLiveMailboxDelivery
              ? undefined
              : updatedAt,
            missingFields: [],
            aiSummary: options?.awaitLiveMailboxDelivery
              ? `The completed ACORD application packet is prepared for ${pipeline.submittedCarrierCount} appetite-matched carrier${
                  pipeline.submittedCarrierCount === 1 ? "" : "s"
                }. The workflow will advance only after the connected mailbox confirms delivery.`
              : `AI sent the completed ACORD application packet to ${pipeline.submittedCarrierCount} appetite-matched carrier${
                  pipeline.submittedCarrierCount === 1 ? "" : "s"
                }. The workflow is awaiting real inbound carrier replies before any market is accepted, declined, or sent to review.`,
            status: "quoting",
            updatedAt,
          });
          if (options?.awaitLiveMailboxDelivery && underwriterEmailCount > 0) {
            return submittedSession;
          }
          void this.processInboundCarrierCommunications(session.tenantId, { sessionId });
          return submittedSession;
        }
        const carrierSubmissions = applicationSentAt
          ? session.commercialCarrierSubmissions ?? []
          : mergeCommercialSubmissionArtifacts(session, pipeline.submissions);
        const carrierReplySecondRoundQuestions = (session.questionnaireQuestions ?? []).filter(
          (question) =>
            question.round === "second_round" &&
            question.carrierId &&
            (session.commercialCarrierSubmissions ?? []).some(
              (submission) =>
                submission.carrierId === question.carrierId &&
                (submission.status === "needs_client_info" ||
                  submission.status === "needs_supplemental")
            )
        );
        const allowSimulatedCarrierSecondRound = false;
        if (
          allowSimulatedCarrierSecondRound &&
          !session.commercialSecondRoundSentAt &&
          pipeline.secondRoundQuestions.length > 0 &&
          carrierReplySecondRoundQuestions.length > 0
        ) {
          const portalUrl = `/customer/questionnaire/${sessionId}`;
          const subject = "Additional details needed for carrier supplementals";
          const body = [
            `Hi ${(commercialContact?.name ?? "there").split(/\s+/)[0]},`,
            ``,
            `Our AI submitted your commercial application to the carriers whose appetite matched the risk. A few of those carriers asked for supplemental details that are not already on file.`,
            ``,
            `Please complete the short second-round questionnaire here:`,
            portalUrl,
            ``,
            `Once those answers come in, the AI will auto-complete the supplementals, send them back to the remaining carriers, and show your agent only the accepted carrier options.`,
          ].join("\n");
          const comm = api.communications.create({
            tenantId: session.tenantId,
            customerId: session.customerId,
            prospectId: session.prospectId,
            channel: "email",
            direction: "outbound",
            subject,
            body,
            createdById: session.createdById,
          });
          const underwriterEmailCount = carrierSubmissions.reduce(
            (sum, submission) => sum + (submission.applicationMessageIds?.length ?? 0),
            0
          );
          const portalAutomationCount = carrierSubmissions.filter(
            (submission) => submission.submissionMethod === "carrier_portal_automation"
          ).length;
          const firstCarrierMessageSubmission = carrierSubmissions.find((submission) =>
            commercialSubmissionMessageId(submission)
          );
          logQuotingWorkflowProgress(session, {
            message: `AI submitted the commercial application to ${pipeline.submittedCarrierCount} appetite-matched carrier${
              pipeline.submittedCarrierCount === 1 ? "" : "s"
            } and sent a second-round supplemental questionnaire to the client.`,
            detail: `${portalAutomationCount} portal automation job${
              portalAutomationCount === 1 ? "" : "s"
            } queued. ${underwriterEmailCount} underwriter email${
              underwriterEmailCount === 1 ? "" : "s"
            } created. ${pipeline.acceptedCarrierIds.length} accepted market${
              pipeline.acceptedCarrierIds.length === 1 ? "" : "s"
            } can rank now; ${pipeline.secondRoundQuestions.length} supplemental field${
              pipeline.secondRoundQuestions.length === 1 ? "" : "s"
            } still need client input.`,
            createdAt: updatedAt,
            createdById: session.createdById,
            communicationId: firstCarrierMessageSubmission
              ? commercialSubmissionMessageId(firstCarrierMessageSubmission)
              : comm.id,
            documentId: firstCarrierMessageSubmission
              ? commercialSubmissionDocumentId(firstCarrierMessageSubmission)
              : undefined,
          });
          db.update("quotingSessions", sessionId, {
            questionnaireResponses: mergedResponses,
            questionnaireResponseMeta: responseMeta,
            commercialAcordTemplates:
              syncedAcordTemplates ?? session.commercialAcordTemplates,
            questionnaireQuestions: appendUniqueQuestions(
              session.questionnaireQuestions ?? [],
              pipeline.secondRoundQuestions
            ),
            questionnaireMessageId: comm.id,
            questionnaireDraft: `Subject: ${subject}\n\n${body}`,
            questionnaireSentAt: updatedAt,
            commercialCarrierSubmissions: carrierSubmissions,
            commercialApplicationSentAt:
              applicationSentAt ?? updatedAt,
            commercialSecondRoundSentAt: updatedAt,
            missingFields: pipeline.secondRoundQuestions.map((q) => q.label),
            aiSummary: `AI sent the application to ${pipeline.submittedCarrierCount} appetite-matched carriers. ${pipeline.secondRoundQuestions.length} supplemental field${
              pipeline.secondRoundQuestions.length === 1 ? "" : "s"
            } still need the client.`,
            status: "awaiting_reply",
            updatedAt,
          });
          const acceptedCount = pipeline.acceptedCarrierIds.length;
          const pendingCount = pipeline.submissions.filter(
            (submission) => submission.status === "needs_client_info"
          ).length;
          return this.runQuotes(sessionId, {
            status: "awaiting_reply",
            aiSummary: `AI is already ranking ${acceptedCount} accepted market${
              acceptedCount === 1 ? "" : "s"
            }. ${pendingCount} carrier${
              pendingCount === 1 ? "" : "s"
            } will join the ranking once the second-round supplemental details are completed.`,
          });
        }
        const supplementalCarrierIds = new Set(
          (session.commercialCarrierSubmissions ?? [])
            .filter(
              (submission) =>
                submission.status === "needs_client_info" ||
                submission.status === "needs_supplemental"
            )
            .map((submission) => submission.carrierId)
        );
        if (supplementalCarrierIds.size === 0) {
          const waitingSession = db.update("quotingSessions", sessionId, {
            questionnaireResponses: mergedResponses,
            questionnaireResponseMeta: responseMeta,
            commercialAcordTemplates:
              syncedAcordTemplates ?? session.commercialAcordTemplates,
            replyReceivedAt: updatedAt,
            status: session.status === "complete" ? "complete" : "quoting",
            commercialCarrierSubmissions:
              session.commercialCarrierSubmissions ?? carrierSubmissions,
            commercialApplicationSentAt:
              applicationSentAt ?? session.commercialApplicationSentAt ?? updatedAt,
            commercialSupplementalsCompletedAt: updatedAt,
            missingFields: [],
            aiSummary:
              "No carrier supplemental request is pending. The workflow is still waiting for matched inbound carrier replies before ranking any market.",
            updatedAt,
          });
          return waitingSession;
        }
        const completedCarrierSubmissions = applicationSentAt
          ? attachCommercialUnderwriterMessages(
              { ...session, commercialApplicationSentAt: applicationSentAt, commercialCarrierSubmissions: carrierSubmissions },
              carrierSubmissions,
              mergedResponses,
              "supplemental",
              supplementalCarrierIds,
              options?.commercialCarrierEmailDrafts
            )
          : carrierSubmissions;
        const awaitingSupplementalResponses = completedCarrierSubmissions.map((submission) =>
          supplementalCarrierIds.has(submission.carrierId)
            ? options?.awaitLiveMailboxDelivery
              ? {
                  ...submission,
                  sentAt: undefined,
                  deliveryFailureReason: undefined,
                  aiRationale:
                    "The carrier supplemental package is prepared and waiting for confirmation from the connected mailbox provider.",
                }
              : {
                  ...submission,
                  status: "supplemental_sent" as const,
                  missingFields: undefined,
                  acceptedAt: undefined,
                  aiRationale:
                    "Carrier supplemental package was sent. Awaiting the carrier's inbound response before AI classifies this market.",
                }
            : submission
        );
        const supplementalSession = db.update("quotingSessions", sessionId, {
          questionnaireResponses: mergedResponses,
          questionnaireResponseMeta: responseMeta,
          commercialAcordTemplates:
            syncedAcordTemplates ?? session.commercialAcordTemplates,
          replyReceivedAt: updatedAt,
          status: "quoting",
          commercialCarrierSubmissions: awaitingSupplementalResponses,
          commercialApplicationSentAt:
            applicationSentAt ?? updatedAt,
          commercialSupplementalsCompletedAt: options?.awaitLiveMailboxDelivery
            ? undefined
            : updatedAt,
          missingFields: [],
          aiSummary: options?.awaitLiveMailboxDelivery
            ? "The carrier-requested supplemental package is prepared. The workflow will advance only after the connected mailbox confirms delivery."
            : "AI sent the carrier-requested supplemental package. The workflow is awaiting matched inbound carrier replies before ranking any market.",
          updatedAt,
        });
        const firstCompletedCarrierMessageSubmission = awaitingSupplementalResponses.find((submission) =>
          commercialSubmissionMessageId(submission)
        );
        logQuotingWorkflowProgress(session, {
          message: `${commercialContact?.name ?? "Client"} completed commercial supplemental details; the carrier package was ${
            options?.awaitLiveMailboxDelivery ? "prepared for delivery" : "sent"
          }.`,
          detail: options?.awaitLiveMailboxDelivery
            ? "The workflow is waiting for mailbox delivery confirmation."
            : "Carrier responses will be classified only after a matched inbound reply is received.",
          createdAt: updatedAt,
          communicationId: firstCompletedCarrierMessageSubmission
            ? commercialSubmissionMessageId(firstCompletedCarrierMessageSubmission)
            : undefined,
          documentId: firstCompletedCarrierMessageSubmission
              ? commercialSubmissionDocumentId(firstCompletedCarrierMessageSubmission)
              : undefined,
        });
        return supplementalSession;
      }
      const quotingSession = db.update("quotingSessions", sessionId, {
        questionnaireResponses: { ...(session.questionnaireResponses ?? {}), ...responses },
        questionnaireResponseMeta: responseMeta,
        replyReceivedAt: updatedAt,
        status: "quoting",
        updatedAt,
      });
      if (quotingSession) {
        syncQuoteActivityStatus(quotingSession, { actorId: "ai" });
      }
      const contact = session.prospectId
        ? db.list("prospects").find((p) => p.id === session.prospectId)
        : session.customerId
        ? db.list("customers").find((c) => c.id === session.customerId)
        : null;
      logQuotingWorkflowProgress(session, {
        message: `${contact?.name ?? "Client"} submitted ${Object.keys(responses).length} questionnaire response${
          Object.keys(responses).length === 1 ? "" : "s"
        }; AI ranking ready to run.`,
        detail: "The workflow moved from client questionnaire collection into carrier ranking.",
        createdAt: updatedAt,
        createdById: actor?.id ?? "ai",
      });
      // Auto-run the carrier ranking now that the client side is done.
      return this.runQuotes(sessionId);
    },
    // Phase 2 draft step: AI drafts the questionnaire body. The
    // agent reviews + sends; sending creates a Communication row.
    async draftQuestionnaire(sessionId: string): Promise<QuotingSession | null> {
      const session = this.get(sessionId);
      if (!session) return null;
      const tenant = db.list("agencies").find((a) => a.id === session.tenantId);
      const creator = db.list("users").find((u) => u.id === session.createdById);
      const subject = session.prospectId
        ? db.list("prospects").find((p) => p.id === session.prospectId)
        : session.customerId
        ? db.list("customers").find((c) => c.id === session.customerId)
        : null;
      const contactName = subject?.name ?? "Friend";
      const { aiDraftQuestionnaire } = await import("./ai");
      const { subject: subj, body } = aiDraftQuestionnaire({
        prospectName: contactName,
        agencyName: tenant?.name ?? "your agency",
        agentName: creator?.name,
        missingFields: session.missingFields,
      });
      const draftedAt = nowIso();
      const updated = db.update("quotingSessions", sessionId, {
        questionnaireDraft: `Subject: ${subj}\n\n${body}`,
        updatedAt: draftedAt,
      });
      if (updated) {
        logQuotingWorkflowProgress(updated, {
          message: "AI drafted the quoting questionnaire for staff review.",
          detail: `${session.missingFields.length} missing field${
            session.missingFields.length === 1 ? "" : "s"
          } were converted into client questions.`,
          createdAt: draftedAt,
        });
      }
      return updated;
    },
    // Phase 2 send step: writes the questionnaire as an outbound
    // Communication and flips the session to awaiting_reply.
    sendQuestionnaire(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session || !session.questionnaireDraft) return null;
      const subjectMatch = session.questionnaireDraft.match(/^Subject:\s*(.+)/);
      const subject = subjectMatch?.[1] ?? "A few details to finalize your quote";
      const body = session.questionnaireDraft.replace(/^Subject:.*\n\n/, "");
      const comm = api.communications.create({
        tenantId: session.tenantId,
        customerId: session.customerId,
        prospectId: session.prospectId,
        channel: "email",
        direction: "outbound",
        subject,
        body,
        createdById: session.createdById,
      });
      const sentAt = nowIso();
      const updated = db.update("quotingSessions", sessionId, {
        questionnaireMessageId: comm.id,
        questionnaireSentAt: sentAt,
        status: "awaiting_reply",
        updatedAt: sentAt,
      });
      if (updated) {
        logQuotingWorkflowProgress(updated, {
          message: "AI quoting questionnaire sent; workflow is awaiting client reply.",
          detail: `Outbound message ${comm.id} is attached to this quoting session.`,
          createdAt: sentAt,
          createdById: session.createdById,
        });
        syncQuoteActivityStatus(updated, { actorId: "ai" });
      }
      return updated;
    },
    // Phase 3: agent marks the reply received → AI runs the quotes.
    markReplyReceivedAndQuote(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      const receivedAt = nowIso();
      const quotingSession = db.update("quotingSessions", sessionId, {
        replyReceivedAt: receivedAt,
        status: "quoting",
        updatedAt: receivedAt,
      });
      if (quotingSession) {
        syncQuoteActivityStatus(quotingSession, { actorId: "ai" });
      }
      logQuotingWorkflowProgress(quotingSession ?? session, {
        message: "Client reply received; AI carrier ranking started.",
        detail: "The workflow moved from awaiting reply to quoting.",
        createdAt: receivedAt,
      });
      return this.runQuotes(sessionId);
    },
    // Phase 4: call each carrier's quoting-API (simulated) and
    // rank the responses. Commercial second-round workflows can
    // preserve "awaiting_reply" while exposing accepted markets.
    runQuotes(
      sessionId: string,
      options?: { status?: QuotingSessionStatus; aiSummary?: string }
    ): QuotingSession {
      const session = this.get(sessionId);
      if (!session) throw new Error("Quoting session not found.");
      // Pull state late so the customer's mailing address / public-
      // record garaging address can backfill if the session didn't
      // capture one at start.
      let state = session.state;
      if (!state && session.customerId) {
        const cust = db.list("customers").find((c) => c.id === session.customerId);
        if (cust?.mailingAddress) state = extractStateFromString(cust.mailingAddress);
      }
      if (!state && session.publicFields["Garaging address"]) {
        state = extractStateFromString(
          String(session.publicFields["Garaging address"])
        );
      }
      // Only the agency's linked + active carriers participate.
      const links = db
        .list("carrierLinks")
        .filter((l) => l.tenantId === session.tenantId && l.active);
      const linkedCarrierIds = new Set(links.map((l) => l.carrierId));
      let eligibleCarriers = db
        .list("carriers")
        .filter((c) => linkedCarrierIds.has(c.id));
      if (session.lineOfBusiness === "commercial") {
        const submissions = session.commercialCarrierSubmissions ?? [];
        const acceptedIds = new Set(
          submissions
            .filter((s) => s.status === "accepted" || s.status === "supplemental_sent")
            .map((s) => s.carrierId)
        );
        if (submissions.length > 0) {
          eligibleCarriers = eligibleCarriers.filter((c) => acceptedIds.has(c.id));
        }
      }
      const { quotes, summary } = runCarrierQuoteProviders({
        carriers: eligibleCarriers,
        session: { ...session, state },
        state,
      });
      const carrierReplyPremiums =
        session.lineOfBusiness === "commercial"
          ? new Map(
              (session.commercialCarrierSubmissions ?? [])
                .filter((submission) => submission.finalPremium ?? submission.premiumEstimate)
                .map((submission) => [
                  submission.carrierId,
                  {
                    premium: submission.finalPremium ?? submission.premiumEstimate ?? 0,
                    confidence: submission.parseConfidence ?? submission.quote?.confidence ?? 0.82,
                  },
                ])
            )
          : new Map<string, { premium: number; confidence: number }>();
      const groundedQuotes =
        carrierReplyPremiums.size > 0
          ? quotes.map((quote) => {
              const parsed = carrierReplyPremiums.get(quote.carrierId);
              if (!parsed) return quote;
              return {
                ...quote,
                premium: parsed.premium,
                confidence: Math.max(quote.confidence, parsed.confidence),
                fitReason: `${quote.fitReason} - carrier reply premium captured`,
                apiStatus: quote.apiStatus === "no_api" ? "connected" : quote.apiStatus,
              } satisfies CarrierQuote;
            })
          : quotes;
      const rankedAt = nowIso();
      const updated = db.update("quotingSessions", sessionId, {
        quotes: groundedQuotes,
        aiSummary: options?.aiSummary ?? summary,
        status: options?.status ?? "complete",
        updatedAt: rankedAt,
      })!;
      syncQuoteActivityStatus(updated, { actorId: "ai" });
      logQuotingWorkflowProgress(updated, {
        message:
          updated.status === "awaiting_reply"
            ? `AI ranked ${groundedQuotes.length} accepted market${groundedQuotes.length === 1 ? "" : "s"} while supplemental answers remain pending.`
            : `AI carrier ranking completed with ${groundedQuotes.length} quote option${groundedQuotes.length === 1 ? "" : "s"}.`,
        detail: options?.aiSummary ?? summary,
        createdAt: rankedAt,
      });
      const contact = quoteSessionContact(updated);
      if (updated.status === "awaiting_reply") {
        createQuoteMilestoneTask(updated, {
          milestone: "supplemental_pending",
          title: `${contact.name} supplemental questionnaire pending`,
          description: `${contact.name}'s accepted markets are partially ranked, but at least one carrier requested supplemental details before it can be included in the final quote review.`,
          severity: "warning",
          severityReason: "Carrier response required a second-round supplemental questionnaire.",
        });
      } else if (updated.status === "complete") {
        resolveQuoteMilestoneTasks(updated, ["supplemental_pending", "quote_ready"]);
        createQuoteReadyNotification(updated, {
          title:
            groundedQuotes.length > 0
              ? `${contact.name} quote options ready`
              : `${contact.name} quote review needed`,
          summary:
            groundedQuotes.length > 0
              ? `AI completed carrier ranking with ${groundedQuotes.length} quote option${
                  groundedQuotes.length === 1 ? "" : "s"
                }. Review the ranked options when ready.`
              : "AI completed the carrier run but no quote options returned. Review carrier eligibility and decide the next step.",
          severity: groundedQuotes.length > 0 ? "warning" : "urgent",
          severityReason:
            groundedQuotes.length > 0
              ? "Carrier ranking is complete and ready for agent review."
              : "Carrier ranking completed without a market result.",
        });
      }
      return updated;
    },
    implementPolicy(input: {
      sessionId: string;
      carrierId: string;
      implementedById: string;
    }): {
      session: QuotingSession;
      policy: Policy;
      carrierPortalUrl?: string;
      carrierReference: string;
      mode: "live_api" | "manual_workflow";
      bindingTrace?: import("@/types").CarrierPolicyBindingTrace;
    } {
      const session = this.get(input.sessionId);
      if (!session) throw new Error("Quoting session not found.");
      const quote = session.quotes.find((q) => q.carrierId === input.carrierId);
      if (!quote) throw new Error("Carrier quote not found on this session.");
      if (quote.implementation?.policyId) {
        const existing = db.list("policies").find((p) => p.id === quote.implementation?.policyId);
        if (existing) {
          return {
            session,
            policy: existing,
            carrierPortalUrl: quote.implementation.carrierPortalUrl,
            carrierReference: quote.implementation.carrierReference,
            mode: quote.implementation.mode,
            bindingTrace: quote.implementation.bindingTrace,
          };
        }
      }

      const carrier = db.list("carriers").find((c) => c.id === input.carrierId);
      if (!carrier) throw new Error("Carrier not found.");

      const prospect = session.prospectId
        ? db.list("prospects").find((p) => p.id === session.prospectId)
        : undefined;
      const customerId = session.customerId ?? prospect?.customerId;
      if (!customerId) {
        throw new Error("Convert this prospect to a client before implementing a carrier policy.");
      }
      const customer = db.list("customers").find((c) => c.id === customerId);
      if (!customer) throw new Error("Customer record not found.");

      let asset = session.assetId ? db.list("assets").find((a) => a.id === session.assetId) : undefined;
      if (!asset) {
        const sessionAddress = String(session.assetDetails?.address ?? "").trim();
        const publicPropertyAddress = String(session.publicFields["Property address"] ?? "").trim();
        const assetDetailsForLabel = {
          ...(session.assetDetails ?? {}),
          address: sessionAddress || publicPropertyAddress,
        };
        const label = deriveAssetLabel(session.assetType, assetDetailsForLabel);
        asset = api.assets.create({
          tenantId: session.tenantId,
          customerId,
          type: session.assetType,
          label,
          estimatedValue: session.estimatedValue || 0,
          details: {
            ...(session.assetDetails ?? {}),
            publicFields: session.publicFields,
            createdFromQuotingSessionId: session.id,
          },
          status: "insured",
        });
        queueVehicleLabelUpgrade(asset.id, asset.label);
      } else if (asset.status !== "insured") {
        db.update("assets", asset.id, { status: "insured" });
      }

      const now = nowIso();
      const existingPolicy = db
        .list("policies")
        .find(
          (p) =>
            p.customerId === customerId &&
            p.assetId === asset!.id &&
            p.carrierId === carrier.id &&
            p.status === "bound"
        );
      const policyNumber = existingPolicy?.policyNumber ?? implementedPolicyNumber(carrier, session);
      const carrierPortalUrl = quote.providerTrace?.liveReady
        ? carrier.agentPortalUrl
        : carrier.agentPortalUrl;
      const providerExecution = quote.providerTrace?.executionId;
      const carrierReference =
        providerExecution ?? `${policyNumber}-${now.slice(0, 10).replace(/-/g, "")}`;
      const policyPatch: Partial<Policy> = {
        tenantId: session.tenantId,
        customerId,
        assetId: asset.id,
        carrierId: carrier.id,
        policyNumber,
        premiumEstimate: quote.premium,
        finalPremium: quote.premium,
        effectiveDate: now,
        renewalDate: addOnePolicyYear(now),
        status: "bound",
        renewalStatus: "not_due",
        agentId: input.implementedById,
        department: session.lineOfBusiness === "commercial" ? "commercial" : "personal",
        paymentFrequency: "annual",
        billingMethod: "direct_bill",
        billingPayer: "client",
        billingStatus: "current",
        billingReference: carrierReference,
        billingLastVerifiedAt: now,
      };
      let policy = existingPolicy
        ? db.update("policies", existingPolicy.id, policyPatch)!
        : api.policies.create(policyPatch as Omit<Policy, "id" | "createdAt">);
      const bindingTrace = prepareCarrierPolicyBinding({
        carrier,
        session,
        quote,
        policy,
        implementedById: input.implementedById,
      });
      const mode: "live_api" | "manual_workflow" =
        bindingTrace.status === "bound_on_carrier" ? "live_api" : "manual_workflow";
      policy = db.update("policies", policy.id, {
        carrierBindingStatus: bindingTrace.status,
        carrierBindingReference: bindingTrace.carrierReference,
        carrierBindingMode: mode,
        carrierBindingTrace: bindingTrace,
        billingReference: bindingTrace.carrierReference,
        billingNotes:
          bindingTrace.status === "bound_on_carrier"
            ? `Registered on carrier side through ${bindingTrace.providerLabel}.`
            : `Quotex policy record created. Carrier-side registration requires ${bindingTrace.providerLabel}; ${bindingTrace.blockingReasons.join("; ") || "live binding confirmation pending"}.`,
      })!;
      ensureCarrierBindingIssueTask({
        session,
        policy,
        carrier,
        status: bindingTrace.status,
        reasons: bindingTrace.blockingReasons,
        actorId: input.implementedById,
      });

      const nextQuotes = session.quotes.map((q) =>
        q.carrierId === input.carrierId
          ? {
              ...q,
              implementation: {
                status: "implemented" as const,
                policyId: policy.id,
                carrierReference: bindingTrace.carrierReference,
                carrierPortalUrl,
                implementedAt: now,
                implementedById: input.implementedById,
                mode,
                bindingTrace,
              },
            }
          : q
      );
      const updatedSession = db.update("quotingSessions", session.id, {
        quotes: nextQuotes,
        updatedAt: now,
      })!;

      logQuotingWorkflowProgress(
        { ...session, customerId, assetId: asset.id },
        {
          message: `${carrier.name} quote implemented as Policy #${policyNumber} (${mode === "live_api" ? "carrier registered" : "carrier binding pending/manual"}). Carrier reference ${bindingTrace.carrierReference}.`,
          detail: `Policy ${policy.id} and billing record fields were created from quoting session ${session.id}.`,
          createdAt: now,
          createdById: input.implementedById,
          policyId: policy.id,
          assetId: asset.id,
        }
      );

      return {
        session: updatedSession,
        policy,
        carrierPortalUrl,
        carrierReference: bindingTrace.carrierReference,
        mode,
        bindingTrace,
      };
    },
    async implementPolicyWithCarrierBind(input: {
      sessionId: string;
      carrierId: string;
      implementedById: string;
    }): Promise<{
      session: QuotingSession;
      policy: Policy;
      carrierPortalUrl?: string;
      carrierReference: string;
      mode: "live_api" | "manual_workflow";
      bindingTrace?: import("@/types").CarrierPolicyBindingTrace;
    }> {
      const initial = this.implementPolicy(input);
      const session = this.get(input.sessionId) ?? initial.session;
      const quote = session.quotes.find((q) => q.carrierId === input.carrierId);
      const carrier = db.list("carriers").find((c) => c.id === input.carrierId);
      if (!quote || !carrier) return initial;
      const bindingTrace = await runCarrierPolicyBinding({
        carrier,
        session,
        quote,
        policy: initial.policy,
        implementedById: input.implementedById,
      });
      const mode: "live_api" | "manual_workflow" =
        bindingTrace.status === "bound_on_carrier" ? "live_api" : "manual_workflow";
      const policy =
        db.update("policies", initial.policy.id, {
          carrierBindingStatus: bindingTrace.status,
          carrierBindingReference: bindingTrace.carrierReference,
          carrierBindingMode: mode,
          carrierBindingTrace: bindingTrace,
          billingReference: bindingTrace.carrierReference,
          billingNotes:
            bindingTrace.status === "bound_on_carrier"
              ? `Registered on carrier side through ${bindingTrace.providerLabel}.`
            : `Quotex policy record created. Carrier-side registration requires ${bindingTrace.providerLabel}; ${bindingTrace.blockingReasons.join("; ") || "live binding confirmation pending"}.`,
        }) ?? initial.policy;
      ensureCarrierBindingIssueTask({
        session,
        policy,
        carrier,
        status: bindingTrace.status,
        reasons: bindingTrace.blockingReasons,
        actorId: input.implementedById,
      });
      const nextSession =
        db.update("quotingSessions", session.id, {
          quotes: session.quotes.map((q) =>
            q.carrierId === input.carrierId && q.implementation
              ? {
                  ...q,
                  implementation: {
                    ...q.implementation,
                    mode,
                    carrierReference: bindingTrace.carrierReference,
                    bindingTrace,
                  },
                }
              : q
          ),
          updatedAt: nowIso(),
        }) ?? session;

      if (bindingTrace.status === "bound_on_carrier") {
        logQuotingWorkflowProgress(
          { ...session, customerId: policy.customerId, assetId: policy.assetId },
          {
            message: `${carrier.name} confirmed carrier-side registration for Policy #${policy.policyNumber ?? policy.id}. Carrier reference ${bindingTrace.carrierReference}.`,
            detail: `${bindingTrace.providerLabel} returned a bound-on-carrier confirmation for quoting session ${session.id}.`,
            createdById: input.implementedById,
            policyId: policy.id,
            assetId: policy.assetId,
          }
        );
      }

      return {
        session: nextSession,
        policy,
        carrierPortalUrl: initial.carrierPortalUrl,
        carrierReference: bindingTrace.carrierReference,
        mode,
        bindingTrace,
      };
    },
    stepBack(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      const updatedAt = nowIso();
      const common = {
        updatedAt,
      };

      if (session.lineOfBusiness === "commercial") {
        if (session.commercialSecondRoundSentAt || session.commercialSupplementalsCompletedAt) {
          const nextQuestions = (session.questionnaireQuestions ?? []).filter(
            (question) => question.round !== "second_round"
          );
          const updated = db.update("quotingSessions", sessionId, {
            ...common,
            questionnaireQuestions: nextQuestions,
            questionnaireMessageId: undefined,
            questionnaireDraft: undefined,
            questionnaireSentAt: undefined,
            replyReceivedAt: undefined,
            commercialSecondRoundSentAt: undefined,
            commercialSupplementalsCompletedAt: undefined,
            missingFields: [],
            quotes: [],
            status: "quoting",
            aiSummary: "AI moved back to carrier response review before sending supplementals.",
          });
          if (updated) {
            logQuotingWorkflowProgress(updated, {
              message: "Commercial quote workflow moved back one step.",
              detail:
                "The supplemental send step was reopened so staff can review carrier follow-up handling again.",
              createdAt: updatedAt,
              createdById: session.createdById,
              source: "agent",
            });
          }
          return updated;
        }

        if (
          session.commercialApplicationSentAt ||
          (session.commercialCarrierSubmissions ?? []).length > 0
        ) {
          const updated = db.update("quotingSessions", sessionId, {
            ...common,
            commercialApplicationSentAt: undefined,
            commercialCarrierSubmissions: [],
            questionnaireMessageId: undefined,
            questionnaireDraft: undefined,
            questionnaireSentAt: undefined,
            replyReceivedAt: undefined,
            quotes: [],
            status: "gathering_info",
            aiSummary: "AI moved back to application review before carrier submission.",
          });
          if (updated) {
            logQuotingWorkflowProgress(updated, {
              message: "Commercial quote workflow moved back one step.",
              detail:
                "The carrier send step was reopened so staff can review the ACORD packet and questionnaire answers again.",
              createdAt: updatedAt,
              createdById: session.createdById,
              source: "agent",
            });
          }
          return updated;
        }

        if (
          session.commercialQuestionnairePreparedAt ||
          (session.questionnaireQuestions ?? []).length > 0
        ) {
          const updated = db.update("quotingSessions", sessionId, {
            ...common,
            commercialQuestionnairePreparedAt: undefined,
            questionnaireQuestions: [],
            questionnaireMessageId: undefined,
            questionnaireDraft: undefined,
            questionnaireSentAt: undefined,
            replyReceivedAt: undefined,
            missingFields: [],
            quotes: [],
            status: "gathering_info",
            aiSummary:
              "AI moved back to the ACORD mapping review before generating the questionnaire.",
          });
          if (updated) {
            logQuotingWorkflowProgress(updated, {
              message: "Commercial quote workflow moved back one step.",
              detail:
                "The commercial questionnaire step was reopened so the AI can regenerate it from the latest ACORD fill audit.",
              createdAt: updatedAt,
              createdById: session.createdById,
              source: "agent",
            });
          }
          return updated;
        }

        logQuotingWorkflowProgress(session, {
          message: "Commercial quote workflow moved back to setup.",
          detail:
            "The initial AI mapping session was closed so staff can adjust policy type or ACORD document selection.",
          createdAt: updatedAt,
          createdById: session.createdById,
          source: "agent",
        });
        db.remove("quotingSessions", sessionId);
        return null;
      }

      if (session.status === "complete" || session.quotes.length > 0) {
        const updated = db.update("quotingSessions", sessionId, {
          ...common,
          quotes: [],
          status: session.questionnaireSentAt ? "awaiting_reply" : "gathering_info",
          aiSummary: "AI moved back before quote ranking.",
        });
        return updated;
      }

      if (session.status === "awaiting_reply" || session.questionnaireSentAt) {
        return db.update("quotingSessions", sessionId, {
          ...common,
          questionnaireMessageId: undefined,
          questionnaireDraft: undefined,
          questionnaireSentAt: undefined,
          replyReceivedAt: undefined,
          status: "gathering_info",
          aiSummary: "AI moved back before sending the questionnaire.",
        });
      }

      if (session.personalQuestionnairePreparedAt) {
        const updated = db.update("quotingSessions", sessionId, {
          ...common,
          personalQuestionnairePreparedAt: undefined,
          status: "gathering_info",
          aiSummary: "AI moved back to the personal-lines mapping review.",
        });
        if (updated) {
          logQuotingWorkflowProgress(updated, {
            message: "Personal quote workflow moved back one step.",
            detail:
              "The questionnaire review step was reopened so staff can inspect the AI mapping again.",
            createdAt: updatedAt,
            createdById: session.createdById,
            source: "agent",
          });
        }
        return updated;
      }

      return session;
    },
    // Discard the session and let the agent start over.
    reset(sessionId: string) {
      const session = this.get(sessionId);
      if (session) {
        logQuotingWorkflowProgress(session, {
          message: "AI quoting workflow was reset by staff.",
          detail: "The prior quoting session was discarded so the agent can restart with updated line, asset, or intake details.",
          createdById: session.createdById,
        });
      }
      db.remove("quotingSessions", sessionId);
    },
  },

  // ------------ Pinned message threads ------------
  // Per-user pins. Scoped to the signed-in user, not shared across
  // the team. Max 5 active pins per user across all thread kinds
  // so the pinned strip at the top of the threads list stays
  // scannable.
  messagePins: {
    MAX_PINS: 5 as const,
    listForUser(tenantId: string, userId: string): MessagePin[] {
      return db
        .list("messagePins")
        .filter((p) => p.tenantId === tenantId && p.userId === userId)
        .sort((a, b) => (a.pinnedAt < b.pinnedAt ? -1 : 1));
    },
    isPinned(
      tenantId: string,
      userId: string,
      kind: MessagePin["kind"],
      refId: string
    ): MessagePin | undefined {
      return db
        .list("messagePins")
        .find(
          (p) =>
            p.tenantId === tenantId &&
            p.userId === userId &&
            p.kind === kind &&
            p.refId === refId
        );
    },
    pin(input: {
      tenantId: string;
      userId: string;
      kind: MessagePin["kind"];
      refId: string;
    }): MessagePin {
      const existing = this.isPinned(
        input.tenantId,
        input.userId,
        input.kind,
        input.refId
      );
      if (existing) return existing;
      const count = this.listForUser(input.tenantId, input.userId).length;
      if (count >= this.MAX_PINS) {
        throw new Error(
          `You already have ${this.MAX_PINS} pinned threads. Unpin one before pinning another.`
        );
      }
      const row: MessagePin = {
        id: uid("pin"),
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        pinnedAt: nowIso(),
      };
      db.insert("messagePins", row);
      return row;
    },
    unpin(
      tenantId: string,
      userId: string,
      kind: MessagePin["kind"],
      refId: string
    ) {
      const existing = this.isPinned(tenantId, userId, kind, refId);
      if (existing) db.remove("messagePins", existing.id);
    },
    countForUser(tenantId: string, userId: string): number {
      return this.listForUser(tenantId, userId).length;
    },
  },

  // Per-user thread mutes — silences a conversation's badge/alerts for
  // the muting user without affecting anyone else.
  messageMutes: {
    isMuted(
      tenantId: string,
      userId: string,
      kind: MessageMute["kind"],
      refId: string
    ): MessageMute | undefined {
      return db
        .list("messageMutes")
        .find(
          (m) =>
            m.tenantId === tenantId &&
            m.userId === userId &&
            m.kind === kind &&
            m.refId === refId
        );
    },
    mute(input: {
      tenantId: string;
      userId: string;
      kind: MessageMute["kind"];
      refId: string;
    }): MessageMute {
      const existing = this.isMuted(
        input.tenantId,
        input.userId,
        input.kind,
        input.refId
      );
      if (existing) return existing;
      const row: MessageMute = {
        id: uid("mute"),
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        mutedAt: nowIso(),
      };
      db.insert("messageMutes", row);
      return row;
    },
    unmute(
      tenantId: string,
      userId: string,
      kind: MessageMute["kind"],
      refId: string
    ) {
      const existing = this.isMuted(tenantId, userId, kind, refId);
      if (existing) db.remove("messageMutes", existing.id);
    },
    toggle(input: {
      tenantId: string;
      userId: string;
      kind: MessageMute["kind"];
      refId: string;
    }) {
      if (this.isMuted(input.tenantId, input.userId, input.kind, input.refId)) {
        this.unmute(input.tenantId, input.userId, input.kind, input.refId);
      } else {
        this.mute(input);
      }
    },
  },

  // Per-user report records for message/content review. Production should
  // store these server-side and route open reports to the agency's manager
  // or compliance queue.
  messageReports: {
    listByTenant(tenantId: string): MessageReport[] {
      return tenantFilter(db.list("messageReports"), tenantId).sort((a, b) =>
        a.reportedAt < b.reportedAt ? 1 : -1
      );
    },
    listOpen(tenantId: string): MessageReport[] {
      return this.listByTenant(tenantId).filter((report) => report.status === "open");
    },
    report(input: {
      tenantId: string;
      userId: string;
      kind: MessageReport["kind"];
      refId: string;
      reason: string;
    }): MessageReport {
      const reason = input.reason.trim() || "Reported from message settings.";
      const row: MessageReport = {
        id: uid("msg_report"),
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        reason,
        status: "open",
        reportedAt: nowIso(),
      };
      db.insert("messageReports", row);
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.userId,
        action: "message.reported",
        entityType: `message_${input.kind}`,
        entityId: input.refId,
        metadata: { reason },
        createdAt: row.reportedAt,
      });
      return row;
    },
    markReviewed(id: string, actorId: string): MessageReport | undefined {
      const updated = db.update("messageReports", id, { status: "reviewed" });
      if (updated) {
        db.insert("audit", {
          id: uid("audit"),
          tenantId: updated.tenantId,
          actorId,
          action: "message_report.reviewed",
          entityType: `message_${updated.kind}`,
          entityId: updated.refId,
          metadata: { reportId: id },
          createdAt: nowIso(),
        });
      }
      return updated ?? undefined;
    },
  },

  // Per-user block records. Blocking does not delete the conversation; it
  // silences notifications and leaves the audit trail intact.
  messageBlocks: {
    isBlocked(
      tenantId: string,
      userId: string,
      kind: MessageBlock["kind"],
      refId: string
    ): MessageBlock | undefined {
      return db
        .list("messageBlocks")
        .find(
          (block) =>
            block.tenantId === tenantId &&
            block.userId === userId &&
            block.kind === kind &&
            block.refId === refId
        );
    },
    block(input: {
      tenantId: string;
      userId: string;
      kind: MessageBlock["kind"];
      refId: string;
    }): MessageBlock {
      const existing = this.isBlocked(input.tenantId, input.userId, input.kind, input.refId);
      if (existing) return existing;
      const row: MessageBlock = {
        id: uid("msg_block"),
        tenantId: input.tenantId,
        userId: input.userId,
        kind: input.kind,
        refId: input.refId,
        blockedAt: nowIso(),
      };
      db.insert("messageBlocks", row);
      api.messageMutes.mute(input);
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.userId,
        action: "message.blocked",
        entityType: `message_${input.kind}`,
        entityId: input.refId,
        createdAt: row.blockedAt,
      });
      return row;
    },
    unblock(
      tenantId: string,
      userId: string,
      kind: MessageBlock["kind"],
      refId: string
    ) {
      const existing = this.isBlocked(tenantId, userId, kind, refId);
      if (existing) db.remove("messageBlocks", existing.id);
      db.insert("audit", {
        id: uid("audit"),
        tenantId,
        actorId: userId,
        action: "message.unblocked",
        entityType: `message_${kind}`,
        entityId: refId,
        createdAt: nowIso(),
      });
    },
    toggle(input: {
      tenantId: string;
      userId: string;
      kind: MessageBlock["kind"];
      refId: string;
    }) {
      if (this.isBlocked(input.tenantId, input.userId, input.kind, input.refId)) {
        this.unblock(input.tenantId, input.userId, input.kind, input.refId);
      } else {
        this.block(input);
      }
    },
  },

  // Suspicious behavior / emergency access control. Production should
  // enforce IP bans at the edge/API layer using the request IP; the demo
  // stores and checks the same policy data client-side so the workflow is
  // visible before the backend is connected.
  security: {
    normalizeIpAddress(input?: string): string {
      return normalizeSecurityIpAddress(input);
    },
    listIncidents(tenantId: string): SecurityIncident[] {
      return tenantFilter(db.list("securityIncidents"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
    },
    listOpenIncidents(tenantId: string): SecurityIncident[] {
      return this.listIncidents(tenantId).filter((incident) => incident.status === "open");
    },
    listBans(tenantId: string, activeOnly = false): SecurityBan[] {
      return tenantFilter(db.list("securityBans"), tenantId)
        .filter((ban) => !activeOnly || ban.active)
        .sort((a, b) => a.createdAt < b.createdAt ? 1 : -1);
    },
    getActiveBanForUser(tenantId: string, userId: string): SecurityBan | undefined {
      return db
        .list("securityBans")
        .find(
          (ban) =>
            ban.tenantId === tenantId &&
            ban.active &&
            ban.kind === "user" &&
            ban.userId === userId
        );
    },
    getActiveBanForIp(tenantId: string, ipAddress?: string): SecurityBan | undefined {
      const normalized = normalizeSecurityIpAddress(ipAddress);
      if (!normalized) return undefined;
      return db
        .list("securityBans")
        .find(
          (ban) =>
            ban.tenantId === tenantId &&
            ban.active &&
            ban.kind === "ip" &&
            normalizeSecurityIpAddress(ban.ipAddress) === normalized
        );
    },
    accessBlockFor(input: {
      tenantId?: string | null;
      userId?: string;
      ipAddress?: string;
    }): SecurityBan | undefined {
      if (!input.tenantId) return undefined;
      if (input.userId) {
        const userBan = this.getActiveBanForUser(input.tenantId, input.userId);
        if (userBan) return userBan;
      }
      return this.getActiveBanForIp(input.tenantId, input.ipAddress);
    },
    flag(input: {
      tenantId: string;
      reportedById: string;
      subjectKind?: SecuritySubjectKind;
      subjectUserId?: string;
      subjectLabel?: string;
      ipAddress?: string;
      severity?: SecurityIncidentSeverity;
      reason: string;
    }): SecurityIncident {
      const actor = api.users.get(input.reportedById);
      const subjectUser = input.subjectUserId ? api.users.get(input.subjectUserId) : undefined;
      const createdAt = nowIso();
      const row: SecurityIncident = {
        id: uid("sec_incident"),
        tenantId: input.tenantId,
        reportedById: input.reportedById,
        reportedByName: actor?.name,
        subjectKind: input.subjectKind ?? securitySubjectKindForUser(subjectUser),
        subjectUserId: input.subjectUserId,
        subjectLabel: input.subjectLabel?.trim() || subjectUser?.name || input.ipAddress?.trim() || "Unknown subject",
        ipAddress: normalizeSecurityIpAddress(input.ipAddress) || undefined,
        severity: input.severity ?? "medium",
        reason: input.reason.trim() || "Suspicious behavior flagged for review.",
        status: "open",
        createdAt,
      };
      db.insert("securityIncidents", row);
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.reportedById,
        action: "security.incident_flagged",
        entityType: "security_incident",
        entityId: row.id,
        metadata: {
          severity: row.severity,
          subjectKind: row.subjectKind,
          subjectUserId: row.subjectUserId,
          ipAddress: row.ipAddress,
          reason: row.reason,
        },
        createdAt,
      });
      return row;
    },
    updateIncidentStatus(
      id: string,
      status: SecurityIncidentStatus,
      reviewedById: string
    ): SecurityIncident | undefined {
      const updated = db.update("securityIncidents", id, {
        status,
        reviewedAt: nowIso(),
        reviewedById,
      });
      if (updated) {
        db.insert("audit", {
          id: uid("audit"),
          tenantId: updated.tenantId,
          actorId: reviewedById,
          action: `security.incident_${status}`,
          entityType: "security_incident",
          entityId: id,
          createdAt: nowIso(),
        });
      }
      return updated ?? undefined;
    },
    banUser(input: {
      tenantId: string;
      userId: string;
      createdById: string;
      reason: string;
      incidentId?: string;
    }): SecurityBan | null {
      const target = api.users.get(input.userId);
      if (!target || target.tenantId !== input.tenantId) return null;
      const existing = this.getActiveBanForUser(input.tenantId, input.userId);
      if (existing) return existing;
      const actor = api.users.get(input.createdById);
      const createdAt = nowIso();
      const row: SecurityBan = {
        id: uid("sec_ban"),
        tenantId: input.tenantId,
        kind: "user",
        userId: input.userId,
        subjectLabel: target.name,
        reason: input.reason.trim() || "User banned by agency security control.",
        createdById: input.createdById,
        createdByName: actor?.name,
        incidentId: input.incidentId,
        active: true,
        createdAt,
      };
      db.insert("securityBans", row);
      api.users.update(input.userId, {
        active: false,
        staffAccessStatus: "banned",
        staffAccessUpdatedAt: createdAt,
        staffAccessUpdatedById: input.createdById,
      });
      if (input.incidentId) {
        db.update("securityIncidents", input.incidentId, {
          resultingBanId: row.id,
          status: "reviewed",
          reviewedAt: createdAt,
          reviewedById: input.createdById,
        });
      }
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.createdById,
        action: "security.user_banned",
        entityType: "user",
        entityId: input.userId,
        metadata: { banId: row.id, reason: row.reason, incidentId: input.incidentId },
        createdAt,
      });
      return row;
    },
    banIp(input: {
      tenantId: string;
      ipAddress: string;
      createdById: string;
      reason: string;
      incidentId?: string;
    }): SecurityBan | null {
      const ipAddress = normalizeSecurityIpAddress(input.ipAddress);
      if (!ipAddress) return null;
      const existing = this.getActiveBanForIp(input.tenantId, ipAddress);
      if (existing) return existing;
      const actor = api.users.get(input.createdById);
      const createdAt = nowIso();
      const row: SecurityBan = {
        id: uid("sec_ban"),
        tenantId: input.tenantId,
        kind: "ip",
        ipAddress,
        subjectLabel: ipAddress,
        reason: input.reason.trim() || "IP address banned by agency security control.",
        createdById: input.createdById,
        createdByName: actor?.name,
        incidentId: input.incidentId,
        active: true,
        createdAt,
      };
      db.insert("securityBans", row);
      if (input.incidentId) {
        db.update("securityIncidents", input.incidentId, {
          resultingBanId: row.id,
          status: "reviewed",
          reviewedAt: createdAt,
          reviewedById: input.createdById,
        });
      }
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.createdById,
        action: "security.ip_banned",
        entityType: "ip_address",
        entityId: ipAddress,
        metadata: { banId: row.id, reason: row.reason, incidentId: input.incidentId },
        createdAt,
      });
      return row;
    },
    revokeBan(id: string, revokedById: string): SecurityBan | undefined {
      const existing = db.list("securityBans").find((ban) => ban.id === id);
      if (!existing) return undefined;
      const updated = db.update("securityBans", id, {
        active: false,
        revokedAt: nowIso(),
        revokedById,
      });
      if (updated) {
        db.insert("audit", {
          id: uid("audit"),
          tenantId: updated.tenantId,
          actorId: revokedById,
          action: "security.ban_revoked",
          entityType: updated.kind === "user" ? "user" : "ip_address",
          entityId: updated.userId ?? updated.ipAddress ?? id,
          metadata: { banId: id, reason: updated.reason },
          createdAt: nowIso(),
        });
      }
      return updated ?? undefined;
    },
  },

  // ------------ E-signature requirements ------------
  // Documents can be tagged as requiring a customer signature, an
  // agent signature, or both. Tagging is metadata only: it does not
  // email the customer or create Activity Center work. Explicit
  // send/request helpers below handle those dispatch steps.
  esign: {
    // Customer-side packets that have been emailed but not signed yet.
    listAwaitingCustomerSignature(tenantId: string): Document[] {
      return db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !!d.customerEsignRequired &&
            !!d.customerEsignSentAt &&
            !d.customerEsignSignedAt
        )
        .sort((a, b) => (a.customerEsignSentAt! < b.customerEsignSentAt! ? 1 : -1));
    },
    // Agent-side docs that have been tagged but not yet signed by
    // the agent.
    listAwaitingAgentSignature(tenantId: string): Document[] {
      return db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !!d.agentEsignRequired &&
            !d.agentEsignSignedAt
        )
        .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    },
    // Flip the customer / agent e-sign requirement on a doc. Used by
    // the manager Documents page row controls. Turning a side off
    // clears dispatch/signing metadata for that side so the flag can
    // be re-enabled cleanly later.
    setRequirements(
      documentId: string,
      patch: {
        customerEsignRequired?: boolean;
        agentEsignRequired?: boolean;
        agentEsignAssignedToId?: string;
      }
    ): Document | null {
      const normalized: Partial<Document> = { ...patch };
      if (patch.customerEsignRequired === false) {
        normalized.customerEsignSentAt = undefined;
        normalized.customerEsignSignedAt = undefined;
        normalized.esignCommunicationId = undefined;
      }
      if (patch.agentEsignRequired === false) {
        normalized.agentEsignSignedAt = undefined;
        normalized.agentEsignTaskId = undefined;
        normalized.agentEsignAssignedToId = undefined;
      }
      return db.update("documents", documentId, normalized);
    },
    // Make sure every upcoming renewal has at least one customer-
    // facing e-sign doc on file (renewal packet). Real wiring would
    // pull from the carrier portal; the demo synthesizes a PDF so
    // there's something to e-sign.
    seedRenewalPackets(tenantId: string, actorId?: string): Document[] {
      const renewals = db
        .list("renewals")
        .filter((r) => r.tenantId === tenantId && r.status === "upcoming");
      const created: Document[] = [];
      renewals.forEach((r) => {
        const policy = db.list("policies").find((p) => p.id === r.policyId);
        if (!policy) return;
        const customer = db
          .list("customers")
          .find((c) => c.id === policy.customerId);
        if (!customer) return;
        const policyDocs = db
          .list("documents")
          .filter((d) => d.policyId === policy.id);
        const alreadyHas = policyDocs.some(
          (d) => d.customerEsignRequired && !d.customerEsignSignedAt
        );
        if (alreadyHas) return;
        const synthetic: Document = {
          id: uid("doc"),
          tenantId,
          uploadedById: actorId ?? "ai",
          fileName: `${(policy.policyNumber ?? "Policy").toString()}-renewal-packet.pdf`,
          fileType: "application/pdf",
          type: "endorsement_document",
          visibility: "customer_visible",
          status: "approved",
          storagePath: `synthetic/${policy.id}/renewal-packet.pdf`,
          customerId: customer.id,
          policyId: policy.id,
          uploadedAt: nowIso(),
          customerEsignRequired: true,
        };
        db.insert("documents", synthetic);
        created.push(synthetic);
      });
      return created;
    },
    // CUSTOMER side: emails any tagged-and-unsent doc to the client.
    // Batches one email per customer no matter how many of their
    // docs are pending.
    autoSendCustomerPackets(
      tenantId: string,
      actorId?: string,
      portalUrl?: string
    ): { sent: { customer: CustomerProfile; documents: Document[] }[] } {
      const pending = db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !!d.customerEsignRequired &&
            !d.customerEsignSentAt &&
            !!d.customerId
        );
      const byCustomer = new Map<
        string,
        { customer: CustomerProfile; documents: Document[] }
      >();
      pending.forEach((d) => {
        const customer = db
          .list("customers")
          .find((c) => c.id === d.customerId);
        if (!customer) return;
        const bucket = byCustomer.get(customer.id) ?? {
          customer,
          documents: [],
        };
        bucket.documents.push(d);
        byCustomer.set(customer.id, bucket);
      });
      const sentBuckets: { customer: CustomerProfile; documents: Document[] }[] = [];
      for (const { customer, documents } of byCustomer.values()) {
        const firstName = customer.name.split(/\s+/)[0];
        const lines = documents.map((d) => `  • ${d.fileName}`).join("\n");
        const subject =
          documents.length === 1
            ? "A document is ready for your e-signature"
            : `${documents.length} documents are ready for your e-signature`;
        const body = [
          `Hi ${firstName},`,
          ``,
          `We have ${documents.length === 1 ? "a document" : `${documents.length} documents`} that need your e-signature to keep your coverage in good standing:`,
          ``,
          lines,
          ``,
          portalUrl
            ? `Sign in to your client portal and tap E-sign on each document to apply your signature:\n${portalUrl}`
            : `Sign in to your client portal under Documents to apply your e-signature.`,
          ``,
          `Reply to this thread if anything looks off and we'll regenerate.`,
        ].join("\n");
        const comm = api.communications.create({
          tenantId,
          customerId: customer.id,
          channel: "email",
          direction: "outbound",
          subject,
          body,
          createdById: actorId,
        });
        const sentAt = nowIso();
        documents.forEach((d) => {
          db.update("documents", d.id, {
            customerEsignSentAt: sentAt,
            esignCommunicationId: comm.id,
          });
        });
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId,
          source: "ai",
          message: `AI auto-sent ${documents.length} e-sign packet${documents.length === 1 ? "" : "s"} to ${customer.name}.`,
          visibility: "internal",
          customerId: customer.id,
          createdAt: sentAt,
          createdById: actorId,
        });
        sentBuckets.push({ customer, documents });
      }
      return { sent: sentBuckets };
    },
    // AGENT side: spawns an Activity Center task per doc tagged
    // agentEsignRequired that doesn't already have one. Assigns to
    // the agent named on the doc (or the related customer's primary
    // assigned agent as a fallback).
    autoCreateAgentEsignTasks(
      tenantId: string,
      actorId?: string
    ): { created: { task: Task; document: Document }[] } {
      const pending = db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !!d.agentEsignRequired &&
            !d.agentEsignSignedAt &&
            !d.agentEsignTaskId
        );
      const created: { task: Task; document: Document }[] = [];
      pending.forEach((d) => {
        const customer = d.customerId
          ? db.list("customers").find((c) => c.id === d.customerId)
          : null;
        const inheritedOwnerIds = d.agentEsignAssignedToId
          ? []
          : assignedContactOwners(customer);
        const assignedToId = d.agentEsignAssignedToId ?? inheritedOwnerIds[0];
        const taskId = uid("task");
        const taskRow: Task = {
          id: taskId,
          tenantId,
          title: `E-sign required: ${d.fileName}`,
          description: customer
            ? `${customer.name}'s record needs your signature on ${d.fileName}.`
            : `${d.fileName} needs your signature to move forward.`,
          customerId: d.customerId,
          source: "ai_notification",
          severity: "warning",
          severityReason: "Document waiting on agent e-signature.",
          status: "open",
          assignedToId,
          additionalAssignedToIds:
            !d.agentEsignAssignedToId && inheritedOwnerIds.length > 1
              ? inheritedOwnerIds.slice(1)
              : undefined,
          awaitingManagerAssignment: assignedToId ? undefined : true,
          createdById: actorId,
          createdAt: nowIso(),
        };
        db.insert("tasks", taskRow);
        db.update("documents", d.id, { agentEsignTaskId: taskId });
        created.push({ task: taskRow, document: d });
      });
      return { created };
    },
    // Explicit maintenance driver. Seeds renewal packets, then runs
    // both dispatch helpers in series. The app does not call this
    // merely because a manager tagged a document as requiring e-sign.
    runAll(
      tenantId: string,
      actorId?: string,
      portalUrl?: string
    ): {
      seeded: Document[];
      customerSent: { customer: CustomerProfile; documents: Document[] }[];
      agentTasks: { task: Task; document: Document }[];
    } {
      const seeded = this.seedRenewalPackets(tenantId, actorId);
      const { sent } = this.autoSendCustomerPackets(tenantId, actorId, portalUrl);
      const { created } = this.autoCreateAgentEsignTasks(tenantId, actorId);
      return { seeded, customerSent: sent, agentTasks: created };
    },
    // Client portal hook — customer signed off on a doc. Stamps
    // customerEsignSignedAt, spawns an Activity Center task for
    // the customer's assigned agent, and writes an internal-
    // visibility status event so the timestamped sign-off shows
    // up in the merged Activity timeline & remarks card.
    markCustomerSigned(documentId: string): Document | null {
      const doc = db.list("documents").find((d) => d.id === documentId);
      if (!doc) return null;
      const signedAt = nowIso();
      // Signing auto-files the executed copy: approve it + keep it
      // customer-visible so it lands in the client's Documents (and
      // counts toward the missing-docs set) with no manual upload.
      const updated = db.update("documents", documentId, {
        customerEsignSignedAt: signedAt,
        status: "approved",
        visibility: "customer_visible",
      });
      const customer = doc.customerId
        ? db.list("customers").find((c) => c.id === doc.customerId)
        : null;
      // Status event on the timeline (internal-visibility — staff-
      // only, this is the audit trail). Surfaces under "Activity
      // timeline & client remarks".
      if (customer) {
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: doc.tenantId,
          source: "customer",
          message: `${customer.name} e-signed ${doc.fileName} — executed copy filed to their documents automatically.`,
          visibility: "internal",
          customerId: customer.id,
          createdAt: signedAt,
        });
      }
      // Notify the assigned agent — Activity Center task lands in
      // their queue so they see the signed doc when they come back.
      const assignedToId = customer?.assignedAgentId;
      if (customer && assignedToId) {
        db.insert("tasks", {
          id: uid("task"),
          tenantId: doc.tenantId,
          title: `${customer.name} e-signed ${doc.fileName}`,
          description: `The customer signed off on the document; review the executed copy under their record.`,
          customerId: customer.id,
          source: "ai_notification",
          severity: "info",
          severityReason: "Customer just completed an e-signature.",
          status: "open",
          assignedToId,
          createdById: "ai",
          createdAt: signedAt,
        });
      }
      return updated;
    },
    // Agent portal hook — agent signed off on a doc. Also resolves
    // the spawned task so it drops off the Activity Center queue.
    markAgentSigned(documentId: string, actorId?: string) {
      const doc = db.list("documents").find((d) => d.id === documentId);
      if (!doc) return null;
      const actor = actorId ? db.list("users").find((u) => u.id === actorId) : null;
      const signature = actor?.electronicSignature;
      const updated = db.update("documents", documentId, {
        agentEsignSignedAt: nowIso(),
        agentEsignSignatureName: signature?.name,
        agentEsignSignatureFont: signature?.fontFamily,
        agentEsignSignatureSize: signature?.fontSize,
      });
      if (updated && actor) {
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: doc.tenantId,
          source: "agent",
          message: `${actor.name} e-signed ${doc.fileName}; saved electronic signature was applied to the document record.`,
          visibility: "internal",
          customerId: doc.customerId,
          assetId: doc.assetId,
          policyId: doc.policyId,
          claimId: doc.claimId,
          documentId: doc.id,
          createdAt: updated.agentEsignSignedAt ?? nowIso(),
          createdById: actor.id,
        });
      }
      if (doc.agentEsignTaskId) {
        db.update("tasks", doc.agentEsignTaskId, {
          status: "resolved",
          completedAt: nowIso(),
          completedById: actorId,
        });
      }
      return updated;
    },
    applySavedAgentSignature(documentId: string, actorId: string): Document | null {
      const actor = db.list("users").find((u) => u.id === actorId);
      if (!actor?.electronicSignature?.name?.trim()) return null;
      return this.markAgentSigned(documentId, actorId);
    },
    applySavedAgentSignatureToPending(
      tenantId: string,
      actorId: string
    ): Document[] {
      const actor = db.list("users").find((u) => u.id === actorId);
      if (!actor?.electronicSignature?.name?.trim()) return [];
      const pending = db
        .list("documents")
        .filter(
          (d) =>
            d.tenantId === tenantId &&
            !!d.agentEsignRequired &&
            !d.agentEsignSignedAt &&
            (!d.agentEsignAssignedToId || d.agentEsignAssignedToId === actorId)
        );
      return pending
        .map((d) => this.markAgentSigned(d.id, actorId))
        .filter((d): d is Document => !!d);
    },
  },

  // ------------ Misc helpers ------------
  helpers: {
    assetTypeLabel(t: AssetType): string {
      const map: Record<AssetType, string> = {
        coastal_home: "Coastal Home",
        luxury_vehicle: "Luxury Vehicle",
        yacht: "Yacht",
        jewelry: "Jewelry",
        umbrella_liability: "Umbrella Liability",
        full_portfolio: "Full Portfolio",
        other: "Other",
      };
      return map[t];
    },
    // Short human-friendly identifier shown on agent/manager
    // surfaces. Prefers an explicit clientCode when the manager
    // set one; otherwise derives a compact code from the customer
    // id ("CL-XXXXXX"). Stable across page loads since it's
    // computed from the same persistent id.
    clientCodeFor(customer?: { id: string; clientCode?: string } | null): string {
      if (!customer) return "—";
      if (customer.clientCode) return customer.clientCode;
      return `CL-${customer.id.slice(-6).toUpperCase()}`;
    },
    // Department line a policy belongs to. Defaults to "personal"
    // for the private-client demo book; carriers we ship target
    // personal lines exclusively. The field is settable per policy
    // for tenants who write commercial-lines business as well.
    departmentLabel(p?: { department?: "personal" | "commercial" } | null): string {
      const v = p?.department ?? "personal";
      return v === "commercial" ? "Commercial Lines" : "Personal Lines";
    },
    // Human label for a DocumentType slug. Falls back to a
    // title-cased version of the slug so custom tenant types still
    // render reasonably.
    documentTypeLabel(type: string): string {
      const map: Record<string, string> = {
        driver_license: "Driver's license",
        ssn_documentation: "SSN documentation",
        proof_of_insurance: "Proof of insurance",
        asset_information: "Asset information",
        policy_document: "Policy document",
        declarations_page: "Declarations page",
        insurance_id_card: "Insurance ID card",
        policy_booklet: "Policy booklet / forms",
        endorsement_document: "Endorsement document",
        deposit_receipt: "Deposit receipt",
        payment_receipt: "Payment receipt",
        appraisal: "Appraisal",
        wind_mitigation: "Wind mitigation",
        inspection_report: "Inspection report",
        carrier_appetite_guide: "Carrier appetite guide",
        underwriting_manual: "Underwriting manual",
        claim_document: "Claim document",
        cancellation_notice: "Cancellation / lapse notice",
        carrier_correspondence: "Carrier correspondence",
        agency_template: "Agency template / form",
        other: "Other",
      };
      return map[type] ?? type.replace(/_/g, " ");
    },
    documentDisplayName(doc: { type: string; documentName?: string }): string {
      return doc.documentName?.trim() || api.helpers.documentTypeLabel(doc.type);
    },
    // Cadence shown on the policy summary card. Frequency is
    // optional on Policy so the helper returns "—" when unset.
    paymentFrequencyLabel(f?: string): string {
      const map: Record<string, string> = {
        monthly: "Monthly",
        quarterly: "Quarterly",
        semi_annual: "Semi-annual",
        annual: "Annual",
      };
      return f ? map[f] ?? f : "—";
    },
    // Fire an internal-visibility status event so we have a
    // tamper-evident audit trail of which customer (or staff)
    // downloaded which policy document and when. The customer
    // doesn't see this event on their timeline — visibility=internal.
    logDocumentDownload(input: {
      tenantId: string;
      documentId: string;
      actorId?: string;
      actorRole?: Role;
      customerId?: string;
      policyId?: string;
      assetId?: string;
      fileName?: string;
    }) {
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: input.actorRole === "customer" ? "customer" : "system",
        message: `Document downloaded${input.fileName ? `: ${input.fileName}` : ""} by ${
          input.actorRole ?? "user"
        }${input.actorId ? ` (${input.actorId})` : ""}.`,
        visibility: "internal",
        customerId: input.customerId,
        policyId: input.policyId,
        assetId: input.assetId,
        documentId: input.documentId,
        createdAt: nowIso(),
        createdById: input.actorId,
      });
      db.insert("audit", {
        id: uid("audit"),
        tenantId: input.tenantId,
        actorId: input.actorId ?? "anonymous",
        action: "document.download",
        entityType: "document",
        entityId: input.documentId,
        metadata: {
          fileName: input.fileName,
          customerId: input.customerId,
          policyId: input.policyId,
        },
        createdAt: nowIso(),
      });
    },
  },
};
