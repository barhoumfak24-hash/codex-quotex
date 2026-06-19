import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Logo } from "./Logo";
import { useAuth } from "@/lib/auth";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";
import { CountBadge } from "@/components/ui/CountBadge";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { getAppSurface, toAppRoute, toSurfaceRoute } from "@/lib/appSurface";

interface NavItem {
  to: string;
  appTo?: string;
  appLabel?: string;
  appDescription?: string;
  appIcon?: ReactNode;
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
  showAccountFooter = true,
  compactSidebar = false,
}: {
  nav: NavItem[];
  subtitle: string;
  topRight?: ReactNode;
  showAccountFooter?: boolean;
  compactSidebar?: boolean;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const previousLocationRef = useRef<{ pathname: string; search: string } | null>(null);
  const isAppSurface = getAppSurface() === "agencyApp";
  const surfaceRoute = (path: string) =>
    isAppSurface ? toAppRoute(path) : toSurfaceRoute(path, location.pathname);
  const rawMenuRoot = nav.find((item) => item.end)?.to ?? nav[0]?.to ?? "/";
  const menuRoot = surfaceRoute(rawMenuRoot);
  const isMenuRoute = location.pathname === menuRoot;
  const appCategoryRoots = new Set(
    nav.filter((item) => !item.end).map((item) => surfaceRoute(item.to))
  );
  const showPortalMenuBack = !isMenuRoute && appCategoryRoots.has(location.pathname);
  const compactNavStyle = compactSidebar
    ? ({ "--employee-nav-count": nav.length } as CSSProperties)
    : undefined;
  const scrollToPageTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    const previousLocation = previousLocationRef.current;
    previousLocationRef.current = {
      pathname: location.pathname,
      search: location.search,
    };
    if (location.hash) return;
    const isMessageThreadSelection =
      location.pathname === "/employee/messages" &&
      previousLocation?.pathname === location.pathname &&
      previousLocation.search !== location.search;
    if (isMessageThreadSelection) return;
    scrollToPageTop();
  }, [location.pathname, location.search, location.hash, scrollToPageTop]);

  if (isAppSurface) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#f7f2e8]">
        <header className="shrink-0 border-b border-ink-100 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <Logo subtitle={subtitle} stacked />
            {user && (
              <div className="min-w-0 pt-1 text-right text-xs">
                <div className="truncate font-semibold text-ink-900">{user.name}</div>
                <div className="truncate text-ink-500">{user.email}</div>
              </div>
            )}
          </div>
        </header>

        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-6">
          {isMenuRoute ? (
            <section className="flex min-h-full flex-col">
              <div className="mb-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gold-700">
                  Client mobile app
                </div>
                <h1 className="mt-2 font-display text-4xl leading-none text-ink-950">Choose a section</h1>
              </div>
              <nav className="grid gap-3.5">
                {nav.map((item) => {
                  const appTarget = surfaceRoute(item.appTo ?? item.to);
                  const returnsHome = !!item.appTo && item.appTo !== item.to;
                  return (
                    <NavLink
                      key={item.to}
                      to={appTarget}
                      end={item.end}
                      onClick={scrollToPageTop}
                      className={({ isActive }) =>
                        `flex min-h-[82px] items-center gap-4 rounded-[22px] border px-5 py-4 text-lg font-semibold shadow-sm transition ${
                          isActive
                            ? "border-black !bg-black text-white shadow-[0_18px_45px_rgba(0,0,0,0.28)]"
                            : returnsHome
                              ? "border-gold-200 bg-gold-50 text-ink-900 hover:border-gold-300 hover:bg-gold-100"
                          : "border-ink-100 bg-white text-ink-800 hover:border-gold-300 hover:bg-white"
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span
                            className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-1 [&_svg]:h-7 [&_svg]:w-7 ${
                              isActive
                                ? "bg-white/10 text-white ring-white/20"
                                : returnsHome
                                  ? "bg-white text-gold-700 ring-gold-200"
                                : "bg-ink-50 text-ink-800 ring-ink-100/80"
                            }`}
                          >
                            {returnsHome ? item.appIcon ?? item.icon : item.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block">{item.appLabel ?? item.label}</span>
                            {item.appDescription && (
                              <span
                                className={`mt-0.5 block text-xs font-medium leading-snug ${
                                  isActive ? "text-white/75" : "text-ink-500"
                                }`}
                              >
                                {item.appDescription}
                              </span>
                            )}
                          </span>
                          {item.badge && item.badge > 0 ? (
                            <CountBadge
                              value={item.badge}
                              tone="alert"
                              size="sm"
                              title={`${item.badge} ${item.badge === 1 ? "alert" : "alerts"}`}
                              className="ml-auto"
                            />
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </nav>
              {showAccountFooter && (
                <button
                  type="button"
                  onClick={() => {
                    signOut();
                    navigate(surfaceRoute("/"));
                  }}
                  className="mt-auto flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-ink-100 bg-white/80 px-4 py-3 text-sm font-semibold text-ink-700 shadow-sm"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              )}
            </section>
          ) : (
            <div className="space-y-4">
              {showPortalMenuBack && (
                <NavLink
                  to={menuRoot}
                  onClick={scrollToPageTop}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-ink-100 bg-white px-4 py-2 text-sm font-semibold text-ink-800 shadow-sm"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to portal menu
                </NavLink>
              )}
              {topRight && <div className="rounded-2xl border border-ink-100 bg-white p-3">{topRight}</div>}
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="h-dvh min-h-0 overflow-x-auto bg-ink-50">
      <div className="flex h-full min-w-[1360px] flex-col overflow-hidden">
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-ink-100 bg-white">
        <div className={`${compactSidebar ? "employee-sidebar-logo px-5 py-4" : "px-5 py-5"} hairline`}>
          <div className="flex items-start justify-between gap-3">
            <Logo subtitle={compactSidebar ? undefined : subtitle} stacked />
            {!compactSidebar && <DemoModeBadge />}
          </div>
        </div>
        <nav
          style={compactNavStyle}
          className={
            compactSidebar
              ? "employee-sidebar-nav flex-1 space-y-0 overflow-hidden px-3 py-1.5"
              : "dropdown-scroll-y flex-1 space-y-0.5 px-3 py-4"
          }
        >
          {nav.map((item) => (
            <NavLink
                  key={item.to}
                  to={surfaceRoute(item.to)}
              end={item.end}
              onClick={scrollToPageTop}
              className={({ isActive }) =>
                `flex items-center ${
                  compactSidebar
                    ? "employee-sidebar-link min-h-[36px] gap-3 px-3 py-2 rounded-md text-sm leading-tight"
                    : "gap-3 px-3 py-2 rounded-md text-sm"
                } font-medium ${
                  isActive
                    ? "bg-ink-900 text-white"
                    : "text-ink-700 hover:bg-ink-100"
                }`
              }
            >
              <span className="h-4 w-4 shrink-0">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.badge && item.badge > 0 ? (
                // Same alert system as AlertPin — solid #E63946,
                <CountBadge
                  value={item.badge}
                  tone="alert"
                  size="sm"
                  title={`${item.badge} ${item.badge === 1 ? "alert" : "alerts"}`}
                  className="ml-auto"
                />
              ) : null}
            </NavLink>
          ))}
        </nav>
        {showAccountFooter && (
          <div className="shrink-0 border-t border-ink-100 px-3 py-4">
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
                navigate(surfaceRoute("/"));
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-ink-700 hover:bg-ink-100"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-between px-4 py-3 bg-white border-b border-ink-100">
          <Logo subtitle={subtitle} stacked />
          {showAccountFooter && (
            <button
              type="button"
              onClick={() => {
                signOut();
                navigate(surfaceRoute("/"));
              }}
              className="text-ink-700 text-sm"
            >
              Sign out
            </button>
          )}
        </header>
        {topRight && <div className="px-6 py-3 bg-white border-b border-ink-100">{topRight}</div>}
        <main ref={mainRef} className="flex-1 overflow-auto p-8 pb-14">
          <div className="min-w-[1040px]">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
        </div>
      </div>
      </div>
    </div>
  );
}
