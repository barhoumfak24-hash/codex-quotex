import type { AssetType } from "@/types";

export type QuoteAssetDetailInputType =
  | "text"
  | "number"
  | "currency"
  | "select"
  | "textarea"
  | "address";

export interface QuoteAssetDetailField {
  key: string;
  label: string;
  inputType: QuoteAssetDetailInputType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  helpText?: string;
  publicHints?: string[];
  questionHints?: string[];
}

const HOME_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "riskAddress",
    label: "Property address",
    inputType: "address",
    required: true,
    placeholder: "Street, city, state, ZIP",
    publicHints: ["address", "risk address"],
  },
  {
    key: "occupancy",
    label: "Occupancy",
    inputType: "select",
    required: true,
    options: ["Primary", "Secondary / seasonal", "Tenant occupied", "Vacant", "Condo", "Dwelling fire"],
    publicHints: ["occupancy"],
    questionHints: ["occupancy"],
  },
  {
    key: "ownershipAndLien",
    label: "Ownership and lien details",
    inputType: "textarea",
    questionHints: ["ownership", "lien", "mortgagee", "loan"],
  },
  {
    key: "countyTownship",
    label: "County and township / municipality",
    inputType: "text",
    publicHints: ["county", "township", "municipality"],
  },
  {
    key: "priorOrMailingAddress",
    label: "Prior or mailing address in the last 3 years",
    inputType: "address",
    questionHints: ["prior address", "mailing address"],
  },
  {
    key: "yearBuilt",
    label: "Year built",
    inputType: "number",
    required: true,
    publicHints: ["year built"],
  },
  {
    key: "squareFeet",
    label: "Square footage",
    inputType: "number",
    publicHints: ["square footage", "sq ft"],
  },
  {
    key: "unitsWallHeight",
    label: "Number of units and wall height",
    inputType: "textarea",
    publicHints: ["units", "wall height"],
    questionHints: ["number of units", "wall height"],
  },
  {
    key: "homeStyle",
    label: "Home style",
    inputType: "select",
    options: ["1 story", "1.5 story", "1.75 story", "2 story", "Split-level", "Condo", "Apartment", "Manufactured home", "Other"],
    publicHints: ["style", "stories"],
  },
  {
    key: "foundationDetails",
    label: "Foundation details",
    inputType: "textarea",
    publicHints: ["foundation", "basement"],
    questionHints: ["foundation", "basement", "crawl space"],
  },
  {
    key: "constructionType",
    label: "Construction type",
    inputType: "select",
    options: ["Frame", "Masonry", "Stucco over masonry", "ICF concrete", "Other / unknown"],
    publicHints: ["construction"],
  },
  {
    key: "frameAndExterior",
    label: "Frame and exterior materials",
    inputType: "textarea",
    publicHints: ["frame", "exterior", "siding", "brick", "stone", "stucco"],
    questionHints: ["frame", "exterior"],
  },
  {
    key: "roofShapePitch",
    label: "Roof shape and pitch",
    inputType: "textarea",
    publicHints: ["roof shape", "roof pitch", "gable", "hip", "flat"],
    questionHints: ["roof shape", "roof pitch"],
  },
  {
    key: "roofMaterial",
    label: "Roof material",
    inputType: "select",
    options: ["Shingle", "Tile", "Metal", "Slate", "Flat / membrane", "Other / unknown"],
    publicHints: ["roof material", "roof"],
    questionHints: ["roof age", "partial replacements"],
  },
  {
    key: "roofYear",
    label: "Roof year",
    inputType: "number",
    publicHints: ["roof"],
    questionHints: ["roof age", "partial replacements"],
  },
  {
    key: "skylights",
    label: "Skylights",
    inputType: "textarea",
    publicHints: ["skylight"],
    questionHints: ["skylight"],
  },
  {
    key: "attachedStructures",
    label: "Attached structures",
    inputType: "textarea",
    publicHints: ["porch", "deck", "attached garage", "carport", "balcony"],
    questionHints: ["attached structures", "porch", "deck", "garage"],
  },
  {
    key: "detachedStructuresAndRecreation",
    label: "Detached structures and recreational features",
    inputType: "textarea",
    publicHints: ["detached garage", "shed", "pool", "gazebo"],
    questionHints: ["pool", "hot tub", "trampoline", "shed", "detached garage"],
  },
  {
    key: "interiorFinishes",
    label: "Interior walls, ceilings, and floors",
    inputType: "textarea",
    questionHints: ["interior", "walls", "ceilings", "floors"],
  },
  {
    key: "kitchenBathQuality",
    label: "Kitchen and bathroom quality",
    inputType: "textarea",
    questionHints: ["kitchen", "bath"],
  },
  {
    key: "interiorFeatures",
    label: "Interior features",
    inputType: "textarea",
    questionHints: ["wet bar", "fireplace", "wood stove", "spiral staircase", "attic", "central vacuum"],
  },
  {
    key: "heatingCoolingSystems",
    label: "Heating and cooling systems",
    inputType: "textarea",
    publicHints: ["heating", "cooling", "central air", "hvac"],
    questionHints: ["heating", "cooling", "central AC"],
  },
  {
    key: "electricalAndSafetySystems",
    label: "Electrical and safety systems",
    inputType: "textarea",
    publicHints: ["electrical", "alarm", "sprinkler"],
    questionHints: ["electrical", "alarm", "sprinkler", "surveillance"],
  },
  {
    key: "homeUpdates",
    label: "Updates and remodels",
    inputType: "textarea",
    publicHints: ["updates", "renovation", "remodel"],
    questionHints: ["roof receipt", "heating", "plumbing", "electrical", "addition", "remodel"],
  },
  {
    key: "distanceToCoast",
    label: "Distance to coast",
    inputType: "text",
    placeholder: "e.g., 0.8 miles",
    publicHints: ["distance to coast"],
  },
  {
    key: "lotSize",
    label: "Lot size",
    inputType: "text",
    publicHints: ["lot size", "acreage", "acres"],
  },
  {
    key: "floodZone",
    label: "Flood zone",
    inputType: "text",
    publicHints: ["flood zone"],
  },
  {
    key: "windMitigation",
    label: "Wind mitigation details",
    inputType: "textarea",
    placeholder: "Certificate year, opening protection, roof deck/uplift details",
    questionHints: ["wind-mitigation", "wind mitigation", "uplift"],
  },
  {
    key: "lossHistory",
    label: "Loss history",
    inputType: "textarea",
    placeholder: "Carrier, cause, paid amount, and date for any losses",
    questionHints: ["losses", "loss history", "carrier, paid amount"],
  },
  {
    key: "animalsAndLiabilityExposures",
    label: "Animals, business, rental, and liability exposures",
    inputType: "textarea",
    questionHints: ["dogs", "bite", "daycare", "business", "rental", "vacant land", "pond", "recreational vehicles"],
  },
  {
    key: "scheduledProperty",
    label: "Scheduled property",
    inputType: "textarea",
    questionHints: ["jewelry", "watches", "guns", "furs", "art", "collections", "safe", "vault"],
  },
  {
    key: "requestedHomeEndorsements",
    label: "Requested endorsements and special coverages",
    inputType: "textarea",
    questionHints: ["water backup", "personal injury", "ordinance", "loss assessment", "service line", "equipment breakdown", "id theft"],
  },
  {
    key: "homeDiscountsAndProtection",
    label: "Discounts and protection details",
    inputType: "textarea",
    questionHints: ["full pay", "escrow", "non-smoker", "generator", "protective", "hydrant", "fire station", "multi-policy"],
  },
];

