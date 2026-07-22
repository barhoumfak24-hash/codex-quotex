// =====================================================================
// Quotex Insurance — domain types
// These types mirror the Prisma schema in server/prisma/schema.prisma.
// Every agency-scoped entity carries `tenantId` for tenant isolation.
// =====================================================================

export type Role =
  | "customer"
  | "agent"
  | "manager"
  | "csr"
  | "master_admin";

export type SubscriptionTier = "minimum" | "mid" | "ultra";

export type SoftwareProduct = "full_platform";

export type SoftwareSaleStatus =
  | "checkout_pending"
  | "paid"
  | "provisioning"
  | "closed";

export type SoftwareSaleWebsiteAppAddOn =
  | "none"
  | "website"
  | "app"
  | "website_app";

export type SoftwarePlanTermMonths = 12 | 24 | 36;

export type DemoLeadStatus = "new" | "contacted" | "qualified" | "not_fit" | "closed";
export type DemoLeadSource = "walkthrough_request" | "manual";

export interface DemoLead {
  id: string;
  firstName: string;
  lastName: string;
  businessEmail: string;
  agencyName: string;
  role: string;
  staffSize: string;
  phone?: string;
  interest: string;
  notes?: string;
  marketingOptIn: boolean;
  source: DemoLeadSource;
  status: DemoLeadStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SoftwareSaleSignedAgreement {
  id: string;
  title: string;
  summary?: string;
  version?: string;
  viewedAt?: string;
  signedAt: string;
  signedByName: string;
  signedByEmail: string;
  signatureStatement?: string;
  electronicRecordConsent?: boolean;
  signatureMethod?: "typed_name_with_checkbox" | "provider_packet";
  signerUserAgent?: string;
}

export interface SoftwareSaleRecurringInvoiceEmail {
  stripeInvoiceId: string;
  stripeInvoiceNumber?: string | null;
  stripeInvoiceUrl?: string | null;
  stripeInvoicePdf?: string | null;
  stripeSubscriptionId?: string | null;
  amountPaidUsd: number;
  currency: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: "sent" | "failed";
  provider: "sendgrid" | "resend" | "smtp" | "twilio" | "unconfigured";
  sentAt?: string;
  error?: string;
}

export interface SoftwareSale {
  id: string;
  agencyName: string;
  contactName: string;
  email: string;
  phone?: string;
  website?: string;
  product?: SoftwareProduct;
  tier: SubscriptionTier;
  seats: number;
  estimatedMonthly: number;
  setupFee: number;
  websiteAppAddOn?: SoftwareSaleWebsiteAppAddOn;
  websiteAppAddOnMonthly?: number;
  termMonths?: SoftwarePlanTermMonths;
  termDiscountPercent?: number;
  termDiscountMonthly?: number;
  monthlyBeforeTermDiscount?: number;
  standardEstimatedMonthly?: number;
  customMonthlyPriceUsd?: number;
  customMonthlyPriceReason?: string;
  status: SoftwareSaleStatus;
  source: "transaction_site" | "master_portal";
  paymentMode: "stripe_checkout" | "manual_invoice";
  notes?: string;
  signingPacketId?: string;
  signedAgreementNames?: string[];
  signedAgreements?: SoftwareSaleSignedAgreement[];
  signedByName?: string;
  signedByEmail?: string;
  signedAt?: string;
  signedPacketSubmittedAt?: string;
  signedPacketSubmittedByName?: string;
  signedPacketSubmittedByEmail?: string;
  stripeCheckoutSessionId?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePaymentStatus?: string | null;
  stripePaidAt?: string;
  stripePaymentIssueAt?: string;
  stripeSubscriptionTermStartedAt?: string | null;
  stripeSubscriptionTermEndsAt?: string | null;
  stripeSubscriptionCancelAt?: string | null;
  invoiceEmailSentAt?: string;
  invoiceEmailStatus?: "sent" | "failed";
  invoiceEmailProvider?: "sendgrid" | "resend" | "smtp" | "twilio" | "unconfigured";
  invoiceEmailError?: string;
  recurringInvoiceEmailLastStripeInvoiceId?: string;
  recurringInvoiceEmailSentAt?: string;
  recurringInvoiceEmailStatus?: "sent" | "failed";
  recurringInvoiceEmailProvider?: "sendgrid" | "resend" | "smtp" | "twilio" | "unconfigured";
  recurringInvoiceEmailError?: string;
  recurringInvoiceEmailHistory?: SoftwareSaleRecurringInvoiceEmail[];
  createdAt: string;
  updatedAt: string;
}

export type AssetType =
  | "coastal_home"
  | "luxury_vehicle"
  | "yacht"
  | "jewelry"
  | "umbrella_liability"
  | "full_portfolio"
  | "other";

export type InsuranceLineOfBusiness = "personal" | "commercial";

// Insurance category catalog — master-managed. Each row represents an option
// shown in the customer-facing quote flow. `assetType` controls which intake
// form is used; multiple categories can map to the same form (e.g. "Boats"
// and "Yachts" can both use the yacht intake) until a new form is built.
export interface InsuranceCategory {
  id: string;
  label: string;        // Display name (e.g. "Home", "Auto", "Jewelry", "Boats")
  description?: string;
  lineOfBusiness: InsuranceLineOfBusiness;
  assetType: AssetType; // Which built-in intake form to render in the quote flow
  icon?: string;        // Lucide icon name (e.g. "Home", "Briefcase", "Sailboat")
  // Per-category intake questions appended to the built-in form. The
  // AI lookup chain reads field values by `key` — e.g. setting key
  // "vin" automatically triggers the NHTSA decoder, "address" triggers
  // FEMA + Smarty. Anything else is captured for the agent to review.
  questions?: CategoryQuestion[];
  // Optional free-form note shown on the master detail page; not
  // surfaced to customers.
  coverageNotes?: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

// Schema for one intake question. The customer quote flow renders
// these via a single generic renderer so categories can be added
// or edited from the master portal without code changes.
export interface CategoryQuestion {
  key: string;                              // camelCase field name in parsedData
  label: string;                            // shown to customer
  inputType: "text" | "number" | "currency" | "boolean" | "select" | "date" | "address" | "textarea";
  options?: string[];                       // for `select`
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}

// Per-agency activation. Mirrors CarrierAgencyLink — master controls
// which categories each agency offers to its customers.
export interface CategoryAgencyLink {
  id: string;
  categoryId: string;
  tenantId: string;
  active: boolean;
  createdAt: string;
}

export type PolicyStatus =
  | "quote_started"
  | "documents_needed"
  | "submitted_to_agent"
  | "under_agent_review"
  | "submitted_to_carrier"
  | "carrier_reviewing"
  | "approved"
  | "bound"
  | "declined"
  | "deposit_paid"
  | "deposit_refunded"
  | "renewal_upcoming"
  | "renewed"
  | "claim_opened"
  | "claim_closed"
  | "closed";

export type ProspectStatus =
  | "new"
  | "contacted"
  | "quote_in_progress"
  | "abandoned"
  | "nurturing"
  | "converted"
  | "lost";

export type RenewalStatus =
  | "not_due"
  | "upcoming"
  | "customer_notified"
  | "agent_notified"
  | "waiting_on_customer"
  | "submitted_for_renewal"
  | "renewed"
  | "not_renewed"
  | "lost";

export type DocumentType =
  | "driver_license"
  | "ssn_documentation"
  | "proof_of_insurance"
  | "asset_information"
  | "policy_document"
  | "declarations_page"
  | "insurance_id_card"
  | "policy_booklet"
  | "endorsement_document"
  | "deposit_receipt"
  | "payment_receipt"
  | "appraisal"
  | "wind_mitigation"
  | "inspection_report"
  | "carrier_appetite_guide"
  | "carrier_application"
  | "carrier_supplemental"
  | "underwriting_manual"
  | "claim_document"
  | "cancellation_notice"
  | "carrier_correspondence"
  | "agency_template"
  | "other";

// Agencies can extend the document-type dropdown with their own
// templated categories (e.g. "POA — Liability waiver", "ESL —
// Surplus disclosure") without a code change. Per-tenant rows live
// in the customDocumentTypes table; uploaded Document rows store
// the custom slug in `type` (which now widens to string).
export interface CustomDocumentType {
  id: string;
  tenantId: string;
  // Snake_case slug stored on Document.type. Auto-derived from label
  // on create; immutable thereafter so existing uploads keep pointing
  // at the same row.
  slug: string;
  label: string;
  description?: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export type DocumentVisibility = "customer_visible" | "employee_only" | "master_only";

export type TemplateFieldMap = Record<string, string>;

export type DocumentTemplateFieldBoxKind =
  | "text"
  | "date"
  | "currency"
  | "number"
  | "checkbox";

export interface DocumentTemplateFieldBox {
  label: string;
  page: number;
  // Percent-based coordinates against the original page. The
  // document service can translate these to PDF points later without
  // mutating the uploaded file.
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: DocumentTemplateFieldBoxKind;
  required?: boolean;
  multiline?: boolean;
  source?: "detected" | "manual";
}

export interface DocumentFillableDetection {
  detected: boolean;
  confidence: number;
  reason: string;
  detectedAt: string;
}

export type StatusEventSource = "customer" | "agent" | "ai" | "system";

export type MessageChannel = "email";

export type WebsiteConnectionStatus = "not_tested" | "ready" | "needs_setup" | "error";

export type CarrierDownloadRunnerStatus =
  | "not_configured"
  | "pending_setup"
  | "ready"
  | "paused"
  | "error";

export type CarrierDownloadRunnerMode =
  | "ai_portal_runner"
  | "secure_mailbox"
  | "manual_upload_review";

export type CarrierDownloadRunnerLineOfBusiness = "personal" | "commercial";

export type CarrierDownloadRunnerFeed =
  | "policy"
  | "renewal"
  | "endorsement"
  | "cancellation"
  | "billing"
  | "claims"
  | "edocs"
  | "commission";

export type CarrierDownloadRunnerReviewRule =
  | "stage_all"
  | "auto_safe_fields"
  | "require_review_for_material_changes";

export type CarrierDownloadRunnerMfaMode =
  | "staff_approval"
  | "totp_vault"
  | "carrier_push"
  | "not_configured";

export type CarrierDownloadRunnerSchedule =
  | "as_available"
  | "hourly"
  | "twice_daily"
  | "daily"
  | "manual";

export type CarrierDownloadRunnerTestStatus = "not_tested" | "passed" | "failed";

// Legacy aliases kept so older demo caches/tests can still hydrate while the
// master portal presents the carrier download AI runner model.
export type IvansConnectionStatus = CarrierDownloadRunnerStatus;
export type IvansDownloadMethod = "ivans_exchange" | "sftp" | "carrier_portal" | "other";
export type IvansLineOfBusiness = CarrierDownloadRunnerLineOfBusiness;
export type IvansDownloadFeed = CarrierDownloadRunnerFeed;
export type IvansDownloadFileFormat =
  | "acord_al3"
  | "acord_xml"
  | "pdf_edoc"
  | "csv_statement"
  | "other";
export type IvansPollingSchedule = CarrierDownloadRunnerSchedule;
export type IvansTestStatus = CarrierDownloadRunnerTestStatus;

export type WebsitePortalModule =
  | "policies"
  | "documents"
  | "claims"
  | "messages"
  | "questionnaires"
  | "payments"
  | "signatures";

export type WebsitePortalModuleSettings = Record<WebsitePortalModule, boolean>;

export interface WebsiteAuthRedirects {
  loginSuccess?: string;
  logout?: string;
  passwordReset?: string;
  documentSignatureReturn?: string;
  questionnaireReturn?: string;
}

export interface AgencyDeactivationSnapshot {
  capturedAt: string;
  values: Record<string, unknown>;
  missingFields: string[];
}

// ---------------------------------------------------------------------
// Tenants & users
// ---------------------------------------------------------------------

export interface Agency {
  id: string;
  name: string;
  logoUrl?: string;
  brandColor?: string;
  contactEmail: string;
  phone?: string;
  address?: string;
  website?: string;
  websiteSlug?: string;
  websiteEnabled?: boolean;
  websiteHeadline?: string;
  websiteIntro?: string;
  portalBaseUrl?: string;
  customerPortalUrl?: string;
  quoteStartUrl?: string;
  websiteAllowedDomains?: string[];
  websiteApiKeyEncrypted?: string;
  websiteApiKeyPreview?: string;
  websiteWebhookUrl?: string;
  websiteWebhookSecretEncrypted?: string;
  websiteWebhookSecretPreview?: string;
  websiteAuthRedirects?: WebsiteAuthRedirects;
  websitePortalModules?: WebsitePortalModuleSettings;
  websiteLastLeadAt?: string;
  websiteLastSyncAt?: string;
  websiteLastWebhookStatus?: WebsiteConnectionStatus;
  websiteLastWebhookMessage?: string;
  websiteConnectionUpdatedAt?: string;
  carrierRunnerEnabled?: boolean;
  carrierRunnerStatus?: CarrierDownloadRunnerStatus;
  carrierRunnerMode?: CarrierDownloadRunnerMode;
  carrierRunnerAgencyCode?: string;
  carrierRunnerProfileId?: string;
  carrierRunnerReceiverCode?: string;
  carrierRunnerCredentialVaultRef?: string;
  carrierRunnerMfaMode?: CarrierDownloadRunnerMfaMode;
  carrierRunnerAuthorizedUserIds?: string[];
  carrierRunnerLinesOfBusiness?: CarrierDownloadRunnerLineOfBusiness[];
  carrierRunnerFeeds?: CarrierDownloadRunnerFeed[];
  carrierRunnerCarrierIds?: string[];
  carrierRunnerReviewRule?: CarrierDownloadRunnerReviewRule;
  carrierRunnerSchedule?: CarrierDownloadRunnerSchedule;
  carrierRunnerWorkingPath?: string;
  carrierRunnerArchivePath?: string;
  carrierRunnerFailureAlertEmails?: string[];
  carrierRunnerContactEmail?: string;
  carrierRunnerContactPhone?: string;
  carrierRunnerNotes?: string;
  carrierRunnerLastTestAt?: string;
  carrierRunnerLastTestStatus?: CarrierDownloadRunnerTestStatus;
  carrierRunnerLastTestMessage?: string;
  carrierRunnerLastSyncAt?: string;
  carrierRunnerUpdatedAt?: string;
  // Legacy local-demo migration fields from the previous download setup.
  ivansDownloadEnabled?: boolean;
  ivansConnectionStatus?: CarrierDownloadRunnerStatus;
  ivansAgencyAccount?: string;
  ivansMailboxId?: string;
  ivansReceiverCode?: string;
  ivansDownloadMethod?: string;
  ivansCredentialReference?: string;
  ivansLinesOfBusiness?: CarrierDownloadRunnerLineOfBusiness[];
  ivansDownloadFeeds?: CarrierDownloadRunnerFeed[];
  ivansTradingPartnerIds?: string[];
  ivansFileFormats?: string[];
  ivansPollingSchedule?: CarrierDownloadRunnerSchedule;
  ivansInboundPath?: string;
  ivansArchivePath?: string;
  ivansErrorAlertEmails?: string[];
  ivansContactEmail?: string;
  ivansContactPhone?: string;
  ivansNotes?: string;
  ivansTestFileReceivedAt?: string;
  ivansLastTestStatus?: CarrierDownloadRunnerTestStatus;
  ivansLastTestMessage?: string;
  ivansLastSyncAt?: string;
  ivansUpdatedAt?: string;
  serviceAreas: string[];
  // Agency sign-in code is stored protected at rest. `agencyCode` is
  // retained only as a legacy migration field for older demo caches.
  agencyCode?: string;
  agencyCodeEncrypted: string;
  agencyCodePreview: string;
  tier: SubscriptionTier;
  active: boolean;
  softwareProduct?: SoftwareProduct;
  allowedUsers: number;
  allowedProspectsPerMonth: number;
  allowedAiMessagesPerMonth: number;
  allowedCarriers: number;
  websiteAppAddOn?: SoftwareSaleWebsiteAppAddOn;
  softwarePlanTermMonths?: SoftwarePlanTermMonths;
  softwarePlanStartedAt?: string;
  softwarePlanRenewsAt?: string;
  softwarePlanRenewalContractPacketId?: string;
  softwarePlanRenewalContractSentAt?: string;
  softwarePlanRenewalContractRecipientEmail?: string;
  softwarePlanRenewalContractSignedAt?: string;
  softwarePlanRenewalContractSignedByName?: string;
  softwarePlanRenewalContractSignedByEmail?: string;
  softwarePlanLastRenewedAt?: string;
  monthlyPriceOverrideUsd?: number;
  monthlyPriceOverrideReason?: string;
  monthlyPriceOverrideUpdatedAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionTermStartedAt?: string;
  stripeSubscriptionTermEndsAt?: string;
  stripeSubscriptionCancelAt?: string;
  deactivationSnapshot?: AgencyDeactivationSnapshot;
  // Manager-configured agency-wide performance targets. The
  // Analytics page plots each goal's current value vs. target so
  // the team can see exactly where they sit relative to the bar
  // the manager set.
  // Active performance goals (company-wide + personal). Replaces the
  // old one-per-metric map.
  performanceGoals?: PerformanceGoal[];
  // Agent-submitted goal requests awaiting manager review. These are
  // intentionally not Activity Center tasks; managers handle them
  // inside Analytics > Performance goals.
  performanceGoalRequests?: PerformanceGoalRequest[];
  // Retired goals (completed / expired) for the "Previous goals" view.
  performanceGoalHistory?: ArchivedPerformanceGoal[];
  createdAt: string;
}

export type MasterAgencyActivityKind =
  | "agency_created"
  | "agency_updated"
  | "agency_deactivated"
  | "agency_code_changed"
  | "agency_code_sent"
  | "agency_plan_updated"
  | "agency_price_updated"
  | "agency_renewal_contract_sent"
  | "agency_renewed"
  | "agency_website_connection_updated"
  | "agency_carrier_runner_updated"
  | "agency_carrier_access_updated"
  | "agency_category_access_updated"
  | "agency_document_signed"
  | "agency_user_updated";

export interface MasterAgencyActivity {
  id: string;
  agencyId: string;
  agencyName: string;
  kind: MasterAgencyActivityKind;
  title: string;
  description: string;
  actorName: string;
  source: "master_portal" | "checkout" | "agency_portal" | "system";
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

// A physical branch / office location belonging to an agency. The
// agency's own `address` is treated as the headquarters; branches are
// additional locations.
export interface Branch {
  id: string;
  agencyId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  createdAt: string;
}

// Per-metric target + lookback window. All metrics are agency-wide
// (not per-agent) and the lookback decides how the current value is
// computed (e.g. policies bound in the last 30 days vs. all-time).
export type PerformanceGoalMetric =
  | "premiumWritten"
  | "newCustomers"
  | "newProspects"
  | "activitiesResolved"
  | "policiesBound"
  | "custom";

export type CustomPerformanceGoalFormula =
  | "newProspects"
  | "newCustomers"
  | "policiesBound"
  | "policiesRenewed"
  | "activitiesResolved"
  | "claimsOpened"
  | "claimsClosed"
  | "documentsApproved";

export type PerformanceGoalPeriod = "monthly" | "quarterly" | "annual";

// Company goal = agency-wide. Personal goal = scoped to one or more
// specific staff members (their book / their resolved activities).
export type PerformanceGoalScope = "company" | "personal";

export interface PerformanceGoal {
  id: string;
  metric: PerformanceGoalMetric;
  customMetricLabel?: string;
  customMetricPrompt?: string;
  customMetricHelper?: string;
  customMetricFormula?: CustomPerformanceGoalFormula;
  target: number;
  period: PerformanceGoalPeriod;
  // Optional custom deadline (ISO date).
  dueDate?: string;
  scope: PerformanceGoalScope;
  // For personal goals: the staff member(s) the goal applies to.
  // Empty / omitted for company goals.
  assigneeIds?: string[];
  // Set once we've fired the "target achieved" celebration so it
  // doesn't re-notify every time the dashboard reloads.
  achievedNotifiedAt?: string;
  // Last manager edit so the Analytics card can note "Set Apr 5".
  updatedAt: string;
}

export type PerformanceGoalRequestStatus = "pending" | "approved" | "rejected";

export interface PerformanceGoalRequest {
  id: string;
  requestedById: string;
  metric: PerformanceGoalMetric;
  customMetricLabel?: string;
  customMetricPrompt?: string;
  customMetricHelper?: string;
  customMetricFormula?: CustomPerformanceGoalFormula;
  target: number;
  period: PerformanceGoalPeriod;
  dueDate?: string;
  scope: PerformanceGoalScope;
  note?: string;
  status: PerformanceGoalRequestStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedById?: string;
  createdGoalId?: string;
}

// A goal that's been retired into history (completed or expired).
// Snapshots the actual at archive time + whether the target was met,
// so the Analytics "Previous goals" view can split met vs. not-met.
export interface ArchivedPerformanceGoal {
  id: string;
  metric: PerformanceGoalMetric;
  customMetricLabel?: string;
  customMetricPrompt?: string;
  customMetricHelper?: string;
  customMetricFormula?: CustomPerformanceGoalFormula;
  target: number;
  period: PerformanceGoalPeriod;
  dueDate?: string;
  scope: PerformanceGoalScope;
  assigneeIds?: string[];
  actual: number;
  met: boolean;
  archivedAt: string;
}

export interface User {
  id: string;
  tenantId: string | null; // null for master_admin and unaffiliated customers
  role: Role;
  email: string;
  // Staff business mailbox used by the Messages center. On first
  // login agents/managers replace the generated placeholder with
  // their real work email so future sign-ins and "Open in ..." links
  // point at the mailbox they actually use.
  businessEmail?: string;
  mailProvider?: MailProvider;
  // Username used for staff sign-in. Auto-generated when an agency is
  // provisioned. Master can copy / reset it.
  username?: string;
  // Plain-text generated password. ONLY visible to master_admin. In a real
  // backend this is a hashed value with a separate one-time reveal URL.
  generatedPassword?: string;
  // ISO timestamp of last password reset, for display.
  passwordUpdatedAt?: string;
  firstName?: string;
  lastName?: string;
  name: string;
  phone?: string;
  // Optional staff fields filled in by the user on first login.
  title?: string;
  bio?: string;
  avatarUrl?: string;
  // Optional staff specialty used for routing / reminder audience filters.
  lineOfBusiness?: "personal" | "commercial";
  // Optional staff branch assignment. Undefined means headquarters / main office.
  branchId?: string;
  // Personal email signature appended to outbound email messages
  // the staff member sends from /employee/messages, the client /
  // prospect Communications card, etc. Plain text (newlines
  // preserved). Optional — empty / unset means no signature is
  // appended.
  emailSignature?: string;
  // Embedded images / logos referenced by the signature. Stored as
  // data URLs so the demo is self-contained; in production these
  // would be uploaded to an asset store and referenced by signed
  // URL. Rendered inline in the signature card and stored in a
  // renderable signature payload on outbound demo emails.
  emailSignatureImages?: { name: string; dataUrl: string }[];
  electronicSignature?: {
    name: string;
    fontFamily: string;
    fontSize: number;
  };
  emailSignatureIncludesEsignature?: boolean;
  staffAccessStatus?: "active" | "banned" | "deleted";
  staffAccessUpdatedAt?: string;
  staffAccessUpdatedById?: string;
  // False until the staff member completes their profile on first login.
  // Master-created seed users default to true. Auto-provisioned users are
  // flagged false so the welcome flow runs once before they reach /employee.
  profileCompleted?: boolean;
  active: boolean;
  createdAt: string;
  importBatchId?: string;
}

export type MailProvider = "gmail" | "outlook" | "apple" | "yahoo" | "other";

export type ConnectedMailboxOwnerType = "staff" | "agency_marketing";
export type ConnectedMailboxStatus = "connected" | "needs_auth" | "needs_reauth" | "error" | "disabled";
export type ConnectedMailboxAuthMode = "oauth" | "smtp_imap" | "demo";
export type MailboxOutboxStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";
export type MailboxDeliveryStatus =
  | "draft"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "received"
  | "synced";

export interface ConnectedMailbox {
  id: string;
  tenantId: string;
  ownerType: ConnectedMailboxOwnerType;
  userId?: string;
  agencyId?: string;
  address: string;
  provider: MailProvider;
  displayName?: string;
  status: ConnectedMailboxStatus;
  authMode: ConnectedMailboxAuthMode;
  scopes: ("send" | "read" | "sync")[];
  tokenVaultRef?: string;
  externalAccountId?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  lastSendAt?: string;
  lastError?: string;
  updatedAt: string;
  updatedById?: string;
}

export interface MailboxOutboxJob {
  id: string;
  tenantId: string;
  communicationId: string;
  mailboxConnectionId?: string;
  mailboxAccount?: string;
  mailboxProvider?: MailProvider;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  bodyFormat?: "plain" | "html";
  replyToMessageIdHeader?: string;
  references?: string[];
  externalThreadId?: string;
  attachments?: CommunicationAttachment[];
  replyContext?: {
    communicationId: string;
    threadId?: string;
    customerId?: string;
    prospectId?: string;
    carrierContactId?: string;
    carrierSubmissionId?: string;
  };
  idempotencyKey: string;
  status: MailboxOutboxStatus;
  attemptCount: number;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  providerUrl?: string;
  createdAt: string;
  updatedAt: string;
  createdById?: string;
}

// ---------------------------------------------------------------------
// Staff accounting / HR
// ---------------------------------------------------------------------

export type TimesheetFrequency = "weekly" | "bi_weekly" | "semi_monthly" | "monthly";
export type TimesheetStatus = "draft" | "submitted" | "approved" | "needs_revision";

export interface AccountingSettings {
  id: string;
  tenantId: string;
  timesheetFrequency: TimesheetFrequency;
  dueWeekday: number; // 0 = Sunday, 6 = Saturday
  dueDayOfMonth: number;
  reminderTime: string;
  timesheetRecipientIds: string[];
  updatedAt: string;
  updatedById?: string;
}

export interface TimesheetEntry {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  hours: number;
  category: "client_work" | "marketing" | "service" | "training" | "admin" | "other";
  description: string;
}

export interface Timesheet {
  id: string;
  tenantId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: TimesheetStatus;
  entries: TimesheetEntry[];
  totalHours: number;
  notes?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedById?: string;
  managerNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type HrSubmissionKind = "complaint" | "suggestion";
export type HrSubmissionStatus = "new" | "reviewing" | "closed";

export interface HrSubmission {
  id: string;
  tenantId: string;
  kind: HrSubmissionKind;
  anonymous: boolean;
  submittedById?: string;
  coworkerName?: string;
  subject: string;
  message: string;
  status: HrSubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedById?: string;
  managerNotes?: string;
}

// ---------------------------------------------------------------------
// Customers, assets, policies
// ---------------------------------------------------------------------

// Short human-friendly identifier shown on agent/manager surfaces
// (e.g. the Renewals table). Optional — auto-derived from the
// customer id when not explicitly set.
export interface CustomerProfile {
  id: string;
  tenantId: string;
  userId: string;
  clientCode?: string;
  // Client-level book classification chosen when the client profile
  // is created. Policies can still have their own department, but this
  // gives staff an immediate personal/commercial split before policies exist.
  lineOfBusiness?: "personal" | "commercial";
  businessName?: string;
  operationsDescription?: string;
  branchId?: string;
  name: string;
  email: string;
  phone?: string;
  mailingAddress?: string;
  garagingAddress?: string;
  additionalContacts?: { name: string; relation: string; phone?: string; email?: string }[];
  marketingOptInEmail: boolean;
  marketingOptInSms: boolean;
  // Legacy SMS fields remain optional so older demo caches hydrate, but
  // the product is email-only now.
  // Compliance trail for explicit Terms + email consent captured
  // during sign-up. CAN-SPAM requires evidence of WHEN consent
  // was granted, against WHICH version of the terms wording. These
  // fields are immutable history — opt-out flips the marketing*
  // booleans above but does NOT clear these timestamps.
  termsAcceptedAt?: string;
  termsVersion?: string;
  smsConsentAt?: string;
  emailConsentAt?: string;
  // Primary staff owner. Only a manager can change this; agents
  // see it read-only.
  assignedAgentId?: string;
  // Dedicated service owner. CSRs can see and work clients assigned
  // here without being treated as the licensed writing agent.
  assignedCsrId?: string;
  // Co-assigned agents. The client is visible to and routable by
  // every id in this list IN ADDITION to the primary owner above.
  // Used when a manager assigns a single client to multiple
  // agents at once (shared books, lead handoffs, etc.). Empty /
  // unset → primary owner only.
  additionalAgentIds?: string[];
  additionalCsrIds?: string[];
  // Managers can dismiss an unassigned row from the Routing surface
  // without deleting the client record itself. A later explicit route
  // request clears these fields and makes the row actionable again.
  routingDismissedAt?: string;
  routingDismissedById?: string;
  // Soft delete. Archived clients are hidden from the main client
  // list but reachable via /employee/archive. Unarchive restores
  // them. Default false (treated as missing → not archived).
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
  importBatchId?: string;
}

export interface Asset {
  id: string;
  tenantId: string;
  customerId: string;
  type: AssetType;
  label: string;
  estimatedValue: number;
  details: Record<string, unknown>;
  status: "pending" | "insured" | "lapsed";
  createdAt: string;
  importBatchId?: string;
}

export interface QuoteRequest {
  id: string;
  tenantId: string;
  customerId: string;
  quoteSessionId?: string;
  assetType: AssetType;
  lineOfBusiness?: "personal" | "commercial";
  categoryId?: string;
  categoryLabel?: string;
  rawDescription?: string;
  parsedData: Record<string, unknown>;
  publicFieldEvidence?: PublicDataEvidenceMap;
  aiPremiumEstimateMin?: number;
  aiPremiumEstimateMax?: number;
  aiPremiumEstimateConfidence?: number;
  aiPremiumEstimateRationale?: string;
  aiPremiumEstimateSources?: string[];
  aiPremiumEstimateFactors?: string[];
  aiRecommendedCarrierId?: string;
  aiRecommendationReason?: string;
  missingDocuments: string[];
  status: PolicyStatus;
  assignedAgentId?: string;
  currentStep?: string;
  completionPercent?: number;
  lastTouchedAt?: string;
  abandonedAt?: string;
  submittedAt?: string;
  recoveryTaskId?: string;
  recoveryNotificationId?: string;
  aiReplySubject?: string;
  aiReplyBody?: string;
  createdAt: string;
}

export interface Policy {
  id: string;
  tenantId: string;
  customerId: string;
  assetId: string;
  carrierId: string;
  policyNumber?: string;
  premiumEstimate?: number;
  finalPremium?: number;
  effectiveDate?: string;
  renewalDate?: string;
  status: PolicyStatus;
  renewalStatus: RenewalStatus;
  agentId?: string;
  // Personal lines (HO, auto, yacht, jewelry, umbrella) vs
  // commercial lines (business). Most private-client books are
  // personal; the field stays optional and defaults to "personal"
  // for legacy seeded policies in the Renewals table.
  department?: "personal" | "commercial";
  // Optional deep-detail fields shown on the customer portal's
  // expanded policy card. All are optional so existing seeded
  // policies (and policies created via AddPolicyModal) keep
  // working — the card just hides the sections that have no data.
  paymentFrequency?: "monthly" | "quarterly" | "semi_annual" | "annual";
  billingMethod?: PolicyBillingMethod;
  billingPayer?: PolicyBillingPayer;
  billingPayerName?: string;
  billingStatus?: PolicyBillingStatus;
  billingAccountNumber?: string;
  billingReference?: string;
  billingFinanceCompany?: string;
  billingMortgagee?: string;
  billingLastVerifiedAt?: string;
  billingNotes?: string;
  coverages?: PolicyCoverage[];
  endorsements?: PolicyEndorsement[];
  exclusions?: string[];
  additionalInsureds?: PolicyParty[];
  participants?: PolicyParticipant[];
  beneficiaries?: PolicyBeneficiary[];
  premiumBreakdown?: PolicyPremiumBreakdown;
  nextPaymentDueDate?: string;
  nextPaymentAmount?: number;
  carrierBindingStatus?: CarrierPolicyBindingTrace["status"];
  carrierBindingReference?: string;
  carrierBindingMode?: "live_api" | "manual_workflow";
  carrierBindingTrace?: CarrierPolicyBindingTrace;
  closedAt?: string;
  closedById?: string;
  createdAt: string;
  importBatchId?: string;
}

export type PolicyBillingMethod =
  | "direct_bill"
  | "agency_bill"
  | "carrier_autopay"
  | "premium_finance"
  | "mortgagee_escrow"
  | "unknown";

export type PolicyBillingPayer =
  | "client"
  | "agency"
  | "mortgagee"
  | "premium_finance_company"
  | "other";

export type PolicyBillingStatus =
  | "current"
  | "due_soon"
  | "past_due"
  | "paid_in_full"
  | "unknown";

export interface PolicyCoverage {
  // e.g. "Dwelling", "Personal Property", "Liability", "Comprehensive"
  name: string;
  limit?: number;
  deductible?: number;
  description?: string;
}

export interface PolicyEndorsement {
  name: string;
  description?: string;
  addedAt?: string;
}

export interface PolicyParty {
  name: string;
  relationship?: string;
  holderType?:
    | "named_insured"
    | "additional_insured"
    | "listed_driver"
    | "lienholder"
    | "mortgagee"
    | "certificate_holder"
    | "beneficiary"
    | "other";
  email?: string;
  phone?: string;
  address?: string;
  deliveryPreference?: "email" | "mail" | "portal";
  notes?: string;
}

export interface PolicyParticipant {
  id?: string;
  participantType:
    | "driver"
    | "excluded_driver"
    | "operator"
    | "household_member"
    | "occupant"
    | "captain"
    | "operations_contact"
    | "other";
  name: string;
  relationship?: string;
  status?: "active" | "primary" | "occasional" | "excluded" | "inactive";
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  licenseNumber?: string;
  licenseState?: string;
  assignedAssetId?: string;
  notes?: string;
}

export interface PolicyBeneficiary extends PolicyParty {
  percentage?: number;
}

export interface PolicyPremiumBreakdown {
  base?: number;
  fees?: number;
  taxes?: number;
  total?: number;
}

export interface Deposit {
  id: string;
  tenantId: string;
  customerId: string;
  policyId?: string;
  quoteRequestId?: string;
  amount: number;
  currency: string;
  stripePaymentIntentId?: string;
  status: "pending" | "paid" | "refunded" | "failed";
  paidAt?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  customerId: string;
  policyId: string;
  amount: number;
  currency: string;
  method: "card" | "ach" | "wire" | "check";
  stripePaymentIntentId?: string;
  status: "pending" | "paid" | "refunded" | "failed";
  paidAt?: string;
  receiptDocumentId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------

export interface Prospect {
  id: string;
  tenantId: string;
  customerId?: string;
  name: string;
  email: string;
  phone?: string;
  lineOfBusiness?: "personal" | "commercial";
  assetType: AssetType;
  estimatedValue?: number;
  aiSummary: string;
  lastAction: string;
  lastActivityAt: string;
  recommendedFollowUp: string;
  marketingStatus: "none" | "active" | "paused" | "opted_out";
  // Primary agent owner. Required before a prospect can be
  // promoted to a client (manager gate). Co-owners go in
  // additionalAgentIds below.
  assignedAgentId?: string;
  assignedCsrId?: string;
  additionalAgentIds?: string[];
  additionalCsrIds?: string[];
  // Routing dismissal is presentation state only. The prospect and all
  // of its history remain intact until a user explicitly archives or
  // deletes the underlying record through the appropriate workflow.
  routingDismissedAt?: string;
  routingDismissedById?: string;
  status: ProspectStatus;
  quoteRequestId?: string;
  // Soft delete. Archived prospects are hidden from the prospect
  // queue but reachable via /employee/archive. See CustomerProfile
  // for the same pattern.
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------
// Carriers
// ---------------------------------------------------------------------

export interface Carrier {
  id: string;
  name: string;
  logoUrl?: string;
  claimsUrl?: string;
  billingPortalUrl?: string;
  billingPhone?: string;
  billingEmail?: string;
  // Carrier agent / broker sign-in URL. Used by the agent + manager
  // portals' "Edit policy" button to deep-link out to the carrier's
  // backend (where the policy itself actually lives). Optional —
  // carriers without a published URL fall back to a demo notice.
  agentPortalUrl?: string;
  appetiteNotes?: string;
  tendencyNotes?: string;
  underwritingRules?: string;
  preferredAssetTypes: AssetType[];
  restrictedRisks?: string[];
  stateAvailability: string[]; // 2-letter codes
  // Structured appetite rows used by the ballpark estimator to bias
  // the centerline toward carriers who would actually quote this
  // risk. One row per asset type the carrier writes. Optional so
  // legacy carriers (free-form notes only) still validate.
  appetites?: CarrierAppetite[];
  // Legacy field retained only for old stored demo records. Quotex quoting
  // uses carrier portal runners and underwriter email workflows, not
  // carrier endpoint connections.
  quotingApi?: {
    provider?: string;       // e.g. "HX Pro", "Bridge", "Nationwide DI"
    endpoint?: string;       // HTTPS URL
    status: "not_configured" | "configured" | "connected" | "error";
    lastTestedAt?: string;
    notes?: string;
  };
  // Carrier-approved browser automation. Production runners use an existing
  // signed-in browser session and never receive or type carrier portal
  // usernames/passwords. The frontend only queues the job and shows the trace.
  quotingAutomation?: {
    provider?: string;       // e.g. "AI portal runner", "Carrier RPA bridge"
    agentPortalUrl?: string; // agent/broker rater entry point
    customerPortalUrl?: string; // consumer quote entry point, if applicable
    credentialReference?: string; // legacy/other integration reference; not used by AI quote runners
    status: "not_configured" | "configured" | "connected" | "error";
    mfaMode?: "none" | "staff_prompt" | "carrier_push" | "service_account";
    lastTestedAt?: string;
    notes?: string;
  };
  // Binding / issuance is separate from quoting. It remains a carrier-site
  // step before the policy is actually registered on the carrier side.
  bindingApi?: {
    provider?: string;
    endpoint?: string;       // HTTPS URL for bind / issue / bridge handoff
    status: "not_configured" | "configured" | "connected" | "error";
    lastTestedAt?: string;
    notes?: string;
  };
  portalPlaybook?: CarrierPortalPlaybook;
  status: "active" | "inactive";
  createdAt: string;
  importBatchId?: string;
  createdByImport?: boolean;
}

export type CarrierPortalPlaybookStatus =
  | "configured"
  | "needs_verification"
  | "unsupported";

export interface CarrierPortalPlaybook {
  status: CarrierPortalPlaybookStatus;
  agentPortalUrl?: string;
  sourceUrls: string[];
  documents: string[];
  claims: string[];
  quotes: string[];
  stopConditions: string[];
  forbiddenActions: string[];
  notes?: string;
  verifiedAt?: string;
  verifiedBy?: string;
}

// Personal vs commercial line of business. Mirrors the Policy
// `department` enum so an appetite row + the policies written
// against it share the same taxonomy. Defaulted via getters
// (treat missing as "personal") so legacy seeded carriers keep
// validating.
export type CarrierAppetiteLine = "personal" | "commercial";

// Per-asset-type appetite band. The estimator filters carriers down
// to those whose appetites match the asset type, value range, and
// the customer's risk band, then averages their `pricingTendency`
// to bias the centerline. A tendency of 1.0 = "at market"; values
// below 1.0 mean the carrier tends to come in under the industry
// average, above 1.0 means premium positioning.
export interface CarrierAppetite {
  line?: CarrierAppetiteLine; // personal (default) vs commercial
  assetType: AssetType;
  minValue?: number;          // USD; omit for no floor (e.g. umbrella per-limit)
  maxValue?: number;          // USD; omit for no ceiling
  riskLevels: ("low" | "medium" | "high")[]; // bands the carrier will write
  pricingTendency: number;    // multiplier vs market baseline, typically 0.80 – 1.20
}

export interface CarrierAgencyLink {
  id: string;
  carrierId: string;
  tenantId: string;
  active: boolean;
  createdAt: string;
  importBatchId?: string;
}

export type CarrierDownloadKind =
  | "policy_update"
  | "edoc"
  | "billing_update"
  | "claim_update"
  | "commission_statement";

export type CarrierDownloadStatus =
  | "unreviewed"
  | "matched"
  | "needs_review"
  | "approved"
  | "rejected";

export type CarrierDownloadSeverity = "info" | "warn" | "critical";

export interface CarrierDownloadChange {
  field: keyof Policy | string;
  label: string;
  currentValue?: string | number | boolean | null;
  incomingValue?: string | number | boolean | null;
  severity: CarrierDownloadSeverity;
}

export interface CarrierDownloadDocumentPayload {
  fileName: string;
  fileType: string;
  documentName?: string;
  type: DocumentType | string;
  visibility: DocumentVisibility;
  status?: "pending" | "approved" | "rejected";
}

export interface CarrierDownload {
  id: string;
  tenantId: string;
  carrierId: string;
  kind: CarrierDownloadKind;
  status: CarrierDownloadStatus;
  source: "carrier_runner" | "ivans" | "manual_import" | "email_parser";
  sourceReference?: string;
  fileName?: string;
  receivedAt: string;
  effectiveDate?: string;
  customerId?: string;
  assetId?: string;
  policyId?: string;
  confidence: number;
  summary: string;
  changes: CarrierDownloadChange[];
  documentPayload?: CarrierDownloadDocumentPayload;
  notes?: string;
  appliedAt?: string;
  appliedById?: string;
  rejectedAt?: string;
  rejectedById?: string;
  rejectionReason?: string;
}

export type CarrierRunnerJobTrigger =
  | "policy_placed"
  | "policy_check"
  | "renewal_window"
  | "renewal_status_check"
  | "billing_check"
  | "claim_check"
  | "document_sync"
  | "manual";

export type CarrierRunnerJobStatus =
  | "queued"
  | "running"
  | "needs_mfa"
  | "staged_for_review"
  | "completed"
  | "failed"
  | "cancelled";

export type CarrierRunnerJobOutcome =
  | "no_change"
  | "policy_update_staged"
  | "renewal_update_staged"
  | "billing_update_staged"
  | "claim_update_staged"
  | "document_update_staged"
  | "non_renewal_detected";

export interface CarrierRunnerJob {
  id: string;
  tenantId: string;
  carrierId?: string;
  customerId?: string;
  assetId?: string;
  policyId?: string;
  renewalId?: string;
  trigger: CarrierRunnerJobTrigger;
  status: CarrierRunnerJobStatus;
  title: string;
  reason: string;
  scheduledFor: string;
  createdAt: string;
  createdById?: string;
  startedAt?: string;
  startedById?: string;
  completedAt?: string;
  completedById?: string;
  lastAttemptAt?: string;
  attempts: number;
  requiresMfa?: boolean;
  mfaRequestedAt?: string;
  mfaApprovedById?: string;
  sourceReference?: string;
  detectedOutcome?: CarrierRunnerJobOutcome;
  resultSummary?: string;
  errorMessage?: string;
  carrierDownloadId?: string;
}

// Position the carrier contact holds. Drives the position dropdown
// on the "Add carrier email" form.
export type CarrierContactPosition =
  | "underwriter"
  | "adjuster"
  | "claims_rep"
  | "marketing_rep"
  | "account_exec"
  | "billing"
  | "agency_liaison"
  | "other";

// Per-tenant address book entry for a carrier rep. The manager
// adds these so the agency knows exactly who to email about which
// piece of business. Surfaces on the Messages page as its own
// thread type alongside client / prospect threads.
export interface CarrierContact {
  id: string;
  tenantId: string;
  carrierId: string;
  name: string;
  position: CarrierContactPosition;
  email: string;
  phone?: string;
  notes?: string;
  createdAt: string;
  createdById?: string;
}

// ---------------------------------------------------------------------
// Documents, status updates, marketing, claims, notes
// ---------------------------------------------------------------------

// Personal vs commercial. Used today for carrier-specific
// documents — the Carrier library page splits its document
// library into a Personal section and a Commercial section so a
// rep finds the right form for the line they're writing without
// scrolling past everything else.
export type DocumentLineOfBusiness = "personal" | "commercial";
export type DocumentChangeAction = "uploaded" | "edited" | "updated" | "renewed";

export interface Document {
  id: string;
  tenantId: string;
  uploadedById: string;
  fileName: string;
  fileType: string;
  // Optional staff-entered display name, mainly for "Other"
  // uploads where the built-in document type is intentionally broad.
  documentName?: string;
  // Editable field/value snapshot for documents produced from or
  // applied to a template. Staff can review and edit these fields
  // before upload/publish, and later from the in-app preview.
  templateFields?: TemplateFieldMap;
  // Optional positioned field boxes layered over the original
  // uploaded document. This preserves the source PDF/image/Word file
  // and records only editable overlays.
  templateFieldLayout?: DocumentTemplateFieldBox[];
  fillableDetection?: DocumentFillableDetection;
  // Optional. Today used to bucket carrier-specific documents into
  // personal vs commercial sections; unset on documents that aren't
  // line-of-business-specific (claim files, e-sign packets, etc.).
  lineOfBusiness?: DocumentLineOfBusiness;
  // Staff-controlled requirement marker for tenant-wide library
  // documents. The line bucket decides who sees the document; this
  // only marks whether the document is required in that bucket.
  required?: boolean;
  // Either a built-in DocumentType or a tenant-defined custom slug
  // (see CustomDocumentType). Widened to `string` so the type system
  // doesn't have to know every tenant's slugs at compile time.
  type: DocumentType | string;
  visibility: DocumentVisibility;
  status: "pending" | "approved" | "rejected";
  storagePath: string; // placeholder for S3 key
  downloadUrl?: string; // signed url placeholder
  // Related entity (one of):
  customerId?: string;
  assetId?: string;
  policyId?: string;
  claimId?: string;
  carrierId?: string;
  agencyId?: string;
  quoteRequestId?: string;
  uploadedAt: string;
  // ----- E-signature workflow -----
  // Each side that needs to sign is set independently. These flags
  // only record the requirement; separate send/request actions
  // handle customer emails or staff work items.
  customerEsignRequired?: boolean;
  customerEsignSentAt?: string;
  customerEsignSignedAt?: string;
  // ID of the outbound Communication the AI created when the
  // customer packet was sent.
  esignCommunicationId?: string;
  agentEsignRequired?: boolean;
  // Which staff member is on the hook to sign. Defaults to the
  // client's primary assigned agent when the requirement is
  // flipped on but can be overridden.
  agentEsignAssignedToId?: string;
  agentEsignSignedAt?: string;
  agentEsignSignatureName?: string;
  agentEsignSignatureFont?: string;
  agentEsignSignatureSize?: number;
  // Activity Center task id created for the agent. Lets the
  // auto-creator stay idempotent.
  agentEsignTaskId?: string;
  // ----- Term versioning + renewal-update workflow -----
  // Which policy term year this document belongs to (e.g. 2026, 2027).
  // The Documents card groups by term so historical docs aren't lost.
  policyTermYear?: number;
  // When this row is a published-for-renewal version: which renewal
  // it was published for, and which earlier doc it supersedes.
  renewalId?: string;
  supersedesId?: string;
  publishedAt?: string;
  // Last user/system-facing document change shown in document rows.
  // This is separate from approval status so the row can say what
  // actually happened: uploaded, edited, updated, or renewed.
  lastChangeAction?: DocumentChangeAction;
  lastChangeAt?: string;
  // When this row is the original a renewal needs to update: the AI
  // flags it here so the Documents card can render an "Update for
  // Renewal" button and the renewal activity gate can lock until it's
  // republished. Cleared once a published successor exists.
  needsRenewalUpdate?: boolean;
  renewalForRenewalId?: string;
  importBatchId?: string;
}

export interface StatusEvent {
  id: string;
  tenantId: string;
  source: StatusEventSource;
  message: string;
  visibility: "customer_visible" | "internal";
  // Related entity references:
  customerId?: string;
  prospectId?: string;
  assetId?: string;
  policyId?: string;
  depositId?: string;
  claimId?: string;
  documentId?: string;
  marketingCampaignId?: string;
  renewalId?: string;
  quoteSessionId?: string;
  quoteRequestId?: string;
  // Communication this event was emitted alongside (e.g. the "Email
  // sent" / "Email received" auto-events). Lets the timeline modal
  // deep-link to the exact message in the Messages card.
  communicationId?: string;
  // Outbound MarketingMessage tied to the event (AI sends, custom
  // message sends). Mirrors communicationId for the marketing side.
  marketingMessageId?: string;
  attachments?: NoteAttachment[];
  createdAt: string;
  createdById?: string;
  importBatchId?: string;
}

export interface MarketingCampaign {
  id: string;
  tenantId: string;
  name: string;
  channel: MessageChannel;
  // `channel` stays as the primary medium for back-compat.
  channels?: MessageChannel[];
  audienceFilter: Record<string, unknown>;
  status: "draft" | "scheduled" | "active" | "paused" | "complete";
  // When set in the future, the campaign is queued rather than sent
  // immediately. The first batch goes out at this timestamp.
  scheduledFor?: string;
  // "none" = one-shot. Otherwise the dispatcher re-fans the same
  // brief to the same audience on this cadence until paused.
  recurrence?: CustomMessageRecurrence;
  // Next scheduled run for recurring campaigns. For one-shots this
  // equals scheduledFor.
  nextRunAt?: string;
  createdAt: string;
}

export interface MarketingMessage {
  id: string;
  tenantId: string;
  campaignId: string;
  prospectId?: string;
  customerId?: string;
  channel: MessageChannel;
  subject?: string;
  content: string;
  sentAt?: string;
  deliveryStatus:
    | "draft"
    | "queued"
    | "sent"
    | "delivered"
    | "failed"
    | "opened"
    | "clicked"
    | "replied"
    | "bounced";
  nextScheduledAt?: string;
  fromName?: string;
  fromEmail?: string;
  mailboxProvider?: MailProvider;
  mailboxConnectionId?: string;
  providerMessageId?: string;
  deliveryError?: string;
  createdAt: string;
}

// =====================================================================
// Manager-controlled marketing configuration. One row per tenant.
// Governs the voice + signature + attachment set used by the AI
// when it auto-sends outreach (prospect intake follow-ups, policy
// edit acknowledgments, etc.). Agents see this as read-only.
// =====================================================================

export type MessageStyle = "concierge" | "professional" | "friendly" | "concise";

export type MarketingAutoMessageTrigger =
  | "new_prospect"
  | "abandoned_quote"
  | "questionnaire_incomplete"
  | "renewal_due"
  | "policy_bound"
  | "document_request"
  | "birthday"
  | "claim_opened";

export type MarketingAutoMessageType =
  | "quote_intake"
  | "follow_up"
  | "retention"
  | "cross_sell"
  | "missing_documents"
  | "welcome"
  | "claim_check_in"
  | "custom";

export type MarketingAutoMessageAudience =
  | "new_prospects"
  | "abandoned_prospects"
  | "active_clients"
  | "renewal_clients"
  | "high_value_clients"
  | "assigned_book"
  | "custom_filter";

export type MarketingAutoMessageTiming = "immediate" | "delay" | "scheduled_time";
export type MarketingAutoMessageDelayUnit = "minutes" | "hours" | "days";
export type MarketingAutoMessageApprovalMode = "auto_send" | "draft_for_review";
export type MarketingAutoMessageSenderMode = "assigned_agent" | "assigned_manager" | "agency_team";

export interface MarketingAutoMessageRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: MarketingAutoMessageTrigger;
  messageType: MarketingAutoMessageType;
  channels: MessageChannel[];
  audience: MarketingAutoMessageAudience;
  timing: MarketingAutoMessageTiming;
  delayAmount?: number;
  delayUnit?: MarketingAutoMessageDelayUnit;
  sendTime?: string; // HH:mm local agency time.
  senderMode: MarketingAutoMessageSenderMode;
  approvalMode: MarketingAutoMessageApprovalMode;
  quietHoursStart?: string; // HH:mm
  quietHoursEnd?: string; // HH:mm
  maxPerContactPer30Days: number;
  stopOnReply: boolean;
  includeAttachments: boolean;
  prompt: string;
  updatedAt: string;
}

export interface MarketingAttachment {
  id: string;
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  description?: string;
  // Channels this attachment should be attached to.
  channels: MessageChannel[];
  addedAt: string;
  addedById?: string;
}

export interface MarketingConfig {
  id: string;
  tenantId: string;
  messageStyle: MessageStyle;
  // Who messages appear from (e.g., "The Whitford Insurance Team")
  senderName: string;
  // Closing line, e.g., "Best, The Whitford Team"
  signOff: string;
  // Optional extra paragraph appended to AI drafts.
  customBlurb?: string;
  // Auto-send a personalized email to brand-new prospects the moment
  // they're created (customer-flow quote, agent-created prospect).
  autoSendOnNewProspect: boolean;
  // Days to wait before the AI re-touches an unresponsive prospect.
  followUpCadenceDays: number;
  // Advanced automations that tell the AI what to send, who to send it
  // to, when to send it, and whether it should auto-send or draft for
  // staff approval.
  autoMessageRules: MarketingAutoMessageRule[];
  attachments: MarketingAttachment[];
  updatedAt: string;
  updatedById?: string;
}

// =====================================================================
// Custom (non-AI) staff-authored messages.
//
// Separate from the AI MarketingCampaign / MarketingMessage tables —
// these go out exactly as written. No personalization, no AI rewrite.
// =====================================================================

export type CustomMessageAudience = "all_prospects" | "all_clients" | "filter" | "selected";

export type CustomMessageRecurrence = "none" | "daily" | "weekly" | "monthly";

export type CustomMessageStatus =
  | "draft"
  | "scheduled"
  | "sent"
  | "cancelled"
  | "recurring_active"
  | "recurring_paused";

export interface CustomMessageAttachment {
  fileName: string;
  fileType?: string;
  documentId?: string;
  sizeBytes?: number;
}

export interface CustomMessageFilter {
  // Which side of the contact graph the filter applies to.
  audienceType: "clients" | "prospects" | "both";
  assetType?: AssetType;
  prospectStatus?: ProspectStatus;
}

export interface CustomMessage {
  id: string;
  tenantId: string;
  createdById: string;
  channel: MessageChannel;
  subject?: string;
  body: string;
  fromName?: string;
  fromEmail?: string;
  mailboxProvider?: MailProvider;
  mailboxConnectionId?: string;
  attachments: CustomMessageAttachment[];
  audience: CustomMessageAudience;
  filter?: CustomMessageFilter;
  selectedCustomerIds: string[];
  selectedProspectIds: string[];
  // For one-shot sends. Undefined = "send now".
  scheduledFor?: string;
  recurrence: CustomMessageRecurrence;
  status: CustomMessageStatus;
  recipientCount: number;
  sentCount: number;
  lastSentAt?: string;
  createdAt: string;
}

export interface Renewal {
  id: string;
  tenantId: string;
  policyId: string;
  renewalDate: string;
  status: RenewalStatus;
  agentId?: string;
  retentionActions?: string[];
  nonRenewalReason?: string;
  nonRenewalNoticeDate?: string;
  nonRenewalEffectiveDate?: string;
  nonRenewalNoticeUrl?: string;
  nonRenewalCarrierReference?: string;
  replacementStatus?: "not_started" | "marketing" | "quoted" | "replacement_bound" | "client_declined";
  replacementStrategy?: string;
  recommendedCarrierIds?: string[];
  nonRenewalNotes?: string[];
  createdAt: string;
  importBatchId?: string;
}

export interface Claim {
  id: string;
  tenantId: string;
  customerId: string;
  policyId: string;
  carrierId: string;
  carrierClaimsUrl?: string;
  externalClaimNumber?: string;
  lossDescription?: string;
  lossAmountUsd?: number;
  status: "opened" | "in_review" | "closed";
  openedAt: string;
  closedAt?: string;
}

export interface Note {
  id: string;
  tenantId: string;
  authorId: string;
  customerId?: string;
  prospectId?: string;
  policyId?: string;
  body: string;
  visibility: "internal" | "customer_visible";
  attachments?: NoteAttachment[];
  createdAt: string;
  importBatchId?: string;
}

export interface NoteAttachment {
  id: string;
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  dataUrl?: string;
  textPreview?: string;
  aiSummary: string;
  addedAt: string;
}

export type BookImportTargetField =
  | "ignore"
  | "name"
  | "businessName"
  | "email"
  | "phone"
  | "mailingAddress"
  | "clientCode"
  | "lineOfBusiness"
  | "assetType"
  | "estimatedValue"
  | "policyNumber"
  | "carrierName"
  | "premiumEstimate"
  | "effectiveDate"
  | "renewalDate"
  | "notes";

export type BookImportExceptionReason =
  | "missing_name"
  | "cross_tenant_email"
  | "file_parse_error"
  | "file_too_large"
  | "batch_too_large"
  | "unsupported_format"
  | "empty_record"
  | "ai_unavailable";

export interface BookImportSourceFile {
  name: string;
  size: number;
  type: string;
  extension: string;
  status: "parsed" | "ai_limited" | "unsupported" | "failed";
  records: number;
  error?: string;
  detail?: string;
}

export interface BookImportColumnMapping {
  sourceFileName: string;
  sheetName?: string;
  header: string;
  targetField: BookImportTargetField;
  samples: string[];
  aiSuggested?: boolean;
}

export interface BookImportParsedRecord {
  id: string;
  sourceFileName: string;
  sheetName?: string;
  rowNumber?: number;
  originalRow?: Record<string, string>;
  clientCode?: string;
  name?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  mailingAddress?: string;
  lineOfBusiness?: "personal" | "commercial";
  assetType?: AssetType;
  estimatedValue?: number;
  policyNumber?: string;
  carrierName?: string;
  premiumEstimate?: number;
  finalPremium?: number;
  effectiveDate?: string;
  renewalDate?: string;
  notes?: string;
  confidence: number;
  sources: string[];
  aiDerived?: boolean;
  aiUnavailable?: boolean;
}

export interface BookImportException {
  id: string;
  recordId?: string;
  sourceFileName: string;
  sheetName?: string;
  rowNumber?: number;
  reason: BookImportExceptionReason;
  message: string;
  originalRow?: Record<string, string>;
  fixedRecord?: Partial<BookImportParsedRecord>;
  resolvedAt?: string;
}

export interface BookImportReport {
  importedAt: string;
  importedById: string;
  createdClients: number;
  updatedClients: number;
  portalInviteNeeded: { customerId: string; name: string }[];
  createdPolicies: number;
  createdAssets: number;
  createdDocuments: number;
  createdNotes: number;
  createdPlaceholderCarriers: number;
  exceptionsByReason: Record<string, number>;
  createdIds: {
    users: string[];
    customers: string[];
    assets: string[];
    policies: string[];
    documents: string[];
    notes: string[];
    carriers: string[];
    carrierLinks: string[];
    statusEvents: string[];
    renewals: string[];
  };
  undo?: {
    undoneAt: string;
    undoneById?: string;
    removed: Record<string, number>;
  };
}

export interface BookImportBatch {
  id: string;
  tenantId: string;
  sourceLabel: string;
  uploadedAt: string;
  uploadedById: string;
  fileCount: number;
  totalBytes: number;
  files: BookImportSourceFile[];
  columnMappings: BookImportColumnMapping[];
  records: BookImportParsedRecord[];
  exceptions: BookImportException[];
  status: "staged" | "importing" | "imported" | "undone" | "failed";
  progress?: {
    processed: number;
    total: number;
    label?: string;
    cancelled?: boolean;
  };
  report?: BookImportReport;
  lastError?: string;
  updatedAt: string;
}

export interface CommunicationAttachment {
  id: string;
  documentId?: string;
  sourceDocumentId?: string;
  fileName: string;
  fileType: string;
  sizeBytes?: number;
  dataUrl?: string;
  storagePath?: string;
  description?: string;
  filledFieldCount?: number;
  filledFields?: TemplateFieldMap;
  fieldMappings?: {
    sourceQuestionId?: string;
    sourceLabel: string;
    targetField: string;
    value: string;
    source: "questionnaire" | "public_record" | "asset_detail" | "contact" | "system";
  }[];
}

export interface Communication {
  id: string;
  tenantId: string;
  customerId?: string;
  prospectId?: string;
  // Outbound emails to a carrier contact (underwriter, adjuster,
  // etc.). Mutually exclusive with customerId / prospectId.
  carrierContactId?: string;
  // Outbound emails to a policy holder / additional interest that
  // is stored directly on a policy instead of as a first-class
  // customer/prospect/carrier contact.
  externalRecipientName?: string;
  externalRecipientEmail?: string;
  externalRecipientRole?: string;
  channel: MessageChannel | "call" | "note";
  direction: "inbound" | "outbound";
  subject?: string;
  // Email threading. Messages in the same conversation share a
  // threadId; a reply inherits the thread it's answering, while a
  // "new chat" starts a fresh threadId. SMS / call / note are flat
  // (no threadId). `replyToId` points at the specific message a
  // reply was composed against (best-effort, for audit/UX).
  threadId?: string;
  replyToId?: string;
  // Mailbox mirror metadata. App-authored outbound emails are marked
  // as `app`; messages imported from Gmail / Outlook / iCloud / etc.
  // are marked as `provider_sync`. Production sync stores the
  // provider ids so "Open in app" can deep-link directly when the
  // provider exposes a URL, and fall back to a contact/thread search
  // otherwise.
  mailboxOrigin?: "app" | "provider_sync" | "inbound_relay";
  mailboxAccount?: string;
  mailboxProvider?: MailProvider;
  mailboxConnectionId?: string;
  deliveryStatus?: MailboxDeliveryStatus;
  outboxJobId?: string;
  externalMessageId?: string;
  externalThreadId?: string;
  externalUrl?: string;
  // Commercial quote-flow correlation. Carrier replies are linked
  // back to the exact outbound application/supplemental submission
  // before AI parses the reply.
  carrierSubmissionId?: string;
  bodyHtml?: string;
  rawMimeRef?: string;
  rfc822MessageId?: string;
  messageIdHeader?: string;
  inReplyToHeader?: string;
  references?: string[];
  to?: string[];
  cc?: string[];
  bcc?: string[];
  snippet?: string;
  isRead?: boolean;
  mailboxLabels?: string[];
  attachments?: CommunicationAttachment[];
  body: string;
  // Customer-initiated inbound messages (policy edit requests,
  // claim inquiries, freeform notes) are unresolved by default
  // until a staff member responds or marks them attended to.
  // Drives the Clients sidebar badge "pending customer messages"
  // count. Outbound comms ignore this field.
  resolvedAt?: string;
  resolvedById?: string;
  // AI inbound triage. Every inbound message is scanned once. Messages
  // that create owned work link an Activity Center task; informational
  // messages link a lightweight notification instead.
  aiActivityScannedAt?: string;
  aiActivityTaskId?: string;
  aiActivityNotificationId?: string;
  aiTriageDisposition?: "ignore" | "notification" | "activity";
  aiTriageTopic?: TaskTopic;
  aiTriageReason?: string;
  aiTriageConfidence?: "high" | "medium" | "low";
  aiTriageEvidence?: string[];
  aiTriageRequiresHumanReview?: boolean;
  aiTriageVersion?: string;
  aiServiceIntent?:
    | "certificate_of_insurance"
    | "insurance_id_card"
    | "declarations_page"
    | "policy_copy"
    | "vehicle_quote_intake";
  aiDraftMissingFields?: ("vin" | "policy_line")[];
  aiReplyDraftId?: string;
  aiDraftSourceCommunicationId?: string;
  // Personal-lines quote automation. The mailbox agent stamps the inbound
  // reply before starting asynchronous work so repeated provider syncs cannot
  // create duplicate assets, quote flows, questionnaires, or carrier runs.
  aiQuoteAutomationStatus?: "pending" | "completed" | "manual" | "skipped" | "failed";
  aiQuoteAutomationProcessedAt?: string;
  aiQuoteAutomationSessionId?: string;
  aiQuoteAutomationAssetId?: string;
  aiQuoteAutomationReason?: string;
  aiQuoteAutomationAttempts?: number;
  createdAt: string;
  createdById?: string;
}

export type CarrierEmailProcessingOutcome =
  | "matched_processed"
  | "manual_review"
  | "ignored";

export interface CarrierEmailProcessing {
  id: string;
  tenantId: string;
  communicationId: string;
  outcome: CarrierEmailProcessingOutcome;
  matchedSessionId?: string;
  matchedSubmissionId?: string;
  candidateSubmissionIds?: string[];
  matchReason: string;
  classification?: CommercialCarrierSubmissionQuote["outcome"];
  parseConfidence?: number;
  processedAt: string;
  reprocessedFrom?: string;
  assignedById?: string;
  createdAt: string;
  updatedAt: string;
}

// =====================================================================
// Internal staff messaging. Lives separately from Communications
// (which are agency ↔ customer) and MarketingMessages (which are
// agency → audience, AI-personalized). One Thread = one running
// conversation; participants are user ids (agents / managers /
// admins). A thread can be 1:1 OR group; the UI groups by the
// sorted participantIds tuple so opening the same DM twice doesn't
// fork into duplicate threads.
// =====================================================================

export interface InternalThread {
  id: string;
  tenantId: string;
  // All staff in the thread, including the creator. Sorted on
  // insert so the same set always maps to the same thread.
  participantIds: string[];
  // Optional group-thread name; ignored for 1:1 DMs which render
  // as the other participant's name.
  topic?: string;
  createdById: string;
  createdAt: string;
  // Bumped on every new message so the threads list sorts most-
  // recent first without scanning messages.
  lastMessageAt: string;
}

export interface InternalMessage {
  id: string;
  tenantId: string;
  threadId: string;
  fromUserId: string;
  body: string;
  // Tri-level urgency mirroring TaskSeverity so the iPhone-style
  // bubble can recolor yellow → amber → red.
  urgency?: TaskSeverity;
  // User ids that have opened the thread after this message landed.
  // Drives the unread-count badges on the dashboard + sidebar.
  readBy: string[];
  createdAt: string;
}

// AI quoting workspace state, one row per prospect / client being
// quoted. The workspace walks through:
//   1. gathering_info — AI auto-pulls public fields
//   2. awaiting_reply — questionnaire drafted + sent, waiting on
//      the prospect to fill in what the AI couldn't find
//   3. quoting — AI calls each carrier's configured quoting-API
//      endpoint and ranks the responses
//   4. complete — quotes presented to the agent
export type QuotingSessionStatus =
  | "gathering_info"
  | "awaiting_reply"
  | "quoting"
  | "complete";

export type QuotingLineOfBusiness = "personal" | "commercial";

export interface QuotingSessionAssetMapping {
  assetId?: string;
  label: string;
  assetType: AssetType;
  categoryId?: string;
  categoryLabel?: string;
  address?: string;
  estimatedValue: number;
  assetDetails?: Record<string, string>;
  publicFields: Record<string, unknown>;
  publicFieldEvidence?: PublicDataEvidenceMap;
  missingFields: string[];
  aiSummary: string;
}

export type CommercialCarrierSubmissionStatus =
  | "application_sent"
  | "awaiting_response"
  | "send_failed"
  | "accepted"
  | "declined"
  | "needs_supplemental"
  | "supplemental_sent"
  | "needs_client_info"
  | "agent_review";

export interface CommercialCarrierSubmissionQuote {
  outcome:
    | "accepted"
    | "quoted"
    | "declined"
    | "pending"
    | "more_info_required";
  policyType?: string;
  coverages?: {
    label: string;
    limit?: string;
    premium?: string;
    deductible?: string;
    terms?: string;
    sourceText?: string;
  }[];
  limits?: string[];
  premiums?: string[];
  deductibles?: string[];
  terms?: string[];
  carrierNotes?: string[];
  conditions?: string[];
  nextSteps?: string[];
  requestedItems?: string[];
  declineReason?: string;
  supplementalAttachmentIds?: string[];
  evidenceSnippets?: string[];
  responseDeadline?: string;
  parsedAt: string;
  confidence: number;
}

export interface CommercialCarrierSubmission {
  submissionId?: string;
  carrierId: string;
  status: CommercialCarrierSubmissionStatus;
  sentAt?: string;
  responseAt?: string;
  acceptedAt?: string;
  score: number;
  fitReason: string;
  aiRationale: string;
  underwriterContactIds?: string[];
  applicationDocumentIds?: string[];
  applicationMessageIds?: string[];
  applicationThreadIds?: string[];
  applicationExternalThreadIds?: string[];
  supplementalMessageIds?: string[];
  supplementalDocumentIds?: string[];
  supplementalThreadIds?: string[];
  supplementalExternalThreadIds?: string[];
  replyCommunicationIds?: string[];
  submissionMethod?: "carrier_portal_automation" | "underwriter_email" | "manual_workflow";
  connectorLabel?: string;
  automationJobId?: string;
  automationTrace?: CarrierPortalRunnerTrace;
  missingFields?: string[];
  declinedReason?: string;
  premiumEstimate?: number;
  finalPremium?: number;
  underwriterNotes?: string;
  quote?: CommercialCarrierSubmissionQuote;
  parseConfidence?: number;
  agentReviewReason?: string;
  responseDeadline?: string;
  deliveryFailureReason?: string;
}

export interface CommercialCarrierRecommendation {
  carrierId: string;
  carrierName: string;
  rank: number;
  score: number;
  fitReason: string;
  aiRationale: string;
  hasCommercialAppetite: boolean;
  commercialDocumentCount: number;
  underwriterContacts: CarrierContact[];
  connectorLabel?: string;
  automationAvailable?: boolean;
  disabledReason?: string;
}

// One question in a structured commercial-questionnaire. The
// client portal renders these as form inputs grouped by section
// (Base intake + per-carrier supplementals).
export interface QuotingQuestion {
  id: string;
  section: string;        // e.g. "Base info", "Acme Carrier — supplemental"
  label: string;
  kind: "text" | "textarea" | "select" | "number";
  options?: string[];     // for select inputs
  required?: boolean;
  round?: "initial" | "second_round";
  // Indicates the question maps to a specific carrier's
  // supplemental doc — used only for grouping + audit; the
  // client doesn't see the carrier name.
  carrierId?: string;
  // ACORD/template source for field-level mapping and audit.
  sourceDocumentId?: string;
  sourceDocumentFileName?: string;
  acordFormNumber?: string;
  acordFieldKey?: string;
  acordFieldLabels?: string[];
}

export type QuestionnaireEditorRole = "agent" | "manager" | "customer" | "ai";

export interface QuestionnaireResponseMeta {
  updatedAt: string;
  updatedById?: string;
  updatedByName: string;
  updatedByRole: QuestionnaireEditorRole;
  sourceKind?: PublicDataFieldSourceKind;
  sourceName?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  confidence?: number;
  observedDate?: string;
  verified?: boolean;
  sourceNotes?: string;
}

export interface CarrierQuote {
  carrierId: string;
  premium: number;        // annual USD
  confidence: number;     // 0..1
  // Composite ranking score the UI sorts on. Higher = better fit.
  // Combines appetite match, value-band match, state availability,
  // and pricing tendency.
  score: number;
  fitReason: string;
  apiStatus: "connected" | "simulated" | "no_api";
  providerTrace?: CarrierQuoteProviderTrace;
  implementation?: CarrierQuoteImplementation;
}

export interface CarrierQuoteProviderTrace {
  provider: "carrier_portal_automation" | "configuration_only";
  providerLabel: string;
  transport: "browser_automation" | "manual";
  requestId: string;
  executionId?: string;
  liveReady: boolean;
  submittedAt: string;
  messages: string[];
  runnerTrace?: CarrierPortalRunnerTrace;
}

export type CarrierPortalRunnerCheckStatus = "pass" | "warn" | "block";

export interface CarrierPortalRunnerCheck {
  label: string;
  status: CarrierPortalRunnerCheckStatus;
  detail: string;
}

export interface CarrierPortalFieldMapping {
  quotexField: string;
  carrierField: string;
  value: string;
  source: "public_record" | "questionnaire" | "asset_detail" | "system";
  required: boolean;
  confidence: number;
}

export interface CarrierPortalExtractedQuote {
  quoteNumber: string;
  premium: number;
  effectiveDate: string;
  carrierReference: string;
  coverageSummary: string[];
}

export interface CarrierPortalRunnerTrace {
  jobId: string;
  mode: "live_worker" | "configuration_trace";
  surface: "agent_portal" | "customer_portal";
  entryUrl: string;
  browserSessionReference?: string;
  signInNotice?: string;
  mfaMode?: "none" | "staff_prompt" | "carrier_push" | "service_account";
  parallelGroupKey: string;
  status: "queued" | "completed" | "blocked" | "failed";
  queuedAt: string;
  completedAt?: string;
  mappedFieldCount: number;
  requiredFieldCount: number;
  validationChecks: CarrierPortalRunnerCheck[];
  fieldMappings: CarrierPortalFieldMapping[];
  extractedQuote?: CarrierPortalExtractedQuote;
  auditEvents: string[];
  blockingReasons: string[];
}

export interface CarrierQuoteImplementation {
  status: "implemented";
  policyId: string;
  carrierReference: string;
  carrierPortalUrl?: string;
  implementedAt: string;
  implementedById: string;
  mode: "live_api" | "manual_workflow";
  bindingTrace?: CarrierPolicyBindingTrace;
}

export interface CarrierPolicyBindingTrace {
  provider:
    | "carrier_portal_automation"
    | "manual_required"
    | "configuration_only";
  providerLabel: string;
  transport: "soap" | "rest" | "browser_automation" | "manual";
  requestId: string;
  executionId?: string;
  liveReady: boolean;
  submittedAt: string;
  status: "bound_on_carrier" | "prepared_not_sent" | "manual_required" | "failed";
  carrierReference: string;
  carrierPolicyNumber?: string;
  messages: string[];
  blockingReasons: string[];
  rawCarrierResponseSummary?: string;
}

export interface PersonalLinesCarrierApiDiagnosticRow {
  carrierId: string;
  carrierName: string;
  provider?: string;
  endpoint?: string;
  configuredStatus: NonNullable<Carrier["quotingApi"]>["status"];
  quoteApiStatus: CarrierQuote["apiStatus"];
  supportsAssetType: boolean;
  writesState: boolean;
  liveReady: boolean;
  blockingReasons: string[];
}

export interface PersonalLinesCarrierApiDiagnostic {
  tenantId: string;
  assetType: AssetType;
  state?: string;
  linkedActiveCarrierCount: number;
  liveReadyCount: number;
  simulatedCount: number;
  missingApiCount: number;
  errorCount: number;
  blockedCount: number;
  rows: PersonalLinesCarrierApiDiagnosticRow[];
}

export interface QuotingSession {
  id: string;
  tenantId: string;
  quoteRequestId?: string;
  categoryId?: string;
  categoryLabel?: string;
  categoryIds?: string[];
  categoryLabels?: string[];
  prospectId?: string;
  customerId?: string;
  // Existing asset being re-quoted (clients) or undefined for a
  // new-business quote.
  assetId?: string;
  // Every asset selected when the quote flow starts. The first entry
  // remains the primary asset for legacy carrier and policy workflows,
  // while AI mapping and questionnaires use every entry.
  selectedAssetMappings?: QuotingSessionAssetMapping[];
  // Snapshot of the asset / line being quoted so runQuotes doesn't
  // have to re-derive from the contact record. Persisted on
  // startSession.
  assetType: AssetType;
  estimatedValue: number;
  // Agent-provided lookup context for new lines/new assets. Examples:
  // property address, VIN/year/make/model, HIN, marina, appraisal info,
  // requested umbrella limit, or free-form exposure notes.
  assetDetails?: Record<string, string>;
  // 2-letter state code used by the carrier eligibility check.
  state?: string;
  // Personal vs commercial — AI-inferred at startSession from
  // contact name keywords (LLC / Inc / Corp / etc.) plus asset
  // type. Drives whether the workspace generates a structured
  // quiz-style questionnaire (commercial) or the legacy email
  // body (personal).
  lineOfBusiness?: QuotingLineOfBusiness;
  // Commercial quote flow starts from one or more selected ACORD /
  // agency application templates. AI fills what it can from public
  // records first, then the remaining blank fields become the
  // client/agent questionnaire.
  commercialAcordTemplates?: {
    templateId: string;
    fileName: string;
    documentName?: string;
    formNumber?: string;
    type?: string;
    storagePath?: string;
    downloadUrl?: string;
    autoFilledFieldCount: number;
    missingFieldCount: number;
    sourceCount?: number;
    candidateCount?: number;
    fittedFieldCount?: number;
    overflowFieldCount?: number;
    sourcesUsed?: string[];
    sourceFieldCounts?: Record<string, number>;
  }[];
  // Structured questions the client answers via the portal
  // questionnaire (commercial flow). Combines base intake + per-
  // carrier supplemental sections for every linked carrier the
  // agency works with.
  questionnaireQuestions?: QuotingQuestion[];
  // Commercial initial questionnaires are generated after the AI
  // fill audit has initialized the selected ACORD packet, so the
  // questions reflect the remaining blank ACORD fields.
  commercialQuestionnairePreparedAt?: string;
  // Personal line sessions create tailored questions during AI
  // mapping, but the agent should still review the mapping step
  // before the questionnaire becomes the active workflow page.
  personalQuestionnairePreparedAt?: string;
  // Answers keyed by question id. Agent and customer screens both
  // edit this same shared draft.
  questionnaireResponses?: Record<string, string>;
  // Per-question edit context for the current saved answer.
  questionnaireResponseMeta?: Record<string, QuestionnaireResponseMeta>;
  commercialCarrierSubmissions?: CommercialCarrierSubmission[];
  commercialApplicationSentAt?: string;
  commercialSecondRoundSentAt?: string;
  commercialSupplementalsCompletedAt?: string;
  createdById: string;
  status: QuotingSessionStatus;
  // Fields the AI auto-collected from public sources (address,
  // owner-of-record, property characteristics, etc.).
  publicFields: Record<string, unknown>;
  // Per-field provenance and safety gates for publicFields/assetDetails.
  // ACORD autofill only uses values explicitly allowed for document
  // autofill, while quote pricing can still use lower-confidence estimates.
  publicFieldEvidence?: PublicDataEvidenceMap;
  // Field labels the AI still needs from the client.
  missingFields: string[];
  // ID of the Communication the AI drafted as the questionnaire,
  // or null if no draft yet.
  questionnaireMessageId?: string;
  questionnaireDraft?: string;
  questionnaireSentAt?: string;
  replyReceivedAt?: string;
  // Ranked carrier quotes, written when status flips to "complete".
  quotes: CarrierQuote[];
  // AI summary that surfaces above the quotes ranking ("These three
  // carriers fit best because…").
  aiSummary?: string;
  aiProviderError?: string;
  aiProviderErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

// Per-user pinned message threads. Pins are scoped to the signed-
// in user — pinning a thread for yourself does NOT pin it for
// anyone else on the team. Limit of 5 active pins per user across
// all thread kinds (internal + client + prospect + carrier + holder) so the pinned
// strip at the top of the threads list stays scannable. UI enforces
// the cap; api.messagePins.pin throws if you're already at the
// limit.
export interface MessagePin {
  id: string;
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "carrier" | "holder";
  refId: string; // threadId for internal, contact id/email for external contacts
  pinnedAt: string;
}

export interface MessageMute {
  id: string;
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "carrier" | "holder";
  refId: string;
  mutedAt: string;
}

export interface MessageReport {
  id: string;
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "carrier" | "holder";
  refId: string;
  reason: string;
  status: "open" | "reviewed" | "dismissed";
  reportedAt: string;
}

export interface MessageBlock {
  id: string;
  tenantId: string;
  userId: string;
  kind: "client" | "prospect" | "carrier" | "holder";
  refId: string;
  blockedAt: string;
}

export type SecurityIncidentSeverity = "low" | "medium" | "high" | "critical";
export type SecurityIncidentStatus = "open" | "reviewed" | "dismissed";
export type SecuritySubjectKind =
  | "staff"
  | "customer"
  | "prospect"
  | "carrier"
  | "ip"
  | "unknown";

export interface SecurityIncident {
  id: string;
  tenantId: string;
  reportedById: string;
  reportedByName?: string;
  subjectKind: SecuritySubjectKind;
  subjectUserId?: string;
  subjectLabel?: string;
  ipAddress?: string;
  severity: SecurityIncidentSeverity;
  reason: string;
  status: SecurityIncidentStatus;
  resultingBanId?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedById?: string;
}

export interface SecurityBan {
  id: string;
  tenantId: string;
  kind: "user" | "ip";
  userId?: string;
  ipAddress?: string;
  subjectLabel?: string;
  reason: string;
  createdById: string;
  createdByName?: string;
  incidentId?: string;
  active: boolean;
  createdAt: string;
  revokedAt?: string;
  revokedById?: string;
}

export interface AuditLog {
  id: string;
  tenantId: string | null;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// =====================================================================
// Agent-facing notifications for AI actions taken on the agent's behalf
// (currently: AI auto-replied to a customer policy-edit request).
// Acknowledging a notification spawns a Task — the human follow-up.
// =====================================================================

export type AiNotificationKind =
  | "policy_edit_reply"
  | "quote_ready"
  | "inbound_notice"
  | "override_request"
  | "reassign_request"
  | "goal_request"
  | "goal_achieved"
  | "timesheet_due";

export interface AiNotification {
  id: string;
  tenantId: string;
  kind: AiNotificationKind;
  title: string;
  summary: string;
  customerId?: string;
  prospectId?: string;
  assetId?: string;
  policyId?: string;
  quoteSessionId?: string;
  quoteRequestId?: string;
  documentId?: string;
  messageId?: string;
  communicationId?: string;
  // Activity Center context — carried onto the spawned Task on
  // acknowledge so the agent sees rich detail (topic, AI summary,
  // original customer message, AI reply draft, severity) without
  // re-deriving from the message body.
  topic?: TaskTopic;
  severity?: TaskSeverity;
  // One-line AI rationale explaining why the severity was graded
  // the way it was. Surfaces on the activity card so the agent can
  // see the reasoning without re-reading the original request.
  severityReason?: string;
  aiSummary?: string;
  originalMessageContent?: string;
  originalMessageId?: string;
  aiReplyBody?: string;
  aiReplySubject?: string;
  assignedToId?: string;
  // For goal_achieved notifications — the goal that hit its target,
  // so View can deep-link + celebrate the exact row.
  goalId?: string;
  // For goal_request notifications — the requested-goal row that
  // needs manager review inside Analytics.
  goalRequestId?: string;
  acknowledgedAt?: string;
  acknowledgedById?: string;
  taskId?: string;
  createdAt: string;
}

export type TaskSource = "ai_notification" | "manual";

export type TaskSeverity = "urgent" | "warning" | "info";

export type TaskStatus = "open" | "in_progress" | "snoozed" | "resolved";

// Coarse topic taxonomy used to render the activity-summary line
// ("Customer received automated message regarding [topic]…") and
// for filtering inside the Activity Center.
export type TaskTopic =
  | "policy_edit_request"
  | "coverage_change"
  | "cancellation_request"
  | "claim_status"
  | "claim_filed"
  | "renewal_approaching"
  | "payment_issue"
  | "document_upload"
  | "endorsement_request"
  | "coverage_gap"
  | "other";

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  quoteSessionId?: string;
  quoteRequestId?: string;
  customerId?: string;
  prospectId?: string;
  assetId?: string;
  policyId?: string;
  claimId?: string;
  documentId?: string;
  messageId?: string;
  source: TaskSource;
  // Stable app-generated key for trigger-created activities. Lets
  // sweeps and repeated saves update/return the existing activity
  // instead of creating duplicates.
  activityKey?: string;
  sourceNotificationId?: string;
  // Plain-language headline topic (drives the activity summary line).
  topic?: TaskTopic;
  // AI-generated 2–3 sentence description of what the customer needs.
  aiSummary?: string;
  // Verbatim original customer message, surfaced via "View Full Request".
  originalMessageContent?: string;
  originalMessageId?: string;
  // The AI's recommended reply body, used to pre-fill the compose
  // window when the agent clicks "Reply to Customer".
  aiReplyBody?: string;
  aiReplySubject?: string;
  severity?: TaskSeverity;
  // AI rationale that accompanied the auto-graded severity.
  severityReason?: string;
  status?: TaskStatus;
  assignedToId?: string;
  additionalAssignedToIds?: string[];
  // Personal/manager-set deadline for the activity. Feeds the
  // personal calendar and daily briefing without replacing reminders.
  dueAt?: string;
  dueAtChangedAt?: string;
  dueAtChangedById?: string;
  snoozedUntil?: string;
  createdById?: string;
  // Set the first time the agent flips the activity to "in progress".
  // Persists across snooze/reopen so the card always shows the
  // original handoff moment.
  startedAt?: string;
  startedById?: string;
  completedAt?: string;
  completedById?: string;
  // Optional staff note captured when the activity is closed. When
  // tied to a client/prospect, this is also written as a real remark
  // so it appears in the Activity timeline & client remarks feed.
  resolutionNote?: string;
  resolutionNoteId?: string;
  resolutionNoteAt?: string;
  // Legacy manager-override audit metadata. Activity closeout is no
  // longer manager-gated, but old demo records/tests may still carry
  // these fields.
  overrideRequestedAt?: string;
  overrideRequestedById?: string;
  overrideReason?: string;
  overrideGrantedAt?: string;
  overrideGrantedById?: string;
  // Agent → manager reassignment request. An agent can ask for the
  // activity to be moved to a different agent; a manager actions it
  // from their Activity Center. Cleared once reassigned.
  reassignRequestedAt?: string;
  reassignRequestedById?: string;
  reassignRequestToId?: string;
  reassignReason?: string;
  // Manual sort priority. 1 = pinned to top, 0 = default, -1 = sent
  // to bottom. Surfaces above the severity-based sort so an agent /
  // manager can promote or demote individual cards.
  priorityRank?: number;
  priorityChangedAt?: string;
  priorityChangedById?: string;
  // Persisted drag-and-drop order inside the Activity Center queue.
  // Lower numbers render first. Undefined tasks keep the default
  // importance/newest-first ordering until a user manually reorders.
  queuePosition?: number;
  queueChangedAt?: string;
  queueChangedById?: string;
  // Tracks whether severity was last touched by a human (vs. the AI
  // that originally seeded it). Surfaces a small "Edited" hint on
  // the severity chip so it's obvious the importance was promoted
  // or downgraded manually.
  severityChangedAt?: string;
  severityChangedById?: string;
  // Set when the task was spawned from a customer-side express
  // quote submission. Sending the reply auto-resolves the task —
  // logReply checks this flag.
  expressQuoteFollowUp?: boolean;
  // Set when an agent created the activity but punted the assignment
  // decision to a manager ("Send to manager"). Cleared once a manager
  // (re)assigns it. Drives the "Awaiting manager assignment" badge.
  awaitingManagerAssignment?: boolean;
  // Contact routing request. Used when an agent asks a manager to
  // route/reroute a client or prospect; the manager completes it from
  // the Activity Center routing card and the real contact ownership is
  // updated there.
  routeRequestKind?: "client" | "prospect";
  routeRequestMode?: "route" | "reroute";
  routeRequestToAgentIds?: string[];
  routeRequestedAt?: string;
  routeRequestedById?: string;
  // The renewal this activity was auto-spawned for. Lets the renewal
  // sweep stay idempotent — one activity per renewal term.
  renewalId?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------
// AI service responses
// ---------------------------------------------------------------------

export interface AiParsedIntake {
  assetType: AssetType;
  fields: Record<string, unknown>;
  confidence: number;
  followUpQuestions: string[];
}

export interface AiPremiumEstimate {
  min: number;
  max: number;
  rationale: string;
  confidence?: number;
  sourceSummary?: string[];
  pricingFactors?: string[];
  researchSignals?: string[];
  missingDocuments: string[];
  recommendedNextSteps: string[];
  disclaimer: string;
}

export interface AiCarrierMatch {
  carrierId: string;
  carrierName: string;
  score: number; // 0..1
  reason: string;
  alternates: { carrierId: string; carrierName: string; score: number; reason: string }[];
}

export type PublicDataFieldSourceKind =
  | "agent_seed"
  | "client_intake"
  | "validated_address"
  | "public_geocoder"
  | "web_search"
  | "public_web"
  | "government_api"
  | "commercial_provider"
  | "imagery_vision"
  | "carrier_api"
  | "model_estimate"
  | "unknown";

export interface PublicDataFieldEvidence {
  fieldKey: string;
  sourceKind: PublicDataFieldSourceKind;
  sourceLabel: string;
  sourceUrl?: string;
  confidence: number;
  verified: boolean;
  allowDocumentAutofill: boolean;
  collectedAt: string;
  observedDate?: string;
  notes?: string;
}

export type PublicDataEvidenceMap = Record<string, PublicDataFieldEvidence>;

// Returned by the AI asset-enrichment service: given a minimal seed (an
// address, VIN, year+make+model, …) the AI calls real public-records
// APIs and returns the fields it could verify. Anything the public
// sources can't answer is listed in `unavailableFields` — the UI shows
// "Not available from public records" inline rather than a synthesized
// guess. Production wiring of commercial providers (CoreLogic / Estated
// / ATTOM / Manheim) populates the same `fields` object server-side.
export interface AiAssetEnrichment {
  fields: Record<string, unknown>;
  evidence?: PublicDataEvidenceMap;
  sources: string[];
  confidence: number; // 0..1
  unavailableFields?: string[];
  notes?: string;
}

// Returned by the AI contact extractor: given a file (or pasted text),
// extract contact + asset details so an agent can spin up a prospect or
// client record without re-typing everything. Staff confirms or edits
// before saving.
export interface AiExtractedContact {
  lineOfBusiness?: InsuranceLineOfBusiness;
  businessName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  assetType?: AssetType;
  estimatedValue?: number;
  notes?: string;
  summary: string;
  confidence: number;
  sources: string[];
  fieldEvidence?: Record<
    string,
    {
      fieldKey: string;
      value: string;
      sourceKind: "document_text" | "document_vision" | "local_pattern";
      evidence: string;
      confidence: number;
      verified: boolean;
    }
  >;
  outcome?:
    | "created_ready"
    | "needs_confirm"
    | "duplicate_found"
    | "low_quality_retake"
    | "password_required"
    | "unsupported"
    | "no_client_found"
    | "error";
  requiredFieldsPresent?: boolean;
  autoCreateEligible?: boolean;
  peopleDetected?: number;
  extractionWarnings?: string[];
}

// Returned by the AI policy-document extractor: given an uploaded
// declarations page / carrier policy PDF, propose the policy fields
// to pre-fill the Add Policy form. All fields optional — the agent
// confirms before saving.
export interface AiExtractedPolicy {
  policyNumber?: string;
  carrierName?: string;
  premiumEstimate?: number;
  finalPremium?: number;
  effectiveDate?: string; // ISO date (yyyy-mm-dd)
  renewalDate?: string; // ISO date (yyyy-mm-dd)
  assetHint?: string;
  summary: string;
  confidence: number;
  sources: string[];
}

// Returned by the AI carrier-appetite parser: given an uploaded
// appetite guide / underwriting bulletin, propose a structured patch
// (preferredAssetTypes, appetites, stateAvailability, appetiteNotes,
// restrictedRisks) that the master reviews before applying to the
// carrier profile. `missingFields` lists what the AI couldn't pull
// from the document so the master knows what still needs manual
// entry.
export interface AiParsedCarrierAppetite {
  preferredAssetTypes?: AssetType[];
  appetites?: CarrierAppetite[];
  stateAvailability?: string[];
  restrictedRisks?: string[];
  appetiteNotes?: string;
  tendencyNotes?: string;
  underwritingRules?: string;
  // Free-form labels for the carrier's distribution-list emails so
  // the manager can wire them up later. Optional, often missing.
  carrierEmailHints?: { label?: string; email?: string }[];
  summary: string;
  confidence: number;
  sources: string[];
  // Field names the AI could NOT confidently pull from the source
  // doc. Rendered as a highlighted "missing" badge alongside the
  // proposed patch so the master knows what still needs hand entry.
  missingFields: string[];
}

// Personal reminder an agent / manager sets for themselves. Two
// flavors:
//   1. Task-anchored — pass taskId, and the reminder deep-links into
//      the Activity Center.
//   2. General — pass title instead of taskId for a freeform
//      follow-up that's not tied to any record.
// The dashboard "My reminders" card surfaces both, sorted by remindAt,
// and shows a separate "Past reminders" section for dismissed rows.
export interface Reminder {
  id: string;
  tenantId: string;
  userId: string;
  // Personal reminders are private to the user. Company reminders
  // are fanned out as independent recipient-owned rows so each
  // selected teammate sees the same reminder on their dashboard and
  // calendar without sharing dismiss/snooze state.
  scope?: "personal" | "company";
  taskId?: string;
  calendarEventId?: string;
  title?: string;
  note?: string;
  // Reuses the TaskSeverity tri-state (info=yellow / warning=amber
  // / urgent=red) so the importance icon matches what the user
  // already sees on Activity Center cards.
  importance?: TaskSeverity;
  remindAt: string;
  // Optional recurrence. When set, dismissing this reminder schedules
  // the next occurrence automatically (capped by endsAt if present).
  // Today managers can set recurrence on company-wide reminders so a
  // single "weekly carrier rate review" sits on every team member's
  // dashboard without manual re-sends.
  recurrence?: ReminderRecurrence;
  // When this reminder was spawned by recurrence, this points back
  // at the original row so the chain is auditable.
  recurrenceSourceId?: string;
  createdAt: string;
  dismissedAt?: string;
}

export type ReminderRecurrencePattern =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "custom";

export interface ReminderRecurrence {
  pattern: ReminderRecurrencePattern;
  // Only consulted when pattern === "custom". Number of days between
  // each occurrence (>= 1).
  intervalDays?: number;
  // Optional hard stop. If set, occurrences after this ISO timestamp
  // are not spawned.
  endsAt?: string;
}

export interface CalendarEvent {
  id: string;
  tenantId: string;
  userId: string;
  kind?: "event" | "meeting";
  organizerId?: string;
  attendeeStatuses?: Array<{
    userId: string;
    status: "pending" | "accepted" | "declined";
    respondedAt?: string;
  }>;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  importance: TaskSeverity;
  location?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
