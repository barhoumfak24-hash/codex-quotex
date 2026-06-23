import { Link } from "react-router-dom";

const updated = "June 20, 2026";

function LegalShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-4xl px-6 py-16">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-700">
        {eyebrow}
      </div>
      <h1 className="mt-3 font-display text-4xl text-ink-950">{title}</h1>
      <p className="mt-3 text-sm text-ink-500">Last updated: {updated}</p>
      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-700">
        {children}
      </div>
      <div className="mt-10 rounded-md border border-gold-200 bg-gold-50 px-4 py-3 text-xs leading-relaxed text-ink-700">
        These pages are operational platform disclosures for the current product build.
        Final production language should be reviewed by counsel for each operating
        entity, state footprint, and agency deployment.
      </div>
    </section>
  );
}

function LegalBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-semibold text-ink-950">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell eyebrow="Privacy" title="Privacy Policy">
      <LegalBlock title="Information we collect">
        <p>
          Quotex and participating agencies may collect account information,
          contact information, policy and quote information, uploaded documents,
          messages, signatures, payment-related records, device and usage
          metadata, and information submitted through agency websites, client
          portals, quote workflows, and staff workspaces.
        </p>
      </LegalBlock>

      <LegalBlock title="How information is used">
        <p>
          Information is used to operate the platform, support agency workflows,
          prepare insurance submissions, communicate with clients and carriers,
          process authorized transactions, secure accounts, investigate errors,
          maintain audit trails, and improve product reliability.
        </p>
      </LegalBlock>

      <LegalBlock title="AI-assisted processing">
        <p>
          Quotex may use AI systems to classify, extract, summarize, draft, map,
          and route information. AI output is assistive and may require review by
          licensed agency staff before it is used for insurance, payment, legal,
          or customer-facing decisions.
        </p>
      </LegalBlock>

      <LegalBlock title="Sharing and service providers">
        <p>
          Information may be shared with the agency connected to the account,
          authorized staff, carriers, payment processors, email/SMS providers,
          storage providers, analytics/error-monitoring providers, and other
          vendors that help operate the service. Quotex does not sell sensitive
          insurance records.
        </p>
      </LegalBlock>

      <LegalBlock title="Security and retention">
        <p>
          Production deployments should use tenant isolation, role-based access,
          row-level security, encrypted secrets, private document storage,
          backups, audit logs, and least-privilege access. Records are retained
          as needed for service delivery, legal obligations, audit history, and
          agency instructions.
        </p>
      </LegalBlock>

      <LegalBlock title="Marketing choices">
        <p>
          Marketing emails should include an opt-out mechanism. SMS messages
          should honor STOP/HELP handling where SMS is enabled. Users may also
          contact their agency or Quotex support to update communication
          preferences.
        </p>
      </LegalBlock>

      <LegalBlock title="Questions">
        <p>
          Contact <Link className="text-gold-700 underline" to="/contact">support</Link>{" "}
          for privacy questions, data access requests, or communication
          preference updates.
        </p>
      </LegalBlock>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell eyebrow="Terms" title="Terms and Conditions">
      <LegalBlock title="Use of the platform">
        <p>
          Quotex provides software for insurance agencies, staff, prospects, and
          invited clients. Users must provide accurate information, maintain
          account security, and use the platform only for authorized insurance
          and agency operations.
        </p>
      </LegalBlock>

      <LegalBlock title="Insurance activity">
        <p>
          Quotex is an operating system and workflow platform. It does not bind
          insurance coverage, issue policies, guarantee premiums, or replace
          licensed insurance advice. Final coverage, pricing, underwriting,
          binding, and policy decisions remain subject to the applicable agency,
          carrier, licensed personnel, and final carrier documents.
        </p>
      </LegalBlock>

      <LegalBlock title="AI output">
        <p>
          AI-generated drafts, mappings, summaries, questionnaires, quote
          rankings, and document outputs are assistive. Users are responsible for
          reviewing AI output before relying on it or sending it externally.
        </p>
      </LegalBlock>

      <LegalBlock title="Documents and electronic signatures">
        <p>
          Uploaded documents, generated PDFs, electronic acknowledgements, and
          signatures may be retained as business records. Users should review
          documents carefully before signing or sending them.
        </p>
      </LegalBlock>

      <LegalBlock title="Payments and subscriptions">
        <p>
          Paid services, deposits, subscriptions, add-ons, renewals, and refunds
          are governed by the signed agreement, checkout terms, and applicable
          payment processor rules.
        </p>
      </LegalBlock>

      <LegalBlock title="Acceptable use">
        <p>
          Users may not misuse the platform, attempt unauthorized access, upload
          malicious files, interfere with security controls, impersonate others,
          or use the service for unlawful communications or transactions.
        </p>
      </LegalBlock>

      <LegalBlock title="Contact">
        <p>
          Questions about these terms can be sent through the{" "}
          <Link className="text-gold-700 underline" to="/contact">contact page</Link>.
        </p>
      </LegalBlock>
    </LegalShell>
  );
}
