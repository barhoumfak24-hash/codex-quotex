// =====================================================================
// Mock data store — localStorage backed, mirrors what the backend API
// would return. The intent is that swapping `db` for real `fetch` calls
// against `/api/...` requires changing only `src/lib/api.ts`.
// =====================================================================

import * as seed from "./seed";
import { apiBaseUrl, envValue } from "./apiBase";
import { serverSessionHeaders } from "./serverSession";
import { isLargeInlineDataUrl, storeStateBlob } from "./stateBlobs";
import {
  generateAgencyCode,
  normalizeAgencyCode,
  protectAgencyCode,
  revealProtectedAgencyCode,
} from "./credentials";
import {
  addMonthsToDateInput,
  agencyPlanTermMonths,
  dateInputFromIso,
  isoFromDateInput,
} from "./agencyContract";
import { ensureWebsiteConnection } from "./websiteConnection";
import { inferMailProvider } from "./mailProvider";
import { isStaleMasterAccount } from "./masterAccount";
import type {
  Agency,
  AccountingSettings,
  Branch,
  BookImportBatch,
  AiNotification,
  Asset,
  AuditLog,
  CalendarEvent,
  Carrier,
  CarrierAgencyLink,
  CarrierDownload,
  CarrierRunnerJob,
  CarrierContact,
  ConnectedMailbox,
  CategoryAgencyLink,
  Claim,
  Communication,
  CustomDocumentType,
  CustomMessage,
  DemoLead,
  CustomerProfile,
  Deposit,
  Document,
  InsuranceCategory,
  InsuranceLineOfBusiness,
  HrSubmission,
  MarketingCampaign,
  MarketingConfig,
  MarketingMessage,
  Note,
  Payment,
  Policy,
  InternalMessage,
  InternalThread,
  MailboxOutboxJob,
  MessageBlock,
  MessagePin,
  MessageReport,
  MessageMute,
  MasterAgencyActivity,
  Prospect,
  QuoteRequest,
  QuotingSession,
  Reminder,
  Renewal,
  SecurityBan,
  SecurityIncident,
  SoftwareSale,
  StatusEvent,
  Task,
  Timesheet,
  User,
} from "@/types";

// Bump this whenever DbShape gets a new table that older localStorage caches
// won't have, so visitors automatically get the fresh seed.
const STORAGE_KEY = "quotex.db.v32";
const CRITICAL_STORAGE_KEY = `${STORAGE_KEY}.critical`;
const QUOTE_WORKFLOW_STORAGE_KEY = `${STORAGE_KEY}.quote-workflows`;
const LEGACY_KEYS = ["quotex.db.v1", "quotex.db.v2", "quotex.db.v3", "quotex.db.v4", "quotex.db.v5", "quotex.db.v6", "quotex.db.v7", "quotex.db.v8", "quotex.db.v9", "quotex.db.v10", "quotex.db.v11", "quotex.db.v12", "quotex.db.v13", "quotex.db.v14", "quotex.db.v15", "quotex.db.v16", "quotex.db.v17", "quotex.db.v18", "quotex.db.v19", "quotex.db.v20", "quotex.db.v21", "quotex.db.v22", "quotex.db.v23", "quotex.db.v24", "quotex.db.v25", "quotex.db.v26", "quotex.db.v27", "quotex.db.v28", "quotex.db.v29", "quotex.db.v30", "quotex.db.v31"];
// Every table that can contain agency-entered or workflow-generated data is
// treated as recoverable. Refreshing, deploying a new bundle, or bumping the
// local schema version must never silently fall back to seed data and hide real
// in-app state.
const CRITICAL_TABLES: (keyof DbShape)[] = [
  "agencies",
  "branches",
  "users",
  "customers",
  "assets",
  "policies",
  "quoteRequests",
  "prospects",
  "carriers",
  "carrierLinks",
  "carrierDownloads",
  "carrierRunnerJobs",
  "carrierContacts",
  "deposits",
  "payments",
  "renewals",
  "claims",
  "campaigns",
  "messages",
  "categoryLinks",
  "categories",
  "customMessages",
  "customDocumentTypes",
  "quotingSessions",
  "importBatches",
  "communications",
  "connectedMailboxes",
  "documents",
  "notes",
  "statusEvents",
  "tasks",
  "aiNotifications",
  "mailboxOutbox",
  "softwareSales",
  "masterAgencyActivities",
  "securityIncidents",
  "securityBans",
  "accountingSettings",
  "timesheets",
  "hrSubmissions",
  "calendarEvents",
  "deletedRows",
];

interface DeletedRow {
  id: string;
  table: string;
  rowId: string;
  deletedAt: string;
}

export type SyncStatusKind = "synced" | "saving" | "error" | "local-only";
export type SyncErrorReason =
  | "unauthorized"
  | "not_configured"
  | "too_large"
  | "network"
  | "conflict"
  | "local_quota"
  | "unknown";

export interface SyncStatus {
  status: SyncStatusKind;
  reason?: SyncErrorReason;
  message?: string;
  updatedAt: string;
}

const CARRIER_AGENT_SIGN_IN_URLS: Record<string, string> = {
  carrier_chubb: "https://www.chubb.com/us-en/agents-brokers.html",
  carrier_pure: "https://www.pureinsurance.com/member-login",
  carrier_aig: "https://www.aig.com/business/insurance/login",
  carrier_cincinnati_home: "https://www.cinfin.com/agents",
  carrier_vault: "https://www.vault.insurance/insurance-agents",
  carrier_berkley_one: "https://www.berkleyone.com/insurance-professionals/",
  carrier_crestbrook: "https://www.nationwide.com/personal/insurance/private-client/",
  carrier_hagerty: "https://www.hagertyagent.com/",
  carrier_markel: "https://www.markel.com/insurance/agents-and-brokers",
  carrier_natgen_premier: "https://www.nationalgeneral.com/agent/",
  carrier_travelers: "https://www.travelers.com/agents/login",
  carrier_liberty: "https://business.libertymutual.com",
  carrier_safeco: "https://www.safeco.com/agent-resources",
  carrier_hartford: "https://www.thehartford.com/agents-producers",
  carrier_nationwide: "https://www.agentcenter.nationwide.com",
  carrier_progressive: "https://progressivecommercial.com/agent-login/",
  carrier_allstate: "https://agents.allstate.com",
  carrier_farmers: "https://agents.farmers.com",
  carrier_statefarm: "https://b2b.statefarm.com",
  carrier_usaa: "https://www.usaa.com/inet/wc/insurance-products",
  carrier_autoowners: "https://www.auto-owners.com/agency-services/ao-access",
  carrier_erie: "https://www.erieinsurance.com/agents",
  carrier_mercury: "https://www.mercuryinsurance.com/agents/",
  carrier_amfam: "https://www.amfam.com/agents",
  carrier_foremost: "https://www.foremost.com/agents/",
  carrier_stillwater: "https://www.stillwaterinsurance.com/agents/",
  carrier_plymouth_rock: "https://www.plymouthrock.com/agents",
  carrier_kemper: "https://www.kemper.com/agents",
  carrier_westfield: "https://www.westfieldinsurance.com/agents",
  carrier_amtrust: "https://amtrustfinancial.com/agents",
  carrier_auto_club_group: "https://www.aaa.com/insurance",
  carrier_michigan_farm_bureau: "https://www.michfb.com/insurance",
  carrier_frankenmuth: "https://www.fmins.com/agents",
  carrier_hanover_citizens: "https://www.hanover.com/agents",
  carrier_pioneer_state_mutual: "https://www.psmic.com/agents",
  carrier_hastings_mutual: "https://www.hastingsmutual.com/agents",
  carrier_fremont: "https://www.fmic.com/agents",
  carrier_michigan_insurance_company: "https://www.michiganinsurance.com/agent",
  carrier_secura: "https://www.secura.net/agents",
  carrier_grange: "https://www.grangeinsurance.com/agents",
  carrier_west_bend: "https://www.thesilverlining.com/agents",
  carrier_meemic: "https://www.meemic.com",
};

interface DbShape {
  agencies: Agency[];
  branches: Branch[];
  users: User[];
  importBatches: BookImportBatch[];
  customers: CustomerProfile[];
  assets: Asset[];
  policies: Policy[];
  quoteRequests: QuoteRequest[];
  prospects: Prospect[];
  carriers: Carrier[];
  carrierLinks: CarrierAgencyLink[];
  carrierDownloads: CarrierDownload[];
  carrierRunnerJobs: CarrierRunnerJob[];
  carrierContacts: CarrierContact[];
  deposits: Deposit[];
  payments: Payment[];
  documents: Document[];
  statusEvents: StatusEvent[];
  campaigns: MarketingCampaign[];
  messages: MarketingMessage[];
  renewals: Renewal[];
  claims: Claim[];
  notes: Note[];
  communications: Communication[];
  connectedMailboxes: ConnectedMailbox[];
  mailboxOutbox: MailboxOutboxJob[];
  audit: AuditLog[];
  categories: InsuranceCategory[];
  categoryLinks: CategoryAgencyLink[];
  customMessages: CustomMessage[];
  customDocumentTypes: CustomDocumentType[];
  aiNotifications: AiNotification[];
  tasks: Task[];
  marketingConfigs: MarketingConfig[];
  reminders: Reminder[];
  internalThreads: InternalThread[];
  internalMessages: InternalMessage[];
  messagePins: MessagePin[];
  messageMutes: MessageMute[];
  messageReports: MessageReport[];
  messageBlocks: MessageBlock[];
  securityIncidents: SecurityIncident[];
  securityBans: SecurityBan[];
  quotingSessions: QuotingSession[];
  demoLeads: DemoLead[];
  softwareSales: SoftwareSale[];
  masterAgencyActivities: MasterAgencyActivity[];
  accountingSettings: AccountingSettings[];
  timesheets: Timesheet[];
  hrSubmissions: HrSubmission[];
  calendarEvents: CalendarEvent[];
  deletedRows: DeletedRow[];
}

