// =====================================================================
// Mock data store — localStorage backed, mirrors what the backend API
// would return. The intent is that swapping `db` for real `fetch` calls
// against `/api/...` requires changing only `src/lib/api.ts`.
// =====================================================================

import * as seed from "./seed";
import { apiBaseUrl, envValue } from "./apiBase";
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
const STORAGE_KEY = "quotex.db.v31";
const CRITICAL_STORAGE_KEY = `${STORAGE_KEY}.critical`;
const QUOTE_WORKFLOW_STORAGE_KEY = `${STORAGE_KEY}.quote-workflows`;
const LEGACY_KEYS = ["quotex.db.v1", "quotex.db.v2", "quotex.db.v3", "quotex.db.v4", "quotex.db.v5", "quotex.db.v6", "quotex.db.v7", "quotex.db.v8", "quotex.db.v9", "quotex.db.v10", "quotex.db.v11", "quotex.db.v12", "quotex.db.v13", "quotex.db.v14", "quotex.db.v15", "quotex.db.v16", "quotex.db.v17", "quotex.db.v18", "quotex.db.v19", "quotex.db.v20", "quotex.db.v21", "quotex.db.v22", "quotex.db.v23", "quotex.db.v24", "quotex.db.v25", "quotex.db.v26", "quotex.db.v27", "quotex.db.v28", "quotex.db.v29", "quotex.db.v30"];
const CRITICAL_TABLES: (keyof DbShape)[] = [
  "quotingSessions",
  "importBatches",
  "communications",
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
];

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
  data.categories = data.categories.map((category) => {
    const seeded = seededById.get(category.id);
    const existingLine = (category as InsuranceCategory & { lineOfBusiness?: InsuranceLineOfBusiness })
      .lineOfBusiness;
    return {
      ...category,
      lineOfBusiness: existingLine ?? seeded?.lineOfBusiness ?? "personal",
      sortOrder: category.sortOrder ?? seeded?.sortOrder ?? 9999,
      active: category.active ?? true,
    };
  });

  const existingCategoryIds = new Set(data.categories.map((category) => category.id));
  for (const category of seed.SEED_CATEGORIES) {
    if (!existingCategoryIds.has(category.id)) {
      data.categories.push(structuredClone(category));
      existingCategoryIds.add(category.id);
    }
  }

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
  return (
    existingAcordTemplates.length === currentAcordTemplates.length &&
    existingAcordTemplates.every((document) => {
      const current = currentById.get(document.id);
      return (
        current?.fileName === document.fileName &&
        current.storagePath === document.storagePath &&
        current.downloadUrl === document.downloadUrl
      );
    })
  );
}