const VEHICLE_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "vin",
    label: "VIN",
    inputType: "text",
    required: true,
    placeholder: "17-character VIN",
    publicHints: ["vin", "vin-decoded", "trim"],
  },
  { key: "year", label: "Year", inputType: "number", required: true, publicHints: ["year / make / model", "year"] },
  { key: "make", label: "Make", inputType: "text", required: true, publicHints: ["year / make / model", "make"] },
  { key: "model", label: "Model", inputType: "text", required: true, publicHints: ["year / make / model", "model"] },
  {
    key: "statedValue",
    label: "Stated value",
    inputType: "currency",
    publicHints: ["stated value", "market value", "msrp"],
    questionHints: ["stated value"],
  },
  {
    key: "purchaseAndOwnership",
    label: "Purchase date, new/used, own/lien/lease, and name on title",
    inputType: "textarea",
    questionHints: ["purchase date", "new", "used", "own", "lien", "lease", "title"],
  },
  {
    key: "garagingAddress",
    label: "Garaging address",
    inputType: "address",
    required: true,
    publicHints: ["garaging"],
    placeholder: "Where the vehicle is normally kept",
  },
  {
    key: "lienholderOrLessor",
    label: "Lienholder or lessor name and address",
    inputType: "textarea",
    questionHints: ["lienholder", "lessor", "lease", "holder"],
  },
  {
    key: "annualMileage",
    label: "Annual mileage",
    inputType: "number",
    questionHints: ["annual mileage"],
  },
  {
    key: "commuteAndAnnualMileage",
    label: "Distance one way, days per week, and annual mileage",
    inputType: "textarea",
    questionHints: ["distance one way", "days per week", "annual mileage"],
  },
  {
    key: "primaryUse",
    label: "Primary use",
    inputType: "select",
    options: ["Pleasure", "Commute", "Business", "Collector / limited use", "Other"],
    questionHints: ["primary use", "pleasure", "commute", "business"],
  },
  {
    key: "businessDeliveryRideshareUse",
    label: "Business, delivery, rideshare, advertising, or wrapped vehicle use",
    inputType: "textarea",
    questionHints: ["business", "delivery", "uber", "lyft", "advertising", "wrap"],
  },
  {
    key: "principalOperator",
    label: "Principal operator",
    inputType: "text",
    questionHints: ["principal operator"],
  },
  {
    key: "vehicleSafetyAndDamage",
    label: "Safety features and existing damage",
    inputType: "textarea",
    publicHints: ["safety features", "blind spot", "automatic braking", "telematics"],
    questionHints: ["blind spot", "auto brake", "onstar", "damage"],
  },
  {
    key: "customEquipmentOrModifications",
    label: "Customized equipment or modifications",
    inputType: "textarea",
    questionHints: ["custom", "lift", "cap", "tires", "snow plow", "modifications"],
  },
  {
    key: "coverageLimits",
    label: "Requested liability, property damage, and UM/UIM limits",
    inputType: "textarea",
    questionHints: ["split limits", "csl", "property damage", "um", "uim"],
  },
  {
    key: "physicalDamageDeductibles",
    label: "Comprehensive and collision coverage / deductibles",
    inputType: "textarea",
    questionHints: ["comprehensive", "collision", "deductible", "glass"],
  },
  {
    key: "roadsideRentalGap",
    label: "Roadside, rental, glass, gap, and travel coverage",
    inputType: "textarea",
    questionHints: ["roadside", "rental", "glass", "gap", "travel"],
  },
  {
    key: "drivers",
    label: "Drivers",
    inputType: "textarea",
    placeholder: "Names, DOBs, license numbers, and years insured",
    questionHints: ["all drivers", "drivers"],
  },
  {
    key: "driverIncidents",
    label: "Tickets, accidents, PIP, deer, glass, or other claims",
    inputType: "textarea",
    questionHints: ["tickets", "accidents", "pip", "deer", "glass", "claims"],
  },
  {
    key: "driverEducationStudent",
    label: "Driver education and student details",
    inputType: "textarea",
    questionHints: ["education", "student", "gpa", "student distance"],
  },
  {
    key: "priorAutoCarrier",
    label: "Prior carrier, policy number, expiration date, term, and loss-free years",
    inputType: "textarea",
    questionHints: ["prior carrier", "policy number", "expiration", "loss-free"],
  },
  {
    key: "autoDiscountsAndPayment",
    label: "Discounts, groups, payment plan, health insurance, and deductible choices",
    inputType: "textarea",
    questionHints: ["discount", "group", "payment", "health insurance", "deductible"],
  },
  {
    key: "ratingResidence",
    label: "Residence/rating details",
    inputType: "textarea",
    questionHints: ["own", "rent", "house", "apartment", "condo", "manufactured home"],
  },
  {
    key: "motorcycleOrSpecialVehicleDetails",
    label: "Motorcycle or special vehicle details",
    inputType: "textarea",
    questionHints: ["motorcycle", "cycle", "helmet", "custom value", "medical benefits"],
  },
];

