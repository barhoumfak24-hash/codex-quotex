import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { useAuth } from "@/lib/auth";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  // Optional red alert count rendered on the right side of the row.
  // Zero / undefined → no badge. Numbers above 99 render as "99+".
  badge?: number;
}

export function PortalShell({
  nav,
  subtitle,
  topRight,
}: {
  nav: NavItem[];
  subtitle: string;
  topRight?: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-ink-50">
      <DemoBanner />
      <div className="flex-1 flex">
      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r border-ink-100 bg-white">
        <div className="px-5 py-5 hairline">
          <div className="flex items-center justify-between gap-2">
            <Logo subtitle={subtitle} />
            <DemoModeBadge />
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium ${
                  isActive
                    ? "bg-ink-900 text-white"
                    : "text-ink-700 hover:bg-ink-100"
                }`
              }
            >
              <span className="h-4 w-4">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && item.badge > 0 ? (
                // Same alert system as AlertPin — solid #E63946,
                // white text, no shadow, hairline ring for legibility
                // on the dark nav rail's hover/active tints.
                <span
                  className="ml-auto inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-alert px-[5px] text-[10px] font-semibold tabular-nums leading-none text-white ring-1 ring-white/40"
                  aria-label={`${item.badge} ${item.badge === 1 ? "alert" : "alerts"}`}
                >
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-ink-100">
          {user && (
            <div className="px-3 py-2 mb-1 text-xs">
              <div className="text-ink-900 font-medium truncate">{user.name}</div>
              <div className="text-ink-500 truncate">{user.email}</div>
              <div className="mt-1 inline-flex items-center text-[10px] uppercase tracking-wider text-gold-700">
                {user.role.replace("_", " ")}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate("/");
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-ink-700 hover:bg-ink-100"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-ink-100">
          <Logo subtitle={subtitle} />
          <button
            type="button"
            onClick={() => {
              signOut();
              navigate("/");
            }}
            className="text-ink-700 text-sm"
          >
            Sign out
          </button>
        </header>
        {topRight && <div className="px-6 py-3 bg-white border-b border-ink-100">{topRight}</div>}
        <main className="flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      </div>
    </div>
  );
}