export function toTelHref(phone?: string | null): string | undefined {
  const raw = phone?.trim();
  if (!raw) return undefined;
  const normalized = raw.startsWith("+")
    ? `+${raw.slice(1).replace(/\D/g, "")}`
    : raw.replace(/\D/g, "");
  return normalized ? `tel:${normalized}` : undefined;
}
