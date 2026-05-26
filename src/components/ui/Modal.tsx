import { X } from "lucide-react";
import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open so wheel events
    // don't leak through the backdrop and the modal feels modal.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = {
    sm: "max-w-sm",
    md: "max-w-lg",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  } as const;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-ink-900/40 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        // Click on the backdrop (not the modal panel itself) closes
        // the modal. Stops the scroll-through illusion of being able
        // to dismiss by clicking inside the panel.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        // Cap to the viewport height, then let the body section
        // scroll. Keeps the header + footer in view at all times so
        // the Send button is always reachable, even on a laptop.
        className={`w-full ${widths[size]} rounded-lg bg-white shadow-luxe border border-ink-100 my-auto max-h-[calc(100vh-1rem)] sm:max-h-[calc(100vh-2rem)] flex flex-col`}
      >
        <div className="flex items-center justify-between px-5 py-3 hairline shrink-0">
          <h3 className="text-base font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-ink-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}