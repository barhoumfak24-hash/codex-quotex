// =====================================================================
// API client — all data access in the frontend goes through here.
// Today: backed by the local mock db (`./db`).
// Production: replace each method body with `fetch(API_BASE + ...).then(r => r.json())`.
// Tenant scoping is enforced here for safety (mock) and on server (real).
// =====================================================================

import {
  aiRankCarrierQuotes,
  aiClassifyActivityResolution,
  aiClassifyInboundForActivity,
} from "./ai";
import type { ActivityResolution } from "./ai";
import { db } from "./db";
import { fmt } from "./format";
import { uid, nowIso } from "./id";
import {
  generatePassword,
  generateUsername,
  slugifyAgency,
  tierProvisionPlan,
} from "./credentials";
import type {
  Agency,
  AiNotification,
  Asset,
  AssetType,
  AuditLog,
  Carrier,
  CarrierAgencyLink,
  CarrierContact,
  Claim,
  Communication,
  CustomerProfile,
  Deposit,
  Document,
  DocumentType,
  DocumentVisibility,
  CustomDocumentType,
  CustomMessage,
  CustomMessageAudience,
  CustomMessageFilter,
  CustomMessageAttachment,
  CustomMessageRecurrence,
  CategoryAgencyLink,
  InsuranceCategory,
  MarketingCampaign,
  MarketingMessage,
  Note,
  Payment,
  Policy,
  PolicyStatus,
  MarketingConfig,
  MarketingAttachment,
  InternalMessage,
  InternalThread,
  MessagePin,
  MessageMute,
  Prospect,
  ProspectStatus,
  QuoteRequest,
  QuotingQuestion,
  QuotingSession,
  Reminder,
  Renewal,
  Role,
  StatusEvent,
  StatusEventSource,
  SubscriptionTier,
  Task,
  TaskSeverity,
  TaskStatus,
  User,
} from "@/types";

const tenantFilter = <T extends { tenantId?: string | null }>(rows: T[], tenantId?: string | null) =>
  tenantId == null ? rows : rows.filter((r) => r.tenantId === tenantId);

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
  createdById?: string
): string {
  if (channel !== "email" || direction !== "outbound" || !createdById) return body;
  const sender = db.list("users").find((u) => u.id === createdById);
  if (!sender) return body;
  const sig = (sender.emailSignature ?? "").trim();
  const images = sender.emailSignatureImages ?? [];
  if (!sig && images.length === 0) return body;
  const imageMarkers = images.map((img) => `[Image: ${img.name}]`).join("\n");
  const parts = [body.trimEnd(), "—"];
  if (sig) parts.push(sig);
  if (imageMarkers) parts.push(imageMarkers);
  return parts.join("\n\n");
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
  channel: "email" | "sms"
): string {
  const applicable = attachments.filter((a) => a.channels.includes(channel));
  if (applicable.length === 0) return "";
  if (channel === "sms") return "";
  return `Attached: ${applicable.map((a) => a.description ?? a.fileName).join(", ")}.`;
}

