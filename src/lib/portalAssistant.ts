// =====================================================================
// Portal assistant (frontend-side stub).
//
// PRODUCTION INTENT: same contract as src/lib/ai.ts - in production
// this becomes a `fetch('/api/ai/portal-assistant', ...)` call to a
// backend RAG endpoint grounded on the agency's help docs. The demo
// answers from a local keyword-scored knowledge base so agents and
// managers get useful "how do I...?" answers without a model key.
//
// The matcher is intentionally simple: score every KB entry by how
// many of its keywords appear in the question, return the best hit,
// and fall back to a topic menu when nothing scores. Deterministic,
// fast, and good enough for portal FAQ.
// =====================================================================

import { api } from "@/lib/api";
import { postServerAi } from "@/lib/aiGateway";
import { fmt } from "@/lib/format";
import { isStaffRole, staffRoleLabel } from "@/lib/roles";
import { isContactProfileActivity } from "@/lib/taskFilters";
import { findVideoChapter, videoChapterPath } from "@/lib/trainingVideos";
import type { QuotingSession, Role, Task, TaskSeverity, User } from "@/types";

export interface AssistantAnswer {
  // Markdown-ish plain text (rendered as paragraphs + bullet lines).
  text: string;
  // Optional follow-up prompts surfaced as tappable chips.
  related?: string[];
  // Which KB entry produced this (for analytics / debugging).
  topicId?: string;
  // Primary navigation action when the answer is about a live record
  // or category in the portal.
  action?: AssistantAction;
  // Additional navigation actions when a question matches multiple
  // live records or the best answer benefits from more than one link.
  actions?: AssistantAction[];
  // Confirmation-gated action. The UI must ask the user to confirm
  // before executing this mutation/navigation through executePortalAssistantAction().
  pendingAction?: AssistantExecutableAction;
}

export interface AssistantAction {
  label: string;
  to: string;
}

export type AssistantExecutableAction =
  | {
      kind: "navigate";
      label: string;
      confirmation: string;
      to: string;
    }
  | {
      kind: "task.markInProgress" | "task.markResolved" | "task.reopen";
      label: string;
      confirmation: string;
      taskId: string;
    }
  | {
      kind: "task.snooze";
      label: string;
      confirmation: string;
      taskId: string;
      days: 1 | 3 | 7;
    }
  | {
      kind: "task.setSeverity";
      label: string;
      confirmation: string;
      taskId: string;
      severity: TaskSeverity;
    }
  | {
      kind: "task.setDueAt";
      label: string;
      confirmation: string;
      taskId: string;
      dueAt?: string;
    }
  | {
      kind: "task.create";
      label: string;
      confirmation: string;
      title: string;
      description?: string;
      customerId?: string;
      prospectId?: string;
      assignedToId?: string;
      severity?: TaskSeverity;
      dueAt?: string;
    }
  | {
      kind: "note.create";
      label: string;
      confirmation: string;
      body: string;
      customerId?: string;
      prospectId?: string;
      visibility: "internal" | "customer_visible";
    }
  | {
      kind: "calendar.create";
      label: string;
      confirmation: string;
      title: string;
      description?: string;
      startsAt: string;
      endsAt?: string;
      importance?: TaskSeverity;
    }
  | {
      kind: "reminder.create";
      label: string;
      confirmation: string;
      remindAt: string;
      title: string;
      note?: string;
      taskId?: string;
      importance?: TaskSeverity;
    }
  | {
      kind: "reminder.createCompany";
      label: string;
      confirmation: string;
      remindAt: string;
      title: string;
      note?: string;
      recipientIds: string[];
      recipientLabel: string;
      importance?: TaskSeverity;
    };

export interface AssistantActionResult {
  success: boolean;
  text: string;
  action?: AssistantAction;
}

// Context lets the assistant answer data questions ("how many assets
// does Alexandra Whitford have?") by looking up the actual records
// the viewer is allowed to see.
export interface AssistantContext {
  tenantId: string;
  viewer: { id: string; role: Role };
  currentPath?: string;
}

interface KbEntry {
  id: string;
  // Short label used in the topic menu + as a suggested question.
  question: string;
  // Words/phrases that, when present in the user's question, score
  // this entry. Multi-word phrases count as one keyword but match
  // as a substring.
  keywords: string[];
  // The answer body.
  answer: string;
  related?: string[];
  // Some answers only apply to managers (e.g. analytics). Agents
  // still get an answer, just flagged as manager-only.
  managerOnly?: boolean;
}

