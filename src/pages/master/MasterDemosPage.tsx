import { type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Globe2,
  MessagesSquare,
  MonitorPlay,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useTenant } from "@/lib/tenant";

const DEMO_AGENCY_ID = "agency_palmcoast";
const DEMO_CUSTOMER_ID = "customer_demo";
const DEMO_SOFTWARE_CLIENT_PATH = `/master/demos/software/clients/${DEMO_CUSTOMER_ID}`;

export function MasterDemosPage() {
  const navigate = useNavigate();
  const { setAgencyId } = useTenant();
  const agency = api.agencies.get(DEMO_AGENCY_ID);
  const customer = api.customers.get(DEMO_CUSTOMER_ID);
  const policies = api.policies.listByCustomer(DEMO_CUSTOMER_ID);
  const demoPolicyIds = new Set(policies.map((policy) => policy.id));
  const documents = api.documents
    .listByTenant(DEMO_AGENCY_ID)
    .filter((document) => document.customerId === DEMO_CUSTOMER_ID || (document.policyId ? demoPolicyIds.has(document.policyId) : false));
  const claims = api.claims.listByCustomer(DEMO_CUSTOMER_ID);
  const quoteRequests = api.quotes.listByCustomer(DEMO_CUSTOMER_ID);
  const communications = api.communications.listByCustomer(DEMO_CUSTOMER_ID);
  const activePolicies = api.policies.listActiveByCustomer(DEMO_CUSTOMER_ID);
  const totalPremium = activePolicies.reduce(
    (sum, policy) => sum + (policy.finalPremium ?? policy.premiumEstimate ?? policy.premiumBreakdown?.total ?? 0),
    0
  );
  const carrierNameFor = (carrierId: string) => api.carriers.get(carrierId)?.name ?? "Carrier";

  function launchSoftwareDemo(path: string) {
    setAgencyId(DEMO_AGENCY_ID);
    navigate(path);
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Demos</h1>
          <p className="mt-1 text-sm text-ink-500">
            Presentation-ready simulations for Quotex software, the agency website, and the client app.
          </p>
        </div>
        <Badge tone="gold">Fake Palm Coast data</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Demo agency"
          value={agency?.name ?? "Palm Coast"}
          hint="Private-client simulation"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Demo client"
          value={customer?.name ?? "Alexandra Whitford"}
          hint={`${activePolicies.length} active policies`}
          icon={<UserRound className="h-5 w-5" />}
        />
        <StatCard
          label="Annual premium"
          value={fmt.money(totalPremium)}
          hint="Seeded policy book"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <StatCard
          label="Quote flows"
          value={quoteRequests.length}
          hint="AI workspace examples"
          icon={<MonitorPlay className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <DemoSurfaceCard
          icon={<MonitorPlay className="h-6 w-6" />}
          eyebrow="Software"
          title="Agency workspace demo"
          body="Open the Palm Coast operating system with clients, policies, messages, documents, activity, and AI quoting already populated."
          details={[
            `${policies.length} policies`,
            `${documents.length} documents`,
            `${communications.length} messages`,
            `${quoteRequests.length} quote workflows`,
          ]}
          primaryAction={
            <button
              type="button"
              className="btn-primary w-full justify-between"
              onClick={() => launchSoftwareDemo(DEMO_SOFTWARE_CLIENT_PATH)}
            >
              Open software demo
              <ArrowRight className="h-4 w-4" />
            </button>
          }
          secondaryAction={
            <button
              type="button"
              className="btn-outline w-full justify-between"
              onClick={() => launchSoftwareDemo(`${DEMO_SOFTWARE_CLIENT_PATH}?quoteWorkspace=expanded`)}
            >
              Open AI quote demo
              <ArrowRight className="h-4 w-4" />
            </button>
          }
        />

        <DemoSurfaceCard
          icon={<Globe2 className="h-6 w-6" />}
          eyebrow="Website"
          title="Agency website demo"
          body="Show the branded public agency website with quote intake, services, private-client positioning, and customer portal entry points."
          details={[
            "Palm Coast branding",
            "Quote intake",
            "Client sign-in",
            "Service pages",
          ]}
          primaryAction={
            <Link to="/agency" className="btn-primary w-full justify-between">
              Open website demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
          secondaryAction={
            <Link to="/agency/quote/start" className="btn-outline w-full justify-between">
              Open quote intake
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />

        <DemoSurfaceCard
          icon={<Smartphone className="h-6 w-6" />}
          eyebrow="Client app"
          title="Mobile app demo"
          body="Present the phone-framed Quotex client app simulation with fake policies, documents, claims, and contact actions visible."
          details={[
            "Phone frame",
            `${activePolicies.length} active policies`,
            `${claims.length} claims`,
            "Filled document cards",
          ]}
          primaryAction={
            <Link to="/demo/app" className="btn-primary w-full justify-between">
              Open app demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
          secondaryAction={
            <Link to="/agency-app" className="btn-outline w-full justify-between">
              Open live app shell
              <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Simulation contents"
          subtitle="Use this as the stable fake data set for customer presentations."
          action={<Badge tone="success">Ready</Badge>}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DemoDataTile
            icon={<UserRound className="h-5 w-5" />}
            title={customer?.name ?? "Alexandra Whitford"}
            rows={[
              customer?.email ?? "alexandra.whitford@example.com",
              customer?.mailingAddress ?? "44 Sea Breeze Ln, Palm Beach, FL 33480",
            ]}
          />
          <DemoDataTile
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Policy book"
            rows={activePolicies.slice(0, 3).map((policy) => `${carrierNameFor(policy.carrierId)} - ${policy.policyNumber ?? "Pending number"}`)}
          />
          <DemoDataTile
            icon={<FileText className="h-5 w-5" />}
            title="Documents"
            rows={documents.slice(0, 3).map((document) => document.fileName)}
          />
          <DemoDataTile
            icon={<MessagesSquare className="h-5 w-5" />}
            title="Client communication"
            rows={communications.slice(0, 3).map((message) => message.subject || message.body.slice(0, 48))}
          />
        </div>
      </Card>
    </div>
  );
}

function DemoSurfaceCard({
  icon,
  eyebrow,
  title,
  body,
  details,
  primaryAction,
  secondaryAction,
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  details: string[];
  primaryAction: ReactNode;
  secondaryAction: ReactNode;
}) {
  return (
    <Card className="flex min-h-full flex-col">
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-gold-200 bg-gold-50 text-gold-700">
          {icon}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-700">{eyebrow}</div>
          <h2 className="mt-1 text-xl font-semibold text-ink-950">{title}</h2>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-ink-600">{body}</p>
      <div className="mt-5 grid gap-2">
        {details.map((detail) => (
          <div key={detail} className="flex items-center gap-2 text-sm text-ink-700">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{detail}</span>
          </div>
        ))}
      </div>
      <div className="mt-auto grid gap-2 pt-6">
        {primaryAction}
        {secondaryAction}
      </div>
    </Card>
  );
}

function DemoDataTile({
  icon,
  title,
  rows,
}: {
  icon: ReactNode;
  title: string;
  rows: string[];
}) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <span className="text-gold-600">{icon}</span>
        {title}
      </div>
      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-ink-600">
        {rows.length > 0 ? rows.map((row) => <li key={row}>{row}</li>) : <li>No demo rows loaded.</li>}
      </ul>
    </div>
  );
}
