import type { Role } from "@/types";

export type VideoAudience = "public" | "agent" | "manager";

export interface VideoChapter {
  id: string;
  title: string;
  timestamp: string;
  summary: string;
  transcript: string;
  keywords: string[];
}

export interface PortalVideo {
  id: string;
  audience: VideoAudience;
  eyebrow: string;
  title: string;
  duration: string;
  body: string;
  chapters: VideoChapter[];
}

export const PUBLIC_WHAT_IT_DOES_VIDEOS: PortalVideo[] = [
  {
    id: "what-platform-does",
    audience: "public",
    eyebrow: "What it does",
    title: "What Quotex does for an agency",
    duration: "3 min",
    body:
      "A quick walkthrough of the agency workspace, client dashboard, AI quoting, documents, billing visibility, claims, renewals, and activity center.",
    chapters: [
      {
        id: "agency-workspace",
        title: "Agency workspace",
        timestamp: "0:00",
        summary: "Shows how Quotex gathers agency work into one staff portal.",
        transcript:
          "Quotex gives agents and managers one operating system for daily insurance work: prospects, clients, policies, claims, billing, renewals, documents, messages, calendar, and activity center.",
        keywords: ["agency workspace", "dashboard", "portal", "staff portal", "software"],
      },
      {
        id: "ai-quoting-carrier-fit",
        title: "AI quoting and carrier fit",
        timestamp: "0:58",
        summary: "Explains how AI helps structure intake and rank carrier options.",
        transcript:
          "The AI quoting workspace turns asset details and client answers into structured intake, missing-field questions, carrier appetite matching, and ranked quote options for licensed review.",
        keywords: ["ai quoting", "carrier fit", "carrier appetite", "questionnaire", "rank"],
      },
      {
        id: "servicing-one-place",
        title: "Policy servicing from one place",
        timestamp: "1:54",
        summary: "Shows how documents, billing, claims, and renewals stay attached to the client record.",
        transcript:
          "Policy documents, billing visibility, holder communication, renewal review, claims, and client messages stay connected to the right client, policy, and activity trail.",
        keywords: ["documents", "billing", "claims", "renewals", "policy servicing"],
      },
    ],
  },
  {
    id: "what-website-does",
    audience: "public",
    eyebrow: "What it does",
    title: "Why the agency website matters",
    duration: "2 min",
    body:
      "Shows how the branded website captures prospects, starts quote intake, routes client portal access, and keeps the agency experience professional.",
    chapters: [
      {
        id: "lead-capture",
        title: "Lead capture",
        timestamp: "0:00",
        summary: "Explains how the agency website turns anonymous traffic into quote-start prospects.",
        transcript:
          "The branded agency website gives prospects a professional place to understand the agency, choose the right quote path, and begin intake without waiting for a phone call.",
        keywords: ["website", "lead capture", "prospects", "quote start", "intake"],
      },
      {
        id: "portal-handoff",
        title: "Client portal handoff",
        timestamp: "0:44",
        summary: "Shows how website activity connects back to the software and client portal.",
        transcript:
          "Once someone starts a quote or signs in, the website routes them into the right portal while the staff side receives the prospect, activity, and client context.",
        keywords: ["client portal", "handoff", "sign in", "website connection"],
      },
      {
        id: "brand-trust",
        title: "Brand trust",
        timestamp: "1:21",
        summary: "Shows why a polished agency website helps sell a high-touch insurance experience.",
        transcript:
          "The website gives the agency a premium digital front door, which makes the software feel like part of the agency's brand instead of a disconnected tool.",
        keywords: ["brand", "trust", "professional", "premium", "agency website"],
      },
    ],
  },
  {
    id: "what-app-does",
    audience: "public",
    eyebrow: "What it does",
    title: "Why the Quotex client app matters",
    duration: "2 min",
    body:
      "Explains how one Quotex client app improves retention, document access, policy visibility, claims updates, and client communication after the customer selects their agency.",
    chapters: [
      {
        id: "retention",
        title: "Retention",
        timestamp: "0:00",
        summary: "Explains how the app keeps the agency visible between renewals.",
        transcript:
          "The Quotex app keeps the agency relationship on the client's phone. Customers choose their agency at sign-in, then policies, documents, claims, and contact points become easy to reach when they need service.",
        keywords: ["app", "retention", "client app", "mobile", "phone"],
      },
      {
        id: "document-access",
        title: "Document access",
        timestamp: "0:39",
        summary: "Shows how clients access declarations, proof of insurance, and shared files.",
        transcript:
          "Clients can access key documents and policy information through the app, reducing back-and-forth and helping the agency deliver a cleaner service experience.",
        keywords: ["documents", "proof of insurance", "declarations", "client documents"],
      },
      {
        id: "always-on-communication",
        title: "Always-on communication",
        timestamp: "1:18",
        summary: "Shows how the app supports client communication and claim visibility.",
        transcript:
          "App access helps clients reach the agency, follow claim or renewal status, and stay connected to their advisor without hunting through email threads.",
        keywords: ["communication", "claims", "renewal status", "messages", "advisor"],
      },
    ],
  },
];

