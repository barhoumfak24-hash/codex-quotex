import { Link } from "react-router-dom";
import { ArrowRight, Building2, Home, LogIn, Sailboat, Sparkles, ShieldCheck, Gem } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function HomePage() {
  const { user } = useAuth();
  // Customer-only entry point. Signed-in customers go straight to
  // their portal; anyone else (signed out, or staff browsing the
  // public site) lands on the customer sign-in page. Staff portals
  // have their own login routes (/employee/login, /master/login)
  // accessed from the footer.
  const portalHref = user?.role === "customer" ? "/customer" : "/login";
  const portalLabel = "Sign in to my portal";
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-ink-50 via-white to-white" />
        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-medium text-gold-700">
              <Sparkles className="h-3 w-3" /> AI-assisted, agent-approved
            </div>
            <h1 className="mt-5 font-display text-5xl md:text-6xl tracking-tight leading-tight">
              Private client insurance,{" "}
              <span className="text-gold-600">refined by AI.</span>
            </h1>
            <p className="mt-5 text-lg text-ink-600 max-w-2xl leading-relaxed">
              Quotex is the platform powering modern private client insurance agencies — coastal
              homes, luxury vehicles, yachts, jewelry, and full portfolios. Every recommendation is
              preliminary and reviewed by a licensed agent.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/quote/start"
                className="btn-gold text-lg px-7 py-3.5"
              >
                Get a Private Quote <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                to={portalHref}
                className="btn-outline text-base px-6 py-3"
              >
                <LogIn className="h-5 w-5" />
                {portalLabel}
              </Link>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
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
        </div>
      </section>

      <section className="bg-white">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "AI intake, human bind",
                body: "Describe the asset in plain English. Our model structures the intake and flags missing documents — your agent reviews every detail.",
              },
              {
                title: "Tenant-isolated by design",
                body: "Each agency runs in its own tenant boundary. Carriers, prospects, and clients never cross agency lines.",
              },
              {
                title: "Concierge follow-up",
                body: "Abandoned quotes don't disappear — they enter the prospect queue with an AI summary and recommended outreach.",
              },
            ].map((b) => (
              <div key={b.title} className="card !p-6">
                <div className="flex items-center gap-2 text-gold-600">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wider">Platform</span>
                </div>
                <h3 className="mt-3 font-semibold text-ink-900">{b.title}</h3>
                <p className="mt-2 text-sm text-ink-600 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}