function freshSeed(): DbShape {
  return {
    agencies: structuredClone(seed.SEED_AGENCIES),
    branches: [],
    users: structuredClone(seed.SEED_USERS),
    importBatches: [],
    customers: structuredClone(seed.SEED_CUSTOMERS),
    assets: structuredClone(seed.SEED_ASSETS),
    policies: structuredClone(seed.SEED_POLICIES),
    quoteRequests: structuredClone(seed.SEED_QUOTE_REQUESTS),
    prospects: structuredClone(seed.SEED_PROSPECTS),
    carriers: structuredClone(seed.SEED_CARRIERS),
    carrierLinks: structuredClone(seed.SEED_CARRIER_LINKS),
    carrierDownloads: structuredClone(seed.SEED_CARRIER_DOWNLOADS),
    carrierRunnerJobs: structuredClone(seed.SEED_CARRIER_RUNNER_JOBS),
    carrierContacts: structuredClone(seed.SEED_CARRIER_CONTACTS),
    deposits: structuredClone(seed.SEED_DEPOSITS),
    payments: structuredClone(seed.SEED_PAYMENTS),
    documents: structuredClone(seed.SEED_DOCUMENTS),
    statusEvents: structuredClone(seed.SEED_STATUS),
    campaigns: structuredClone(seed.SEED_CAMPAIGNS),
    messages: structuredClone(seed.SEED_MESSAGES),
    renewals: structuredClone(seed.SEED_RENEWALS),
    claims: structuredClone(seed.SEED_CLAIMS),
    notes: structuredClone(seed.SEED_NOTES),
    communications: structuredClone(seed.SEED_COMMUNICATIONS),
    connectedMailboxes: [],
    mailboxOutbox: [],
    audit: [],
    categories: structuredClone(seed.SEED_CATEGORIES),
    categoryLinks: structuredClone(seed.SEED_CATEGORY_LINKS),
    customMessages: [],
    customDocumentTypes: [],
    aiNotifications: [],
    tasks: [],
    marketingConfigs: [],
    reminders: [],
    internalThreads: [],
    internalMessages: [],
    messagePins: [],
    messageMutes: [],
    messageReports: [],
    messageBlocks: [],
    securityIncidents: [],
    securityBans: [],
    quotingSessions: [],
    demoLeads: [],
    softwareSales: [],
    masterAgencyActivities: structuredClone(seed.SEED_MASTER_AGENCY_ACTIVITIES),
    accountingSettings: [],
    timesheets: [],
    hrSubmissions: [],
    calendarEvents: [],
    deletedRows: [],
  };
}

function withAgencyCodes(data: DbShape): DbShape {
  const used = new Set<string>();
  data.agencies = data.agencies.map((agency) => {
    const normalized = normalizeAgencyCode(revealProtectedAgencyCode(agency) ?? "");
    const agencyCode =
      normalized && !used.has(normalized)
        ? normalized
        : generateAgencyCode(agency.name, used);
    used.add(agencyCode);
    const { agencyCode: _legacyAgencyCode, ...rest } = agency;
    return { ...rest, ...protectAgencyCode(agencyCode) };
  });
  return data;
}

function withoutStaleMasterAccounts(data: DbShape): DbShape {
  data.users = (data.users ?? []).filter((user) => !isStaleMasterAccount(user));
  return data;
}

function withAgencyWebsiteConnections(data: DbShape): DbShape {
  data.agencies = data.agencies.map((agency) => ensureWebsiteConnection(agency));
  return data;
}

function withAgencyContractDefaults(data: DbShape): DbShape {
  const seedById = new Map(seed.SEED_AGENCIES.map((agency) => [agency.id, agency]));
  data.agencies = data.agencies.map((agency) => {
    const seeded = seedById.get(agency.id);
    const termMonths = agencyPlanTermMonths({
      ...agency,
      softwarePlanTermMonths: agency.softwarePlanTermMonths ?? seeded?.softwarePlanTermMonths,
    });
    const startedAt =
      agency.softwarePlanStartedAt ?? seeded?.softwarePlanStartedAt ?? agency.createdAt;
    const renewsAt =
      agency.softwarePlanRenewsAt ??
      seeded?.softwarePlanRenewsAt ??
      isoFromDateInput(addMonthsToDateInput(dateInputFromIso(startedAt), termMonths));
    return {
      ...agency,
      softwarePlanTermMonths: termMonths,
      softwarePlanStartedAt: startedAt,
      softwarePlanRenewsAt: renewsAt,
    };
  });
  return data;
}