const CATEGORY_WALKTHROUGH_VIDEOS = [
  {
    slug: "dashboard",
    title: "Dashboard",
    body: "How to read the dashboard, reminders, notifications, prospect queue, remarks, and daily command-center cards.",
    keywords: ["dashboard", "reminders", "notifications", "prospect queue", "remarks"],
  },
  {
    slug: "activity-center",
    title: "Activity Center",
    body: "How to open, prioritize, reassign, add due dates, set reminders, and resolve activity cards cleanly.",
    keywords: ["activity center", "tasks", "routing", "due dates", "resolve"],
  },
  {
    slug: "messages",
    title: "Messages",
    body: "How client, prospect, holder, carrier, and internal messages mirror communication and stay tied to the right record.",
    keywords: ["messages", "email", "sms", "holders", "carrier"],
  },
  {
    slug: "prospects",
    title: "Prospects",
    body: "How to use prospect filters, search, managed-by ownership, status, last action, and Open row actions.",
    keywords: ["prospects", "filters", "managed by", "status", "open"],
  },
  {
    slug: "clients",
    title: "Clients",
    body: "How to work client rows, personal/commercial filters, client dashboard cards, remarks, and one-record servicing.",
    keywords: ["clients", "commercial", "personal", "client dashboard", "remarks"],
  },
  {
    slug: "policies",
    title: "Policies",
    body: "How policy rows, policy-number labels, overview, coverage, documents, holders, renewal review, and timeline fit together.",
    keywords: ["policies", "policy number", "coverage", "documents", "holders"],
  },
  {
    slug: "claims",
    title: "Claims",
    body: "How to review claims, carrier links, previous loss runs, send options, and claim record history.",
    keywords: ["claims", "loss runs", "carrier", "send to client", "claim history"],
  },
  {
    slug: "billing",
    title: "Billing",
    body: "How billing rows show carrier payment path, payment plan, next due, premium changes, and billing history without collecting payments.",
    keywords: ["billing", "payment plan", "next due", "premium", "billing history"],
  },
  {
    slug: "renewals",
    title: "Renewals",
    body: "How renewal queues, non-renewals, carrier-synced updates, ready-for-review states, document updates, publish timing, and current/new term separation work.",
    keywords: ["renewals", "non-renewal", "carrier sync", "ready for review", "publish", "term", "documents"],
  },
  {
    slug: "document-review",
    title: "Document review",
    body: "How the agency template library, required flags, line labels, e-sign rules, preview, and locking settings work.",
    keywords: ["document review", "template library", "e-sign", "required", "line of business"],
  },
  {
    slug: "ai-marketing",
    title: "AI marketing",
    body: "How campaign drafting, branded pamphlets, audience sorting, campaign controls, auto-message setup, and Agency setup branding lock together.",
    keywords: ["ai marketing", "campaign", "pamphlet", "audience", "branding"],
  },
  {
    slug: "carrier-recommendations",
    title: "Carrier library",
    body: "How the carrier library helps staff manage markets, contacts, appetite documents, carrier fit, and the next best market to review.",
    keywords: ["carrier library", "carrier recommendations", "carrier fit", "appetite", "markets", "recommendations"],
  },
  {
    slug: "analytics",
    title: "Analytics",
    body: "How goals, performance leaderboard, personal metrics, company goals, and manager review of goal requests work.",
    keywords: ["analytics", "goals", "leaderboard", "performance", "goal requests"],
  },
  {
    slug: "accounting",
    title: "Accounting",
    body: "How timesheet configuration, individual agent accounting, submissions, due dates, and manager review work.",
    keywords: ["accounting", "timesheets", "due date", "manager review", "agent"],
  },
  {
    slug: "hr",
    title: "HR",
    body: "How HR submissions, anonymous complaints, company suggestions, and manager review status work.",
    keywords: ["hr", "anonymous", "complaints", "suggestions", "manager review"],
  },
  {
    slug: "calendar",
    title: "Calendar",
    body: "How week view, agenda, personal reminders, company reminders, due activities, internal meetings, and rescheduling work.",
    keywords: ["calendar", "agenda", "reminders", "meetings", "reschedule"],
  },
  {
    slug: "archive",
    title: "Archive",
    body: "How archived prospects and clients are searched, filtered, reviewed, restored, and kept out of active work queues.",
    keywords: ["archive", "restore", "archived clients", "archived prospects", "filters"],
  },
  {
    slug: "training",
    title: "Training videos",
    body: "How staff open role-specific videos, jump to exact sections, open new tabs, track completion, and use assistant-linked lessons.",
    keywords: ["training", "videos", "chapters", "completion", "assistant"],
  },
  {
    slug: "agency-settings",
    title: "Agency settings",
    body: "How agency settings, tier edits, user slots, carriers, AI allowance, signatures, and locked editing work.",
    keywords: ["agency settings", "tier", "user slots", "locked", "signatures"],
  },
] as const;

function categoryWalkthroughVideos(audience: "agent" | "manager"): PortalVideo[] {
  return CATEGORY_WALKTHROUGH_VIDEOS.map((video) => ({
    id: `${audience}-category-${video.slug}`,
    audience,
    eyebrow: "Category walkthrough",
    title: `${video.title} walkthrough`,
    duration: "1 min",
    body: video.body,
    chapters: [
      {
        id: "category-overview",
        title: `${video.title} overview`,
        timestamp: "0:00",
        summary: `Open ${video.title} and understand what this category is responsible for before starting work.`,
        transcript: `${video.body} This first section orients the user to the category, explains why the page exists, and shows where the main work begins so staff can start with the right context instead of clicking through the portal blindly.`,
        keywords: [...video.keywords],
      },
      {
        id: "primary-workflow",
        title: "Primary workflow",
        timestamp: "0:20",
        summary: `Use the main controls, filters, rows, cards, and actions that matter most inside ${video.title}.`,
        transcript: `The second section focuses on the main workflow for ${video.title}. Staff should use the visible filters, search tools, row actions, card controls, and status labels to narrow the work, open the right record, and avoid taking action from the wrong context.`,
        keywords: [...video.keywords, "workflow", "filters", "actions"],
      },
      {
        id: "follow-through",
        title: "Follow-through",
        timestamp: "0:40",
        summary: `Finish the task cleanly and keep the record, timeline, notification, or audit trail accurate.`,
        transcript: `The final section shows how to finish work in ${video.title} without losing the trail. Staff should confirm the right record, save or send only when ready, leave the status accurate, and use the connected timeline, notification, or audit history so the next person can understand what happened.`,
        keywords: [...video.keywords, "timeline", "audit", "status"],
      },
    ],
  }));
}

