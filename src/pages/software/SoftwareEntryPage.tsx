import { Link } from "react-router-dom";
import { ArrowRight, BriefcaseBusiness, LockKeyhole, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";

export function SoftwareEntryPage() {
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900">
      <DemoBanner />
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <Logo subtitle="Software portal" />
            <DemoModeBadge />
          </div>
          <div className="hidden items-center gap-2 text-xs text-ink-500 sm:flex">
            <LockKeyhole className="h-4 w-4 text-gold-700" />
            Authorized users only
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-10 lg:grid-cols-[1fr_420px] lg:items-center lg:py-16">
        <section>
          <div className="text-xs uppercase tracking-wider text-gold-700">Quotex Software</div>
          <h1 className="mt-3 font-display text-5xl leading-tight md:text-6xl">
            Staff workspace for running private-client insurance operations.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-600">
            This is the software entrance for agency teams and platform operators.
            Purchasing and subscription transactions now live on a separate transaction website.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/employee/login" className="btn-gold px-6 py-3 text-base">
              Agent / manager sign in <ArrowRight className="h-5 w-5" />
            </Link>
            <Link to="/agency" className="btn-outline px-6 py-3 text-base">
              View agency website
            </Link>
          </div>
        </section>

        <section className="rounded-lg border border-ink-100 bg-white p-5 shadow-sm">
          <div className="grid gap-3">
            {[
              {
                icon: BriefcaseBusiness,
                title: "Agent and manager portal",
                body: "Prospects, clients, policies, documents, renewals, messages, tasks, and analytics.",
              },
              {
                icon: MonitorSmartphone,
                title: "Computer and mobile ready",
                body: "Responsive software workspace for desktop browsers and mobile app wrappers.",
              },
              {
                icon: ShieldCheck,
                title: "Founder controls stay separate",
                body: "Master access is isolated from the staff entrance and kept intentionally quiet.",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-md border border-ink-100 bg-ink-50 p-4">
                  <Icon className="h-5 w-5 text-gold-700" />
                  <h2 className="mt-3 text-sm font-semibold">{item.title}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">{item.body}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="px-5 pb-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-ink-400">
          <span>Quotex software portal</span>
          <Link
            to="/master/login"
            className="text-[10px] uppercase tracking-wider text-ink-300 hover:text-ink-500"
            aria-label="Platform administration sign-in"
          >
            System
          </Link>
        </div>
      </footer>
    </div>
  );
}
