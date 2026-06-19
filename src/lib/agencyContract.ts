import { normalizeSoftwarePlanTerm } from "./tiers";
import type { Agency, SoftwarePlanTermMonths } from "@/types";

type AgencyContractFields = Pick<Agency, "createdAt"> &
  Partial<Pick<Agency, "softwarePlanStartedAt" | "softwarePlanRenewsAt" | "softwarePlanTermMonths">>;

export function dateInputFromIso(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function isoFromDateInput(value?: string, fallbackIso?: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`).toISOString();
  }
  if (fallbackIso) return fallbackIso;
  return new Date().toISOString();
}

export function addMonthsToDateInput(
  dateInput: string,
  months: SoftwarePlanTermMonths | number
): string {
  const base = dateInput && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? new Date(`${dateInput}T12:00:00.000Z`)
    : new Date();
  const day = base.getUTCDate();
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + normalizeSoftwarePlanTerm(months));

  // If the original day does not exist in the target month, JS rolls
  // into the following month. Clamp back to the last real day instead.
  if (next.getUTCDate() !== day) {
    next.setUTCDate(0);
  }
  return next.toISOString().slice(0, 10);
}

export function agencyPlanTermMonths(agency: AgencyContractFields): SoftwarePlanTermMonths {
  return normalizeSoftwarePlanTerm(agency.softwarePlanTermMonths);
}

export function agencyPlanStartIso(agency: AgencyContractFields): string {
  return agency.softwarePlanStartedAt ?? agency.createdAt ?? new Date().toISOString();
}

export function agencyPlanRenewalIso(agency: AgencyContractFields): string {
  if (agency.softwarePlanRenewsAt) return agency.softwarePlanRenewsAt;
  return isoFromDateInput(
    addMonthsToDateInput(dateInputFromIso(agencyPlanStartIso(agency)), agencyPlanTermMonths(agency))
  );
}

export function daysUntilAgencyRenewal(agency: AgencyContractFields): number {
  const renewsAt = new Date(agencyPlanRenewalIso(agency)).getTime();
  if (Number.isNaN(renewsAt)) return 0;
  return Math.ceil((renewsAt - Date.now()) / 86_400_000);
}

export function monthsUntilAgencyRenewal(agency: AgencyContractFields): number {
  return Math.max(0, Math.ceil(daysUntilAgencyRenewal(agency) / 30.4375));
}

export function agencyRenewalStatus(agency: AgencyContractFields): {
  label: string;
  tone: "neutral" | "info" | "success" | "warn" | "error" | "gold";
} {
  const days = daysUntilAgencyRenewal(agency);
  if (days < 0) return { label: "Renewal overdue", tone: "error" };
  if (days === 0) return { label: "Renews today", tone: "warn" };
  if (days <= 30) return { label: `${days}d to renewal`, tone: "warn" };
  if (days <= 90) return { label: `${days}d to renewal`, tone: "gold" };
  return { label: "Active term", tone: "success" };
}
