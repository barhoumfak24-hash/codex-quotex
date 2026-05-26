import { Link, Outlet } from "react-router-dom";
import { Logo } from "./Logo";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <DemoBanner />
      <header className="bg-white border-b border-ink-100">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo />
            <DemoModeBadge />
          </div>
          <nav className="flex items-center gap-0.5 text-sm flex-wrap justify-end">
            <Link className="px-3 py-2 text-ink-700 hover:text-ink-900" to="/services">
              Services
            </Link>
            <Link className="px-3 py-2 text-ink-700 hover:text-ink-900" to="/about">
              About
            </Link>
            <Link className="px-3 py-2 text-ink-700 hover:text-ink-900" to="/contact">
              Contact
            </Link>
            <Link className="px-3 py-2 text-ink-700 hover:text-ink-900 ml-2" to="/login">
              Sign in
            </Link>
            <Link to="/quote/start" className="btn-gold ml-2">
              Get a Private Quote
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-ink-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 grid gap-8 md:grid-cols-3 text-sm">
          <div>
            <Logo />
            <p className="mt-3 text-xs text-ink-500 max-w-xs leading-relaxed">
              AI-assisted private client insurance platform. Every output is preliminary; final
              decisions remain with licensed agents.
            </p>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Customers
            </div>
            <ul className="space-y-1.5 text-ink-700">
              <li><Link className="hover:text-ink-900" to="/services">Services</Link></li>
              <li><Link className="hover:text-ink-900" to="/about">About</Link></li>
              <li><Link className="hover:text-ink-900" to="/contact">Contact</Link></li>
              <li><Link className="hover:text-ink-900" to="/login">Sign in</Link></li>
              <li><Link className="hover:text-ink-900" to="/quote/start">Get a Private Quote</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-500 font-semibold mb-2">
              Staff portals
            </div>
            <ul className="space-y-1.5 text-ink-700">
              <li><Link className="hover:text-ink-900" to="/employee/login">Agent login</Link></li>
              <li><Link className="hover:text-ink-900" to="/employee/login">Manager login</Link></li>
              <li><Link className="hover:text-ink-900" to="/master/login">Master admin login</Link></li>
            </ul>
            <p className="mt-3 text-[11px] text-ink-400 leading-relaxed">
              Restricted access. Staff log in with their agency credentials; master admin requires
              MFA in production.
            </p>
          </div>
        </div>
        <div className="border-t border-ink-100">
          <div className="max-w-7xl mx-auto px-6 py-4 text-xs text-ink-500 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} Quotex Insurance. All rights reserved.</div>
            <div className="text-ink-400">
              AI estimates are preliminary. Final coverage decisions require a licensed agent.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}