const KB: KbEntry[] = [
  {
    id: "activity-center",
    question: "What is the Activity Center?",
    keywords: [
      "activity center",
      "activities",
      "to do",
      "queue",
      "inbox",
      "tasks",
      "task",
    ],
    answer:
      "The Activity Center is your single source of truth for work that needs attention. Each card is an activity - an inbound customer request, a renewal nudge, an AI follow-up, or a manager assignment. Cards start in the To-do column; mark one In progress to move it across, then Mark resolved when it's handled.\n\nClicking View activity from a client profile jumps you straight to the matching card, auto-expanded.",
    related: [
      "How do I mark an activity resolved?",
      "How do I set a reminder on an activity?",
    ],
  },
  {
    id: "resolve-gate",
    question: "How do I mark an activity resolved?",
    keywords: [
      "resolve",
      "resolved",
      "mark resolved",
      "can't close",
      "close activity",
      "closing note",
      "resolution note",
    ],
    answer:
      "Move the activity to In progress, then click Mark resolved. Quotex will not checklist-block the closeout, but it does require a short resolution note before confirming.\n\nThat note is attached to the closed activity and also appears on the client's Activity timeline and remarks as an internal time-stamped remark.",
    related: ["What is the Activity Center?", "How do company reminders work?"],
  },
  {
    id: "reminders",
    question: "How do I set a reminder?",
    keywords: [
      "reminder",
      "reminders",
      "remind",
      "follow up",
      "follow-up",
      "snooze",
      "recurrence",
      "recurring",
      "repeat",
    ],
    answer:
      "There are three kinds of reminders, all on your dashboard's My reminders card:\n- Personal - click New reminder, choose Personal, and create a freeform follow-up for yourself.\n- Activity-anchored - use Set reminder on any Activity Center card.\n- Company - click New reminder, choose Company, and push one reminder to a chosen set of teammates.\n\nEvery reminder supports recurrence (daily / weekly / biweekly / monthly / custom interval) with an optional stop date. When you dismiss a recurring reminder the next occurrence is scheduled automatically.",
    related: [
      "How do company reminders work?",
      "What is the Activity Center?",
    ],
  },
  {
    id: "company-reminders",
    question: "How do company reminders work?",
    keywords: [
      "company reminder",
      "company reminders",
      "team reminder",
      "group reminder",
      "broadcast",
      "everyone",
    ],
    answer:
      "Company reminders let anyone on staff push a single reminder to a chosen group of teammates. Open New reminder on your dashboard's My reminders card, choose Company, tick the recipients (everyone is pre-selected - untick who shouldn't get it), set the time, importance, and optional recurrence.\n\nEach recipient gets their own independent copy - they dismiss or snooze theirs without touching anyone else's.",
    related: ["How do I set a reminder?"],
  },
  {
    id: "convert-prospect",
    question: "How do I convert a prospect to a client?",
    keywords: [
      "convert",
      "conversion",
      "prospect to client",
      "promote prospect",
      "graduate",
      "make a client",
    ],
    answer:
      "Open the prospect and use Convert to client. A manager must assign the prospect to an agent first - every new client lands owned by someone. On conversion the prospect's whole activity timeline transfers onto the new client record, the event is timestamped, and the prospect drops out of the Prospects category (it now lives under Clients). You can still see converted prospects via the Converted filter chip.",
    related: ["Where do converted prospects go?"],
  },
  {
    id: "converted-where",
    question: "Where do converted prospects go?",
    keywords: [
      "converted prospect",
      "where did the prospect go",
      "missing prospect",
      "prospect disappeared",
      "converted filter",
    ],
    answer:
      "Once converted, a prospect moves to the Clients category and is hidden from the default Prospects list. Use the Converted filter chip on the Prospects page to see them again. Their first-touch-through-conversion history rides along onto the client's activity timeline.",
    related: ["How do I convert a prospect to a client?"],
  },
  {
    id: "policy-details",
    question: "How do I view full policy details?",
    keywords: [
      "policy detail",
      "policy details",
      "view policy",
      "full policy",
      "policy page",
      "edit policy",
      "view on carrier",
    ],
    answer:
      "Click View on any policy (Policies card, Assets, or the Policies page) to open the full policy detail page - coverage, dates, premium, timeline, and documents. From there Download summary exports a text recap and View on carrier opens the carrier's agent portal (configured under Master -> Carriers).",
    related: ["How do I view an asset's details?"],
  },
  {
    id: "asset-details",
    question: "How do I view an asset's details?",
    keywords: [
      "asset detail",
      "asset details",
      "view asset",
      "assets",
      "asset page",
    ],
    answer:
      "On a client profile, click View on any row in the Assets card to open that asset's detail page - structured details, the policies attached to it (each with its own View), documents, and the asset's activity timeline. Customers see the same per-asset view under My assets in their portal.",
    related: ["How do I view full policy details?"],
  },
  {
    id: "carrier-docs",
    question: "How do I upload carrier-specific documents?",
    keywords: [
      "carrier document",
      "carrier documents",
      "carrier doc",
      "underwriting manual",
      "appetite guide",
      "application form",
      "supplemental",
      "carrier recommendations",
      "carrier library",
    ],
    answer:
      "Go to Carrier library -> Carrier-specific documents. Pick a carrier, choose Personal or Commercial lines, and upload the underwriting manual, appetite guide, application, or supplemental. Documents are split into Personal and Commercial sections, and everything you upload also shows up on the Document review queue for the standard approval flow.",
    related: ["How do I add or remove carriers?"],
  },
  {
    id: "manage-carriers",
    question: "How do I add or remove carriers?",
    keywords: [
      "add carrier",
      "remove carrier",
      "link carrier",
      "carrier list",
      "carriers",
      "carrier rep",
      "carrier contact",
    ],
    answer:
      "Managers can use Add / remove carriers on the Carrier library page to toggle which carriers from the master library this agency works with. Tap a carrier card to manage its reps (underwriters, adjusters, claims reps) - those contacts surface on the Messages page so you can email them in one click.",
    related: ["How do I upload carrier-specific documents?"],
  },
  {
    id: "analytics-goals",
    question: "How do I set performance goals?",
    keywords: [
      "performance goal",
      "goals",
      "target",
      "analytics goal",
      "set a goal",
    ],
    answer:
      "On the Analytics page (manager-only), the Performance goals card lets you set agency-wide targets per metric - premium written, new clients, activities resolved, policies bound - for a monthly / quarterly / annual period. The card plots actual vs. target and shows a progress meter for each goal.",
    managerOnly: true,
    related: ["What is the performance leaderboard?"],
  },
  {
    id: "leaderboard",
    question: "What is the performance leaderboard?",
    keywords: [
      "leaderboard",
      "ranking",
      "rank agents",
      "top performer",
      "who's best",
    ],
    answer:
      "The Performance leaderboard on the Analytics page (manager-only) ranks the team on any metric - premium under management, bound policies, activities resolved, response rate, avg handle time, and more. Top three get a trophy / medals; click any row to open that agent's full drill-down.",
    managerOnly: true,
    related: ["How do I set performance goals?"],
  },
  {
    id: "messages",
    question: "How does messaging work?",
    keywords: [
      "message",
      "messages",
      "internal message",
      "chat with team",
      "dm",
      "email customer",
      "carrier message",
    ],
    answer:
      "The Messages page holds internal staff threads and carrier-rep threads. Customer-facing messages go through the marketing composer (Reply to customer pre-selects the client). Every message - including ones the AI sent on your behalf - is visible in the client's activity timeline; click View on a logged message to read it inline.",
    related: ["How do I add or remove carriers?"],
  },
  {
    id: "documents-review",
    question: "How does document review work?",
    keywords: [
      "document review",
      "review document",
      "approve document",
      "reject document",
      "esign",
      "e-sign",
      "signature",
    ],
    answer:
      "Document review lists customer-uploaded files for approve/reject, your agency's shared templates, and the carrier-specific document library (split personal/commercial). Managers use the e-signature controls to mark whether a document requires customer signature, agent signature, or both. That selection only records the requirement; sending/requesting happens from explicit workflow actions.",
    related: ["How do I upload carrier-specific documents?"],
  },
  {
    id: "express-quote",
    question: "How does the express quote flow work?",
    keywords: [
      "express quote",
      "private quote",
      "get a quote",
      "quote flow",
      "new quote",
      "questionnaire",
    ],
    answer:
      "When a customer taps Get a private quote they pick personal vs. commercial, choose what to insure, and fill in five fields (name, phone, email, asset identifier, driver's license). The AI pulls public records, matches carriers, and gives a ballpark. An Activity Center task lands in the assigned agent's queue with a pre-drafted questionnaire reply - sending it auto-resolves the task.",
    related: ["What is the Activity Center?"],
  },
  {
    id: "navigation",
    question: "What's in the agency portal?",
    keywords: [
      "navigation",
      "sidebar",
      "categories",
      "menu",
      "what can I do",
      "where is",
      "overview of the portal",
      "rail",
    ],
    answer:
      "The agency portal's left rail: Dashboard (your reminders + AI sweeps), Activity Center (your work queue), Messages (internal + carrier threads), Prospects, Clients, Policies, Renewals, Document review, AI marketing, Carrier library, Analytics (manager-only), Archive, and Agency settings. Each client/prospect has its own profile; assets and policies each have their own detail page.",
    related: [
      "What is the Activity Center?",
      "How do I create a new activity?",
    ],
  },
  {
    id: "create-activity",
    question: "How do I create a new activity?",
    keywords: [
      "create activity",
      "create new activity",
      "new activity",
      "add activity",
      "add a task",
      "make an activity",
    ],
    answer:
      "Click Create new activity in the Activity Center header (it opens a client/prospect search so you pick who it's for, then title, details, importance, and - for managers - an assignee). You can also create one straight from a client profile (card above Upcoming renewals) or a prospect profile (Quick actions card), where the contact is pre-filled.",
    related: ["What is the Activity Center?"],
  },
  {
    id: "renewals",
    question: "How do renewals work?",
    keywords: [
      "renewal",
      "renewals",
      "renewing",
      "expiring",
      "upcoming renewal",
      "policy expir",
    ],
    answer:
      "The Renewals category tracks every policy's renewal pipeline. Upcoming renewals also surface on each client profile's Upcoming renewals card. When a renewal is near, renewal packets can be prepared and tagged as needing e-signature; customer requests are sent only when an agent uses the explicit send workflow.",
    related: ["How does document review work?"],
  },
  {
    id: "claims",
    question: "How do claims work?",
    keywords: [
      "claim",
      "claims",
      "file a claim",
      "open claim",
      "close claim",
      "fnol",
    ],
    answer:
      "Claims live on the Claims card of a client profile. Open claims automatically appear as activities in the Activity Center until they're closed. Customers file claims from the carrier's site via the carrier claim link on their policy page; that click is logged on the client's timeline.",
    related: ["How does the Activity Center work?"],
  },
  {
    id: "deposits-payments",
    question: "How do deposits and payments work?",
    keywords: [
      "deposit",
      "deposits",
      "payment",
      "payments",
      "billing",
      "invoice",
      "receipt",
      "pay",
    ],
    answer:
      "Deposits are taken to start a quote/bind workflow; payments track premium collection against a policy. A deposit doesn't constitute active coverage - binding requires a licensed agent. Receipts are stored as documents on the client record.",
    related: ["How do I view full policy details?"],
  },
  {
    id: "marketing",
    question: "How does AI marketing work?",
    keywords: [
      "marketing",
      "campaign",
      "campaigns",
      "outreach",
      "ai marketing",
      "custom message",
      "blast",
      "email campaign",
    ],
    answer:
      "AI marketing has campaigns (audience-targeted sends to clients/prospects) and a custom-message composer (one-off emails/SMS with the recipient pre-selected). Marketing configuration controls auto-send on new prospect, sender signature, and attachments. Every send is logged on the contact's timeline.",
    related: ["How does messaging work?"],
  },
  {
    id: "ai-quoting",
    question: "How does AI quoting work?",
    keywords: [
      "ai quoting",
      "quoting session",
      "rank carriers",
      "carrier ranking",
      "quoting workspace",
      "run quotes",
    ],
    answer:
      "The AI quoting workspace prepares public fields, infers personal vs. commercial line of business, generates the right questionnaire (commercial mixes base intake + carrier supplementals; personal turns missing fields into questions), and ranks carrier quotes once answers are in. You send the questionnaire to the client via a portal link.",
    related: ["How does the express quote flow work?"],
  },
  {
    id: "internal-messages",
    question: "How do I message my team?",
    keywords: [
      "internal message",
      "message team",
      "message a coworker",
      "dm",
      "staff chat",
      "team chat",
      "talk to manager",
    ],
    answer:
      "The Messages page holds internal staff threads (1:1 or group) alongside carrier-rep threads. Open a thread, type, send - unread counts show on the Messages rail item. Customer-facing replies go through the marketing composer instead.",
    related: ["How does messaging work?"],
  },
  {
    id: "archive",
    question: "How does the archive work?",
    keywords: ["archive", "archived", "restore", "soft delete", "deleted client"],
    answer:
      "Archiving soft-deletes a client or prospect - they drop off the active rosters and stop receiving outreach, but nothing is destroyed. Find them under Archive and restore any record. Reverting a converted client to a prospect archives the client record automatically.",
    related: ["Where do converted prospects go?"],
  },
  {
    id: "password-reset",
    question: "How do clients reset their password?",
    keywords: [
      "password",
      "reset password",
      "forgot password",
      "change password",
      "login help",
      "can't log in",
    ],
    answer:
      "Clients use the change/forgot-password flow on the client portal login. Staff accounts are provisioned by the master admin (and the manager can view/distribute generated credentials from the Users page in the master portal).",
    related: ["What's in the agency portal?"],
  },
  {
    id: "esign-packets",
    question: "How does e-signature work?",
    keywords: [
      "esign",
      "e-sign",
      "signature",
      "sign document",
      "esign packet",
      "docusign",
      "sign packet",
    ],
    answer:
      "Managers flip e-signature requirements per document in Document review. The controls mark whether the customer, the agent, or both must sign. They do not send anything by themselves; customer signature requests are sent from the Activity Center workflow, and signed customer copies file back into Documents.",
    related: ["How does document review work?"],
  },
  {
    id: "data-security",
    question: "Is this production data?",
    keywords: [
      "real data",
      "sandbox",
      "test data",
      "is this live",
      "data security",
      "storage",
    ],
    answer:
      "Production records are tenant-scoped and should be stored behind server-side authorization, encrypted storage, audit logging, and Row Level Security. AI outputs are still preliminary and require licensed-agent review before binding or customer-facing decisions.",
  },
  {
    id: "client-portal",
    question: "What does the client portal show?",
    keywords: [
      "client portal",
      "customer portal",
      "what does the customer see",
      "my assets",
      "customer view",
      "portal for clients",
    ],
    answer:
      "Clients get Overview, My assets (per-asset detail), Policies (expandable full detail + request a change), Documents (with e-sign), Claims, Get a quote, and Profile. They see only customer-visible timeline events and documents - internal notes stay staff-only.",
    related: ["How do I view an asset's details?"],
  },
  {
    id: "data-questions",
    question: "Can you look up client numbers?",
    keywords: [
      "look up",
      "how many",
      "how much",
      "total",
      "count",
      "stats",
      "numbers",
      "tell me about",
    ],
    answer:
      "Yes - ask me things like \"how many assets does <client> have?\", \"what's <client>'s total premium?\", \"who is <client>'s agent?\", \"when does <client> renew?\", \"tell me about <client>\", or agency-wide totals like \"how many open activities are there?\" and \"total premium under management\". I only surface records you're allowed to see.",
    related: [
      "How many open activities are there?",
      "What is the total premium under management?",
    ],
  },
  {
    id: "new-send-modal",
    question: "How do I start a new conversation in Messages?",
    keywords: [
      "new send",
      "new conversation",
      "new chat",
      "new message",
      "compose",
      "start a chat",
      "start conversation",
      "new send modal",
      "+ button",
      "plus button",
      "who don't have",
      "don't have a chat",
    ],
    answer:
      'Open the Messages page. Each of the three cards - "Clients & prospects", "Internal", and "Carriers" - has a "+ New send" button in the top-right.\n\nClicking it opens one unified popup that:\n  1. Lists every recipient you don\'t already have a conversation with (scoped to that card\'s pool - visible clients/prospects, teammates, or carrier reps).\n  2. Lets you pick a channel: Email or SMS for client/prospect, email-only for carriers, none for internal.\n  3. Adds a Subject field (email) or Urgency picker (internal DM).\n  4. Has a Message textarea for the first message.\n\nHit Send and the conversation is created and opened in that card.',
    related: [
      "How do I view emails vs SMS separately?",
      "How do I pin or mute a conversation?",
      "How do I expand a message card to full screen?",
    ],
  },
  {
    id: "message-settings-menu",
    question: "How do I pin, mute, archive, or delete a conversation?",
    keywords: [
      "pin",
      "unpin",
      "mute",
      "unmute",
      "delete conversation",
      "delete thread",
      "archive contact",
      "mark as read",
      "three dots",
      "3 dots",
      "kebab",
      "message settings",
      "thread settings",
      "conversation settings",
    ],
    answer:
      'Every conversation row in the Messages cards has a Message settings button on the right. Tapping it opens the message-settings menu with:\n  - Pin to top - floats this thread above the rest (up to 5 pins).\n  - Mute notifications - silences the unread badge for this thread (dims the row, shows a bell-off icon).\n  - Mark as read - clears unread inbound on a contact thread, or marks an internal thread read.\n  - Archive client / Archive prospect - soft-archives the contact (client/prospect only) so it drops off the active list; restore from the Archive page.\n  - Delete conversation / Delete thread - destructive; removes the message history (contact record is kept). Internal threads are deleted entirely.\n\nPinned threads show a Pin icon, muted threads show a BellOff icon, and dim slightly.',
    related: [
      "How do I search archived clients?",
      "How do I expand a message card to full screen?",
    ],
  },
  {
    id: "expand-message-card",
    question: "How do I expand a message card to full screen?",
    keywords: [
      "expand",
      "full screen",
      "fullscreen",
      "maximize",
      "blow up",
      "bigger",
      "expand card",
      "minimize",
      "collapse card",
    ],
    answer:
      "Every messages card - the inline thread on a client/prospect profile, the three Messages inbox cards (Clients & prospects, Internal, Carriers), and the dashboard's Internal messages card - has a maximize icon in its top-right header.\n\nClick it and the card fills the screen as an overlay. Esc or clicking the backdrop collapses it back. Your draft is preserved across the toggle.\n\nIn the expanded inbox cards, the contacts list shrinks to a narrow names-only rail so the conversation gets the full width.",
    related: [
      "How do I view emails vs SMS separately?",
      "How does the AI 'Enhance with AI' button work?",
    ],
  },
  {
    id: "email-sms-toggle",
    question: "How do I view emails vs SMS separately?",
    keywords: [
      "email vs sms",
      "email and sms",
      "channel toggle",
      "filter by channel",
      "show only sms",
      "show only email",
      "split email",
      "tabs email sms",
      "email tab",
      "sms tab",
    ],
    answer:
      "Every conversation pane has an Email / SMS toggle at the top of the thread.\n\n  - Email shows only messages sent or received via email.\n  - SMS shows only texts.\n\nThe toggle also drives what the composer sends - so you stay in one medium at a time. Carrier threads are email-only, so the SMS tab is disabled there.",
    related: [
      "How do I start a new conversation in Messages?",
      "How does promotional vs transactional AI messaging work?",
    ],
  },
  {
    id: "enhance-message-ai",
    question: "How does the 'Enhance with AI' button work?",
    keywords: [
      "enhance with ai",
      "enhance message",
      "ai rewrite",
      "ai polish",
      "improve message",
      "fix my message",
      "wand button",
    ],
    answer:
      "After you type a draft in any message composer, click the Enhance with AI button under the textarea. The AI rewrites your draft into a clearer, more polished message - channel-aware:\n  - Email gets a greeting + warm sign-off and proper sentence casing.\n  - SMS stays short and courteous.\n\nThe rewritten text replaces your draft so you can review + edit before sending.",
    related: [
      "How does the AI auto-suggest email subjects?",
      "How do I start a new conversation in Messages?",
    ],
  },
  {
    id: "ai-inbound-triage",
    question: "How does AI triage inbound messages?",
    keywords: [
      "ai triage",
      "inbound triage",
      "auto activity",
      "auto-create activity",
      "auto create activity",
      "inbound notice",
      "notification only",
      "ai opened an activity",
      "violet ring",
      "go to activity",
      "highlight message",
      "scans messages",
      "from messages",
      "from inbound",
      "from a message",
      "from an incoming",
      "ai create activity",
      "ai auto",
    ],
    answer:
      "Every inbound client / prospect / carrier message is scanned once. Claims, cancellations, real coverage changes, failed payments, carrier supplementals, non-renewals, and other owned work become Activity Center tasks. Routine document uploads, ordinary billing or renewal updates, informational carrier replies, pricing questions, and generic questions become dashboard notifications instead.\n\nIn the thread, an activity gets a violet ring and an AI opened an activity link. A notification-only message gets a blue ring and an AI logged a notification note. Pure acknowledgements (thanks, got it) are ignored.",
    related: [
      "How does the routing card work?",
      "How do I mark an activity resolved?",
      "How do I send an activity to a manager to assign?",
    ],
  },
  {
    id: "send-to-manager",
    question: "How do I send an activity to a manager to assign?",
    keywords: [
      "send to manager",
      "manager assign",
      "hand off activity",
      "punt activity",
      "awaiting manager assignment",
      "let manager pick",
    ],
    answer:
      "When you open Create new activity as an agent, you'll see two buttons:\n  - Create & assign to me - self-assigns to your queue (default).\n  - Send to manager - routes the activity to a manager to assign.\n\nThe sent-to-manager activity drops out of your To-do board and shows up in the manager Routing card under 'Activities to assign', with an amber 'Awaiting manager assignment' badge. The manager picks the owning agent inline; once assigned, the badge clears and the activity moves to that agent's queue.",
    related: [
      "How does the routing card work?",
      "How do I create a new activity?",
    ],
  },
  {
    id: "routing-card",
    question: "How does the manager routing card work?",
    keywords: [
      "routing card",
      "route prospects",
      "route clients",
      "unrouted",
      "assign agents",
      "assign clients",
      "assign prospects",
      "routing surface",
      "co-own",
      "primary owner",
    ],
    managerOnly: true,
    answer:
      "The Routing card sits at the top of the manager Activity Center. It surfaces three things:\n  1. Unrouted prospects - prospects with no assigned agent.\n  2. Unrouted clients - clients with no assigned agent.\n  3. Activities to assign - activities an agent sent over via 'Send to manager'.\n\nEach row has two actions: 'Assign to me' (one-click confirm) or 'Pick agents...' (multi-select dialog). For prospects/clients you can co-own with multiple agents - the first is the primary owner and the rest co-manage. Activities take a single owner.",
    related: [
      "How do I send an activity to a manager to assign?",
      "How do I create a new activity?",
    ],
  },
  {
    id: "start-activity-button",
    question: "What does the Start activity button do?",
    keywords: [
      "start activity",
      "mark in progress",
      "in progress",
      "begin work",
      "start working",
      "auto text customer",
      "auto sms customer",
    ],
    answer:
      "Start activity (top-left of an open activity card) does two things:\n  1. Moves the card from To-do to In progress so the team knows it's actively owned (the first start stamps the handoff timestamp).\n  2. If the activity is tied to a customer, the customer is auto-texted: 'Hi {name}, one of our agents has started working on your request. We'll follow up shortly with next steps.' This only fires on the first start - snoozing and resuming doesn't re-send.\n\nNo-customer activities just flip status with no outbound text.",
    related: [
      "How do I mark an activity resolved?",
      "How do AI verification signals work?",
    ],
  },
  {
    id: "ai-verified-resolution",
    question: "How do AI verification signals work?",
    keywords: [
      "ai verified",
      "ai verification",
      "verified change",
      "ai recognized",
      "resolution signal",
      "ai checklist",
      "vehicle added",
      "ai sees",
      "ai watching",
    ],
    answer:
      "For activities tied to real-world account changes, Quotex still watches the account for helpful verification signals: new assets, policy edits, uploaded documents, filed claims, messages, and notes. Those signals help the card explain what has happened.\n\nThey are guidance only. They do not checklist-block Mark resolved. The staff member closing the activity must add a resolution note so the client timeline explains why the work was closed.",
    related: [
      "How do I mark an activity resolved?",
      "What is the Activity Center?",
    ],
  },
  {
    id: "manager-override",
    question: "Do managers need to override an activity closeout?",
    keywords: [
      "manager override",
      "grant override",
      "bypass checklist",
      "override request",
      "resolve anyway",
    ],
    managerOnly: true,
    answer:
      "No. Activity closeout is no longer manager-gated. Agents, CSRs, and managers can close their own in-progress activities without a checklist block. Managers still control routing and reassignment, but they do not need to approve a normal Mark resolved action.\n\nThe closer must add a resolution note, which is attached to the closed activity and written to the client timeline.",
    related: [
      "How do I mark an activity resolved?",
      "How do AI verification signals work?",
    ],
  },
  {
    id: "renew-documents-policy",
    question: "How do I renew a policy's documents?",
    keywords: [
      "renew documents",
      "renew docs",
      "regenerate documents",
      "fresh dec page",
      "new declarations",
      "new id card",
      "new proof of insurance",
      "policy documents renewed",
    ],
    answer:
      "Open the policy detail page (/employee/policies/:id). The Coverage card has a Renew documents button. Clicking it regenerates a fresh, dated set from current coverage:\n  - Declarations page\n  - Insurance ID card\n  - Proof of insurance\n\nAll three land on the Documents card below (customer-visible, approved, named with the policy ref + date). A customer-visible status event is logged to the timeline so the client's portal records the renewal.",
    related: [
      "How do I edit a policy or add an asset to it?",
      "What does the Policy description card show?",
    ],
  },
  {
    id: "policy-description-card",
    question: "What does the Policy description card show?",
    keywords: [
      "policy description",
      "what's covered",
      "coverage list",
      "policy summary card",
      "description card",
    ],
    answer:
      "Next to Policy remarks on the policy detail page, the Policy description card gives a plain-language summary:\n  - Line of business, asset, carrier, effective + renewal dates, current premium, and billing frequency.\n  - A 'What's covered' list pulled from the policy's coverage schedule when it has one (each item with limits + deductibles), or a sensible default outline for the asset type (home, auto, yacht, jewelry, umbrella, portfolio).\n\nAll three cards (Coverage, Policy remarks, Policy description) are fixed-height and scroll internally so the layout stays uniform.",
    related: [
      "How do I renew a policy's documents?",
      "How do I edit a policy or add an asset to it?",
    ],
  },
  {
    id: "edit-policy-modal",
    question: "How do I edit a policy or add a new asset to it?",
    keywords: [
      "edit policy",
      "add asset to policy",
      "add a new asset",
      "policy edit modal",
      "ai document insertion",
      "insert from policy document",
    ],
    answer:
      "On the policy detail page, click Edit policy on the Coverage card. The Edit policy modal opens prefilled with the current policy and saves through api.policies.update.\n\nInside it you can:\n  - Change carrier, policy number, premium, dates, status, and department (Personal / Commercial Lines).\n  - Pick a different asset OR choose '+ Add a new asset...' to create one inline (label, type, estimated value) - the policy attaches to the new asset on save.\n  - Drop a declarations page / carrier PDF into the AI document-insert tool at the top to auto-fill the fields and attach the file as a policy document.",
    related: [
      "How do I view full policy details?",
      "How do I renew a policy's documents?",
    ],
  },
  {
    id: "preview-filled-template",
    question: "How do I preview a filled-in template?",
    keywords: [
      "preview template",
      "filled template",
      "preview filled",
      "template preview",
      "preview form",
      "merged template",
    ],
    answer:
      "On a client's profile, the Documents card has a 'Preview template' button in the top-right. It opens a modal that:\n  1. Lets you pick any agency template/form from the library (dropdown).\n  2. Renders that template as if filled in with the client's details - insured info (name, code, email, phone, addresses, agent of record), policies table, scheduled assets, client + agent signature lines.\n  3. Offers 'Print / Save as PDF' (opens a clean print view) and 'Save copy to documents' (clones the filled template onto the client's Documents card).\n\nIf no agency templates exist yet, a manager uploads them under Document review -> Agency document library.",
    related: [
      "How do I upload an agency-wide template?",
      "How do I download a client's full information as a PDF?",
    ],
  },
  {
    id: "agency-templates-library",
    question: "How do I upload an agency-wide template or form?",
    keywords: [
      "agency template",
      "template library",
      "upload form",
      "intake packet",
      "one-pager",
      "tenant template",
      "shared template",
    ],
    managerOnly: true,
    answer:
      "Go to Document review (/employee/documents). The top card is the Agency document library; the first section is Templates & forms (manager-only).\n  1. Pick the document type (defaults to Agency template / form) and upload your file.\n  2. The template lands in the shared library - every agent can send it to a client via the Documents card or preview it with merged client data.\n\nThe same card has Personal lines and Commercial lines buckets at the bottom; each has its own upload button so you can also drop line-of-business-tagged forms there.",
    related: [
      "How do I preview a filled-in template?",
      "How do I upload carrier-specific documents?",
    ],
  },
  {
    id: "download-dossier",
    question: "How do I download a client's full information as a PDF?",
    keywords: [
      "download client",
      "download information",
      "client dossier",
      "prospect dossier",
      "export client",
      "pdf dossier",
      "print client",
      "download prospect",
    ],
    answer:
      "On a client or prospect profile, the top-right header has a 'Download client information' (or 'Download prospect information') button. It compiles everything on file - profile, assets, policies, claims, documents, email + SMS messages, timeline & remarks, activities - into a print-ready document and opens the browser print dialog so it saves as a PDF.\n\nUses your browser's 'Save as PDF' destination - no plugin needed.",
    related: [
      "How do I preview a filled-in template?",
      "How does messaging work?",
    ],
  },
  {
    id: "dashboard-tiles",
    question: "How do the dashboard stat tiles work?",
    keywords: [
      "stat tiles",
      "dashboard tiles",
      "my clients tile",
      "quick view",
      "bound policies tile",
      "open prospects tile",
      "renewals upcoming tile",
      "drill down",
    ],
    answer:
      "The five tiles at the top of the agency dashboard are clickable (except Activity Center, which deep-links to the page):\n  - My clients / Active clients - opens a quick-view list of clients (expandable rows + Profile button).\n  - Bound policies - list of bound policies with carrier, premium, and Open Policy.\n  - Open prospects - list of new / abandoned prospects with status and Profile button.\n  - Renewals upcoming - list of upcoming renewals with date and Open Policy.\n\nEach row uses the same drill-down UI as the manager Analytics metric modals: expand for details + a deep-link to the actual record.",
    related: [
      "What is the Activity Center?",
      "How does Analytics drill-down work?",
    ],
  },
  {
    id: "archive-search",
    question: "How do I search archived clients or prospects?",
    keywords: [
      "archive search",
      "search archived",
      "archived quick view",
      "archive page",
      "find archived",
      "restore archived",
    ],
    answer:
      "Open the Archive page (/employee/archive). At the top is a search bar that filters by name, email, or status across both Archived prospects and Archived clients.\n\nEach row has two actions:\n  - Quick view - opens a modal of the basic archived record (contacts, policies count, managed-by, archived date) with an 'Open full profile' link - without leaving the archive.\n  - Unarchive - restores the contact to the active list.",
    related: [
      "How do I pin or mute a conversation?",
      "How does the archive work?",
    ],
  },
  {
    id: "auto-renewal-activities",
    question: "How do renewals auto-spawn activities?",
    keywords: [
      "renewal activity",
      "auto renewal activity",
      "renewal pops up",
      "renewal due card",
      "renewals automatically",
    ],
    answer:
      "Every upcoming renewal gets an Activity Center card assigned to the renewal's owning agent (falling back to the client's assigned agent). The card title is 'Renewal due - {asset}', topic renewal_approaching, severity Warning.\n\nThe spawn is idempotent - one card per renewal term (keyed by renewalId), so reloading the Activity Center never creates duplicates. Cards appear as soon as the Activity Center is loaded.",
    related: [
      "How do renewals work?",
      "What is the Activity Center?",
    ],
  },
  {
    id: "campaign-multi-channel",
    question: "How do I send an AI campaign on email and SMS together?",
    keywords: [
      "ai campaign",
      "campaign channel",
      "email and sms campaign",
      "multi channel campaign",
      "campaign audience",
      "all clients all prospects",
      "marketing campaign",
    ],
    managerOnly: true,
    answer:
      "On the Marketing activity page, click Compose new campaign. The composer is multi-select for both Channel (toggle Email + SMS on at the same time) and Audience (toggle All clients + All prospects + optional hand-pick - they combine).\n\nPromotional campaigns are fire-and-forget: only the campaign + a launch status event are recorded - no per-recipient message rows are written, so campaigns never clutter individual clients' Messages threads. Promotional AI auto-outreach (the per-prospect intake fire on prospect creation) is SMS-only by policy.",
    related: [
      "How does AI marketing work?",
      "How does promotional vs transactional AI messaging work?",
    ],
  },
  {
    id: "promo-vs-transactional",
    question: "How does promotional vs transactional AI messaging work?",
    keywords: [
      "promotional",
      "transactional",
      "auto sms",
      "ai message routing",
      "promo channel",
      "serious message",
    ],
    answer:
      "Two rules:\n  - Promotional AI auto-messages (per-prospect outreach + manager AI campaigns) are SMS-only and stay out of email. Campaign sends aren't recorded as per-contact messages at all.\n  - Transactional AI (policy-edit acknowledgments, questionnaires, e-sign requests, anything about the quote/policy/documents) goes via email - including AI-drafted ones - so the substance lives in the email thread.\n\nThis keeps promo out of the inbox and serious content where the client expects it.",
    related: [
      "How do I send an AI campaign on email and SMS together?",
      "How does AI marketing work?",
    ],
  },
  {
    id: "email-signature",
    question: "How do I set or preview my email signature?",
    keywords: [
      "email signature",
      "signature",
      "sign off",
      "auto append signature",
      "signature preview",
      "edit signature",
      "logo signature",
    ],
    answer:
      "The Messages page has an Email signature card. Tap Edit signature to unlock; add your signature text (name, title, contact info) and any logos. Save re-locks the card and shows a live preview of how your signature appears at the foot of an outbound email (the ' - ' separator, text, and logos).\n\nThe saved signature is auto-appended to every outbound EMAIL you send from anywhere in the app - Messages page, inline detail-page threads, the New send modal. SMS sends ignore it.",
    related: [
      "How do I start a new conversation in Messages?",
      "How does the 'Enhance with AI' button work?",
    ],
  },
  {
    id: "branches",
    question: "How do I add a branch to my agency?",
    keywords: [
      "branch",
      "branches",
      "add branch",
      "agency branch",
      "office location",
    ],
    managerOnly: true,
    answer:
      "Open the master portal (manager-only) and pick your agency. The agency detail page has a Branches card where you can add, edit, or remove branches (name, address, city/state/zip, phone). Branches are scoped to your agency and never overlap with another tenant.",
    related: [
      "What can managers do that agents can't?",
    ],
  },
  {
    id: "role-differences",
    question: "What can managers do that agents can't?",
    keywords: [
      "manager vs agent",
      "what managers do",
      "roles",
      "permissions",
      "agent vs manager",
      "what can managers",
    ],
    answer:
      "Manager-only surfaces and actions:\n  - Analytics page (team performance + per-agent drill-downs + performance goals).\n  - Routing card on the Activity Center (assign unrouted prospects/clients + handed-off activities).\n  - Manage carriers, carrier reps, and the agency document library (templates + line-of-business buckets).\n  - Agency branches in the master portal.\n  - Reassign any activity to any agent directly.\n  - Compose AI marketing campaigns.\n  - Master portal pages (agencies, users, custom doc types).\n\nAgents can request reassignment (managers action it), and can only create activities for clients/prospects assigned to them.",
    related: [
      "How does the routing card work?",
      "How do I grant a manager override on an activity?",
    ],
  },
  {
    id: "activity-importance",
    question: "How do I change an activity's importance?",
    keywords: [
      "importance",
      "severity",
      "urgency",
      "high medium low",
      "change importance",
      "edit importance",
    ],
    answer:
      "On an expanded activity card, there's an Importance chip showing the current level (Low / Medium / High). Click it - the three options appear inline with their colored icons (Info / AlertTriangle / AlertCircle). Pick one and it saves immediately, collapsing back to a single chip.\n\nA small 'Edited' hint appears next to the chip when a human changed the AI's original grading.",
    related: [
      "What is the Activity Center?",
    ],
  },
  {
    id: "scroll-bottom",
    question: "Why does the thread always start at the latest message?",
    keywords: [
      "scroll to latest",
      "scroll to bottom",
      "auto scroll",
      "thread bottom",
      "newest first",
      "last message first",
    ],
    answer:
      "Every message surface auto-scrolls to the most recent message when the thread opens, the Email/SMS channel switches, the card is expanded to full screen, or a new message arrives - so you always land at the bottom of the conversation. The exception is the timeline ?msg= deep-link, which scrolls to and highlights that specific message instead.",
    related: [
      "How do I expand a message card to full screen?",
      "How do I view emails vs SMS separately?",
    ],
  },
];

const GREETING_KEYWORDS = ["hi", "hello", "hey", "yo", "help", "what can you do"];

