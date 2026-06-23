import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { PlugZap, X } from "lucide-react";

interface NoticeOptions {
  title?: string;
  body?: string;
  feature?: string;
}

interface NoticeContextValue {
  show: (opts?: NoticeOptions) => void;
}

const NoticeContext = createContext<NoticeContextValue | null>(null);

export function IntegrationNoticeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<NoticeOptions>({});

  const show = useCallback((o?: NoticeOptions) => {
    setOpts(o ?? {});
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-ink-100 bg-white shadow-luxe">
            <div className="hairline flex items-start justify-between px-5 py-4">
              <div className="flex items-center gap-2 text-gold-700">
                <PlugZap className="h-4 w-4" />
                <span className="text-xs font-medium uppercase tracking-wider">Integration unavailable</span>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-ink-400 hover:text-ink-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <h3 className="font-display text-lg">{opts.title ?? "This action needs an active integration"}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {opts.body ??
                  `${opts.feature ? `"${opts.feature}" ` : "This feature "}requires a configured backend integration before it can run.`}
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
    </NoticeContext.Provider>
  );
}

export function useIntegrationNotice() {
  const ctx = useContext(NoticeContext);
  if (!ctx) throw new Error("useIntegrationNotice must be inside IntegrationNoticeProvider");
  return ctx.show;
}