const YACHT_FIELDS: QuoteAssetDetailField[] = [
  { key: "hin", label: "Hull ID / HIN", inputType: "text", required: true, publicHints: ["hull"] },
  { key: "year", label: "Year built", inputType: "number", required: true, publicHints: ["year built", "year"] },
  { key: "make", label: "Builder / make", inputType: "text", required: true, publicHints: ["make"] },
  { key: "model", label: "Model", inputType: "text", publicHints: ["model"] },
  { key: "length", label: "Length", inputType: "number", required: true, publicHints: ["hull length", "length"] },
  {
    key: "hullMaterial",
    label: "Hull material",
    inputType: "select",
    options: ["Fiberglass", "Aluminum", "Steel", "Wood", "Carbon / composite", "Other"],
    publicHints: ["hull material"],
  },
  {
    key: "marinaAddress",
    label: "Marina / mooring address",
    inputType: "address",
    required: true,
    publicHints: ["marina", "mooring"],
    questionHints: ["marina", "slip"],
  },
  {
    key: "cruisingArea",
    label: "Cruising area",
    inputType: "text",
    placeholder: "e.g., Atlantic coast, Bahamas, Great Lakes",
    questionHints: ["cruising area"],
  },
  {
    key: "hurricanePlan",
    label: "Hurricane plan",
    inputType: "textarea",
    questionHints: ["hurricane plan"],
  },
];

