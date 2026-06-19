import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Building2, CheckCircle2, Mail, Phone, Send } from "lucide-react";
import { QuotexMark } from "@/components/layout/Logo";
import { QuotexSiteFooter } from "@/components/layout/QuotexSiteFooter";

const CONTACT_METHODS = [
  {
    icon: <Mail className="h-5 w-5" />,
    label: "Email",
    value: "hello@quotexinsurance.example",
  },
  {
    icon: <Phone className="h-5 w-5" />,
    label: "Phone",
    value: "+1 (555) 300-0300",
  },
  {
    icon: <Building2 className="h-5 w-5" />,
    label: "Office",
    value: "Palm Coast, FL",
  },
];

export function QuotexContactPage() {
  const [submitted, setSubmitted] = useState(false);

  function submitDemoContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
            Demo contact page
          </div>
          <h1 className="mt-5 font-display text-5xl leading-tight md:text-6xl">
            Talk to Quotex Insurance.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/64">
            Placeholder contact information for now. Later, this page can use your real sales
            phone, support inbox, booking link, and routing rules.
          </p>

          <div className="mt-8 grid gap-3">
            {CONTACT_METHODS.map((method) => (
              <div
                key={method.label}
                className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4"
              >
                <div className="grid h-11 w-11 place-items-center rounded-md border border-gold-300/30 bg-gold-300/10 text-gold-200">
                  {method.icon}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/40">
                    {method.label}
                  </div>
                  <div className="mt-1 text-white">{method.value}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] md:p-7">
          {submitted ? (
            <div className="grid min-h-[390px] place-items-center text-center">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <h2 className="mt-5 text-3xl text-white">Demo message recorded</h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/58">
                  No real message was sent. Once your contact details are ready, this can connect
                  to the master portal or your preferred inbox.
                </p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="btn border-white/15 bg-white text-ink-900 hover:bg-white/90 mt-6"
                >
                  Send another
                </button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submitDemoContact}>
              <div>
                <h2 className="text-3xl text-white">Contact sales</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/55">
                  Demo-only form. Use placeholder info until final routing is connected.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    Name
                  </label>
                  <input
                    className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                    placeholder="Demo Name"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    Business email
                  </label>
                  <input
                    type="email"
                    className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                    placeholder="demo@agency.com"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Agency name
                </label>
                <input
                  className="w-full rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                  placeholder="Palm Coast Private Client"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                  Message
                </label>
                <textarea
                  className="min-h-[140px] w-full resize-none rounded-md border border-white/10 bg-white/[0.07] px-3 py-2 text-sm text-white placeholder:text-white/28 focus:border-gold-300 focus:outline-none focus:ring-2 focus:ring-gold-300/20"
                  placeholder="Tell us what you want Quotex to handle for your agency."
                  required
                />
              </div>
              <button type="submit" className="btn-gold w-full py-3 text-base">
                <Send className="h-5 w-5" />
                Send demo message
              </button>
            </form>
          )}
        </section>
      </main>

      <QuotexSiteFooter />
    </div>
  );
}
