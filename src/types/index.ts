// =====================================================================
// Quotex Insurance — domain types
// These types mirror the Prisma schema in server/prisma/schema.prisma.
// Every agency-scoped entity carries `tenantId` for tenant isolation.
// =====================================================================

export type Role = "customer" | "agent" | "manager" | "master_admin";

export type SubscriptionTier = "minimum" | "mid" | "ultra";

export type AssetType =
  | "coastal_home"
  | "luxury_vehicle"
  | "yacht"
  | "jewelry"
  | "umbrella_liability"
  | "full_portfolio"
  | "other";

// Insurance category catalog — master-managed. Each row represents an option
// shown in the customer-facing quote flow. `assetType` controls which intake
// form is used; multiple categories can map to the same form (e.g. "Boats"
// and "Yachts" can both use the yacht intake) until a new form is built.
export interface InsuranceCategory {
  id: string;
  label: string;        // Display name (e.g. "Home", "Auto", "Jewelry", "Boats")
  description?: string;
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
  | "claim_closed";

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

export type StatusEventSource = "customer" | "agent" | "ai" | "system";

export type MessageChannel = "email" | "sms";

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
  serviceAreas: string[];
  tier: SubscriptionTier;
  active: boolean;
  allowedUsers: number;
  allowedProspectsPerMonth: number;
  allowedAiMessagesPerMonth: number;
  allowedCarriers: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  // Manager-configured agency-wide performance targets. The
  // Analytics page plots each goal's current value vs. target so
  // the team can see exactly where they sit relative to the bar
  // the manager set.
  // Active performance goals (company-wide + personal). Replaces the
  // old one-per-metric map.
  performanceGoals?: PerformanceGoal[];
  // Retired goals (completed / expired) for the "Previous goals" view.
  performanceGoalHistory?: ArchivedPerformanceGoal[];
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
  | "activitiesResolved"
  | "policiesBound";

export type PerformanceGoalPeriod = "monthly" | "quarterly" | "annual";

// Company goal = agency-wide. Personal goal = scoped to one or more
// specific staff members (their book / their resolved activities).
export type PerformanceGoalScope = "company" | "personal";

export interface PerformanceGoal {
  id: string;
  metric: PerformanceGoalMetric;
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

// A goal that's been retired into history (completed or expired).
// Snapshots the actual at archive time + whether the target was met,
// so the Analytics "Previous goals" view can split met vs. not-met.
export interface ArchivedPerformanceGoal {
  id: string;
  metric: PerformanceGoalMetric;
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
  // Username used for staff sign-in. Auto-generated when an agency is
  // provisioned. Master can copy / reset it.
  username?: string;
  // Plain-text generated password. ONLY visible to master_admin. In a real
  // backend this is a hashed value with a separate one-time reveal URL.
  generatedPassword?: string;
  // ISO timestamp of last password reset, for display.
  passwordUpdatedAt?: string;
  name: string;
  phone?: string;
  // Optional staff fields filled in by the user on first login.
  title?: string;
  bio?: string;
  avatarUrl?: string;
  // Personal email signature appended to outbound email messages
  // the staff member sends from /employee/messages, the client /
  // prospect Communications card, etc. Plain text (newlines
  // preserved). Optional — empty / unset means no signature is
  // appended. SMS sends ignore this field.
  emailSignature?: string;
  // Embedded images / logos referenced by the signature. Stored as
  // data URLs so the demo is self-contained; in production these
  // would be uploaded to an asset store and referenced by signed
  // URL. Rendered inline in the signature card and emitted as
  // [Image: filename] markers in the appended plain-text body.
  emailSignatureImages?: { name: string; dataUrl: string }[];
  // False until the staff member completes their profile on first login.
  // Master-created seed users default to true. Auto-provisioned users are
  // flagged false so the welcome flow runs once before they reach /employee.
  profileCompleted?: boolean;
  active: boolean;
  createdAt: string;
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
  name: string;
  email: string;
  phone?: string;
  mailingAddress?: string;
  garagingAddress?: string;
  additionalContacts?: { name: string; relation: string; phone?: string; email?: string }[];
  marketingOptInEmail: boolean;
  marketingOptInSms: boolean;
  // Compliance trail for explicit Terms + SMS/email consent captured
  // during sign-up. TCPA + CAN-SPAM require evidence of WHEN consent
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
  // Co-assigned agents. The client is visible to and routable by
  // every id in this list IN ADDITION to the primary owner above.
  // Used when a manager assigns a single client to multiple
  // agents at once (shared books, lead handoffs, etc.). Empty /
  // unset → primary owner only.
  additionalAgentIds?: string[];
  // Soft delete. Archived clients are hidden from the main client
  // list but reachable via /employee/archive. Unarchive restores
  // them. Default false (treated as missing → not archived).
  archived?: boolean;
  archivedAt?: string;
  createdAt: string;
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
}

export interface QuoteRequest {
  id: string;
  tenantId: string;
  customerId: string;
  assetType: AssetType;
  rawDescription?: string;
  parsedData: Record<string, unknown>;
  aiPremiumEstimateMin?: number;
  aiPremiumEstimateMax?: number;
  aiRecommendedCarrierId?: string;
  aiRecommendationReason?: string;
  missingDocuments: string[];
  status: PolicyStatus;
  assignedAgentId?: string;
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
  coverages?: PolicyCoverage[];
  endorsements?: PolicyEndorsement[];
  exclusions?: string[];
  additionalInsureds?: PolicyParty[];
  beneficiaries?: PolicyBeneficiary[];
  premiumBreakdown?: PolicyPremiumBreakdown;
  nextPaymentDueDate?: string;
  nextPaymentAmount?: number;
  createdAt: string;
}

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
  additionalAgentIds?: string[];
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
  // Quoting-API connection master configures so the AI quoting
  // workspace can pull real quotes for any prospect / client.
  // Simulated in the demo — production wires real HTTPS endpoints
  // with OAuth / API-key auth.
  quotingApi?: {
    provider?: string;       // e.g. "HX Pro", "Bridge", "Nationwide DI"
    endpoint?: string;       // HTTPS URL
    status: "not_configured" | "configured" | "connected" | "error";
    lastTestedAt?: string;
    notes?: string;
  };
  status: "active" | "inactive";
  createdAt: string;
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
// documents — the Carrier recommendations page splits its document
// library into a Personal section and a Commercial section so a
// rep finds the right form for the line they're writing without
// scrolling past everything else.
export type DocumentLineOfBusiness = "personal" | "commercial";

export interface Document {
  id: string;
  tenantId: string;
  uploadedById: string;
  fileName: string;
  fileType: string;
  // Optional. Today used to bucket carrier-specific documents into
  // personal vs commercial sections; unset on documents that aren't
  // line-of-business-specific (claim files, e-sign packets, etc.).
  lineOfBusiness?: DocumentLineOfBusiness;
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
  // Each side that needs to sign is set independently. The AI
  // auto-sends customer packets via email and stamps the agent
  // queue with an Activity Center task for any doc the agent owes
  // a signature on.
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
  // When this row is the original a renewal needs to update: the AI
  // flags it here so the Documents card can render an "Update for
  // Renewal" button and the renewal activity gate can lock until it's
  // republished. Cleared once a published successor exists.
  needsRenewalUpdate?: boolean;
  renewalForRenewalId?: string;
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
  // Communication this event was emitted alongside (e.g. the "Email
  // sent" / "Email received" auto-events). Lets the timeline modal
  // deep-link to the exact message in the Messages card.
  communicationId?: string;
  // Outbound MarketingMessage tied to the event (AI sends, custom
  // message sends). Mirrors communicationId for the marketing side.
  marketingMessageId?: string;
  createdAt: string;
  createdById?: string;
}

export interface MarketingCampaign {
  id: string;
  tenantId: string;
  name: string;
  channel: MessageChannel;
  // A campaign can target email + SMS at the same time. `channel`
  // stays as the primary medium for back-compat; `channels` carries
  // the full multi-select when the manager picked more than one.
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
  createdAt: string;
}

// =====================================================================
// Manager-controlled marketing configuration. One row per tenant.
// Governs the voice + signature + attachment set used by the AI
// when it auto-sends outreach (prospect intake follow-ups, policy
// edit acknowledgments, etc.). Agents see this as read-only.
// =====================================================================

export type MessageStyle = "concierge" | "professional" | "friendly" | "concise";

export interface MarketingAttachment {
  id: string;
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  description?: string;
  // Channels this attachment should be attached to. SMS will only
  // include the description as a one-liner; PDFs/images attach
  // to email.
  channels: ("email" | "sms")[];
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
  createdAt: string;
}

export interface Claim {
  id: string;
  tenantId: string;
  customerId: string;
  policyId: string;
  carrierId: string;
  carrierClaimsUrl?: string;
  externalClaimNumber?: string;
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
  createdAt: string;
}

export interface Communication {
  id: string;
  tenantId: string;
  customerId?: string;
  prospectId?: string;
  // Outbound emails to a carrier contact (underwriter, adjuster,
  // etc.). Mutually exclusive with customerId / prospectId.
  carrierContactId?: string;
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
  body: string;
  // Customer-initiated inbound messages (policy edit requests,
  // claim inquiries, freeform notes) are unresolved by default
  // until a staff member responds or marks them attended to.
  // Drives the Clients sidebar badge "pending customer messages"
  // count. Outbound comms ignore this field.
  resolvedAt?: string;
  resolvedById?: string;
  // AI inbound triage. Every inbound message is scanned once; if it
  // warrants follow-up, the AI auto-creates an Activity Center task and
  // links it here so the thread can flag "AI already opened an activity".
  aiActivityScannedAt?: string;
  aiActivityTaskId?: string;
  createdAt: string;
  createdById?: string;
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
  // Indicates the question maps to a specific carrier's
  // supplemental doc — used only for grouping + audit; the
  // client doesn't see the carrier name.
  carrierId?: string;
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
}

export interface QuotingSession {
  id: string;
  tenantId: string;
  prospectId?: string;
  customerId?: string;
  // Existing asset being re-quoted (clients) or undefined for a
  // new-business quote.
  assetId?: string;
  // Snapshot of the asset / line being quoted so runQuotes doesn't
  // have to re-derive from the contact record. Persisted on
  // startSession.
  assetType: AssetType;
  estimatedValue: number;
  // 2-letter state code used by the carrier eligibility check.
  state?: string;
  // Personal vs commercial — AI-inferred at startSession from
  // contact name keywords (LLC / Inc / Corp / etc.) plus asset
  // type. Drives whether the workspace generates a structured
  // quiz-style questionnaire (commercial) or the legacy email
  // body (personal).
  lineOfBusiness?: QuotingLineOfBusiness;
  // Structured questions the client answers via the portal
  // questionnaire (commercial flow). Combines base intake + per-
  // carrier supplemental sections for every linked carrier the
  // agency works with.
  questionnaireQuestions?: QuotingQuestion[];
  // Answers the client submitted, keyed by question id. Populated
  // when they submit the portal form.
  questionnaireResponses?: Record<string, string>;
  createdById: string;
  status: QuotingSessionStatus;
  // Fields the AI auto-collected from public sources (address,
  // owner-of-record, property characteristics, etc.).
  publicFields: Record<string, unknown>;
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
  createdAt: string;
  updatedAt: string;
}

// Per-user pinned message threads. Pins are scoped to the signed-
// in user — pinning a thread for yourself does NOT pin it for
// anyone else on the team. Limit of 5 active pins per user across
// all thread kinds (internal + client + prospect) so the pinned
// strip at the top of the threads list stays scannable. UI enforces
// the cap; api.messagePins.pin throws if you're already at the
// limit.
export interface MessagePin {
  id: string;
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "carrier";
  refId: string; // threadId for internal, contactId for client/prospect/carrier
  pinnedAt: string;
}

export interface MessageMute {
  id: string;
  tenantId: string;
  userId: string;
  kind: "internal" | "client" | "prospect" | "carrier";
  refId: string;
  mutedAt: string;
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
  | "override_request"
  | "reassign_request"
  | "goal_achieved";

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
  customerId?: string;
  prospectId?: string;
  assetId?: string;
  policyId?: string;
  messageId?: string;
  source: TaskSource;
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
  snoozedUntil?: string;
  createdById?: string;
  // Set the first time the agent flips the activity to "in progress".
  // Persists across snooze/reopen so the card always shows the
  // original handoff moment.
  startedAt?: string;
  startedById?: string;
  completedAt?: string;
  completedById?: string;
  // Manager override workflow. When an agent runs into the AI
  // resolution checklist (e.g. missing docs / no reply on file)
  // they can request a manager override. The manager grants it
  // from their Activity Center, which sets overrideGrantedAt
  // and unlocks the Mark resolved button.
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

// Returned by the AI asset-enrichment service: given a minimal seed (an
// address, VIN, year+make+model, …) the AI calls real public-records
// APIs and returns the fields it could verify. Anything the public
// sources can't answer is listed in `unavailableFields` — the UI shows
// "Not available from public records" inline rather than a synthesized
// guess. Production wiring of commercial providers (CoreLogic / Estated
// / ATTOM / Manheim) populates the same `fields` object server-side.
export interface AiAssetEnrichment {
  fields: Record<string, unknown>;
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
  taskId?: string;
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