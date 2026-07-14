import { ArrowLeft, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getAppSurface } from "@/lib/appSurface";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function measureAppFrame(): CSSProperties | undefined {
  if (typeof document === "undefined") return undefined;
  const frame = document.querySelector(".agency-mobile-frame");
  if (!(frame instanceof HTMLElement)) return undefined;
  const rect = frame.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.getAttribute("aria-hidden") &&
      (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)
  );
}

function focusModalPanel(panel: HTMLElement | null) {
  if (!panel) return;
  const firstFocusable = getFocusableElements(panel)[0];
  (firstFocusable ?? panel).focus();
}

function trapModalFocus(event: KeyboardEvent, panel: HTMLElement) {
  const focusable = getFocusableElements(panel);
  if (focusable.length === 0) {
    event.preventDefault();
    panel.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (!active || active === first || !panel.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  closeIcon = "close",
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  closeIcon?: "close" | "back";
  footer?: React.ReactNode;
}) {
  const isAppSurface = getAppSurface() === "agencyApp";
  const [appFrameStyle, setAppFrameStyle] = useState<CSSProperties | undefined>();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => focusModalPanel(panelRef.current), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        trapModalFocus(e, panelRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open so wheel events
    // don't leak through the backdrop and the modal feels modal.
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      if (previouslyFocusedRef.current?.isConnected) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isAppSurface) {
      setAppFrameStyle(undefined);
      return;
    }
    const update = () => setAppFrameStyle(measureAppFrame());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, isAppSurface]);

  if (!open) return null;
  const frameStyle = appFrameStyle ?? (isAppSurface ? measureAppFrame() : undefined);
  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  } as const;
  const CloseIcon = closeIcon === "back" ? ArrowLeft : X;
  const closeLabel = closeIcon === "back" ? "Back" : "Close";
  return (
    <div
      className={
        isAppSurface
          ? frameStyle
            ? "app-modal-backdrop fixed z-50 flex items-center justify-center overflow-hidden bg-ink-900/45 p-3 backdrop-blur-sm"
            : "app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-ink-900/45 p-3 backdrop-blur-sm"
          : "fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-ink-900/40 backdrop-blur-sm overflow-y-auto"
      }
      style={isAppSurface ? frameStyle : undefined}
      onClick={(e) => {
        // Click on the backdrop (not the modal panel itself) closes
        // the modal. Stops the scroll-through illusion of being able
        // to dismiss by clicking inside the panel.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : closeLabel}
        tabIndex={-1}
        // Cap to the viewport height, then let the body section
        // scroll. Keeps the header + footer in view at all times so
        // the Send button is always reachable, even on a laptop.
        className={
          isAppSurface
            ? "app-modal-panel flex h-full max-h-full w-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-ink-100 bg-white shadow-luxe"
            : `w-full ${widths[size]} rounded-lg bg-white shadow-luxe border border-ink-100 my-auto max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col`
        }
      >
        <div className="flex items-start justify-between gap-3 px-5 py-3 hairline shrink-0">
          {title ? (
            <h3 id={titleId} className="min-w-0 break-words text-base font-semibold leading-snug">
              {title}
            </h3>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="shrink-0 text-ink-400 hover:text-ink-800"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-ink-100 bg-white px-5 py-4 shadow-[0_-10px_24px_rgba(15,23,42,0.08)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
