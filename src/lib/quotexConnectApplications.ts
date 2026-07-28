import type { QuotingSession, QuotingSessionAssetMapping } from "@/types";

type CarrierApplication = Record<string, unknown>;
type FieldBag = Map<string, string>;

function cleanValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addFields(bag: FieldBag, source: Record<string, unknown> | undefined): void {
  if (!source) return;
  for (const [key, rawValue] of Object.entries(source)) {
    const value = cleanValue(rawValue);
    if (!value) continue;
    const normalized = normalizeKey(key);
    if (normalized && !bag.has(normalized)) bag.set(normalized, value);
  }
}

function questionnaireFields(session: QuotingSession): FieldBag {
  const fields: FieldBag = new Map();
  const responses = session.questionnaireResponses ?? {};
  for (const question of session.questionnaireQuestions ?? []) {
    const value = cleanValue(responses[question.id]);
    if (!value) continue;
    for (const label of [
      question.label,
      question.acordFieldKey,
      ...(question.acordFieldLabels ?? []),
    ]) {
      if (!label) continue;
      const key = normalizeKey(label);
      if (key && !fields.has(key)) fields.set(key, value);
    }
  }
  return fields;
}

function valueFor(fields: FieldBag, ...labels: string[]): string {
  for (const label of labels) {
    const key = normalizeKey(label);
    const exact = fields.get(key);
    if (exact) return exact;
  }
  for (const label of labels) {
    const key = normalizeKey(label);
    if (!key) continue;
    for (const [candidate, value] of fields) {
      if (candidate.endsWith(key)) return value;
    }
  }
  return "";
}

function numberFor(fields: FieldBag, ...labels: string[]): number | undefined {
  const raw = valueFor(fields, ...labels).replace(/[$,\s]/g, "");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFor(fields: FieldBag, ...labels: string[]): boolean | undefined {
  const raw = valueFor(fields, ...labels).toLowerCase();
  if (!raw) return undefined;
  if (["yes", "true", "1", "y"].includes(raw)) return true;
  if (["no", "false", "0", "n"].includes(raw)) return false;
  return undefined;
}

function compactRecord(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === "") return [];
      if (Array.isArray(value)) {
        const compacted = value
          .map((item) =>
            item && typeof item === "object" && !Array.isArray(item)
              ? compactRecord(item as Record<string, unknown>)
              : item
          )
          .filter((item) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              return Object.keys(item as Record<string, unknown>).length > 0;
            }
            return item !== undefined && item !== null && item !== "";
          });
        return compacted.length > 0 ? [[key, compacted]] : [];
      }
      if (typeof value === "object") {
        const compacted = compactRecord(value as Record<string, unknown>);
        return Object.keys(compacted).length > 0 ? [[key, compacted]] : [];
      }
      return [[key, value]];
    })
  );
}

function parseAddress(value: string): Record<string, string> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const match = trimmed.match(
    /^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/
  );
  if (!match) return { address: trimmed };
  return {
    address: match[1].trim(),
    city: match[2].trim(),
    state: match[3].toUpperCase(),
    zip: match[4],
  };
}

function fieldsForAsset(
  session: QuotingSession,
  asset: QuotingSessionAssetMapping | undefined,
  sharedQuestionnaireFields: FieldBag
): FieldBag {
  const fields = new Map(sharedQuestionnaireFields);
  addFields(fields, session.publicFields);
  addFields(fields, session.assetDetails);
  addFields(fields, asset?.publicFields);
  addFields(fields, asset?.assetDetails);
  if (asset?.address) fields.set("address", asset.address);
  return fields;
}

