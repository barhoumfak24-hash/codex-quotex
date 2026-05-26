import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/Logo";
import { DemoBanner, DemoModeBadge } from "@/components/ui/DemoBanner";

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
  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      <DemoBanner />
      <div className="px-6 py-5 flex items-center gap-3">
        <Logo />
        <DemoModeBadge />
      </div>
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="card !p-8">
            <h1 className="font-display text-2xl">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-ink-500">{footer}</div>}
        </div>
      </div>
      <div className="px-6 py-4 text-center text-xs text-ink-400">
        <Link to="/" className="hover:text-ink-700">
          Back to home
        </Link>
      </div>
    </div>
  );
}