function withCarrierDownloadRunnerDefaults(data: DbShape): DbShape {
  data.carrierRunnerJobs ??= [];
  const seedById = new Map(seed.SEED_AGENCIES.map((agency) => [agency.id, agency]));
  data.agencies = data.agencies.map((agency) => {
    const seeded = seedById.get(agency.id);
    return {
      ...agency,
      carrierRunnerEnabled:
        agency.carrierRunnerEnabled ??
        seeded?.carrierRunnerEnabled ??
        agency.ivansDownloadEnabled ??
        seeded?.ivansDownloadEnabled ??
        false,
      carrierRunnerStatus:
        agency.carrierRunnerStatus ??
        seeded?.carrierRunnerStatus ??
        agency.ivansConnectionStatus ??
        seeded?.ivansConnectionStatus ??
        ((agency.carrierRunnerEnabled ?? agency.ivansDownloadEnabled) ? "pending_setup" : "not_configured"),
      carrierRunnerMode:
        agency.carrierRunnerMode ?? seeded?.carrierRunnerMode ?? "ai_portal_runner",
      carrierRunnerAgencyCode:
        agency.carrierRunnerAgencyCode ?? seeded?.carrierRunnerAgencyCode ?? agency.ivansAgencyAccount ?? seeded?.ivansAgencyAccount,
      carrierRunnerProfileId:
        agency.carrierRunnerProfileId ?? seeded?.carrierRunnerProfileId ?? agency.ivansMailboxId ?? seeded?.ivansMailboxId,
      carrierRunnerReceiverCode:
        agency.carrierRunnerReceiverCode ?? seeded?.carrierRunnerReceiverCode ?? agency.ivansReceiverCode ?? seeded?.ivansReceiverCode,
      carrierRunnerCredentialVaultRef:
        agency.carrierRunnerCredentialVaultRef ??
        seeded?.carrierRunnerCredentialVaultRef ??
        agency.ivansCredentialReference ??
        seeded?.ivansCredentialReference,
      carrierRunnerMfaMode:
        agency.carrierRunnerMfaMode ?? seeded?.carrierRunnerMfaMode ?? "staff_approval",
      carrierRunnerAuthorizedUserIds:
        agency.carrierRunnerAuthorizedUserIds ?? seeded?.carrierRunnerAuthorizedUserIds ?? [],
      carrierRunnerLinesOfBusiness:
        agency.carrierRunnerLinesOfBusiness ??
        seeded?.carrierRunnerLinesOfBusiness ??
        agency.ivansLinesOfBusiness ??
        seeded?.ivansLinesOfBusiness ??
        ["personal"],
      carrierRunnerFeeds:
        agency.carrierRunnerFeeds ??
        seeded?.carrierRunnerFeeds ??
        agency.ivansDownloadFeeds ??
        seeded?.ivansDownloadFeeds ??
        ["policy", "renewal", "billing", "edocs"],
      carrierRunnerCarrierIds:
        agency.carrierRunnerCarrierIds ??
        seeded?.carrierRunnerCarrierIds ??
        agency.ivansTradingPartnerIds ??
        seeded?.ivansTradingPartnerIds ??
        [],
      carrierRunnerReviewRule:
        agency.carrierRunnerReviewRule ??
        seeded?.carrierRunnerReviewRule ??
        "require_review_for_material_changes",
      carrierRunnerSchedule:
        agency.carrierRunnerSchedule ??
        seeded?.carrierRunnerSchedule ??
        agency.ivansPollingSchedule ??
        seeded?.ivansPollingSchedule ??
        "as_available",
      carrierRunnerWorkingPath:
        agency.carrierRunnerWorkingPath ?? seeded?.carrierRunnerWorkingPath ?? agency.ivansInboundPath ?? seeded?.ivansInboundPath,
      carrierRunnerArchivePath:
        agency.carrierRunnerArchivePath ?? seeded?.carrierRunnerArchivePath ?? agency.ivansArchivePath ?? seeded?.ivansArchivePath,
      carrierRunnerFailureAlertEmails:
        agency.carrierRunnerFailureAlertEmails ??
        seeded?.carrierRunnerFailureAlertEmails ??
        agency.ivansErrorAlertEmails ??
        seeded?.ivansErrorAlertEmails ??
        [],
      carrierRunnerContactEmail:
        agency.carrierRunnerContactEmail ?? seeded?.carrierRunnerContactEmail ?? agency.ivansContactEmail ?? seeded?.ivansContactEmail,
      carrierRunnerContactPhone:
        agency.carrierRunnerContactPhone ?? seeded?.carrierRunnerContactPhone ?? agency.ivansContactPhone ?? seeded?.ivansContactPhone,
      carrierRunnerNotes:
        agency.carrierRunnerNotes ?? seeded?.carrierRunnerNotes ?? agency.ivansNotes ?? seeded?.ivansNotes,
      carrierRunnerLastTestAt:
        agency.carrierRunnerLastTestAt ?? seeded?.carrierRunnerLastTestAt ?? agency.ivansTestFileReceivedAt ?? seeded?.ivansTestFileReceivedAt,
      carrierRunnerLastTestStatus:
        agency.carrierRunnerLastTestStatus ??
        seeded?.carrierRunnerLastTestStatus ??
        agency.ivansLastTestStatus ??
        seeded?.ivansLastTestStatus ??
        "not_tested",
      carrierRunnerLastTestMessage:
        agency.carrierRunnerLastTestMessage ?? seeded?.carrierRunnerLastTestMessage ?? agency.ivansLastTestMessage ?? seeded?.ivansLastTestMessage,
      carrierRunnerLastSyncAt:
        agency.carrierRunnerLastSyncAt ?? seeded?.carrierRunnerLastSyncAt ?? agency.ivansLastSyncAt ?? seeded?.ivansLastSyncAt,
      carrierRunnerUpdatedAt:
        agency.carrierRunnerUpdatedAt ?? seeded?.carrierRunnerUpdatedAt ?? agency.ivansUpdatedAt ?? seeded?.ivansUpdatedAt,
      ivansDownloadEnabled: agency.ivansDownloadEnabled ?? seeded?.ivansDownloadEnabled ?? false,
      ivansConnectionStatus:
        agency.ivansConnectionStatus ??
        seeded?.ivansConnectionStatus ??
        (agency.ivansDownloadEnabled ? "pending_setup" : "not_configured"),
      ivansAgencyAccount: agency.ivansAgencyAccount ?? seeded?.ivansAgencyAccount,
      ivansMailboxId: agency.ivansMailboxId ?? seeded?.ivansMailboxId,
      ivansReceiverCode: agency.ivansReceiverCode ?? seeded?.ivansReceiverCode,
      ivansDownloadMethod:
        agency.ivansDownloadMethod ?? seeded?.ivansDownloadMethod ?? "ivans_exchange",
      ivansCredentialReference:
        agency.ivansCredentialReference ?? seeded?.ivansCredentialReference,
      ivansLinesOfBusiness:
        agency.ivansLinesOfBusiness ?? seeded?.ivansLinesOfBusiness ?? ["personal"],
      ivansDownloadFeeds:
        agency.ivansDownloadFeeds ?? seeded?.ivansDownloadFeeds ?? ["policy", "renewal", "billing", "edocs"],
      ivansTradingPartnerIds:
        agency.ivansTradingPartnerIds ?? seeded?.ivansTradingPartnerIds ?? [],
      ivansFileFormats:
        agency.ivansFileFormats ?? seeded?.ivansFileFormats ?? ["acord_al3", "pdf_edoc"],
      ivansPollingSchedule:
        agency.ivansPollingSchedule ?? seeded?.ivansPollingSchedule ?? "as_available",
      ivansInboundPath: agency.ivansInboundPath ?? seeded?.ivansInboundPath,
      ivansArchivePath: agency.ivansArchivePath ?? seeded?.ivansArchivePath,
      ivansErrorAlertEmails:
        agency.ivansErrorAlertEmails ?? seeded?.ivansErrorAlertEmails ?? [],
      ivansContactEmail: agency.ivansContactEmail ?? seeded?.ivansContactEmail,
      ivansContactPhone: agency.ivansContactPhone ?? seeded?.ivansContactPhone,
      ivansNotes: agency.ivansNotes ?? seeded?.ivansNotes,
      ivansTestFileReceivedAt:
        agency.ivansTestFileReceivedAt ?? seeded?.ivansTestFileReceivedAt,
      ivansLastTestStatus:
        agency.ivansLastTestStatus ?? seeded?.ivansLastTestStatus ?? "not_tested",
      ivansLastTestMessage:
        agency.ivansLastTestMessage ?? seeded?.ivansLastTestMessage,
      ivansLastSyncAt: agency.ivansLastSyncAt ?? seeded?.ivansLastSyncAt,
      ivansUpdatedAt: agency.ivansUpdatedAt ?? seeded?.ivansUpdatedAt,
    };
  });
  return data;
}

function withCarrierRunnerMigrations(data: DbShape): DbShape {
  const seedById = new Map(seed.SEED_AGENCIES.map((agency) => [agency.id, agency]));

  data.agencies = (data.agencies ?? []).map((agency) => {
    const seeded = seedById.get(agency.id);
    if (!seeded) return agency;
    const legacyText = (value?: string) => /ivans|mailbox/i.test(value ?? "");
    const legacyCarrierIds = (agency.carrierRunnerCarrierIds ?? []).some((id) =>
      /naic|ivans/i.test(id)
    );
    return {
      ...agency,
      carrierRunnerSchedule:
        agency.carrierRunnerSchedule === "manual"
          ? "manual"
          : "as_available",
      carrierRunnerAgencyCode: legacyText(agency.carrierRunnerAgencyCode)
        ? seeded.carrierRunnerAgencyCode
        : agency.carrierRunnerAgencyCode,
      carrierRunnerProfileId: legacyText(agency.carrierRunnerProfileId)
        ? seeded.carrierRunnerProfileId
        : agency.carrierRunnerProfileId,
      carrierRunnerCredentialVaultRef: legacyText(agency.carrierRunnerCredentialVaultRef)
        ? seeded.carrierRunnerCredentialVaultRef
        : agency.carrierRunnerCredentialVaultRef,
      carrierRunnerWorkingPath: legacyText(agency.carrierRunnerWorkingPath)
        ? seeded.carrierRunnerWorkingPath
        : agency.carrierRunnerWorkingPath,
      carrierRunnerArchivePath: legacyText(agency.carrierRunnerArchivePath)
        ? seeded.carrierRunnerArchivePath
        : agency.carrierRunnerArchivePath,
      carrierRunnerCarrierIds: legacyCarrierIds
        ? seeded.carrierRunnerCarrierIds
        : agency.carrierRunnerCarrierIds,
    };
  });

  data.masterAgencyActivities = (data.masterAgencyActivities ?? []).map((activity) => {
    if ((activity.kind as string) !== "agency_ivans_connection_updated") return activity;
    return {
      ...activity,
      kind: "agency_carrier_runner_updated",
      title: "Carrier download runner setup added",
      description:
        "Carrier portal runner credentials reference, MFA approver, enabled carriers, feeds, and alert contacts were recorded for policy, renewal, billing, claims, and eDoc updates.",
      metadata: {
        ...(activity.metadata ?? {}),
        status: activity.metadata?.status ?? "pending_setup",
      },
    };
  });

  data.carrierDownloads = (data.carrierDownloads ?? []).map((download) =>
    download.source === "ivans" ? { ...download, source: "carrier_runner" } : download
  );

  return data;
}

function withMailboxConnectionDefaults(data: DbShape): DbShape {
  data.connectedMailboxes ??= [];
  const now = new Date().toISOString();
  const existing = new Map(data.connectedMailboxes.map((mailbox) => [mailbox.id, mailbox]));

  data.users
    .filter(
      (user) =>
        !!user.tenantId &&
        user.active &&
        (user.role === "agent" || user.role === "manager" || user.role === "csr")
    )
    .forEach((user) => {
      const address = (user.businessEmail ?? user.email).trim().toLowerCase();
      if (!address) return;
      const id = `mailbox_staff_${user.id}`;
      const current = existing.get(id);
      const provider = user.mailProvider ?? inferMailProvider(address);
      if (!current) {
        data.connectedMailboxes.push({
          id,
          tenantId: user.tenantId!,
          ownerType: "staff",
          userId: user.id,
          address,
          provider,
          displayName: user.name,
          status: "needs_auth",
          authMode: "oauth",
          scopes: [],
          updatedAt: now,
        });
        return;
      }
      if (current.authMode === "demo" || current.status === "connected" && !current.tokenVaultRef) {
        current.address = address;
        current.provider = provider;
        current.displayName = user.name;
        current.status = "needs_auth";
        current.authMode = "oauth";
        current.scopes = [];
        delete current.connectedAt;
        current.updatedAt = now;
      }
    });

  data.agencies.forEach((agency) => {
    const address = agency.contactEmail.trim().toLowerCase();
    if (!address) return;
    const id = `mailbox_agency_marketing_${agency.id}`;
    const current = existing.get(id);
    const provider = inferMailProvider(address);
    if (!current) {
      data.connectedMailboxes.push({
        id,
        tenantId: agency.id,
        ownerType: "agency_marketing",
        agencyId: agency.id,
        address,
        provider,
        displayName: `${agency.name} Marketing`,
        status: "needs_auth",
        authMode: "oauth",
        scopes: [],
        updatedAt: now,
      });
      return;
    }
    if (current.authMode === "demo" || current.status === "connected" && !current.tokenVaultRef) {
      current.address = address;
      current.provider = provider;
      current.displayName = `${agency.name} Marketing`;
      current.status = "needs_auth";
      current.authMode = "oauth";
      current.scopes = [];
      delete current.connectedAt;
      current.updatedAt = now;
    }
  });

  return data;
}