function buildVehicle(fields: FieldBag): Record<string, unknown> | null {
  const vin = valueFor(fields, "VIN", "Vehicle identification number")
    .replace(/[^A-HJ-NPR-Z0-9]/gi, "")
    .toUpperCase();
  const year = numberFor(fields, "Year", "Vehicle year");
  const make = valueFor(fields, "Make", "Vehicle make");
  const model = valueFor(fields, "Model", "Vehicle model");
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;

  return compactRecord({
    vin,
    year,
    make,
    model,
    ownership: valueFor(fields, "Ownership status", "Vehicle ownership"),
    primaryUse: valueFor(fields, "Vehicle usage", "Primary use", "Usage"),
    annualMiles: numberFor(fields, "Annual mileage", "Annual miles"),
    antiTheft: booleanFor(fields, "Anti-theft device", "Anti theft"),
  });
}

function buildDriver(fields: FieldBag, clientName: string): Record<string, unknown> {
  const firstName = valueFor(fields, "Primary applicant first name", "First name");
  const lastName = valueFor(fields, "Primary applicant last name", "Last name");
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || clientName.trim();
  return compactRecord({
    fullName,
    dateOfBirth: valueFor(fields, "Date of birth", "DOB"),
    gender: valueFor(fields, "Gender"),
    maritalStatus: valueFor(fields, "Marital status"),
    licenseNumber: valueFor(fields, "Driver license number", "License number"),
    licenseState: valueFor(fields, "Driver license state", "State issued"),
    yearsLicensed: numberFor(fields, "Years licensed"),
    violations: numberFor(fields, "Violations", "Number of violations"),
    atFaultAccidents: numberFor(fields, "At-fault accidents", "At fault accidents"),
    sr22Required: booleanFor(fields, "SR-22 filing required", "SR22 required"),
  });
}

function buildAutoApplication(
  session: QuotingSession,
  clientName: string,
  sharedFields: FieldBag
): CarrierApplication | null {
  const mappings =
    session.selectedAssetMappings?.filter((asset) => asset.assetType === "luxury_vehicle") ?? [];
  const vehicleSources = mappings.length > 0 ? mappings : [undefined];
  const vehicles = vehicleSources.flatMap((asset) => {
    const vehicle = buildVehicle(fieldsForAsset(session, asset, sharedFields));
    return vehicle ? [vehicle] : [];
  });
  if (vehicles.length === 0) return null;

  const fields = fieldsForAsset(session, mappings[0], sharedFields);
  const driver = buildDriver(fields, clientName);
  const drivers = Object.keys(driver).length > 1 || driver.fullName ? [driver] : [];
  return compactRecord({
    policyType: "auto",
    clientName,
    drivers,
    vehicles,
    priorInsurance: {
      carrierName: valueFor(fields, "Current carrier"),
      yearsInsured: valueFor(fields, "Continuous coverage years", "Years insured"),
      expirationDate: valueFor(fields, "Policy expiration date"),
      reason: valueFor(fields, "Reason for switching", "Reason for prior insurance change"),
    },
    coverage: {
      bodilyInjury: valueFor(fields, "Bodily injury limits"),
      propertyDamage: valueFor(fields, "Property damage limits"),
      uninsuredMotorist: valueFor(fields, "UM limits", "Uninsured motorist limits"),
      medicalPayments: numberFor(fields, "Medical payments"),
      collisionDeductible: numberFor(fields, "Collision deductible"),
      comprehensiveDeductible: numberFor(fields, "Comprehensive deductible"),
      rentalReimbursement: valueFor(fields, "Rental reimbursement"),
      roadsideAssistance: booleanFor(fields, "Towing coverage", "Roadside assistance"),
      gapCoverage: booleanFor(fields, "Gap coverage", "Lease coverage"),
      newCarReplacement: booleanFor(fields, "New car replacement"),
    },
  });
}