function topicLabel(t: import("@/types").TaskTopic): string {
  const map: Record<string, string> = {
    policy_edit_request: "a policy edit request",
    coverage_change: "a coverage change",
    cancellation_request: "a cancellation request",
    claim_status: "a claim status update",
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

export const api = {
  // ------------ Agencies (master) ------------
  agencies: {
    list(): Agency[] {
      return db.list("agencies");
    },
    get(id: string): Agency | undefined {
      return db.list("agencies").find((a) => a.id === id);
    },
    create(input: Omit<Agency, "id" | "createdAt" | "active"> & { active?: boolean }): Agency {
      const row: Agency = {
        ...input,
        id: uid("agency"),
        active: input.active ?? true,
        createdAt: nowIso(),
      };
      db.insert("agencies", row);
      // Auto-provision staff accounts (count comes from the tier plan).
      // Master admin can view and distribute the generated credentials from
      // the Users page.
      try {
        api.users.bulkProvision({ tenantId: row.id, agencyName: row.name, tier: row.tier });
      } catch {
        /* non-fatal — credentials can still be regenerated by master */
      }
      return row;
    },
    update(id: string, patch: Partial<Agency>) {
      return db.update("agencies", id, patch);
    },
    deactivate(id: string) {
      return db.update("agencies", id, { active: false });
    },
    setTier(id: string, tier: SubscriptionTier) {
      return db.update("agencies", id, { tier });
    },
    // Create a performance goal (company-wide or personal). Returns
    // the created goal so callers can reference its id.
    addPerformanceGoal(
      id: string,
      input: {
        metric: import("@/types").PerformanceGoalMetric;
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
      return row;
    },
    update(id: string, patch: Partial<import("@/types").Branch>) {
      return db.update("branches", id, patch);
    },
    remove(id: string) {
      return db.remove("branches", id);
    },
  },

  // ------------ Users ------------
  users: {
    list(tenantId?: string | null): User[] {
      return tenantFilter(db.list("users"), tenantId);
    },
    get(id: string): User | undefined {
      return db.list("users").find((u) => u.id === id);
    },
    byEmail(email: string): User | undefined {
      return db.list("users").find((u) => u.email.toLowerCase() === email.toLowerCase());
    },
    byUsername(username: string): User | undefined {
      const u = username.trim().toLowerCase();
      return db.list("users").find((row) => row.username?.toLowerCase() === u);
    },
    // Accepts either an email or a username — used by the staff sign-in form.
    byIdentifier(identifier: string): User | undefined {
      return this.byUsername(identifier) ?? this.byEmail(identifier);
    },
    create(input: Omit<User, "id" | "createdAt" | "active"> & { active?: boolean }): User {
      const row: User = {
        ...input,
        id: uid("user"),
        active: input.active ?? true,
        createdAt: nowIso(),
      };
      db.insert("users", row);
      return row;
    },
    update(id: string, patch: Partial<User>) {
      return db.update("users", id, patch);
    },
    // Regenerate a single user's password. Returns the new value so master
    // can copy it; the previous value is replaced atomically.
    regeneratePassword(id: string): string | null {
      const next = generatePassword();
      const updated = db.update("users", id, {
        generatedPassword: next,
        passwordUpdatedAt: nowIso(),
      });
      return updated ? next : null;
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
          const password = generatePassword();
          const user: User = {
            id: uid("user"),
            tenantId,
            role,
            email: `${username}@${slug}.example`,
            username,
            generatedPassword: password,
            passwordUpdatedAt: nowIso(),
            // Placeholder name until the staff member completes their
            // profile on first login.
            name: `${role === "manager" ? "Manager" : "Agent"} #${seq} · ${agencyName}`,
            profileCompleted: false,
            active: true,
            createdAt: nowIso(),
          };
          db.insert("users", user);
          made.push(user);
        }
      });

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
      role: "agent" | "manager";
      count: number;
      agencyName: string;
    }): User[] {
      const safeCount = Math.max(1, Math.min(50, Math.floor(count)));
      const existing = db.list("users").filter((u) => u.tenantId === tenantId && u.role === role);
      const startSeq = existing.length + 1;
      const slug = slugifyAgency(agencyName);
      const made: User[] = [];
      for (let i = 0; i < safeCount; i++) {
        const seq = startSeq + i;
        const username = generateUsername(role, agencyName, seq);
        const password = generatePassword();
        const user: User = {
          id: uid("user"),
          tenantId,
          role,
          email: `${username}@${slug}.example`,
          username,
          generatedPassword: password,
          passwordUpdatedAt: nowIso(),
          name: `${role === "manager" ? "Manager" : "Agent"} #${seq} · ${agencyName}`,
          profileCompleted: false,
          active: true,
          createdAt: nowIso(),
        };
        db.insert("users", user);
        made.push(user);
      }
      return made;
    },
  },

  // ------------ Customers ------------
  customers: {
    // Default view hides archived. Pass `{ includeArchived: true }` from
    // the Archive tab.
    list(tenantId: string, opts?: { includeArchived?: boolean }): CustomerProfile[] {
      const all = tenantFilter(db.list("customers"), tenantId);
      return opts?.includeArchived ? all : all.filter((c) => !c.archived);
    },
    // Access-controlled list. Agents only see clients a manager has
    // assigned to them; managers and master_admin see everything in
    // the tenant. Pass this from any agent-portal surface that
    // enumerates clients (Clients tab, dashboards, dropdowns,
    // policy-by-customer joins, etc.). The unfiltered `list` is
    // reserved for places that need a tenant-wide count regardless
    // of viewer (e.g. master analytics).
    listVisible(
      tenantId: string,
      viewer: { id: string; role: Role } | undefined,
      opts?: { includeArchived?: boolean }
    ): CustomerProfile[] {
      const all = this.list(tenantId, opts);
      if (!viewer) return [];
      if (viewer.role === "manager" || viewer.role === "master_admin") return all;
      if (viewer.role === "agent") {
        return all.filter(
          (c) =>
            c.assignedAgentId === viewer.id ||
            (c.additionalAgentIds ?? []).includes(viewer.id)
        );
      }
      return [];
    },
    // Single-row guard mirroring listVisible. Returns true if the
    // viewer is allowed to see this customer; used by detail pages
    // to redirect agents away from clients that aren't theirs.
    canSee(
      customer: CustomerProfile | undefined | null,
      viewer: { id: string; role: Role } | undefined
    ): boolean {
      if (!customer || !viewer) return false;
      if (viewer.role === "manager" || viewer.role === "master_admin") return true;
      if (viewer.role === "agent") {
        return (
          customer.assignedAgentId === viewer.id ||
          (customer.additionalAgentIds ?? []).includes(viewer.id)
        );
      }
      return false;
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
    create(input: Omit<CustomerProfile, "id" | "createdAt">): CustomerProfile {
      const row: CustomerProfile = {
        ...input,
        id: uid("customer"),
        createdAt: nowIso(),
      };
      db.insert("customers", row);
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
      const updated = db.update("customers", id, { assignedAgentId: agentId });
      if (updated && !before?.assignedAgentId && agentId) {
        spawnRoutingTask(updated, agentId, byUserId);
      }
      return updated;
    },
    // Multi-agent variant. The first id in the list becomes the
    // primary owner; the rest land in additionalAgentIds. Every
    // newly-routed-to agent gets a Task spawned on their queue.
    // Used by the manager Routing card when the manager checks
    // multiple agents in the assignment modal.
    assignAgents(id: string, agentIds: string[], byUserId?: string) {
      if (agentIds.length === 0) return null;
      const before = db.list("customers").find((c) => c.id === id);
      const previouslyAssigned = new Set([
        before?.assignedAgentId,
        ...(before?.additionalAgentIds ?? []),
      ].filter((v): v is string => !!v));
      const [primary, ...rest] = agentIds;
      const updated = db.update("customers", id, {
        assignedAgentId: primary,
        additionalAgentIds: rest.length > 0 ? rest : undefined,
      });
      if (updated) {
        agentIds
          .filter((aid) => !previouslyAssigned.has(aid))
          .forEach((aid) => spawnRoutingTask(updated, aid, byUserId));
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
      const row: Asset = { ...input, id: uid("asset"), createdAt: nowIso() };
      db.insert("assets", row);
      return row;
    },
    update(id: string, patch: Partial<Asset>) {
      return db.update("assets", id, patch);
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
  },

  // ------------ Policies ------------
  policies: {
    listByCustomer(customerId: string): Policy[] {
      return db.list("policies").filter((p) => p.customerId === customerId);
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
      return row;
    },
    update(id: string, patch: Partial<Policy>) {
      return db.update("policies", id, patch);
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
    listArchived(tenantId: string): Prospect[] {
      return tenantFilter(db.list("prospects"), tenantId).filter((p) => p.archived);
    },
    get(id: string): Prospect | undefined {
      return db.list("prospects").find((p) => p.id === id);
    },
    create(input: Omit<Prospect, "id" | "createdAt">): Prospect {
      const row: Prospect = { ...input, id: uid("prospect"), createdAt: nowIso() };
      db.insert("prospects", row);
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
      const updated = db.update("prospects", id, { assignedAgentId: agentId });
      // When a prospect goes from unassigned → assigned (the
      // routing transition), spawn an Activity Center task on the
      // new agent's queue so they actually see the new work.
      if (updated && !before?.assignedAgentId && agentId) {
        spawnProspectRoutingTask(updated, agentId, byUserId);
      }
      return updated;
    },
    // Multi-agent variant. First id becomes the primary owner,
    // rest go into additionalAgentIds. Every newly-routed agent
    // gets a Task spawned on their queue.
    assignAgents(id: string, agentIds: string[], byUserId?: string) {
      if (agentIds.length === 0) return null;
      const before = db.list("prospects").find((p) => p.id === id);
      const previouslyAssigned = new Set(
        [before?.assignedAgentId, ...(before?.additionalAgentIds ?? [])].filter(
          (v): v is string => !!v
        )
      );
      const [primary, ...rest] = agentIds;
      const updated = db.update("prospects", id, {
        assignedAgentId: primary,
        additionalAgentIds: rest.length > 0 ? rest : undefined,
      });
      if (updated) {
        agentIds
          .filter((aid) => !previouslyAssigned.has(aid))
          .forEach((aid) => spawnProspectRoutingTask(updated, aid, byUserId));
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
        additionalAgentIds:
          prospect.additionalAgentIds && prospect.additionalAgentIds.length > 0
            ? prospect.additionalAgentIds
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
    linkToAgency(carrierId: string, tenantId: string): CarrierAgencyLink {
      const existing = db
        .list("carrierLinks")
        .find((l) => l.carrierId === carrierId && l.tenantId === tenantId);
      if (existing) {
        db.update("carrierLinks", existing.id, { active: true });
        return { ...existing, active: true };
      }
      const row: CarrierAgencyLink = {
        id: uid("link"),
        carrierId,
        tenantId,
        active: true,
        createdAt: nowIso(),
      };
      db.insert("carrierLinks", row);
      return row;
    },
    unlinkFromAgency(carrierId: string, tenantId: string) {
      const existing = db
        .list("carrierLinks")
        .find((l) => l.carrierId === carrierId && l.tenantId === tenantId);
      if (existing) db.update("carrierLinks", existing.id, { active: false });
    },
  },

  // ------------ Carrier contacts (per-tenant address book) ------------
  // Per-agency contact list for carrier reps — underwriters,
  // adjusters, claims reps, marketing reps, account execs, etc.
  // Managed from the manager portal's Carrier recommendations page
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
      return db.list("categories").sort((a, b) => a.sortOrder - b.sortOrder);
    },
    listActive(): InsuranceCategory[] {
      return db
        .list("categories")
        .filter((c) => c.active)
        .sort((a, b) => a.sortOrder - b.sortOrder);
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
        .sort((a, b) => a.sortOrder - b.sortOrder);
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
      if (existing) {
        db.update("categoryLinks", existing.id, { active: true });
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
      return row;
    },
    unlinkFromAgency(categoryId: string, tenantId: string) {
      const existing = db
        .list("categoryLinks")
        .find((l) => l.categoryId === categoryId && l.tenantId === tenantId);
      if (existing) db.update("categoryLinks", existing.id, { active: false });
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
      // Carrier recommendations page to split a carrier's documents
      // into the right section.
      lineOfBusiness?: "personal" | "commercial";
    }): Document {
      const row: Document = {
        id: uid("doc"),
        ...input,
        status: input.status ?? "pending",
        storagePath: `s3://placeholder/${input.tenantId}/${uid("file")}/${input.fileName}`,
        uploadedAt: nowIso(),
      };
      db.insert("documents", row);

      // Document uploads always get a timeline entry so the agent /
      // manager status report reflects what's been shared. Mirrors
      // the document's visibility: customer-visible files emit a
      // customer-visible event, employee-only files stay internal.
      const uploader = db.list("users").find((u) => u.id === input.uploadedById);
      const verb = uploader?.role === "customer" ? "uploaded" : "shared";
      const docLabel = input.type.replace(/_/g, " ");
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
        createdAt: nowIso(),
        createdById: input.uploadedById,
      });

      return row;
    },
    update(id: string, patch: Partial<Document>) {
      return db.update("documents", id, patch);
    },
    // Tenant-wide agency templates the manager uploaded under
    // /employee/documents → "Agency templates & forms". Returned
    // newest-first.
    listTemplates(tenantId: string): Document[] {
      return db
        .list("documents")
        .filter((d) => d.tenantId === tenantId && !d.customerId && d.type === "agency_template")
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
      }
    ): Document | null {
      const tpl = db.list("documents").find((d) => d.id === templateId);
      if (!tpl) return null;
      return this.create({
        tenantId: tpl.tenantId,
        uploadedById: input.uploadedById,
        fileName: tpl.fileName,
        fileType: tpl.fileType,
        type: input.type ?? tpl.type,
        visibility: input.visibility ?? "customer_visible",
        status: "approved",
        customerId: input.customerId,
        assetId: input.assetId,
        policyId: input.policyId,
      });
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
    // the renewal activity's resolve gate stays locked until every
    // flagged doc has a published successor for this renewal.
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
      const candidates = db
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
      });
      // Tag the renewal/version metadata.
      const tagged = db.update("documents", draft.id, {
        renewalId,
        supersedesId: orig.id,
        policyTermYear: termYear,
      });
      return tagged ?? draft;
    },
    // Publish a renewal draft: marks it approved, stamps publishedAt,
    // clears the original's needs-update flag, applies any edits the
    // agent made (filename today; coverage fields would slot in here
    // in a real backend), and logs a customer-visible event.
    publishRenewalUpdate(
      draftDocId: string,
      uploadedById: string,
      edits?: { fileName?: string }
    ): Document | null {
      const draft = db.list("documents").find((d) => d.id === draftDocId);
      if (!draft || !draft.supersedesId || !draft.renewalId) return null;
      const patch: Partial<Document> = {
        status: "approved",
        publishedAt: nowIso(),
      };
      if (edits?.fileName && edits.fileName.trim()) patch.fileName = edits.fileName.trim();
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
      const outputName = `${base}-${customerSlug}-${stamp}-AI-filled${ext}`;

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
      });

      const usedExistingDocs = (input.sourceDocumentIds ?? [])
        .map((id) => db.list("documents").find((d) => d.id === id)?.fileName)
        .filter((n): n is string => !!n);
      const usedFiles = (input.sourceFiles ?? []).map((f) => f.fileName);
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
      const docs = db.list("documents").filter((d) => d.customerId === customerId);

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
      return tenantFilter(db.list("messages"), tenantId);
    },
    // ------------ Per-tenant marketing configuration ------------
    // Single-row "settings" the manager controls under
    // AI marketing → Marketing configuration. Governs the voice,
    // signature, attachments, and auto-send cadence the AI applies
    // when generating outbound messages (prospect intake follow-ups,
    // policy-edit acknowledgments, doc-request drafts, etc.).
    getConfig(tenantId: string): MarketingConfig {
      const existing = db.list("marketingConfigs").find((c) => c.tenantId === tenantId);
      if (existing) return existing;
      const agency = db.list("agencies").find((a) => a.id === tenantId);
      const defaultConfig: MarketingConfig = {
        id: uid("mcfg"),
        tenantId,
        messageStyle: "concierge",
        senderName: agency ? `${agency.name} Concierge Team` : "Your Insurance Concierge",
        signOff: `Best,\n${agency?.name ?? "Your Insurance Concierge"}`,
        autoSendOnNewProspect: true,
        followUpCadenceDays: 3,
        attachments: [],
        updatedAt: nowIso(),
      };
      db.insert("marketingConfigs", defaultConfig);
      return defaultConfig;
    },
    updateConfig(tenantId: string, patch: Partial<MarketingConfig>, byUserId?: string): MarketingConfig {
      const current = this.getConfig(tenantId);
      const updated = db.update("marketingConfigs", current.id, {
        ...patch,
        updatedAt: nowIso(),
        updatedById: byUserId,
      });
      return updated ?? current;
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
      // Kept for back-compat with callers; promotional AI auto-outreach
      // always goes out via SMS now and never lands in email.
      channel?: "email" | "sms";
      actorId?: string;
    }): MarketingMessage | null {
      const prospect = db.list("prospects").find((p) => p.id === input.prospectId);
      if (!prospect) return null;
      const cfg = this.getConfig(input.tenantId);
      const firstName = prospect.name.split(/\s+/)[0];
      const assetWord = prospect.assetType.replace(/_/g, " ");
      // Promotional auto-outreach is SMS-only by policy — it never
      // lands in the prospect's email.
      const channel = "sms" as const;
      const attachmentLine = attachmentManifestLine(cfg.attachments, channel);

      const subject: string | undefined = undefined;
      let body = `${cfg.senderName}: Hi ${firstName} — ${
        cfg.messageStyle === "concise"
          ? "ready to wrap up your quote?"
          : "still happy to walk you through next steps on your " + assetWord + " coverage."
      } Reply YES for a callback. Reply STOP to opt out.`;
      if (attachmentLine && cfg.attachments.some((a) => a.channels.includes("sms"))) {
        body += `\n(${cfg.attachments
          .filter((a) => a.channels.includes("sms"))
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
        deliveryStatus: "sent",
        sentAt: nowIso(),
        createdAt: nowIso(),
      };
      db.insert("messages", msg);
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: input.tenantId,
        source: "ai",
        message: `AI auto-sent SMS to ${prospect.name} (${cfg.messageStyle} style${
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
    // Records a MarketingCampaign row + one tenant-scoped status event
    // documenting the launch (channels, recipient count, attachment
    // manifest, scheduling). It deliberately does NOT write per-
    // recipient message rows: promotional blasts are fire-and-forget
    // and must not clutter each contact's Messages thread or be
    // logged as individual communications. (Transactional AI messages
    // about a quote / policy / document still go through
    // communications.create on email.)
    //
    // A campaign can target email + SMS at once, and any combination
    // of "all clients", "all prospects", and hand-picked recipients.
    //
    // Manager-controlled — caller is responsible for gating in
    // the UI; this entry point doesn't enforce a role check.
    composeAiCampaign(input: {
      tenantId: string;
      name: string;
      channels: ("email" | "sms")[];
      brief: string;
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
    }): { campaign: MarketingCampaign; messageCount: number } {
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
      const agencyName = tenant?.name ?? "your concierge agency";
      const cfg = this.getConfig(input.tenantId);
      const recurrence = input.recurrence ?? "none";
      const now = Date.now();
      const channels = input.channels.length ? input.channels : ["sms" as const];
      const sendAt =
        input.scheduledFor && Date.parse(input.scheduledFor) > now
          ? input.scheduledFor
          : undefined;
      const isScheduled = !!sendAt;
      const isRecurring = recurrence !== "none";

      // Resolve the audience union (dedup by id) just to count
      // recipients for the launch record — no per-recipient rows are
      // written.
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
        },
        status: isScheduled ? "scheduled" : "active",
        scheduledFor: sendAt,
        recurrence,
        nextRunAt: sendAt ?? (isRecurring ? nowIso() : undefined),
      });

      // Audit trail — one tenant-scoped status event with the
      // campaign id, channels, recipient count, attachment manifest,
      // and scheduling metadata. Individual sends are not recorded.
      const scheduleNote = isScheduled ? ` Scheduled for ${sendAt}.` : "";
      const recurrenceNote = isRecurring ? ` Recurring ${recurrence}.` : "";
      const verb = isScheduled ? "scheduled" : "launched";
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
        }). Promotional sends are not individually logged. Agency: ${agencyName}.${scheduleNote}${recurrenceNote}`,
        visibility: "internal",
        marketingCampaignId: campaign.id,
        createdAt: nowIso(),
        createdById: input.actorId,
      });

      return { campaign, messageCount };
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
    queueMessage(input: Omit<MarketingMessage, "id" | "createdAt" | "deliveryStatus">): MarketingMessage {
      const row: MarketingMessage = {
        ...input,
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
    // Auto-drafts an email + SMS asking the customer for the
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
    }): { email: MarketingMessage; sms: MarketingMessage } | null {
      const docs = input.missingDocuments.filter((d) => d && d.trim());
      if (docs.length === 0) return null;
      const customer = db.list("customers").find((c) => c.id === input.customerId);
      const tenant = db.list("agencies").find((a) => a.id === input.tenantId);
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
        createdAt: nowIso(),
      };
      const sms: MarketingMessage = {
        id: uid("msg"),
        tenantId: input.tenantId,
        campaignId: "campaign_doc_requests",
        customerId: input.customerId,
        channel: "sms",
        content: smsBody,
        deliveryStatus: "draft",
        createdAt: nowIso(),
      };
      db.insert("messages", email);
      db.insert("messages", sms);

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

      return { email, sms };
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
      channel: "email" | "sms";
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
      // email signature is woven into the body on save (channel=email
      // only). SMS sends are unchanged.
      const bodyWithSignature = applySenderEmailSignature(
        input.channel,
        "outbound",
        input.body,
        input.createdById
      );

      const row: CustomMessage = {
        id: uid("cmsg"),
        tenantId: input.tenantId,
        createdById: input.createdById,
        channel: input.channel,
        subject: input.subject,
        body: bodyWithSignature,
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
      // and the renewal activity stays locked until they're republished.
      api.documents.flagForRenewal(row.id, row.agentId);
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
      return made;
    },
    update(id: string, patch: Partial<Renewal>) {
      return db.update("renewals", id, patch);
    },
    // Move an "upcoming" renewal off the alert path. Two terminal
    // states the agent reaches for from the UI:
    //   markRenewed → policy renewed for another term
    //   markNotDue  → false alarm / agent already handled it
    markRenewed(id: string) {
      return db.update("renewals", id, { status: "renewed" });
    },
    markNotDue(id: string) {
      return db.update("renewals", id, { status: "not_due" });
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
      channel: "email" | "sms";
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
        message: `Renewal reminder sent via ${channel.toUpperCase()} for policy ${policy.policyNumber ?? policy.id} (renews ${renewalDateStr}).`,
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
      return row;
    },
    update(id: string, patch: Partial<Claim>) {
      return db.update("claims", id, patch);
    },
    // Convenience: close a claim. Stamps closedAt and flips status
    // so the Clients sidebar badge stops counting this client.
    close(id: string) {
      return db.update("claims", id, { status: "closed", closedAt: nowIso() });
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
      db.insert("communications", {
        id: commId,
        tenantId: input.tenantId,
        customerId: input.customerId,
        channel: "email",
        direction: "inbound",
        subject,
        body: input.body,
        createdAt: nowIso(),
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
        createdAt: nowIso(),
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
        .filter((c) => c.customerId === customerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    // All comms (inbound + outbound) across the tenant. Used by the
    // Messages inbox to build threads keyed by contact.
    listByTenant(tenantId: string): Communication[] {
      return tenantFilter(db.list("communications"), tenantId).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
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
            c.customerId === customerId && c.direction === "inbound" && !c.resolvedAt
        )
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    markResolved(id: string, byUserId: string) {
      return db.update("communications", id, {
        resolvedAt: nowIso(),
        resolvedById: byUserId,
      });
    },
    // Mark every unread inbound message in a contact's thread as read
    // (resolved). Used by the ⋯ thread settings "Mark as read".
    markContactRead(
      contact: { customerId?: string; prospectId?: string; carrierContactId?: string },
      byUserId: string
    ): number {
      const rows = db
        .list("communications")
        .filter(
          (c) =>
            c.direction === "inbound" &&
            !c.resolvedAt &&
            ((contact.customerId && c.customerId === contact.customerId) ||
              (contact.prospectId && c.prospectId === contact.prospectId) ||
              (contact.carrierContactId && c.carrierContactId === contact.carrierContactId))
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
    }): number {
      const rows = db
        .list("communications")
        .filter(
          (c) =>
            (contact.customerId && c.customerId === contact.customerId) ||
            (contact.prospectId && c.prospectId === contact.prospectId) ||
            (contact.carrierContactId && c.carrierContactId === contact.carrierContactId)
        );
      rows.forEach((c) => db.remove("communications", c.id));
      return rows.length;
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
    ): { communicationId: string; task: Task }[] {
      const inbound = db
        .list("communications")
        .filter(
          (c) =>
            c.tenantId === tenantId &&
            c.direction === "inbound" &&
            c.createdById !== "ai" &&
            !c.aiActivityScannedAt
        );
      const created: { communicationId: string; task: Task }[] = [];
      for (const c of inbound) {
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
        const patch: Partial<Communication> = { aiActivityScannedAt: nowIso() };
        if (triage.warrants) {
          const assignedToId = customer?.assignedAgentId ?? prospect?.assignedAgentId;
          // Carrier messages (and any unowned contact) route to a
          // manager via the Routing card.
          const awaiting = !assignedToId;
          const taskRow: Task = {
            id: uid("task"),
            tenantId,
            title: triage.title,
            description: triage.reason,
            customerId: c.customerId,
            prospectId: c.prospectId,
            messageId: c.id,
            source: "ai_notification",
            topic: triage.topic,
            severity: triage.severity,
            severityReason: "Auto-created by AI from an inbound message.",
            status: "open",
            assignedToId,
            awaitingManagerAssignment: awaiting || undefined,
            createdById: "ai",
            createdAt: nowIso(),
          };
          db.insert("tasks", taskRow);
          logTaskAudit({
            tenantId,
            actorId: actorId ?? "ai",
            action: "task.created_from_inbound",
            taskId: taskRow.id,
            metadata: { communicationId: c.id, topic: triage.topic },
          });
          patch.aiActivityTaskId = taskRow.id;
          created.push({ communicationId: c.id, task: taskRow });
        }
        db.update("communications", c.id, patch);
      }
      return created;
    },
    create(input: Omit<Communication, "id" | "createdAt">): Communication {
      // Auto-append the sender's personal email signature on every
      // outbound email. Centralized here so every composer in the
      // app (Messages page, inline Communications thread on detail
      // pages, agent reply UI, etc.) gets it for free — no per-
      // caller plumbing. SMS / inbound / no-signature passes through.
      const finalBody = applySenderEmailSignature(
        input.channel,
        input.direction,
        input.body,
        input.createdById
      );
      const row: Communication = {
        ...input,
        body: finalBody,
        id: uid("comm"),
        createdAt: nowIso(),
      };
      db.insert("communications", row);

      // Every email / SMS / call to or from a customer gets a
      // timeline row so the client status report shows the full
      // conversation history. Inbound from the customer surfaces
      // as source=customer, outbound from staff as source=agent.
      // Customer-visible visibility keeps the customer's own
      // portal timeline honest about messages we sent them.
      if (input.customerId || input.prospectId) {
        const channelLabel =
          input.channel === "email" ? "Email"
          : input.channel === "sms" ? "SMS"
          : input.channel === "call" ? "Call"
          : input.channel === "note" ? "Note"
          : String(input.channel);
        const dirVerb =
          input.direction === "outbound" ? "sent" : "received";
        const subject = input.subject ? `: ${input.subject}` : "";
        db.insert("statusEvents", {
          id: uid("se"),
          tenantId: input.tenantId,
          source: input.direction === "inbound" ? "customer" : "agent",
          message: `${channelLabel} ${dirVerb}${subject}.`,
          visibility: input.channel === "note" ? "internal" : "customer_visible",
          customerId: input.customerId,
          prospectId: input.prospectId,
          communicationId: row.id,
          createdAt: nowIso(),
          createdById: input.createdById,
        });
      }

      return row;
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

  // ------------ Tasks (Activity Center entries) ------------
  // Each Task represents one row in the Activity Center surface
  // (sidebar #2). Acknowledging an AiNotification spawns one of
  // these; the agent then progresses it through in_progress →
  // resolved (or snoozes for a fixed interval). Every state
  // change writes an audit row via logTaskAudit so managers can
  // reconstruct the full trail from /master/data or the client
  // profile timeline.
  tasks: {
    listByTenant(tenantId: string): Task[] {
      // Sort order: manual priorityRank desc (pinned=1 → 0 → -1 sent
      // to bottom), then newest first.
      return tenantFilter(db.list("tasks"), tenantId).sort((a, b) => {
        const pa = a.priorityRank ?? 0;
        const pb = b.priorityRank ?? 0;
        if (pa !== pb) return pb - pa;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
    },
    listOpen(tenantId: string): Task[] {
      // "Open" = anything not resolved AND not currently snoozed.
      // Snoozed tasks come back into view automatically once
      // snoozedUntil passes (we compare against `now` here).
      const now = Date.now();
      return this.listByTenant(tenantId).filter((t) => {
        if (t.completedAt) return false;
        if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now) return false;
        return true;
      });
    },
    listSnoozed(tenantId: string): Task[] {
      const now = Date.now();
      return this.listByTenant(tenantId).filter(
        (t) =>
          !t.completedAt &&
          t.snoozedUntil &&
          new Date(t.snoozedUntil).getTime() > now
      );
    },
    listCompleted(tenantId: string): Task[] {
      return this.listByTenant(tenantId).filter((t) => !!t.completedAt);
    },
    // Implicit-status helper: respects both completedAt and the
    // future-snooze window. Use this on render so the badge / chip
    // matches what listOpen / listSnoozed return.
    statusOf(t: Task): TaskStatus {
      if (t.completedAt) return "resolved";
      if (t.snoozedUntil && new Date(t.snoozedUntil).getTime() > Date.now()) return "snoozed";
      if (t.status === "in_progress") return "in_progress";
      return "open";
    },
    // AI resolution checklist. Returns the steps the system
    // expects to see complete before "Mark resolved" is unlocked,
    // along with each step's done/pending state. Used by the
    // Activity Center to gate the resolve button and to render
    // the disclaimer modal that explains why it's locked.
    // True when any outbound message has gone out to this activity's
    // contact — either via the Messages page, the inline thread on
    // the detail page, or the agent reply flow. Sending a message
    // counts as an active touchpoint and lifts the resolve-gate
    // checklist below.
    hasOutboundTouchpoint(t: Task): boolean {
      const replied = this.history(t.id).some((h) => h.action === "task.replied");
      if (replied) return true;
      // Fallback: an outbound Communication a *person* sent to the
      // contact during / after the task was opened. AI-authored
      // messages (createdById "ai" — e.g. the express-quote auto
      // confirmation SMS) deliberately do NOT count: the gate exists
      // so an agent personally responds before resolving. An
      // automated acknowledgment isn't a substitute for that.
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
    // True when the agent has used the "Send questionnaire" action on
    // this activity.
    hasSentQuestionnaire(t: Task): boolean {
      return this.history(t.id).some((h) => h.action === "task.questionnaire_sent");
    },
    // True once the "Send documents requiring e-sign" action has run
    // ON THIS activity. A new activity is a new activity — the
    // customer having received e-sign docs on a previous activity
    // does NOT pre-satisfy it. (No-contact activities have nothing to
    // send, so they're auto-clear.)
    hasSentEsignDocs(t: Task): boolean {
      if (!t.customerId) return true;
      return this.history(t.id).some((h) => h.action === "task.esign_docs_sent");
    },
    // AI change-verification gate. Reads what the activity is ABOUT
    // (topic + title + description) and confirms the corresponding
    // real-world change has actually landed on the account since the
    // activity opened — e.g. an "add a vehicle" activity stays locked
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

      // Customer activities require the agent to actually reach out:
      // send the questionnaire AND send the missing-documents request
      // before the activity can be resolved.
      if (t.customerId) {
        // Step 2 — questionnaire sent
        steps.push({
          label: "Questionnaire sent to the customer",
          detail:
            "Use 'Send questionnaire' on the activity to email the intake questions. This step clears once it's sent.",
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
                } need the customer's e-signature. Use 'Send documents requiring e-sign' — this step clears once they go out. Signed copies file themselves automatically.`
              : "No documents are waiting on the customer's e-signature.",
          done: this.hasSentEsignDocs(t),
        });
      }

      // Final gate — the AI must recognize that the concrete change
      // the activity asked for actually happened on the account before
      // resolve unlocks (e.g. a vehicle was added). Skipped for
      // activities with no verifiable change.
      const res = this.resolutionCheck(t);
      if (res.required) {
        steps.push({
          label: res.classification.label,
          detail: res.reasoning,
          done: res.detected,
        });
      }

      // Renewal-document update step. When the AI inspected this
      // renewal and flagged term-bound documents for an update, the
      // activity stays locked until each flagged doc has a published
      // successor for the same renewal.
      if (t.renewalId) {
        const flagged = db
          .list("documents")
          .filter(
            (d) =>
              d.renewalForRenewalId === t.renewalId &&
              d.needsRenewalUpdate
          );
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
    // "Send questionnaire" action. Emails the customer the activity's
    // pre-drafted questionnaire (or a generic one) and records the
    // questionnaire-sent audit so the resolve gate clears. Does NOT
    // auto-resolve — the missing-docs request is still required.
    sendQuestionnaire(id: string, userId?: string): Task | null {
      const t = db.list("tasks").find((x) => x.id === id);
      if (!t || !t.customerId) return null;
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
      });
      return db.list("tasks").find((x) => x.id === id) ?? null;
    },
    // "Send documents requiring e-sign" action. Emails the customer
    // the documents that still need their signature (marks them sent),
    // then records the audit so the resolve gate clears. Once the
    // customer signs in their portal the executed copy files itself
    // automatically (see esign.markCustomerSigned).
    sendEsignDocuments(id: string, userId?: string): Task | null {
      const t = db.list("tasks").find((x) => x.id === id);
      if (!t || !t.customerId) return null;
      const customer = db.list("customers").find((c) => c.id === t.customerId);
      // Docs that need the customer's e-signature and haven't been
      // emailed yet.
      const pending = db
        .list("documents")
        .filter(
          (d) =>
            d.customerId === t.customerId &&
            !!d.customerEsignRequired &&
            !d.customerEsignSentAt &&
            !d.customerEsignSignedAt
        );
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
      });
      return db.list("tasks").find((x) => x.id === id) ?? null;
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
      if (viewer.role === "manager" || viewer.role === "master_admin") return true;
      if (viewer.role !== "agent") return false;
      if (contact.customerId) {
        const c = db.list("customers").find((x) => x.id === contact.customerId);
        if (!c) return false;
        return (
          c.assignedAgentId === viewer.id ||
          (c.additionalAgentIds ?? []).includes(viewer.id)
        );
      }
      if (contact.prospectId) {
        const p = db.list("prospects").find((x) => x.id === contact.prospectId);
        if (!p) return false;
        return (
          p.assignedAgentId === viewer.id ||
          (p.additionalAgentIds ?? []).includes(viewer.id)
        );
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
          actor.role === "agent" &&
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
      const row: Task = {
        id: uid("task"),
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        prospectId: input.prospectId,
        policyId: input.policyId,
        assignedToId: input.assignedToId,
        topic: input.topic,
        source: "manual",
        status: "open",
        severity: input.severity ?? "info",
        severityReason: input.severityReason,
        awaitingManagerAssignment: input.awaitingManagerAssignment,
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
      if (!row || row.completedAt) return null;
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
      // On the first start, auto-text the customer that an agent has
      // picked up their request — the same kind of acknowledgment the
      // AI used to send when the activity was created.
      if (firstStart && row.customerId) {
        const customer = db.list("customers").find((c) => c.id === row.customerId);
        if (customer) {
          const firstName = customer.name.split(/\s+/)[0];
          api.communications.create({
            tenantId: row.tenantId,
            customerId: row.customerId,
            channel: "sms",
            direction: "outbound",
            body: `Hi ${firstName}, one of our agents has started working on your request. We'll follow up shortly with next steps.`,
            createdById: userId,
          });
        }
      }
      return updated;
    },
    markComplete(id: string, userId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row || row.completedAt) return null;
      const updated = db.update("tasks", id, {
        completedAt: nowIso(),
        completedById: userId,
        status: "resolved",
        snoozedUntil: undefined,
      });
      logTaskAudit({
        tenantId: row.tenantId,
        actorId: userId,
        action: "task.resolved",
        taskId: id,
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
      if (!row || row.completedAt) return null;
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
    assign(id: string, agentId: string | undefined, byUserId?: string): Task | null {
      const row = db.list("tasks").find((t) => t.id === id);
      if (!row) return null;
      // Reassigning clears any pending reassignment request and the
      // "awaiting manager assignment" flag (the manager just made the call).
      const updated = db.update("tasks", id, {
        assignedToId: agentId,
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
        metadata: { toAgentId: agentId ?? null },
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
      const row: Task = {
        id: taskId,
        tenantId: input.tenantId,
        title: input.title,
        description: input.description,
        customerId: input.customerId,
        source: "ai_notification",
        severity: input.severity ?? "warning",
        severityReason: input.severityReason,
        status: "open",
        topic: "policy_edit_request",
        aiSummary: input.aiSummary,
        aiReplyBody: input.aiReplyBody,
        aiReplySubject: input.aiReplySubject,
        assignedToId: input.assignedToId,
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
    // Pin to top of the Activity Center list. Sort: pinned tasks
    // first (priorityRank=1), then default (0), then deprioritized
    // (-1). Within a tier we fall back to the severity-based sort.
    moveToFront(id: string, actorId?: string): Task | null {
      const updated = db.update("tasks", id, {
        priorityRank: 1,
        priorityChangedAt: nowIso(),
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
      const updated = db.update("tasks", id, {
        priorityRank: -1,
        priorityChangedAt: nowIso(),
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
      const updated = db.update("tasks", id, {
        priorityRank: 0,
        priorityChangedAt: nowIso(),
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
      title?: string;
      note?: string;
      importance?: TaskSeverity;
      // Optional recurrence. When set, dismiss() auto-schedules the
      // next occurrence (capped by endsAt).
      recurrence?: import("@/types").ReminderRecurrence;
      recurrenceSourceId?: string;
    }): Reminder {
      const row: Reminder = {
        id: uid("rem"),
        tenantId: input.tenantId,
        userId: input.userId,
        taskId: input.taskId,
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
        remindAt: next,
        title: updated.title,
        note: updated.note,
        importance: updated.importance,
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
      return db.list("quotingSessions").find((s) => s.id === id);
    },
    getForProspect(prospectId: string): QuotingSession | undefined {
      return db
        .list("quotingSessions")
        .filter((s) => s.prospectId === prospectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    },
    getForCustomer(customerId: string): QuotingSession | undefined {
      return db
        .list("quotingSessions")
        .filter((s) => s.customerId === customerId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    },
    // Phase 1: AI pulls public records + identifies missing fields.
    async startSession(input: {
      tenantId: string;
      prospectId?: string;
      customerId?: string;
      assetId?: string;
      createdById: string;
      assetType: AssetType;
      contactName: string;
      address?: string;
      estimatedValue?: number;
    }): Promise<QuotingSession> {
      const {
        aiPreparePublicFields,
        aiInferLineOfBusiness,
        aiGenerateCommercialQuestionnaire,
        aiGeneratePersonalQuestionnaire,
      } = await import("./ai");
      const prep = await aiPreparePublicFields({
        assetType: input.assetType,
        prospectName: input.contactName,
        address: input.address,
        estimatedValue: input.estimatedValue,
        rngSeed: `${input.prospectId ?? input.customerId ?? ""}-${input.assetType}-${input.assetId ?? ""}`,
      });
      const lineOfBusiness = aiInferLineOfBusiness({
        contactName: input.contactName,
        assetType: input.assetType,
        estimatedValue: input.estimatedValue,
      });
      const state = input.address ? extractStateFromString(input.address) : undefined;
      // Both lines of business get a structured portal questionnaire.
      // Commercial mixes base intake + per-carrier supplementals;
      // personal turns the AI-identified missingFields into form
      // questions one-to-one.
      let questionnaireQuestions: QuotingQuestion[] | undefined;
      if (lineOfBusiness === "commercial") {
        const links = db
          .list("carrierLinks")
          .filter((l) => l.tenantId === input.tenantId && l.active);
        const linkedCarrierIds = new Set(links.map((l) => l.carrierId));
        const carriers = db
          .list("carriers")
          .filter((c) => linkedCarrierIds.has(c.id) && c.status === "active");
        questionnaireQuestions = aiGenerateCommercialQuestionnaire({
          contactName: input.contactName,
          carrierList: carriers,
          knownPublicFields: prep.publicFields,
        });
      } else if (prep.missingFields.length > 0) {
        questionnaireQuestions = aiGeneratePersonalQuestionnaire({
          assetType: input.assetType,
          missingFields: prep.missingFields,
        });
      }
      const needsClient = (questionnaireQuestions?.length ?? 0) > 0;
      const row: QuotingSession = {
        id: uid("quote_session"),
        tenantId: input.tenantId,
        prospectId: input.prospectId,
        customerId: input.customerId,
        assetId: input.assetId,
        assetType: input.assetType,
        estimatedValue: input.estimatedValue ?? 0,
        state,
        lineOfBusiness,
        createdById: input.createdById,
        status: needsClient ? "gathering_info" : "quoting",
        publicFields: prep.publicFields,
        missingFields: prep.missingFields,
        questionnaireQuestions,
        quotes: [],
        aiSummary: prep.summary,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.insert("quotingSessions", row);
      // No missing fields + not commercial → run quotes immediately.
      if (row.status === "quoting") {
        return this.runQuotes(row.id);
      }
      return row;
    },
    // Portal-link delivery used by both personal + commercial
    // sessions. Builds an outbound Communication pointing the
    // client at /customer/questionnaire/<sessionId> instead of
    // pasting questions inline. Auth on the link is handled by
    // the customer portal — the client signs in to their account
    // before they see the form.
    sendPortalLink(sessionId: string, portalUrl: string): QuotingSession | null {
      const session = this.get(sessionId);
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
      const sectionCount = new Set(
        (session.questionnaireQuestions ?? []).map((q) => q.section)
      ).size;
      const questionCount = (session.questionnaireQuestions ?? []).length;
      const subject = `Action needed: complete your quoting questionnaire`;
      const body = [
        `Hi ${firstName},`,
        ``,
        `To run firm quotes for you, we need a few additional details. I've put together a short questionnaire (${questionCount} questions across ${sectionCount} sections — pre-filled with what we already have on file).`,
        ``,
        `Sign in to your portal and fill it out here:`,
        portalUrl,
        ``,
        `Once you submit, our AI runs the answers through every carrier we work with and I'll follow up with the top recommendations.`,
        ``,
        creator?.name ? `Best,\n${creator.name}` : `Best,\n${agencyName}`,
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
      return db.update("quotingSessions", sessionId, {
        questionnaireMessageId: comm.id,
        questionnaireDraft: `Subject: ${subject}\n\n${body}`,
        questionnaireSentAt: nowIso(),
        status: "awaiting_reply",
        updatedAt: nowIso(),
      });
    },
    // Commercial flow: client submits structured answers from the
    // portal questionnaire. Stamps the responses, marks reply
    // received, runs the quotes, and writes an AI notification for
    // the agent assigned to this session.
    submitQuestionnaireResponses(
      sessionId: string,
      responses: Record<string, string>
    ): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      const updatedAt = nowIso();
      db.update("quotingSessions", sessionId, {
        questionnaireResponses: { ...(session.questionnaireResponses ?? {}), ...responses },
        replyReceivedAt: updatedAt,
        status: "quoting",
        updatedAt,
      });
      // Notify the agent who owns the session — a new Activity
      // Center task lands in their queue so they can flip the AI
      // ranking on with one click.
      const contact = session.prospectId
        ? db.list("prospects").find((p) => p.id === session.prospectId)
        : session.customerId
        ? db.list("customers").find((c) => c.id === session.customerId)
        : null;
      const taskId = uid("task");
      const taskRow: Task = {
        id: taskId,
        tenantId: session.tenantId,
        title: `${contact?.name ?? "Client"} submitted quoting questionnaire`,
        description: `The commercial-quoting questionnaire is complete. Open the prospect / client record to review answers and run the carrier ranking.`,
        customerId: session.customerId,
        prospectId: session.prospectId,
        source: "ai_notification",
        severity: "warning",
        severityReason: "Questionnaire just submitted — ready to run quotes.",
        status: "open",
        assignedToId: session.createdById,
        createdById: "ai",
        createdAt: updatedAt,
      };
      db.insert("tasks", taskRow);
      db.insert("statusEvents", {
        id: uid("se"),
        tenantId: session.tenantId,
        source: "customer",
        message: `${contact?.name ?? "Client"} submitted ${Object.keys(responses).length} questionnaire response${
          Object.keys(responses).length === 1 ? "" : "s"
        }; AI ranking ready to run.`,
        visibility: "internal",
        customerId: session.customerId,
        prospectId: session.prospectId,
        createdAt: updatedAt,
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
      return db.update("quotingSessions", sessionId, {
        questionnaireDraft: `Subject: ${subj}\n\n${body}`,
        updatedAt: nowIso(),
      });
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
      return db.update("quotingSessions", sessionId, {
        questionnaireMessageId: comm.id,
        questionnaireSentAt: nowIso(),
        status: "awaiting_reply",
        updatedAt: nowIso(),
      });
    },
    // Phase 3: agent marks the reply received → AI runs the quotes.
    markReplyReceivedAndQuote(sessionId: string): QuotingSession | null {
      const session = this.get(sessionId);
      if (!session) return null;
      db.update("quotingSessions", sessionId, {
        replyReceivedAt: nowIso(),
        status: "quoting",
        updatedAt: nowIso(),
      });
      return this.runQuotes(sessionId);
    },
    // Phase 4: call each carrier's quoting-API (simulated) and
    // rank the responses. Writes the quotes array + summary +
    // flips status to "complete".
    runQuotes(sessionId: string): QuotingSession {
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
      const eligibleCarriers = db
        .list("carriers")
        .filter((c) => linkedCarrierIds.has(c.id));
      const { quotes, summary } = aiRankCarrierQuotes({
        carriers: eligibleCarriers,
        assetType: session.assetType,
        estimatedValue: session.estimatedValue || 1_000_000,
        state,
      });
      return db.update("quotingSessions", sessionId, {
        quotes,
        aiSummary: summary,
        status: "complete",
        updatedAt: nowIso(),
      })!;
    },
    // Discard the session and let the agent start over.
    reset(sessionId: string) {
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

  // ------------ E-signature auto-send ------------
  // Two-sided workflow:
  //   • customerEsignRequired → AI auto-sends an outbound Communication
  //     with a secure-link blurb so the client e-signs from their portal.
  //   • agentEsignRequired → AI spawns an Activity Center task assigned
  //     to the agent on the hook so the doc appears in their queue.
  // Both sides are idempotent — re-runs skip docs already sent / tasked.
  // The dashboard fires both helpers on mount, plus a sweep that
  // synthesizes renewal packets for any upcoming renewal that doesn't
  // already have a requiresEsign doc on file.
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
    // Flip the customer / agent esig requirement on a doc. Used by
    // the manager Documents page row controls.
    setRequirements(
      documentId: string,
      patch: {
        customerEsignRequired?: boolean;
        agentEsignRequired?: boolean;
        agentEsignAssignedToId?: string;
      }
    ): Document | null {
      return db.update("documents", documentId, patch);
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
        const assignedToId =
          d.agentEsignAssignedToId ?? customer?.assignedAgentId ?? undefined;
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
          createdById: actorId,
          createdAt: nowIso(),
        };
        db.insert("tasks", taskRow);
        db.update("documents", d.id, { agentEsignTaskId: taskId });
        created.push({ task: taskRow, document: d });
      });
      return { created };
    },
    // Top-level driver fired from the dashboard. Seeds renewal
    // packets, then runs both auto-senders in series.
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
      const updated = db.update("documents", documentId, {
        agentEsignSignedAt: nowIso(),
      });
      if (doc.agentEsignTaskId) {
        db.update("tasks", doc.agentEsignTaskId, {
          status: "resolved",
          completedAt: nowIso(),
          completedById: actorId,
        });
      }
      return updated;
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