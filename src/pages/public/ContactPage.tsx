import { useState } from "react";
import { Mail, MapPin, Phone, Send } from "lucide-react";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { useDemoNotice } from "@/lib/demo";

export function ContactPage() {
  const [sent, setSent] = useState(false);
  const showDemoNotice = useDemoNotice();

  return (
    <section className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-5 gap-10">
      <div className="md:col-span-2">
        <h1 className="font-display text-4xl">Contact us</h1>
        <p className="mt-3 text-ink-600 leading-relaxed">
          For private client inquiries, partnership questions, or to demo the platform.
        </p>
        <ul className="mt-8 space-y-4 text-sm">
          <li className="flex items-start gap-3">
            <Mail className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Email</div>
              <div className="text-ink-900">hello@example-agency.example</div>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <Phone className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Phone</div>
              <div className="text-ink-900">+1 (555) 010-0000</div>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <MapPin className="h-4 w-4 mt-0.5 text-gold-600" />
            <div>
              <div className="text-ink-500 text-xs uppercase tracking-wider">Address</div>
              <div className="text-ink-900">100 Demo Lane, Sample City, ST 00000</div>
            </div>
          </li>
        </ul>
      </div>

      <div className="md:col-span-3">
        <div className="card !p-6">
          {sent ? (
            <div className="text-center py-8">
              <div className="font-display text-xl text-ink-900">Thank you — message recorded</div>
              <p className="mt-2 text-sm text-ink-600">
                Demo only. No message was actually sent.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4">
                <Disclaimer>
                  Demo only — please don't enter real personal information. Submissions aren't
                  delivered anywhere.
                </Disclaimer>
              </div>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  showDemoNotice({
                    feature: "Contact form",
                    title: "Contact form delivery is disabled in the demo",
                    body: "In production this routes to the agency's inbox via SendGrid/SES with an audit trail. For the demo we just confirm receipt locally.",
                  });
                  setSent(true);
                }}
              >
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Name</label>
                    <input className="input" placeholder="Demo Name" required />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input type="email" className="input" placeholder="demo@example.com" required />
                  </div>
                </div>
                <div>
                  <label className="label">How can we help?</label>
                  <textarea className="input min-h-[120px]" required />
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