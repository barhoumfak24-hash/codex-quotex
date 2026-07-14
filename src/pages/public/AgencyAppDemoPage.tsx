import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  FileText,
  Home,
  LifeBuoy,
  Lock,
  Mail,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { QuotexMark, QuotexWordmark } from "@/components/layout/Logo";
import { buildAgencyWebsiteProfile } from "@/lib/agencyWebsite";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import type { Document, Policy } from "@/types";

type AppTab = "home" | "policies" | "documents" | "claims" | "quote";

const tabs: { id: AppTab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "documents", label: "Docs", icon: FileText },
  { id: "claims", label: "Claims", icon: LifeBuoy },
  { id: "quote", label: "Quote", icon: Sparkles },
];

export function AgencyAppDemoPage() {
  const { agency } = useTenant();
  const profile = agency ? buildAgencyWebsiteProfile(agency) : null;
  const agencyName = profile?.agencyName ?? "Palm Coast Private Client";
  const brandColor = profile?.brandColor ?? "#0d0c09";
  const [activeTab, setActiveTab] = useState<AppTab>("home");

  const demo = useMemo(() => {
    const activeAgency = agency ?? api.agencies.list()[0];
    const customer = activeAgency ? api.customers.list(activeAgency.id)[0] : undefined;
    const policies = customer ? api.policies.listByCustomer(customer.id) : [];
    const documents = activeAgency
      ? api.documents
          .listByTenant(activeAgency.id)
          .filter((doc) => doc.customerId === customer?.id || doc.policyId)
          .slice(0, 5)
      : [];
    const claims = activeAgency
      ? api.claims.listByTenant(activeAgency.id).filter((claim) => claim.customerId === customer?.id)
      : [];
    return { customer, policies, documents, claims };
  }, [agency]);

  const clientName = demo.customer?.name ?? "Alexandra Whitford";
  const firstName = clientName.split(/\s+/)[0] ?? "Alexandra";
  const primaryPolicy = demo.policies[0];
  const quoteHref = profile?.quoteStartUrl ?? "/quote/start";
  const portalHref = profile?.customerLoginUrl ?? "/login";
  const phoneHref = profile?.phone ? `tel:${profile.phone.replace(/[^\d+]/g, "")}` : undefined;
  const emailHref = profile?.contactEmail ? `mailto:${profile.contactEmail}` : undefined;

  return (
    <div className="min-h-screen bg-[#080807] text-white">
      <section className="relative overflow-hidden">
        <img
          src="/quotex-home-hero.png"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,8,6,0.98)_0%,rgba(8,8,6,0.88)_46%,rgba(8,8,6,0.42)_100%)]" />
        <div className="relative mx-auto max-w-7xl px-5 py-6 md:px-8">
          <header className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-3">
              <QuotexMark className="h-11 w-11 ring-1 ring-white/15" letterClassName="text-[28px]" />
              <span>
                <span className="block font-display text-xl leading-none">
                  <QuotexWordmark />
                </span>
                <span className="mt-1.5 block text-[11px] font-medium leading-none text-white/45">
                  Quotex client app
                </span>
              </span>
            </Link>
            <nav className="flex items-center gap-2">
              <Link className="btn border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14]" to="/checkout">
                Build my plan
              </Link>
            </nav>
          </header>

          <div className="grid gap-10 py-14 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:py-20">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gold-200">
                <Smartphone className="h-3.5 w-3.5" />
                Universal Quotex app
              </div>
              <h1 className="mt-5 font-display text-5xl leading-[0.96] tracking-tight md:text-7xl">
                One Quotex app. The client chooses {agencyName}.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/72">
                The agency website remains separate and branded. The Quotex app is the shared
                mobile entry point: customers choose their agency at sign-in, then get portal
                access, quote intake, policy visibility, documents, claims, billing guidance,
                and direct contact.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href={quoteHref} className="btn-gold px-6 py-3 text-base">
                  Start mobile quote <ArrowRight className="h-5 w-5" />
                </a>
                <a href={portalHref} className="btn border-white/15 bg-white text-ink-900 hover:bg-white/90 px-6 py-3 text-base">
                  Client sign in
                </a>
              </div>
              <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
                {[
                  ["Universal app", "One Quotex listing for all agencies"],
                  ["Agency selection", "Customers choose their agency at sign-in"],
                  ["Web", "Desktop and PWA ready"],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-lg border border-white/10 bg-black/28 p-4">
                    <div className="text-sm font-semibold text-white">{title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-white/55">{text}</div>
                  </div>
                ))}
              </div>
            </div>

            <PhoneShell
              agencyName={agencyName}
              brandColor={brandColor}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            >
              <AppScreen
                activeTab={activeTab}
                firstName={firstName}
                profile={{
                  agencyName,
                  email: profile?.contactEmail,
                  phone: profile?.phone,
                  quoteHref,
                  portalHref,
                  phoneHref,
                  emailHref,
                }}
                policies={demo.policies}
                documents={demo.documents}
                claims={demo.claims}
                primaryPolicy={primaryPolicy}
              />
            </PhoneShell>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#0d0c09]">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-8 md:grid-cols-4 md:px-8">
          {[
            ["Portal", "Policies, documents, claims, billing, messages"],
            ["Quote intake", "Personal and commercial starts route to the software"],
            ["Service", "Carrier paths, loss runs, renewal updates, e-sign"],
            ["Brand", "Agency name, contact details, logo, and color system"],
          ].map(([title, text]) => (
            <div key={title} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold text-white">{title}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/55">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#080807] px-5 py-14 md:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-3">
          <AppFeatureCard
            icon={<Lock className="h-5 w-5" />}
            title="Same customer portal logic"
            body="The app is not a disconnected brochure. It points into the same portal workflows the website uses: sign-in, quote start, documents, claims, and messages."
          />
          <AppFeatureCard
            icon={<Bell className="h-5 w-5" />}
            title="Retention touchpoints"
            body="Renewal notices, claim updates, document requests, and advisor messages stay one tap away instead of getting buried in email."
          />
          <AppFeatureCard
            icon={<UserRound className="h-5 w-5" />}
            title="Private-client feel"
            body="Quiet luxury layout, branded contact actions, and concise service cards make the app feel like the agency, not a generic carrier portal."
          />
        </div>
      </section>
    </div>
  );
}

function PhoneShell({
  agencyName,
  brandColor,
  activeTab,
  onTabChange,
  children,
}: {
  agencyName: string;
  brandColor: string;
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[2.4rem] border border-white/20 bg-[#1b1913] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#f8f5ef] text-ink-950">
        <div className="flex items-center justify-between px-5 py-3 text-[11px] font-semibold">
          <span>9:41</span>
          <div className="h-5 w-24 rounded-full bg-black/85" />
          <span>100%</span>
        </div>
        <div className="px-4 pb-3">
          <div
            className="rounded-2xl p-4 text-white"
            style={{ background: `linear-gradient(135deg, ${brandColor}, #0d0c09)` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/55">Quotex app</div>
                <div className="mt-1 font-display text-2xl leading-none">{agencyName}</div>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/12">
                <Smartphone className="h-5 w-5" />
              </div>
            </div>
          </div>
        </div>
        <div className="min-h-[500px] px-4 pb-3">{children}</div>
        <div className="grid grid-cols-5 border-t border-ink-100 bg-white">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex flex-col items-center gap-1 px-1 py-3 text-[10px] font-semibold ${
                  active ? "text-ink-950" : "text-ink-400"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppScreen({
  activeTab,
  firstName,
  profile,
  policies,
  documents,
  claims,
  primaryPolicy,
}: {
  activeTab: AppTab;
  firstName: string;
  profile: {
    agencyName: string;
    email?: string;
    phone?: string;
    quoteHref: string;
    portalHref: string;
    phoneHref?: string;
    emailHref?: string;
  };
  policies: Policy[];
  documents: Document[];
  claims: ReturnType<typeof api.claims.listByTenant>;
  primaryPolicy?: Policy;
}) {
  const policyRows = policies.length ? policies : primaryPolicy ? [primaryPolicy] : [];
  const claimRows = claims.length
    ? claims.map((claim) => ({
        id: claim.id,
        carrierId: claim.carrierId,
        status: claim.status,
      }))
    : [
        {
          id: "sample-claim",
          carrierId: primaryPolicy?.carrierId,
          status: "open",
        },
      ];

  if (activeTab === "policies") {
    return (
      <PhoneStack title="Policies" subtitle="Active coverage and carrier documents.">
        {policyRows.map((policy) => (
          <PhoneRow
            key={policy.id}
            title={fmt.policyRef(policy)}
            meta={`${carrierName(policy.carrierId)} - ${fmt.money(policy.finalPremium ?? policy.premiumEstimate ?? 0)}`}
            right={policy.renewalStatus === "upcoming" ? "Renewal soon" : "Bound"}
          />
        ))}
        <PhoneAction href={profile.portalHref} icon={<ShieldCheck className="h-4 w-4" />} label="Open policy portal" />
      </PhoneStack>
    );
  }

  if (activeTab === "documents") {
    return (
      <PhoneStack title="Documents" subtitle="Shared files, e-sign packets, and proof of insurance.">
        {documents.slice(0, 5).map((doc) => (
          <PhoneRow
            key={doc.id}
            title={doc.fileName}
            meta={api.helpers.documentDisplayName(doc)}
            right={doc.customerEsignRequired && !doc.customerEsignSignedAt ? "E-sign" : doc.status}
          />
        ))}
        <PhoneAction href={profile.portalHref} icon={<FileText className="h-4 w-4" />} label="View all documents" />
      </PhoneStack>
    );
  }

  if (activeTab === "claims") {
    return (
      <PhoneStack title="Claims" subtitle="Open claims, loss runs, and carrier guidance.">
        {claimRows.map((claim) => (
          <PhoneRow
            key={claim.id}
            title={claim.status === "closed" ? "Closed claim" : "Open claim"}
            meta={carrierName(claim.carrierId)}
            right={claim.status === "closed" ? "Closed" : "Active"}
          />
        ))}
        <PhoneRow title="Previous loss runs" meta="Professional PDF summary" right="Ready" />
        <PhoneAction href={profile.portalHref} icon={<LifeBuoy className="h-4 w-4" />} label="Open claims center" />
      </PhoneStack>
    );
  }

  if (activeTab === "quote") {
    return (
      <PhoneStack title="Start quote" subtitle="Mobile intake routes straight to the agency software.">
        <PhoneRow title="Personal lines" meta="Home, auto, jewelry, yacht, umbrella" right="Start" />
        <PhoneRow title="Commercial lines" meta="Business intake plus carrier applications" right="Start" />
        <PhoneRow title="Upload documents" meta="Camera, files, or pasted images" right="AI read" />
        <PhoneAction href={profile.quoteHref} icon={<Sparkles className="h-4 w-4" />} label="Begin quote intake" />
      </PhoneStack>
    );
  }

  return (
    <div className="space-y-3 pt-2">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Welcome back</div>
        <h2 className="mt-1 font-display text-3xl">Hi, {firstName}.</h2>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <PhoneMetric label="Policies" value={`${policies.length || 2}`} />
        <PhoneMetric label="Docs" value={`${documents.length || 5}`} />
        <PhoneMetric label="Claims" value={`${claims.length || 1}`} />
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-gold-600" />
          <div className="text-sm font-semibold">Next important date</div>
        </div>
        <div className="mt-2 text-2xl font-semibold">
          {primaryPolicy?.nextPaymentDueDate ? fmt.date(primaryPolicy.nextPaymentDueDate) : "Sep 2, 2026"}
        </div>
        <div className="mt-1 text-xs text-ink-500">Carrier billing reminder and renewal timeline.</div>
      </div>
      <PhoneRow title="Message from your advisor" meta="Documents sent for review" right="Today" />
      <PhoneRow title="Billing path" meta="Direct bill through carrier" right="Current" />
      <div className="grid grid-cols-2 gap-2">
        <PhoneAction href={profile.phoneHref} icon={<Phone className="h-4 w-4" />} label="Call" disabled={!profile.phoneHref} />
        <PhoneAction href={profile.emailHref} icon={<Mail className="h-4 w-4" />} label="Email" disabled={!profile.emailHref} />
      </div>
    </div>
  );
}

function PhoneStack({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="space-y-3 pt-2">
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-ink-400">{title}</div>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function PhoneMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-3 text-center shadow-sm">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-400">{label}</div>
    </div>
  );
}

function PhoneRow({ title, meta, right }: { title: string; meta: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-sm">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink-950">{title}</div>
        <div className="mt-0.5 truncate text-xs text-ink-500">{meta}</div>
      </div>
      {right && (
        <div className="shrink-0 rounded-full bg-ink-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-ink-700">
          {right}
        </div>
      )}
    </div>
  );
}

function PhoneAction({
  href,
  icon,
  label,
  disabled,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
}) {
  if (disabled || !href) {
    return (
      <span className="flex items-center justify-center gap-2 rounded-2xl bg-ink-100 px-4 py-3 text-sm font-semibold text-ink-400">
        {icon}
        {label}
      </span>
    );
  }
  return (
    <a href={href} className="flex items-center justify-center gap-2 rounded-2xl bg-ink-950 px-4 py-3 text-sm font-semibold text-white">
      {icon}
      {label}
    </a>
  );
}

function AppFeatureCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gold-300/12 text-gold-200">
        {icon}
      </div>
      <h3 className="mt-4 font-display text-2xl text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/58">{body}</p>
    </div>
  );
}

function carrierName(carrierId?: string) {
  if (!carrierId) return "Carrier";
  return api.carriers.get(carrierId)?.name ?? "Carrier";
}
