import { Link } from "react-router-dom";

export function QuotexMark({
  className = "h-9 w-9 border border-ink-100",
  letterClassName = "text-[21px]",
}: {
  className?: string;
  letterClassName?: string;
}) {
  return (
    <span
      className={`flex shrink-0 aspect-square items-center justify-center rounded-md bg-black text-white ${className}`}
    >
      <span className={`inline-block font-display leading-none ${letterClassName}`}>
        Q
      </span>
    </span>
  );
}

export function Logo({
  to = "/",
  subtitle,
  brandName = "Quotex Insurance",
  brandColor,
  logoUrl,
  stacked = false,
}: {
  to?: string;
  subtitle?: string;
  brandName?: string;
  brandColor?: string;
  logoUrl?: string;
  stacked?: boolean;
}) {
  const isQuotex = brandName === "Quotex Insurance";
  const mark = brandName.trim().charAt(0).toUpperCase() || "Q";
  const normalizedSubtitle = (subtitle ?? "")
    .replace(/^Agency portal\s+\u00c2?\u00b7\s+/i, "Insurance agency portal\n")
    .replace(/^Agency portal$/i, "Insurance agency portal");
  const subtitleLines = normalizedSubtitle
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <Link
      to={to}
      className={`group flex min-w-0 gap-3 ${stacked ? "items-start" : "items-center"}`}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded object-cover border border-ink-100 bg-white aspect-square"
        />
      ) : (
        isQuotex ? (
          <QuotexMark />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-md bg-ink-900 font-display text-[21px] leading-none text-gold-300"
            style={brandColor ? { backgroundColor: brandColor } : undefined}
          >
            {mark}
          </div>
        )
      )}
      <div className={stacked ? "min-w-0 pt-0.5 leading-[1.08]" : "min-w-0 leading-tight"}>
        {isQuotex && stacked ? (
          <>
            <div className="font-display text-[17px] leading-[1.02] text-ink-900 group-hover:text-ink-700">
              Quotex
            </div>
            <div className="font-display text-[15px] leading-[1.02] text-ink-900 group-hover:text-ink-700">
              Insurance
            </div>
          </>
        ) : (
          <div className="truncate font-display text-lg text-ink-900 group-hover:text-ink-700">
            {isQuotex ? (
            <>
              Quotex<span className="text-ink-900 group-hover:text-ink-700"> Insurance</span>
            </>
            ) : (
              brandName
            )}
          </div>
        )}
        {subtitleLines.length > 0 && (
          <div className="mt-0.5 space-y-0.5 text-xs leading-tight">
            {subtitleLines.map((line, index) => (
              <div
                key={`${line}-${index}`}
                className={index === 0 ? "text-ink-400" : "font-medium text-ink-600"}
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
