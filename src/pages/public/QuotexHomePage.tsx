import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  ChevronDown,
  CheckCircle2,
  Globe2,
  LogIn,
  MessagesSquare,
  MonitorPlay,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Smartphone,
  X,
} from "lucide-react";
import { QuotexMark } from "@/components/layout/Logo";
import { QuotexSiteFooter } from "@/components/layout/QuotexSiteFooter";
import { api } from "@/lib/api";
import { PUBLIC_WHAT_IT_DOES_VIDEOS } from "@/lib/trainingVideos";

const WORKFLOWS = [
  {
    icon: <Bot className="h-5 w-5" />,
    title: "Quote with intelligence",
    body: "Turn client details into structured intake, questionnaires, carrier fit, and ranked options for licensed review.",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Run the agency",
    body: "Manage prospects, clients, policies, claims, billing visibility, documents, calendars, and team activity from one workspace.",
  },
  {
    icon: <MessagesSquare className="h-5 w-5" />,
    title: "Stay connected",
    body: "Keep client, prospect, holder, and carrier communication attached to the exact work it belongs to.",
  },
];

type DemoLeadForm = {
  firstName: string;
  lastName: string;
  businessEmail: string;
  agencyName: string;
  role: string;
  staffSize: string;
  phone: string;
  interest: string;
  notes: string;
  marketingOptIn: boolean;
};

const EMPTY_DEMO_LEAD_FORM: DemoLeadForm = {
  firstName: "",
  lastName: "",
  businessEmail: "",
  agencyName: "",
  role: "",
  staffSize: "",
  phone: "",
  interest: "Full Quotex walkthrough",
  notes: "",
  marketingOptIn: true,
};

