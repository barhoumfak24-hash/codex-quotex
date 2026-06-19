import { Check, ExternalLink } from "lucide-react";
import { MARKETING_STUDIO_CTA_BUTTON, type MarketingStudioPamphlet } from "@/lib/marketingCampaignStudio";
import { marketingSmartContactUrl, normalizeMarketingHref } from "@/lib/marketingSmartLinks";
import type { Agency } from "@/types";

export type PamphletThemeId = "executive" | "coastal" | "ivory" | "midnight";

export const PAMPHLET_THEMES: Record<
  PamphletThemeId,
  {
    label: string;
    heroPanel: string;
    eyebrow: string;
    labelText: string;
    bodyBg: string;
    sideBg: string;
    checkBg: string;
    checkText: string;
    ctaBg: string;
    ctaButton: string;
  }
> = {
  executive: {
    label: "Executive gold",
    heroPanel: "border-gold-400 bg-ink-950/72",
    eyebrow: "border-white/35 bg-white/12 text-white",
    labelText: "text-gold-700",
    bodyBg: "bg-white",
    sideBg: "bg-[#f8f5ee]",
    checkBg: "bg-gold-100",
    checkText: "text-gold-800",
    ctaBg: "bg-ink-950",
    ctaButton: "bg-gold-500 text-white",
  },
  coastal: {
    label: "Coastal slate",
    heroPanel: "border-cyan-200 bg-slate-950/74",
    eyebrow: "border-cyan-100/45 bg-cyan-50/12 text-white",
    labelText: "text-cyan-800",
    bodyBg: "bg-white",
    sideBg: "bg-cyan-50",
    checkBg: "bg-cyan-100",
    checkText: "text-cyan-900",
    ctaBg: "bg-slate-950",
    ctaButton: "bg-cyan-700 text-white",
  },
  ivory: {
    label: "Ivory private client",
    heroPanel: "border-stone-200 bg-stone-950/70",
    eyebrow: "border-stone-100/45 bg-stone-50/12 text-white",
    labelText: "text-stone-700",
    bodyBg: "bg-[#fffdf8]",
    sideBg: "bg-stone-50",
    checkBg: "bg-stone-200",
    checkText: "text-stone-900",
    ctaBg: "bg-stone-950",
    ctaButton: "bg-stone-700 text-white",
  },
  midnight: {
    label: "Midnight blue",
    heroPanel: "border-blue-300 bg-blue-950/76",
    eyebrow: "border-blue-100/45 bg-blue-50/12 text-white",
    labelText: "text-blue-800",
    bodyBg: "bg-white",
    sideBg: "bg-blue-50",
    checkBg: "bg-blue-100",
    checkText: "text-blue-900",
    ctaBg: "bg-blue-950",
    ctaButton: "bg-blue-700 text-white",
  },
};

export const PAMPHLET_THEME_OPTIONS = Object.entries(PAMPHLET_THEMES) as [
  PamphletThemeId,
  (typeof PAMPHLET_THEMES)[PamphletThemeId],
][];

export type MarketingPamphletRenderData = {
  pamphlet: MarketingStudioPamphlet;
  imageUrl?: string;
  imageAlt?: string;
  ctaHref?: string;
  ctaLabel?: string;
  themeId?: PamphletThemeId;
};

type ContactDetail = {
  label: string;
  href?: string;
};

