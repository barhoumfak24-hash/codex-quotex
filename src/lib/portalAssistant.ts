// =====================================================================
// Portal assistant (frontend-side stub).
//
// PRODUCTION INTENT: same contract as src/lib/ai.ts — in production
// this becomes a `fetch('/api/ai/portal-assistant', ...)` call to a
// backend RAG endpoint grounded on the agency's help docs. The demo
// answers from a local keyword-scored knowledge base so agents and
// managers get useful "how do I…?" answers without a model key.
//
// The matcher is intentionally simple: score every KB entry by how
// many of its keywords appear in the question, return the best hit,
// and fall back to a topic menu when nothing scores. Deterministic,
// fast, and good enough for portal FAQ.
// =====================================================================

import { api } from "@/lib/api";
import type { Role } from "@/types";

export interface AssistantAnswer {
  // Markdown-ish plain text (rendered as paragraphs + bullet lines).
  text: string;
  // Optional follow-up prompts surfaced as tappable chips.
  related?: string[];
  // Which KB entry produced this (for analytics / debugging).
  topicId?: string;
}

// Context lets the assistant answer data questions ("how many assets
// does Alexandra Whitford have?") by looking up the actual records
// the viewer is allowed to see.
export interface AssistantContext {
  tenantId: string;
  viewer: { id: string; role: Role };
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
      "The Activity Center is your single source of truth for work that needs attention. Each card is an activity — an inbound customer request, a renewal nudge, an AI follow-up, or a manager assignment. Cards start in the To-do column; mark one In progress to move it across, then Mark resolved when it's handled.\n\nClicking View activity from a client profile jumps you straight to the matching card, auto-expanded.",
    related: [
      "Why can't I mark an activity resolved?",
      "How do I set a reminder on an activity?",
    ],
  },
  {
    id: "resolve-gate",
    question: "Why can't I mark an activity resolved?",
    keywords: [
      "resolve",
      "resolved",
      "mark resolved",
      "gate",
      "locked",
      "can't close",
      "checklist",
      "blocked",
    ],
    answer:
      "For a customer activity, resolving is gated by a checklist: mark it in progress, use Send questionnaire to email the intake questions, and use Send missing documents to request anything outstanding (auto-satisfied when nothing's missing). Both Send actions live on the in-progress card. Only then does Mark resolved unlock.\n\nAn AI auto-message does NOT count — a person has to send the questionnaire/docs. If you're genuinely blocked, a manager can grant an override.",
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
      "There are three kinds of reminders, all on your dashboard's My reminders card:\n• Personal — click New reminder for a freeform follow-up.\n• Activity-anchored — Set reminder on any Activity Center card.\n• Company — click Company reminder to push one reminder to a chosen set of teammates.\n\nEvery reminder supports recurrence (daily / weekly / biweekly / monthly / custom interval) with an optional stop date. When you dismiss a recurring reminder the next occurrence is scheduled automatically.",
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
      "Company reminders let anyone on staff push a single reminder to a chosen group of teammates. Open it from the Company reminder button on your dashboard's My reminders card, tick the recipients (everyone is pre-selected — untick who shouldn't get it), set the time, importance, and optional recurrence.\n\nEach recipient gets their own independent copy — they dismiss or snooze theirs without touching anyone else's.",
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
      "Open the prospect and use Convert to client. A manager must assign the prospect to an agent first — every new client lands owned by someone. On conversion the prospect's whole activity timeline transfers onto the new client record, the event is timestamped, and the prospect drops out of the Prospects category (it now lives under Clients). You can still see converted prospects via the Converted filter chip.",
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
      "edit on carrier",
    ],
    answer:
      "Click View on any policy (Policies card, Assets, or the Policies page) to open the full policy detail page — coverage, dates, premium, timeline, and documents. From there Download summary exports a text recap and Edit on carrier opens the carrier's agent portal (configured under Master → Carriers).",
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
      "On a client profile, click View on any row in the Assets card to open that asset's detail page — structured details, the policies attached to it (each with its own View), documents, and the asset's activity timeline. Customers see the same per-asset view under My assets in their portal.",
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
    ],
    answer:
      "Go to Carrier recommendations → Carrier-specific documents. Pick a carrier, choose Personal or Commercial lines, and upload the underwriting manual, appetite guide, application, or supplemental. Documents are split into Personal and Commercial sections, and everything you upload also shows up on the Document review queue for the standard approval flow.",
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
      "Managers can use Add / remove carriers on the Carrier recommendations page to toggle which carriers from the master library this agency works with. Tap a carrier card to manage its reps (underwriters, adjusters, claims reps) — those contacts surface on the Messages page so you can email them in one click.",
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
      "On the Analytics page (manager-only), the Performance goals card lets you set agency-wide targets per metric — premium written, new clients, activities resolved, policies bound — for a monthly / quarterly / annual period. The card plots actual vs. target and shows a progress meter for each goal.",
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
      "The Performance leaderboard on the Analytics page (manager-only) ranks the team on any metric — premium under management, bound policies, activities resolved, response rate, avg handle time, and more. Top three get a trophy / medals; click any row to open that agent's full drill-down.",
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
      "The Messages page holds internal staff threads and carrier-rep threads. Customer-facing messages go through the marketing composer (Reply to customer pre-selects the client). Every message — including ones the AI sent on your behalf — is visible in the client's activity timeline; click View on a logged message to read it inline.",
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
      "Document review lists customer-uploaded files for approve/reject, your agency's shared templates, and the carrier-specific document library (split personal/commercial). Managers can flip e-signature requirements per document — the AI auto-sends customer packets and stamps an Activity Center task for any signature an agent owes.",
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
      "When a customer taps Get a private quote they pick personal vs. commercial, choose what to insure, and fill in five fields (name, phone, email, asset identifier, driver's license). The AI pulls public records, matches carriers, and gives a ballpark. An Activity Center task lands in the assigned agent's queue with a pre-drafted questionnaire reply — sending it auto-resolves the task.",
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
      "The agency portal's left rail: Dashboard (your reminders + AI sweeps), Activity Center (your work queue), Messages (internal + carrier threads), Prospects, Clients, Policies, Renewals, Document review, AI marketing, Carrier recommendations, Analytics (manager-only), Archive, and Agency settings. Each client/prospect has its own profile; assets and policies each have their own detail page.",
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
      "Click Create new activity in the Activity Center header (it opens a client/prospect search so you pick who it's for, then title, details, importance, and — for managers — an assignee). You can also create one straight from a client profile (card above Upcoming renewals) or a prospect profile (Quick actions card), where the contact is pre-filled.",
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
      "The Renewals category tracks every policy's renewal pipeline. Upcoming renewals also surface on each client profile's Upcoming renewals card. When a renewal is near and there are documents to e-sign, the AI auto-emails the customer a portal link so they can sign from the client portal.",
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
      "Deposits are taken to start a quote/bind workflow; payments track premium collection against a policy. A deposit doesn't constitute active coverage — binding requires a licensed agent. Receipts are stored as documents on the client record.",
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
      "The Messages page holds internal staff threads (1:1 or group) alongside carrier-rep threads. Open a thread, type, send — unread counts show on the Messages rail item. Customer-facing replies go through the marketing composer instead.",
    related: ["How does messaging work?"],
  },
  {
    id: "archive",
    question: "How does the archive work?",
    keywords: ["archive", "archived", "restore", "soft delete", "deleted client"],
    answer:
      "Archiving soft-deletes a client or prospect — they drop off the active rosters and stop receiving outreach, but nothing is destroyed. Find them under Archive and restore any record. Reverting a converted client to a prospect archives the client record automatically.",
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
      "Managers flip e-signature requirements per document in Document review. The AI auto-emails the customer a packet with a portal link so they can access it from the client portal, and stamps an Activity Center task for any signature an agent owes. Status chips show queued / sent / signed per side.",
    related: ["How does document review work?"],
  },
  {
    id: "demo-mode",
    question: "Is this real data?",
    keywords: [
      "demo",
      "demo mode",
      "real data",
      "sandbox",
      "test data",
      "is this live",
    ],
    answer:
      "This is a demo environment — data lives in your browser and AI outputs are illustrative. Document uploads store filename/metadata only. In production, files go to encrypted storage and AI runs server-side behind /api endpoints.",
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
      "Clients get Overview, My assets (per-asset detail), Policies (expandable full detail + request a change), Documents (with e-sign), Claims, Get a quote, and Profile. They see only customer-visible timeline events and documents — internal notes stay staff-only.",
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
      "Yes — ask me things like \"how many assets does <client> have?\", \"what's <client>'s total premium?\", \"who is <client>'s agent?\", \"when does <client> renew?\", \"tell me about <client>\", or agency-wide totals like \"how many open activities are there?\" and \"total premium under management\". I only surface records you're allowed to see.",
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
      'Open the Messages page. Each of the three cards — "Clients & prospects", "Internal", and "Carriers" — has a "+ New send" button in the top-right.\n\nClicking it opens one unified popup that:\n  1. Lists every recipient you don\'t already have a conversation with (scoped to that card\'s pool — visible clients/prospects, teammates, or carrier reps).\n  2. Lets you pick a channel: Email or SMS for client/prospect, email-only for carriers, none for internal.\n  3. Adds a Subject field (email) or Urgency picker (internal DM).\n  4. Has a Message textarea for the first message.\n\nHit Send and the conversation is created and opened in that card.',
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
      "⋯",
      "kebab",
      "message settings",
      "thread settings",
      "conversation settings",
    ],
    answer:
      'Every conversation row in the Messages cards has a ⋯ button on the right. Tapping it opens the message-settings menu with:\n  • Pin to top — floats this thread above the rest (up to 5 pins).\n  • Mute notifications — silences the unread badge for this thread (dims the row, shows a bell-off icon).\n  • Mark as read — clears unread inbound on a contact thread, or marks an internal thread read.\n  • Archive client / Archive prospect — soft-archives the contact (client/prospect only) so it drops off the active list; restore from the Archive page.\n  • Delete conversation / Delete thread — destructive; removes the message history (contact record is kept). Internal threads are deleted entirely.\n\nPinned threads show a Pin icon, muted threads show a BellOff icon, and dim slightly.',
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
      "Every messages card — the inline thread on a client/prospect profile, the three Messages inbox cards (Clients & prospects, Internal, Carriers), and the dashboard's Internal messages card — has a maximize icon in its top-right header.\n\nClick it and the card fills the screen as an overlay. Esc or clicking the backdrop collapses it back. Your draft is preserved across the toggle.\n\nIn the expanded inbox cards, the contacts list shrinks to a narrow names-only rail so the conversation gets the full width.",
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
      "Every conversation pane has an Email / SMS toggle at the top of the thread.\n\n  • Email shows only messages sent or received via email.\n  • SMS shows only texts.\n\nThe toggle also drives what the composer sends — so you stay in one medium at a time. Carrier threads are email-only, so the SMS tab is disabled there.",
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
      "After you type a draft in any message composer, click the Enhance with AI button under the textarea. The AI rewrites your draft into a clearer, more polished message — channel-aware:\n  • Email gets a greeting + warm sign-off and proper sentence casing.\n  • SMS stays short and courteous.\n\nThe rewritten text replaces your draft so you can review + edit before sending.",
    related: [
      "How does the AI auto-suggest email subjects?",
      "How do I start a new conversation in Messages?",
    ],
  },
  {
    id: "ai-inbound-triage",
    question: "How does the AI auto-create activities from inbound messages?",
    keywords: [
      "ai triage",
      "inbound triage",
      "auto activity",
      "auto-create activity",
      "auto create activity",
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
      "Every inbound client / prospect / carrier message is scanned once. If the AI judges it warrants follow-up (coverage change, claim, cancellation, payment, documents, renewal, or a question), it auto-creates an Activity Center task assigned to the contact's agent — or routes it to a manager (Routing card → Awaiting manager assignment) if no owner.\n\nIn the thread, the triaged message gets a violet ring and a small banner inside the bubble: '⚡ AI opened an activity for this' with a 'Go to activity →' link that deep-links to the Activity Center card. The Messages page also flashes a summary banner: 'AI opened N activities from your inbox.'\n\nPure acknowledgements ('thanks!', 'got it') are ignored.",
    related: [
      "How does the routing card work?",
      "Why can't I mark an activity resolved?",
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
      "When you open Create new activity as an agent, you'll see two buttons:\n  • Create & assign to me — self-assigns to your queue (default).\n  • Send to manager — routes the activity to a manager to assign.\n\nThe sent-to-manager activity drops out of your To-do board and shows up in the manager Routing card under 'Activities to assign', with an amber 'Awaiting manager assignment' badge. The manager picks the owning agent inline; once assigned, the badge clears and the activity moves to that agent's queue.",
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
      "The Routing card sits at the top of the manager Activity Center. It surfaces three things:\n  1. Unrouted prospects — prospects with no assigned agent.\n  2. Unrouted clients — clients with no assigned agent.\n  3. Activities to assign — activities an agent sent over via 'Send to manager'.\n\nEach row has two actions: 'Assign to me' (one-click confirm) or 'Pick agents…' (multi-select dialog). For prospects/clients you can co-own with multiple agents — the first is the primary owner and the rest co-manage. Activities take a single owner.",
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
      "Start activity (top-left of an open activity card) does two things:\n  1. Moves the card from To-do to In progress so the team knows it's actively owned (the first start stamps the handoff timestamp).\n  2. If the activity is tied to a customer, the customer is auto-texted: 'Hi {name}, one of our agents has started working on your request. We'll follow up shortly with next steps.' This only fires on the first start — snoozing and resuming doesn't re-send.\n\nNo-customer activities just flip status with no outbound text.",
    related: [
      "Why can't I mark an activity resolved?",
      "How does the AI-verified change resolve gate work?",
    ],
  },
  {
    id: "ai-verified-resolution",
    question: "How does the AI-verified change resolve gate work?",
    keywords: [
      "ai verified",
      "ai verification",
      "verified change",
      "ai recognized",
      "resolution gate",
      "ai checklist",
      "vehicle added",
      "ai sees",
      "ai watching",
    ],
    answer:
      "An activity that asks for a real-world change on the account (e.g., add a vehicle, file a claim, change coverage) stays locked from Mark resolved until the AI confirms the change actually landed. The AI reads the activity's topic + title + description and watches for one of these events on the account, dated after the activity was opened:\n  • asset_added — a new asset on the customer.\n  • policy_changed — a new policy OR a logged policy edit.\n  • document_added — a new document on the customer.\n  • claim_filed — a claim opened for the customer.\n\nIf the activity has no concrete change to verify (a general callback or question), the AI step auto-clears and resolve unlocks as before. When you click a locked resolve, the disclaimer modal shows what the AI is still waiting on; a manager can grant an override.",
    related: [
      "Why can't I mark an activity resolved?",
      "How do I grant a manager override?",
    ],
  },
  {
    id: "manager-override",
    question: "How do I grant a manager override on an activity?",
    keywords: [
      "manager override",
      "grant override",
      "bypass checklist",
      "override request",
      "resolve anyway",
    ],
    managerOnly: true,
    answer:
      "When an agent runs into the resolve checklist and asks for help, you'll see a 'Grant override' button on the activity card (only managers see it, only when overrideRequested && !overrideGranted). Granting:\n  • Sets overrideGrantedAt + overrideGrantedById on the task (audit trail).\n  • Clears the pending broadcast so it stops pumping the manager badge.\n  • Unlocks Mark resolved for the agent.\n\nManagers can also resolve a locked activity directly from the resolve disclaimer modal ('Resolve anyway (override)') — that path writes a task.manager_override audit row noting the missing steps.",
    related: [
      "Why can't I mark an activity resolved?",
      "How does the AI-verified change resolve gate work?",
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
      "Open the policy detail page (/employee/policies/:id). The Coverage card has a Renew documents button. Clicking it regenerates a fresh, dated set from current coverage:\n  • Declarations page\n  • Insurance ID card\n  • Proof of insurance\n\nAll three land on the Documents card below (customer-visible, approved, named with the policy ref + date). A customer-visible status event is logged to the timeline so the client's portal records the renewal.",
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
      "Next to the Policy timeline on the policy detail page, the Policy description card gives a plain-language summary:\n  • Line of business, asset, carrier, effective + renewal dates, current premium, and billing frequency.\n  • A 'What's covered' list pulled from the policy's coverage schedule when it has one (each item with limits + deductibles), or a sensible default outline for the asset type (home, auto, yacht, jewelry, umbrella, portfolio).\n\nAll three cards (Coverage, Policy timeline, Policy description) are fixed-height and scroll internally so the layout stays uniform.",
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
      "On the policy detail page, click Edit policy on the Coverage card. The Edit policy modal opens prefilled with the current policy and saves through api.policies.update.\n\nInside it you can:\n  • Change carrier, policy number, premium, dates, status, and department (Personal / Commercial Lines).\n  • Pick a different asset OR choose '+ Add a new asset…' to create one inline (label, type, estimated value) — the policy attaches to the new asset on save.\n  • Drop a declarations page / carrier PDF into the AI document-insert tool at the top to auto-fill the fields and attach the file as a policy document.",
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
      "On a client's profile, the Documents card has a 'Preview template' button in the top-right. It opens a modal that:\n  1. Lets you pick any agency template/form from the library (dropdown).\n  2. Renders that template as if filled in with the client's details — insured info (name, code, email, phone, addresses, agent of record), policies table, scheduled assets, client + agent signature lines.\n  3. Offers 'Print / Save as PDF' (opens a clean print view) and 'Save copy to documents' (clones the filled template onto the client's Documents card).\n\nIf no agency templates exist yet, a manager uploads them under Document review → Agency document library.",
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
      "Go to Document review (/employee/documents). The top card is the Agency document library; the first section is Templates & forms (manager-only).\n  1. Pick the document type (defaults to Agency template / form) and upload your file.\n  2. The template lands in the shared library — every agent can send it to a client via the Documents card or preview it with merged client data.\n\nThe same card has Personal lines and Commercial lines buckets at the bottom; each has its own upload button so you can also drop line-of-business-tagged forms there.",
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
      "On a client or prospect profile, the top-right header has a 'Download client information' (or 'Download prospect information') button. It compiles everything on file — profile, assets, policies, claims, documents, email + SMS messages, timeline & remarks, activities — into a print-ready document and opens the browser print dialog so it saves as a PDF.\n\nUses your browser's 'Save as PDF' destination — no plugin needed.",
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
      "The five tiles at the top of the agency dashboard are clickable (except Activity Center, which deep-links to the page):\n  • My clients / Active clients — opens a quick-view list of clients (expandable rows + Profile button).\n  • Bound policies — list of bound policies with carrier, premium, and Open Policy.\n  • Open prospects — list of new / abandoned prospects with status and Profile button.\n  • Renewals upcoming — list of upcoming renewals with date and Open Policy.\n\nEach row uses the same drill-down UI as the manager Analytics metric modals: expand for details + a deep-link to the actual record.",
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
      "Open the Archive page (/employee/archive). At the top is a search bar that filters by name, email, or status across both Archived prospects and Archived clients.\n\nEach row has two actions:\n  • Quick view — opens a modal of the basic archived record (contacts, policies count, managed-by, archived date) with an 'Open full profile' link — without leaving the archive.\n  • Unarchive — restores the contact to the active list.",
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
      "Every upcoming renewal gets an Activity Center card assigned to the renewal's owning agent (falling back to the client's assigned agent). The card title is 'Renewal due — {asset}', topic renewal_approaching, severity Warning.\n\nThe spawn is idempotent — one card per renewal term (keyed by renewalId), so reloading the Activity Center never creates duplicates. Cards appear as soon as the Activity Center is loaded.",
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
      "On the Marketing activity page, click Compose new campaign. The composer is multi-select for both Channel (toggle Email + SMS on at the same time) and Audience (toggle All clients + All prospects + optional hand-pick — they combine).\n\nPromotional campaigns are fire-and-forget: only the campaign + a launch status event are recorded — no per-recipient message rows are written, so campaigns never clutter individual clients' Messages threads. Promotional AI auto-outreach (the per-prospect intake fire on prospect creation) is SMS-only by policy.",
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
      "Two rules:\n  • Promotional AI auto-messages (per-prospect outreach + manager AI campaigns) are SMS-only and stay out of email. Campaign sends aren't recorded as per-contact messages at all.\n  • Transactional AI (policy-edit acknowledgments, questionnaires, e-sign requests, anything about the quote/policy/documents) goes via email — including AI-drafted ones — so the substance lives in the email thread.\n\nThis keeps promo out of the inbox and serious content where the client expects it.",
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
      "The Messages page has an Email signature card. Tap Edit signature to unlock; add your signature text (name, title, contact info) and any logos. Save re-locks the card and shows a live preview of how your signature appears at the foot of an outbound email (the '—' separator, text, and logos).\n\nThe saved signature is auto-appended to every outbound EMAIL you send from anywhere in the app — Messages page, inline detail-page threads, the New send modal. SMS sends ignore it.",
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
      "Manager-only surfaces and actions:\n  • Analytics page (team performance + per-agent drill-downs + performance goals).\n  • Routing card on the Activity Center (assign unrouted prospects/clients + handed-off activities).\n  • Grant override on a locked resolve.\n  • Manage carriers, carrier reps, and the agency document library (templates + line-of-business buckets).\n  • Agency branches in the master portal.\n  • Reassign any activity to any agent directly.\n  • Compose AI marketing campaigns.\n  • Master portal pages (agencies, users, custom doc types).\n\nAgents can request reassignment + override (managers action it), and can only create activities for clients/prospects assigned to them.",
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
      "On an expanded activity card, there's an Importance chip showing the current level (Low / Medium / High). Click it — the three options appear inline with their colored icons (Info / AlertTriangle / AlertCircle). Pick one and it saves immediately, collapsing back to a single chip.\n\nA small 'Edited' hint appears next to the chip when a human changed the AI's original grading.",
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
      "Every message surface auto-scrolls to the most recent message when the thread opens, the Email/SMS channel switches, the card is expanded to full screen, or a new message arrives — so you always land at the bottom of the conversation. The exception is the timeline ?msg= deep-link, which scrolls to and highlights that specific message instead.",
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

// Order matters — more specific phrases first so "renewal date" beats
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

function answerForContactMetric(
  contact: MatchedContact,
  metric: DataMetric,
  ctx: AssistantContext
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
          : `${name} is an unassigned prospect — a manager needs to route them to an agent before they can be converted.`,
        related: ["How do I convert a prospect to a client?"],
        topicId: "data-agent",
      };
    }
    if (metric === "contact") {
      return {
        text: `${name} (prospect) — ${p.email}${p.phone ? ` · ${p.phone}` : ""}.`,
        topicId: "data-contact",
      };
    }
    if (metric === "status") {
      return {
        text: `${name} is a prospect with status "${p.status.replace(/_/g, " ")}". Last action: ${p.lastAction}.`,
        topicId: "data-status",
      };
    }
    return {
      text:
        `${name} is a prospect, so there's no bound book yet. They came in interested in ${assetLabel}` +
        `${p.estimatedValue ? ` (est. ${formatMoney(p.estimatedValue)})` : ""}, status "${p.status.replace(/_/g, " ")}", ` +
        `${p.assignedAgentId ? `assigned to ${api.users.get(p.assignedAgentId)?.name ?? "an agent"}` : "currently unassigned"}. ` +
        `Open their prospect profile for the AI summary, quote interest, and timeline — convert them to a client to start attaching assets, policies, and claims.`,
      related: ["How do I convert a prospect to a client?"],
      topicId: "data-prospect",
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
          `${name} — client snapshot:\n` +
          `• Assigned agent: ${agent?.name ?? "unassigned"}\n` +
          `• Assets: ${assetN}\n` +
          `• Policies: ${policies.length} (${bound.length} bound)\n` +
          `• Premium under management: ${formatMoney(premium)}\n` +
          `• Claims: ${claims.length} (${openClaims} open)\n` +
          `• Upcoming renewals: ${renewals}\n` +
          `${customer ? `• Contact: ${customer.email}${customer.phone ? ` · ${customer.phone}` : ""}` : ""}\n\n` +
          `Open their client profile for the full picture, or ask me about any one of these.`,
        related: [
          `How many policies does ${name} have?`,
          `When does ${name} renew?`,
          `Who is ${name}'s agent?`,
        ],
        topicId: "data-profile",
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
          : `${name} doesn't have an assigned agent yet — a manager can assign one from the client profile or the Activity Center routing card.`,
        topicId: "data-agent",
      };
    }
    case "contact": {
      return {
        text: customer
          ? `${name} — ${customer.email}${customer.phone ? ` · ${customer.phone}` : ""}${
              customer.mailingAddress ? `\nMailing: ${customer.mailingAddress}` : ""
            }. You can edit contact info on the client profile (Edit profile).`
          : `I couldn't load ${name}'s contact details.`,
        topicId: "data-contact",
      };
    }
    case "premium": {
      const bound = api.policies
        .listByCustomer(contact.id)
        .filter((p) => p.status === "bound");
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
        };
      }
      const lines = upcoming.slice(0, 5).map((r) => {
        const pol = api.policies.get(r.policyId);
        const asset = pol ? api.assets.get(pol.assetId) : undefined;
        return `• ${asset?.label ?? pol?.policyNumber ?? "Policy"} — ${formatDate(r.renewalDate)}`;
      });
      return {
        text:
          `${name}'s upcoming ${plural(upcoming.length, "renewal", "renewals")}:\n` +
          lines.join("\n") +
          `\n\nSee them on the client profile's Upcoming renewals card.`,
        topicId: "data-renewalDate",
      };
    }
    case "status": {
      const policies = api.policies.listByCustomer(contact.id);
      if (policies.length === 0) {
        return { text: `${name} has no policies on file yet.`, topicId: "data-status" };
      }
      const lines = policies.slice(0, 6).map((p) => {
        const asset = api.assets.get(p.assetId);
        return `• ${asset?.label ?? p.policyNumber ?? "Policy"} — ${p.status.replace(/_/g, " ")}`;
      });
      return {
        text: `${name}'s policy statuses:\n` + lines.join("\n"),
        topicId: "data-status",
      };
    }
    case "assets": {
      const n = api.assets.listByCustomer(contact.id).length;
      return {
        text:
          `${name} has ${n} insured ${plural(n, "asset", "assets")} under management. ` +
          `To view this, go to their client profile and click View on any row in the Assets card to open that asset's detail page — structured details, the policies attached to it (each with its own View), documents, and the asset's activity timeline. Customers see the same per-asset view under My assets in their portal.`,
        related: ["How do I view full policy details?"],
        topicId: "data-assets",
      };
    }
    case "policies": {
      const policies = api.policies.listByCustomer(contact.id);
      const n = policies.length;
      const bound = policies.filter((p) => p.status === "bound").length;
      return {
        text:
          `${name} has ${n} ${plural(n, "policy", "policies")} on file${
            n > 0 ? ` (${bound} bound)` : ""
          }. ` +
          `Open their client profile → Policies card and click View on any policy for the full detail page — coverage, dates, premium, timeline, and documents.`,
        related: ["How do I view full policy details?"],
        topicId: "data-policies",
      };
    }
    case "claims": {
      const claims = api.claims.listByCustomer(contact.id);
      const n = claims.length;
      const open = claims.filter((c) => c.status !== "closed").length;
      return {
        text:
          `${name} has ${n} ${plural(n, "claim", "claims")}${
            n > 0 ? ` — ${open} open, ${n - open} closed` : ""
          }. ` +
          `See them on the Claims card of their client profile. Open claims also show up as activities in the Activity Center until they're resolved.`,
        related: ["How does document review work?"],
        topicId: "data-claims",
      };
    }
    case "renewals": {
      const policyIds = new Set(
        api.policies.listByCustomer(contact.id).map((p) => p.id)
      );
      const n = api.renewals
        .listByTenant(ctx.tenantId)
        .filter((r) => policyIds.has(r.policyId) && r.status === "upcoming").length;
      return {
        text:
          `${name} has ${n} upcoming ${plural(n, "renewal", "renewals")}. ` +
          `They're listed on the Upcoming renewals card of their client profile, and the Renewals category tracks the whole agency's pipeline.`,
        topicId: "data-renewals",
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

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
    };
  }
  if (/\bpolic/.test(q)) {
    const policies = api.policies
      .listByTenant(ctx.tenantId)
      .filter((p) => isManager || customerIds.has(p.customerId));
    const bound = policies.filter((p) => p.status === "bound").length;
    return {
      text: `There are ${policies.length} policies${scopeNote} — ${bound} bound. The Policies category lists them all.`,
      topicId: "agg-policies",
    };
  }
  if (/\bclaim/.test(q)) {
    const claims = scoped(api.claims.listByTenant(ctx.tenantId));
    const open = claims.filter((c) => c.status !== "closed").length;
    return {
      text: `There are ${claims.length} claims${scopeNote}, ${open} still open. Open claims show as activities until resolved.`,
      topicId: "agg-claims",
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
        carriers.length > 8 ? "…" : ""
      }. Manage them under Carrier recommendations.`,
      topicId: "agg-carriers",
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
        `${named.name} — writes ${
          named.preferredAssetTypes.map((t) => t.replace(/_/g, " ")).join(", ") || "various lines"
        }. ` +
        `${named.agentPortalUrl ? "Has an agent portal configured." : "No agent portal URL on file."}\n` +
        (reps.length
          ? `Reps on file:\n${reps.map((r) => `• ${r}`).join("\n")}`
          : "No carrier reps on file yet — add them from the carrier card on Carrier recommendations."),
      related: ["How do I add or remove carriers?"],
      topicId: "data-carrier",
    };
  }
  // No specific carrier named, but the question reads like "what/which
  // carriers do we work with" → list them.
  if (/\b(what|which|list|work with|do we|our)\b/.test(q)) {
    return {
      text: `This agency works with ${carriers.length} ${plural(
        carriers.length,
        "carrier",
        "carriers"
      )}: ${carriers.map((c) => c.name).join(", ")}. Manage them under Carrier recommendations; tap a carrier to see its reps.`,
      related: ["How do I add or remove carriers?", "How do I upload carrier-specific documents?"],
      topicId: "data-carrier-list",
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
      `${match.name} — ${clients.length} ${plural(clients.length, "client", "clients")}, ` +
      `${policies.length} bound ${plural(policies.length, "policy", "policies")} (${formatMoney(
        premium
      )} premium), ${openTasks} open ${plural(openTasks, "activity", "activities")}. ` +
      `Open Analytics → click ${match.name} for the full drill-down.`,
    related: ["What is the performance leaderboard?", "How do I set performance goals?"],
    topicId: "data-agent-stats",
  };
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

export function askPortalAssistant(
  question: string,
  role?: "agent" | "manager",
  ctx?: AssistantContext,
  history?: AssistantHistoryItem[]
): AssistantAnswer {
  const q = question.trim().toLowerCase();
  if (!q) {
    return {
      text: "Ask me anything about using the portal — the Activity Center, reminders, prospects, policies, carriers, documents, or analytics.",
      related: assistantStarters(),
    };
  }

  // Pure greeting / "help" with no topic words → menu.
  const isGreeting =
    GREETING_KEYWORDS.some((g) => q === g || q.startsWith(g + " ")) && q.length < 25;
  if (isGreeting) {
    return {
      text: "Hi! I'm the portal assistant. I can explain how the Activity Center, reminders, prospects, policies, carriers, documents, and analytics work — and I can look up live numbers like \"how many assets does <client> have?\". Try one of these:",
      related: assistantStarters(),
    };
  }

  const lastTopic = lastAssistantTopic(history);

  // "Tell me more" / "continue" / "step by step" — keep walking the
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

  // Live-data lookups (need the records the viewer can see). Use the
  // raw `q` here — never the augmented one — so a topic's keywords
  // can't accidentally summon a contact lookup.
  if (ctx) {
    const found = findContact(q, ctx);
    const metric = detectMetric(q);
    const dataIntent =
      /\b(how many|how much|tell me about|who is|who's|profile|summary|recap|premium|renew|claim|asset|polic|document|status|email|phone|number|agent|assigned|have|has|does|count|total)\b/.test(
        q
      );
    const contactOk = found && (found.score >= 10 || dataIntent);

    if (contactOk && found) {
      return answerForContactMetric(found.contact, metric ?? "profile", ctx);
    }

    const aggregate = tryAgencyAggregate(q, ctx);
    if (aggregate) return aggregate;
    const agentStats = tryAgentAnswer(q, ctx);
    if (agentStats) return agentStats;
    const carrier = tryCarrierAnswer(q, ctx);
    if (carrier) return carrier;
  }

  let best: KbEntry | null = null;
  let bestScore = 0;
  for (const entry of KB) {
    const s = scoreEntry(entry, effectiveQ);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }

  // Follow-up question that didn't strongly match anything new but we
  // know the prior topic → keep talking about it rather than dumping
  // the topic menu.
  if (looksLikeFollowUp && lastTopic && (!best || bestScore < 3)) {
    return {
      text: `Continuing on "${lastTopic.question}":\n\n${lastTopic.answer}`,
      related: lastTopic.related,
      topicId: lastTopic.id,
    };
  }

  if (!best || bestScore === 0) {
    return {
      text: "I'm not sure about that one yet — I cover portal how-tos. Here are some topics I can help with:",
      related: KB.slice(0, 6).map((e) => e.question),
    };
  }

  let text = best.answer;
  if (best.managerOnly && role === "agent") {
    text =
      "Heads up: this is a manager-only area, so you may not see it in your rail.\n\n" +
      text;
  }
  return { text, related: best.related, topicId: best.id };
}