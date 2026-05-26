import { Link } from "react-router-dom";
import { ShieldCheck, Sparkles, Users } from "lucide-react";

export function AboutPage() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl">About Quotex Insurance</h1>
      <p className="mt-4 text-ink-600 leading-relaxed">
        Quotex is the platform that powers modern private client insurance agencies. We pair a
        concierge client experience with an AI assistant that handles intake, document
        organization, and prospect follow-up — so licensed agents spend their time on the work
        only they can do: matching risks to carriers and binding coverage.
      </p>
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {[
          {
            icon: <ShieldCheck className="h-5 w-5 text-gold-600" />,
            title: "Agent-led, AI-assisted",
            body: "AI structures the intake and surfaces options. Every final decision belongs to a licensed agent.",
          },
          {
            icon: <Sparkles className="h-5 w-5 text-gold-600" />,
            title: "Built for complex portfolios",
            body: "Coastal homes, yachts, luxury autos, jewelry, fine art, and umbrella liability — coordinated in one place.",
          },
          {
            icon: <Users className="h-5 w-5 text-gold-600" />,
            title: "White-label by design",
            body: "Each agency gets its own branded portal, carrier library, and tenant-isolated data.",
          },
        ].map((b) => (
          <div key={b.title} className="card !p-5">
            {b.icon}
            <h3 className="mt-3 font-semibold text-ink-900">{b.title}</h3>
            <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">{b.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/quote/start" className="btn-gold">Get a Private Quote</Link>
        <Link to="/contact" className="btn-outline">Talk to us</Link>
      </div>
    </section>
  );
}