export function MarketingPamphletCard({
  data,
  agency,
  logoUrl,
  compact = false,
}: {
  data: MarketingPamphletRenderData;
  agency?: Agency;
  logoUrl?: string;
  compact?: boolean;
}) {
  const theme = PAMPHLET_THEMES[data.themeId ?? "executive"] ?? PAMPHLET_THEMES.executive;
  const agencyName = agency?.name ?? "Your agency";
  const contactUrls = agencyContactUrls(agency);
  const contactUrl = data.ctaHref || contactUrls.desktop;
  const minHero = compact ? "min-h-[300px]" : "min-h-[360px]";
  const heroPadding = compact ? "p-5 sm:p-6" : "p-7";
  const panelPadding = compact ? "p-4 sm:p-5" : "p-5";

  return (
    <div
      className={`marketing-pamphlet-card overflow-hidden rounded-md border border-ink-100 ${theme.bodyBg} text-ink-900 shadow-[0_22px_55px_rgba(23,19,15,0.12)]`}
    >
      <div className={`relative ${minHero} bg-ink-950`}>
        {data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt={data.imageAlt || data.pamphlet.headline}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <PremiumFallbackArt data={data} />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(23,19,15,0.28)_0%,rgba(23,19,15,0.34)_32%,rgba(23,19,15,0.92)_100%)]" />
        <div className={`relative flex ${minHero} flex-col justify-end ${heroPadding} text-white`}>
          <div className="mb-5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/82">
            {logoUrl && (
              <img
                src={logoUrl}
                alt={`${agencyName} logo`}
                className="mr-1 max-h-11 max-w-[11rem] object-contain drop-shadow-[0_8px_22px_rgba(0,0,0,0.58)]"
              />
            )}
            <span className="rounded-md border border-white/25 bg-white/12 px-3 py-1 text-white/95 shadow-sm backdrop-blur-sm">
              {agencyName}
            </span>
            <span>Private client insurance</span>
          </div>
          <div
            className={`max-w-[820px] border-l-4 ${panelPadding} shadow-[0_18px_45px_rgba(0,0,0,0.38)] backdrop-blur-[2px] ${theme.heroPanel}`}
          >
            <div className={`mb-4 w-fit border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] shadow-sm ${theme.eyebrow}`}>
              {data.pamphlet.eyebrow}
            </div>
            <h3 className="font-display text-[clamp(2rem,4vw,3.8rem)] leading-[0.96] text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.7)]">
              {data.pamphlet.headline}
            </h3>
            <p className="mt-4 max-w-2xl text-base font-medium leading-7 text-white/95 [text-shadow:0_1px_12px_rgba(0,0,0,0.72)]">
              {data.pamphlet.subheadline}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="p-6 lg:p-8">
          <div className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.labelText}`}>
            Advisor briefing
          </div>
          <p className="mt-4 text-[15px] leading-8 text-ink-700">{data.pamphlet.intro}</p>
        </div>
        <div className={`border-t border-ink-100 p-6 lg:border-l lg:border-t-0 lg:p-8 ${theme.sideBg}`}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            {data.pamphlet.highlightsTitle}
          </div>
          <div className="mt-4 grid gap-3">
            {data.pamphlet.highlights.map((item, index) => (
              <div key={`${index}-${item}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 text-sm leading-6 text-ink-800">
                <span className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${theme.checkBg} ${theme.checkText}`}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`border-t border-ink-100 p-6 text-white ${theme.ctaBg}`}>
        <div className="flex justify-end">
          <a
            href={contactUrl}
            data-mobile-href={contactUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the agency contact page"
            aria-label="Get in touch with the agency"
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold no-underline shadow-sm ring-2 ring-white/35 transition hover:-translate-y-0.5 hover:ring-white/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 ${theme.ctaButton}`}
          >
            {data.ctaLabel || MARKETING_STUDIO_CTA_BUTTON}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <PamphletContact agency={agency} />
      </div>
    </div>
  );
}

function PremiumFallbackArt({ data }: { data: MarketingPamphletRenderData }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-950">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#17130f_0%,#33291c_44%,#9a7837_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(23,19,15,0.76)_100%)]" />
      <div className="absolute left-8 top-8 h-28 w-44 border border-white/20 bg-white/10 backdrop-blur-sm" />
      <div className="absolute right-10 top-12 h-40 w-64 border border-gold-200/30 bg-ink-900/35" />
      <div className="absolute bottom-16 left-8 right-8 grid gap-3 sm:grid-cols-[1fr_0.75fr]">
        <div className="border border-white/20 bg-white/12 p-5 text-white backdrop-blur-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-100">
            Visual direction
          </div>
          <div className="mt-3 font-display text-3xl leading-tight">{data.pamphlet.eyebrow}</div>
          <p className="mt-3 text-sm leading-6 text-white/78">{data.pamphlet.imagePrompt}</p>
        </div>
        <div className="hidden border border-white/15 bg-white/8 p-5 text-sm leading-6 text-white/72 sm:block">
          {data.pamphlet.subheadline}
        </div>
      </div>
    </div>
  );
}

function PamphletContact({ agency }: { agency?: Agency }) {
  const details = contactDetails(agency);
  if (!details.length) return null;
  return (
    <div className="mt-5 border-t border-white/15 pt-4 text-xs leading-5 text-white/78">
      <div className="font-semibold uppercase tracking-[0.14em] text-white/92">
        {agency?.name ?? "Agency contact"}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {details.map((detail) =>
          detail.href ? (
            <a
              key={detail.label}
              href={detail.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/86 underline-offset-4 hover:underline"
            >
              {detail.label}
            </a>
          ) : (
            <span key={detail.label}>{detail.label}</span>
          )
        )}
      </div>
    </div>
  );
}

function contactDetails(agency?: Agency): ContactDetail[] {
  const details: ContactDetail[] = [];
  if (agency?.contactEmail?.trim()) {
    details.push({
      label: agency.contactEmail.trim(),
      href: `mailto:${agency.contactEmail.trim()}`,
    });
  }
  if (agency?.phone?.trim()) {
    details.push({
      label: agency.phone.trim(),
      href: `tel:${agency.phone.replace(/[^\d+]/g, "")}`,
    });
  }
  if (agency?.website?.trim()) {
    const href = normalizeMarketingHref(agency.website);
    details.push(href ? { label: displayWebsite(agency.website), href } : { label: displayWebsite(agency.website) });
  }
  if (agency?.address?.trim()) {
    details.push({ label: agency.address.trim() });
  }
  return details.length ? details : [{ label: "Contact your agency team for a review." }];
}

function agencyContactUrls(agency?: Agency): { desktop: string; mobile: string } {
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  const href = marketingSmartContactUrl({ origin, tenantId: agency?.id });
  return { desktop: href, mobile: href };
}

function displayWebsite(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
}