function scoreEntry(entry: KbEntry, q: string): number {
  // Normalize: strip punctuation/apostrophes so "policy's documents"
  // matches keywords like "policy documents".
  const norm = q
    .replace(/[''`.,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = new Set(norm.split(" ").filter(Boolean));
  let score = 0;
  for (const kw of entry.keywords) {
    if (q.includes(kw) || norm.includes(kw)) {
      // Adjacent phrase matches are the strongest signal.
      score += kw.includes(" ") ? 3 : 1;
      continue;
    }
    // Token fallback: when every word of a multi-word keyword shows up
    // somewhere in the question (even non-adjacent), count it as a
    // weaker phrase match. Lets "how do I renew a policy's documents"
    // hit "renew documents".
    if (kw.includes(" ")) {
      const kwTokens = kw.split(/\s+/);
      if (kwTokens.every((t) => tokens.has(t))) score += 2;
    }
  }
  return score;
}

function rankedKbEntries(q: string, limit = 5): { entry: KbEntry; score: number }[] {
  return KB.map((entry) => ({ entry, score: scoreEntry(entry, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function shouldCombineTopics(
  q: string,
  ranked: { entry: KbEntry; score: number }[]
): boolean {
  if (ranked.length < 2) return false;
  const top = ranked[0].score;
  const next = ranked[1].score;
  const asksForWorkflow =
    /\b(and|also|plus|then|both|walk me through|step by step|workflow|end to end|from .* to .*)\b/.test(
      q
    ) || q.split(/\s+/).filter(Boolean).length >= 14;
  return asksForWorkflow && top >= 3 && next >= Math.max(2, top - 2);
}

function topicAnswer(entry: KbEntry, role?: "agent" | "manager"): string {
  if (entry.managerOnly && role === "agent") {
    return (
      "Heads up: this is a manager-only area, so you may not see it in your rail.\n\n" +
      entry.answer
    );
  }
  return entry.answer;
}

function combineTopicAnswers(
  ranked: { entry: KbEntry; score: number }[],
  role?: "agent" | "manager",
  q = ""
): AssistantAnswer {
  const entries = ranked.slice(0, 3).map((r) => r.entry);
  const text = entries
    .map((entry, idx) => `${idx + 1}. ${entry.question}\n${topicAnswer(entry, role)}`)
    .join("\n\n");
  const related = dedupeStrings(entries.flatMap((entry) => entry.related ?? [])).slice(0, 4);
  return attachTrainingVideo({ text, related, topicId: entries[0].id }, q, role);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function listAssistantTopics(): { id: string; question: string }[] {
  return KB.map((e) => ({ id: e.id, question: e.question }));
}

// Suggested starter questions shown when the chat first opens.
export function assistantStarters(): string[] {
  return [
    "What is the Activity Center?",
    "How do I set a reminder?",
    "How do I convert a prospect to a client?",
    "How do I view full policy details?",
  ];
}

// ---------------------------------------------------------------------
// Data-aware question handling. Detects "how many <metric> does
// <person> have?"-style questions and answers from the live record
// set the viewer can see, combining the count with the matching
// how-to so the response is actionable.
// ---------------------------------------------------------------------

type DataMetric =
  | "assets"
  | "policies"
  | "claims"
  | "renewals"
  | "documents"
  | "premium"
  | "agent"
  | "contact"
  | "renewalDate"
  | "status"
  | "profile";

// Order matters - more specific phrases first so "renewal date" beats
// the bare "renewal" count, and "premium" beats "policy".
const METRIC_PATTERNS: { metric: DataMetric; re: RegExp }[] = [
  { metric: "profile", re: /\b(tell me about|summary of|profile of|overview of|everything about|recap)\b/ },
  { metric: "agent", re: /\b(agent|assigned to|who (owns|handles|manages|services))\b/ },
  { metric: "contact", re: /\b(email|phone|number|contact info|reach|address)\b/ },
  { metric: "renewalDate", re: /\b(when (does|do|is)|renewal date|expire|expir|due)\b/ },
  { metric: "premium", re: /\b(premium|how much|paying|pays|revenue|worth|value)\b/ },
  { metric: "status", re: /\bstatus\b/ },
  { metric: "renewals", re: /\brenew/ },
  { metric: "claims", re: /\bclaim/ },
  { metric: "assets", re: /\basset/ },
  { metric: "policies", re: /\bpolic/ },
  { metric: "documents", re: /\b(document|file|doc)\b/ },
];

function detectMetric(q: string): DataMetric | null {
  for (const { metric, re } of METRIC_PATTERNS) {
    if (re.test(q)) return metric;
  }
  return null;
}

// Score how strongly a name matches the question. Full-name substring
// wins; otherwise first + last token both present scores lower.
function nameMatchScore(name: string, q: string): number {
  const n = name.toLowerCase().trim();
  if (!n) return 0;
  if (q.includes(n)) return n.length + 10;
  const tokens = n.split(/\s+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => q.includes(t)).length;
  if (tokens.length >= 2 && hits >= 2) return 6;
  if (tokens.length === 1 && hits === 1) return 3;
  return 0;
}

interface MatchedContact {
  kind: "customer" | "prospect";
  id: string;
  name: string;
}

function findContact(
  q: string,
  ctx: AssistantContext
): { contact: MatchedContact; score: number } | null {
  let best: MatchedContact | null = null;
  let bestScore = 0;
  const viewer = { id: ctx.viewer.id, role: ctx.viewer.role };
  for (const c of api.customers.listVisible(ctx.tenantId, viewer)) {
    const s = nameMatchScore(c.name, q);
    if (s > bestScore) {
      bestScore = s;
      best = { kind: "customer", id: c.id, name: c.name };
    }
  }
  // Prospects: managers see all; agents see ones assigned to them.
  for (const p of api.prospects.listByTenant(ctx.tenantId)) {
    const allowed =
      ctx.viewer.role === "manager" ||
      ctx.viewer.role === "master_admin" ||
      p.assignedAgentId === ctx.viewer.id ||
      (p.additionalAgentIds ?? []).includes(ctx.viewer.id);
    if (!allowed) continue;
    const s = nameMatchScore(p.name, q);
    if (s > bestScore) {
      bestScore = s;
      best = { kind: "prospect", id: p.id, name: p.name };
    }
  }
  return best ? { contact: best, score: bestScore } : null;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function clientAction(customerId: string, label = "View client"): AssistantAction {
  return { label, to: `/employee/clients/${customerId}` };
}

function prospectAction(prospectId: string, label = "View prospect"): AssistantAction {
  return { label, to: `/employee/prospects/${prospectId}` };
}

function policyAction(policyId: string, label = "View policy"): AssistantAction {
  return { label, to: `/employee/policies/${policyId}` };
}

function billingAction(policyId: string, label = "View billing"): AssistantAction {
  return { label, to: `/employee/billing/${policyId}` };
}

function assetAction(customerId: string, assetId: string, label = "View asset"): AssistantAction {
  return { label, to: `/employee/clients/${customerId}/assets/${assetId}` };
}

function claimAction(claimId: string, label = "View claim"): AssistantAction {
  return { label, to: `/employee/claims?claim=${encodeURIComponent(claimId)}` };
}

function campaignAction(campaignId: string, label = "View campaign"): AssistantAction {
  return { label, to: `/employee/marketing?campaign=${encodeURIComponent(campaignId)}` };
}

function taskAction(taskId: string, label = "View activity"): AssistantAction {
  return { label, to: `/employee/tasks?focus=${encodeURIComponent(taskId)}` };
}

function contactProfileAction(contact: MatchedContact, label?: string): AssistantAction {
  return contact.kind === "customer"
    ? clientAction(contact.id, label ?? "Open client")
    : prospectAction(contact.id, label ?? "Open prospect");
}

function contactDocumentsAction(contact: MatchedContact, label = "View documents"): AssistantAction {
  return {
    label,
    to:
      contact.kind === "customer"
        ? `/employee/clients/${contact.id}#documents`
        : `/employee/prospects/${contact.id}`,
  };
}

function contactQuotingAction(contact: MatchedContact, label = "Open AI quoting workspace"): AssistantAction {
  return {
    label,
    to:
      contact.kind === "customer"
        ? `/employee/clients/${contact.id}#ai-quoting-workspace`
        : `/employee/prospects/${contact.id}#ai-quoting-workspace`,
  };
}

function messagesAction(contact: {
  customerId?: string;
  prospectId?: string;
  carrierContactId?: string;
}, label = "View thread"): AssistantAction {
  if (contact.customerId) {
    return { label, to: `/employee/messages?contact=${encodeURIComponent(`client:${contact.customerId}`)}` };
  }
  if (contact.prospectId) {
    return { label, to: `/employee/messages?contact=${encodeURIComponent(`prospect:${contact.prospectId}`)}` };
  }
  if (contact.carrierContactId) {
    return { label, to: `/employee/messages?contact=${encodeURIComponent(`carrier:${contact.carrierContactId}`)}` };
  }
  return categoryAction("/employee/messages", label);
}

function contactMessagesAction(contact: MatchedContact, label = "Open message thread"): AssistantAction {
  return contact.kind === "customer"
    ? messagesAction({ customerId: contact.id }, label)
    : messagesAction({ prospectId: contact.id }, label);
}

const CURRENT_PAGE_INTENT_RE =
  /\b(this page|this screen|current page|current screen|where am i|what am i looking at|what should i do|what's next|whats next|next step|summarize|summary|recap|catch me up|help me here|on this page|right here)\b/;

function isCurrentPageQuestion(q: string, ctx?: AssistantContext): boolean {
  if (!ctx?.currentPath) return false;
  return CURRENT_PAGE_INTENT_RE.test(q);
}

function pageLabelFromPath(path: string): string {
  const normalized = path.split(/[?#]/)[0] || "/employee";
  if (normalized === "/employee") return "dashboard";
  if (normalized.startsWith("/employee/clients/")) return "client profile";
  if (normalized.startsWith("/employee/prospects/")) return "prospect profile";
  if (normalized.startsWith("/employee/policies/")) return "policy detail";
  if (normalized.startsWith("/employee/tasks")) return "Activity Center";
  if (normalized.startsWith("/employee/messages")) return "Messages";
  if (normalized.startsWith("/employee/calendar")) return "Calendar";
  if (normalized.startsWith("/employee/marketing")) return "AI marketing studio";
  if (normalized.startsWith("/employee/claims")) return "Claims";
  if (normalized.startsWith("/employee/billing")) return "Billing";
  if (normalized.startsWith("/employee/documents")) return "Documents";
  if (normalized.startsWith("/employee/carriers")) return "Carrier library";
  if (normalized.startsWith("/employee/settings")) return "Agency settings";
  return "employee portal";
}

function userNames(ids: Array<string | undefined | null>): string {
  const names = Array.from(
    new Set(
      ids
        .filter((id): id is string => !!id)
        .map((id) => api.users.get(id)?.name)
        .filter((name): name is string => !!name)
    )
  );
  return names.length ? names.join(", ") : "unassigned";
}

function contactStaffLine(contact: MatchedContact): string {
  if (contact.kind === "prospect") {
    const prospect = api.prospects.get(contact.id);
    return userNames([
      prospect?.assignedAgentId,
      ...(prospect?.additionalAgentIds ?? []),
      prospect?.assignedCsrId,
      ...(prospect?.additionalCsrIds ?? []),
    ]);
  }
  const customer = api.customers.get(contact.id);
  return userNames([
    customer?.assignedAgentId,
    ...(customer?.additionalAgentIds ?? []),
    customer?.assignedCsrId,
    ...(customer?.additionalCsrIds ?? []),
  ]);
}

function openTasksForContact(contact: MatchedContact, ctx: AssistantContext): Task[] {
  return api.tasks
    .listByTenant(ctx.tenantId)
    .filter((task) => canSeeTask(task, ctx))
    .filter((task) =>
      contact.kind === "customer"
        ? task.customerId === contact.id
        : task.prospectId === contact.id
    )
    .filter((task) => api.tasks.statusOf(task) !== "resolved")
    .filter(isContactProfileActivity)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function latestQuotingSessionForContact(contact: MatchedContact): QuotingSession | undefined {
  return contact.kind === "customer"
    ? api.quoting.getForCustomer(contact.id)
    : api.quoting.getForProspect(contact.id);
}

function quotingSessionLine(session?: QuotingSession): string {
  if (!session) return "No open AI quoting workspace on file.";
  const line = session.lineOfBusiness === "commercial" ? "Commercial" : "Personal";
  const missingCount = session.missingFields.length;
  const quoteCount = session.quotes.length;
  const pieces = [
    `${line} ${api.helpers.assetTypeLabel(session.assetType)}`,
    `status ${session.status.replace(/_/g, " ")}`,
    missingCount ? `${missingCount} missing field${missingCount === 1 ? "" : "s"}` : "no missing fields recorded",
    quoteCount ? `${quoteCount} ranked quote${quoteCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return pieces.join(" - ");
}

function currentContactAnswer(contact: MatchedContact, ctx: AssistantContext): AssistantAnswer {
  const tasks = openTasksForContact(contact, ctx);
  const session = latestQuotingSessionForContact(contact);
  const recentRemarks = api.status
    .listByTenant(ctx.tenantId)
    .filter((event) =>
      contact.kind === "customer"
        ? event.customerId === contact.id
        : event.prospectId === contact.id
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 2);

  if (contact.kind === "prospect") {
    const prospect = api.prospects.get(contact.id);
    const actions = [
      prospectAction(contact.id, "Open prospect"),
      contactQuotingAction(contact),
      contactMessagesAction(contact),
      ...(tasks[0] ? [taskAction(tasks[0].id, "Open top activity")] : []),
    ];
    return {
      text:
        `You are on ${contact.name}'s prospect profile.\n` +
        `- Assigned staff: ${contactStaffLine(contact)}\n` +
        `- Status: ${prospect?.status.replace(/_/g, " ") ?? "unknown"}\n` +
        `- Interest: ${prospect ? api.helpers.assetTypeLabel(prospect.assetType) : "not recorded"}${
          prospect?.estimatedValue ? ` (${formatMoney(prospect.estimatedValue)})` : ""
        }\n` +
        `- Open activities: ${tasks.length}\n` +
        `- AI quoting: ${quotingSessionLine(session)}\n` +
        (recentRemarks.length
          ? `- Latest remarks: ${recentRemarks.map((event) => event.message).join(" | ")}\n`
          : "") +
        `\nBest next move: use the quoting workspace if the prospect is ready to quote, or open the message thread/activity if there is an active follow-up.`,
      topicId: "current-prospect",
      actions,
      action: actions[0],
      related: [
        `Open ${contact.name}'s AI quoting workspace`,
        `What is ${contact.name}'s status?`,
        `Create an activity for ${contact.name}`,
      ],
    };
  }

  const customer = api.customers.get(contact.id);
  const assets = api.assets.listByCustomer(contact.id);
  const policies = api.policies.listByCustomer(contact.id);
  const bound = policies.filter((policy) => policy.status === "bound");
  const claims = api.claims.listByCustomer(contact.id);
  const openClaims = claims.filter((claim) => claim.status !== "closed");
  const documents = api.documents.listByEntity({ customerId: contact.id });
  const premium = bound.reduce(
    (sum, policy) => sum + (policy.finalPremium ?? policy.premiumEstimate ?? 0),
    0
  );
  const nextRenewal = policies
    .map((policy) => policy.renewalDate)
    .filter((date): date is string => !!date)
    .sort()[0];
  const actions = [
    clientAction(contact.id, "Open client"),
    contactQuotingAction(contact),
    contactMessagesAction(contact),
    ...(tasks[0] ? [taskAction(tasks[0].id, "Open top activity")] : []),
    ...(policies[0] ? [policyAction(policies[0].id, "Open policy")] : []),
  ];
  return {
    text:
      `You are on ${contact.name}'s client profile.\n` +
      `- Assigned staff: ${contactStaffLine(contact)}\n` +
      `- Client line: ${customer?.lineOfBusiness ?? "not set"}\n` +
      `- Contact: ${customer?.email ?? "no email"}${customer?.phone ? ` - ${customer.phone}` : ""}\n` +
      `- Assets: ${assets.length}; policies: ${policies.length} (${bound.length} bound); claims: ${claims.length} (${openClaims.length} open)\n` +
      `- Premium under management: ${formatMoney(premium)}${nextRenewal ? `; next renewal: ${formatDate(nextRenewal)}` : ""}\n` +
      `- Documents: ${documents.length}; open activities: ${tasks.length}\n` +
      `- AI quoting: ${quotingSessionLine(session)}\n` +
      (recentRemarks.length
        ? `- Latest remarks: ${recentRemarks.map((event) => event.message).join(" | ")}\n`
        : "") +
      `\nBest next move: handle any open activity first; otherwise continue the AI quoting workspace or review the policy/document card tied to the client question.`,
    topicId: "current-client",
    actions,
    action: actions[0],
    related: [
      `When does ${contact.name} renew?`,
      `How many policies does ${contact.name} have?`,
      `Open ${contact.name}'s AI quoting workspace`,
    ],
  };
}

function currentPolicyAnswer(policyId: string, ctx: AssistantContext): AssistantAnswer | null {
  const policy = api.policies.get(policyId);
  if (!policy) return null;
  const customer = api.customers.get(policy.customerId);
  if (customer && !api.customers.canSee(customer, ctx.viewer)) return null;
  const asset = api.assets.get(policy.assetId);
  const carrier = api.carriers.get(policy.carrierId);
  const tasks = api.tasks
    .listByTenant(ctx.tenantId)
    .filter((task) => canSeeTask(task, ctx))
    .filter((task) => task.policyId === policy.id || task.customerId === policy.customerId)
    .filter((task) => api.tasks.statusOf(task) !== "resolved");
  const actions = [
    policyAction(policy.id, "Open policy"),
    clientAction(policy.customerId, "Open client"),
    billingAction(policy.id, "Open billing"),
    ...(tasks[0] ? [taskAction(tasks[0].id, "Open top activity")] : []),
  ];
  return {
    text:
      `You are on policy ${policy.policyNumber ?? policy.id}.\n` +
      `- Client: ${customer?.name ?? "unknown"}\n` +
      `- Asset: ${asset?.label ?? "not linked"}\n` +
      `- Carrier: ${carrier?.name ?? policy.carrierId}\n` +
      `- Status: ${policy.status.replace(/_/g, " ")}; renewal: ${formatDate(policy.renewalDate)}\n` +
      `- Premium: ${formatMoney(policy.finalPremium ?? policy.premiumEstimate ?? 0)}\n` +
      `- Coverages: ${(policy.coverages ?? []).length}; participants: ${(policy.participants ?? []).length}; open related activities: ${tasks.length}\n` +
      `\nBest next move: if the question is billing, open billing; if it is coverage or participants, stay on this policy detail and review the matching card.`,
    topicId: "current-policy",
    action: actions[0],
    actions,
    related: [
      `Open ${customer?.name ?? "this client"}`,
      "How do I view full policy details?",
      "Create an activity for this policy",
    ],
  };
}

function currentMessagesAnswer(ctx: AssistantContext): AssistantAnswer {
  const path = ctx.currentPath ?? "";
  const contactParam = new URLSearchParams(path.split("?")[1]?.split("#")[0] ?? "").get("contact") ?? "";
  const decoded = decodeURIComponent(contactParam);
  const [kind, id] = decoded.split(":");
  let contact: MatchedContact | null = null;
  if (kind === "client") {
    const customer = api.customers.get(id);
    if (customer && api.customers.canSee(customer, ctx.viewer)) {
      contact = { kind: "customer", id: customer.id, name: customer.name };
    }
  } else if (kind === "prospect") {
    const prospect = api.prospects.get(id);
    if (prospect) contact = { kind: "prospect", id: prospect.id, name: prospect.name };
  }
  if (contact) {
    const comms =
      contact.kind === "customer"
        ? api.communications.listByCustomer(contact.id)
        : api.communications.listByTenant(ctx.tenantId).filter((comm) => comm.prospectId === contact.id);
    const latest = [...comms].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    return {
      text:
        `You are in the message thread for ${contact.name}.\n` +
        `- Total messages on file: ${comms.length}\n` +
        `- Latest: ${latest ? `${latest.direction} ${latest.channel} on ${formatDateTime(latest.createdAt)}${latest.subject ? ` - ${latest.subject}` : ""}` : "no message yet"}\n` +
        `- Related quoting: ${quotingSessionLine(latestQuotingSessionForContact(contact))}\n` +
        `\nBest next move: answer from the thread if this is a client/prospect reply; open the profile or quoting workspace if the reply changes file data.`,
      topicId: "current-messages",
      action: contactMessagesAction(contact),
      actions: [contactMessagesAction(contact), contactProfileAction(contact), contactQuotingAction(contact)],
    };
  }
  return {
    text:
      "You are in Messages. Use this screen to review client/prospect/carrier conversations, open the exact thread, and send replies that stay attached to the contact record.",
    topicId: "current-messages",
    action: categoryAction("/employee/messages", "Open messages"),
  };
}

function currentDashboardAnswer(ctx: AssistantContext): AssistantAnswer {
  const isManager = ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin";
  const customers = api.customers.listVisible(ctx.tenantId, ctx.viewer);
  const customerIds = new Set(customers.map((customer) => customer.id));
  const openTasks = api.tasks
    .listOpen(ctx.tenantId)
    .filter((task) => isManager || canSeeTask(task, ctx));
  const urgent = openTasks.filter((task) => task.severity === "urgent").length;
  const sessions = api.quoting
    .listByTenant(ctx.tenantId)
    .filter((session) => !session.customerId || customerIds.has(session.customerId));
  const openQuotes = sessions.filter((session) => session.status !== "complete").length;
  const quoteReady = sessions.filter((session) => session.status === "complete" && session.quotes.length > 0).length;
  return {
    text:
      `You are on the employee dashboard.\n` +
      `- Visible clients: ${customers.length}\n` +
      `- Open activities: ${openTasks.length}${urgent ? ` (${urgent} high importance)` : ""}\n` +
      `- AI quote workspaces in progress: ${openQuotes}; rankings ready: ${quoteReady}\n` +
      `- Scope: ${isManager ? "agency-wide manager view" : "your assigned book"}\n` +
      `\nBest next move: open the Activity Center if there is owned work, or go to Clients/Quoting when you are trying to move a specific file forward.`,
    topicId: "current-dashboard",
    actions: [
      categoryAction("/employee/tasks", "Open Activity Center"),
      categoryAction("/employee/clients", "Open clients"),
      categoryAction("/employee/messages", "Open messages"),
    ],
  };
}

function currentTasksAnswer(ctx: AssistantContext): AssistantAnswer {
  const isManager = ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin";
  const openTasks = api.tasks
    .listOpen(ctx.tenantId)
    .filter((task) => isManager || canSeeTask(task, ctx));
  const inProgress = openTasks.filter((task) => api.tasks.statusOf(task) === "in_progress");
  const top = [...openTasks].sort((a, b) => {
    const severityRank = { urgent: 3, warning: 2, info: 1 } as Record<TaskSeverity, number>;
    const severityDelta =
      (severityRank[b.severity ?? "info"] ?? 0) - (severityRank[a.severity ?? "info"] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    return a.createdAt < b.createdAt ? 1 : -1;
  })[0];
  return {
    text:
      `You are in the Activity Center.\n` +
      `- Open activities: ${openTasks.length}\n` +
      `- In progress: ${inProgress.length}\n` +
      `- Top item: ${top ? `${top.title} (${(top.severity ?? "info").replace(/_/g, " ")})` : "none"}\n` +
      `- Scope: ${isManager ? "agency-wide manager view" : "your assigned queue"}\n` +
      `\nBest next move: work the highest-importance item first, or tell me the activity title and I can prepare start, snooze, due-date, importance, or resolve actions for confirmation.`,
    topicId: "current-tasks",
    action: top ? taskAction(top.id, "Open top activity") : categoryAction("/employee/tasks", "Open Activity Center"),
    actions: [categoryAction("/employee/tasks", "Open Activity Center")],
  };
}

function currentMarketingAnswer(ctx: AssistantContext): AssistantAnswer {
  const campaigns = api.marketing.listCampaigns(ctx.tenantId);
  const active = campaigns.filter((campaign) => campaign.status === "active").length;
  const scheduled = campaigns.filter((campaign) => campaign.status === "scheduled").length;
  const latest = [...campaigns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  return {
    text:
      `You are in AI marketing studio.\n` +
      `- Campaigns on file: ${campaigns.length}\n` +
      `- Active: ${active}; scheduled: ${scheduled}\n` +
      `- Latest campaign: ${latest ? `${latest.name} (${latest.status})` : "none"}\n` +
      `\nBest next move: pick a precise audience first, preview the full creative/message, then send or schedule only after the final content and recipients look right.`,
    topicId: "current-marketing",
    action: categoryAction("/employee/marketing", "Open marketing"),
    related: ["How does AI marketing work?", "How do I send an AI campaign on email and SMS together?"],
  };
}

function currentGenericPageAnswer(ctx: AssistantContext): AssistantAnswer {
  const label = pageLabelFromPath(ctx.currentPath ?? "");
  return {
    text:
      `You are on the ${label} page. I can use the visible agency records plus this route to answer questions, find records, or prepare confirmed actions. Ask for a summary, a record lookup, or tell me exactly what you want opened or changed.`,
    topicId: "current-page",
    related: ["What should I do next?", "Open Activity Center", "Summarize this page"],
  };
}

function tryCurrentPageAnswer(q: string, ctx: AssistantContext): AssistantAnswer | null {
  if (!isCurrentPageQuestion(q, ctx)) return null;
  const path = ctx.currentPath ?? "";
  const contact = contactFromCurrentPath(ctx);
  if (contact) return currentContactAnswer(contact, ctx);

  const policyId = /\/employee\/policies\/([^/?#]+)/.exec(path)?.[1];
  if (policyId) {
    const answer = currentPolicyAnswer(decodeURIComponent(policyId), ctx);
    if (answer) return answer;
  }

  if (path === "/employee" || path.startsWith("/employee?") || path.startsWith("/employee#")) {
    return currentDashboardAnswer(ctx);
  }
  if (path.startsWith("/employee/tasks")) return currentTasksAnswer(ctx);
  if (path.startsWith("/employee/messages")) return currentMessagesAnswer(ctx);
  if (path.startsWith("/employee/marketing")) return currentMarketingAnswer(ctx);
  return currentGenericPageAnswer(ctx);
}

function attachTrainingVideo(
  answer: AssistantAnswer,
  question: string,
  role?: "agent" | "manager"
): AssistantAnswer {
  if (!isInstructionalQuestion(question)) return answer;
  const match = findVideoChapter(question, role);
  if (!match) return answer;
  const action: AssistantAction = {
    label: `Watch: ${match.chapter.title}`,
    to: videoChapterPath(match.video.id, match.chapter.id, { autoplay: true }),
  };
  const alreadyLinked = [answer.action, ...(answer.actions ?? [])].some((existing) => existing?.to === action.to);
  const trainingLine = `\n\nTraining video: "${match.video.title}" at ${match.chapter.timestamp} covers "${match.chapter.title}" and opens directly to that section.`;
  return {
    ...answer,
    text: answer.text.includes("Training video:") ? answer.text : `${answer.text}${trainingLine}`,
    actions: alreadyLinked ? answer.actions : [...(answer.actions ?? []), action],
  };
}

function answerFromTrainingVideo(
  question: string,
  role?: "agent" | "manager"
): AssistantAnswer | null {
  if (!isInstructionalQuestion(question)) return null;
  const match = findVideoChapter(question, role);
  if (!match) return null;
  return {
    text:
      `${match.chapter.title}\n${match.chapter.summary}\n\n` +
      `${match.chapter.transcript}\n\n` +
      `Training video: "${match.video.title}" at ${match.chapter.timestamp} opens directly to this section.`,
    topicId: `video-${match.video.id}-${match.chapter.id}`,
    action: {
      label: `Watch: ${match.chapter.title}`,
      to: videoChapterPath(match.video.id, match.chapter.id, { autoplay: true }),
    },
    related: [
      "Where are training videos?",
      "What training should managers watch?",
      "What training should agents watch?",
    ],
  };
}

function categoryAction(to: string, label = "View"): AssistantAction {
  return { label, to };
}

function bestPolicyForQuestion(
  q: string,
  policies: ReturnType<typeof api.policies.listByCustomer>
) {
  const normalized = q.toLowerCase();
  return (
    policies.find((policy) => {
      const number = policy.policyNumber?.toLowerCase();
      return !!number && normalized.includes(number);
    }) ??
    policies.find((policy) => policy.status === "bound") ??
    policies[0]
  );
}

function visiblePolicies(ctx: AssistantContext): ReturnType<typeof api.policies.listByTenant> {
  const viewer = { id: ctx.viewer.id, role: ctx.viewer.role };
  const visibleCustomerIds = new Set(
    api.customers.listVisible(ctx.tenantId, viewer).map((customer) => customer.id)
  );
  return api.policies
    .listByTenant(ctx.tenantId)
    .filter((policy) => visibleCustomerIds.has(policy.customerId));
}

function findPolicyForAssistantAction(
  q: string,
  ctx: AssistantContext,
  contact?: MatchedContact | null
): ReturnType<typeof api.policies.get> | null {
  const policies =
    contact?.kind === "customer"
      ? api.policies.listByCustomer(contact.id)
      : visiblePolicies(ctx);
  if (policies.length === 0) return null;
  const normalized = q.toLowerCase();
  const explicit = policies.find((policy) => {
    const policyRef = policy.policyNumber?.toLowerCase() ?? "";
    const carrier = api.carriers.get(policy.carrierId)?.name.toLowerCase() ?? "";
    const asset = api.assets.get(policy.assetId)?.label.toLowerCase() ?? "";
    return (
      (!!policyRef && normalized.includes(policyRef)) ||
      (!!carrier && normalized.includes(carrier)) ||
      (!!asset && normalized.includes(asset))
    );
  });
  return explicit ?? bestPolicyForQuestion(q, policies) ?? null;
}

function bestClaimForQuestion(
  q: string,
  claims: ReturnType<typeof api.claims.listByCustomer>
) {
  const normalized = q.toLowerCase();
  return (
    claims.find((claim) => {
      const number = claim.externalClaimNumber?.toLowerCase();
      return !!number && normalized.includes(number);
    }) ??
    claims.find((claim) => claim.status !== "closed") ??
    claims[0]
  );
}

function findClaimForAssistantAction(
  q: string,
  ctx: AssistantContext,
  contact?: MatchedContact | null
): ReturnType<typeof api.claims.get> | null {
  const claims =
    contact?.kind === "customer"
      ? api.claims.listByCustomer(contact.id)
      : api.claims
          .listByTenant(ctx.tenantId)
          .filter((claim) =>
            api.customers.canSee(api.customers.get(claim.customerId), ctx.viewer)
          );
  if (claims.length === 0) return null;
  const normalized = q.toLowerCase();
  const explicit = claims.find((claim) => {
    const number = claim.externalClaimNumber?.toLowerCase() ?? "";
    const policy = api.policies.get(claim.policyId);
    const asset = policy ? api.assets.get(policy.assetId) : undefined;
    return (
      (!!number && normalized.includes(number)) ||
      (!!asset?.label && normalized.includes(asset.label.toLowerCase())) ||
      (!!claim.lossDescription && normalized.includes(claim.lossDescription.toLowerCase().slice(0, 24)))
    );
  });
  return explicit ?? bestClaimForQuestion(q, claims) ?? null;
}

function answerForContactMetric(
  contact: MatchedContact,
  metric: DataMetric,
  ctx: AssistantContext,
  question = ""
): AssistantAnswer {
  const name = contact.name;

  // Prospects don't carry a bound book. Answer agent / contact /
  // profile intents from prospect fields; otherwise redirect.
  if (contact.kind === "prospect") {
    const p = api.prospects.get(contact.id);
    if (!p) return { text: `I couldn't load ${name}'s record.`, topicId: "data-error" };
    const assetLabel = api.helpers.assetTypeLabel(p.assetType);
    if (metric === "agent") {
      const agent = p.assignedAgentId ? api.users.get(p.assignedAgentId) : undefined;
      return {
        text: agent
          ? `${name} (prospect) is assigned to ${agent.name}.`
          : `${name} is an unassigned prospect - a manager needs to route them to an agent before they can be converted.`,
        related: ["How do I convert a prospect to a client?"],
        topicId: "data-agent",
        action: prospectAction(p.id),
      };
    }
    if (metric === "contact") {
      return {
        text: `${name} (prospect) - ${p.email}${p.phone ? ` - ${p.phone}` : ""}.`,
        topicId: "data-contact",
        action: prospectAction(p.id),
      };
    }
    if (metric === "status") {
      return {
        text: `${name} is a prospect with status "${p.status.replace(/_/g, " ")}". Last action: ${p.lastAction}.`,
        topicId: "data-status",
        action: prospectAction(p.id),
      };
    }
    return {
      text:
        `${name} is a prospect, so there's no bound book yet. They came in interested in ${assetLabel}` +
        `${p.estimatedValue ? ` (est. ${formatMoney(p.estimatedValue)})` : ""}, status "${p.status.replace(/_/g, " ")}", ` +
        `${p.assignedAgentId ? `assigned to ${api.users.get(p.assignedAgentId)?.name ?? "an agent"}` : "currently unassigned"}. ` +
        `Open their prospect profile for the AI summary, quote interest, and timeline - convert them to a client to start attaching assets, policies, and claims.`,
      related: ["How do I convert a prospect to a client?"],
      topicId: "data-prospect",
      action: prospectAction(p.id),
    };
  }

  const customer = api.customers.get(contact.id);

  switch (metric) {
    case "profile": {
      const assetN = api.assets.listByCustomer(contact.id).length;
      const policies = api.policies.listByCustomer(contact.id);
      const bound = policies.filter((p) => p.status === "bound");
      const premium = bound.reduce(
        (s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0),
        0
      );
      const claims = api.claims.listByCustomer(contact.id);
      const openClaims = claims.filter((c) => c.status !== "closed").length;
      const policyIds = new Set(policies.map((p) => p.id));
      const renewals = api.renewals
        .listByTenant(ctx.tenantId)
        .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming").length;
      const agent = customer?.assignedAgentId
        ? api.users.get(customer.assignedAgentId)
        : undefined;
      return {
        text:
          `${name} - client snapshot:\n` +
          `- Assigned agent: ${agent?.name ?? "unassigned"}\n` +
          `- Assets: ${assetN}\n` +
          `- Policies: ${policies.length} (${bound.length} bound)\n` +
          `- Premium under management: ${formatMoney(premium)}\n` +
          `- Claims: ${claims.length} (${openClaims} open)\n` +
          `- Upcoming renewals: ${renewals}\n` +
          `${customer ? `- Contact: ${customer.email}${customer.phone ? ` - ${customer.phone}` : ""}` : ""}\n\n` +
          `Open their client profile for the full picture, or ask me about any one of these.`,
        related: [
          `How many policies does ${name} have?`,
          `When does ${name} renew?`,
          `Who is ${name}'s agent?`,
        ],
        topicId: "data-profile",
        action: clientAction(contact.id),
      };
    }
    case "agent": {
      const agent = customer?.assignedAgentId
        ? api.users.get(customer.assignedAgentId)
        : undefined;
      const co = (customer?.additionalAgentIds ?? [])
        .map((id) => api.users.get(id)?.name)
        .filter(Boolean);
      return {
        text: agent
          ? `${name} is assigned to ${agent.name} (${agent.role}).${
              co.length ? ` Co-owners: ${co.join(", ")}.` : ""
            } The assigned agent is set on the client profile (managers only).`
          : `${name} doesn't have an assigned agent yet - a manager can assign one from the client profile or the Activity Center routing card.`,
        topicId: "data-agent",
        action: clientAction(contact.id),
      };
    }
    case "contact": {
      return {
        text: customer
          ? `${name} - ${customer.email}${customer.phone ? ` - ${customer.phone}` : ""}${
              customer.mailingAddress ? `\nMailing: ${customer.mailingAddress}` : ""
            }. You can edit contact info on the client profile (Edit profile).`
          : `I couldn't load ${name}'s contact details.`,
        topicId: "data-contact",
        action: clientAction(contact.id),
      };
    }
    case "premium": {
      const bound = api.policies
        .listByCustomer(contact.id)
        .filter((p) => p.status === "bound");
      const selected = bestPolicyForQuestion(question, bound);
      const total = bound.reduce(
        (s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0),
        0
      );
      return {
        text:
          `${name}'s premium under management is ${formatMoney(total)} across ${bound.length} bound ${plural(
            bound.length,
            "policy",
            "policies"
          )}. ` +
          `Per-policy premiums show on each policy's detail page (View on the Policies card).`,
        related: [`How many policies does ${name} have?`],
        topicId: "data-premium",
        action: selected ? policyAction(selected.id, "View policy") : clientAction(contact.id),
      };
    }
    case "renewalDate": {
      const policyIds = new Set(
        api.policies.listByCustomer(contact.id).map((p) => p.id)
      );
      const upcoming = api.renewals
        .listByTenant(ctx.tenantId)
        .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming")
        .sort((a, b) => (a.renewalDate < b.renewalDate ? -1 : 1));
      if (upcoming.length === 0) {
        return {
          text: `${name} has no upcoming renewals on file right now.`,
          topicId: "data-renewalDate",
          action: clientAction(contact.id),
        };
      }
      const lines = upcoming.slice(0, 5).map((r) => {
        const pol = api.policies.get(r.policyId);
        const asset = pol ? api.assets.get(pol.assetId) : undefined;
        return `- ${asset?.label ?? pol?.policyNumber ?? "Policy"} - ${formatDate(r.renewalDate)}`;
      });
      return {
        text:
          `${name}'s upcoming ${plural(upcoming.length, "renewal", "renewals")}:\n` +
          lines.join("\n") +
          `\n\nSee them on the client profile's Upcoming renewals card.`,
        topicId: "data-renewalDate",
        action: policyAction(upcoming[0].policyId, "View renewal policy"),
      };
    }
    case "status": {
      const policies = api.policies.listByCustomer(contact.id);
      if (policies.length === 0) {
        return { text: `${name} has no policies on file yet.`, topicId: "data-status" };
      }
      const lines = policies.slice(0, 6).map((p) => {
        const asset = api.assets.get(p.assetId);
        return `- ${asset?.label ?? p.policyNumber ?? "Policy"} - ${p.status.replace(/_/g, " ")}`;
      });
      return {
        text: `${name}'s policy statuses:\n` + lines.join("\n"),
        topicId: "data-status",
        action: policyAction(bestPolicyForQuestion(question, policies).id, "View policy"),
      };
    }
    case "assets": {
      const assets = api.assets.listByCustomer(contact.id);
      const n = assets.length;
      return {
        text:
          `${name} has ${n} insured ${plural(n, "asset", "assets")} under management. ` +
          `To view this, go to their client profile and click View on any row in the Assets card to open that asset's detail page - structured details, the policies attached to it (each with its own View), documents, and the asset's activity timeline. Customers see the same per-asset view under My assets in their portal.`,
        related: ["How do I view full policy details?"],
        topicId: "data-assets",
        action: assets.length === 1
          ? assetAction(contact.id, assets[0].id)
          : clientAction(contact.id, "View assets"),
      };
    }
    case "policies": {
      const policies = api.policies.listByCustomer(contact.id);
      const n = policies.length;
      const bound = policies.filter((p) => p.status === "bound").length;
      const selected = bestPolicyForQuestion(question, policies);
      return {
        text:
          `${name} has ${n} ${plural(n, "policy", "policies")} on file${
            n > 0 ? ` (${bound} bound)` : ""
          }. ` +
          `Open their client profile -> Policies card and click View on any policy for the full detail page - coverage, dates, premium, timeline, and documents.`,
        related: ["How do I view full policy details?"],
        topicId: "data-policies",
        action: selected ? policyAction(selected.id) : clientAction(contact.id, "View policies"),
      };
    }
    case "claims": {
      const claims = api.claims.listByCustomer(contact.id);
      const n = claims.length;
      const open = claims.filter((c) => c.status !== "closed").length;
      const selected = bestClaimForQuestion(question, claims);
      return {
        text:
          `${name} has ${n} ${plural(n, "claim", "claims")}${
            n > 0 ? ` - ${open} open, ${n - open} closed` : ""
          }. ` +
          `See them on the Claims card of their client profile. Open claims also show up as activities in the Activity Center until they're resolved.`,
        related: ["How does document review work?"],
        topicId: "data-claims",
        action: selected ? claimAction(selected.id) : clientAction(contact.id, "View client"),
      };
    }
    case "renewals": {
      const policyIds = new Set(api.policies.listByCustomer(contact.id).map((p) => p.id));
      const upcoming = api.renewals
        .listByTenant(ctx.tenantId)
        .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming");
      const n = upcoming.length;
      return {
        text:
          `${name} has ${n} upcoming ${plural(n, "renewal", "renewals")}. ` +
          `They're listed on the Upcoming renewals card of their client profile, and the Renewals category tracks the whole agency's pipeline.`,
        topicId: "data-renewals",
        action: upcoming[0] ? policyAction(upcoming[0].policyId, "View renewal policy") : clientAction(contact.id),
      };
    }
    case "documents": {
      const n = api.documents.listByEntity({ customerId: contact.id }).length;
      return {
        text:
          `${name} has ${n} ${plural(n, "document", "documents")} on file. ` +
          `Find them in the Documents card on their client profile; pending uploads also appear on the Document review queue for approval.`,
        related: ["How does document review work?"],
        topicId: "data-documents",
        action: clientAction(contact.id, "View documents"),
      };
    }
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatPercent(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return `${Math.round(n * 100)}%`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "-";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (hours < 24) return m ? `${hours}h ${m}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days}d ${h}h` : `${days}d`;
}

function formatDate(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso?: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type PortalHitKind =
  | "campaign"
  | "marketing-message"
  | "communication"
  | "task"
  | "policy"
  | "claim"
  | "document"
  | "status";

interface PortalSearchHit {
  kind: PortalHitKind;
  id: string;
  title: string;
  detail: string;
  createdAt?: string;
  score: number;
  action: AssistantAction;
  answer: () => AssistantAnswer;
}

const SEARCH_STOP_WORDS = new Set([
  "about",
  "and",
  "any",
  "did",
  "does",
  "for",
  "from",
  "go",
  "goes",
  "going",
  "got",
  "have",
  "how",
  "into",
  "out",
  "regarding",
  "show",
  "the",
  "there",
  "this",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
]);

function normalizeSearchToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function searchTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[_/:-]+/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map(normalizeSearchToken)
        .filter((token) => token.length > 2 && !SEARCH_STOP_WORDS.has(token))
    )
  );
}

function portalSearchScore(query: string, text: string, boost = 0): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 0;
  const haystack = searchTokens(text).join(" ");
  let score = boost;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += token.length > 5 ? 7 : 5;
  });
  const phrase = tokens.join(" ");
  if (phrase.length > 8 && haystack.includes(phrase)) score += 20;
  return score;
}

function isLiveDataQuestion(q: string): boolean {
  return /\b(campaign|marketing|message|email|sms|sent|send|went|go out|launched|scheduled|client|prospect|policy|policies|claim|document|activity|task|renewal|carrier|status|timeline|note|remark|uploaded|created|when|what time)\b/.test(q);
}

function campaignAudienceFacts(campaign: ReturnType<typeof api.marketing.listCampaigns>[number]) {
  const filter = campaign.audienceFilter ?? {};
  const includeAllClients = filter.includeAllClients === true;
  const includeAllProspects = filter.includeAllProspects === true;
  const customerIds = Array.isArray(filter.customerIds)
    ? filter.customerIds.filter((id): id is string => typeof id === "string")
    : [];
  const prospectIds = Array.isArray(filter.prospectIds)
    ? filter.prospectIds.filter((id): id is string => typeof id === "string")
    : [];
  const clientCount = includeAllClients
    ? api.customers.list(campaign.tenantId).filter((c) => !c.archived).length
    : customerIds.length;
  const prospectCount = includeAllProspects
    ? api.prospects.listByTenant(campaign.tenantId).filter((p) => !p.archived).length
    : prospectIds.length;
  const brief = typeof filter.brief === "string" ? filter.brief.trim() : "";
  const audienceParts = [
    includeAllClients ? "all active clients" : customerIds.length ? `${customerIds.length} hand-picked client${customerIds.length === 1 ? "" : "s"}` : "",
    includeAllProspects ? "all active prospects" : prospectIds.length ? `${prospectIds.length} hand-picked prospect${prospectIds.length === 1 ? "" : "s"}` : "",
    typeof filter.assetType === "string" ? `asset type: ${filter.assetType.replace(/_/g, " ")}` : "",
    typeof filter.status === "string" ? `status: ${filter.status.replace(/_/g, " ")}` : "",
    typeof filter.messageStyle === "string" ? `${filter.messageStyle} style` : "",
  ].filter(Boolean);
  return {
    total: clientCount + prospectCount,
    brief,
    audienceLabel: audienceParts.join(" + ") || "stored audience filter",
  };
}

function campaignSentAt(campaign: ReturnType<typeof api.marketing.listCampaigns>[number]) {
  const events = api.status
    .listByTenant(campaign.tenantId)
    .filter((event) => event.marketingCampaignId === campaign.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return campaign.scheduledFor ?? events[0]?.createdAt ?? campaign.createdAt;
}

function answerForCampaign(
  campaign: ReturnType<typeof api.marketing.listCampaigns>[number],
  score: number
): AssistantAnswer {
  const facts = campaignAudienceFacts(campaign);
  const channels = (campaign.channels ?? [campaign.channel]).map((c) => c.toUpperCase()).join(" + ");
  const when = campaignSentAt(campaign);
  const verb =
    campaign.status === "scheduled" || campaign.scheduledFor
      ? "is scheduled for"
      : campaign.status === "paused"
      ? "was created/launched, then paused, at"
      : "went out / was recorded at";
  const action = campaignAction(campaign.id);
  return {
    text:
      `The best matching campaign is "${campaign.name}".\n` +
      `- It ${verb}: ${formatDateTime(when)}\n` +
      `- Status: ${campaign.status}\n` +
      `- Channels: ${channels}\n` +
      `- Audience: ${facts.audienceLabel} (${facts.total} recipient${facts.total === 1 ? "" : "s"})\n` +
      (facts.brief ? `- Stored prompt: ${facts.brief}\n` : "") +
      (score < 20
        ? `\nI matched this from the available campaign metadata; if you meant a different wording, ask with the exact campaign name or prompt phrase.`
        : ""),
    topicId: "data-campaign",
    action,
    actions: [action, categoryAction("/employee/marketing", "Open marketing")],
  };
}

function tryPortalDataAnswer(q: string, ctx: AssistantContext): AssistantAnswer | null {
  if (!isLiveDataQuestion(q)) return null;
  const isManager = ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin";
  const viewer = { id: ctx.viewer.id, role: ctx.viewer.role };
  const customerIds = new Set(api.customers.listVisible(ctx.tenantId, viewer).map((c) => c.id));
  const hits: PortalSearchHit[] = [];
  const addHit = (hit: PortalSearchHit) => {
    if (hit.score > 0) hits.push(hit);
  };

  api.marketing.listCampaigns(ctx.tenantId).forEach((campaign) => {
    const facts = campaignAudienceFacts(campaign);
    const events = api.status
      .listByTenant(ctx.tenantId)
      .filter((event) => event.marketingCampaignId === campaign.id)
      .map((event) => event.message)
      .join(" ");
    const score = portalSearchScore(
      q,
      [
        campaign.name,
        campaign.status,
        campaign.channel,
        (campaign.channels ?? []).join(" "),
        facts.brief,
        facts.audienceLabel,
        JSON.stringify(campaign.audienceFilter),
        events,
        "campaign marketing ai outreach sent launched scheduled went out commercial umbrella policy policies",
      ].join(" "),
      /\bcampaign|marketing|outreach|sent|went|scheduled|launched\b/.test(q) ? 18 : 0
    );
    addHit({
      kind: "campaign",
      id: campaign.id,
      title: campaign.name,
      detail: facts.brief || facts.audienceLabel,
      createdAt: campaignSentAt(campaign),
      score,
      action: campaignAction(campaign.id),
      answer: () => answerForCampaign(campaign, score),
    });
  });

  api.marketing
    .listMessages(ctx.tenantId)
    .filter((message) => !message.customerId || customerIds.has(message.customerId))
    .forEach((message) => {
      const campaign = api.marketing.listCampaigns(ctx.tenantId).find((c) => c.id === message.campaignId);
      const contactName = message.customerId
        ? api.customers.get(message.customerId)?.name
        : message.prospectId
        ? api.prospects.get(message.prospectId)?.name
        : undefined;
      const action =
        message.customerId || message.prospectId
          ? messagesAction({ customerId: message.customerId, prospectId: message.prospectId })
          : campaign
          ? campaignAction(campaign.id)
          : categoryAction("/employee/marketing", "Open marketing");
      const score = portalSearchScore(
        q,
        [message.subject, message.content, message.channel, message.deliveryStatus, campaign?.name, contactName, "marketing message sent email sms"].join(" "),
        /\bmessage|email|sms|sent\b/.test(q) ? 12 : 0
      );
      addHit({
        kind: "marketing-message",
        id: message.id,
        title: message.subject ?? `${message.channel.toUpperCase()} marketing message`,
        detail: `${contactName ?? "Marketing recipient"} - ${message.deliveryStatus}`,
        createdAt: message.sentAt ?? message.createdAt,
        score,
        action,
        answer: () => ({
          text:
            `I found the marketing message "${message.subject ?? `${message.channel.toUpperCase()} message`}".\n` +
            `- Recipient: ${contactName ?? "not tied to a visible contact"}\n` +
            `- Campaign: ${campaign?.name ?? message.campaignId}\n` +
            `- Status: ${message.deliveryStatus}\n` +
            `- Sent/created: ${formatDateTime(message.sentAt ?? message.createdAt)}\n` +
            `- Body preview: ${message.content.slice(0, 220)}${message.content.length > 220 ? "..." : ""}`,
          topicId: "data-marketing-message",
          action,
        }),
      });
    });

  api.tasks
    .listByTenant(ctx.tenantId)
    .filter((task) => isManager || (task.assignedToId ?? "") === ctx.viewer.id)
    .forEach((task) => {
      const score = portalSearchScore(
        q,
        [task.title, task.description, task.status, task.topic, task.severity, "activity task"].join(" "),
        /\bactivity|task|todo|to do|resolved|open\b/.test(q) ? 12 : 0
      );
      addHit({
        kind: "task",
        id: task.id,
        title: task.title,
        detail: task.description ?? "",
        createdAt: task.createdAt,
        score,
        action: taskAction(task.id),
        answer: () => ({
          text:
            `I found the activity "${task.title}".\n` +
            `- Status: ${api.tasks.statusOf(task).replace(/_/g, " ")}\n` +
            `- Created: ${formatDateTime(task.createdAt)}\n` +
            `- Assigned to: ${task.assignedToId ? api.users.get(task.assignedToId)?.name ?? task.assignedToId : "unassigned/routing"}\n` +
            `- Details: ${task.description}`,
          topicId: "data-task",
          action: taskAction(task.id),
        }),
      });
    });

  api.policies
    .listByTenant(ctx.tenantId)
    .filter((policy) => customerIds.has(policy.customerId) || isManager)
    .forEach((policy) => {
      const customer = api.customers.get(policy.customerId);
      const asset = api.assets.get(policy.assetId);
      const carrier = api.carriers.get(policy.carrierId);
      const carrierName = carrier?.name ?? policy.carrierId;
      const score = portalSearchScore(
        q,
        [
          policy.policyNumber,
          policy.status,
          policy.department ?? "personal",
          carrierName,
          customer?.name,
          asset?.label,
          asset?.type,
          "policy coverage premium renewal commercial umbrella",
        ].join(" "),
        /\bpolicy|policies|coverage|premium|renewal\b/.test(q) ? 10 : 0
      );
      addHit({
        kind: "policy",
        id: policy.id,
        title: policy.policyNumber ?? policy.id,
        detail: `${customer?.name ?? "Client"} - ${carrierName}`,
        createdAt: policy.createdAt,
        score,
        action: policyAction(policy.id),
        answer: () => ({
          text:
            `I found policy ${policy.policyNumber ?? policy.id}.\n` +
            `- Client: ${customer?.name ?? "unknown"}\n` +
            `- Asset: ${asset?.label ?? "unknown"}\n` +
            `- Carrier: ${carrierName}\n` +
            `- Status: ${policy.status}\n` +
            `- Renewal: ${formatDate(policy.renewalDate)}\n` +
            `- Premium: ${formatMoney(policy.finalPremium ?? policy.premiumEstimate ?? 0)}`,
          topicId: "data-policy",
          action: policyAction(policy.id),
        }),
      });
    });

  api.claims
    .listByTenant(ctx.tenantId)
    .filter((claim) => !claim.customerId || customerIds.has(claim.customerId) || isManager)
    .forEach((claim) => {
      const customer = claim.customerId ? api.customers.get(claim.customerId) : undefined;
      const carrier = api.carriers.get(claim.carrierId);
      const carrierName = carrier?.name ?? claim.carrierId;
      const policy = api.policies.get(claim.policyId);
      const score = portalSearchScore(
        q,
        [
          carrierName,
          claim.externalClaimNumber,
          claim.status,
          customer?.name,
          policy?.policyNumber,
          "claim loss fnol adjuster",
        ].join(" "),
        /\bclaim|loss|fnol|adjuster\b/.test(q) ? 12 : 0
      );
      addHit({
        kind: "claim",
        id: claim.id,
        title: claim.externalClaimNumber ?? `${carrierName} claim`,
        detail: `${customer?.name ?? "Client"} - ${claim.status}`,
        createdAt: claim.openedAt,
        score,
        action: claimAction(claim.id),
        answer: () => ({
          text:
            `I found the claim with ${carrierName}.\n` +
            `- Client: ${customer?.name ?? "unknown"}\n` +
            `- Status: ${claim.status}\n` +
            `- Opened: ${formatDateTime(claim.openedAt)}\n` +
            `- Claim #: ${claim.externalClaimNumber ?? "not entered"}\n` +
            `- Policy: ${policy?.policyNumber ?? claim.policyId}`,
          topicId: "data-claim",
          action: claimAction(claim.id),
        }),
      });
    });

  api.documents.listByTenant(ctx.tenantId).forEach((document) => {
    const customer = document.customerId ? api.customers.get(document.customerId) : undefined;
    if (document.customerId && !customerIds.has(document.customerId) && !isManager) return;
    const score = portalSearchScore(
      q,
      [
        document.fileName,
        document.documentName,
        document.type,
        document.fileType,
        document.status,
        document.visibility,
        document.lineOfBusiness,
        customer?.name,
        "document upload file signature e-sign",
      ].join(" "),
      /\bdocument|file|upload|signature|e-?sign\b/.test(q) ? 10 : 0
    );
    addHit({
      kind: "document",
      id: document.id,
      title: document.documentName ?? document.fileName,
      detail: `${customer?.name ?? "Agency/library"} - ${document.status}`,
      createdAt: document.uploadedAt,
      score,
      action: categoryAction("/employee/documents", "Open documents"),
      answer: () => ({
        text:
          `I found the document "${document.documentName ?? document.fileName}".\n` +
          `- File: ${document.fileName}\n` +
          `- Type: ${String(document.type).replace(/_/g, " ")}\n` +
          `- Status: ${document.status}\n` +
          `- Uploaded: ${formatDateTime(document.uploadedAt)}\n` +
          `- Attached to: ${customer?.name ?? "agency/library record"}`,
        topicId: "data-document",
        action: categoryAction("/employee/documents", "Open documents"),
        actions: document.customerId
          ? [clientAction(document.customerId, "View client"), categoryAction("/employee/documents", "Open documents")]
          : [categoryAction("/employee/documents", "Open documents")],
      }),
    });
  });

  api.communications
    .listByTenant(ctx.tenantId)
    .filter((comm) => !comm.customerId || customerIds.has(comm.customerId) || isManager)
    .forEach((comm) => {
      const customer = comm.customerId ? api.customers.get(comm.customerId) : undefined;
      const prospect = comm.prospectId ? api.prospects.get(comm.prospectId) : undefined;
      const score = portalSearchScore(
        q,
        [comm.subject, comm.body, comm.channel, comm.direction, customer?.name, prospect?.name, "message email sms thread"].join(" "),
        /\bmessage|email|sms|thread|inbound|outbound\b/.test(q) ? 10 : 0
      );
      addHit({
        kind: "communication",
        id: comm.id,
        title: comm.subject ?? `${comm.channel.toUpperCase()} ${comm.direction}`,
        detail: `${customer?.name ?? prospect?.name ?? "Thread"} - ${comm.direction}`,
        createdAt: comm.createdAt,
        score,
        action: messagesAction(comm),
        answer: () => ({
          text:
            `I found the ${comm.channel.toUpperCase()} ${comm.direction} message "${comm.subject ?? "No subject"}".\n` +
            `- Contact: ${customer?.name ?? prospect?.name ?? "carrier/internal thread"}\n` +
            `- Time: ${formatDateTime(comm.createdAt)}\n` +
            `- Body preview: ${comm.body.slice(0, 240)}${comm.body.length > 240 ? "..." : ""}`,
          topicId: "data-communication",
          action: messagesAction(comm),
        }),
      });
    });

  api.status.listByTenant(ctx.tenantId).forEach((event) => {
    const score = portalSearchScore(
      q,
      [event.message, event.source, event.visibility, "remark event"].join(" "),
      /\bremark|remarks|status|timeline|update|event|when\b/.test(q) ? 8 : 0
    );
    const action = event.marketingCampaignId
      ? campaignAction(event.marketingCampaignId)
      : event.policyId
      ? policyAction(event.policyId)
      : event.claimId
      ? claimAction(event.claimId)
      : event.customerId
      ? clientAction(event.customerId)
      : categoryAction("/employee", "Open dashboard");
    addHit({
      kind: "status",
      id: event.id,
      title: event.message,
      detail: `${event.source} - ${event.visibility}`,
      createdAt: event.createdAt,
      score,
      action,
      answer: () => ({
        text:
          `I found this remark:\n` +
          `- ${event.message}\n` +
          `- Time: ${formatDateTime(event.createdAt)}\n` +
          `- Source: ${event.source}\n` +
          `- Visibility: ${event.visibility.replace(/_/g, " ")}`,
        topicId: "data-status-event",
        action,
      }),
    });
  });

  const best = hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.createdAt ?? "") > (a.createdAt ?? "") ? 1 : -1;
  })[0];
  if (best && best.score >= 18) return best.answer();

  if (/\bcampaign|marketing\b/.test(q)) {
    return {
      text:
        `I couldn't find a marketing campaign that confidently matches that wording in this agency's current records. ` +
        `Try the exact campaign name, part of the prompt, the audience, or a channel/status phrase and I can pull the timestamp and campaign details.`,
      topicId: "data-campaign-not-found",
      action: categoryAction("/employee/marketing", "Open marketing"),
    };
  }

  return null;
}

// Detect a question that's about the whole agency rather than one
// contact ("how many clients does the agency have", "total premium",
// "how many open activities").
const AGGREGATE_RE =
  /\b(agency|agency-wide|company|firm|team|overall|in total|total|altogether|book|everyone|all (clients|prospects|policies|claims|customers))\b/;

function tryAgencyAggregate(q: string, ctx: AssistantContext): AssistantAnswer | null {
  // Only treat as aggregate when it reads like a count/total question.
  const countish = /\b(how many|how much|total|number of|count|are there|do we have)\b/.test(q);
  if (!countish && !AGGREGATE_RE.test(q)) return null;
  if (!countish) return null;

  const viewer = { id: ctx.viewer.id, role: ctx.viewer.role };
  const customers = api.customers.listVisible(ctx.tenantId, viewer);
  const customerIds = new Set(customers.map((c) => c.id));
  const scoped = <T extends { customerId?: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.customerId || customerIds.has(r.customerId));
  const isManager = ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin";
  const scopeNote = isManager ? "" : " (in your book)";

  if (/\bclient|customer\b/.test(q)) {
    return {
      text: `There ${customers.length === 1 ? "is" : "are"} ${customers.length} active ${plural(
        customers.length,
        "client",
        "clients"
      )}${scopeNote}. Browse them under Clients.`,
      topicId: "agg-clients",
      action: categoryAction("/employee/clients", "View clients"),
    };
  }
  if (/\bprospect\b/.test(q)) {
    const prospects = api.prospects
      .listByTenant(ctx.tenantId)
      .filter((p) => isManager || p.assignedAgentId === ctx.viewer.id);
    return {
      text: `There ${prospects.length === 1 ? "is" : "are"} ${prospects.length} active ${plural(
        prospects.length,
        "prospect",
        "prospects"
      )}${scopeNote} (converted ones move to Clients).`,
      topicId: "agg-prospects",
      action: categoryAction("/employee/prospects", "View prospects"),
    };
  }
  if (/\bpremium|under management|revenue|book value\b/.test(q)) {
    const total = api.policies
      .listByTenant(ctx.tenantId)
      .filter((p) => p.status === "bound" && (isManager || customerIds.has(p.customerId)))
      .reduce((s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0), 0);
    return {
      text: `Total premium under management${scopeNote} is ${formatMoney(total)} across all bound policies. The Analytics page breaks this down by trend and agent.`,
      related: ["What is the performance leaderboard?"],
      topicId: "agg-premium",
      action: categoryAction("/employee/analytics", "View analytics"),
    };
  }
  if (/\bpolic/.test(q)) {
    const policies = api.policies
      .listByTenant(ctx.tenantId)
      .filter((p) => isManager || customerIds.has(p.customerId));
    const bound = policies.filter((p) => p.status === "bound").length;
    return {
      text: `There are ${policies.length} policies${scopeNote} - ${bound} bound. The Policies category lists them all.`,
      topicId: "agg-policies",
      action: categoryAction("/employee/policies", "View policies"),
    };
  }
  if (/\bclaim/.test(q)) {
    const claims = scoped(api.claims.listByTenant(ctx.tenantId));
    const open = claims.filter((c) => c.status !== "closed").length;
    return {
      text: `There are ${claims.length} claims${scopeNote}, ${open} still open. Open claims show as activities until resolved.`,
      topicId: "agg-claims",
      action: categoryAction("/employee/claims", "View claims"),
    };
  }
  if (/\b(activity|activities|task|open work|queue)\b/.test(q)) {
    const open = api.tasks
      .listOpen(ctx.tenantId)
      .filter((t) => isManager || (t.assignedToId ?? "") === ctx.viewer.id);
    return {
      text: `There ${open.length === 1 ? "is" : "are"} ${open.length} open ${plural(
        open.length,
        "activity",
        "activities"
      )}${isManager ? " across the agency" : " in your queue"}. Work them in the Activity Center.`,
      related: ["What is the Activity Center?"],
      topicId: "agg-activities",
      action: categoryAction("/employee/tasks", "View activities"),
    };
  }
  if (/\brenew/.test(q)) {
    const policyIds = new Set(
      api.policies
        .listByTenant(ctx.tenantId)
        .filter((p) => isManager || customerIds.has(p.customerId))
        .map((p) => p.id)
    );
    const n = api.renewals
      .listByTenant(ctx.tenantId)
      .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming").length;
    return {
      text: `There ${n === 1 ? "is" : "are"} ${n} upcoming ${plural(
        n,
        "renewal",
        "renewals"
      )}${scopeNote}. See the Renewals category.`,
      topicId: "agg-renewals",
      action: categoryAction("/employee/renewals", "View renewals"),
    };
  }
  if (/\bcarrier/.test(q)) {
    const carriers = api.carriers.listForTenant(ctx.tenantId);
    return {
      text: `This agency works with ${carriers.length} ${plural(
        carriers.length,
        "carrier",
        "carriers"
      )}: ${carriers.slice(0, 8).map((c) => c.name).join(", ")}${
        carriers.length > 8 ? "..." : ""
      }. Manage them under Carrier library.`,
      topicId: "agg-carriers",
      action: categoryAction("/employee/carriers", "View carriers"),
    };
  }
  if (/\bagent|staff|team member|people\b/.test(q) && isManager) {
    const staff = api.users
      .list(ctx.tenantId)
      .filter((u) => u.role === "agent" || u.role === "manager");
    return {
      text: `The team has ${staff.length} ${plural(staff.length, "member", "members")}: ${staff
        .map((u) => u.name)
        .join(", ")}. The Analytics page ranks them on any metric.`,
      related: ["What is the performance leaderboard?"],
      topicId: "agg-staff",
      action: categoryAction("/employee/analytics", "View leaderboard"),
    };
  }
  return null;
}

// Carrier lookups: "what carriers do we work with", "who's the
// underwriter at Chubb", "does <carrier> have an agent portal".
function tryCarrierAnswer(q: string, ctx: AssistantContext): AssistantAnswer | null {
  if (!/\bcarrier|underwriter|adjuster|claims rep|portal\b/.test(q)) return null;
  const carriers = api.carriers.listForTenant(ctx.tenantId);
  const named = carriers.find((c) => q.includes(c.name.toLowerCase()));
  if (named) {
    const contacts = api.carrierContacts.listForCarrier(ctx.tenantId, named.id);
    const reps = contacts
      .slice(0, 5)
      .map((c) => `${c.name} (${c.position.replace(/_/g, " ")}, ${c.email})`);
    return {
      text:
        `${named.name} - writes ${
          named.preferredAssetTypes.map((t) => t.replace(/_/g, " ")).join(", ") || "various lines"
        }. ` +
        `${named.agentPortalUrl ? "Has an agent portal configured." : "No agent portal URL on file."}\n` +
        (reps.length
          ? `Reps on file:\n${reps.map((r) => `- ${r}`).join("\n")}`
          : "No carrier reps on file yet - add them from the carrier card on Carrier library."),
      related: ["How do I add or remove carriers?"],
      topicId: "data-carrier",
      action: categoryAction("/employee/carriers", "View carrier"),
    };
  }
  // No specific carrier named, but the question reads like "what/which
  // carriers do we work with" -> list them.
  if (/\b(what|which|list|work with|do we|our)\b/.test(q)) {
    return {
      text: `This agency works with ${carriers.length} ${plural(
        carriers.length,
        "carrier",
        "carriers"
      )}: ${carriers.map((c) => c.name).join(", ")}. Manage them under Carrier library; tap a carrier to see its reps.`,
      related: ["How do I add or remove carriers?", "How do I upload carrier-specific documents?"],
      topicId: "data-carrier-list",
      action: categoryAction("/employee/carriers", "View carriers"),
    };
  }
  return null;
}

// Per-agent performance lookups: "how many clients does <agent>
// have", "how is <agent> doing".
function tryAgentAnswer(q: string, ctx: AssistantContext): AssistantAnswer | null {
  // Only managers can pull other agents' books.
  const isManager = ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin";
  if (!isManager) return null;
  const staff = api.users
    .list(ctx.tenantId)
    .filter((u) => u.role === "agent" || u.role === "manager");
  return answerForAgentPerformance(q, ctx, staff);
  let match: { id: string; name: string } | null = null;
  let bestScore = 0;
  for (const u of staff) {
    const s = nameMatchScore(u.name, q);
    if (s > bestScore) {
      bestScore = s;
      match = { id: u.id, name: u.name };
    }
  }
  if (!match) return null;
  const clients = api.customers.list(ctx.tenantId).filter((c) => c.assignedAgentId === match!.id);
  const customerIds = new Set(clients.map((c) => c.id));
  const policies = api.policies
    .listByTenant(ctx.tenantId)
    .filter((p) => customerIds.has(p.customerId) && p.status === "bound");
  const premium = policies.reduce(
    (s, p) => s + (p.finalPremium ?? p.premiumEstimate ?? 0),
    0
  );
  const openTasks = api.tasks
    .listOpen(ctx.tenantId)
    .filter((t) => (t.assignedToId ?? "") === match!.id).length;
  return {
    text:
      `${match!.name} - ${clients.length} ${plural(clients.length, "client", "clients")}, ` +
      `${policies.length} bound ${plural(policies.length, "policy", "policies")} (${formatMoney(
        premium
      )} premium), ${openTasks} open ${plural(openTasks, "activity", "activities")}. ` +
      `Open Analytics -> click ${match!.name} for the full drill-down.`,
    related: ["What is the performance leaderboard?", "How do I set performance goals?"],
    topicId: "data-agent-stats",
    action: categoryAction("/employee/analytics", "View analytics"),
  };
}

type StaffUser = ReturnType<typeof api.users.list>[number];

interface AgentMetrics {
  assignedClients: number;
  boundPolicies: number;
  premiumUnderMgmt: number;
  renewalsUpcoming: number;
  openActivities: number;
  inProgress: number;
  resolvedLast30: number;
  resolvedLifetime: number;
  avgHandleMs: number | null;
  avgAckMs: number | null;
  responseRate: number | null;
  outboundMessages: number;
  docsUploaded: number;
  openClaims: number;
  closedClaims: number;
  pendingInbound: number;
}

interface StaffMetricDef {
  label: string;
  lowerIsBetter?: boolean;
  value: (metrics: AgentMetrics) => number;
  format: (value: number) => string;
}

const STAFF_METRICS: Record<string, StaffMetricDef> = {
  premiumUnderMgmt: {
    label: "Premium under management",
    value: (metrics) => metrics.premiumUnderMgmt,
    format: formatMoney,
  },
  assignedClients: {
    label: "Assigned clients",
    value: (metrics) => metrics.assignedClients,
    format: formatNumber,
  },
  boundPolicies: {
    label: "Bound policies",
    value: (metrics) => metrics.boundPolicies,
    format: formatNumber,
  },
  openActivities: {
    label: "Open activities",
    lowerIsBetter: true,
    value: (metrics) => metrics.openActivities,
    format: formatNumber,
  },
  resolvedLast30: {
    label: "Activities resolved in the last 30 days",
    value: (metrics) => metrics.resolvedLast30,
    format: formatNumber,
  },
  responseRate: {
    label: "Response rate",
    value: (metrics) => metrics.responseRate ?? 0,
    format: formatPercent,
  },
  avgHandleMs: {
    label: "Average handle time",
    lowerIsBetter: true,
    value: (metrics) => metrics.avgHandleMs ?? Number.POSITIVE_INFINITY,
    format: formatDurationMs,
  },
  docsUploaded: {
    label: "Documents uploaded",
    value: (metrics) => metrics.docsUploaded,
    format: formatNumber,
  },
  renewalsUpcoming: {
    label: "Upcoming renewals",
    value: (metrics) => metrics.renewalsUpcoming,
    format: formatNumber,
  },
  openClaims: {
    label: "Open claims",
    lowerIsBetter: true,
    value: (metrics) => metrics.openClaims,
    format: formatNumber,
  },
};

function answerForAgentPerformance(
  q: string,
  ctx: AssistantContext,
  staff: StaffUser[]
): AssistantAnswer | null {
  const match = findStaffForQuestion(q, staff);
  const metric = detectStaffMetric(q);
  const asksRoster = /\b(list|who are|what agents|which agents|team roster|staff roster|team members)\b/.test(q);
  const asksRanking =
    /\b(top|best|worst|highest|lowest|most|least|rank|ranking|leaderboard|compare)\b/.test(q) ||
    /\b(who|which)\b.*\b(has|is|are|wrote|writes)\b.*\b(top|best|worst|highest|lowest|most|least)\b/.test(q);
  const hasStaffWords = /\b(agents?|staff|team|employee|manager|teammate|performer)\b/.test(q);
  const hasPerformanceWords =
    /\b(performance|performing|doing|stats|numbers|analytics|leaderboard|book|premium|clients|polic|activities|tasks|response|handle|ack|documents|claims|renewals)\b/.test(q);

  if (
    !match &&
    !asksRoster &&
    !(asksRanking && (metric || hasStaffWords)) &&
    !(hasStaffWords && hasPerformanceWords)
  ) {
    return null;
  }

  const rows = staff.map((user) => ({
    user,
    metrics: buildAgentMetrics(ctx.tenantId, user.id),
  }));

  if (!match) {
    if (asksRoster && !metric && !asksRanking) {
      return {
        text:
          `Agency staff roster:\n` +
          rows
            .map(
              ({ user, metrics }) =>
                `- ${user.name} (${agentRoleLabel(user.role)}): ${metrics.assignedClients} clients, ${formatMoney(
                  metrics.premiumUnderMgmt
                )} premium, ${metrics.openActivities} open activities`
            )
            .join("\n") +
          `\n\nOpen Analytics to drill into any agent or manager on the team.`,
        related: ["What is the performance leaderboard?", "How do I set performance goals?"],
        topicId: "data-agent-roster",
        action: categoryAction("/employee/analytics", "View team analytics"),
      };
    }

    const chosenMetric = metric ?? STAFF_METRICS.premiumUnderMgmt;
    const ranked = [...rows].sort((a, b) => {
      const av = chosenMetric.value(a.metrics);
      const bv = chosenMetric.value(b.metrics);
      return chosenMetric.lowerIsBetter ? av - bv : bv - av;
    });
    const top = ranked[0];
    if (!top) return null;
    return {
      text:
        `${chosenMetric.label} leaderboard:\n` +
        ranked
          .slice(0, 5)
          .map(
            ({ user, metrics }, index) =>
              `${index + 1}. ${user.name} - ${chosenMetric.format(chosenMetric.value(metrics))}`
          )
          .join("\n") +
        `\n\n${top.user.name} is currently leading this metric. Open their analytics drill-down for the full performance picture.`,
      related: ["What is the performance leaderboard?", "How do I set performance goals?"],
      topicId: "data-agent-leaderboard",
      action: staffAnalyticsAction(top.user.id, top.user.name),
      actions: [categoryAction("/employee/analytics", "View full leaderboard")],
    };
  }

  const metrics = buildAgentMetrics(ctx.tenantId, match.id);
  const focusLine = metric
    ? `\n\nFocus metric: ${metric.label} is ${metric.format(metric.value(metrics))}.`
    : "";
  return {
    text:
      `${match.name} (${agentRoleLabel(match.role)}) performance snapshot:\n` +
      `- Assigned clients: ${metrics.assignedClients}\n` +
      `- Bound policies: ${metrics.boundPolicies}\n` +
      `- Premium under management: ${formatMoney(metrics.premiumUnderMgmt)}\n` +
      `- Open activities: ${metrics.openActivities} (${metrics.inProgress} in progress)\n` +
      `- Activities resolved: ${metrics.resolvedLast30} in the last 30 days, ${metrics.resolvedLifetime} lifetime\n` +
      `- Response rate: ${formatPercent(metrics.responseRate)}\n` +
      `- Avg handle time: ${formatDurationMs(metrics.avgHandleMs)}\n` +
      `- Documents uploaded: ${metrics.docsUploaded}\n` +
      `- Renewals upcoming: ${metrics.renewalsUpcoming}\n` +
      `- Claims: ${metrics.openClaims} open, ${metrics.closedClaims} closed` +
      focusLine +
      `\n\nOpen ${match.name}'s Analytics drill-down for the full performance view.`,
    related: ["What is the performance leaderboard?", "How do I set performance goals?"],
    topicId: "data-agent-stats",
    action: staffAnalyticsAction(match.id, match.name),
  };
}

function buildAgentMetrics(agencyId: string, agentId: string): AgentMetrics {
  const customers = api.customers
    .list(agencyId)
    .filter((c) => c.assignedAgentId === agentId);
  const customerIds = new Set(customers.map((c) => c.id));
  const policies = api.policies
    .listByTenant(agencyId)
    .filter((p) => customerIds.has(p.customerId));
  const tasks = api.tasks
    .listByTenant(agencyId)
    .filter((t) => t.assignedToId === agentId);
  const notifications = api.aiNotifications
    .listByTenant(agencyId)
    .filter((n) => n.assignedToId === agentId);
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const resolved30 = tasks.filter(
    (t) => t.completedAt && new Date(t.completedAt).getTime() >= since
  );
  const handleSamples = tasks
    .filter((t) => t.startedAt && t.completedAt)
    .map((t) => new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime())
    .filter((n) => n > 0);
  const ackSamples = notifications
    .filter((n) => n.acknowledgedAt)
    .map((n) => new Date(n.acknowledgedAt!).getTime() - new Date(n.createdAt).getTime())
    .filter((n) => n > 0);
  const allInboundForBook = customers.flatMap((c) =>
    api.communications.listByCustomer(c.id).filter((cm) => cm.direction === "inbound")
  );
  const resolvedInbound = allInboundForBook.filter((c) => c.resolvedAt);
  const outboundMessages = api.marketing
    .listMessages(agencyId)
    .filter(
      (m) => m.customerId && customerIds.has(m.customerId) && m.deliveryStatus === "sent"
    );
  const docsUploaded = api.documents
    .listByTenant(agencyId)
    .filter((d) => d.uploadedById === agentId).length;
  const claims = api.claims
    .listByTenant(agencyId)
    .filter((claim) => customerIds.has(claim.customerId));
  const renewals = api.renewals
    .listByTenant(agencyId)
    .filter((renewal) => {
      const policy = policies.find((p) => p.id === renewal.policyId);
      return policy && renewal.status === "upcoming";
    });
  const inboundComms = api.communications
    .listPendingForTenant(agencyId)
    .filter((c) => c.customerId && customerIds.has(c.customerId));

  return {
    assignedClients: customers.length,
    boundPolicies: policies.filter((p) => p.status === "bound").length,
    premiumUnderMgmt: policies
      .filter((p) => p.status === "bound")
      .reduce((sum, p) => sum + (p.finalPremium ?? p.premiumEstimate ?? 0), 0),
    renewalsUpcoming: renewals.length,
    openActivities: tasks.filter((t) => !t.completedAt).length,
    inProgress: tasks.filter((t) => api.tasks.statusOf(t) === "in_progress").length,
    resolvedLast30: resolved30.length,
    resolvedLifetime: tasks.filter((t) => t.completedAt).length,
    avgHandleMs: handleSamples.length ? avgNumber(handleSamples) : null,
    avgAckMs: ackSamples.length ? avgNumber(ackSamples) : null,
    responseRate:
      allInboundForBook.length === 0 ? null : resolvedInbound.length / allInboundForBook.length,
    outboundMessages: outboundMessages.length,
    docsUploaded,
    openClaims: claims.filter((c) => c.status !== "closed").length,
    closedClaims: claims.filter((c) => c.status === "closed").length,
    pendingInbound: inboundComms.length,
  };
}

function findStaffForQuestion(q: string, staff: StaffUser[]): StaffUser | null {
  let match: StaffUser | null = null;
  let bestScore = 0;
  for (const user of staff) {
    const email = user.email?.toLowerCase();
    const score = Math.max(nameMatchScore(user.name, q), email && q.includes(email) ? 20 : 0);
    if (score > bestScore) {
      bestScore = score;
      match = user;
    }
  }
  if (match && bestScore >= 3) return match;

  const uniqueTokenHits = staff.filter((user) => {
    const tokens = user.name.toLowerCase().split(/\s+/).filter((token) => token.length > 2);
    return tokens.some((token) => q.includes(token));
  });
  return uniqueTokenHits.length === 1 ? uniqueTokenHits[0] : null;
}

function detectStaffMetric(q: string): StaffMetricDef | null {
  if (/\b(open activities|open activity|open tasks|unfinished|backlog|queue)\b/.test(q)) {
    return STAFF_METRICS.openActivities;
  }
  if (/\b(response rate|reply rate|resolved inbound)\b/.test(q)) return STAFF_METRICS.responseRate;
  if (/\b(handle time|resolution time|average time)\b/.test(q)) return STAFF_METRICS.avgHandleMs;
  if (/\b(documents uploaded|docs uploaded|uploads)\b/.test(q)) return STAFF_METRICS.docsUploaded;
  if (/\b(resolved|closed activities|activities resolved|tasks resolved)\b/.test(q)) {
    return STAFF_METRICS.resolvedLast30;
  }
  if (/\b(claim|claims)\b/.test(q)) return STAFF_METRICS.openClaims;
  if (/\b(renewal|renewals)\b/.test(q)) return STAFF_METRICS.renewalsUpcoming;
  if (/\b(bound policies|policies bound|policy count|policies)\b/.test(q)) {
    return STAFF_METRICS.boundPolicies;
  }
  if (/\b(client|clients|book size|accounts)\b/.test(q)) return STAFF_METRICS.assignedClients;
  if (/\b(premium|revenue|book value|under management|written)\b/.test(q)) {
    return STAFF_METRICS.premiumUnderMgmt;
  }
  return null;
}

function staffAnalyticsAction(agentId: string, name: string): AssistantAction {
  return {
    label: `View ${name} performance`,
    to: `/employee/analytics?agent=${encodeURIComponent(agentId)}`,
  };
}

function agentRoleLabel(role: string): string {
  return role === "manager" ? "Manager" : "Agent";
}

function avgNumber(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Core matcher. `role` lets us add a one-line caveat when a
// manager-only answer is requested by an agent. `ctx` (when present)
// unlocks data lookups about specific clients / prospects.
// A single prior message in the conversation, sent by the panel so the
// assistant can resolve follow-up questions ("tell me more", "and for
// managers?", "how do I get there?") against the previously-discussed
// topic instead of treating each message in isolation.
export interface AssistantHistoryItem {
  from: "user" | "assistant";
  text: string;
  // Set on assistant messages so we can re-anchor on the same KB
  // entry without re-running the matcher from a pronoun-only query.
  topicId?: string;
}

// Cues that the user is asking for more on the same topic (rather
// than switching to something new).
const MORE_DETAIL_RE = /\b(more|details?|tell me more|step by step|in detail|expand|continue|go on|keep going|next|what else)\b/;
// Cues that the user is referring back to the previous topic
// (pronouns, short continuations).
const FOLLOWUP_PRONOUNS_RE = /\b(it|that|this|there|them|those|these|same|one|its|their)\b/;
const FOLLOWUP_CONTINUERS_RE = /\b(and|also|but|so|then|or|plus|too|after that|what about|how about|for managers?|for agents?|for me)\b/;

function lastAssistantTopic(history?: AssistantHistoryItem[]): KbEntry | null {
  if (!history || history.length === 0) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.from === "assistant" && m.topicId) {
      return KB.find((e) => e.id === m.topicId) ?? null;
    }
  }
  return null;
}

function seenAssistantTopicIds(history?: AssistantHistoryItem[]): Set<string> {
  const s = new Set<string>();
  (history ?? []).forEach((m) => {
    if (m.from === "assistant" && m.topicId) s.add(m.topicId);
  });
  return s;
}

const ACTION_COMMAND_PHRASES =
  "create reminder|add reminder|go to|take me|bring me|show me|open|start|begin|mark|resolve|complete|snooze|set|change|make|create|add|write|log|record|schedule|remind|reopen|send|email|text|sms|archive|delete|download|upload|assign|reassign|route|reroute|approve|reject|publish|renew|edit|save|dismiss|restore|pause|resume|move|update|implement";
const ACTION_VERB_RE = new RegExp(`\\b(?:${ACTION_COMMAND_PHRASES})\\b`);
const ACTION_COMMAND_RE = new RegExp(
  `^(?:please\\s+)?(?:${ACTION_COMMAND_PHRASES})\\b|^(?:can you|could you|please)\\s+(?:${ACTION_COMMAND_PHRASES})\\b`
);
const INSTRUCTIONAL_QUESTION_RE =
  /\b(how do i|how can i|how would i|show me how|tell me how|teach me|walk me through|walk through|step by step|tutorial|training video|training|video|learn|explain|what is|what are|where is|where are|where do i|where can i|how does|how do|help me understand)\b/;
const INSTRUCTIONAL_WORD_RE =
  /\b(how|where|what|why|explain|teach|walk|training|tutorial|learn|video)\b/;

function isInstructionalQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) return false;
  if (ACTION_COMMAND_RE.test(q) && !INSTRUCTIONAL_WORD_RE.test(q)) return false;
  return INSTRUCTIONAL_QUESTION_RE.test(q);
}