function withAcordTemplateDefaults(data: DbShape): DbShape {
  data.documents ??= [];
  if (hasCurrentAcordTemplateDefaults(data)) return data;
  const currentAcordTemplates = currentAcordTemplateSeeds();
  data.documents = data.documents.filter((document) => !isAcordAgencyTemplate(document));
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

function load(): DbShape {
  if (typeof window === "undefined") {
    return withDefaultMigrations(freshSeed());
  }
  try {
    // Drop any older versioned caches so visitors who came in before a schema
    // change don't see partial or empty pages.
    for (const k of LEGACY_KEYS) window.localStorage.removeItem(k);

    const raw = window.localStorage.getItem(STORAGE_KEY);
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
let remoteHydrating = false;
let remoteDirtyDuringHydrate = false;
let remoteWriteTimer: ReturnType<typeof setTimeout> | undefined;
let externalSyncStarted = false;
let dbChangeChannel: BroadcastChannel | undefined;
const DB_CHANGE_CHANNEL = `${STORAGE_KEY}.changes`;
const DB_INSTANCE_ID = Math.random().toString(36).slice(2);
const REMOTE_LIVE_SYNC_INTERVAL_MS = 2500;

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
  const token = envValue("VITE_STATE_SYNC_TOKEN");
  return {
    "content-type": "application/json",
    ...(token ? { "x-state-sync-token": token } : {}),
  };
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
    writeable[table] = mergeRows(
      criticalRows as { id?: string }[],
      merged[table] as unknown as { id?: string }[]
    );
  });
  return withDefaultMigrations(merged);
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

function mergeDbShapes(local: DbShape, remote: DbShape): DbShape {
  const merged = { ...local } as DbShape;
  const writeable = merged as Record<keyof DbShape, unknown>;
  (Object.keys(local) as (keyof DbShape)[]).forEach((table) => {
    writeable[table] = mergeRows(
      local[table] as unknown as { id?: string }[],
      remote[table] as unknown as { id?: string }[]
    );
  });
  return merged;
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
  if (
    !remoteSyncEnabled() ||
    typeof window === "undefined" ||
    (!options.force && remoteHydrated) ||
    remoteHydrating
  ) {
    return;
  }
  remoteHydrating = true;
  try {
    const res = await fetch(`${remoteApiBase()}/state/${encodeURIComponent(remoteStateId())}`, {
      method: "GET",
      headers: remoteHeaders(),
    });
    if (!res.ok) throw new Error(`State read failed: ${res.status}`);
    const payload = (await res.json()) as { found?: boolean; snapshot?: unknown };
    const remote = normalizeRemoteSnapshot(payload.snapshot);
    if (!payload.found || !remote) {
      scheduleRemotePersist(50);
      return;
    }
    if (remoteDirtyDuringHydrate && !options.force) {
      scheduleRemotePersist(50);
      return;
    }
    const next = options.merge ? mergeDbShapes(cache, remote) : remote;
    const changed = JSON.stringify(next) !== JSON.stringify(cache);
    cache = next;
    if (changed) {
      persistLocalOnly();
      notify();
      broadcastDbChange("remote");
    }
    if (options.merge && JSON.stringify(next) !== JSON.stringify(remote)) {
      scheduleRemotePersist(100);
    }
  } catch (err) {
    console.warn("[db] Supabase state hydrate failed", err);
  } finally {
    remoteHydrating = false;
    remoteHydrated = true;
  }
}

function scheduleRemotePersist(delayMs = 650) {
  if (!remoteSyncEnabled() || typeof window === "undefined") return;
  if (remoteHydrating) remoteDirtyDuringHydrate = true;
  if (remoteWriteTimer) clearTimeout(remoteWriteTimer);
  remoteWriteTimer = setTimeout(() => {
    void persistRemote();
  }, delayMs);
}

async function persistRemote() {
  try {
    await fetch(`${remoteApiBase()}/state/${encodeURIComponent(remoteStateId())}`, {
      method: "PUT",
      headers: remoteHeaders(),
      body: JSON.stringify({ snapshot: cache }),
    });
  } catch (err) {
    console.warn("[db] Supabase state write failed", err);
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
    /* quota — ignore */
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

void hydrateFromRemote();

function startExternalSync() {
  if (typeof window === "undefined" || externalSyncStarted) return;
  externalSyncStarted = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    applyIncomingSnapshot(normalizeLocalSnapshot(event.newValue) ?? cache, "storage");
  });
  dbChangeBroadcastChannel()?.addEventListener("message", (event) => {
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
      void hydrateFromRemote({ force: true, merge: true });
    }, REMOTE_LIVE_SYNC_INTERVAL_MS);
  }
}

startExternalSync();

export const db = {
  reset() {
    cache = withDefaultMigrations(freshSeed());
    persist();
    notify();
  },
  snapshot(): DbShape {
    return cache;
  },
  async syncNow(): Promise<boolean> {
    if (!remoteSyncEnabled()) return false;
    await persistRemote();
    return true;
  },
  // Generic read helpers — array per table; copies returned to keep callers immutable.
  list<K extends keyof DbShape>(table: K): DbShape[K] {
    ensureRuntimeMigrations(table);
    return structuredClone(cache[table]) as DbShape[K];
  },
  insert<K extends keyof DbShape>(table: K, row: DbShape[K] extends Array<infer T> ? T : never) {
    (cache[table] as unknown as unknown[]).push(row);
    persist();
    notify();
    return row;
  },
  update<K extends keyof DbShape>(
    table: K,
    id: string,
    patch: Partial<DbShape[K] extends Array<infer T> ? T : never>
  ): (DbShape[K] extends Array<infer T> ? T : never) | null {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    arr[idx] = { ...arr[idx], ...patch };
    persist();
    notify();
    return arr[idx] as DbShape[K] extends Array<infer T> ? T : never;
  },
  remove<K extends keyof DbShape>(table: K, id: string) {
    const arr = cache[table] as unknown as { id: string }[];
    const idx = arr.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    persist();
    notify();
    return true;
  },
};
