import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Mail, Phone, Send } from "lucide-react";
import { QuotexMark } from "@/components/layout/Logo";
import { QuotexSiteFooter } from "@/components/layout/QuotexSiteFooter";
import {
  QUOTEX_CONTACT_EMAIL,
  QUOTEX_CONTACT_EMAIL_HREF,
  QUOTEX_CONTACT_PHONE,
  QUOTEX_CONTACT_PHONE_HREF,
  QUOTEX_SUPPORT_EMAIL,
  QUOTEX_SUPPORT_EMAIL_HREF,
} from "@/lib/quotexContact";
import { submitWebsiteLead } from "@/lib/websiteApi";

const CONTACT_METHODS: Array<{
  icon: ReactNode;
  label: string;
  value: string;
  href?: string;
}> = [
  {
    icon: <Mail className="h-5 w-5" />,
    label: "Sales",
    value: QUOTEX_CONTACT_EMAIL,
    href: QUOTEX_CONTACT_EMAIL_HREF,
  },
  {
    icon: <Mail className="h-5 w-5" />,
    label: "Support",
    value: QUOTEX_SUPPORT_EMAIL,
    href: QUOTEX_SUPPORT_EMAIL_HREF,
  },
  {
    icon: <Phone className="h-5 w-5" />,
    label: "Phone",
    value: QUOTEX_CONTACT_PHONE,
    href: QUOTEX_CONTACT_PHONE_HREF,
  },
];

export function QuotexContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const delivered = await submitWebsiteLead({
      source: "contact",
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      message: [
        `Agency: ${String(form.get("agencyName") ?? "")}`,
        String(form.get("message") ?? ""),
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    setSubmitting(false);
    if (!delivered) {
      setError(
        `The message could not be delivered automatically. Please email ${QUOTEX_CONTACT_EMAIL} or ${QUOTEX_SUPPORT_EMAIL} directly.`
      );
      return;
    }
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-ink-900 text-white">
      <header className="border-b border-white/10 bg-[#080807]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
          <Link to="/" className="flex items-center gap-3">
            <QuotexMark
              className="h-10 w-10 ring-1 ring-white/15"
              letterClassName="text-[25px]"
            />
            <span>
              <span className="block font-display text-xl leading-none">Quotex Insurance</span>
              <span className="block text-xs uppercase tracking-[0.18em] text-white/45">
                Contact
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="btn border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14]"
            >
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
            <Link to="/checkout" className="btn-gold hidden sm:inline-flex">
              Build my plan
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-12 md:grid-cols-[0.9fr_1.1fr] md:px-8 md:py-16">
        <section>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-gold-200">
            Contact
          </div>
          <h1 className="mt-5 font-display text-5xl leading-tight md:text-6xl">
            Talk to Quotex Insurance.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/64">
            Reach the Quotex team for sales, onboarding, support, or deployment questions.
          </p>

          <div className="mt-8 grid gap-3">
            {CONTACT_METHODS.map((method) => {
              const cardContent = (
                <>
                <div className="grid h-11 w-11 place-items-center rounded-md border border-gold-300/30 bg-gold-300/10 text-gold-200">
                  {method.icon}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                    {method.label}
                  </div>
                  <div className="mt-1 text-white">{method.value}</div>
                </div>
                </>
              );

              return method.href ? (
                <a
                  key={method.label}
                  href={method.href}
                  className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4"
                >
                  {cardContent}
                </a>
              ) : (
                <div
                  key={method.label}
                  className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4"
                >
                  {cardContent}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] md:p-7">
          {submitted ? (
            <div className="grid min-h-[390px] place-items-center text-center">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h2 className="mt-5 text-3xl text-white">Message received</h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/58">
                  Your request was recorded for follow-up. The team will respond from {QUOTEX_SUPPORT_EMAIL}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setError("");
                  }}
                  className="btn border-white/15 bg-white text-ink-900 hover:bg-white/90 mt-6"
                >
                  Send another
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submitContact}>
              <div>
                <h2 className="text-3xl text-white">Contact sales</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  Tell us where to follow up and what you want Quotex to handle.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    Name
                  </label>
                  <input
                    name="name"
                    className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    Business email
                  </label>
                  <input
                    type="email"
                    name="email"
                    className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Agency name
                </label>
                <input
                  name="agencyName"
                  className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Phone
                </label>
                  <input
                    name="phone"
                    className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                  />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Message
                </label>
                <textarea
                  name="message"
                  className="min-h-[140px] w-full resize-none rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                  required
                />
              </div>
              {error && (
                <div className="rounded-md border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm leading-relaxed text-red-100">
                  {error}
                </div>
              )}
              <button type="submit" className="btn-gold w-full py-3 text-base" disabled={submitting}>
                <Send className="h-5 w-5" />
                {submitting ? "Sending..." : "Send message"}
              </button>
            </form>
          )}
        </section>
      </main>

      <QuotexSiteFooter />
    </div>
  );
}