function isDirectActionCommand(question: string): boolean {
  const q = question.trim().toLowerCase();
  return ACTION_COMMAND_RE.test(q) && !isInstructionalQuestion(q);
}

const CATEGORY_TARGETS: Array<{ re: RegExp; to: string; label: string }> = [
  { re: /\b(dashboard|home)\b/, to: "/employee", label: "Open dashboard" },
  { re: /\b(activity center|activities|tasks|to do|workflow|workflows)\b/, to: "/employee/tasks", label: "Open Activity Center" },
  { re: /\b(calendar|calender|agenda)\b/, to: "/employee/calendar", label: "Open calendar" },
  { re: /\b(messages?|email|sms|inbox)\b/, to: "/employee/messages", label: "Open messages" },
  { re: /\b(prospects?)\b/, to: "/employee/prospects", label: "Open prospects" },
  { re: /\b(clients?)\b/, to: "/employee/clients", label: "Open clients" },
  { re: /\b(policies|policy)\b/, to: "/employee/policies", label: "Open policies" },
  { re: /\b(claims?)\b/, to: "/employee/claims", label: "Open claims" },
  { re: /\b(billing|payment plan)\b/, to: "/employee/billing", label: "Open billing" },
  { re: /\b(renewals?|non-renewal|nonrenewal)\b/, to: "/employee/renewals", label: "Open renewals" },
  { re: /\b(document review|documents?|templates?)\b/, to: "/employee/documents", label: "Open document review" },
  { re: /\b(marketing|campaigns?)\b/, to: "/employee/marketing", label: "Open AI marketing" },
  { re: /\b(carrier library|carriers?)\b/, to: "/employee/carriers", label: "Open carrier library" },
  { re: /\b(analytics|goals?|leaderboard|performance)\b/, to: "/employee/analytics", label: "Open analytics" },
  { re: /\b(accounting|timesheets?)\b/, to: "/employee/accounting", label: "Open accounting" },
  { re: /\b(hr|human resources|complaint|suggestion)\b/, to: "/employee/hr", label: "Open HR" },
  { re: /\b(archive|archived)\b/, to: "/employee/archive", label: "Open archive" },
  { re: /\b(training|videos?)\b/, to: "/employee/training", label: "Open training videos" },
  { re: /\b(agency settings|settings)\b/, to: "/employee/settings", label: "Open agency settings" },
  { re: /\b(account settings|my account|profile settings|sign out)\b/, to: "/employee/account-settings", label: "Open account settings" },
];

