import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";
import { getAppSurface, toSurfaceRoute } from "@/lib/appSurface";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const location = useLocation();
  const isAppSurface = getAppSurface() === "agencyApp";
  const homeRoute = toSurfaceRoute("/", location.pathname);
  return (
    <div className={`${isAppSurface ? "min-h-full" : "min-h-screen"} bg-ink-50 flex flex-col`}>
      {!isAppSurface && <DemoBanner />}
      <div className={`${isAppSurface ? "px-4 py-4" : "px-6 py-5"} flex items-center gap-3`}>
        <Logo />
        {!isAppSurface && <DemoModeBadge />}
      </div>
      <div
        className={
          isAppSurface
            ? "min-h-0 flex-1 px-4 pb-5 pt-3"
            : "flex-1 flex items-center justify-center px-6 py-10"
        }
      >
        <div className="w-full max-w-md">
          <div className="card !p-8">
            <h1 className="font-display text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-ink-500">{footer}</div>}
        </div>
      </div>
      {!isAppSurface && (
        <div className="px-6 py-4 text-center text-xs text-ink-400">
          <Link to={homeRoute} className="inline-flex items-center justify-center gap-1.5 hover:text-ink-700">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>
        </div>
      )}
    </div>
  );
}