function withCarrierLibraryDefaults(data: DbShape): DbShape {
  data.carriers ??= [];
  data.carrierLinks ??= [];
  data.carrierContacts ??= [];

  const seededCarriersById = new Map(seed.SEED_CARRIERS.map((carrier) => [carrier.id, carrier]));
  data.carriers = data.carriers.map((carrier) => {
    const seeded = seededCarriersById.get(carrier.id);
    const agentPortalUrl =
      carrier.agentPortalUrl ??
      seeded?.agentPortalUrl ??
      CARRIER_AGENT_SIGN_IN_URLS[carrier.id];
    const quotingAutomation = carrier.quotingAutomation
      ? {
          ...carrier.quotingAutomation,
          agentPortalUrl:
            carrier.quotingAutomation.agentPortalUrl ??
            seeded?.quotingAutomation?.agentPortalUrl ??
            agentPortalUrl,
        }
      : seeded?.quotingAutomation
      ? {
          ...seeded.quotingAutomation,
          agentPortalUrl: seeded.quotingAutomation.agentPortalUrl ?? agentPortalUrl,
        }
      : undefined;
    return {
      ...carrier,
      agentPortalUrl,
      ...(quotingAutomation ? { quotingAutomation } : {}),
    };
  });

  const existingCarrierIds = new Set(data.carriers.map((carrier) => carrier.id));
  for (const carrier of seed.SEED_CARRIERS) {
    if (!existingCarrierIds.has(carrier.id)) {
      const freshCarrier = structuredClone(carrier);
      freshCarrier.agentPortalUrl =
        freshCarrier.agentPortalUrl ?? CARRIER_AGENT_SIGN_IN_URLS[freshCarrier.id];
      if (freshCarrier.quotingAutomation) {
        freshCarrier.quotingAutomation.agentPortalUrl =
          freshCarrier.quotingAutomation.agentPortalUrl ?? freshCarrier.agentPortalUrl;
      }
      data.carriers.push(freshCarrier);
      existingCarrierIds.add(carrier.id);
    }
  }

  const existingLinkKeys = new Set(
    data.carrierLinks.map((link) => `${link.tenantId}:${link.carrierId}`)
  );
  for (const link of seed.SEED_CARRIER_LINKS) {
    const key = `${link.tenantId}:${link.carrierId}`;
    if (!existingLinkKeys.has(key)) {
      data.carrierLinks.push(structuredClone(link));
      existingLinkKeys.add(key);
    }
  }

  const existingContactIds = new Set(data.carrierContacts.map((contact) => contact.id));
  for (const contact of seed.SEED_CARRIER_CONTACTS) {
    if (!existingContactIds.has(contact.id)) {
      data.carrierContacts.push(structuredClone(contact));
      existingContactIds.add(contact.id);
    }
  }

  return data;
}

function withCategoryLibraryDefaults(data: DbShape): DbShape {
  data.categories ??= [];
  data.categoryLinks ??= [];

  const seededById = new Map(seed.SEED_CATEGORIES.map((category) => [category.id, category]));
  const normalizedCategories: InsuranceCategory[] = [];
  const seenCategoryIds = new Set<string>();
  for (const category of data.categories) {
    if (seenCategoryIds.has(category.id)) continue;
    seenCategoryIds.add(category.id);
    const seeded = seededById.get(category.id);
    const existingLine = (category as InsuranceCategory & { lineOfBusiness?: InsuranceLineOfBusiness })
      .lineOfBusiness;
    normalizedCategories.push({
      ...category,
      lineOfBusiness: existingLine ?? seeded?.lineOfBusiness ?? "personal",
      sortOrder: category.sortOrder ?? seeded?.sortOrder ?? 9999,
      active: category.active ?? true,
    });
  }
  data.categories = normalizedCategories;

  const existingCategoryIds = new Set(data.categories.map((category) => category.id));
  for (const category of seed.SEED_CATEGORIES) {
    if (!existingCategoryIds.has(category.id)) {
      data.categories.push(structuredClone(category));
      existingCategoryIds.add(category.id);
    }
  }

  const linksByKey = new Map<string, CategoryAgencyLink>();
  for (const link of data.categoryLinks) {
    const key = `${link.tenantId}:${link.categoryId}`;
    const existing = linksByKey.get(key);
    if (!existing) {
      linksByKey.set(key, link);
      continue;
    }
    linksByKey.set(key, {
      ...existing,
      active: existing.active || link.active,
      createdAt: existing.createdAt < link.createdAt ? existing.createdAt : link.createdAt,
    });
  }
  data.categoryLinks = [...linksByKey.values()];

  const existingLinkKeys = new Set(
    data.categoryLinks.map((link) => `${link.tenantId}:${link.categoryId}`)
  );
  for (const link of seed.SEED_CATEGORY_LINKS) {
    const key = `${link.tenantId}:${link.categoryId}`;
    if (!existingLinkKeys.has(key)) {
      data.categoryLinks.push(structuredClone(link));
      existingLinkKeys.add(key);
    }
  }

  return data;
}

function isAcordAgencyTemplate(document: Document): boolean {
  return (
    String(document.type) === "agency_template" &&
    (/^doc_acord_/i.test(document.id) ||
      /\bacord\b/i.test(`${document.fileName} ${document.documentName ?? ""}`))
  );
}

function currentAcordTemplateSeeds(): Document[] {
  return seed.SEED_DOCUMENTS.filter(isAcordAgencyTemplate);
}

function hasCurrentAcordTemplateDefaults(data: DbShape): boolean {
  const currentAcordTemplates = currentAcordTemplateSeeds();
  const currentById = new Map(currentAcordTemplates.map((document) => [document.id, document]));
  const existingAcordTemplates = (data.documents ?? []).filter(isAcordAgencyTemplate);
  const existingById = new Map(existingAcordTemplates.map((document) => [document.id, document]));
  return currentAcordTemplates.every((current) => {
    const existing = existingById.get(current.id);
    return (
      existing?.fileName === current.fileName &&
      existing.storagePath === current.storagePath &&
      existing.downloadUrl === current.downloadUrl
    );
  });
}

function withAcordTemplateDefaults(data: DbShape): DbShape {
  data.documents ??= [];
  if (hasCurrentAcordTemplateDefaults(data)) return data;
  const currentAcordTemplates = currentAcordTemplateSeeds();
  const currentAcordTemplateIds = new Set(currentAcordTemplates.map((document) => document.id));
  data.documents = data.documents.filter((document) => !currentAcordTemplateIds.has(document.id));
  data.documents.unshift(...structuredClone(currentAcordTemplates));
  return data;
}

