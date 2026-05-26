import { Link } from "react-router-dom";
import { Briefcase, Gem, Home, Sailboat, ShieldCheck, Umbrella } from "lucide-react";

const services = [
  { icon: Home, name: "Coastal Homes", desc: "High-value primary, vacation, and waterfront properties with wind, flood, and fine art coverage." },
  { icon: Briefcase, name: "Luxury Vehicles", desc: "Daily drivers, collector cars, and exotics with agreed-value coverage." },
  { icon: Sailboat, name: "Yachts", desc: "Sailboats, motor yachts, charter vessels — captain or owner operated." },
  { icon: Gem, name: "Jewelry & Collections", desc: "Scheduled jewelry, fine art, wine, watches with appraisal-backed limits." },
  { icon: Umbrella, name: "Umbrella Liability", desc: "Personal excess liability layered above your underlying lines." },
  { icon: ShieldCheck, name: "Full Portfolio", desc: "Coordinated coverage across every asset, family member, and entity." },
];

export function ServicesPage() {
  return (
    <section className="max-w-7xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl">Services</h1>
      <p className="mt-2 text-ink-600 max-w-2xl">
        Quotex partners with leading private client carriers to insure what matters most — reviewed
        by licensed agents in your state.
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
        <Link to="/quote/start" className="btn-gold">
          Get a Private Quote
        </Link>
      </div>
    </section>
  );
}