const PRESENTATION_DEMO_AGENCY_IDS = new Set([
  "agency_palmcoast",
  "agency_lakeshore",
]);

export function isPresentationDemoAgencyId(agencyId?: string | null): boolean {
  return !!agencyId && PRESENTATION_DEMO_AGENCY_IDS.has(agencyId);
}

export function isPresentationDemoAgency(agency: { id?: string | null }): boolean {
  return isPresentationDemoAgencyId(agency.id);
}

export function isLivePlatformAgency(agency: { id?: string | null }): boolean {
  return !isPresentationDemoAgency(agency);
}
