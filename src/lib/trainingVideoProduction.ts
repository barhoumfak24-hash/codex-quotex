import {
  AGENT_HOW_TO_VIDEOS,
  MANAGER_HOW_TO_VIDEOS,
  PUBLIC_WHAT_IT_DOES_VIDEOS,
  type PortalVideo,
} from "@/lib/trainingVideos";

export interface PhotoAlbumProductionFrame {
  title: string;
  annotation: string;
  focus: string;
  snippet: string;
  chips: string[];
}

export interface PhotoAlbumProductionBrief {
  id: "software" | "website" | "app";
  label: string;
  title: string;
  body: string;
  frames: PhotoAlbumProductionFrame[];
}

export const PHOTO_ALBUM_PRODUCTION_BRIEFS: PhotoAlbumProductionBrief[] = [
  {
    id: "software",
    label: "Software photo album",
    title: "Agency operating system",
    body: "Staff workspace examples managers and agents use to quote, service, and follow up.",
    frames: [
      {
        title: "Manager dashboard",
        annotation: "Work queues, reminders, activity, goals, and performance stay visible.",
        focus: "Operations command center",
        snippet: "software-dashboard",
        chips: ["Dashboard", "Activity", "Goals"],
      },
      {
        title: "Client record",
        annotation: "Policies, billing, claims, documents, holders, and remarks live together.",
        focus: "One client file",
        snippet: "software-client",
        chips: ["Policies", "Billing", "Claims"],
      },
      {
        title: "AI quoting",
        annotation: "Intake, missing fields, carrier fit, and quote ranking connect to the record.",
        focus: "Structured quoting",
        snippet: "software-quoting",
        chips: ["AI intake", "Carrier fit", "Ranking"],
      },
      {
        title: "Policies detail",
        annotation: "Policy overview, coverage, documents, holders, and timeline stay tied to the policy number.",
        focus: "Policy servicing",
        snippet: "software-policy",
        chips: ["Policy #", "Documents", "Holders"],
      },
      {
        title: "Billing visibility",
        annotation: "Agents see how the client pays the carrier, payment history, due dates, and plan changes.",
        focus: "Carrier billing view",
        snippet: "software-billing",
        chips: ["Premium", "Payment plan", "History"],
      },
      {
        title: "Claims and loss runs",
        annotation: "Open claims, previous loss runs, and carrier-facing claim paths stay accessible from the client file.",
        focus: "Claims service",
        snippet: "software-claims",
        chips: ["Loss runs", "Carrier", "Claim status"],
      },
      {
        title: "AI marketing",
        annotation: "Campaign drafts, branded pamphlets, audience sorting, and active campaign history live together.",
        focus: "Campaign studio",
        snippet: "software-marketing",
        chips: ["Pamphlet", "Audience", "Campaigns"],
      },
      {
        title: "Calendar",
        annotation: "Personal reminders, company reminders, due activities, meetings, and agenda items share one calendar.",
        focus: "Daily schedule",
        snippet: "software-calendar",
        chips: ["Week view", "Meetings", "Due dates"],
      },
    ],
  },
  {
    id: "website",
    label: "Website photo album",
    title: "Branded agency website",
    body: "Public-facing website examples that capture prospects and route portal traffic.",
    frames: [
      {
        title: "Agency home",
        annotation: "A polished front door explains the agency and starts the right conversion path.",
        focus: "Premium first impression",
        snippet: "website-home",
        chips: ["Brand", "Trust", "CTA"],
      },
      {
        title: "Quote start",
        annotation: "Prospects begin intake from the website and land in the agency software.",
        focus: "Connected intake",
        snippet: "website-quote",
        chips: ["Prospects", "Quote flow", "Routing"],
      },
      {
        title: "Client portal entry",
        annotation: "Clients sign in from the website to view documents, policies, and updates.",
        focus: "Portal handoff",
        snippet: "website-portal",
        chips: ["Client portal", "Documents", "Status"],
      },
      {
        title: "Services page",
        annotation: "The template explains personal, commercial, specialty, and advisory services cleanly.",
        focus: "Service lines",
        snippet: "website-services",
        chips: ["Personal", "Commercial", "Specialty"],
      },
      {
        title: "Private client page",
        annotation: "High-net-worth positioning gives prospects confidence before they start intake.",
        focus: "Luxury positioning",
        snippet: "website-private-client",
        chips: ["Assets", "Lifestyle", "Advisory"],
      },
      {
        title: "Contact page",
        annotation: "Prospects and clients can reach the agency or start the correct portal workflow.",
        focus: "Conversion path",
        snippet: "website-contact",
        chips: ["Contact", "Routing", "Portal"],
      },
      {
        title: "Plan selection",
        annotation: "Agencies can choose software seats, a separate website, and Quotex app activation from the monthly plan builder.",
        focus: "Sales checkout",
        snippet: "website-checkout",
        chips: ["Users", "Add-ons", "Discount"],
      },
    ],
  },
  {
    id: "app",
    label: "App photo album",
    title: "Universal Quotex client app",
    body: "Mobile experience examples clients use for quick access and agency communication.",
    frames: [
      {
        title: "Mobile home",
        annotation: "Clients see their policy, claim, renewal, and document shortcuts quickly.",
        focus: "Agency on the phone",
        snippet: "app-home",
        chips: ["Policies", "Claims", "Docs"],
      },
      {
        title: "Document access",
        annotation: "Declarations, proof of insurance, and shared files are easy to find.",
        focus: "Less back-and-forth",
        snippet: "app-documents",
        chips: ["Dec pages", "POI", "Forms"],
      },
      {
        title: "Service updates",
        annotation: "Claim, renewal, and message status keeps the client informed between calls.",
        focus: "Retention touchpoint",
        snippet: "app-updates",
        chips: ["Messages", "Renewals", "Updates"],
      },
      {
        title: "Policy view",
        annotation: "Clients can see core policy details, coverage, documents, and carrier guidance.",
        focus: "Policy access",
        snippet: "app-policy",
        chips: ["Policy", "Coverage", "Carrier"],
      },
      {
        title: "Billing view",
        annotation: "Billing summaries show carrier payment path and next due information without collecting payments.",
        focus: "Payment visibility",
        snippet: "app-billing",
        chips: ["Next due", "Plan", "Carrier bill"],
      },
      {
        title: "Quote flow",
        annotation: "Mobile quote start captures clean intake and routes the request into the agency software.",
        focus: "Mobile intake",
        snippet: "app-quote",
        chips: ["Quote", "Questions", "Submit"],
      },
      {
        title: "Message center",
        annotation: "Client communication stays connected to their advisor and the exact policy work underway.",
        focus: "Client communication",
        snippet: "app-messages",
        chips: ["Advisor", "Thread", "Updates"],
      },
    ],
  },
];