const JEWELRY_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "assetIdentifier",
    label: "Serial, appraisal, or inventory ID",
    inputType: "text",
    publicHints: ["serial", "asset id", "inventory id", "appraisal number"],
  },
  { key: "itemType", label: "Item type", inputType: "text", required: true, publicHints: ["item type"] },
  {
    key: "itemDescription",
    label: "Item description",
    inputType: "textarea",
    required: true,
    placeholder: "Stone, metal, designer, serial number, distinguishing details",
    questionHints: ["item"],
  },
  {
    key: "appraisedValue",
    label: "Appraised value",
    inputType: "currency",
    required: true,
    publicHints: ["appraised value", "value"],
    questionHints: ["replacement value", "appraisal"],
  },
  {
    key: "appraisalDate",
    label: "Appraisal date",
    inputType: "text",
    placeholder: "MM/YYYY",
    questionHints: ["appraisal"],
  },
  { key: "appraiser", label: "Appraiser", inputType: "text", questionHints: ["appraiser"] },
  {
    key: "storageLocation",
    label: "Storage when not worn",
    inputType: "select",
    options: ["Home safe", "Bank vault", "On person", "Dealer storage", "Other"],
    publicHints: ["storage location", "storage"],
    questionHints: ["storage"],
  },
  { key: "travelFrequency", label: "Travel frequency", inputType: "text", questionHints: ["travel"] },
];

const UMBRELLA_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "assetIdentifier",
    label: "Policy or exposure reference",
    inputType: "text",
    publicHints: ["policy number", "reference", "asset id"],
  },
  {
    key: "primaryResidenceAddress",
    label: "Primary residence address",
    inputType: "address",
    required: true,
    publicHints: ["address"],
  },
  {
    key: "requestedLimit",
    label: "Requested umbrella limit",
    inputType: "currency",
    required: true,
    publicHints: ["value", "limit"],
  },
  {
    key: "underlyingLimits",
    label: "Underlying policy limits",
    inputType: "textarea",
    required: true,
    placeholder: "Home, auto, watercraft, and excess limits currently carried",
    publicHints: ["underlying policies"],
    questionHints: ["underlying"],
  },
  { key: "householdDrivers", label: "Household drivers", inputType: "textarea", questionHints: ["drivers"] },
  {
    key: "publicExposure",
    label: "Public exposure / board seats",
    inputType: "textarea",
    questionHints: ["public-facing", "board", "media"],
  },
  {
    key: "propertyExposures",
    label: "Property exposures",
    inputType: "textarea",
    placeholder: "Pools, dogs, rentals, recreational vehicles, domestic staff, etc.",
    questionHints: ["dog", "pool", "diving", "slide"],
  },
];

const PORTFOLIO_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "primaryAddress",
    label: "Primary address",
    inputType: "address",
    required: true,
    publicHints: ["address"],
  },
  {
    key: "portfolioSummary",
    label: "Portfolio summary",
    inputType: "textarea",
    required: true,
    placeholder: "Homes, autos, watercraft, jewelry, umbrella, business-owned assets, etc.",
    questionHints: ["portfolio", "details", "describe"],
  },
  {
    key: "totalInsuredValue",
    label: "Total insured value",
    inputType: "currency",
    publicHints: ["value"],
  },
  {
    key: "currentCarriers",
    label: "Current carriers / policies",
    inputType: "textarea",
    questionHints: ["underlying", "policies"],
  },
];

