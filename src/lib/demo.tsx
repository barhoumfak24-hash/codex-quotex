import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Construction, X } from "lucide-react";

// =====================================================================
// Demo mode runtime — provides a global notice modal + a global flag.
// This entire build is a demo. No real PII, payments, or coverage
// decisions exist here. Use `useDemoNotice()` to show a polished modal
// when an interaction would require a production-only integration.
// =====================================================================

interface NoticeOptions {
  title?: string;
  body?: string;
  feature?: string;
}

interface DemoContextValue {
  show: (opts?: NoticeOptions) => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export const DEMO_BANNER_COPY =
  "This is a demo environment. Do not enter real personal, payment, or insurance information. No coverage is bound through this demo.";

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<NoticeOptions>({});

  const show = useCallback((o?: NoticeOptions) => {
    setOpts(o ?? {});
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <DemoContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink-900/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg bg-white shadow-luxe border border-ink-100">
            <div className="flex items-start justify-between px-5 py-4 hairline">
              <div className="flex items-center gap-2 text-gold-700">
                <Construction className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider font-medium">Coming in production build</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <h3 className="font-display text-lg">{opts.title ?? "This action is gated to the production build"}</h3>
              <p className="mt-2 text-sm text-ink-600 leading-relaxed">
                {opts.body ??
                  `${opts.feature ? `"${opts.feature}" ` : "This feature "}requires a live backend integration (auth, payments, document storage, carrier runner, or AI provider) and is intentionally disabled in the demo. The UI, data shape, and call sites are wired — only the external service is stubbed.`}
              </p>
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => setOpen(false)} className="btn-primary">
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DemoContext.Provider>
  );
}

export function useDemoNotice() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoNotice must be inside DemoProvider");
  return ctx.show;
}