const EXAMPLE_ALBUMS = [
  {
    id: "software",
    icon: <MonitorPlay className="h-5 w-5" />,
    eyebrow: "Software",
    title: "Agency operating system",
    body:
      "Examples of the staff workspace managers and agents use to quote, service, and follow up.",
    frames: [
      {
        title: "Manager dashboard",
        annotation: "Work queues, reminders, activity, goals, and performance stay visible.",
        focus: "Operations command center",
        snippet: "software-dashboard",
        image: "/quotex-software-screens/dashboard.png",
        chips: ["Dashboard", "Activity", "Goals"],
      },
      {
        title: "Client record",
        annotation: "Policies, billing, claims, documents, holders, and remarks live together.",
        focus: "One client file",
        snippet: "software-client",
        image: "/quotex-software-screens/client-record.png",
        chips: ["Policies", "Billing", "Claims"],
      },
      {
        title: "AI quoting",
        annotation: "Intake, missing fields, carrier fit, and quote ranking connect to the record.",
        focus: "Structured quoting",
        snippet: "software-quoting",
        image: "/quotex-software-screens/ai-quoting.png",
        chips: ["AI intake", "Carrier fit", "Ranking"],
      },
      {
        title: "Policies detail",
        annotation: "Policy overview, coverage, documents, holders, and timeline stay tied to the policy number.",
        focus: "Policy servicing",
        snippet: "software-policy",
        image: "/quotex-software-screens/policy-detail.png",
        chips: ["Policy #", "Documents", "Holders"],
      },
      {
        title: "Billing visibility",
        annotation: "Agents see how the client pays the carrier, payment history, due dates, and plan changes.",
        focus: "Carrier billing view",
        snippet: "software-billing",
        image: "/quotex-software-screens/billing-detail.png",
        chips: ["Premium", "Payment plan", "History"],
      },
      {
        title: "Claims and loss runs",
        annotation: "Open claims, previous loss runs, and carrier-facing claim paths stay accessible from the client file.",
        focus: "Claims service",
        snippet: "software-claims",
        image: "/quotex-software-screens/claims.png",
        chips: ["Loss runs", "Carrier", "Claim status"],
      },
      {
        title: "AI marketing",
        annotation: "Campaign drafts, branded pamphlets, audience sorting, and active campaign history live together.",
        focus: "Campaign studio",
        snippet: "software-marketing",
        image: "/quotex-software-screens/marketing.png",
        chips: ["Pamphlet", "Audience", "Campaigns"],
      },
      {
        title: "Calendar",
        annotation: "Personal reminders, company reminders, due activities, meetings, and agenda items share one calendar.",
        focus: "Daily schedule",
        snippet: "software-calendar",
        image: "/quotex-software-screens/calendar.png",
        chips: ["Week view", "Meetings", "Due dates"],
      },
    ],
  },
  {
    id: "website",
    icon: <Globe2 className="h-5 w-5" />,
    eyebrow: "Website template",
    title: "Branded agency website",
    body:
      "Examples of the public-facing website that captures prospects and routes portal traffic.",
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
    icon: <Smartphone className="h-5 w-5" />,
    eyebrow: "Quotex app",
    title: "Universal Quotex client app",
    body:
      "Examples of the shared mobile experience where clients choose their agency at sign-in.",
    frames: [
      {
        title: "Mobile home",
        annotation: "Clients select their agency, then see policy, claim, renewal, and document shortcuts quickly.",
        focus: "Quotex on the phone",
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

export function QuotexHomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [activePreviewChapterIndex, setActivePreviewChapterIndex] = useState(0);
  const [activePreviewProgress, setActivePreviewProgress] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [demoLeadOpen, setDemoLeadOpen] = useState(false);
  const [demoLeadSubmitted, setDemoLeadSubmitted] = useState(false);
  const [demoLeadForm, setDemoLeadForm] = useState<DemoLeadForm>(EMPTY_DEMO_LEAD_FORM);
  const activeVideo = PUBLIC_WHAT_IT_DOES_VIDEOS.find((video) => video.id === activeVideoId);
  const activePreviewChapter = activeVideo?.chapters[activePreviewChapterIndex] ?? activeVideo?.chapters[0];
  const activeAlbum = EXAMPLE_ALBUMS.find((album) => album.id === activeAlbumId);
  const activePreviewDuration = activeVideo ? publicPreviewDurationSeconds(activeVideo.duration) : 0;
  const activePreviewElapsed = Math.round(activePreviewProgress * activePreviewDuration);
  const previewEnded = activePreviewProgress >= 1;

  useEffect(() => {
    setActivePreviewChapterIndex(0);
    setActivePreviewProgress(0);
  }, [activeVideoId]);

  useEffect(() => {
    const requestedPreview = searchParams.get("preview");
    if (!requestedPreview) return;
    const exists = PUBLIC_WHAT_IT_DOES_VIDEOS.some((video) => video.id === requestedPreview);
    if (!exists) return;
    const requestedVideo = PUBLIC_WHAT_IT_DOES_VIDEOS.find((video) => video.id === requestedPreview);
    setDemoLeadForm((current) => ({
      ...current,
      interest: `${requestedVideo ? publicPreviewLabel(requestedVideo.id) : "Quotex"} walkthrough`,
    }));
    setDemoLeadSubmitted(false);
    setDemoLeadOpen(true);
    setSearchParams({});
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!demoLeadOpen || typeof document === "undefined") return undefined;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - html.clientWidth;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.paddingRight = previousBodyPaddingRight;
    };
  }, [demoLeadOpen]);

  useEffect(() => {
    if (!activeVideo || !previewPlaying) return;
    const timer = window.setInterval(() => {
      setActivePreviewProgress((current) => Math.min(1, current + 0.12 / activePreviewDuration));
    }, 120);
    return () => window.clearInterval(timer);
  }, [activePreviewDuration, activeVideo, previewPlaying]);

  useEffect(() => {
    if (!activeVideo) return;
    const chapterCount = Math.max(activeVideo.chapters.length, 1);
    const nextIndex = Math.min(chapterCount - 1, Math.floor(activePreviewProgress * chapterCount));
    setActivePreviewChapterIndex(nextIndex);
    if (activePreviewProgress >= 1) setPreviewPlaying(false);
  }, [activePreviewProgress, activeVideo]);

  function openPublicPreview(videoId: string, updateUrl = false) {
    if (updateUrl) setSearchParams({});
    openDemoLead(`${publicPreviewLabel(videoId)} walkthrough`);
  }

  function resolveDemoTarget(interest: string): { kind: "album" | "video"; id: string } {
    const clean = interest.trim().toLowerCase();
    if (clean.includes("website")) return { kind: "video", id: "what-website-does" };
    if (clean.includes("app")) return { kind: "video", id: "what-app-does" };
    return { kind: "album", id: "software" };
  }

  function closePublicPreview() {
    setActiveVideoId(null);
    setPreviewPlaying(false);
    if (searchParams.has("preview")) setSearchParams({});
  }

  function togglePublicPreview() {
    if (previewEnded) {
      setActivePreviewChapterIndex(0);
      setActivePreviewProgress(0);
      setPreviewPlaying(true);
      return;
    }
    setPreviewPlaying((value) => !value);
  }

  function openDemoLead(interest = "Full Quotex walkthrough") {
    setDemoLeadForm((current) => ({ ...current, interest }));
    setDemoLeadSubmitted(false);
    setDemoLeadOpen(true);
  }

  function closeDemoLead() {
    setDemoLeadOpen(false);
  }

  function setDemoLeadField<K extends keyof DemoLeadForm>(key: K, value: DemoLeadForm[K]) {
    setDemoLeadForm((current) => ({ ...current, [key]: value }));
  }

  function submitDemoLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const interest = demoLeadForm.interest.trim() || "Full Quotex walkthrough";
    api.demoLeads.create({
      firstName: demoLeadForm.firstName.trim(),
      lastName: demoLeadForm.lastName.trim(),
      businessEmail: demoLeadForm.businessEmail.trim(),
      agencyName: demoLeadForm.agencyName.trim(),
      role: demoLeadForm.role.trim(),
      staffSize: demoLeadForm.staffSize.trim(),
      phone: demoLeadForm.phone.trim() || undefined,
      interest,
      notes: demoLeadForm.notes.trim() || undefined,
      marketingOptIn: demoLeadForm.marketingOptIn,
      source: "walkthrough_request",
    });
    const target = resolveDemoTarget(interest);
    setDemoLeadOpen(false);
    setDemoLeadSubmitted(false);
    if (target.kind === "video") {
      setActiveAlbumId(null);
      setActiveVideoId(target.id);
      setActivePreviewChapterIndex(0);
      setActivePreviewProgress(0);
      setPreviewPlaying(false);
    } else {
      setActiveVideoId(null);
      setActiveAlbumId(target.id);
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      <section className="relative overflow-hidden pb-14">
        <img
          src="/quotex-home-hero.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-55 grayscale"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(255,255,255,0.16),transparent_22%),linear-gradient(90deg,rgba(3,3,3,0.98)_0%,rgba(6,6,5,0.90)_43%,rgba(9,9,8,0.52)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,#0d0c09_0%,rgba(13,12,9,0)_100%)]" />

        <header className="relative z-10 mx-auto flex max-w-[92rem] items-center justify-between px-5 py-5 md:px-8">
          <Link to="/" className="flex items-center gap-3">
            <QuotexMark
              className="h-10 w-10 ring-1 ring-white/15"
              letterClassName="text-[28px]"
            />
            <span>
              <span className="block font-display text-xl leading-none text-white">
                Quotex Insurance
              </span>
              <span className="mt-1.5 block text-[11px] font-medium leading-none text-white/45">
                Agency operating system
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-semibold text-white/78 lg:flex">
            <Link to="/checkout" className="transition hover:text-white">
              Pricing
            </Link>
            <Link to="/contact" className="transition hover:text-white">
              Contact
            </Link>
            <Link to="/support" className="transition hover:text-white">
              Support
            </Link>
          </nav>

          <nav className="flex items-center gap-3">
            <Link
              to="/employee/login"
              className="btn h-11 border-white/30 bg-white/[0.06] px-4 text-white hover:bg-white/[0.12]"
            >
              <LogIn className="h-4 w-4" />
              Login
              <ChevronDown className="h-3.5 w-3.5 text-white/55" />
            </Link>
            <button
              type="button"
              className="btn h-11 min-w-[7.5rem] border-white bg-white px-5 !text-black hover:bg-white/90"
              onClick={() => openDemoLead("Full Quotex platform walkthrough")}
            >
              View demo
            </button>
          </nav>
        </header>

        <main className="relative z-10 mx-auto max-w-[92rem] px-5 pb-10 pt-14 md:px-8 md:pt-22">
          <div className="max-w-5xl">
            <div className="text-sm font-semibold text-white/82">Platform</div>
            <h1 className="mt-7 max-w-4xl font-display text-5xl leading-[0.94] tracking-tight text-white md:text-6xl lg:text-[5.4rem]">
              AI insurance operations for high-touch agencies.
            </h1>
            <p className="mt-7 max-w-3xl text-xl leading-relaxed text-white/72 md:text-2xl">
              Quote, service, renew, bill, document, and communicate from one private-client
              operating system built for agencies that cannot afford scattered work.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link to="/checkout" className="btn-gold h-12 px-6 text-base">
                Build my plan
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>
        </main>
      </section>

      <section className="bg-ink-900 px-5 pb-14 md:px-8">
        <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-3">
          {WORKFLOWS.map((workflow) => (
            <article
              key={workflow.title}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-gold-300/30 bg-gold-300/10 text-gold-200">
                {workflow.icon}
              </div>
              <h2 className="mt-5 text-2xl text-white">{workflow.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-white/64">{workflow.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-[#0d0c09] px-5 pb-18 md:px-8">
        <div className="mx-auto max-w-7xl border-t border-white/10 py-16">
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="font-display text-4xl leading-tight text-white md:text-5xl">
                What Quotex does.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/62">
                Each demo starts after a short lead gate so your team captures qualified agencies
                before opening the right product view.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {PUBLIC_WHAT_IT_DOES_VIDEOS.map((video) => (
              <article
                key={video.id}
                className="flex overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] shadow-[0_18px_50px_rgba(0,0,0,0.24)] flex-col"
              >
                <div className="w-full">
                  <div className="relative aspect-video overflow-hidden bg-black">
                    {publicAlbumId(video.id) === "software" ? (
                      <img
                        src="/quotex-software-screens/dashboard.png"
                        alt=""
                        aria-hidden="true"
                        className="h-full w-full object-cover object-top"
                        loading="lazy"
                      />
                    ) : (
                      <ProductSnippet snippet={publicVideoSnippet(video.id, 0)} />
                    )}
                    <div className="absolute inset-0 bg-black/45" />
                    <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/78 backdrop-blur">
                      <span className="text-gold-200">{publicVideoIcon(video.id)}</span>
                      {publicPreviewLabel(video.id)}
                    </div>
                    <span className="absolute bottom-3 right-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                      {publicAlbumId(video.id) === "software" ? "Screenshots" : video.duration}
                    </span>
                    <div className="absolute inset-0 grid place-items-center">
                      <span className="rounded-full border border-white/20 bg-black/58 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
                        {publicAlbumId(video.id) === "software" ? "Lead gate opens screenshots" : "Lead gate opens demo"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-200/85">
                    {publicPreviewLabel(video.id)} preview
                  </div>
                  <h3 className="text-xl font-semibold text-white">{video.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/58">{video.body}</p>
                  <div className="mt-auto flex items-center justify-start gap-3 border-t border-white/10 pt-4">
                    <PublicPreviewAction
                      videoId={video.id}
                      onViewDemo={() => openDemoLead(`${publicPreviewLabel(video.id)} walkthrough`)}
                      onViewPhotos={() => openDemoLead("Software workspace walkthrough")}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {demoLeadOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/82 px-3 py-3 backdrop-blur-sm sm:px-4 sm:py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotex-sales-lead-title"
        >
          <div className="relative grid max-h-[calc(100dvh-1.5rem)] min-h-0 w-full max-w-6xl overflow-hidden rounded-xl border border-white/12 bg-white text-ink-950 shadow-[0_30px_90px_rgba(0,0,0,0.58)] sm:max-h-[calc(100dvh-3rem)] lg:grid-cols-[0.76fr_1.1fr]">
            <button
              type="button"
              className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-md border border-black/10 bg-white/80 text-ink-700 transition hover:bg-white hover:text-black"
              onClick={closeDemoLead}
              aria-label="Close demo form"
            >
              <X className="h-4 w-4" />
            </button>

            <aside className="relative hidden min-h-[34rem] overflow-hidden bg-[#080806] p-9 text-white lg:block">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_18%,rgba(255,255,255,0.18),transparent_22%),linear-gradient(140deg,rgba(255,255,255,0.08),transparent_35%)]" />
              <div className="relative z-10 flex h-full max-w-md flex-col justify-between">
                <Link to="/" className="inline-flex items-center gap-3">
                  <QuotexMark
                    className="h-11 w-11 ring-1 ring-white/15"
                    letterClassName="text-[29px]"
                  />
                  <span className="font-display text-2xl leading-none">Quotex Insurance</span>
                </Link>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Guided walkthrough</div>
                  <h2 className="mt-6 max-w-[27rem] font-display text-4xl leading-[0.98] text-white">
                    See why modern insurance agencies use Quotex.
                  </h2>
                  <p className="mt-5 text-base leading-relaxed text-white/70">
                    Tell us who you are, then the selected demo opens immediately.
                  </p>
                </div>
                <div className="rounded-xl border border-white/12 bg-white/[0.06] p-4 shadow-[0_22px_60px_rgba(0,0,0,0.28)]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-200">
                    Walkthrough covers
                  </div>
                  <div className="mt-3 grid gap-2 text-sm font-semibold text-white/76">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-gold-300" />
                      Software workspace
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-gold-300" />
                      Website and Quotex app
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-gold-300" />
                      Build-plan pricing
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            <section className="invisible-scroll-pane max-h-[calc(100dvh-1.5rem)] min-h-0 overflow-y-auto p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-6 lg:p-8">
              <div className="mb-4 pr-12 lg:hidden">
                <div className="font-display text-2xl text-black">Quotex Insurance</div>
                <h2 className="mt-5 font-display text-4xl leading-tight text-black">
                  See Quotex in action.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">
                  Enter your details once and the selected demo opens right away.
                </p>
              </div>

              {demoLeadSubmitted ? (
                <div className="flex min-h-[30rem] flex-col rounded-lg border border-stone-200 bg-stone-50 p-6">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Details received
                    </div>
                    <h3 id="quotex-sales-lead-title" className="mt-5 font-display text-4xl leading-tight text-black">
                      Details received.
                    </h3>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-600">
                      Thanks{demoLeadForm.firstName.trim() ? `, ${demoLeadForm.firstName.trim()}` : ""}. Your details are saved before opening the selected demo.
                    </p>
                  </div>

                  <div className="mt-6 flex flex-1 flex-col justify-end gap-3">
                    <Link
                      to="/checkout"
                      className="btn-gold h-12 justify-center"
                      onClick={closeDemoLead}
                    >
                      Build my plan
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <button type="button" className="btn-outline h-12 justify-center" onClick={closeDemoLead}>
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={submitDemoLead} className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.16em] text-gold-700">
                      Product walkthrough
                    </div>
                    <h2 id="quotex-sales-lead-title" className="mt-2 font-display text-4xl leading-tight text-black">
                      View the Quotex demo.
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
                      Enter your details once, then the selected software, website, or app demo opens.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <DemoLeadInput
                      label="First name"
                      value={demoLeadForm.firstName}
                      onChange={(value) => setDemoLeadField("firstName", value)}
                      required
                    />
                    <DemoLeadInput
                      label="Last name"
                      value={demoLeadForm.lastName}
                      onChange={(value) => setDemoLeadField("lastName", value)}
                      required
                    />
                    <DemoLeadInput
                      label="Business email address"
                      type="email"
                      value={demoLeadForm.businessEmail}
                      onChange={(value) => setDemoLeadField("businessEmail", value)}
                      required
                    />
                    <DemoLeadInput
                      label="Agency name"
                      value={demoLeadForm.agencyName}
                      onChange={(value) => setDemoLeadField("agencyName", value)}
                      required
                    />
                    <DemoLeadInput
                      label="Role"
                      value={demoLeadForm.role}
                      onChange={(value) => setDemoLeadField("role", value)}
                      required
                    />
                    <label className="block">
                      <span className="text-xs font-semibold text-black">Staff size *</span>
                      <select
                        className="mt-1.5 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                        value={demoLeadForm.staffSize}
                        onChange={(event) => setDemoLeadField("staffSize", event.target.value)}
                        required
                      >
                        <option value="">Select...</option>
                        <option value="1-9">1-9 users</option>
                        <option value="10-24">10-24 users</option>
                        <option value="25-49">25-49 users</option>
                        <option value="50+">50+ users</option>
                      </select>
                    </label>
                    <DemoLeadInput
                      label="Phone number"
                      type="tel"
                      value={demoLeadForm.phone}
                      onChange={(value) => setDemoLeadField("phone", value)}
                    />
                    <label className="block">
                      <span className="text-xs font-semibold text-black">Primary interest</span>
                      <select
                        className="mt-1.5 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                        value={demoLeadForm.interest}
                        onChange={(event) => setDemoLeadField("interest", event.target.value)}
                      >
                        <option>Full Quotex walkthrough</option>
                        <option>Software workspace walkthrough</option>
                        <option>Agency website walkthrough</option>
                        <option>Quotex app walkthrough</option>
                        <option>Pricing and onboarding review</option>
                      </select>
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-xs font-semibold text-black">Notes</span>
                    <textarea
                      className="mt-1.5 min-h-16 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
                      value={demoLeadForm.notes}
                      onChange={(event) => setDemoLeadField("notes", event.target.value)}
                      placeholder="Current AMS, agency size, website/app interest, launch timing..."
                    />
                  </label>

                  <label className="flex items-start gap-3 text-xs leading-relaxed text-ink-700">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-stone-300 text-black"
                      checked={demoLeadForm.marketingOptIn}
                      onChange={(event) => setDemoLeadField("marketingOptIn", event.target.checked)}
                    />
                    <span>
                      Yes, I would like to receive Quotex product, pricing, and follow-up
                      communications. I can unsubscribe at any time.
                    </span>
                  </label>

                  <button type="submit" className="btn h-12 w-full bg-black text-base text-white hover:bg-ink-800">
                    View demo
                  </button>
                  <p className="text-center text-[11px] leading-relaxed text-ink-500">
                    Your details are saved as a lead before the demo opens.
                  </p>
                </form>
              )}
            </section>
          </div>
        </div>
      )}

      {activeVideo && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/78 px-5 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotex-video-preview-title"
        >
          <div className="relative w-full max-w-3xl overflow-hidden rounded-lg border border-white/12 bg-[#11100c] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <button
              type="button"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-black/50 text-white/70 transition hover:bg-white/10 hover:text-white"
              onClick={closePublicPreview}
              aria-label="Close video preview"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative aspect-video overflow-hidden bg-black">
              <ProductSnippet snippet={publicVideoSnippet(activeVideo.id, activePreviewChapterIndex)} />
              <div className="absolute inset-0 bg-black/28" />
              <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-3">
                <div className="min-w-0 rounded-full border border-white/15 bg-black/58 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75 backdrop-blur">
                  {activePreviewChapter?.timestamp ?? "0:00"} / {activePreviewChapter?.title ?? "Preview"}
                </div>
                <span className="rounded-full bg-gold-300 px-2.5 py-1 text-[11px] font-semibold text-ink-950">
                  {formatPreviewTime(activePreviewElapsed)} / {formatPreviewTime(activePreviewDuration)}
                </span>
              </div>
              <div className="absolute inset-x-4 bottom-4 rounded-lg border border-white/12 bg-black/68 p-4 backdrop-blur">
                <h3 id="quotex-video-preview-title" className="max-w-xl text-2xl font-semibold text-white">
                  {activePreviewChapter?.title ?? activeVideo.title}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">
                  {activePreviewChapter?.transcript ?? activeVideo.body}
                </p>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/18">
                  <div
                    className="h-full rounded-full bg-gold-300 transition-[width]"
                    style={{ width: `${Math.round(activePreviewProgress * 100)}%` }}
                  />
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm leading-relaxed text-white/62">{activeVideo.body}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {activeVideo.chapters.map((chapter, index) => (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`rounded-md border p-3 text-left transition ${
                      index === activePreviewChapterIndex
                        ? "border-gold-300 bg-gold-300/10"
                        : "border-white/10 bg-white/[0.04] hover:border-gold-300/50"
                    }`}
                    onClick={() => {
                      setActivePreviewChapterIndex(index);
                      setActivePreviewProgress(index / Math.max(activeVideo.chapters.length, 1));
                      setPreviewPlaying(false);
                    }}
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
                      {chapter.timestamp}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-white/82">{chapter.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-white/50">{chapter.summary}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  className="btn border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14]"
                  onClick={togglePublicPreview}
                >
                  <PlayCircle className="h-4 w-4" />
                  {previewPlaying ? "Pause video" : previewEnded ? "Replay video" : "Play video"}
                </button>
                <Link to="/checkout" className="btn-gold">
                  Build my plan
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  className="btn border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14]"
                  onClick={closePublicPreview}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeAlbum && (
        <div
          className="fixed inset-0 z-50 bg-black/82 px-4 py-5 backdrop-blur-sm md:px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quotex-photo-album-title"
        >
          <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-lg border border-white/12 bg-[#11100c] shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-6">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-gold-300/30 bg-gold-300/10 text-gold-200">
                  {activeAlbum.icon}
                </span>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-200/85">
                    {activeAlbum.eyebrow}
                  </div>
                  <h3 id="quotex-photo-album-title" className="mt-1 text-2xl font-semibold text-white">
                    {activeAlbum.title}
                  </h3>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/58">
                    {activeAlbum.frames.length} annotated examples from the Quotex experience.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.06] text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={() => setActiveAlbumId(null)}
                aria-label="Close photo album"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
              <div className="grid gap-4 lg:grid-cols-2">
                {activeAlbum.frames.map((frame, index) => (
                  <figure
                    key={frame.title}
                    className="overflow-hidden rounded-lg border border-white/10 bg-[#14120e] shadow-[0_14px_36px_rgba(0,0,0,0.26)]"
                  >
                    <div
                      className={`relative overflow-hidden bg-black ${
                        "image" in frame && frame.image ? "aspect-[3/2]" : "aspect-[16/9]"
                      }`}
                    >
                      {"image" in frame && frame.image ? (
                        <img
                          src={frame.image}
                          alt={`${frame.title} screenshot`}
                          className="h-full w-full object-contain object-top"
                          loading="lazy"
                        />
                      ) : (
                        <ProductSnippet snippet={frame.snippet} />
                      )}
                      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.12),rgba(0,0,0,0.02))]" />
                      <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-3">
                        <span className="rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70 backdrop-blur">
                          Photo {index + 1}
                        </span>
                        <span className="rounded-full bg-gold-300 px-2.5 py-1 text-[10px] font-semibold text-ink-950">
                          {frame.focus}
                        </span>
                      </div>
                      <div className="absolute bottom-3 left-3 right-3 rounded-md border border-white/12 bg-black/58 p-3 backdrop-blur">
                        <div className="text-sm font-semibold text-white">{frame.title}</div>
                        <p className="mt-1 text-xs leading-relaxed text-white/70">{frame.annotation}</p>
                      </div>
                    </div>
                    <figcaption className="flex flex-wrap gap-2 p-3">
                      {frame.chips.map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/64"
                        >
                          {chip}
                        </span>
                      ))}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <QuotexSiteFooter />
    </div>
  );
}

function publicVideoIcon(videoId: string) {
  if (videoId.includes("website")) return <Globe2 className="h-4 w-4" />;
  if (videoId.includes("app")) return <Smartphone className="h-4 w-4" />;
  return <MonitorPlay className="h-4 w-4" />;
}

function publicPreviewDurationSeconds(duration: string): number {
  const minutes = Number.parseInt(duration, 10);
  return Math.max(30, (Number.isFinite(minutes) ? minutes : 2) * 60);
}

function formatPreviewTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function publicAlbumId(videoId: string) {
  if (videoId.includes("website")) return "website";
  if (videoId.includes("app")) return "app";
  return "software";
}

function PublicPreviewAction({
  videoId,
  onViewDemo,
  onViewPhotos,
}: {
  videoId: string;
  onViewDemo: () => void;
  onViewPhotos: () => void;
}) {
  if (videoId.includes("website") || videoId.includes("app")) {
    return (
      <button type="button" className="btn-gold px-4 py-2 text-sm" onClick={onViewDemo}>
        View demo
      </button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-gold px-4 py-2 text-sm" onClick={onViewDemo}>
        View demo
      </button>
      <button
        type="button"
        className="btn border-white/15 bg-white/[0.05] px-4 py-2 text-sm text-white hover:bg-white/[0.1]"
        onClick={onViewPhotos}
      >
        View photos
      </button>
    </div>
  );
}

function DemoLeadInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-black">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type={type}
        className="mt-1.5 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-black outline-none transition focus:border-black focus:ring-2 focus:ring-black/10"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={label}
      />
    </label>
  );
}

function publicPreviewLabel(videoId: string) {
  if (videoId.includes("website")) return "Website template";
  if (videoId.includes("app")) return "Quotex app";
  return "Software";
}

function publicVideoSnippet(videoId: string, chapterIndex: number) {
  if (videoId.includes("website")) {
    return ["website-quote", "website-portal", "website-private-client"][chapterIndex] ?? "website-home";
  }
  if (videoId.includes("app")) {
    return ["app-home", "app-documents", "app-messages"][chapterIndex] ?? "app-home";
  }
  return ["software-dashboard", "software-quoting", "software-policy"][chapterIndex] ?? "software-dashboard";
}

function ProductSnippet({ snippet }: { snippet: string }) {
  switch (snippet) {
    case "software-dashboard":
      return (
        <SnippetShell tone="light">
          <div className="grid grid-cols-[0.26fr_1fr] gap-3">
            <MiniSidebar active="Dashboard" />
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Active clients", "1", "Quick view"],
                  ["Bound policies", "2", "Quick view"],
                  ["Open prospects", "1", "Quick view"],
                ].map(([label, value, hint]) => (
                  <div key={label} className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-600">{label}</div>
                    <div className="mt-1 text-2xl font-semibold text-black">{value}</div>
                    <div className="text-[10px] text-stone-500">{hint}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MiniPanel title="My reminders" body="New reminder. Personal or company." />
                <MiniPanel title="Notifications" body="Goal request from Olivia Marsh." />
                <MiniPanel title="Prospect queue" body="Robert Jenkins. Abandoned quote." />
              </div>
            </div>
          </div>
        </SnippetShell>
      );
    case "software-client":
      return (
        <SnippetShell tone="light">
          <div className="space-y-3">
            <div>
              <div className="font-display text-xl text-black">Alexandra Whitford</div>
              <div className="text-[10px] text-stone-500">Palm Coast Private Client - client@example.com</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Policies", "#CHB-HM-558920", "Renewal soon - Bound"],
                ["Billing", "#PUR-AU-771204", "Semi-annual - Current"],
                ["Claims", "Chubb Masterpiece", "View loss runs"],
              ].map(([title, value, meta]) => (
                <div key={title} className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
                  <div className="text-[10px] font-semibold text-black">{title}</div>
                  <div className="mt-2 text-[11px] font-semibold text-black">{value}</div>
                  <div className="mt-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">
                    {meta}
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">
                  Client remarks
                </span>
                <span className="rounded-md border border-stone-200 px-2 py-1 text-[9px] font-semibold">Search</span>
              </div>
              <div className="text-[11px] text-stone-600">Timestamped notes, uploads, pasted images, and activity history.</div>
            </div>
          </div>
        </SnippetShell>
      );
    case "software-quoting":
      return (
        <SnippetShell tone="light">
          <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
            <div className="font-display text-lg text-black">AI quoting workspace</div>
            <div className="mt-1 text-[10px] text-stone-500">
              Re-quote an existing asset or run a new line.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniField label="Policy type" value="Personal lines" />
              <MiniField label="Asset type" value="Coastal home" />
              <MiniField label="Address" value="Sea Breeze Estate" />
              <MiniField label="Estimated value" value="$2,750,000" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["Gathering info", "Public records", "Carrier fit", "Ranked"].map((step, index) => (
                <span
                  key={step}
                  className={`rounded-full px-2 py-1 text-[9px] font-semibold ${
                    index === 0 ? "bg-gold-100 text-gold-800" : "bg-stone-100 text-stone-600"
                  }`}
                >
                  {step}
                </span>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "software-policy":
      return (
        <SnippetShell tone="light">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-xl text-black">Sea Breeze Estate</div>
                <div className="text-[10px] text-stone-500">Policy #CHB-HM-558920</div>
              </div>
              <div className="flex gap-1.5">
                {["Renewal soon", "Bound"].map((badge) => (
                  <span key={badge} className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700">
                    {badge}
                  </span>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniField label="Carrier" value="Chubb Masterpiece" />
              <MiniField label="Premium" value="$17,950" />
              <MiniField label="Renewal" value="Mar 28, 2027" />
              <MiniField label="Policyholder" value="Alexandra Whitford" />
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">Documents</span>
                <span className="rounded-md border border-stone-200 px-2 py-1 text-[9px] font-semibold">Send to client</span>
              </div>
              {["Declarations page", "Proof of insurance", "Inspection report"].map((item) => (
                <div key={item} className="flex items-center justify-between border-t border-stone-100 py-1.5 text-[10px]">
                  <span className="font-semibold text-black">{item}</span>
                  <span className="text-emerald-700">Approved</span>
                </div>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "software-billing":
      return (
        <SnippetShell tone="light">
          <div className="grid grid-cols-[1fr_0.9fr] gap-3">
            <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="font-display text-lg text-black">Billing summary</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniField label="How paid" value="Direct bill" />
                <MiniField label="Payment plan" value="Quarterly" />
                <MiniField label="Next due" value="$4,487" />
                <MiniField label="Carrier path" value="View on carrier" />
              </div>
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">Billing history</div>
              {[
                ["Jun 2", "Card", "Paid"],
                ["Mar 2", "Card", "Paid"],
                ["First", "First payment", "Paid"],
              ].map(([date, method, status]) => (
                <div key={`${date}-${method}`} className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-black">{date}</span>
                  <span className="text-stone-500">{method}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{status}</span>
                </div>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "software-claims":
      return (
        <SnippetShell tone="light">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-display text-xl text-black">Claims</div>
              <div className="flex gap-2">
                <span className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-semibold">
                  Previous loss runs
                </span>
                <span className="rounded-md bg-black px-3 py-1.5 text-[10px] font-semibold text-white">Add claim</span>
              </div>
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-black">Chubb Masterpiece</div>
                  <div className="text-[10px] text-stone-500">Opened - water loss review</div>
                </div>
                <span className="rounded-md border border-stone-200 px-3 py-1.5 text-[10px] font-semibold">View on carrier</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["Send to client", "Send to holder", "Download PDF"].map((action) => (
                <div key={action} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-center text-[10px] font-semibold">
                  {action}
                </div>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "software-marketing":
      return (
        <SnippetShell tone="light">
          <div className="grid grid-cols-[0.9fr_1.1fr] gap-3">
            <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="font-display text-lg text-black">AI campaign draft</div>
              <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 p-2 text-[10px] text-stone-600">
                Write like ChatGPT: "Umbrella review for high-value families before hurricane season."
              </div>
              <div className="mt-3 rounded-md bg-black px-3 py-2 text-center text-[10px] font-semibold text-white">
                Generate pamphlet
              </div>
            </div>
            <div className="rounded-md border border-stone-200 bg-[#11100c] p-3 text-white shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-200">Palm Coast Private Client</div>
              <div className="mt-8 font-display text-2xl leading-none">Protect the lifestyle behind the policy.</div>
              <div className="mt-3 text-[10px] leading-relaxed text-white/58">Branded pamphlet with agency logo, contact details, and get in touch link.</div>
            </div>
          </div>
        </SnippetShell>
      );
    case "software-calendar":
      return (
        <SnippetShell tone="light">
          <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
            <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-display text-lg text-black">Week calendar</div>
                <span className="rounded-md bg-black px-2 py-1 text-[9px] font-semibold text-white">Add event</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => (
                  <div key={day} className="min-h-[90px] rounded-md border border-stone-200 bg-stone-50 p-1.5">
                    <div className="text-[9px] font-semibold text-stone-500">{day}</div>
                    {index < 4 && (
                      <div className="mt-2 rounded bg-gold-100 px-1.5 py-1 text-[8px] font-semibold text-gold-800">
                        {index === 0 ? "Goal review" : index === 1 ? "Reminder" : index === 2 ? "Renewal due" : "Meeting"}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-600">Agenda</div>
              {["Carrier call", "Client review", "Submit timesheet"].map((item) => (
                <div key={item} className="mt-2 rounded-md border border-stone-100 bg-stone-50 p-2 text-[10px] font-semibold text-black">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "website-home":
      return (
        <SnippetShell tone="dark">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <div className="font-display text-xl text-white">Palm Coast Private Client</div>
                <div className="text-[10px] text-white/45">Private client insurance advisory</div>
              </div>
              <div className="rounded-md bg-gold-300 px-3 py-1.5 text-[10px] font-semibold text-ink-950">
                Start quote
              </div>
            </div>
            <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
              <div>
                <div className="font-display text-3xl leading-none text-white">Coverage for high-value lives.</div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/60">
                  Home, auto, collections, umbrella, and specialty coverage with a polished digital intake.
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
                <div className="text-[10px] font-semibold text-gold-200">Connected paths</div>
                <div className="mt-2 space-y-1.5 text-[10px] text-white/62">
                  <div>Quote start</div>
                  <div>Client portal</div>
                  <div>Agency contact</div>
                </div>
              </div>
            </div>
          </div>
        </SnippetShell>
      );
    case "website-quote":
      return (
        <SnippetShell tone="dark">
          <div className="rounded-md border border-white/10 bg-white/[0.06] p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-200">Quote start</div>
            <div className="mt-2 font-display text-2xl text-white">Tell us what you want protected.</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {["Coastal home", "Auto", "Jewelry", "Umbrella"].map((line) => (
                <div key={line} className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/75">
                  {line}
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md bg-gold-300 px-3 py-2 text-center text-[11px] font-semibold text-ink-950">
              Continue to connected intake
            </div>
          </div>
        </SnippetShell>
      );
    case "website-portal":
      return (
        <SnippetShell tone="dark">
          <div className="mx-auto max-w-[78%] rounded-md border border-white/10 bg-white/[0.06] p-4">
            <div className="font-display text-2xl text-white">Client portal</div>
            <div className="mt-1 text-[10px] text-white/50">Policies, documents, claims, and service updates.</div>
            <div className="mt-4 space-y-2">
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-white/70">
                client@example.com
              </div>
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[10px] text-white/70">
                Password
              </div>
              <div className="rounded-md bg-white px-3 py-2 text-center text-[10px] font-semibold text-ink-950">
                Sign in
              </div>
            </div>
          </div>
        </SnippetShell>
      );
    case "website-services":
      return (
        <SnippetShell tone="dark">
          <div className="space-y-3">
            <div className="font-display text-3xl leading-none text-white">Insurance services.</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Personal", "Homes, autos, umbrella"],
                ["Commercial", "Business and executive risk"],
                ["Specialty", "Collections and lifestyle assets"],
              ].map(([title, body]) => (
                <div key={title} className="rounded-md border border-white/10 bg-white/[0.06] p-3">
                  <div className="text-[11px] font-semibold text-white">{title}</div>
                  <div className="mt-1 text-[10px] leading-relaxed text-white/50">{body}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md bg-gold-300 px-3 py-2 text-center text-[11px] font-semibold text-ink-950">
              Start an insurance review
            </div>
          </div>
        </SnippetShell>
      );
    case "website-private-client":
      return (
        <SnippetShell tone="dark">
          <div className="grid grid-cols-[1fr_0.8fr] gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-200">Private client</div>
              <div className="mt-2 font-display text-3xl leading-none text-white">Built for complex households.</div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/58">
                Coastal homes, collections, travel, umbrella, autos, and family risk reviewed together.
              </p>
            </div>
            <div className="space-y-2">
              {["Estate risk map", "Coverage gaps", "Renewal concierge"].map((item) => (
                <div key={item} className="rounded-md border border-white/10 bg-white/[0.06] px-3 py-2 text-[10px] font-semibold text-white/72">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </SnippetShell>
      );
    case "website-contact":
      return (
        <SnippetShell tone="dark">
          <div className="grid grid-cols-[0.9fr_1.1fr] gap-3">
            <div>
              <div className="font-display text-3xl leading-none text-white">Talk with the agency.</div>
              <p className="mt-2 text-[11px] leading-relaxed text-white/58">
                Contact details, location, and portal routing sit on one clean branded page.
              </p>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
              <div className="space-y-2">
                <div className="rounded-md bg-black/25 px-3 py-2 text-[10px] text-white/65">Name</div>
                <div className="rounded-md bg-black/25 px-3 py-2 text-[10px] text-white/65">Email</div>
                <div className="rounded-md bg-black/25 px-3 py-2 text-[10px] text-white/65">How can we help?</div>
                <div className="rounded-md bg-gold-300 px-3 py-2 text-center text-[10px] font-semibold text-ink-950">Send</div>
              </div>
            </div>
          </div>
        </SnippetShell>
      );
    case "website-checkout":
      return (
        <SnippetShell tone="dark">
          <div className="grid grid-cols-[1fr_0.9fr] gap-3">
            <div className="rounded-md border border-white/10 bg-white/[0.06] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-200">Users</div>
              <div className="mt-2 font-display text-2xl text-white">How many users do you need?</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-md border border-white/10 px-3 py-2 text-white">-</span>
                <span className="flex-1 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-center font-semibold text-white">25</span>
                <span className="rounded-md border border-white/10 px-3 py-2 text-white">+</span>
              </div>
            </div>
            <div className="rounded-md border border-gold-300/25 bg-gold-300/10 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold-100">Discounted monthly</div>
              <div className="mt-4 text-4xl font-semibold text-emerald-200">$7,300</div>
              <div className="mt-1 text-[10px] text-white/58">$200/mo user discount applied.</div>
            </div>
          </div>
        </SnippetShell>
      );
    case "app-home":
      return (
        <MobileSnippet title="Palm Coast">
          <MiniMobileCard title="Policies" value="2 active" />
          <MiniMobileCard title="Documents" value="5 shared" />
          <MiniMobileCard title="Claims" value="1 open" />
        </MobileSnippet>
      );
    case "app-documents":
      return (
        <MobileSnippet title="Documents">
          <MiniMobileList title="Declarations page" meta="Customer visible - Approved" />
          <MiniMobileList title="Proof of insurance" meta="Ready to send" />
          <MiniMobileList title="Inspection report" meta="On file" />
        </MobileSnippet>
      );
    case "app-updates":
      return (
        <MobileSnippet title="Updates">
          <MiniMobileList title="Renewal docs published" meta="Jun 2, 2026" />
          <MiniMobileList title="Claim opened" meta="Chubb Masterpiece" />
          <MiniMobileList title="Message from Olivia" meta="Today - 10:42 AM" />
        </MobileSnippet>
      );
    case "app-policy":
      return (
        <MobileSnippet title="Policy">
          <MiniMobileList title="#CHB-HM-558920" meta="Chubb Masterpiece" />
          <MiniMobileList title="Coverage summary" meta="Home, contents, liability" />
          <MiniMobileList title="View documents" meta="Declarations and POI" />
        </MobileSnippet>
      );
    case "app-billing":
      return (
        <MobileSnippet title="Billing">
          <MiniMobileList title="Direct bill" meta="Quarterly plan" />
          <MiniMobileList title="Next due" meta="$4,487 on Sep 2" />
          <MiniMobileList title="Carrier path" meta="Pay through Chubb" />
        </MobileSnippet>
      );
    case "app-quote":
      return (
        <MobileSnippet title="Start quote">
          <MiniMobileList title="Choose line" meta="Home, auto, umbrella" />
          <MiniMobileList title="Answer questions" meta="One screen at a time" />
          <MiniMobileList title="Submit to agency" meta="Creates prospect intake" />
        </MobileSnippet>
      );
    case "app-messages":
      return (
        <MobileSnippet title="Messages">
          <MiniMobileList title="Olivia Marsh" meta="Policy documents sent" />
          <MiniMobileList title="Claim update" meta="Carrier review in progress" />
          <MiniMobileList title="Renewal reminder" meta="Tap to respond" />
        </MobileSnippet>
      );
    default:
      return null;
  }
}

function SnippetShell({ children, tone }: { children: ReactNode; tone: "light" | "dark" }) {
  return (
    <div
      className={`absolute inset-0 p-4 ${
        tone === "light"
          ? "bg-[linear-gradient(135deg,#f7f4ef_0%,#ffffff_100%)] text-black"
          : "bg-[radial-gradient(circle_at_20%_10%,rgba(179,143,61,0.20),transparent_36%),#0d0c09] text-white"
      }`}
    >
      {children}
    </div>
  );
}

function MiniSidebar({ active }: { active: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-black font-display text-lg text-white">Q</span>
        <span className="text-[10px] font-semibold text-stone-700">Quotex Insurance</span>
      </div>
      {[active, "Messages", "Clients", "Policies", "Billing"].map((item, index) => (
        <div
          key={item}
          className={`mb-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ${
            index === 0 ? "bg-black text-white" : "text-stone-600"
          }`}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function MiniPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
      <div className="font-display text-sm text-black">{title}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-stone-500">{body}</div>
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="text-[8px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</div>
      <div className="mt-1 text-[11px] font-semibold text-black">{value}</div>
    </div>
  );
}

function MobileSnippet({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="absolute inset-0 bg-[linear-gradient(135deg,#12100c_0%,#050505_100%)] p-3">
      <div className="mx-auto h-full max-w-[45%] min-w-[150px] overflow-hidden rounded-[22px] border border-white/15 bg-[#f7f4ef] p-2 shadow-2xl">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/20" />
        <div className="rounded-[16px] bg-white p-3 text-black">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-display text-lg">{title}</div>
              <div className="text-[9px] text-stone-500">Client portal</div>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-black font-display text-base text-white">Q</span>
          </div>
          <div className="mt-3 space-y-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MiniMobileCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-2">
      <div className="text-[10px] font-semibold text-black">{title}</div>
      <div className="mt-1 text-[9px] text-stone-500">{value}</div>
    </div>
  );
}

function MiniMobileList({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 p-2">
      <div className="truncate text-[10px] font-semibold text-black">{title}</div>
      <div className="mt-1 text-[9px] text-stone-500">{meta}</div>
    </div>
  );
}