export function allTrainingProductionVideos(): PortalVideo[] {
  return [...PUBLIC_WHAT_IT_DOES_VIDEOS, ...AGENT_HOW_TO_VIDEOS, ...MANAGER_HOW_TO_VIDEOS];
}

export function productionBriefForVideo(video: PortalVideo): string {
  const audience =
    video.audience === "public"
      ? "public marketing review"
      : video.audience === "manager"
        ? "manager portal training"
        : "agent portal training";

  return [
    `# ${video.title}`,
    "",
    `Audience: ${audience}`,
    `Length target: ${video.duration}`,
    `Purpose: ${video.body}`,
    "",
    "## Production Direction",
    "- Create a real instructional video, not a placeholder animation.",
    "- Use Quotex Insurance branding: black, white, gold, crisp luxury SaaS style.",
    "- Use realistic screen-recording style scenes based on the described software, demo website, and demo phone app.",
    "- Use a calm, premium, non-annoying narrator. Avoid hype, cartoons, stock-office filler, and generic insurance imagery.",
    "- Include clean captions/subtitles and export an SRT/VTT file.",
    "- Match the exact chapter structure below so the portal can deep-link into each section.",
    "",
    "## Chapters",
    ...video.chapters.flatMap((chapter) => [
      `### ${chapter.timestamp} - ${chapter.title}`,
      `Summary: ${chapter.summary}`,
      `Narration: ${chapter.transcript}`,
      `Visual direction: Show the relevant Quotex screen or mobile/website scene, highlight the controls being described, and keep the cursor movement deliberate.`,
      `Keywords for the portal assistant: ${chapter.keywords.join(", ")}`,
      "",
    ]),
    "## Required Deliverables",
    `- ${video.id}.mp4, 1920x1080, H.264, web optimized.`,
    `- ${video.id}.vtt or .srt subtitles with the chapter timestamps above.`,
    `- ${video.id}-thumbnail.png, branded and legible at card size.`,
    "- Final hosted URL that can be pasted into the Quotex master portal training source slot.",
  ].join("\n");
}

