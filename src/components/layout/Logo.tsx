import { Link } from "react-router-dom";

type LogoTone = "light" | "dark" | "inherit";
type LogoVariant = "icon" | "horizontal" | "stacked";
type QuotexMarkSize = "sm" | "md" | "lg" | "xl";

const markSizeClasses: Record<QuotexMarkSize, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-10 w-10",
  xl: "h-12 w-12",
};

const markLetterClasses: Record<QuotexMarkSize, string> = {
  sm: "text-[17px]",
  md: "text-[21px]",
  lg: "text-[24px]",
  xl: "text-[28px]",
};

const quotexQPath =
  "M31.74 45.33L35.52 45.11Q36.75 47.31 38.58 49Q40.4 50.69 42.45 51.64Q44.5 52.59 46.34 52.59Q46.74 52.59 47.18 52.56Q47.62 52.54 47.93 52.5Q48.06 52.41 48.13 52.65Q48.19 52.89 48.1 52.94Q47.14 53.16 46.19 53.31Q45.24 53.47 44.36 53.47Q42.34 53.47 40.05 52.52Q37.76 51.57 35.61 49.77Q33.45 47.97 31.74 45.33ZM31.25 45.94Q28.08 45.94 25.51 44.82Q22.94 43.7 21.11 41.72Q19.28 39.74 18.29 37.16Q17.3 34.59 17.3 31.69Q17.3 28.12 18.69 25.44Q20.08 22.75 22.36 20.97Q24.65 19.19 27.38 18.31Q30.11 17.43 32.79 17.43Q36.05 17.43 38.62 18.6Q41.2 19.76 43 21.74Q44.8 23.72 45.75 26.23Q46.7 28.74 46.7 31.38Q46.7 34.46 45.46 37.1Q44.23 39.74 42.1 41.72Q39.96 43.7 37.17 44.82Q34.38 45.94 31.25 45.94ZM32.79 45.02Q35.78 45.02 38.16 43.59Q40.54 42.16 41.94 39.39Q43.35 36.61 43.35 32.61Q43.35 28.47 41.83 25.28Q40.32 22.09 37.52 20.27Q34.73 18.44 30.94 18.44Q26.06 18.44 23.35 21.59Q20.65 24.73 20.65 30.15Q20.65 33.27 21.51 35.98Q22.36 38.68 23.99 40.73Q25.62 42.77 27.86 43.9Q30.11 45.02 32.79 45.02Z";

function QuotexQGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="17 17 32 37"
      className={`inline-block overflow-visible ${className}`}
      focusable="false"
    >
      <path d={quotexQPath} fill="currentColor" />
    </svg>
  );
}

function toneTextClass(tone: LogoTone) {
  if (tone === "dark") return "text-white group-hover:text-white/85";
  if (tone === "light") return "text-ink-950 group-hover:text-ink-700";
  return "";
}

function toneTaglineClass(tone: LogoTone, muted = false) {
  if (tone === "dark") return muted ? "text-white/45" : "text-white/62";
  if (tone === "light") return muted ? "text-ink-400" : "text-ink-600";
  return "";
}

export function QuotexMark({
  size = "md",
  className = "border border-ink-100",
  letterClassName = "",
}: {
  size?: QuotexMarkSize;
  className?: string;
  letterClassName?: string;
}) {
  const explicitSize = /\b[hw]-/.test(className);
  return (
    <span
      className={`flex shrink-0 aspect-square items-center justify-center rounded-md bg-black text-white ${explicitSize ? "" : markSizeClasses[size]} ${className}`}
    >
      <span
        className={`inline-flex items-center justify-center leading-none ${markLetterClasses[size]} ${letterClassName}`}
      >
        <QuotexQGlyph className="h-[1em] w-[0.92em]" />
      </span>
    </span>
  );
}

export function QuotexWordmark({
  className = "",
  label = "Quotex Insurance",
  tone = "inherit",
}: {
  className?: string;
  label?: string;
  tone?: LogoTone;
}) {
  const suffix = label.replace(/^Q/i, "");
  return (
    <span
      aria-label={label}
      className={`inline-flex items-baseline font-display text-lg leading-tight tracking-normal ${toneTextClass(tone)} ${className}`}
    >
      <QuotexQGlyph className="mr-[-0.01em] h-[0.96em] w-[0.82em] translate-y-[0.1em]" />
      <span aria-hidden="true">{suffix}</span>
    </span>
  );
}

export function Logo({
  to = "/",
  subtitle,
  tagline,
  brandName = "Quotex Insurance",
  brandColor,
  logoUrl,
  variant,
  tone = "light",
  stacked = false,
  interactive = true,
}: {
  to?: string;
  subtitle?: string;
  tagline?: string;
  brandName?: string;
  brandColor?: string;
  logoUrl?: string;
  variant?: LogoVariant;
  tone?: LogoTone;
  stacked?: boolean;
  interactive?: boolean;
}) {
  const isQuotex = brandName === "Quotex Insurance";
  const resolvedVariant = variant ?? (stacked ? "stacked" : "horizontal");
  const mark = brandName.trim().charAt(0).toUpperCase() || "Q";
  const normalizedSubtitle = (tagline ?? subtitle ?? "")
    .replace(/^Agency portal\s+\u00c2?\u00b7\s+/i, "Insurance agency portal\n")
    .replace(/^Agency portal$/i, "Insurance agency portal");
  const subtitleLines = normalizedSubtitle
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const markNode = logoUrl ? (
    <img
      src={logoUrl}
      alt=""
      className="h-9 w-9 shrink-0 rounded border border-ink-100 bg-white object-cover"
    />
  ) : isQuotex ? (
    <QuotexMark />
  ) : (
    <div
      className="flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-md bg-ink-900 font-display text-[21px] leading-none text-gold-300"
      style={brandColor ? { backgroundColor: brandColor } : undefined}
    >
      {mark}
    </div>
  );

  const className = `group flex min-w-0 gap-3 ${resolvedVariant === "stacked" ? "items-start" : "items-center"}`;
  const logoContents = (
    <>
      {markNode}
      {resolvedVariant === "icon" ? null : (
      <div className={resolvedVariant === "stacked" ? "min-w-0 pt-0.5 leading-[1.08]" : "min-w-0 leading-tight"}>
        {isQuotex && resolvedVariant === "stacked" ? (
          <>
            <div className={`font-display text-[17px] leading-[1.02] ${toneTextClass(tone)}`}>
              <QuotexWordmark tone="inherit" label="Quotex" className="text-[17px]" />
            </div>
            <div className={`font-display text-[15px] leading-[1.02] ${toneTextClass(tone)}`}>
              Insurance
            </div>
          </>
        ) : (
          <div className={`truncate font-display text-lg leading-tight ${toneTextClass(tone)}`}>
            {isQuotex ? <QuotexWordmark tone="inherit" /> : brandName}
          </div>
        )}
        {subtitleLines.length > 0 && (
          <div className="mt-0.5 space-y-0.5 text-xs leading-tight">
            {subtitleLines.map((line, index) => (
              <div
                key={`${line}-${index}`}
                className={index === 0 ? toneTaglineClass(tone, true) : `font-medium ${toneTaglineClass(tone)}`}
              >
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </>
  );

  if (!interactive) {
    return <div className={className}>{logoContents}</div>;
  }

  return (
    <Link to={to} className={className}>
      {logoContents}
    </Link>
  );
}