const OTHER_FIELDS: QuoteAssetDetailField[] = [
  {
    key: "description",
    label: "Asset / exposure description",
    inputType: "textarea",
    required: true,
    placeholder: "Describe exactly what is being insured.",
    questionHints: ["describe", "details"],
  },
  {
    key: "location",
    label: "Location / address",
    inputType: "address",
    required: true,
    publicHints: ["address", "location"],
  },
  {
    key: "identifier",
    label: "Identifier",
    inputType: "text",
    placeholder: "Serial number, registration, parcel ID, or other lookup key",
    publicHints: ["id", "identifier", "serial"],
  },
  {
    key: "useCase",
    label: "Use / operations",
    inputType: "textarea",
    required: true,
    questionHints: ["usage", "operations", "details"],
  },
  {
    key: "requestedCoverage",
    label: "Coverage requested",
    inputType: "textarea",
    questionHints: ["coverage", "limit"],
  },
];

export const QUOTE_ASSET_DETAIL_FIELDS: Record<AssetType, QuoteAssetDetailField[]> = {
  coastal_home: HOME_FIELDS,
  luxury_vehicle: VEHICLE_FIELDS,
  yacht: YACHT_FIELDS,
  jewelry: JEWELRY_FIELDS,
  umbrella_liability: UMBRELLA_FIELDS,
  full_portfolio: PORTFOLIO_FIELDS,
  other: OTHER_FIELDS,
};