export function productionBriefForPhotoAlbums(albums: PhotoAlbumProductionBrief[] = PHOTO_ALBUM_PRODUCTION_BRIEFS): string {
  return [
    "# Quotex Public Photo Album Production Brief",
    "",
    "Create compact photo-album/image sets from real-looking product screenshots or screenshot-style recreations. These are not generic stock photos. They must look like the actual Quotex software, separate agency website template, and universal Quotex client app.",
    "",
    "Global style: luxury SaaS, black/white/gold, clean spacing, sharp typography, realistic UI screens, no fake feature names beyond the provided list.",
    "",
    ...albums.flatMap((album) => [
      `## ${album.label}: ${album.title}`,
      album.body,
      "",
      ...album.frames.flatMap((frame, index) => [
        `### Frame ${index + 1}: ${frame.title}`,
        `Focus: ${frame.focus}`,
        `Annotation: ${frame.annotation}`,
        `Snippet key: ${frame.snippet}`,
        `Visible chips: ${frame.chips.join(", ")}`,
        "Output: high-resolution PNG and web-optimized JPG, with annotation text available separately so the website can render it accessibly.",
        "",
      ]),
    ]),
  ].join("\n");
}

export function fullVideoProductionBrief(videos: PortalVideo[] = allTrainingProductionVideos()): string {
  const publicVideos = videos.filter((video) => video.audience === "public");
  const agentVideos = videos.filter((video) => video.audience === "agent");
  const managerVideos = videos.filter((video) => video.audience === "manager");

  return [
    "# Quotex Insurance AI Video Production Package",
    "",
    "Use this package in a professional AI video system or with a human editor. The goal is to produce real public preview, agent training, manager training, and photo-album assets for the Quotex Insurance demo.",
    "",
    "Important: do not invent workflows. Build only from the scripts below. The videos should feel like a polished software professor walking through a premium private-client insurance agency platform.",
    "",
    "## Global Requirements",
    "- Public review videos explain what the software, website, and app do.",
    "- Agent videos teach agent-side execution.",
    "- Manager videos teach manager-side operations.",
    "- Photo albums show real-looking snippets of the software, website template, and phone app.",
    "- Narration must be realistic, clear, confident, and not robotic.",
    "- Captions/subtitles are required.",
    "- Export each video separately and provide hosted URLs for the master portal.",
    "- Use exact chapter timestamps and titles wherever possible.",
    "",
    `## Public Review Videos (${publicVideos.length})`,
    ...publicVideos.flatMap((video) => [productionBriefForVideo(video), ""]),
    `## Agent Training Videos (${agentVideos.length})`,
    ...agentVideos.flatMap((video) => [productionBriefForVideo(video), ""]),
    `## Manager Training Videos (${managerVideos.length})`,
    ...managerVideos.flatMap((video) => [productionBriefForVideo(video), ""]),
    productionBriefForPhotoAlbums(),
  ].join("\n");
}