function executableAnswer(input: {
  text: string;
  pendingAction: AssistantExecutableAction;
  related?: string[];
  actions?: AssistantAction[];
}): AssistantAnswer {
  return {
    text: input.text,
    pendingAction: input.pendingAction,
    related: input.related,
    actions: input.actions,
    topicId: "action-proposal",
  };
}

function contactFromCurrentPath(ctx: AssistantContext): MatchedContact | null {
  const path = ctx.currentPath ?? "";
  const clientId = /\/employee\/clients\/([^/?#]+)/.exec(path)?.[1];
  if (clientId) {
    const customer = api.customers.get(decodeURIComponent(clientId));
    if (customer && api.customers.canSee(customer, ctx.viewer)) {
      return { kind: "customer", id: customer.id, name: customer.name };
    }
  }
  const prospectId = /\/employee\/prospects\/([^/?#]+)/.exec(path)?.[1];
  if (prospectId) {
    const prospect = api.prospects.get(decodeURIComponent(prospectId));
    const allowed =
      !!prospect &&
      (ctx.viewer.role === "manager" ||
        ctx.viewer.role === "master_admin" ||
        prospect.assignedAgentId === ctx.viewer.id ||
        (prospect.additionalAgentIds ?? []).includes(ctx.viewer.id));
    if (prospect && allowed) {
      return { kind: "prospect", id: prospect.id, name: prospect.name };
    }
  }
  return null;
}

function resolveContactForAssistantAction(raw: string, ctx: AssistantContext): MatchedContact | null {
  const q = raw.toLowerCase();
  const explicit = findContact(q, ctx);
  if (explicit && explicit.score >= 6) return explicit.contact;
  if (/\b(this|current|here|client|customer|prospect)\b/.test(q)) {
    return contactFromCurrentPath(ctx);
  }
  return contactFromCurrentPath(ctx);
}

function describeContact(contact: MatchedContact): string {
  return `${contact.name} ${contact.kind === "customer" ? "client" : "prospect"}`;
}

function stripLeadingCommand(raw: string): string {
  return raw
    .replace(/^(?:please\s+)?(?:can you|could you)\s+/i, "")
    .replace(/^(?:please\s+)?(?:create|add|write|log|record|make|set|schedule)\s+(?:a\s+|an\s+)?/i, "")
    .trim();
}

function extractNoteBody(raw: string): string | null {
  const patterns = [
    /\b(?:note|remark)\s+(?:for|on|to|about)?\s*.*?\b(?:that|saying|says|as)\s+(.+)$/i,
    /\b(?:write|log|record|add)\s+(?:a\s+)?(?:note|remark)\s+(?:for|on|to|about)?\s*.*?:\s*(.+)$/i,
    /\b(?:note|remark)\s*:\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const body = match?.[1]?.trim();
    if (body && body.length >= 3) return sentenceCase(body);
  }
  return null;
}

function extractTaskTitle(raw: string): string | null {
  const cleaned = stripLeadingCommand(raw);
  const patterns = [
    /\b(?:activity|task)\s+(?:for|on|about|to)?\s*.*?\b(?:to|that says|saying|called|titled)\s+(.+?)(?:\s+(?:tomorrow|today|next week|in \d+ (?:hours?|days?)))?$/i,
    /\b(?:follow up|call|email|text|send|review|check)\b.+/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(cleaned);
    const title = (match?.[1] ?? match?.[0])?.trim();
    if (title && title.length >= 3) return sentenceCase(title).replace(/\s+for\s+this\s+client$/i, "");
  }
  return null;
}

function extractEventTitle(raw: string): string | null {
  const patterns = [
    /\b(?:calendar event|event|meeting)\s+(?:called|titled|for|about)?\s+(.+?)(?:\s+(?:tomorrow|today|next week|in \d+ (?:hours?|days?)))?$/i,
    /\bschedule\s+(.+?)(?:\s+(?:tomorrow|today|next week|in \d+ (?:hours?|days?)))?$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const title = match?.[1]?.trim();
    if (title && title.length >= 3) return sentenceCase(title);
  }
  return null;
}

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.!?]\s*$/, "");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function tryAssistantAction(
  raw: string,
  ctx: AssistantContext
): AssistantAnswer | null {
  const q = raw.trim().toLowerCase();
  if (isInstructionalQuestion(q)) return null;
  if (!ACTION_VERB_RE.test(q)) return null;
  if (!ACTION_COMMAND_RE.test(q)) return null;

  const contact = resolveContactForAssistantAction(raw, ctx);
  if (/\b(open|go to|take me|bring me|show me)\b/.test(q)) {
    if (contact) {
      let action = contactProfileAction(contact);
      if (/\b(ai quoting|quoting workspace|quote workspace|quote)\b/.test(q)) {
        action = contactQuotingAction(contact);
      } else if (/\b(message|messages|email|sms|thread)\b/.test(q)) {
        action = contactMessagesAction(contact);
      } else if (/\b(document|documents|docs|files)\b/.test(q)) {
        action = contactDocumentsAction(contact);
      } else if (contact.kind === "customer" && /\b(billing|payment plan|premium due|how paid)\b/.test(q)) {
        const policy = findPolicyForAssistantAction(q, ctx, contact);
        if (!policy) {
          return {
            text: `${contact.name} does not have a policy billing record I can open yet.`,
            topicId: "action-no-target",
            action: contactProfileAction(contact, "Open client"),
          };
        }
        action = billingAction(policy.id, "Open billing");
      } else if (contact.kind === "customer" && /\b(policy|policies|coverage)\b/.test(q)) {
        const policy = findPolicyForAssistantAction(q, ctx, contact);
        if (!policy) {
          return {
            text: `${contact.name} does not have a policy I can open yet.`,
            topicId: "action-no-target",
            action: contactProfileAction(contact, "Open client"),
          };
        }
        action = policyAction(policy.id, "Open policy");
      } else if (contact.kind === "customer" && /\b(claim|claims|loss)\b/.test(q)) {
        const claim = findClaimForAssistantAction(q, ctx, contact);
        if (!claim) {
          return {
            text: `${contact.name} does not have a claim I can open yet.`,
            topicId: "action-no-target",
            action: contactProfileAction(contact, "Open client"),
          };
        }
        action = claimAction(claim.id, "Open claim");
      }
      return executableAnswer({
        text: `I can open ${action.label.replace(/^Open /, "").toLowerCase()} for ${contact.name}.`,
        pendingAction: {
          kind: "navigate",
          label: action.label,
          confirmation: `${action.label} for ${contact.name}?`,
          to: action.to,
        },
      });
    }
    const policy = /\b(billing|payment|policy|coverage)\b/.test(q)
      ? findPolicyForAssistantAction(q, ctx)
      : null;
    if (policy) {
      const action = /\b(billing|payment)\b/.test(q)
        ? billingAction(policy.id, "Open billing")
        : policyAction(policy.id, "Open policy");
      return executableAnswer({
        text: `I can open ${action.label.replace(/^Open /, "").toLowerCase()} for ${policy.policyNumber ?? "that policy"}.`,
        pendingAction: {
          kind: "navigate",
          label: action.label,
          confirmation: `${action.label} for ${policy.policyNumber ?? "this policy"}?`,
          to: action.to,
        },
      });
    }
    const claim = /\b(claim|loss)\b/.test(q) ? findClaimForAssistantAction(q, ctx) : null;
    if (claim) {
      const action = claimAction(claim.id, "Open claim");
      return executableAnswer({
        text: `I can open that claim.`,
        pendingAction: {
          kind: "navigate",
          label: action.label,
          confirmation: "Open this claim?",
          to: action.to,
        },
      });
    }
    const target = CATEGORY_TARGETS.find((item) => item.re.test(q));
    if (target) {
      return executableAnswer({
        text: `I can take you to ${target.label.replace(/^Open /, "")}.`,
        pendingAction: {
          kind: "navigate",
          label: target.label,
          confirmation: `${target.label}?`,
          to: target.to,
        },
      });
    }
  }

  const reminderAt = parseAssistantDate(q);
  if (/\b(note|remark)\b/.test(q) && /\b(create|add|write|log|record|make)\b/.test(q)) {
    const target = contact;
    if (!target) {
      return {
        text: "I can add a remark, but I need to know which client or prospect it belongs to.",
        related: ["Open clients", "Open prospects"],
        topicId: "action-needs-target",
      };
    }
    const body = extractNoteBody(raw);
    if (!body) {
      return {
        text: `I can add a remark to ${describeContact(target)}, but I need the note text. Try: "add a note to ${target.name} that the client called about billing."`,
        topicId: "action-needs-details",
        action: contactProfileAction(target),
      };
    }
    const visibility: "internal" | "customer_visible" = /\b(customer visible|client visible|share with client|show client)\b/.test(q)
      ? "customer_visible"
      : "internal";
    return executableAnswer({
      text: `I can add this ${visibility === "customer_visible" ? "customer-visible" : "internal"} remark to ${describeContact(target)}.`,
      pendingAction: {
        kind: "note.create",
        label: "Add remark",
        confirmation: `Add this ${visibility === "customer_visible" ? "customer-visible" : "internal"} remark to ${target.name}: "${body}"?`,
        body,
        customerId: target.kind === "customer" ? target.id : undefined,
        prospectId: target.kind === "prospect" ? target.id : undefined,
        visibility,
      },
      actions: [contactProfileAction(target)],
    });
  }

  const reminderAnswer = buildReminderActionAnswer(raw, q, ctx, contact);
  if (reminderAnswer) return reminderAnswer;

  if (/\b(calendar event|calendar|calender|event|meeting|schedule)\b/.test(q) && /\b(create|add|schedule|make|set)\b/.test(q)) {
    const startsAt = reminderAt ?? tomorrowAt(9);
    const title = extractEventTitle(raw) ?? "Portal assistant event";
    return executableAnswer({
      text: `I can add "${title}" to your calendar for ${fmt.dateTime(startsAt)}.`,
      pendingAction: {
        kind: "calendar.create",
        label: "Create calendar event",
        confirmation: `Create calendar event "${title}" for ${fmt.dateTime(startsAt)}?`,
        title,
        startsAt,
        importance: detectSeverity(q) ?? "info",
      },
      actions: [categoryAction("/employee/calendar", "Open calendar")],
    });
  }

  if (/\b(activity|task|follow up|follow-up)\b/.test(q) && /\b(create|add|make|set)\b/.test(q)) {
    const target = contact;
    const title = extractTaskTitle(raw);
    if (!title) {
      return {
        text: "I can create an activity, but I need a clear title or next step.",
        topicId: "action-needs-details",
        action: categoryAction("/employee/tasks", "Open Activity Center"),
      };
    }
    const assignedToId = ctx.viewer.id;
    return executableAnswer({
      text: target
        ? `I can create an activity for ${describeContact(target)} and assign it to you.`
        : "I can create a general activity and assign it to you.",
      pendingAction: {
        kind: "task.create",
        label: "Create activity",
        confirmation: `Create activity "${title}"${target ? ` for ${target.name}` : ""}${reminderAt ? ` due ${fmt.dateTime(reminderAt)}` : ""}?`,
        title,
        customerId: target?.kind === "customer" ? target.id : undefined,
        prospectId: target?.kind === "prospect" ? target.id : undefined,
        assignedToId,
        severity: detectSeverity(q) ?? "info",
        dueAt: reminderAt ?? undefined,
      },
      actions: [
        categoryAction("/employee/tasks", "Open Activity Center"),
        ...(target ? [contactProfileAction(target)] : []),
      ],
    });
  }

  const task = resolveTaskForAssistantAction(q, ctx);
  if (!task) {
    if (/\b(activity|task|resolve|complete|snooze|due|importance|urgent|high|medium|low|reopen|start|begin)\b/.test(q)) {
      return {
        text:
          "I can do that, but I need an exact activity first. Open the activity or client page, or tell me the client/prospect name and the action again.",
        related: ["Open Activity Center", "How do I mark an activity resolved?"],
        topicId: "action-needs-target",
        action: categoryAction("/employee/tasks", "Open Activity Center"),
      };
    }
    return null;
  }

  if (/\b(start|begin|in progress|work on)\b/.test(q)) {
    return executableAnswer({
      text: `I can mark "${task.title}" as in progress.`,
      pendingAction: {
        kind: "task.markInProgress",
        label: "Start activity",
        confirmation: `Mark "${task.title}" as in progress?`,
        taskId: task.id,
      },
      actions: [taskAction(task.id)],
    });
  }

  if (/\b(resolve|complete|mark (it |this |the )?(done|resolved|complete))\b/.test(q)) {
    return executableAnswer({
      text: `I can mark "${task.title}" resolved. If you want a resolution note attached, open the card and use Mark resolved so you can add it before closing.`,
      pendingAction: {
        kind: "task.markResolved",
        label: "Mark resolved",
        confirmation: `Mark "${task.title}" resolved?`,
        taskId: task.id,
      },
      actions: [taskAction(task.id)],
    });
  }

  if (/\b(reopen|open back up|unresolve)\b/.test(q)) {
    return executableAnswer({
      text: `I can reopen "${task.title}".`,
      pendingAction: {
        kind: "task.reopen",
        label: "Reopen activity",
        confirmation: `Reopen "${task.title}"?`,
        taskId: task.id,
      },
      actions: [taskAction(task.id)],
    });
  }

  if (/\bsnooze\b/.test(q)) {
    const days: 1 | 3 | 7 = /\b(week|7)\b/.test(q) ? 7 : /\b(3|three)\b/.test(q) ? 3 : 1;
    return executableAnswer({
      text: `I can snooze "${task.title}" for ${days} day${days === 1 ? "" : "s"}.`,
      pendingAction: {
        kind: "task.snooze",
        label: "Snooze activity",
        confirmation: `Snooze "${task.title}" for ${days} day${days === 1 ? "" : "s"}?`,
        taskId: task.id,
        days,
      },
      actions: [taskAction(task.id)],
    });
  }

  const severity = detectSeverity(q);
  if (severity && /\b(importance|priority|urgent|high|medium|low|severity)\b/.test(q)) {
    const label = severity === "urgent" ? "High" : severity === "warning" ? "Medium" : "Low";
    return executableAnswer({
      text: `I can set "${task.title}" to ${label} importance.`,
      pendingAction: {
        kind: "task.setSeverity",
        label: "Set importance",
        confirmation: `Set "${task.title}" to ${label} importance?`,
        taskId: task.id,
        severity,
      },
      actions: [taskAction(task.id)],
    });
  }

  if (/\b(due|deadline)\b/.test(q)) {
    const dueAt = /\b(clear|remove|delete)\b/.test(q) ? undefined : reminderAt ?? tomorrowAt(17);
    return executableAnswer({
      text: dueAt
        ? `I can set "${task.title}" due ${fmt.dateTime(dueAt)}.`
        : `I can clear the due date on "${task.title}".`,
      pendingAction: {
        kind: "task.setDueAt",
        label: dueAt ? "Set due date" : "Clear due date",
        confirmation: dueAt
          ? `Set "${task.title}" due ${fmt.dateTime(dueAt)}?`
          : `Clear the due date on "${task.title}"?`,
        taskId: task.id,
        dueAt,
      },
      actions: [taskAction(task.id)],
    });
  }

  return null;
}

function actionNeedsSpecificsAnswer(raw: string, ctx: AssistantContext): AssistantAnswer {
  const q = raw.trim().toLowerCase();
  const contact = resolveContactForAssistantAction(raw, ctx);
  let action: AssistantAction | undefined;

  if (contact) {
    if (/\b(document|documents|docs|pdf|file|files|upload|download|publish|holder|holders)\b/.test(q)) {
      action = contactDocumentsAction(contact, "Open documents");
    } else if (/\b(message|messages|email|sms|text|send)\b/.test(q)) {
      action = contactMessagesAction(contact, "Open message thread");
    } else if (/\b(quote|quoting|questionnaire|supplemental)\b/.test(q)) {
      action = contactQuotingAction(contact);
    } else if (/\b(billing|payment|premium)\b/.test(q) && contact.kind === "customer") {
      const policy = findPolicyForAssistantAction(q, ctx, contact);
      action = policy ? billingAction(policy.id, "Open billing") : contactProfileAction(contact, "Open client");
    } else if (/\b(policy|policies|coverage|renew)\b/.test(q) && contact.kind === "customer") {
      const policy = findPolicyForAssistantAction(q, ctx, contact);
      action = policy ? policyAction(policy.id, "Open policy") : contactProfileAction(contact, "Open client");
    } else {
      action = contactProfileAction(contact);
    }
  } else {
    const target = CATEGORY_TARGETS.find((item) => item.re.test(q));
    if (target) {
      action = categoryAction(target.to, target.label);
    } else if (/\b(send|email|sms|text|message)\b/.test(q)) {
      action = categoryAction("/employee/messages", "Open messages");
    } else if (/\b(document|documents|docs|pdf|file|files|upload|download|publish)\b/.test(q)) {
      action = categoryAction("/employee/documents", "Open document review");
    } else if (/\b(assign|reassign|route|reroute|activity|task|workflow|workflows)\b/.test(q)) {
      action = categoryAction("/employee/tasks", "Open Activity Center");
    } else if (/\b(campaign|marketing|pause|resume|pamphlet)\b/.test(q)) {
      action = categoryAction("/employee/marketing", "Open AI marketing");
    }
  }

  const text =
    "I understand this as something you want done in the app, so I won't answer with a training video. I need the exact record and details before I can safely prepare the confirmation.";

  if (!action) {
    return {
      text,
      topicId: "action-needs-details",
      related: ["Open Activity Center", "Open clients", "Open documents", "Open messages"],
    };
  }

  return executableAnswer({
    text,
    pendingAction: {
      kind: "navigate",
      label: action.label,
      confirmation: `${action.label} so you can choose the exact record and finish the action?`,
      to: action.to,
    },
    actions: [action],
    related: ["Open Activity Center", "Open clients", "Open documents", "Open messages"],
  });
}

function resolveTaskForAssistantAction(q: string, ctx: AssistantContext): Task | null {
  const path = ctx.currentPath ?? "";
  const focus = /[?&]focus=([^&]+)/.exec(path)?.[1];
  if (focus) {
    const task = api.tasks.get(decodeURIComponent(focus));
    if (task && task.tenantId === ctx.tenantId && canSeeTask(task, ctx)) return task;
  }

  const byContact = findContact(q, ctx);
  const contactTask =
    byContact && byContact.score >= 6
      ? latestOpenTaskForContact(ctx, byContact.contact)
      : null;
  if (contactTask) return contactTask;

  const clientId = /\/employee\/clients\/([^/?#]+)/.exec(path)?.[1];
  if (clientId) {
    const task = latestOpenTaskForContact(ctx, { kind: "customer", id: clientId, name: "" });
    if (task) return task;
  }
  const prospectId = /\/employee\/prospects\/([^/?#]+)/.exec(path)?.[1];
  if (prospectId) {
    const task = latestOpenTaskForContact(ctx, { kind: "prospect", id: prospectId, name: "" });
    if (task) return task;
  }

  if (/\b(latest|newest|top|first|this activity|this task)\b/.test(q)) {
    return api.tasks
      .listOpen(ctx.tenantId)
      .filter((task) => canSeeTask(task, ctx))[0] ?? null;
  }
  return null;
}

function latestOpenTaskForContact(ctx: AssistantContext, contact: MatchedContact): Task | null {
  return (
    api.tasks
      .listOpen(ctx.tenantId)
      .filter((task) =>
        contact.kind === "customer"
          ? task.customerId === contact.id
          : task.prospectId === contact.id
      )
      .filter(isContactProfileActivity)
      .filter((task) => canSeeTask(task, ctx))[0] ?? null
  );
}

function canSeeTask(task: Task, ctx: AssistantContext): boolean {
  if (ctx.viewer.role === "manager" || ctx.viewer.role === "master_admin") return true;
  const owners = [task.assignedToId, ...(task.additionalAssignedToIds ?? [])].filter(Boolean);
  if (owners.includes(ctx.viewer.id)) return true;
  if (task.customerId) {
    const customer = api.customers.get(task.customerId);
    return api.customers.canSee(customer, ctx.viewer);
  }
  if (task.prospectId) {
    const prospect = api.prospects.get(task.prospectId);
    return !!(
      prospect &&
      (prospect.assignedAgentId === ctx.viewer.id ||
        (prospect.additionalAgentIds ?? []).includes(ctx.viewer.id))
    );
  }
  return false;
}

function buildReminderActionAnswer(
  raw: string,
  q: string,
  ctx: AssistantContext,
  contact: MatchedContact | null
): AssistantAnswer | null {
  if (!/\b(remind|reminder)\b/.test(q)) return null;

  const task = resolveTaskForAssistantAction(q, ctx);
  const dateResult = parseAssistantDateDetails(q);
  if (!dateResult.iso || !dateResult.hasDate) {
    return {
      text:
        "I can set that reminder, but I need the date and time first. Try: \"Remind me to call Chubb tomorrow at 3 PM.\"",
      topicId: "action-needs-details",
      action: categoryAction("/employee/calendar", "Open calendar"),
    };
  }
  if (!dateResult.hasExplicitTime) {
    return {
      text:
        "I found the reminder date, but I need the exact time before I create it. Try: \"Remind me to call Chubb tomorrow at 3 PM.\"",
      topicId: "action-needs-details",
      action: categoryAction("/employee/calendar", "Open calendar"),
    };
  }

  const remindAt = dateResult.iso;
  const subject =
    normalizeReminderTitleForContext(
      extractReminderTitle(raw, dateResult.matchedPhrases),
      contact
    ) ?? (task ? `Follow up on ${task.title}` : null);
  if (!subject) {
    return {
      text:
        "I have the reminder time, but I need what you want to be reminded to do. Try: \"Remind me to call Chubb tomorrow at 3 PM.\"",
      topicId: "action-needs-details",
      action: categoryAction("/employee/calendar", "Open calendar"),
    };
  }
  const title = buildReminderListTitle(subject, remindAt);
  const isCompanyReminder = isCompanyReminderRequest(q);
  if (isCompanyReminder) {
    const recipients = resolveCompanyReminderRecipients(q, ctx);
    if (recipients.ids.length === 0) {
      return {
        text:
          "I can create the company reminder, but I could not find any active staff recipients. Open the dashboard reminder popup to choose recipients manually.",
        topicId: "action-needs-target",
        action: categoryAction("/employee", "Open dashboard"),
      };
    }
    return executableAnswer({
      text: `I can create a company reminder for ${recipients.label} at ${fmt.dateTime(remindAt)}.`,
      pendingAction: {
        kind: "reminder.createCompany",
        label: "Create company reminder",
        confirmation: `Create company reminder for ${recipients.label} at ${fmt.dateTime(remindAt)}: "${title}"?`,
        remindAt,
        title,
        note: contact
          ? `Created from portal assistant while viewing ${describeContact(contact)}.`
          : "Created from portal assistant as a company reminder.",
        recipientIds: recipients.ids,
        recipientLabel: recipients.label,
        importance: detectSeverity(q) ?? "info",
      },
      actions: [
        categoryAction("/employee", "Open dashboard"),
        categoryAction("/employee/calendar", "Open calendar"),
      ],
    });
  }

  return executableAnswer({
    text: `I can create a personal reminder for ${fmt.dateTime(remindAt)}.`,
    pendingAction: {
      kind: "reminder.create",
      label: "Create reminder",
      confirmation: `Create a personal reminder for ${fmt.dateTime(remindAt)}: "${title}"?`,
      remindAt,
      title,
      note: task
        ? `Created from portal assistant for activity: ${task.title}`
        : contact
          ? `Created from portal assistant while viewing ${describeContact(contact)}.`
          : undefined,
      taskId: task?.id,
      importance: detectSeverity(q) ?? "info",
    },
    actions: [categoryAction("/employee/calendar", "Open calendar")],
  });
}

function isCompanyReminderRequest(q: string): boolean {
  return (
    /\b(?:company|team|staff|agency-wide|agency wide)\s+reminder\b/.test(q) ||
    /\bremind\s+(?:everyone|everybody|all agents|all staff|all teammates|the team|team|staff|managers|csrs?)\b/.test(q) ||
    /\b(?:everyone|everybody|all agents|all staff|all teammates|teammates|managers|csrs?|commercial line|commercial lines|personal line|personal lines)\b/.test(q)
  );
}

function resolveCompanyReminderRecipients(
  q: string,
  ctx: AssistantContext
): { ids: string[]; label: string } {
  const staff = api.users
    .list(ctx.tenantId)
    .filter((user) => user.tenantId === ctx.tenantId && user.active !== false && isStaffRole(user.role))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ids = new Set<string>();
  const add = (users: User[]) => users.forEach((user) => ids.add(user.id));
  const mentioned = staff.filter((user) => staffMemberMentioned(q, user));
  add(mentioned);

  if (/\b(everyone|everybody|all staff|all teammates|agency-wide|agency wide|whole agency|entire agency|company\s+reminder|team\s+reminder|staff\s+reminder)\b/.test(q)) {
    add(staff);
  }
  if (/\bmanagers?\b/.test(q)) {
    add(staff.filter((user) => user.role === "manager"));
  }
  if (/\bcsrs?\b/.test(q)) {
    add(staff.filter((user) => user.role === "csr"));
  }
  if (/\ball agents?\b/.test(q)) {
    add(staff.filter((user) => user.role === "agent" || user.role === "csr"));
  }
  if (/\b(?:personal line|personal lines)\b/.test(q)) {
    add(staff.filter((user) => isPersonalLineStaff(user)));
  }
  if (/\b(?:commercial line|commercial lines|company line|company lines|business line|business lines)\b/.test(q)) {
    add(staff.filter((user) => isCommercialLineStaff(user)));
  }
  if (ids.size === 0 && isCompanyReminderRequest(q)) {
    add(staff);
  }

  const selected = staff.filter((user) => ids.has(user.id));
  return {
    ids: selected.map((user) => user.id),
    label: companyReminderRecipientLabel(selected, staff),
  };
}

function staffMemberMentioned(q: string, user: User): boolean {
  const parts = [user.name, user.firstName, user.lastName, user.email, user.businessEmail]
    .filter((part): part is string => !!part)
    .map((part) => part.toLowerCase());
  return parts.some((part) => part.length >= 3 && q.includes(part));
}

function isPersonalLineStaff(user: User): boolean {
  if (user.role === "manager") return false;
  if (user.lineOfBusiness) return user.lineOfBusiness === "personal";
  return !isCommercialLineStaff(user);
}

function isCommercialLineStaff(user: User): boolean {
  if (user.role === "manager") return false;
  if (user.lineOfBusiness) return user.lineOfBusiness === "commercial";
  const profileText = `${user.title ?? ""} ${user.bio ?? ""} ${user.email} ${user.name}`.toLowerCase();
  return /\b(company|commercial|business|bop|workers'? comp|general liability|professional liability)\b/.test(profileText);
}

function companyReminderRecipientLabel(selected: User[], allStaff: User[]): string {
  if (selected.length === allStaff.length && selected.length > 0) {
    return `all ${selected.length} staff members`;
  }
  const roleSet = new Set(selected.map((user) => user.role));
  if (roleSet.size === 1 && selected.length > 1) {
    return `${selected.length} ${staffRoleLabel(selected[0].role).toLowerCase()}s`;
  }
  if (selected.length <= 3) {
    return selected.map((user) => `${user.name} (${staffRoleLabel(user.role)})`).join(", ");
  }
  return `${selected.length} selected staff members`;
}

function detectSeverity(q: string): TaskSeverity | null {
  if (/\b(urgent|high|critical|asap|emergency)\b/.test(q)) return "urgent";
  if (/\b(medium|warning|normal)\b/.test(q)) return "warning";
  if (/\b(low|info|minor)\b/.test(q)) return "info";
  return null;
}

function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function parseAssistantDate(q: string): string | null {
  return parseAssistantDateDetails(q).iso;
}

type AssistantDateParseResult = {
  iso: string | null;
  hasDate: boolean;
  hasExplicitTime: boolean;
  matchedPhrases: string[];
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseAssistantDateDetails(raw: string): AssistantDateParseResult {
  const q = raw.trim().toLowerCase();
  const now = new Date();
  const matchedPhrases: string[] = [];
  const time = parseAssistantTime(q);
  if (time?.matched) matchedPhrases.push(time.matched);

  const inMinutes = /\bin\s+(\d+)\s+(?:minutes?|mins?)\b/.exec(q);
  if (inMinutes) {
    matchedPhrases.push(inMinutes[0]);
    const d = new Date(now.getTime() + Number(inMinutes[1]) * 60 * 1000);
    d.setSeconds(0, 0);
    return {
      iso: d.toISOString(),
      hasDate: true,
      hasExplicitTime: true,
      matchedPhrases,
    };
  }

  const inHours = /\bin\s+(\d+)\s+(?:hours?|hrs?)\b/.exec(q);
  if (inHours) {
    matchedPhrases.push(inHours[0]);
    const d = new Date(now.getTime() + Number(inHours[1]) * 60 * 60 * 1000);
    d.setSeconds(0, 0);
    return {
      iso: d.toISOString(),
      hasDate: true,
      hasExplicitTime: true,
      matchedPhrases,
    };
  }

  let target: Date | null = null;
  let hasDate = false;
  const inDays = /\bin\s+(\d+)\s+days?\b/.exec(q);
  if (inDays) {
    matchedPhrases.push(inDays[0]);
    target = new Date(now);
    target.setDate(target.getDate() + Number(inDays[1]));
    hasDate = true;
  }

  if (!target && /\btoday\b/.test(q)) {
    matchedPhrases.push("today");
    target = new Date(now);
    hasDate = true;
  }

  if (!target && /\btomorrow\b/.test(q)) {
    matchedPhrases.push("tomorrow");
    target = new Date(now);
    target.setDate(target.getDate() + 1);
    hasDate = true;
  }

  if (!target && /\bnext week\b/.test(q)) {
    matchedPhrases.push("next week");
    target = new Date(now);
    target.setDate(target.getDate() + 7);
    hasDate = true;
  }

  if (!target) {
    const weekday = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(q);
    if (weekday) {
      matchedPhrases.push(weekday[0]);
      target = nextWeekday(now, WEEKDAY_INDEX[weekday[2]], !!weekday[1]);
      hasDate = true;
    }
  }

  if (!target) {
    const monthDay = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(q);
    if (monthDay) {
      matchedPhrases.push(monthDay[0]);
      const month = MONTH_INDEX[monthDay[1].replace(/\.$/, "")];
      const day = Number(monthDay[2]);
      const year = monthDay[3] ? Number(monthDay[3]) : now.getFullYear();
      target = new Date(year, month, day);
      if (!monthDay[3] && target.getTime() < startOfToday(now).getTime()) {
        target.setFullYear(target.getFullYear() + 1);
      }
      hasDate = true;
    }
  }

  if (!target) {
    const numericDate = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(q);
    if (numericDate) {
      matchedPhrases.push(numericDate[0]);
      const month = Number(numericDate[1]) - 1;
      const day = Number(numericDate[2]);
      const rawYear = numericDate[3];
      const year = rawYear
        ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear)
        : now.getFullYear();
      target = new Date(year, month, day);
      if (!rawYear && target.getTime() < startOfToday(now).getTime()) {
        target.setFullYear(target.getFullYear() + 1);
      }
      hasDate = true;
    }
  }

  if (!target) {
    return {
      iso: null,
      hasDate: false,
      hasExplicitTime: !!time?.explicit,
      matchedPhrases,
    };
  }

  const fallbackHour = /\bmorning\b/.test(q)
    ? 9
    : /\bafternoon\b/.test(q)
      ? 14
      : /\bevening\b/.test(q)
        ? 17
        : /\bnight\b/.test(q)
          ? 18
          : /\btomorrow\b/.test(q)
            ? 17
            : 9;
  if (!time && /\btoday\b/.test(q)) {
    target.setHours(now.getHours() + 2, 0, 0, 0);
  } else {
    target.setHours(time?.hour ?? fallbackHour, time?.minute ?? 0, 0, 0);
  }
  return {
    iso: target.toISOString(),
    hasDate,
    hasExplicitTime: !!time?.explicit,
    matchedPhrases,
  };
}

function parseAssistantTime(q: string): { hour: number; minute: number; matched: string; explicit: boolean } | null {
  const noon = /\bnoon\b/.exec(q);
  if (noon) return { hour: 12, minute: 0, matched: noon[0], explicit: true };
  const midnight = /\bmidnight\b/.exec(q);
  if (midnight) return { hour: 0, minute: 0, matched: midnight[0], explicit: true };

  const amPm = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/.exec(q);
  if (amPm) {
    let hour = Number(amPm[1]);
    const minute = Number(amPm[2] ?? 0);
    const meridiem = amPm[3].replace(/\./g, "");
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute, matched: amPm[0], explicit: true };
  }

  const atTime = /\bat\s+(\d{1,2})(?::(\d{2}))?\b/.exec(q);
  if (atTime) {
    let hour = Number(atTime[1]);
    const minute = Number(atTime[2] ?? 0);
    if (hour >= 1 && hour <= 7) hour += 12;
    return { hour, minute, matched: atTime[0], explicit: true };
  }

  const daypart = /\b(morning|afternoon|evening|night)\b/.exec(q);
  if (daypart) {
    const hour =
      daypart[1] === "morning"
        ? 9
        : daypart[1] === "afternoon"
          ? 14
          : daypart[1] === "evening"
            ? 17
            : 18;
    return { hour, minute: 0, matched: daypart[0], explicit: false };
  }

  return null;
}

function nextWeekday(from: Date, weekday: number, forceNextWeek: boolean): Date {
  const d = new Date(from);
  const delta = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (delta === 0 || forceNextWeek ? delta + 7 : delta));
  return d;
}

function startOfToday(from: Date): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  return d;
}

function extractReminderTitle(raw: string, matchedPhrases: string[] = []): string | null {
  let text = raw.trim();
  const toMatch = /\b(?:remind me|set(?:\s+me)?(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder|create(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder|add(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder)\b.*?\bto\s+(.+)$/i.exec(text);
  if (toMatch) {
    text = toMatch[1];
  } else {
    text = text
      .replace(/^(?:please\s+)?(?:can you|could you)\s+/i, "")
      .replace(/\b(?:remind me|set(?:\s+me)?(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder|create(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder|add(?:\s+(?:a|the))?(?:\s+\w+){0,3}\s+reminder)\b/i, "");
  }
  text = stripReminderAudiencePhrases(text);

  const phrases = [
    ...matchedPhrases,
    "today",
    "tomorrow",
    "next week",
  ].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (!phrase) continue;
    text = text.replace(new RegExp(escapeRegExp(phrase), "ig"), " ");
  }
  text = text
    .replace(/\bin\s+\d+\s+(?:minutes?|mins?|hours?|hrs?|days?)\b/gi, " ")
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, " ")
    .replace(/\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, " ")
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\bremind\s+(?:everyone|everybody|all agents|all staff|all teammates|the team|team|staff|managers?|csrs?|personal lines?|commercial lines?|company lines?)\s*(?:only)?\b/gi, " ")
    .replace(/\b(?:for|to)\s+(?:the\s+)?(?:personal lines?|personal line agents?|commercial lines?|commercial line agents?|company lines?|company line agents?|managers?|csrs?|all agents?|all staff|everyone|everybody|team|staff|teammates)\s*(?:only)?\b/gi, " ")
    .replace(/\b(?:personal lines?|commercial lines?|company lines?|managers?|csrs?|all agents?|all staff|everyone|everybody|team|staff|teammates)\s+only\b/gi, " ")
    .replace(/^(?:a\s+|the\s+)?(?:company|team|staff|personal|general)?\s*reminder\s*(?:to\s+)?/i, "")
    .replace(/^(?:me\s+)?(?:to\s+)?/i, "")
    .replace(/^(?:regarding|about|re:)\s+/i, "")
    .replace(/\s+(?:regarding|about|re:)\s+/i, " ")
    .replace(/\s+(?:on|to)\s+the\s+(?:calendar|dashboard)$/i, "")
    .replace(/\s+(?:on|at|by|for)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length < 3) return null;
  if (/^(?:a\s+)?reminder$/i.test(text)) return null;
  if (/^(?:set|create|add|remind)$/i.test(text)) return null;
  return sentenceCase(text);
}

function stripReminderAudiencePhrases(value: string): string {
  return value
    .replace(/\bremind\s+(?:everyone|everybody|all agents|all staff|all teammates|the team|team|staff|managers?|csrs?|personal lines?|commercial lines?|company lines?)\s*(?:only)?\b/gi, " ")
    .replace(/\b(?:for|to)\s+(?:the\s+)?(?:personal lines?|personal line agents?|commercial lines?|commercial line agents?|company lines?|company line agents?|managers?|csrs?|all agents?|all staff|everyone|everybody|team|staff|teammates)\s*(?:only)?\b/gi, " ")
    .replace(/\b(?:personal lines?|commercial lines?|company lines?|managers?|csrs?|all agents?|all staff|everyone|everybody|team|staff|teammates)\s+only\b/gi, " ");
}

function buildReminderListTitle(subject: string, remindAt: string): string {
  const d = new Date(remindAt);
  const time = d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
  const date = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const relative = isTomorrow(d) ? "tomorrow " : "";
  return `${time} ${lowerFirst(subject)} - ${relative}${date}`;
}

function lowerFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^[A-Z]{2,}\b/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.toDateString() === tomorrow.toDateString();
}

function normalizeReminderTitleForContext(
  title: string | null,
  contact: MatchedContact | null
): string | null {
  if (!title || !contact) return title;
  if (!/\b(client|customer|prospect|her|him|them)\b/i.test(title)) return title;
  return sentenceCase(
    title.replace(/\b(?:this\s+)?(?:client|customer|prospect|her|him|them)\b/gi, contact.name)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function executePortalAssistantAction(
  action: AssistantExecutableAction,
  ctx: AssistantContext
): AssistantActionResult {
  if (action.kind === "navigate") {
    return {
      success: true,
      text: `Opening ${action.label.replace(/^Open /, "")}.`,
      action: { label: action.label, to: action.to },
    };
  }

  if (action.kind === "reminder.create") {
    api.reminders.create({
      tenantId: ctx.tenantId,
      userId: ctx.viewer.id,
      remindAt: action.remindAt,
      taskId: action.taskId,
      title: action.title,
      note: action.note,
      importance: action.importance ?? "info",
    });
    return {
      success: true,
      text: `Reminder "${action.title}" created for ${fmt.dateTime(action.remindAt)}.`,
      action: categoryAction("/employee/calendar", "Open calendar"),
    };
  }

  if (action.kind === "reminder.createCompany") {
    const staffIds = new Set(
      api.users
        .list(ctx.tenantId)
        .filter((user) => user.tenantId === ctx.tenantId && user.active !== false && isStaffRole(user.role))
        .map((user) => user.id)
    );
    const recipientIds = Array.from(new Set(action.recipientIds)).filter((id) =>
      staffIds.has(id)
    );
    if (recipientIds.length === 0) {
      return {
        success: false,
        text: "I could not find active staff recipients anymore, so I did not create the company reminder.",
      };
    }
    const created = api.reminders.createBatch({
      tenantId: ctx.tenantId,
      userIds: recipientIds,
      remindAt: action.remindAt,
      title: action.title,
      note: action.note,
      importance: action.importance ?? "info",
    });
    return {
      success: true,
      text: `Company reminder "${action.title}" created for ${created.length} recipient${created.length === 1 ? "" : "s"} at ${fmt.dateTime(action.remindAt)}. It will show on each recipient's dashboard reminders and calendar.`,
      action: categoryAction("/employee", "Open dashboard"),
    };
  }

  if (action.kind === "note.create") {
    const target =
      action.customerId
        ? api.customers.get(action.customerId)
        : action.prospectId
          ? api.prospects.get(action.prospectId)
          : undefined;
    const allowed =
      action.customerId
        ? api.customers.canSee(api.customers.get(action.customerId), ctx.viewer)
        : action.prospectId
          ? !!api.prospects.get(action.prospectId) &&
            (ctx.viewer.role === "manager" ||
              ctx.viewer.role === "master_admin" ||
              api.prospects.get(action.prospectId)?.assignedAgentId === ctx.viewer.id ||
              (api.prospects.get(action.prospectId)?.additionalAgentIds ?? []).includes(ctx.viewer.id))
          : false;
    if (!target || !allowed) {
      return {
        success: false,
        text: "I could not safely find that client or prospect anymore, so I did not add the remark.",
      };
    }
    api.notes.create({
      tenantId: ctx.tenantId,
      authorId: ctx.viewer.id,
      customerId: action.customerId,
      prospectId: action.prospectId,
      body: action.body,
      visibility: action.visibility,
    });
    const link =
      action.customerId
        ? clientAction(action.customerId, "View client")
        : prospectAction(action.prospectId!, "View prospect");
    return {
      success: true,
      text: `Remark added to ${target.name}.`,
      action: link,
    };
  }

  if (action.kind === "calendar.create") {
    const event = api.calendarEvents.create({
      tenantId: ctx.tenantId,
      userId: ctx.viewer.id,
      kind: "event",
      title: action.title,
      description: action.description,
      startsAt: action.startsAt,
      endsAt: action.endsAt,
      importance: action.importance ?? "info",
    });
    return {
      success: true,
      text: `"${event.title}" was added to your calendar for ${fmt.dateTime(event.startsAt)}.`,
      action: categoryAction("/employee/calendar", "Open calendar"),
    };
  }

  if (action.kind === "task.create") {
    try {
      const task = api.tasks.create({
        tenantId: ctx.tenantId,
        title: action.title,
        description: action.description,
        customerId: action.customerId,
        prospectId: action.prospectId,
        assignedToId: action.assignedToId ?? ctx.viewer.id,
        severity: action.severity ?? "info",
        createdById: ctx.viewer.id,
      });
      if (action.dueAt) api.tasks.setDueAt(task.id, action.dueAt, ctx.viewer.id);
      return {
        success: true,
        text: `"${task.title}" was created${action.dueAt ? ` and set due ${fmt.dateTime(action.dueAt)}` : ""}.`,
        action: taskAction(task.id),
      };
    } catch (err) {
      return {
        success: false,
        text: err instanceof Error ? err.message : "That activity could not be created.",
      };
    }
  }

  const task = api.tasks.get(action.taskId);
  if (!task || task.tenantId !== ctx.tenantId || !canSeeTask(task, ctx)) {
    return {
      success: false,
      text: "I could not safely find that activity anymore, so I did not make a change.",
    };
  }

  switch (action.kind) {
    case "task.markInProgress": {
      const updated = api.tasks.markInProgress(task.id, ctx.viewer.id);
      return updated
        ? { success: true, text: `"${task.title}" is now in progress.`, action: taskAction(task.id) }
        : { success: false, text: "That activity could not be started." };
    }
    case "task.markResolved": {
      const updated = api.tasks.markComplete(task.id, ctx.viewer.id);
      return updated
        ? { success: true, text: `"${task.title}" was marked resolved.`, action: taskAction(task.id) }
        : { success: false, text: "That activity could not be resolved." };
    }
    case "task.reopen": {
      const updated = api.tasks.reopen(task.id, ctx.viewer.id);
      return updated
        ? { success: true, text: `"${task.title}" was reopened.`, action: taskAction(task.id) }
        : { success: false, text: "That activity could not be reopened." };
    }
    case "task.snooze": {
      const updated = api.tasks.snooze(task.id, action.days, ctx.viewer.id);
      return updated
        ? { success: true, text: `"${task.title}" was snoozed for ${action.days} day${action.days === 1 ? "" : "s"}.` }
        : { success: false, text: "That activity could not be snoozed." };
    }
    case "task.setSeverity": {
      const updated = api.tasks.setSeverity(task.id, action.severity, ctx.viewer.id);
      const label = action.severity === "urgent" ? "High" : action.severity === "warning" ? "Medium" : "Low";
      return updated
        ? { success: true, text: `"${task.title}" is now ${label} importance.` }
        : { success: false, text: "That activity importance could not be changed." };
    }
    case "task.setDueAt": {
      const updated = api.tasks.setDueAt(task.id, action.dueAt, ctx.viewer.id);
      return updated
        ? {
            success: true,
            text: action.dueAt
              ? `"${task.title}" is due ${fmt.dateTime(action.dueAt)}.`
              : `"${task.title}" no longer has a due date.`,
          }
        : { success: false, text: "That due date could not be changed." };
    }
  }
}

export function askPortalAssistant(
  question: string,
  role?: "agent" | "manager",
  ctx?: AssistantContext,
  history?: AssistantHistoryItem[]
): AssistantAnswer {
  const q = question.trim().toLowerCase();
  if (!q) {
    return {
      text: "Ask me anything about using the portal - the Activity Center, reminders, prospects, policies, carriers, documents, or analytics.",
      related: assistantStarters(),
    };
  }

  // Pure greeting / "help" with no topic words -> menu.
  const isGreeting =
    GREETING_KEYWORDS.some((g) => q === g || q.startsWith(g + " ")) && q.length < 25;
  if (isGreeting) {
    return {
      text: "Hi! I'm the portal assistant. I can explain how the Activity Center, reminders, prospects, policies, carriers, documents, and analytics work - and I can look up live numbers like \"how many assets does <client> have?\". Try one of these:",
      related: assistantStarters(),
    };
  }

  const lastTopic = lastAssistantTopic(history);

  // "Tell me more" / "continue" / "step by step" - keep walking the
  // current topic by either deepening with a not-yet-seen related
  // entry or repeating the full answer.
  if (lastTopic && MORE_DETAIL_RE.test(q) && q.split(/\s+/).length <= 6) {
    const seen = seenAssistantTopicIds(history);
    const nextRelated = (lastTopic.related ?? [])
      .map((rq) => KB.find((e) => e.question === rq))
      .filter((e): e is KbEntry => !!e && !seen.has(e.id))[0];
    if (nextRelated) {
      return {
        text: `Going deeper on "${lastTopic.question}". Next:\n\n${nextRelated.answer}`,
        related: nextRelated.related,
        topicId: nextRelated.id,
      };
    }
    return {
      text: `${lastTopic.answer}\n\n(That's the full how-to I have on "${lastTopic.question}". Ask about anything else and I'll switch topics.)`,
      related: lastTopic.related,
      topicId: lastTopic.id,
    };
  }

  // Pronoun / continuation follow-up: fold the previous topic's
  // keywords + question into the query so the scorer stays anchored
  // on the same topic when the new question reads like a follow-up
  // (e.g. "where do I get there?" after asking about Documents).
  const tokenCount = q.split(/\s+/).filter(Boolean).length;
  const looksLikeFollowUp =
    !!lastTopic &&
    (FOLLOWUP_PRONOUNS_RE.test(q) ||
      (tokenCount <= 6 && FOLLOWUP_CONTINUERS_RE.test(q)));
  const effectiveQ = looksLikeFollowUp && lastTopic
    ? `${lastTopic.question.toLowerCase()} ${lastTopic.keywords.join(" ")} ${q}`
    : q;

  if (ctx) {
    const proposedAction = tryAssistantAction(question, ctx);
    if (proposedAction) return proposedAction;
    if (isDirectActionCommand(question)) {
      return actionNeedsSpecificsAnswer(question, ctx);
    }
    const currentPage = tryCurrentPageAnswer(q, ctx);
    if (currentPage) return currentPage;
  }

  // Live-data lookups (need the records the viewer can see). Use the
  // raw `q` here - never the augmented one - so a topic's keywords
  // can't accidentally summon a contact lookup.
  if (ctx) {
    const agentStats = tryAgentAnswer(q, ctx);
    if (agentStats) return agentStats;

    const found = findContact(q, ctx);
    const metric = detectMetric(q);
    const dataIntent =
      /\b(how many|how much|tell me about|who is|who's|profile|summary|recap|premium|renew|claim|asset|polic|document|status|email|phone|number|agent|assigned|have|has|does|count|total)\b/.test(
        q
      );
    const contactOk = found && (found.score >= 10 || dataIntent);

    if (contactOk && found) {
      return answerForContactMetric(found.contact, metric ?? "profile", ctx, q);
    }

    const portalData = tryPortalDataAnswer(q, ctx);
    if (portalData) return portalData;

    const aggregate = tryAgencyAggregate(q, ctx);
    if (aggregate) return aggregate;
    const carrier = tryCarrierAnswer(q, ctx);
    if (carrier) return carrier;
  }

  const ranked = rankedKbEntries(effectiveQ);
  const best = ranked[0]?.entry ?? null;
  const bestScore = ranked[0]?.score ?? 0;

  // Follow-up question that didn't strongly match anything new but we
  // know the prior topic -> keep talking about it rather than dumping
  // the topic menu.
  if (looksLikeFollowUp && lastTopic && (!best || bestScore < 3)) {
    return {
      text: `Continuing on "${lastTopic.question}":\n\n${lastTopic.answer}`,
      related: lastTopic.related,
      topicId: lastTopic.id,
    };
  }

  if (!best || bestScore === 0) {
    const videoAnswer = answerFromTrainingVideo(q, role);
    if (videoAnswer) return videoAnswer;
    return {
      text: "I'm not sure about that one yet - I cover portal how-tos. Here are some topics I can help with:",
      related: KB.slice(0, 6).map((e) => e.question),
    };
  }

  if (shouldCombineTopics(q, ranked)) {
    return combineTopicAnswers(ranked, role, q);
  }

  return attachTrainingVideo(
    { text: topicAnswer(best, role), related: best.related, topicId: best.id },
    q,
    role
  );
}

interface AssistantLLMResponse {
  text?: string;
  related?: unknown[];
}

export async function askPortalAssistantSmart(
  question: string,
  role?: "agent" | "manager",
  ctx?: AssistantContext,
  history?: AssistantHistoryItem[]
): Promise<AssistantAnswer> {
  const local = askPortalAssistant(question, role, ctx, history);
  if (!shouldUseAssistantLLM(question, local)) return local;
  try {
    const llm = await fetchAssistantSynthesis(question, role, history, local);
    const text = cleanAssistantText(llm.text) ?? local.text;
    const related = sanitizeRelated(llm.related, local.related);
    return { ...local, text, related };
  } catch {
    return local;
  }
}

function shouldUseAssistantLLM(question: string, local: AssistantAnswer): boolean {
  if (typeof fetch !== "function") return false;
  if (local.pendingAction) return false;
  if (local.topicId && /^(action-)/.test(local.topicId)) return false;
  if (question.trim().length < 4) return false;
  return true;
}

async function fetchAssistantSynthesis(
  question: string,
  role: "agent" | "manager" | undefined,
  history: AssistantHistoryItem[] | undefined,
  local: AssistantAnswer
): Promise<AssistantLLMResponse> {
  const q = question.trim();
  const ranked = rankedKbEntries(q.toLowerCase(), 5);
  const localEntry = local.topicId ? KB.find((entry) => entry.id === local.topicId) : undefined;
  const entries = dedupeEntries([
    ...(localEntry ? [localEntry] : []),
    ...ranked.map((r) => r.entry),
  ]).slice(0, 10);

  const knowledge = entries
    .map((entry) => {
      return [
        `Topic: ${entry.question}`,
        entry.managerOnly ? `Role: manager-only` : `Role: staff`,
        `Answer: ${entry.answer}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");
  const out = await postServerAi<AssistantLLMResponse>(
    "/ai/portal-assistant",
    {
      question: q,
      role,
      history: (history ?? []).slice(-10),
      localAnswer: local.text,
      knowledge,
    },
    { timeoutMs: 60_000 }
  );
  if (!out) throw new Error("Assistant AI provider unavailable");
  return out;
}

export function parseAssistantLLMResponse(raw: string): AssistantLLMResponse {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const first = unfenced.indexOf("{");
    const last = unfenced.lastIndexOf("}");
    if (first !== -1 && last > first) {
      return JSON.parse(unfenced.slice(first, last + 1));
    }
    throw new Error("Assistant LLM response was not valid JSON");
  }
}

function cleanAssistantText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (cleaned.length < 12) return undefined;
  return cleaned.slice(0, 2400).trim();
}

function sanitizeRelated(
  value: unknown[] | undefined,
  fallback: string[] | undefined
): string[] | undefined {
  const related = Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 3)
        .slice(0, 4)
    : [];
  return related.length ? dedupeStrings(related) : fallback;
}

function dedupeEntries(entries: KbEntry[]): KbEntry[] {
  const seen = new Set<string>();
  const out: KbEntry[] = [];
  entries.forEach((entry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    out.push(entry);
  });
  return out;
}
