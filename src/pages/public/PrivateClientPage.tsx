import { Link } from "react-router-dom";

export function PrivateClientPage() {
  return (
    <section className="max-w-4xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl">The Private Client experience</h1>
      <p className="mt-3 text-ink-600 leading-relaxed">
        Quotex Private Client is built for clients with complex coverage needs — coastal homes,
        yachts, fine art, and multi-state exposures. You get a dedicated agent, an AI assistant for
        intake and document organization, and a single dashboard that tracks every policy, deposit,
        and renewal across your portfolio.
      </p>
      <ol className="mt-8 space-y-5">
        {[
          "Sign in and describe what you need to insure — in your own words.",
          "Our AI structures the intake and flags missing documents. Your licensed agent reviews everything.",
          "Receive a preliminary range, deposit to lock the carrier review slot, and bind once approved.",
        ].map((step, i) => (
          <li key={step} className="flex gap-4">
            <span className="h-7 w-7 shrink-0 rounded-full bg-ink-900 text-gold-300 font-display text-base flex items-center justify-center">
              {i + 1}
            </span>
            <p className="text-ink-700 leading-relaxed">{step}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10">
        <Link to="/quote/start" className="btn-gold">
          Get a Private Quote
        </Link>
      </div>
    </section>
  );
}