export const AGENT_HOW_TO_VIDEOS: PortalVideo[] = [
  ...categoryWalkthroughVideos("agent"),
  {
    id: "agent-complete-demo-walkthrough",
    audience: "agent",
    eyebrow: "Start here",
    title: "Complete Quotex software walkthrough",
    duration: "4 min",
    body:
      "A full narrated demo-mode tour of the staff workspace, from dashboard rhythm through clients, policies, documents, billing, claims, renewals, marketing, calendar, accounting, analytics, and training.",
    chapters: [
      {
        id: "command-center",
        title: "Command center",
        timestamp: "0:00",
        summary: "Start from the dashboard and understand the daily work rhythm.",
        transcript:
          "This walkthrough starts on the Quotex dashboard. Agents begin with reminders, notifications, prospect queue, remarks, and assigned activity so every workday starts from the correct queue.",
        keywords: ["complete walkthrough", "dashboard", "demo mode", "command center", "daily workflow"],
      },
      {
        id: "client-policy-service",
        title: "Client and policy service",
        timestamp: "1:04",
        summary: "Open clients, policies, billing, claims, documents, and holder workflows.",
        transcript:
          "The middle of the walkthrough teaches the client record: policies by policy number, billing by policy row, claims and previous loss runs, document templates, e-sign rules, holder communication, and renewal review.",
        keywords: ["client dashboard", "policy", "billing", "claims", "documents", "holders"],
      },
      {
        id: "growth-and-operations",
        title: "Growth and operations",
        timestamp: "2:32",
        summary: "See quoting, marketing, calendar, accounting, analytics, and training.",
        transcript:
          "The final section covers AI quoting, AI marketing, calendar work, accounting timesheets, analytics, and training so staff understand how the whole agency operating system connects.",
        keywords: ["ai quoting", "marketing", "calendar", "accounting", "analytics", "training"],
      },
    ],
  },
  {
    id: "agent-first-week-workflow",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Agent onboarding and first-week workflow",
    duration: "18 min",
    body:
      "How to work the dashboard, Activity Center, prospects, clients, messages, and documents without losing context.",
    chapters: [
      {
        id: "daily-workspace-rhythm",
        title: "Daily workspace rhythm",
        timestamp: "0:00",
        summary: "Start on the dashboard, check assigned activity, then work from open cards.",
        transcript:
          "Begin each day on the dashboard. Review My reminders, Notifications, Prospect queue, Recent remarks, and the Activity Center badge. Open work from the card, then return to the dashboard or Activity Center when finished.",
        keywords: ["dashboard", "daily workflow", "notifications", "prospect queue", "remarks"],
      },
      {
        id: "client-prospect-handoff",
        title: "Client and prospect handoff",
        timestamp: "5:40",
        summary: "Open assigned clients or prospects and follow the record trail before acting.",
        transcript:
          "When a prospect or client is assigned to you, open the profile first. Review contact details, notes, timeline, policies, documents, and open activities before messaging or changing status.",
        keywords: ["client handoff", "prospect handoff", "assigned", "profile", "timeline"],
      },
      {
        id: "clean-notes-followups",
        title: "Clean notes and follow-ups",
        timestamp: "12:10",
        summary: "Use timestamped remarks and reminders so the next action is never vague.",
        transcript:
          "Every meaningful call, email, upload, or client instruction should become a timestamped remark. Set a reminder when the next step is date-sensitive, and keep notes specific enough for another staff member to understand the file.",
        keywords: ["notes", "remarks", "follow up", "reminder", "timestamped"],
      },
    ],
  },
  {
    id: "agent-prospects-clients-followup",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Prospects, clients, and daily follow-up",
    duration: "15 min",
    body:
      "How agents open assigned work, update client/prospect records, manage remarks, and keep personal reminders clean.",
    chapters: [
      {
        id: "prospect-queue",
        title: "Prospect queue",
        timestamp: "0:00",
        summary: "Use filters and open only the prospects assigned to you.",
        transcript:
          "Open Prospects, use the filter buttons to narrow status, search by name or email, and open the row. Review last action, status, managed-by, and timeline before updating the prospect.",
        keywords: ["prospects", "prospect queue", "filters", "open prospect", "status"],
      },
      {
        id: "client-dashboard-cards",
        title: "Client dashboard cards",
        timestamp: "4:48",
        summary: "Use client cards for policies, billing, claims, activities, documents, and remarks.",
        transcript:
          "On a client dashboard, cards are grouped by work type. Policies, billing, and claims open into full detail pages. Client remarks should be searched and filtered before adding new updates.",
        keywords: ["client dashboard", "policies card", "billing card", "claims card", "client remarks"],
      },
      {
        id: "personal-reminders",
        title: "Personal reminders",
        timestamp: "10:12",
        summary: "Create personal reminders for private follow-up and activity reminders for task-specific work.",
        transcript:
          "Use New reminder for personal follow-up and Set personal reminder on an activity when the reminder belongs to that card. Recurring reminders create the next occurrence after you dismiss the current one.",
        keywords: ["personal reminder", "set reminder", "recurring reminder", "activity reminder"],
      },
    ],
  },
  {
    id: "agent-ai-quoting-workspace",
    audience: "agent",
    eyebrow: "How to do it",
    title: "AI quoting workspace for agents",
    duration: "22 min",
    body:
      "How agents prepare personal and commercial quoting files so intake, questionnaires, public-record enrichment, and carrier ranking work properly.",
    chapters: [
      {
        id: "asset-detail-quality",
        title: "Asset detail quality",
        timestamp: "0:00",
        summary: "Start with line of business, asset type, address, value, and identifiers.",
        transcript:
          "Before starting AI quoting, select personal or commercial lines and provide the most specific asset information available. For homes include address and property details. For vehicles include year, make, model, VIN when available, usage, garaging, and drivers.",
        keywords: ["ai quoting", "asset detail", "address", "vin", "line of business", "personal lines"],
      },
      {
        id: "questionnaire-handoff",
        title: "Questionnaire handoff",
        timestamp: "7:36",
        summary: "Send or manually fill the questionnaire when the system needs missing information.",
        transcript:
          "The AI drafts questions for missing fields. Agents can send the questionnaire to the client or open it and fill answers manually. For commercial lines, the base questionnaire is shared once between the agency and customer.",
        keywords: ["questionnaire", "manual fill", "commercial questionnaire", "missing fields"],
      },
      {
        id: "quote-ranking-review",
        title: "Quote ranking review",
        timestamp: "15:20",
        summary: "Review carrier ranking after answers and quotes are returned.",
        transcript:
          "Once information is complete, the workspace ranks carrier options by fit, appetite, quote strength, and file context. The ranking is for licensed review, not automatic binding.",
        keywords: ["quote ranking", "carrier ranking", "carrier options", "licensed review"],
      },
    ],
  },
  {
    id: "agent-messages-documents-esign",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Messages, documents, holders, and e-signature",
    duration: "16 min",
    body:
      "How agents send selected documents, communicate with clients/prospects/holders/carriers, and track customer or agent signature requirements.",
    chapters: [
      {
        id: "message-center",
        title: "Message center",
        timestamp: "0:00",
        summary: "Use contact cards for clients, prospects, holders, and carriers.",
        transcript:
          "Open Messages to view mirrored client, prospect, holder, and carrier communication. Each external contact card can open the relevant thread in the connected mail provider while keeping the portal record in sync.",
        keywords: ["messages", "message center", "email", "sms", "holders", "carrier messages"],
      },
      {
        id: "send-selected-pdfs",
        title: "Send selected PDFs",
        timestamp: "5:18",
        summary: "Use one send button, select documents, then choose recipients.",
        transcript:
          "On a policy document card, click Send to client or Send to holders. Check the documents to include, then select recipients. The email draft includes the selected PDFs as attachments and the relevant policy overview.",
        keywords: ["send selected", "pdf", "send to client", "send to holders", "attachments"],
      },
      {
        id: "signature-requirements",
        title: "Signature requirements",
        timestamp: "11:04",
        summary: "Mark whether a template requires customer, agent, or both signatures.",
        transcript:
          "In Document review, e-signature controls mark whether the document requires customer signature, agent signature, or both. The buttons record requirements; the actual send happens from the workflow action.",
        keywords: ["e-signature", "signature required", "customer signature", "agent signature"],
      },
    ],
  },
  {
    id: "agent-policies-billing-claims",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Policies, billing, claims, and loss runs",
    duration: "20 min",
    body:
      "How agents open policy and billing detail pages, send policy summaries, review carrier-paid billing information, and prepare loss-run packets.",
    chapters: [
      {
        id: "policy-detail-pages",
        title: "Policy detail pages",
        timestamp: "0:00",
        summary: "Open a policy row to see the full policy page, documents, overview, coverage, holders, and timeline.",
        transcript:
          "Use the Policies category or the client Policies card to open a policy. The row is labeled by policy number so multiple assets can sit under one policy. The detail page shows overview, coverage, documents, holders, timeline, carrier links, and send-to-client actions.",
        keywords: ["policy detail", "policy number", "coverage", "policy overview", "holders", "timeline"],
      },
      {
        id: "billing-detail-pages",
        title: "Billing detail pages",
        timestamp: "6:18",
        summary: "Open billing by policy to see how the client pays the carrier and what changed over time.",
        transcript:
          "Billing is informational only. Open a billing row to see carrier payment method, plan, next due date, premium, payment history, premium change percentage, and the carrier payment path. The software does not collect card or bank information.",
        keywords: ["billing", "payment plan", "carrier billing", "next due", "premium increase", "payment history"],
      },
      {
        id: "claims-loss-runs",
        title: "Claims and loss runs",
        timestamp: "13:44",
        summary: "Track open claims and generate previous loss-run packets from claim history.",
        transcript:
          "Claims show open and historical loss context on the client dashboard. Use Previous Loss Runs to review claim history, send it to a client, holder, or carrier, or download a professional PDF packet when underwriting asks for loss history.",
        keywords: ["claims", "loss runs", "previous loss runs", "send to carrier", "download loss run"],
      },
    ],
  },
  {
    id: "agent-renewals-document-publishing",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Renewals and document publishing",
    duration: "19 min",
    body:
      "How agents work renewal updates, carrier-synced policy changes, renewal document review, and publishing without pushing drafts to clients too early.",
    chapters: [
      {
        id: "renewal-workflow",
        title: "Renewal workflow",
        timestamp: "0:00",
        summary: "Use Renewals to see upcoming work and open the policy before updating documents.",
        transcript:
          "Renewals surface the policies that need attention. Open the policy, review the current term, then use Update for renewal only when a renewal document is ready to become a review draft. Updating does not publish to the client.",
        keywords: ["renewal", "renewals", "update for renewal", "current term", "new term"],
      },
      {
        id: "carrier-sync-review",
        title: "Carrier sync review",
        timestamp: "6:36",
        summary: "Review carrier-synced changes before they update policy records.",
        transcript:
          "Carrier sync records may update policy dates, premiums, coverages, billing, or documents. Review the incoming change from the policy or renewal workflow, compare it to the current record, and approve only the updates that belong in the client file.",
        keywords: ["carrier sync", "policy sync", "carrier records", "renewal update"],
      },
      {
        id: "publish-renewed-documents",
        title: "Publish renewed documents",
        timestamp: "12:12",
        summary: "Review each editable field, save drafts, then publish only when ready.",
        transcript:
          "Ready for review opens the filled renewal document with editable fields. Review the field values, save a draft if needed, and click Publish only when the document is ready for the current client record and future term history.",
        keywords: ["publish", "ready for review", "renewed version", "editable fields", "document publishing"],
      },
    ],
  },
  {
    id: "agent-calendar-activities",
    audience: "agent",
    eyebrow: "How to do it",
    title: "Calendar, due dates, meetings, and daily agenda",
    duration: "14 min",
    body:
      "How agents use the calendar for activity due dates, personal reminders, company reminders, internal meetings, and daily agenda work.",
    chapters: [
      {
        id: "week-calendar",
        title: "Week calendar",
        timestamp: "0:00",
        summary: "The calendar starts in week view and shows work that has time attached to it.",
        transcript:
          "Open Calendar to see the week view first. Personal reminders, company reminders sent to you, activity due dates, internal meetings, and manual calendar events appear in the grid and daily agenda.",
        keywords: ["calendar", "week view", "daily agenda", "activity due date", "company reminder"],
      },
      {
        id: "request-internal-meeting",
        title: "Request internal meeting",
        timestamp: "5:08",
        summary: "Create a meeting request, choose recipients, and wait for acceptance.",
        transcript:
          "Use Request internal meeting when an event needs other staff. Choose recipients, date, time, importance, and reminder timing. Recipients see the request in notifications and calendar; accepted meetings stay on the calendar.",
        keywords: ["meeting", "internal meeting", "recipients", "accept meeting", "set reminder"],
      },
      {
        id: "complete-or-reschedule",
        title: "Complete or reschedule",
        timestamp: "10:30",
        summary: "Mark an event complete with confirmation or reschedule it without deleting history.",
        transcript:
          "Agenda actions are Mark complete and Reschedule. Completing an event uses a confirmation step and crosses it out on the calendar instead of deleting it, so the day still shows what happened.",
        keywords: ["mark complete", "reschedule", "completed event", "cross out", "calendar history"],
      },
    ],
  },
  {
    id: "agent-hr-accounting-training",
    audience: "agent",
    eyebrow: "How to do it",
    title: "HR, timesheets, and training videos",
    duration: "13 min",
    body:
      "How agents submit timesheets, use HR intake, and find the right training video chapter from the portal assistant.",
    chapters: [
      {
        id: "submit-timesheet",
        title: "Submit a timesheet",
        timestamp: "0:00",
        summary: "Use Accounting to submit a clean, timestamped timesheet for your due period.",
        transcript:
          "Open Accounting to see your timesheet due date, period, and status. Enter time by date, label the work clearly, review the total, and submit. Managers see submitted timestamps in their accounting queue.",
        keywords: ["accounting", "timesheet", "submit timesheet", "due date", "time sheet"],
      },
      {
        id: "hr-intake",
        title: "HR intake",
        timestamp: "5:02",
        summary: "Submit a complaint or company suggestion anonymously or with your name attached.",
        transcript:
          "Open HR to submit a coworker complaint or company suggestion. Choose anonymous or named, write a clear description, and submit. Managers receive it in their HR category with status tracking.",
        keywords: ["hr", "complaint", "company suggestion", "anonymous", "named submission"],
      },
      {
        id: "ask-assistant-for-training",
        title: "Ask the assistant for training",
        timestamp: "9:12",
        summary: "Ask a portal question and the assistant links to the exact training chapter.",
        transcript:
          "Use Ask AI to ask a specific portal question, such as how to send selected PDFs or how to fill the quoting questionnaire. The assistant explains the answer and links directly to the exact training video chapter.",
        keywords: ["portal assistant", "ask ai", "training link", "exact chapter", "training videos"],
      },
    ],
  },
];

