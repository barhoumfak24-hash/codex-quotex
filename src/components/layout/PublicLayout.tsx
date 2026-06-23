import { Link, Outlet, useLocation } from "react-router-dom";
import { Logo } from "./Logo";
import { buildAgencyWebsiteProfile } from "@/lib/agencyWebsite";
import { getAppSurface, toSurfaceRoute } from "@/lib/appSurface";
import {
  QUOTEX_CONTACT_EMAIL,
  QUOTEX_CONTACT_PHONE,
  QUOTEX_SUPPORT_EMAIL,
  QUOTEX_SUPPORT_EMAIL_HREF,
} from "@/lib/quotexContact";
import { useTenant } from "@/lib/tenant";

export function PublicLayout() {
  const { pathname } = useLocation();
  const { agency } = useTenant();
  const profile = agency ? buildAgencyWebsiteProfile(agency) : null;
  const brandName = profile?.agencyName ?? "Quotex Insurance";
  const isAppSurface = getAppSurface() === "agencyApp";
  const navLinkClass = isAppSurface
    ? "shrink-0 rounded-full border border-ink-100 bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:text-ink-900"
    : "px-3 py-2 text-ink-700 hover:text-ink-900";
  const route = (path: string) => toSurfaceRoute(path, pathname);

  return (
    <div
      className={
        isAppSurface
          ? "flex h-full min-h-full flex-col"
          : "min-h-screen flex flex-col"
      }
    >
      {!isAppSurface && <header className="bg-white border-b border-ink-100">
        <div
          className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Logo
              brandName={brandName}
              brandColor={profile?.brandColor}
              logoUrl={profile?.logoUrl}
            />
          </div>
          {!isAppSurface && (
            <nav className="flex items-center gap-0.5 text-sm flex-wrap justify-end">
              <Link className={navLinkClass} to={route("/services")}>
                Services
              </Link>
              <Link className={navLinkClass} to={route("/about")}>
                About
              </Link>
              <Link className={navLinkClass} to={route("/contact")}>
                Contact
              </Link>
              <Link className="px-3 py-2 text-ink-700 hover:text-ink-900 ml-2" to={route("/login")}>
                Sign in
              </Link>
              <Link to={route("/quote/start")} className="btn-gold ml-2">
                Get a Quote
              </Link>
            </nav>
          )}
        </div>
      </header>}
      <main className={isAppSurface ? "h-full min-h-0 flex-1" : "flex-1"}>
        <Outlet />
      </main>
      {!isAppSurface && <footer className="border-t border-ink-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 grid gap-8 md:grid-cols-3 text-sm">
          <div>
            <Logo
              brandName={brandName}
              brandColor={profile?.brandColor}
              logoUrl={profile?.logoUrl}
            />
            <p className="mt-3 text-xs text-ink-500 max-w-xs leading-relaxed">
              AI-assisted private client insurance. Every output is preliminary; final decisions
              remain with licensed agents.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Customers
            </div>
            <ul className="space-y-1.5 text-ink-700">
              <li><Link className="hover:text-ink-900" to={route("/services")}>Services</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/about")}>About</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/contact")}>Contact</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/login")}>Sign in</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/quote/start")}>Get a Quote</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/privacy")}>Privacy Policy</Link></li>
              <li><Link className="hover:text-ink-900" to={route("/terms")}>Terms</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Client support: {QUOTEX_SUPPORT_EMAIL}
            </div>
            <ul className="space-y-1.5 text-ink-700">
              <li>
                <a className="hover:text-ink-900" href={QUOTEX_SUPPORT_EMAIL_HREF}>
                  {QUOTEX_SUPPORT_EMAIL}
                </a>
              </li>
              <li>{profile?.contactEmail ?? QUOTEX_CONTACT_EMAIL}</li>
              <li>{profile?.phone ?? QUOTEX_CONTACT_PHONE}</li>
              <li><Link className="hover:text-ink-900" to={route("/customer")}>Client dashboard</Link></li>
            </ul>
            <p className="mt-3 text-[11px] text-ink-400 leading-relaxed">
              Client portal access is for policyholders and invited contacts. Agency staff use the
              separate Quotex software workspace.
            </p>
          </div>
        </div>
        <div className="border-t border-ink-100">
          <div className="max-w-7xl mx-auto px-6 py-4 text-xs text-ink-500 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} {brandName}. All rights reserved.</div>
            <div className="text-ink-400">
              AI estimates are preliminary. Final coverage decisions require a licensed agent.
            </div>
          </div>
        </div>
      </footer>}
    </div>
  );
}