const QUOTE_ASSET_DETAIL_KEY_ALIASES: Partial<Record<AssetType, Record<string, string[]>>> = {
  coastal_home: {
    riskAddress: ["propertyAddress", "address", "locationAddress", "premisesAddress", "primaryResidenceAddress"],
    ownershipAndLien: ["ownershipLien", "mortgageeInfo", "mortgagee", "lienholder", "loanDetails"],
    countyTownship: ["county", "township", "municipality"],
    priorOrMailingAddress: ["priorAddress", "mailingAddress", "previousAddress"],
    yearBuilt: ["builtYear", "constructionYear", "year_built"],
    squareFeet: ["squareFootage", "sqft", "sqFt", "livingArea", "livingAreaSqFt"],
    unitsWallHeight: ["units", "numberOfUnits", "wallHeight"],
    homeStyle: ["style", "homeStyleType", "stories", "story"],
    foundationDetails: ["foundation", "basement", "crawlSpace"],
    constructionType: ["construction", "constructionClass", "wallConstruction"],
    frameAndExterior: ["frameExterior", "exterior", "siding", "exteriorMaterials"],
    roofShapePitch: ["roofShape", "roofPitch", "roofStyle"],
    roofMaterial: ["roof", "roofCovering", "roofType"],
    skylights: ["skylight"],
    attachedStructures: ["porchesDecksGarages", "porches", "decks", "attachedGarage", "carport"],
    detachedStructuresAndRecreation: ["detachedStructures", "poolTrampoline", "pool", "shed", "detachedGarage"],
    interiorFinishes: ["interior", "wallsCeilingsFloors"],
    kitchenBathQuality: ["kitchenBath", "bathrooms", "kitchenQuality", "bathQuality"],
    interiorFeatures: ["fireplaces", "woodStove", "wetBar", "centralVacuum"],
    heatingCoolingSystems: ["heatingCooling", "hvac", "heat", "centralAir", "ac"],
    electricalAndSafetySystems: ["electricalSafety", "electrical", "alarmSystems", "protectiveDevices"],
    homeUpdates: ["updates", "renovations", "remodels"],
    distanceToCoast: ["coastDistance", "distanceFromCoast", "distanceToWater"],
    lotSize: ["acreage", "acres", "lotSqFt"],
    floodZone: ["femaFloodZone"],
    windMitigation: ["windMitigationDetails", "windCert", "windCertificate"],
    lossHistory: ["losses", "claims", "claimsHistory"],
    animalsAndLiabilityExposures: ["animals", "dogs", "liabilityExposures", "businessRentalExposure"],
    scheduledProperty: ["specialProperty", "valuableArticles", "jewelry", "collections"],
    requestedHomeEndorsements: ["endorsements", "specialCoverages", "requestedCoverages"],
    homeDiscountsAndProtection: ["discounts", "protectiveCredits", "protectionDetails"],
  },
  luxury_vehicle: {
    vin: ["VIN", "vehicleVin"],
    statedValue: ["vehicleStatedValue", "marketValue", "msrp", "basePrice"],
    purchaseAndOwnership: ["purchaseDate", "ownershipStatus", "titleOwner", "ownedLeasedLien"],
    garagingAddress: ["garageAddress", "garagingAddressIfDifferent", "vehicleGaragingAddress", "vehicleLocation", "storageAddress"],
    lienholderOrLessor: ["lienholder", "lessor", "lossPayee", "holderAddress"],
    annualMileage: ["mileage", "estimatedAnnualMileage"],
    commuteAndAnnualMileage: ["commuteDetails", "distanceOneWay", "daysPerWeek"],
    primaryUse: ["use", "usage"],
    businessDeliveryRideshareUse: ["businessUse", "rideshareUse", "deliveryUse", "uberLyftUse", "advertisingWrap"],
    principalOperator: ["principalDriver", "operator"],
    vehicleSafetyAndDamage: ["safetyFeaturesDamage", "safetyFeatures", "existingDamage", "telematics"],
    customEquipmentOrModifications: ["modifications", "customEquipment", "customizedEquipment"],
    coverageLimits: ["autoCoverageLimits", "liabilityLimits", "umLimits", "uimLimits"],
    physicalDamageDeductibles: ["deductibles", "compCollision", "comprehensiveCollision"],
    roadsideRentalGap: ["roadsideRentalGlassGap", "roadside", "rental", "gap"],
    drivers: ["allDrivers", "driverSchedule", "driverOneDetails", "driverTwoDetails"],
    driverIncidents: ["ticketsAccidentsClaims", "incidents", "violations", "claims"],
    driverEducationStudent: ["educationStudent", "studentDetails"],
    priorAutoCarrier: ["priorCarrier", "priorAuto", "lossFreeYears"],
    autoDiscountsAndPayment: ["discountsAndPayment", "autoDiscounts", "paymentPlan"],
    ratingResidence: ["residenceRating", "homeRating", "ownRent"],
    motorcycleOrSpecialVehicleDetails: ["motorcycleDetails", "specialVehicleDetails"],
  },
  yacht: {
    hin: ["HIN", "hullId", "hullIdentificationNumber"],
    marinaAddress: ["address", "mooringAddress", "riskAddress", "propertyAddress"],
    length: ["hullLength", "loa"],
    cruisingArea: ["navigationArea", "navigationTerritory"],
  },
  jewelry: {
    assetIdentifier: ["serialNumber", "inventoryId", "appraisalNumber", "referenceNumber"],
    appraisedValue: ["value", "estimatedValue", "scheduledValue"],
    itemDescription: ["description"],
    appraisalDate: ["valuationDate"],
  },
  umbrella_liability: {
    assetIdentifier: ["policyNumber", "exposureReference", "referenceNumber"],
    primaryResidenceAddress: ["address", "mailingAddress", "propertyAddress", "riskAddress"],
    requestedLimit: ["limit", "coverageLimit", "estimatedValue"],
  },
  full_portfolio: {
    primaryAddress: ["address", "mailingAddress", "propertyAddress", "riskAddress", "primaryResidenceAddress"],
    totalInsuredValue: ["value", "estimatedValue", "portfolioValue"],
  },
  other: {
    location: ["address", "propertyAddress", "riskAddress", "premisesAddress"],
    identifier: ["assetIdentifier", "serialNumber", "registration", "referenceNumber"],
    requestedCoverage: ["coverage", "limit"],
  },
};

function detailValueByKeyOrAlias(
  assetType: AssetType,
  details: Record<string, unknown> | undefined,
  key: string
): unknown {
  if (!details) return undefined;
  if (Object.prototype.hasOwnProperty.call(details, key)) return details[key];
  const aliases = QUOTE_ASSET_DETAIL_KEY_ALIASES[assetType]?.[key] ?? [];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(details, alias)) return details[alias];
  }
  return undefined;
}

