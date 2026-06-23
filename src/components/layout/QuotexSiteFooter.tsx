import { Link } from "react-router-dom";
import {
  QUOTEX_CONTACT_EMAIL,
  QUOTEX_CONTACT_EMAIL_HREF,
  QUOTEX_CONTACT_PHONE,
  QUOTEX_CONTACT_PHONE_HREF,
  QUOTEX_SUPPORT_EMAIL,
} from "@/lib/quotexContact";
import { QuotexMark } from "./Logo";

export function QuotexSiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-[#080807] text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm md:grid-cols-[1.1fr_0.7fr_0.7fr] md:px-8">
        <div>
          <Link to="/" className="inline-flex items-center gap-3">
            <QuotexMark
              className="h-10 w-10 ring-1 ring-white/15"
              letterClassName="text-[25px]"
            />
            <span>
              <span className="block font-display text-xl leading-none">Quotex Insurance</span>
              <span className="mt-1.5 block text-[11px] font-medium leading-none text-white/45">
                Agency operating system
              </span>
            </span>
          </Link>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/55">
            AI-powered agency software for private-client insurance teams.
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Explore
          </div>
          <ul className="mt-3 space-y-2 text-white/70">
            <li>
              <Link className="hover:text-white" to="/checkout">
                Build my plan
              </Link>
            </li>
            <li>
              <Link className="hover:text-white" to="/contact">
                Contact
              </Link>
            </li>
            <li>
              <Link className="hover:text-white" to="/employee/login">
                Agency sign in
              </Link>
            </li>
            <li>
              <Link className="hover:text-white" to="/privacy">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link className="hover:text-white" to="/terms">
                Terms
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
            Contact
          </div>
          <ul className="mt-3 space-y-2 text-white/70">
            <li>
              <a className="hover:text-white" href={QUOTEX_CONTACT_EMAIL_HREF}>
                {QUOTEX_CONTACT_EMAIL}
              </a>
            </li>
            <li>
              <Link className="hover:text-white" to="/support">
                Support: {QUOTEX_SUPPORT_EMAIL}
              </Link>
            </li>
            <li>
              <a className="hover:text-white" href={QUOTEX_CONTACT_PHONE_HREF}>
                {QUOTEX_CONTACT_PHONE}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-4 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between md:px-8">
          <span>Copyright {new Date().getFullYear()} Quotex Insurance.</span>
          <Link
            to="/master/login"
            className="w-fit text-[10px] uppercase tracking-[0.22em] text-white/20 transition hover:text-white/45"
            aria-label="System"
          >
            system
          </Link>
        </div>
      </div>
    </footer>
  );
}
