import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, MapPin, Phone, Send } from "lucide-react";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { api } from "@/lib/api";
import { getAppSurface } from "@/lib/appSurface";
import { useDemoNotice } from "@/lib/demo";
import { toTelHref } from "@/lib/phone";
import { useTenant } from "@/lib/tenant";
import { useCustomer } from "@/lib/useCustomer";
import { submitWebsiteLead } from "@/lib/websiteApi";

export function ContactPage() {
  const [sent, setSent] = useState(false);
  const showDemoNotice = useDemoNotice();
  const { agency } = useTenant();
  const customer = useCustomer();
  const isAppSurface = getAppSurface() === "agencyApp";
  const assignedAgent = customer?.assignedAgentId
    ? api.users.get(customer.assignedAgentId)
    : undefined;
  const agencyPhone = agency?.phone ?? "+1 (555) 010-0000";
  const agentPhone = assignedAgent?.phone;
  const agentContactPhone = agentPhone ?? agencyPhone;
  const agentContactHref = toTelHref(agentContactPhone);
  const agentPhoneHref = toTelHref(agentPhone);
  const agencyPhoneHref = toTelHref(agencyPhone);
  const agentName = assignedAgent?.name ?? "Your assigned agent";
  const agentEmail = assignedAgent?.businessEmail ?? assignedAgent?.email ?? agency?.contactEmail;
  const agentEmailHref = agentEmail ? `mailto:${agentEmail}` : undefined;
  const contactEmail = agency?.contactEmail ?? "hello@example-agency.example";
  const contactAddress = agency?.address ?? "100 Demo Lane, Sample City, ST 00000";
  const emailHref = `mailto:${contactEmail}`;
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contactAddress)}`;

  function handleContactSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submitWebsiteLead({
      agencyId: agency?.id,
      source: "contact",
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      message: String(data.get("message") ?? ""),
    });
    showDemoNotice({
      feature: "Contact form",
      title: "Contact form delivery is disabled in the demo",
      body: "In production this posts to /api/website/prospects, creates a tenant-scoped prospect, and routes the activity into the agency workspace.",
    });
    setSent(true);
  }

  if (isAppSurface) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-4 overflow-hidden bg-gradient-to-b from-[#fbf7ee] via-white to-white px-5 py-5">
        <div className="flex shrink-0 items-center gap-3">
          <Link
            to="/"
            aria-label="Back to app home"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ink-200 bg-white text-ink-900 shadow-sm"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-700">
              Client mobile app
            </div>
            <h1 className="font-display text-3xl leading-none text-ink-900">Contact us</h1>
          </div>
        </div>

        <div className="shrink-0 rounded-3xl border border-gold-200 bg-gold-50/70 p-5 shadow-luxe">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-800">
            Your personal agent
          </div>
          <div className="mt-2 text-lg font-semibold text-ink-900">{agentName}</div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {agentContactHref && (
              <a href={agentContactHref} className="btn-primary min-h-[50px] rounded-2xl px-3 text-sm">
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
            {agentEmailHref && agentEmail && (
              <a
                href={agentEmailHref}
                className="flex min-h-[50px] items-center justify-center gap-2 rounded-2xl border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-900 shadow-sm"
              >
                <Mail className="h-4 w-4" /> Email
              </a>
            )}
          </div>
        </div>

        <div className="shrink-0 rounded-3xl border border-ink-100 bg-white p-5 text-sm shadow-luxe">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold-800">
            Agency contact
          </div>
          <div className="mt-2 truncate text-lg font-semibold text-ink-900">{agency?.name ?? "Your agency"}</div>
          <div className="mt-3 grid gap-2">
          {agencyPhoneHref && (
            <a
              href={agencyPhoneHref}
              className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-3 py-2 text-left text-ink-900 shadow-sm"
            >
              <Phone className="h-4 w-4 shrink-0 text-gold-600" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Agency phone
                </div>
                <div className="truncate text-sm font-semibold">{agencyPhone}</div>
              </div>
            </a>
          )}
            <a
              href={emailHref}
              className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-3 py-2 text-left text-ink-900 shadow-sm"
            >
              <Mail className="h-4 w-4 shrink-0 text-gold-600" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Agency email
                </div>
                <div className="truncate text-sm font-semibold">{contactEmail}</div>
              </div>
            </a>
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-3 py-2 text-left text-ink-900 shadow-sm"
            >
              <MapPin className="h-4 w-4 shrink-0 text-gold-600" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Address
                </div>
                <div className="truncate text-sm font-semibold">{contactAddress}</div>
              </div>
            </a>
          </div>
        </div>

        <div className="shrink-0">
          <div className="rounded-3xl border border-ink-100 bg-white p-5 shadow-luxe">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-500">
              Secure message
            </div>
            {sent ? (
              <div className="mt-2 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800">
                Message sent to the agency portal.
              </div>
            ) : (
              <form
                className="mt-2.5 space-y-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSent(true);
                }}
              >
                <textarea
                  name="message"
                  className="input min-h-[104px] resize-none rounded-2xl text-sm"
                  placeholder="Type your message..."
                  required
                />
                <button type="submit" className="btn-gold min-h-[50px] w-full rounded-2xl">
                  <Send className="h-4 w-4" /> Send
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-5 gap-10">
      <div className="md:col-span-2">
        <h1 className="font-display text-4xl">Contact us</h1>
        <p className="mt-3 text-ink-600 leading-relaxed">
          For private client inquiries, policy questions, or quote support.
        </p>
        <ul className="mt-8 space-y-4 text-sm">
          <li className="flex items-start gap-3">
            <Mail className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Email</div>
              <a className="text-ink-900 underline-offset-4 hover:underline" href={emailHref}>
                {contactEmail}
              </a>
            </div>
          </li>
          {agentPhoneHref && agentPhone && (
            <li className="flex items-start gap-3">
              <Phone className="h-4 w-4 mt-0.5 text-gold-600" />
              <div>
                <div className="text-ink-500 text-xs uppercase tracking-wider">Agent phone</div>
                <a className="text-ink-900 underline-offset-4 hover:underline" href={agentPhoneHref}>
                  {agentPhone}
                </a>
              </div>
            </li>
          )}
          <li className="flex items-start gap-3">
            <Phone className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Agency phone</div>
              {agencyPhoneHref ? (
                <a className="text-ink-900 underline-offset-4 hover:underline" href={agencyPhoneHref}>
                  {agencyPhone}
                </a>
              ) : (
                <div className="text-ink-900">{agencyPhone}</div>
              )}
            </div>
          </li>
          <li className="flex items-start gap-3">
            <MapPin className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Address</div>
              <a
                className="text-ink-900 underline-offset-4 hover:underline"
                href={mapsHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {contactAddress}
              </a>
            </div>
          </li>
        </ul>
      </div>

      <div className="md:col-span-3">
        <div className="card !p-6">
          {sent ? (
            <div className="text-center py-8">
              <div className="font-display text-xl text-ink-900">Thank you - message recorded</div>
              <p className="mt-2 text-sm text-ink-600">
                Demo only. No message was actually sent.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Disclaimer>
                  Demo only - please do not enter real personal information. Submissions are not
                  delivered unless the website API is configured.
                </Disclaimer>
              </div>
              <form
                className="space-y-3"
                onSubmit={handleContactSubmit}
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Name</label>
                    <input name="name" className="input" placeholder="Demo Name" required />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input name="email" type="email" className="input" placeholder="demo@example.com" required />
                  </div>
                </div>
                <div>
                  <label className="label">How can we help?</label>
                  <textarea name="message" className="input min-h-[120px]" required />
                </div>
                <button type="submit" className="btn-primary">
                  <Send className="h-4 w-4" /> Send message
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