export function cleanQuoteAssetDetails(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): Record<string, string> {
  const fields = QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? [];
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = detailValueByKeyOrAlias(assetType, details, field.key);
    const text = stringifyDetailValue(value);
    if (text) out[field.key] = text;
  }
  return out;
}

export function missingRequiredQuoteAssetFields(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): QuoteAssetDetailField[] {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).filter(
    (field) => field.required && !cleaned[field.key]
  );
}

export function primaryQuoteAssetAddress(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): string | undefined {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const keysByAssetType: Partial<Record<AssetType, string[]>> = {
    coastal_home: ["riskAddress"],
    luxury_vehicle: ["garagingAddress"],
    yacht: ["marinaAddress"],
    umbrella_liability: ["primaryResidenceAddress"],
    full_portfolio: ["primaryAddress"],
    other: ["location"],
  };
  const keys = keysByAssetType[assetType] ?? [];
  return keys.map((key) => cleaned[key]).find(Boolean);
}

export function quoteAssetPublicFieldValue(
  assetType: AssetType,
  publicLabel: string,
  details: Record<string, unknown> | undefined,
  fallback?: { address?: string; estimatedValue?: number }
): string | undefined {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const label = publicLabel.toLowerCase();

  if (assetType === "luxury_vehicle" && (label.includes("vin-decoded") || label.includes("trim"))) {
    return undefined;
  }
  if (assetType === "luxury_vehicle" && label.includes("year / make / model")) {
    return compactJoin([cleaned.year, cleaned.make, cleaned.model], " ");
  }
  if (assetType === "luxury_vehicle" && (label.includes("garaging") || label.includes("address"))) {
    return cleaned.garagingAddress;
  }
  if (assetType === "yacht" && label.includes("year built")) return cleaned.year;
  if (assetType === "yacht" && label.includes("hull length")) return cleaned.length ? `${cleaned.length} ft` : undefined;
  if (assetType === "coastal_home" && label.includes("roof")) {
    return compactJoin([cleaned.roofMaterial, cleaned.roofYear ? `installed ${cleaned.roofYear}` : ""], " - ");
  }
  if (label.includes("address") || label.includes("garaging") || label.includes("marina") || label.includes("mooring")) {
    return primaryQuoteAssetAddress(assetType, cleaned) ?? fallback?.address;
  }
  if (label.includes("msrp") || label.includes("appraised") || label.includes("value")) {
    return currencyText(cleaned.appraisedValue || cleaned.totalInsuredValue || cleaned.requestedLimit) ??
      (fallback?.estimatedValue ? currencyText(String(fallback.estimatedValue)) : undefined);
  }

  const field = (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).find((candidate) =>
    hintMatchesLabel(candidate.publicHints, label)
  );
  if (!field) return undefined;
  return formatDetailForPublicField(field, cleaned[field.key]);
}

export function quoteAssetQuestionAnswered(
  assetType: AssetType,
  questionLabel: string,
  details: Record<string, unknown> | undefined
): boolean {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  const label = questionLabel.toLowerCase();
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? []).some(
    (field) =>
      !!cleaned[field.key] &&
      (hintMatchesLabel(field.questionHints, label) || hintMatchesLabel(field.publicHints, label))
  );
}

export function summarizeQuoteAssetDetails(
  assetType: AssetType,
  details: Record<string, unknown> | undefined
): string[] {
  const cleaned = cleanQuoteAssetDetails(assetType, details);
  return (QUOTE_ASSET_DETAIL_FIELDS[assetType] ?? [])
    .map((field) => {
      const value = cleaned[field.key];
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean);
}

function stringifyDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

function hintMatchesLabel(hints: string[] | undefined, label: string): boolean {
  return (hints ?? []).some((hint) => {
    const normalized = hint.toLowerCase();
    return label.includes(normalized) || normalized.includes(label);
  });
}

function formatDetailForPublicField(field: QuoteAssetDetailField, value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (field.inputType === "currency") return currencyText(value);
  if (field.key === "squareFeet") return `${Number(value).toLocaleString()} sq ft`;
  return value;
}

function currencyText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value.replace(/[$,]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return value;
  return `$${Math.round(numeric).toLocaleString()}`;
}

function compactJoin(values: Array<string | undefined>, separator: string): string | undefined {
  const out = values.map((value) => value?.trim()).filter(Boolean);
  return out.length > 0 ? out.join(separator) : undefined;
}
