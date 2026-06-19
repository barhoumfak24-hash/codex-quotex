import { Link, useLocation } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Gem,
  Home,
  LogIn,
  Mail,
  Sailboat,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { buildAgencyWebsiteProfile } from "@/lib/agencyWebsite";
import { getAppSurface, toSurfaceRoute } from "@/lib/appSurface";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";

export function HomePage() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { agency } = useTenant();
  const profile = agency ? buildAgencyWebsiteProfile(agency) : null;
  const isAppSurface = getAppSurface() === "agencyApp";

  const route = (path: string) => toSurfaceRoute(path, pathname);
  const portalHref = user?.role === "customer" ? route("/customer") : route("/login");
  const portalLabel = "Sign in to my portal";
  const brandName = profile?.agencyName ?? "Quotex Insurance";
  const agencyInitials =
    brandName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "A";
  const headline = profile?.headline ?? "Private client insurance, refined by AI.";
  const intro =
    profile?.intro ??
    "Quotex is the platform powering modern private client insurance agencies across homes, vehicles, yachts, jewelry, and full portfolios.";

  if (isAppSurface) {
    return (
      <section className="relative h-full overflow-hidden bg-[#f8f3e8]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-white via-[#fbf8f1] to-transparent" />
        <div className="pointer-events-none absolute inset-x-8 bottom-28 h-32 rounded-full bg-gold-100/50 blur-3xl" />
        <div className="relative flex h-full min-h-0 flex-col px-5 pb-3 pt-5">
          <div className="flex shrink-0 items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-black bg-black shadow-luxe">
              {profile?.logoUrl ? (
                <img
                  src={profile.logoUrl}
                  alt={`${brandName} logo`}
                  className="h-full w-full object-contain p-2"
                />
              ) : (
                <span className="font-display text-xl leading-none text-white">
                  {agencyInitials}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-700">
                Client mobile app
              </div>
              <div className="mt-1 break-words font-display text-[1.7rem] leading-none text-ink-900">
                {brandName}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-[2.2rem] bg-gold-200/70 blur-2xl" />
              <div className="relative grid h-40 w-40 place-items-center overflow-hidden rounded-[2rem] border border-black bg-black shadow-[0_24px_80px_rgba(13,12,9,0.18)]">
                {profile?.logoUrl ? (
                  <img
                    src={profile.logoUrl}
                    alt={`${brandName} logo`}
                    className="h-full w-full object-contain p-5"
                  />
                ) : (
                  <span className="font-display text-6xl leading-none text-white">
                    {agencyInitials}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-7 max-w-[22rem]">
              <div className="font-display text-[2.45rem] leading-[0.95] text-ink-900">
                Private client insurance, in your pocket.
              </div>
              <p className="mx-auto mt-3 max-w-[20rem] text-[14px] leading-relaxed text-ink-600">
                Quote, review, renew, message your advisor, and keep every policy document
                connected in one secure place.
              </p>
            </div>
          </div>

          <div className="mb-7 shrink-0 space-y-2.5">
            <Link to={route("/quote/start")} className="btn-gold min-h-[54px] w-full justify-between rounded-2xl px-5 text-base">
              <span className="inline-flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Get a Quote
              </span>
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link to={portalHref} className="btn-primary min-h-[54px] w-full justify-between rounded-2xl px-5 text-base">
              <span className="inline-flex items-center gap-2">
                <LogIn className="h-5 w-5" />
                {portalLabel}
              </span>
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link to={route("/contact")} className="btn-outline min-h-[54px] w-full justify-between rounded-2xl px-5 text-base">
              <span className="inline-flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Contact the agency
              </span>
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-ink-50 via-white to-white" />
        <div className={isAppSurface ? "relative mx-auto max-w-7xl px-4 pb-10 pt-8" : "relative max-w-7xl mx-auto px-6 pt-20 pb-24"}>
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-medium text-gold-700">
              <Sparkles className="h-3 w-3" /> AI-assisted, agent-approved
            </div>
            <h1 className={isAppSurface ? "mt-5 font-display text-4xl tracking-tight leading-tight" : "mt-5 font-display text-5xl md:text-6xl tracking-tight leading-tight"}>
              {headline}
            </h1>
            <p className={isAppSurface ? "mt-4 text-base text-ink-600 max-w-2xl leading-relaxed" : "mt-5 text-lg text-ink-600 max-w-2xl leading-relaxed"}>
              {intro} Every recommendation is preliminary and reviewed by a licensed agent.
            </p>
            <div className={isAppSurface ? "mt-6 flex flex-col gap-3" : "mt-8 flex flex-wrap items-center gap-3"}>
              <Link to={route("/quote/start")} className={isAppSurface ? "btn-gold w-full text-base px-5 py-3.5" : "btn-gold text-lg px-7 py-3.5"}>
                Get a Quote <ArrowRight className="h-5 w-5" />
              </Link>
              <Link to={portalHref} className={isAppSurface ? "btn-outline w-full text-base px-5 py-3" : "btn-outline text-base px-6 py-3"}>
                <LogIn className="h-5 w-5" />
                {portalLabel}
              </Link>
            </div>
          </div>

          {!isAppSurface && (
            <div className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { icon: <Home className="h-5 w-5" />, label: "Coastal Homes" },
                { icon: <Building2 className="h-5 w-5" />, label: "Luxury Autos" },
                { icon: <Sailboat className="h-5 w-5" />, label: "Yachts" },
                { icon: <Gem className="h-5 w-5" />, label: "Jewelry & Collections" },
              ].map((c) => (
                <div key={c.label} className="card !p-5 flex items-center gap-3">
                  <span className="text-gold-600">{c.icon}</span>
                  <span className="text-sm font-medium text-ink-800">{c.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {!isAppSurface && (
        <section className="bg-white">
          <div className="max-w-7xl mx-auto px-6 py-20">
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  title: "AI intake, human bind",
                  body: "Describe the asset in plain English. The intake is structured, missing details are flagged, and your agent reviews every detail.",
                },
                {
                  title: `${brandName} client portal`,
                  body: "Your quote, documents, policy changes, and claims stay connected to the same agency team from first intake through renewal.",
                },
                {
                  title: "Concierge follow-up",
                  body: "Started quotes flow into the agency workspace with summaries, missing-document prompts, and recommended next steps.",
                },
              ].map((b) => (
                <div key={b.title} className="card !p-6">
                  <div className="flex items-center gap-2 text-gold-600">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Private client</span>
                  </div>
                  <h3 className="mt-3 font-semibold text-ink-900">{b.title}</h3>
                  <p className="mt-2 text-sm text-ink-600 leading-relaxed">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