export const MANAGER_HOW_TO_VIDEOS: PortalVideo[] = [
  ...categoryWalkthroughVideos("manager"),
  {
    id: "manager-complete-demo-walkthrough",
    audience: "manager",
    eyebrow: "Start here",
    title: "Complete Quotex software walkthrough",
    duration: "4 min",
    body:
      "A full narrated demo-mode tour of the manager workspace, from dashboard rhythm through routing, clients, policies, documents, billing, claims, renewals, marketing, calendar, accounting, analytics, and training.",
    chapters: [
      {
        id: "manager-command-center",
        title: "Manager command center",
        timestamp: "0:00",
        summary: "Start from the dashboard and read the agency work queues.",
        transcript:
          "This walkthrough starts on the manager dashboard. Managers use reminders, notifications, prospect queue, remarks, and Activity Center visibility to understand what needs attention without taking ownership of every activity.",
        keywords: ["complete walkthrough", "manager dashboard", "demo mode", "activity center", "routing"],
      },
      {
        id: "manager-client-policy-service",
        title: "Client and policy oversight",
        timestamp: "1:04",
        summary: "Review clients, policies, billing, claims, documents, renewals, and carrier-synced updates.",
        transcript:
          "The middle of the walkthrough teaches manager oversight across the client record: policy rows, billing rows, claims and loss runs, document templates, e-sign rules, renewal review, carrier-synced updates, and holder communication.",
        keywords: ["client dashboard", "policy", "billing", "claims", "documents", "renewals", "carrier sync"],
      },
      {
        id: "manager-growth-and-reporting",
        title: "Growth, reporting, and staff operations",
        timestamp: "2:32",
        summary: "See AI quoting, AI marketing, calendar, accounting, analytics, HR, and training.",
        transcript:
          "The final section covers AI quoting, AI marketing, calendar work, accounting timesheet configuration, analytics, HR submissions, and training so managers see how the agency operating system stays consistent.",
        keywords: ["ai quoting", "marketing", "calendar", "accounting", "analytics", "hr", "training"],
      },
    ],
  },
  {
    id: "manager-dashboard-rhythm",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Manager dashboard and team operating rhythm",
    duration: "17 min",
    body:
      "How managers read the dashboard, monitor agency-wide work, and separate team visibility from personal activity ownership.",
    chapters: [
      {
        id: "dashboard-cards",
        title: "Dashboard cards",
        timestamp: "0:00",
        summary: "Use dashboard cards for quick views before opening full categories.",
        transcript:
          "Manager dashboard cards summarize active clients, bound policies, open prospects, renewals, and activity center work. Click a card for a quick view, then open the category or record when action is needed.",
        keywords: ["manager dashboard", "dashboard cards", "quick view", "active clients", "bound policies"],
      },
      {
        id: "team-visibility",
        title: "Team visibility",
        timestamp: "5:26",
        summary: "Managers can see team work without becoming assigned to every activity.",
        transcript:
          "Managers can view agency-wide queues and reporting, but new prospect or client assignment activities should belong to the assigned agent unless the manager takes or reassigns the work.",
        keywords: ["team visibility", "manager view", "assigned agent", "activity ownership"],
      },
      {
        id: "manager-only-queues",
        title: "Manager-only queues",
        timestamp: "11:18",
        summary: "Use manager queues for routing, overrides, analytics, accounting, and HR.",
        transcript:
          "Manager-only work includes routing, resolve overrides, performance goals, accounting review, HR intake, agency settings, carrier management, and staff training standards.",
        keywords: ["manager only", "routing", "override", "analytics", "accounting", "hr"],
      },
    ],
  },
  {
    id: "manager-activity-routing",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Activity Center routing and reassignment",
    duration: "18 min",
    body:
      "How managers route prospects, reassign activity to one or more users, set due dates, and keep the queue clean without duplicating agent alerts.",
    chapters: [
      {
        id: "routing-queue",
        title: "Routing queue",
        timestamp: "0:00",
        summary: "Route unassigned prospects, clients, and activities from the Routing card.",
        transcript:
          "Open Activity Center and start with the Routing card. It shows unrouted prospects, unrouted clients, and activities sent to manager assignment. Use Assign to me or Pick agents to route work.",
        keywords: ["routing card", "routing queue", "unassigned", "assign to me", "pick agents"],
      },
      {
        id: "multi-user-reassignment",
        title: "Multi-user reassignment",
        timestamp: "6:42",
        summary: "Use multi-select reassignment when more than one staff member should co-manage work.",
        transcript:
          "When reassigning, managers can select multiple users where the workflow supports co-management. The first selected user is primary; additional users remain visible as co-managers.",
        keywords: ["reassign", "reassignment", "multiple users", "multi select", "co-manage"],
      },
      {
        id: "due-dates-priority",
        title: "Due dates and priority",
        timestamp: "12:54",
        summary: "Set due dates and importance so activities appear correctly in calendars and queues.",
        transcript:
          "Add due dates to activities that need time discipline. Importance icons show urgency, and due activities appear in the calendar and daily agenda for assigned users.",
        keywords: ["due date", "priority", "importance", "calendar", "daily agenda"],
      },
    ],
  },
  {
    id: "manager-analytics-accounting-hr",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Analytics, goals, accounting, and HR",
    duration: "21 min",
    body:
      "How managers use performance goals, leaderboard metrics, timesheet submissions, HR intake, and manager-only operational reporting.",
    chapters: [
      {
        id: "performance-targets",
        title: "Performance targets",
        timestamp: "0:00",
        summary: "Set goals for premium, new clients, new prospects, activities, policies, or custom metrics.",
        transcript:
          "Open Analytics and use Set a goal. Choose the metric, time period, target amount, and owner. Managers can use Custom AI metric for agency-specific measurements like policies renewed.",
        keywords: ["analytics", "performance target", "set a goal", "custom metric", "leaderboard"],
      },
      {
        id: "timesheet-review",
        title: "Timesheet review",
        timestamp: "7:34",
        summary: "Review submitted timesheets and configure the agency schedule.",
        transcript:
          "Open Accounting to see individual agent submissions, review timestamps, and manage the timesheet schedule. Managers can lock or edit the schedule and choose weekly, bi-weekly, monthly, or custom due timing.",
        keywords: ["accounting", "timesheet", "timesheet schedule", "due date", "agent submissions"],
      },
      {
        id: "hr-submissions",
        title: "HR submissions",
        timestamp: "15:02",
        summary: "Review anonymous or named complaints and suggestions from staff.",
        transcript:
          "Open HR to review coworker complaints and company suggestions. Submissions can be anonymous or named, and managers can update status as new, reviewing, or closed.",
        keywords: ["hr", "complaint", "suggestion", "anonymous", "coworker"],
      },
    ],
  },
  {
    id: "manager-settings-marketing-training",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Agency settings, AI marketing, and training standards",
    duration: "19 min",
    body:
      "How managers tune agency settings, configure AI auto-message behavior, review campaigns, and keep staff operating from the same playbook.",
    chapters: [
      {
        id: "agency-settings",
        title: "Agency settings",
        timestamp: "0:00",
        summary: "Use locking mechanisms before editing tier, signatures, templates, or agency settings.",
        transcript:
          "Agency settings use locked cards so managers do not accidentally change production-like configuration. Unlock only the section you intend to edit, save it, then lock it again.",
        keywords: ["agency settings", "lock", "unlock", "edit settings", "tier"],
      },
      {
        id: "ai-marketing-controls",
        title: "AI marketing controls",
        timestamp: "6:20",
        summary: "Configure auto-message rules, campaigns, audience filters, and Agency setup branding on pamphlets.",
        transcript:
          "AI marketing lets managers compose campaigns, preview pamphlets, configure simple auto-message rules, and review active campaigns before pausing or deleting them. Pamphlets automatically use the agency name, website, contact details, and logo saved in Agency setup.",
        keywords: ["ai marketing", "campaign", "auto-message", "pamphlet", "agency logo"],
      },
      {
        id: "staff-training-standards",
        title: "Staff training standards",
        timestamp: "13:30",
        summary: "Use Training videos to keep agents and managers following the same operating playbook.",
        transcript:
          "Training videos are in the employee sidebar under Archive. Agents see agent workflow training, while managers see manager workflow training. Use the assistant to jump to exact chapters.",
        keywords: ["training videos", "staff training", "how to do it", "agent training", "manager training"],
      },
    ],
  },
  {
    id: "manager-documents-renewals-downloads",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Documents, renewals, and carrier sync",
    duration: "23 min",
    body:
      "How managers control the agency document library, review downloaded carrier changes, and publish renewal documents only after review.",
    chapters: [
      {
        id: "template-library",
        title: "Template library",
        timestamp: "0:00",
        summary: "Use Document review as a template library with line labels and e-sign requirements.",
        transcript:
          "The agency document library stores templates, not a history of every filled client document. Each template is labeled for personal lines, commercial lines, or both, and can require customer signature, agent signature, both, or no e-signature.",
        keywords: ["document library", "template library", "personal lines", "commercial lines", "e-signature"],
      },
      {
        id: "carrier-sync-governance",
        title: "Carrier sync governance",
        timestamp: "8:06",
        summary: "Carrier-synced changes should be reviewed before they update client-facing records.",
        transcript:
          "Carrier sync brings in policy, billing, premium, date, and document updates from carrier systems. Managers review the incoming record, approve valid fields, reject bad data, and keep an audit trail before the client dashboard changes.",
        keywords: [
          "carrier sync",
          "carrier sync before updating policy",
          "audit trail",
          "approve fields",
          "policy update",
        ],
      },
      {
        id: "renewal-publish-control",
        title: "Renewal publish control",
        timestamp: "16:28",
        summary: "Ready-for-review drafts must be manually checked before Publish.",
        transcript:
          "Update for renewal creates a review draft. Ready for review opens the editable document. Published dates remain visible after publication, and old term documents move to previous documents only when the renewal version is complete.",
        keywords: ["ready for review", "publish", "previous documents", "renewed version", "renewal documents"],
      },
    ],
  },
  {
    id: "manager-calendar-staff-operations",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Calendar, staff meetings, and daily operating control",
    duration: "17 min",
    body:
      "How managers use calendar visibility, meeting requests, due dates, importance, reminders, and completed-event history to keep work moving.",
    chapters: [
      {
        id: "team-calendar-signals",
        title: "Team calendar signals",
        timestamp: "0:00",
        summary: "Use the calendar to see timed work without replacing the Activity Center.",
        transcript:
          "Calendar shows reminders, company reminders, activity due dates, accepted internal meetings, and manual events. Activity Center remains the work queue; Calendar shows when that work is due.",
        keywords: ["calendar", "activity due dates", "company reminders", "team calendar", "agenda"],
      },
      {
        id: "meeting-requests",
        title: "Meeting requests",
        timestamp: "6:04",
        summary: "Request internal meetings and let recipients accept them into their calendars.",
        transcript:
          "Create an internal meeting, choose personal event or recipients, set importance, select reminder timing, and send. Recipients receive a notification and can accept; accepted events appear on their calendars.",
        keywords: ["request meeting", "internal meeting", "recipients", "accept", "meeting notification"],
      },
      {
        id: "complete-not-delete",
        title: "Complete, do not delete",
        timestamp: "12:22",
        summary: "Completed events stay visible as crossed-out history.",
        transcript:
          "Managers should mark calendar events complete after confirmation instead of deleting them. Completed events are crossed out, preserving the history of what was scheduled and handled.",
        keywords: ["complete event", "mark complete", "crossed out", "reschedule", "calendar history"],
      },
    ],
  },
  {
    id: "manager-billing-claims-lossruns",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Billing visibility, claims, and loss runs",
    duration: "18 min",
    body:
      "How managers inspect carrier-paid billing information, monitor claims, and use previous loss runs for underwriting support.",
    chapters: [
      {
        id: "billing-by-policy",
        title: "Billing by policy",
        timestamp: "0:00",
        summary: "Billing rows are one row per policy, labeled by policy number.",
        transcript:
          "Open Billing to see each client policy as its own row. Policy number is visible because one client can have multiple policies. Open a row for carrier billing path, next due date, plan, history, and premium-change context.",
        keywords: ["billing", "policy number", "one row per policy", "payment plan", "next due"],
      },
      {
        id: "billing-summary-to-client",
        title: "Billing summary to client",
        timestamp: "6:14",
        summary: "Send a billing summary from the billing summary card without collecting payment.",
        transcript:
          "The Send to client button on Billing summary drafts an informational message that includes payment path, method, plan, premium, next due, and history context. It does not collect payment or store card details.",
        keywords: ["send billing summary", "send to client", "billing summary", "payment path", "no payment collection"],
      },
      {
        id: "loss-run-packets",
        title: "Loss-run packets",
        timestamp: "12:02",
        summary: "Generate and send professional previous loss-run packets when needed.",
        transcript:
          "Use Previous Loss Runs from the Claims card to review all claim history, download a clean PDF, or send the packet to a client, holder, or carrier when underwriting asks for loss history.",
        keywords: ["loss runs", "previous loss runs", "claims", "download pdf", "send to carrier"],
      },
    ],
  },
  {
    id: "manager-staff-plan-training",
    audience: "manager",
    eyebrow: "How to do it",
    title: "Staff access, plan controls, and training adoption",
    duration: "16 min",
    body:
      "How managers understand staff access, user-slot pricing, plan changes, and using training plus the assistant to standardize agency workflows.",
    chapters: [
      {
        id: "staff-user-access",
        title: "Staff user access",
        timestamp: "0:00",
        summary: "Staff sign in with agency code, business email, phone, first name, last name, and password.",
        transcript:
          "New staff use the agency code issued from the master portal, then create their own sign-in with business email, phone, first and last name, and password. User slots control how many staff can join the agency.",
        keywords: ["user access", "agency code", "business email", "password", "user slots"],
      },
      {
        id: "plan-and-slots",
        title: "Plan and slots",
        timestamp: "5:24",
        summary: "Use the locked tier card to edit user slots, carriers, and AI allowances.",
        transcript:
          "Agency Settings has a locked tier card. Unlock it to request more user slots, carriers, or AI message allowances. Each added user slot updates monthly pricing based on the $300 per-user model.",
        keywords: ["tier card", "plan", "add users", "user slots", "monthly price", "ai messages"],
      },
      {
        id: "training-adoption",
        title: "Training adoption",
        timestamp: "11:08",
        summary: "Use role-specific training and assistant section links to keep staff consistent.",
        transcript:
          "Managers should direct staff to Training videos under Archive and ask the portal assistant for exact chapters. The assistant knows each training module, chapter, timestamp, and workflow so answers stay linked to the right how-to.",
        keywords: ["training adoption", "training videos", "portal assistant", "exact chapter", "manager training"],
      },
    ],
  },
];