function buildHomeApplication(
  session: QuotingSession,
  clientName: string,
  sharedFields: FieldBag
): CarrierApplication | null {
  const mapping = session.selectedAssetMappings?.find(
    (asset) => asset.assetType === "coastal_home"
  );
  const fields = fieldsForAsset(session, mapping, sharedFields);
  const address = valueFor(
    fields,
    "Property address",
    "Risk address",
    "Street address",
    "Address"
  );
  if (!address) return null;
  const explicitRoofAge = numberFor(fields, "Roof age");
  const roofReplacementYear = numberFor(
    fields,
    "Roof replacement year",
    "Roof year"
  );
  const currentYear = new Date().getFullYear();
  const roofAge =
    explicitRoofAge !== undefined
      ? explicitRoofAge
      : roofReplacementYear !== undefined &&
          roofReplacementYear > 1800 &&
          roofReplacementYear <= currentYear
        ? currentYear - roofReplacementYear
        : undefined;

  return compactRecord({
    policyType: "homeowners",
    clientName,
    property: {
      ...parseAddress(address),
      yearBuilt: numberFor(fields, "Year built"),
      squareFootage: numberFor(fields, "Square footage", "Living area"),
      stories: numberFor(fields, "Stories", "Number of stories"),
      constructionType: valueFor(fields, "Construction type"),
      foundationType: valueFor(fields, "Foundation type"),
      roofType: valueFor(fields, "Roof material", "Roof type"),
      roofAge,
      units: numberFor(fields, "Number of units", "Units"),
    },
    occupancy: {
      type: valueFor(fields, "Occupancy", "Residence type"),
      residents: numberFor(fields, "Number of residents in household", "Residents"),
      businessConducted: booleanFor(fields, "Business conducted on premises"),
      heatingType: valueFor(fields, "Heating type"),
      centralAir: booleanFor(fields, "Central air"),
      swimmingPool: booleanFor(fields, "Swimming pool", "Pool"),
      poolFenced: booleanFor(fields, "Pool fenced"),
      poolDivingBoard: booleanFor(fields, "Pool diving board", "Diving board"),
      trampoline: booleanFor(fields, "Trampoline"),
      dog: booleanFor(fields, "Dog", "Any dogs"),
      dogBreed: valueFor(fields, "Dog breed"),
      burglarAlarm: valueFor(fields, "Burglar alarm"),
      fireAlarm: valueFor(fields, "Fire alarm"),
      fireSprinkler: booleanFor(fields, "Fire sprinkler"),
      deadboltLocks: booleanFor(fields, "Deadbolt locks"),
      gatedCommunity: booleanFor(fields, "Gated community"),
    },
    losses: {
      count: numberFor(fields, "Number of losses", "Loss count"),
    },
    coverage: {
      dwellingAmount:
        numberFor(fields, "Dwelling amount", "Dwelling coverage") ||
        (session.estimatedValue > 0 ? session.estimatedValue : undefined),
      personalLiability: numberFor(fields, "Personal liability"),
      medicalPayments: numberFor(fields, "Medical payments"),
      allPerilDeductible: numberFor(fields, "All peril deductible", "Deductible"),
    },
    mortgage: {
      isMortgaged: booleanFor(fields, "Is mortgaged", "Mortgage"),
      lenderName: valueFor(fields, "Lender name", "Mortgage company"),
      loanNumber: valueFor(fields, "Loan number"),
    },
  });
}

export function buildQuotexConnectCarrierApplication(input: {
  clientName: string;
  session: QuotingSession;
}): CarrierApplication | null {
  const clientName = input.clientName.trim();
  if (!clientName) return null;
  const sharedFields = questionnaireFields(input.session);
  const hasVehicle =
    input.session.assetType === "luxury_vehicle" ||
    input.session.selectedAssetMappings?.some(
      (asset) => asset.assetType === "luxury_vehicle"
    );
  if (hasVehicle) {
    return buildAutoApplication(input.session, clientName, sharedFields);
  }
  const hasHome =
    input.session.assetType === "coastal_home" ||
    input.session.selectedAssetMappings?.some(
      (asset) => asset.assetType === "coastal_home"
    );
  if (hasHome) {
    return buildHomeApplication(input.session, clientName, sharedFields);
  }
  return null;
}
