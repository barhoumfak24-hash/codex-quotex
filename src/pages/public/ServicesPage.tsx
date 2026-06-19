import { Link, useLocation } from "react-router-dom";
import { Briefcase, Gem, Home, Sailboat, ShieldCheck, Umbrella } from "lucide-react";
import { useTenant } from "@/lib/tenant";
import { toSurfaceRoute } from "@/lib/appSurface";

const services = [
  { icon: Home, name: "Coastal Homes", desc: "High-value primary, vacation, and waterfront properties with wind, flood, and fine art coverage." },
  { icon: Briefcase, name: "Luxury Vehicles", desc: "Daily drivers, collector cars, and exotics with agreed-value coverage." },
  { icon: Sailboat, name: "Yachts", desc: "Sailboats, motor yachts, charter vessels, captain-operated or owner-operated." },
  { icon: Gem, name: "Jewelry & Collections", desc: "Scheduled jewelry, fine art, wine, watches, and collections with appraisal-backed limits." },
  { icon: Umbrella, name: "Umbrella Liability", desc: "Personal excess liability layered above your underlying lines." },
  { icon: ShieldCheck, name: "Full Portfolio", desc: "Coordinated coverage across every asset, family member, and entity." },
];

export function ServicesPage() {
  const { pathname } = useLocation();
  const { agency } = useTenant();
  const agencyName = agency?.name ?? "Quotex";

  return (
    <section className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl">Services</h1>
      <p className="mt-2 text-ink-600 max-w-2xl">
        {agencyName} partners with leading private client carriers to insure what matters most,
        reviewed by licensed agents in your state.
      </p>
      <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {services.map((s) => (
          <div key={s.name} className="card !p-6">
            <s.icon className="h-5 w-5 text-gold-600" />
            <h3 className="mt-3 font-semibold text-ink-900">{s.name}</h3>
            <p className="mt-1.5 text-sm text-ink-600 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-10">
        <Link to={toSurfaceRoute("/quote/start", pathname)} className="btn-gold">
          Get a Quote
        </Link>
      </div>
    </section>
  );
}