function withBillingDefaults(data: DbShape): DbShape {
  const inTenDays = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const inFortyFiveDays = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
  const verifiedRecently = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const verifiedThisWeek = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const chubb = data.carriers.find((carrier) => carrier.id === "carrier_chubb");
  if (chubb) {
    chubb.billingPortalUrl ??= "https://www.chubb.com/us-en/agents-brokers.html";
    chubb.billingPhone ??= "+1 (800) 699-9916";
    chubb.billingEmail ??= "billing@chubb.example";
  }
  const pure = data.carriers.find((carrier) => carrier.id === "carrier_pure");
  if (pure) {
    pure.billingPortalUrl ??= "https://www.pureinsurance.com/member-login";
    pure.billingPhone ??= "+1 (888) 813-7873";
    pure.billingEmail ??= "billing@pureinsurance.example";
  }

  const home = data.policies.find((policy) => policy.id === "policy_home");
  if (home && !home.billingMethod) {
    Object.assign(home, {
      billingMethod: "direct_bill",
      billingPayer: "client",
      billingStatus: "current",
      billingAccountNumber: "CHB-BILL-558920",
      billingReference: "Direct bill schedule Q3",
      billingLastVerifiedAt: verifiedRecently,
      billingNotes: "Client pays Chubb directly. Agency tracks due dates and receipts only.",
      nextPaymentDueDate: inTenDays,
      nextPaymentAmount: 4_487,
    } satisfies Partial<Policy>);
  }

  const vehicle = data.policies.find((policy) => policy.id === "policy_vehicle");
  if (vehicle && !vehicle.billingMethod) {
    Object.assign(vehicle, {
      billingMethod: "carrier_autopay",
      billingPayer: "client",
      billingStatus: "current",
      billingAccountNumber: "PURE-BILL-441188",
      billingReference: "Autopay on file with carrier",
      billingLastVerifiedAt: verifiedThisWeek,
      billingNotes: "Carrier autopay confirmed. No agency collection action required.",
      nextPaymentDueDate: inFortyFiveDays,
      nextPaymentAmount: 3_025,
    } satisfies Partial<Policy>);
  }

  if (!data.payments.some((payment) => payment.id === "payment_vehicle_1")) {
    data.payments.push({
      id: "payment_vehicle_1",
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      policyId: "policy_vehicle",
      amount: 3_025,
      currency: "USD",
      method: "ach",
      status: "paid",
      paidAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  return data;
}

function withStaffAdministrationDefaults(data: DbShape): DbShape {
  data.accountingSettings ??= [];
  data.timesheets ??= [];
  data.hrSubmissions ??= [];
  data.calendarEvents ??= [];

  const now = Date.now();
  const isoDaysAgo = (days: number) =>
    new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const isoDaysAhead = (days: number) =>
    new Date(now + days * 24 * 60 * 60 * 1000).toISOString();

  for (const agency of data.agencies) {
    const defaultRecipientIds = data.users
      .filter((user) => user.tenantId === agency.id && user.active && user.role === "agent")
      .map((user) => user.id);
    const existing = data.accountingSettings.find((settings) => settings.tenantId === agency.id);
    if (existing && !Array.isArray(existing.timesheetRecipientIds)) {
      existing.timesheetRecipientIds = defaultRecipientIds;
    }
    if (!existing) {
      data.accountingSettings.push({
        id: `acct_settings_${agency.id}`,
        tenantId: agency.id,
        timesheetFrequency: "weekly",
        dueWeekday: 5,
        dueDayOfMonth: 28,
        reminderTime: "09:00",
        timesheetRecipientIds: defaultRecipientIds,
        updatedAt: isoDaysAgo(14),
      });
    }
  }

  if (!data.timesheets.some((timesheet) => timesheet.id === "timesheet_olivia_last_week")) {
    data.timesheets.push({
      id: "timesheet_olivia_last_week",
      tenantId: "agency_palmcoast",
      userId: "user_agent_pc",
      periodStart: isoDaysAgo(10),
      periodEnd: isoDaysAgo(4),
      dueDate: isoDaysAgo(3),
      status: "submitted",
      entries: [
        {
          id: "timesheet_entry_olivia_service",
          workDate: isoDaysAgo(9),
          startTime: "09:00",
          endTime: "17:30",
          breakMinutes: 30,
          hours: 8,
          category: "service",
          description: "Client service, renewal prep, and carrier follow-up.",
        },
        {
          id: "timesheet_entry_olivia_marketing",
          workDate: isoDaysAgo(8),
          startTime: "09:30",
          endTime: "16:00",
          breakMinutes: 30,
          hours: 6,
          category: "marketing",
          description: "Reviewed prospect outreach and AI campaign responses.",
        },
      ],
      totalHours: 14,
      notes: "Submitted for manager review.",
      submittedAt: isoDaysAgo(2),
      createdAt: isoDaysAgo(10),
      updatedAt: isoDaysAgo(2),
    });
  }

  if (!data.hrSubmissions.some((submission) => submission.id === "hr_suggestion_demo")) {
    data.hrSubmissions.push({
      id: "hr_suggestion_demo",
      tenantId: "agency_palmcoast",
      kind: "suggestion",
      anonymous: false,
      submittedById: "user_agent_pc",
      subject: "Standardize renewal handoff notes",
      message:
        "It would help if every renewal handoff included the same checklist for missing docs, premium changes, and carrier contact.",
      status: "new",
      submittedAt: isoDaysAhead(-1),
    });
  }

  if (!data.calendarEvents.some((event) => event.id === "calendar_event_book_review")) {
    const startsAt = new Date(now + 2 * 24 * 60 * 60 * 1000);
    startsAt.setHours(10, 30, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setMinutes(endsAt.getMinutes() + 45);
    data.calendarEvents.push({
      id: "calendar_event_book_review",
      tenantId: "agency_palmcoast",
      userId: "user_agent_pc",
      title: "Book review prep",
      description: "Review open renewals and high-priority client follow-ups before the manager meeting.",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      importance: "warning",
      location: "Agency office",
      createdAt: isoDaysAgo(1),
      updatedAt: isoDaysAgo(1),
    });
  }

  const firstOpenTask = data.tasks.find(
    (task) => task.tenantId === "agency_palmcoast" && !task.completedAt && !task.dueAt
  );
  if (firstOpenTask) {
    const due = new Date(now + 24 * 60 * 60 * 1000);
    due.setHours(16, 0, 0, 0);
    firstOpenTask.dueAt = due.toISOString();
  }

  return data;
}

function withDefaultMigrations(data: DbShape): DbShape {
  return withoutStaleMasterAccounts(
    withCarrierRunnerMigrations(
      withMailboxConnectionDefaults(
        withStaffAdministrationDefaults(
          withBillingDefaults(
            withAcordTemplateDefaults(
              withCategoryLibraryDefaults(
                withCarrierLibraryDefaults(
                  withCarrierDownloadRunnerDefaults(
                    withAgencyContractDefaults(withAgencyWebsiteConnections(withAgencyCodes(data)))
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

function latestLegacySnapshotRaw(): string | null {
  if (typeof window === "undefined") return null;
  for (let i = LEGACY_KEYS.length - 1; i >= 0; i -= 1) {
    const raw = window.localStorage.getItem(LEGACY_KEYS[i]);
    if (raw) return raw;
  }
  return null;
}

function removeLegacySnapshots() {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
}

function load(): DbShape {
  if (typeof window === "undefined") {
    return withDefaultMigrations(freshSeed());
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? latestLegacySnapshotRaw();
    const critical =
      normalizeCriticalSnapshot(window.sessionStorage.getItem(CRITICAL_STORAGE_KEY)) ??
      normalizeCriticalSnapshot(window.localStorage.getItem(CRITICAL_STORAGE_KEY));
    const quoteWorkflows =
      normalizeQuoteWorkflowSnapshot(window.sessionStorage.getItem(QUOTE_WORKFLOW_STORAGE_KEY)) ??
      normalizeQuoteWorkflowSnapshot(window.localStorage.getItem(QUOTE_WORKFLOW_STORAGE_KEY));
    if (!raw) {
      const fresh = mergeQuoteWorkflowSnapshot(
        mergeCriticalSnapshot(withDefaultMigrations(freshSeed()), critical),
        quoteWorkflows
      );
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      removeLegacySnapshots();
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    // Fill in any tables added since the cache was written.
    const fresh = freshSeed();
    const migrated = mergeQuoteWorkflowSnapshot(
      mergeCriticalSnapshot(
        withDefaultMigrations({ ...fresh, ...parsed } as DbShape),
        critical
      ),
      quoteWorkflows
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    removeLegacySnapshots();
    return migrated;
  } catch {
    const critical =
      typeof window === "undefined"
        ? null
        : normalizeCriticalSnapshot(window.sessionStorage.getItem(CRITICAL_STORAGE_KEY)) ??
          normalizeCriticalSnapshot(window.localStorage.getItem(CRITICAL_STORAGE_KEY));
    const quoteWorkflows =
      typeof window === "undefined"
        ? null
        : normalizeQuoteWorkflowSnapshot(window.sessionStorage.getItem(QUOTE_WORKFLOW_STORAGE_KEY)) ??
          normalizeQuoteWorkflowSnapshot(window.localStorage.getItem(QUOTE_WORKFLOW_STORAGE_KEY));
    return mergeQuoteWorkflowSnapshot(
      mergeCriticalSnapshot(withDefaultMigrations(freshSeed()), critical),
      quoteWorkflows
    );
  }
}

let cache: DbShape = load();
let remoteHydrated = false;
let remoteLoadedOk = false;
let remoteHydrating = false;
let remoteDirtyDuringHydrate = false;
let remoteWriteTimer: ReturnType<typeof setTimeout> | undefined;
let remoteRetryTimer: ReturnType<typeof setTimeout> | undefined;
let remoteRetryIndex = 0;
let remoteRevision: number | null = null;
let remotePersistPromise: Promise<boolean> | undefined;
let remoteDirtyDuringPersist = false;
let externalSyncStarted = false;
let dbChangeChannel: BroadcastChannel | undefined;
const DB_CHANGE_CHANNEL = `${STORAGE_KEY}.changes`;
const DB_INSTANCE_ID = Math.random().toString(36).slice(2);
const ACTIVE_DB_INSTANCE_KEY = "__quotexActiveDbInstanceId";
const REMOTE_LIVE_SYNC_INTERVAL_MS = 2500;
const REMOTE_WRITE_DEBOUNCE_MS = 300;
const REMOTE_RETRY_DELAYS_MS = [1000, 2000, 5000, 15000, 60000];
const REMOTE_SNAPSHOT_WARN_BYTES = 1.5 * 1024 * 1024;
const LOCAL_CACHE_INLINE_DATA_URL_WARN_BYTES = 150_000;
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function activateDbInstance() {
  if (typeof window === "undefined") return;
  (window as Window & { __quotexActiveDbInstanceId?: string })[ACTIVE_DB_INSTANCE_KEY] =
    DB_INSTANCE_ID;
}

function isActiveDbInstance() {
  if (typeof window === "undefined") return true;
  return (
    (window as Window & { __quotexActiveDbInstanceId?: string })[ACTIVE_DB_INSTANCE_KEY] ===
    DB_INSTANCE_ID
  );
}

activateDbInstance();

let syncStatus: SyncStatus = {
  status: remoteSyncEnabled() ? "saving" : "local-only",
  reason: remoteSyncEnabled() ? undefined : "not_configured",
  message: remoteSyncEnabled() ? "Saving changes." : "Cloud backup is not connected in this environment.",
  updatedAt: new Date().toISOString(),
};

type SyncStatusListener = (status: SyncStatus) => void;
const syncStatusListeners = new Set<SyncStatusListener>();

function remoteSyncEnabled(): boolean {
  return envValue("VITE_STATE_SYNC_MODE") === "supabase";
}

function remoteApiBase(): string {
  return apiBaseUrl();
}

function remoteStateId(): string {
  return envValue("VITE_STATE_SYNC_ID") || "default";
}

function remoteHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    ...serverSessionHeaders(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function setSyncStatus(next: Omit<SyncStatus, "updatedAt">) {
  syncStatus = { ...next, updatedAt: nowIso() };
  syncStatusListeners.forEach((listener) => {
    try {
      listener(syncStatus);
    } catch {
      /* sync status listeners must not break persistence */
    }
  });
}

function syncFailureReason(status: number, fallback: SyncErrorReason = "unknown"): SyncErrorReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 503) return "not_configured";
  return fallback;
}

function isNewerIso(candidate: string | undefined, current: string | undefined) {
  if (!candidate) return false;
  if (!current) return true;
  return candidate > current;
}

function newestIso(...values: (string | undefined)[]) {
  return values.filter(Boolean).sort().at(-1) ?? nowIso();
}

function stampInsertedRow<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const now = nowIso();
  const next = { ...(row as Record<string, unknown>) };
  if (typeof next.createdAt !== "string" || !next.createdAt) next.createdAt = now;
  next.updatedAt = newestIso(typeof next.updatedAt === "string" ? next.updatedAt : undefined, now);
  return next as T;
}

function stampUpdatedRow<T>(current: T, patch: Partial<T>): T {
  const now = nowIso();
  const merged = { ...(current as Record<string, unknown>), ...(patch as Record<string, unknown>) };
  const currentUpdatedAt = typeof (current as Record<string, unknown>).updatedAt === "string"
    ? ((current as Record<string, unknown>).updatedAt as string)
    : undefined;
  const patchUpdatedAt = typeof (patch as Record<string, unknown>).updatedAt === "string"
    ? ((patch as Record<string, unknown>).updatedAt as string)
    : undefined;
  merged.updatedAt = newestIso(currentUpdatedAt, patchUpdatedAt, now);
  return merged as T;
}

function normalizeRemoteSnapshot(value: unknown): DbShape | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fresh = freshSeed();
  return withDefaultMigrations({ ...fresh, ...(value as Partial<DbShape>) } as DbShape);
}

function normalizeLocalSnapshot(raw: string | null): DbShape | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    const fresh = freshSeed();
    return withDefaultMigrations({ ...fresh, ...parsed } as DbShape);
  } catch {
    return null;
  }
}

function criticalSnapshot(data: DbShape): Partial<DbShape> {
  const out: Partial<DbShape> = {};
  const writeable = out as Record<keyof DbShape, unknown>;
  CRITICAL_TABLES.forEach((table) => {
    writeable[table] = data[table];
  });
  return out;
}

function quoteWorkflowSnapshot(data: DbShape): Pick<DbShape, "quotingSessions"> {
  return {
    quotingSessions: data.quotingSessions,
  };
}

function normalizeQuoteWorkflowSnapshot(raw: string | null): QuotingSession[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Pick<DbShape, "quotingSessions">>;
    return Array.isArray(parsed.quotingSessions) ? parsed.quotingSessions : null;
  } catch {
    return null;
  }
}

function normalizeCriticalSnapshot(raw: string | null): Partial<DbShape> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    const out: Partial<DbShape> = {};
    const writeable = out as Record<keyof DbShape, unknown>;
    CRITICAL_TABLES.forEach((table) => {
      const rows = parsed[table];
      if (Array.isArray(rows)) writeable[table] = rows;
    });
    return out;
  } catch {
    return null;
  }
}

function mergeCriticalSnapshot(data: DbShape, critical: Partial<DbShape> | null): DbShape {
  if (!critical) return data;
  const merged = { ...data } as DbShape;
  const writeable = merged as Record<keyof DbShape, unknown>;
  CRITICAL_TABLES.forEach((table) => {
    const criticalRows = critical[table] as unknown;
    if (!Array.isArray(criticalRows)) return;
    writeable[table] =
      table === "deletedRows"
        ? mergeTombstones(criticalRows as DeletedRow[], merged.deletedRows)
        : mergeRows(
            criticalRows as { id?: string }[],
            merged[table] as unknown as { id?: string }[]
          );
  });
  return withDefaultMigrations(applyTombstones(merged));
}

function mergeQuoteWorkflowSnapshot(
  data: DbShape,
  quoteWorkflows: QuotingSession[] | null
): DbShape {
  if (!quoteWorkflows || quoteWorkflows.length === 0) return data;
  return withDefaultMigrations({
    ...data,
    quotingSessions: mergeRows(quoteWorkflows, data.quotingSessions),
  });
}

function rowSyncStamp(row: unknown) {
  const value = row as {
    updatedAt?: string;
    lastTouchedAt?: string;
    submittedAt?: string;
    createdAt?: string;
    completedAt?: string;
  };
  return value.updatedAt ?? value.lastTouchedAt ?? value.submittedAt ?? value.completedAt ?? value.createdAt ?? "";
}

function tombstoneId(table: string, id: string) {
  return `${table}:${id}`;
}

function purgeOldTombstones(rows: DeletedRow[], now = Date.now()) {
  return rows.filter((row) => {
    const deletedAt = Date.parse(row.deletedAt);
    return Number.isNaN(deletedAt) || now - deletedAt < TOMBSTONE_TTL_MS;
  });
}

function mergeRows<T extends { id?: string }>(localRows: T[], remoteRows: T[]): T[] {
  const byId = new Map<string, T>();
  const noIdRows: T[] = [];
  const upsert = (row: T) => {
    if (!row.id) {
      noIdRows.push(row);
      return;
    }
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      return;
    }
    const currentStamp = rowSyncStamp(current);
    const nextStamp = rowSyncStamp(row);
    byId.set(row.id, nextStamp >= currentStamp ? row : current);
  };
  remoteRows.forEach(upsert);
  localRows.forEach(upsert);
  return [...byId.values(), ...noIdRows];
}

function mergeTombstones(localRows: DeletedRow[] = [], remoteRows: DeletedRow[] = []): DeletedRow[] {
  return purgeOldTombstones(mergeRows(localRows, remoteRows));
}

function applyTombstones(data: DbShape): DbShape {
  const next = { ...data, deletedRows: mergeTombstones(data.deletedRows ?? [], []) } as DbShape;
  const writeable = next as Record<keyof DbShape, unknown>;
  const retainedTombstones: DeletedRow[] = [];

  for (const tombstone of next.deletedRows) {
    if (!tombstone.table || tombstone.table === "deletedRows") {
      retainedTombstones.push(tombstone);
      continue;
    }
    const table = tombstone.table as keyof DbShape;
    const rows = writeable[table] as unknown;
    if (!Array.isArray(rows)) {
      retainedTombstones.push(tombstone);
      continue;
    }
    const rowIndex = (rows as { id?: string }[]).findIndex((row) => row.id === tombstone.rowId);
    if (rowIndex === -1) {
      retainedTombstones.push(tombstone);
      continue;
    }
    const row = (rows as unknown[])[rowIndex];
    const rowStamp = rowSyncStamp(row);
    if (rowStamp && rowStamp > tombstone.deletedAt) {
      continue;
    }
    (rows as unknown[]).splice(rowIndex, 1);
    retainedTombstones.push(tombstone);
  }

  next.deletedRows = purgeOldTombstones(retainedTombstones);
  return next;
}

function mergeDbShapes(local: DbShape, remote: DbShape): DbShape {
  const merged = { ...local } as DbShape;
  const writeable = merged as Record<keyof DbShape, unknown>;
  (Object.keys(local) as (keyof DbShape)[]).forEach((table) => {
    if (table === "deletedRows") {
      writeable[table] = mergeTombstones(local.deletedRows, remote.deletedRows);
      return;
    }
    writeable[table] = mergeRows(
      local[table] as unknown as { id?: string }[],
      remote[table] as unknown as { id?: string }[]
    );
  });
  return applyTombstones(merged);
}

function dbChangeBroadcastChannel(): BroadcastChannel | undefined {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return undefined;
  dbChangeChannel ??= new BroadcastChannel(DB_CHANGE_CHANNEL);
  return dbChangeChannel;
}

function broadcastDbChange(source: "local" | "remote") {
  dbChangeBroadcastChannel()?.postMessage({
    type: "quotex-db-change",
    key: STORAGE_KEY,
    source,
    instanceId: DB_INSTANCE_ID,
    at: Date.now(),
  });
}

function applyIncomingSnapshot(next: DbShape, source: "storage" | "broadcast" | "remote") {
  const merged = source === "remote" ? mergeDbShapes(cache, next) : next;
  const before = JSON.stringify(cache);
  const after = JSON.stringify(merged);
  if (before === after) return false;
  cache = merged;
  persistLocalOnly();
  notify();
  if (source === "remote") broadcastDbChange("remote");
  return true;
}

function applyLocalStorageSnapshot(source: "storage" | "broadcast") {
  if (typeof window === "undefined") return false;
  const next = normalizeLocalSnapshot(window.localStorage.getItem(STORAGE_KEY));
  return next ? applyIncomingSnapshot(next, source) : false;
}

async function hydrateFromRemote(options: { force?: boolean; merge?: boolean } = {}) {
  if (remoteHydrating) {
    await new Promise<void>((resolve) => {
      const waitForCurrentHydration = () => {
        if (!remoteHydrating) {
          resolve();
          return;
        }
        setTimeout(waitForCurrentHydration, 10);
      };
      waitForCurrentHydration();
    });
    if (options.force) return hydrateFromRemote(options);
    return;
  }
  if (
    !isActiveDbInstance() ||
    !remoteSyncEnabled() ||
    typeof window === "undefined" ||
    (!options.force && remoteHydrated)
  ) {
    if (!remoteSyncEnabled()) {
      setSyncStatus({
        status: "local-only",
        reason: "not_configured",
        message: "Cloud backup is not connected in this environment.",
      });
    }
    return;
  }
  remoteHydrating = true;
  if (!remoteLoadedOk) {
    setSyncStatus({ status: "saving", message: "Connecting cloud state." });
  }
  try {
    const res = await fetch(`${remoteApiBase()}/state/${encodeURIComponent(remoteStateId())}`, {
      method: "GET",
      headers: remoteHeaders(),
    });
    if (!res.ok) {
      throw new Error(`State read failed: ${res.status}`);
    }
    const payload = (await res.json()) as { found?: boolean; scoped?: boolean; snapshot?: unknown; revision?: number };
    if (!isActiveDbInstance()) return;
    remoteLoadedOk = true;
    remoteHydrated = true;
    if (typeof payload.revision === "number") remoteRevision = payload.revision;
    const remote = normalizeRemoteSnapshot(payload.snapshot);
    if (!payload.found || !remote) {
      scheduleRemotePersist(50, { skipStatus: true });
      return;
    }
    const next = options.merge === false || payload.scoped === true ? remote : mergeDbShapes(cache, remote);
    const changed = JSON.stringify(next) !== JSON.stringify(cache);
    cache = next;
    if (changed) {
      persistLocalOnly();
      notify();
      broadcastDbChange("remote");
    }
    if ((options.merge && JSON.stringify(next) !== JSON.stringify(remote)) || remoteDirtyDuringHydrate) {
      scheduleRemotePersist(100, { skipStatus: true });
    } else if (!remoteWriteTimer && !remoteRetryTimer) {
      setSyncStatus({ status: "synced", message: "All changes saved." });
    }
    remoteDirtyDuringHydrate = false;
  } catch (err) {
    console.warn("[db] Supabase state hydrate failed", err);
    remoteLoadedOk = false;
    remoteHydrated = false;
    setSyncStatus({
      status: "error",
      reason: err instanceof Error && /401|403/.test(err.message) ? "unauthorized" : "network",
      message: err instanceof Error ? err.message : "Cloud state could not be loaded.",
    });
  } finally {
    remoteHydrating = false;
  }
}

function scheduleRemotePersist(
  delayMs = REMOTE_WRITE_DEBOUNCE_MS,
  options: { skipStatus?: boolean } = {}
) {
  if (!isActiveDbInstance() || !remoteSyncEnabled() || typeof window === "undefined") return;
  if (remoteHydrating) remoteDirtyDuringHydrate = true;
  if (!options.skipStatus) setSyncStatus({ status: "saving", message: "Saving changes." });
  if (remoteWriteTimer) clearTimeout(remoteWriteTimer);
  remoteWriteTimer = setTimeout(() => {
    remoteWriteTimer = undefined;
    if (!isActiveDbInstance()) return;
    void persistRemote();
  }, delayMs);
}

function clearRemoteRetry() {
  if (remoteRetryTimer) clearTimeout(remoteRetryTimer);
  remoteRetryTimer = undefined;
  remoteRetryIndex = 0;
}

function scheduleRemoteRetry(reason: SyncErrorReason, message: string) {
  if (!remoteSyncEnabled() || typeof window === "undefined" || reason === "too_large") return;
  const delay = REMOTE_RETRY_DELAYS_MS[Math.min(remoteRetryIndex, REMOTE_RETRY_DELAYS_MS.length - 1)];
  remoteRetryIndex += 1;
  if (remoteRetryTimer) clearTimeout(remoteRetryTimer);
  remoteRetryTimer = setTimeout(() => {
    remoteRetryTimer = undefined;
    if (!isActiveDbInstance()) return;
    void persistRemote();
  }, delay);
  setSyncStatus({
    status: "error",
    reason,
    message: `${message} Retrying in ${Math.round(delay / 1000)}s.`,
  });
}

function serializedSnapshot(snapshot: DbShape = cache, baseRevision: number | null = remoteRevision) {
  return JSON.stringify({ snapshot, baseRevision });
}

export function stateSnapshotByteLength(snapshot: unknown): number {
  return JSON.stringify(snapshot).length;
}

function isOversizedLocalInlinePayload(value?: string | null): value is string {
  return typeof value === "string" && value.startsWith("data:") && value.length > LOCAL_CACHE_INLINE_DATA_URL_WARN_BYTES;
}

function compactDocumentForLocalCache(document: Document): Document {
  if (!isOversizedLocalInlinePayload(document.downloadUrl) && !isOversizedLocalInlinePayload(document.storagePath)) {
    return document;
  }

  const compact = { ...document };
  if (isOversizedLocalInlinePayload(compact.downloadUrl)) {
    if (compact.storagePath?.startsWith("blob:")) {
      compact.downloadUrl = compact.storagePath;
    } else {
      delete compact.downloadUrl;
    }
  }
  if (isOversizedLocalInlinePayload(compact.storagePath)) {
    compact.storagePath = compact.downloadUrl?.startsWith("blob:") ? compact.downloadUrl : "";
  }
  return compact;
}

function compactCommunicationForLocalCache(communication: Communication): Communication {
  const attachments = communication.attachments ?? [];
  if (!attachments.some((attachment) => isOversizedLocalInlinePayload(attachment.dataUrl))) return communication;

  return {
    ...communication,
    attachments: attachments.map((attachment) => {
      if (!isOversizedLocalInlinePayload(attachment.dataUrl)) return attachment;
      const compact = { ...attachment };
      if (compact.storagePath?.startsWith("blob:")) {
        compact.dataUrl = compact.storagePath;
      } else {
        delete compact.dataUrl;
      }
      return compact;
    }),
  };
}

function compactSnapshotForLocalCache(snapshot: DbShape): DbShape {
  return {
    ...snapshot,
    documents: snapshot.documents.map(compactDocumentForLocalCache),
    communications: snapshot.communications.map(compactCommunicationForLocalCache),
  };
}

function logLargeSnapshotTables(serializedLength: number) {
  const sizes = (Object.keys(cache) as (keyof DbShape)[])
    .map((table) => ({
      table,
      bytes: JSON.stringify(cache[table]).length,
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8);
  console.warn("[db] State snapshot too large for safe sync", {
    bytes: serializedLength,
    biggestTables: sizes,
  });
}

async function migrateLargeInlineFilesToBlobRefs(): Promise<boolean> {
  if (!remoteSyncEnabled() || !remoteLoadedOk) return false;
  let changed = false;

  for (const document of cache.documents) {
    if (!isLargeInlineDataUrl(document.downloadUrl)) continue;
    try {
      const ref = await storeStateBlob(document.downloadUrl, document.fileType);
      if (ref.startsWith("blob:")) {
        document.downloadUrl = ref;
        if (!document.storagePath || document.storagePath.startsWith("data:")) {
          document.storagePath = ref;
        }
        changed = true;
      }
    } catch (err) {
      console.warn("[db] State blob upload failed for document", document.id, err);
    }
  }

  for (const communication of cache.communications) {
    for (const attachment of communication.attachments ?? []) {
      if (!isLargeInlineDataUrl(attachment.dataUrl)) continue;
      try {
        const ref = await storeStateBlob(attachment.dataUrl, attachment.fileType);
        if (ref.startsWith("blob:")) {
          attachment.dataUrl = ref;
          attachment.storagePath ??= ref;
          changed = true;
        }
      } catch (err) {
        console.warn("[db] State blob upload failed for communication attachment", attachment.id, err);
      }
    }
  }

  if (changed) persistLocalOnly();
  return changed;
}

async function persistRemote(options: { keepalive?: boolean; attempt?: number } = {}): Promise<boolean> {
  if (!isActiveDbInstance()) return false;
  if (remotePersistPromise && !options.keepalive) {
    remoteDirtyDuringPersist = true;
    return remotePersistPromise;
  }
  const run = persistRemoteInner(options);
  if (!options.keepalive) {
    remotePersistPromise = run;
    void run.finally(() => {
      if (remotePersistPromise === run) remotePersistPromise = undefined;
      if (remoteDirtyDuringPersist) {
        remoteDirtyDuringPersist = false;
        scheduleRemotePersist(0, { skipStatus: true });
      }
    });
  }
  return run;
}

async function persistRemoteInner(options: { keepalive?: boolean; attempt?: number } = {}): Promise<boolean> {
  if (!isActiveDbInstance()) return false;
  if (!remoteSyncEnabled()) {
    setSyncStatus({
      status: "local-only",
      reason: "not_configured",
      message: "Cloud backup is not connected in this environment.",
    });
    return false;
  }
  if (!remoteLoadedOk) {
    setSyncStatus({
      status: "saving",
      message: "Waiting for cloud state before uploading local changes.",
    });
    return false;
  }
  await migrateLargeInlineFilesToBlobRefs();
  const body = serializedSnapshot();
  if (body.length > REMOTE_SNAPSHOT_WARN_BYTES) {
    remoteDirtyDuringPersist = false;
    if (remoteWriteTimer) {
      clearTimeout(remoteWriteTimer);
      remoteWriteTimer = undefined;
    }
    logLargeSnapshotTables(body.length);
    setSyncStatus({
      status: "error",
      reason: "too_large",
      message: "Changes are saved locally, but the cloud snapshot is too large to sync.",
    });
    return false;
  }
  setSyncStatus({ status: "saving", message: "Saving changes." });
  try {
    const res = await fetch(`${remoteApiBase()}/state/${encodeURIComponent(remoteStateId())}`, {
      method: "PUT",
      headers: remoteHeaders(),
      body,
      keepalive: options.keepalive,
    });
    const payload = (await res.json().catch(() => null)) as
      | { ok?: boolean; scoped?: boolean; snapshot?: unknown; revision?: number; error?: string }
      | null;
    if (!isActiveDbInstance()) return false;
    if (res.status === 409) {
      const remote = normalizeRemoteSnapshot(payload?.snapshot);
      if (remote) {
        if (typeof payload?.revision === "number") remoteRevision = payload.revision;
        cache = payload?.scoped === true ? remote : mergeDbShapes(cache, remote);
        persistLocalOnly();
        notify();
      }
      if ((options.attempt ?? 0) < 5) {
        return persistRemoteInner({ attempt: (options.attempt ?? 0) + 1 });
      }
      setSyncStatus({
        status: "error",
        reason: "conflict",
        message: "Cloud save conflict could not be resolved automatically.",
      });
      scheduleRemoteRetry("conflict", "Cloud save conflict.");
      return false;
    }
    if (!res.ok) {
      const reason = syncFailureReason(res.status);
      const message = payload?.error ? `Cloud save failed: ${payload.error}.` : `Cloud save failed: ${res.status}.`;
      setSyncStatus({ status: "error", reason, message });
      scheduleRemoteRetry(reason, message);
      return false;
    }
    if (typeof payload?.revision === "number") remoteRevision = payload.revision;
    const remote = normalizeRemoteSnapshot(payload?.snapshot);
    if (remote) {
      cache = payload?.scoped === true ? remote : mergeDbShapes(cache, remote);
      persistLocalOnly();
    }
    clearRemoteRetry();
    setSyncStatus({ status: "synced", message: "All changes saved." });
    return true;
  } catch (err) {
    console.warn("[db] Supabase state write failed", err);
    const message = err instanceof Error ? err.message : "Network error while saving cloud state.";
    setSyncStatus({ status: "error", reason: "network", message });
    scheduleRemoteRetry("network", message);
    return false;
  }
}

function persistLocalOnly() {
  if (typeof window === "undefined") return;
  const quoteWorkflows = JSON.stringify(quoteWorkflowSnapshot(cache));
  try {
    window.sessionStorage.setItem(QUOTE_WORKFLOW_STORAGE_KEY, quoteWorkflows);
  } catch {
    /* quota - ignore */
  }
  const critical = JSON.stringify(criticalSnapshot(cache));
  try {
    window.sessionStorage.setItem(CRITICAL_STORAGE_KEY, critical);
  } catch {
    /* quota - ignore */
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    try {
      window.localStorage.setItem(QUOTE_WORKFLOW_STORAGE_KEY, quoteWorkflows);
    } catch {
      /* quota - session backup already attempted */
    }
    try {
      window.localStorage.setItem(CRITICAL_STORAGE_KEY, critical);
    } catch {
      /* quota - session backup already attempted */
    }
  } catch {
    try {
      const compact = JSON.stringify(compactSnapshotForLocalCache(cache));
      window.localStorage.setItem(STORAGE_KEY, compact);
      try {
        window.localStorage.setItem(QUOTE_WORKFLOW_STORAGE_KEY, quoteWorkflows);
      } catch {
        /* quota - session backup already attempted */
      }
      try {
        window.localStorage.setItem(CRITICAL_STORAGE_KEY, critical);
      } catch {
        /* quota - session backup already attempted */
      }
      if (remoteSyncEnabled() && syncStatus.status !== "saving") {
        setSyncStatus({ status: "saving", message: "Saving changes securely." });
      }
    } catch {
      if (remoteSyncEnabled()) {
        setSyncStatus({ status: "saving", reason: "local_quota", message: "Saving changes securely." });
      } else {
        setSyncStatus({
          status: "local-only",
          reason: "local_quota",
          message: "Cloud backup is not connected in this environment.",
        });
      }
    }
  }
}

function persist() {
  persistLocalOnly();
  scheduleRemotePersist();
  broadcastDbChange("local");
}

function ensureRuntimeMigrations(table?: keyof DbShape) {
  if (table && table !== "documents") return;
  if (hasCurrentAcordTemplateDefaults(cache)) return;
  cache = withAcordTemplateDefaults(cache);
  persist();
}

// Minimal pub-sub so cross-route consumers (e.g. the agent sidebar
// badge counts in EmployeeLayout) can re-render when ANY row in the
// DB changes. Callers don't get the diff — just a "something
// changed" tick. Subscribers should re-read whatever they care
// about from the relevant api.* method.
type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a misbehaving listener can't break persistence */
    }
  });
}

export function subscribeToDbChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function subscribeToSyncStatus(fn: SyncStatusListener): () => void {
  syncStatusListeners.add(fn);
  fn(syncStatus);
  return () => {
    syncStatusListeners.delete(fn);
  };
}

void hydrateFromRemote({ merge: true });

function startExternalSync() {
  if (typeof window === "undefined" || externalSyncStarted) return;
  externalSyncStarted = true;
  window.addEventListener("storage", (event) => {
    if (!isActiveDbInstance()) return;
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    applyIncomingSnapshot(normalizeLocalSnapshot(event.newValue) ?? cache, "storage");
  });
  dbChangeBroadcastChannel()?.addEventListener("message", (event) => {
    if (!isActiveDbInstance()) return;
    const message = event.data as {
      type?: string;
      key?: string;
      instanceId?: string;
    };
    if (
      message?.type !== "quotex-db-change" ||
      message.key !== STORAGE_KEY ||
      message.instanceId === DB_INSTANCE_ID
    ) {
      return;
    }
    applyLocalStorageSnapshot("broadcast");
  });
  if (remoteSyncEnabled()) {
    window.setInterval(() => {
      if (!isActiveDbInstance()) return;
      void hydrateFromRemote({ force: true, merge: true });
    }, REMOTE_LIVE_SYNC_INTERVAL_MS);
  } else {
    setSyncStatus({
      status: "local-only",
      reason: "not_configured",
      message: "Cloud backup is not connected in this environment.",
    });
  }
  const flushPendingRemoteWrite = () => {
    if (!isActiveDbInstance()) return;
    if (!remoteSyncEnabled() || (!remoteWriteTimer && syncStatus.status !== "saving")) return;
    if (remoteWriteTimer) {
      clearTimeout(remoteWriteTimer);
      remoteWriteTimer = undefined;
    }
    void persistRemote({ keepalive: true });
  };
  window.addEventListener("pagehide", flushPendingRemoteWrite);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingRemoteWrite();
  });
}

startExternalSync();

export const db = {
  reset() {
    cache = withDefaultMigrations(freshSeed());
    persistLocalOnly();
    broadcastDbChange("local");
    notify();
  },
  snapshot(): DbShape {
    return cache;
  },
  syncStatus(): SyncStatus {
    return syncStatus;
  },
  async hydrateNow(): Promise<boolean> {
    if (!remoteSyncEnabled()) return false;
    await hydrateFromRemote({ force: true, merge: true });
    return remoteLoadedOk;
  },
  async syncNow(): Promise<boolean> {
    if (!remoteSyncEnabled()) return false;
    if (!remoteLoadedOk) await hydrateFromRemote({ force: true, merge: true });
    return persistRemote();
  },
  // Generic read helpers — array per table; copies returned to keep callers immutable.
  list<K extends keyof DbShape>(table: K): DbShape[K] {
    ensureRuntimeMigrations(table);
    return structuredClone(cache[table]) as DbShape[K];
  },
  insert<K extends keyof DbShape>(table: K, row: DbShape[K] extends Array<infer T> ? T : never) {
    const stamped = table === "deletedRows" ? row : stampInsertedRow(row);
    (cache[table] as unknown as unknown[]).push(stamped);
    persist();
    notify();
    return stamped;
  },
  update<K extends keyof DbShape>(
    table: K,
    id: string,
    patch: Partial<DbShape[K] extends Array<infer T> ? T : never>
  ): (DbShape[K] extends Array<infer T> ? T : never) | null {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    arr[idx] =
      table === "deletedRows"
        ? { ...arr[idx], ...patch }
        : stampUpdatedRow(arr[idx], patch as Partial<{ id: string }>);
    persist();
    notify();
    return arr[idx] as DbShape[K] extends Array<infer T> ? T : never;
  },
  remove<K extends keyof DbShape>(table: K, id: string) {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    if (table !== "deletedRows") {
      const deletedAt = nowIso();
      const row: DeletedRow = {
        id: tombstoneId(String(table), id),
        table: String(table),
        rowId: id,
        deletedAt,
      };
      const existing = cache.deletedRows.findIndex((deleted) => deleted.id === row.id);
      if (existing === -1) cache.deletedRows.push(row);
      else cache.deletedRows[existing] = row;
    }
    persist();
    notify();
    return true;
  },
};
