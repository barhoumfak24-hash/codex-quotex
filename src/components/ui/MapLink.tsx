import { type MouseEvent } from "react";
import { ExternalLink, MapPin } from "lucide-react";

export function googleMapsSearchUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

export function isAddressLikeKey(key: string) {
  return /\b(address|location|marina|headquarters)\b/i.test(key.replace(/([A-Z])/g, " $1"));
}

function hasUsableAddress(address: string) {
  const trimmed = address.trim();
  if (!trimmed) return false;
  return !/^(-|—|n\/a|none|no .* on file)$/i.test(trimmed);
}

function openInNewMapTab(event: MouseEvent<HTMLAnchorElement>, url: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  event.preventDefault();
  window.open(url, "_blank", "noopener,noreferrer");
}

export function MapLink({
  address,
  label,
  className = "",
  variant = "inline",
}: {
  address: string;
  label?: string;
  className?: string;
  variant?: "inline" | "field";
}) {
  if (!hasUsableAddress(address)) {
    const emptyClasses =
      variant === "field"
        ? "flex min-h-[2.625rem] w-full items-center rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm font-medium text-ink-400"
        : "text-ink-400";
    return <span className={`${emptyClasses} ${className}`}>{address || "—"}</span>;
  }

  const classes =
    variant === "field"
      ? "group flex min-h-[2.625rem] w-full max-w-full items-center gap-2 overflow-hidden rounded-md border border-gold-200 bg-gold-50/70 px-3 py-2 text-sm font-semibold text-gold-800 underline decoration-gold-400 decoration-1 underline-offset-4 transition hover:border-gold-400 hover:bg-gold-100 hover:text-gold-900"
      : "group inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden text-sm font-semibold text-gold-800 underline decoration-gold-400 decoration-1 underline-offset-4 transition hover:text-gold-900";
  const href = googleMapsSearchUrl(address);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => openInNewMapTab(event, href)}
      className={`${classes} ${className}`}
      title={`Open ${address} in Google Maps`}
      aria-label={`Open ${address} in Google Maps`}
    >
      <MapPin className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label ?? address}</span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70 transition group-hover:opacity-100" />
    </a>
  );
}