export function videosForRole(role?: Role | "agent" | "manager"): PortalVideo[] {
  return role === "manager" ? MANAGER_HOW_TO_VIDEOS : AGENT_HOW_TO_VIDEOS;
}

export function videoChapterPath(
  videoId: string,
  chapterId?: string,
  options: { autoplay?: boolean } = {}
): string {
  const params = new URLSearchParams({ video: videoId });
  if (chapterId) {
    params.set("chapter", chapterId);
    params.set("section", chapterId);
  }
  if (options.autoplay) params.set("autoplay", "1");
  return `/employee/training?${params.toString()}`;
}

export function findVideoChapter(
  question: string,
  role?: Role | "agent" | "manager"
): { video: PortalVideo; chapter: VideoChapter; score: number } | null {
  const q = normalize(question);
  if (!q) return null;
  const tokens = q
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TRAINING_STOPWORDS.has(token));
  let best: { video: PortalVideo; chapter: VideoChapter; score: number } | null = null;
  for (const video of videosForRole(role)) {
    for (const chapter of video.chapters) {
      const haystack = normalize(
        [video.title, video.body, chapter.title, chapter.summary, chapter.transcript, ...chapter.keywords].join(" ")
      );
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 1;
      }
      for (const keyword of chapter.keywords) {
        if (q.includes(normalize(keyword))) score += keyword.includes(" ") ? 4 : 2;
      }
      if (!best || score > best.score) best = { video, chapter, score };
    }
  }
  return best && best.score >= 2 ? best : null;
}

const TRAINING_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "you",
  "your",
  "how",
  "what",
  "where",
  "when",
  "why",
  "who",
  "does",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
  "after",
  "before",
  "there",
  "their",
  "them",
  "can",
  "need",
  "use",
  "using",
  "open",
  "show",
  "shows",
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}
