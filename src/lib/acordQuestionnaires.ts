import type { PublicDataEvidenceMap, QuotingQuestion, TemplateFieldMap } from "@/types";
import {
  aiEvidenceAllowsDocumentAutofill,
  findAiPublicEvidence,
} from "./aiProductionGuards";

type AcordValueSource =
  | "questionnaire"
  | "public_record"
  | "asset_detail"
  | "contact"
  | "system";

export interface AcordMappedField {
  sourceQuestionId?: string;
  sourceLabel: string;
  targetField: string;
  value: string;
  source: AcordValueSource;
}

export interface AcordTemplateLike {
  templateId: string;
  fileName: string;
  documentName?: string;
  missingFieldCount?: number;
}

export interface AcordFillContext {
  contactName?: string;
  agencyName?: string;
  estimatedValue?: number;
  state?: string;
  publicFields?: Record<string, unknown>;
  publicFieldEvidence?: PublicDataEvidenceMap;
  assetDetails?: Record<string, string>;
  responses?: Record<string, string>;
  knownFields?: Record<string, unknown>;
}

interface AcordQuestionSpec {
  key: string;
  label: string;
  kind: QuotingQuestion["kind"];
  required?: boolean;
  options?: string[];
  targetFields: string[];
  publicHints?: string[];
  assetHints?: string[];
}

interface AcordQuestionnaireDefinition {
  formNumber: string;
  title: string;
  questions: AcordQuestionSpec[];
}

const yesNo = ["Yes", "No", "Not sure"];
const entityTypes = ["LLC", "C-Corp", "S-Corp", "Partnership", "Sole proprietor", "Other"];
const cancellationMethods = ["Flat", "Pro rata", "Short rate", "Other"];
const coverageActions = ["Add", "Change", "Delete", "Cancel", "Other"];

function question(
  key: string,
  label: string,
  kind: QuotingQuestion["kind"],
  targetFields: string[],
  extra: Partial<Omit<AcordQuestionSpec, "key" | "label" | "kind" | "targetFields">> = {}
): AcordQuestionSpec {
  return {
    key,
    label,
    kind,
    targetFields,
    required: true,
    ...extra,
  };
}

const certificateHolder = question(
  "certificate_holder",
  "Certificate holder or evidence holder name and mailing address",
  "textarea",
  ["Certificate holder", "Evidence holder", "Holder name and address"],
  { assetHints: ["certificate holder", "holder", "evidence holder"] }
);

const producerContact = question(
  "producer_contact",
  "Producer contact, phone, email, and agency customer number",
  "textarea",
  ["Producer", "Producer contact", "Agency phone", "Agency email", "Agency customer ID"],
  { required: false, assetHints: ["producer", "agent", "agency contact"] }
);

const insuredNameAddress = question(
  "insured_name_address",
  "Named insured legal name and mailing address",
  "textarea",
  ["Insured", "Named insured", "Applicant name", "Mailing address"],
  {
    publicHints: ["Owner of record"],
    assetHints: ["insured", "named insured", "mailing address", "business legal name"],
  }
);

const policyTerm = question(
  "policy_term",
  "Policy number, effective date, and expiration date",
  "textarea",
  ["Policy number", "Effective date", "Expiration date", "Policy term"],
  { assetHints: ["policy number", "effective date", "expiration date"] }
);

const coverageLimits = question(
  "coverage_limits",
  "Coverage requested, limits, deductibles, and forms",
  "textarea",
  ["Coverage", "Limits", "Deductible", "Forms and endorsements"],
  {
    publicHints: ["Underlying policies"],
    assetHints: ["coverage", "limits", "deductible", "underlying policies"],
  }
);

const lossHistory = question(
  "loss_history",
  "Prior losses or claims in the last 5 years",
  "textarea",
  ["Loss history", "Claims history", "Prior losses"],
  { publicHints: ["Loss history"], assetHints: ["loss history", "claims"] }
);

const vehicleSchedule = question(
  "vehicle_schedule",
  "Vehicle year, make, model, VIN, value, and garaging location",
  "textarea",
  ["Vehicle schedule", "Year / make / model", "VIN", "Garaging address", "Stated value"],
  {
    publicHints: ["Year / make / model", "VIN-decoded trim", "Garaging address", "MSRP at sale"],
    assetHints: ["vin", "vehicle", "garaging"],
  }
);

const propertyLocation = question(
  "property_location",
  "Property location, occupancy, and description",
  "textarea",
  ["Property address", "Location", "Occupancy", "Description of premises"],
  {
    publicHints: ["Property address", "Risk address", "Premises address", "Location address"],
    assetHints: ["property address", "risk address", "premises address", "location address", "occupancy"],
  }
);

const propertyValues = question(
  "property_values",
  "Building, business personal property, income, and other property values",
  "textarea",
  ["Building value", "Business personal property", "Business income", "Other property values"],
  {
    publicHints: ["Appraised value", "MSRP at sale"],
    assetHints: ["building value", "bpp", "business personal property", "business income"],
  }
);

const operations = question(
  "operations",
  "Business operations, products, services, and locations",
  "textarea",
  ["Description of operations", "Business operations", "Products / services", "Locations"],
  { assetHints: ["operations", "business description", "products", "services", "locations"] }
);

const businessIdentity = question(
  "business_identity",
  "Legal business name, entity type, FEIN, website, and years in business",
  "textarea",
  ["Legal business name", "Business legal name", "Entity type", "FEIN", "Website", "Years in business"],
  {
    publicHints: ["Owner of record"],
    assetHints: ["legal business name", "entity type", "ein", "fein", "website", "years"],
  }
);

const scheduleRemarks = question(
  "remarks",
  "Remarks, exceptions, special instructions, or overflow details",
  "textarea",
  ["Remarks", "Additional remarks", "Special instructions"],
  { required: false, assetHints: ["remarks", "notes", "special instructions"] }
);

const DEFINITIONS: Record<string, AcordQuestionnaireDefinition> = {
  "3": {
    formNumber: "3",
    title: "ACORD 3 - Claims / Occurrence Notice",
    questions: [
      insuredNameAddress,
      question("claim_details", "Date, time, location, and description of occurrence", "textarea", [
        "Date of occurrence",
        "Time of occurrence",
        "Location of occurrence",
        "Description of occurrence",
      ]),
      question("claim_parties", "Injured parties, property damage, witnesses, and contacts", "textarea", [
        "Claimant / injured party",
        "Property damage",
        "Witnesses",
        "Contact information",
      ]),
      question("authority_report", "Police, fire, or authority report details", "textarea", [
        "Authority contacted",
        "Report number",
        "Responding agency",
      ], { required: false }),
      lossHistory,
    ],
  },
  "4": {
    formNumber: "4",
    title: "ACORD 4 - Workers Compensation First Report",
    questions: [
      insuredNameAddress,
      question("employee_injury", "Employee name, job title, injury date, and injury description", "textarea", [
        "Employee name",
        "Job title",
        "Date of injury",
        "Injury description",
      ]),
      question("work_status", "Work status, medical provider, and lost-time details", "textarea", [
        "Work status",
        "Medical provider",
        "Lost time",
      ]),
      question("wc_policy", "Workers compensation policy number, carrier, and employer location", "textarea", [
        "WC policy number",
        "Carrier",
        "Employer location",
      ]),
    ],
  },
  "20": {
    formNumber: "20",
    title: "ACORD 20 - Certificate / Evidence Form",
    questions: [certificateHolder, producerContact, insuredNameAddress, policyTerm, coverageLimits],
  },
  "21": {
    formNumber: "21",
    title: "ACORD 21 - Certificate Form",
    questions: [certificateHolder, insuredNameAddress, policyTerm, coverageLimits, scheduleRemarks],
  },
  "22": {
    formNumber: "22",
    title: "ACORD 22 - Certificate Form",
    questions: [certificateHolder, insuredNameAddress, policyTerm, coverageLimits, scheduleRemarks],
  },
  "23": {
    formNumber: "23",
    title: "ACORD 23 - Certificate Form",
    questions: [certificateHolder, producerContact, insuredNameAddress, policyTerm, coverageLimits],
  },
  "24": {
    formNumber: "24",
    title: "ACORD 24 - Certificate of Property Insurance",
    questions: [certificateHolder, insuredNameAddress, propertyLocation, propertyValues, coverageLimits],
  },
  "25": {
    formNumber: "25",
    title: "ACORD 25 - Certificate of Liability Insurance",
    questions: [
      certificateHolder,
      producerContact,
      insuredNameAddress,
      question("liability_coverages", "General liability, auto liability, umbrella, and workers comp limits", "textarea", [
        "Commercial general liability",
        "Automobile liability",
        "Umbrella liability",
        "Workers compensation",
      ]),
      question("description_operations", "Description of operations, locations, vehicles, or special wording", "textarea", [
        "Description of operations",
        "Locations",
        "Vehicles",
        "Special wording",
      ]),
    ],
  },
  "27": {
    formNumber: "27",
    title: "ACORD 27 - Evidence of Property Insurance",
    questions: [certificateHolder, producerContact, insuredNameAddress, propertyLocation, propertyValues, coverageLimits],
  },
  "28": {
    formNumber: "28",
    title: "ACORD 28 - Evidence of Commercial Property Insurance",
    questions: [
      certificateHolder,
      propertyLocation,
      propertyValues,
      question("property_coverage_terms", "Causes of loss, coinsurance, valuation, deductibles, and mortgagee details", "textarea", [
        "Causes of loss",
        "Coinsurance",
        "Valuation",
        "Deductibles",
        "Mortgagee / lender",
      ]),
    ],
  },
  "30": {
    formNumber: "30",
    title: "ACORD 30 - Certificate / Evidence Form",
    questions: [certificateHolder, producerContact, insuredNameAddress, policyTerm, coverageLimits],
  },
  "31": {
    formNumber: "31",
    title: "ACORD 31 - Certificate / Evidence Form",
    questions: [certificateHolder, insuredNameAddress, policyTerm, coverageLimits, scheduleRemarks],
  },
  "35": {
    formNumber: "35",
    title: "ACORD 35 - Cancellation Request / Policy Release",
    questions: [
      insuredNameAddress,
      question("cancel_policy", "Policy number, carrier, line of business, and cancellation date", "textarea", [
        "Policy number",
        "Carrier",
        "Line of business",
        "Cancellation date",
      ]),
      question("cancel_reason", "Reason for cancellation or policy release", "textarea", [
        "Cancellation reason",
        "Policy release reason",
      ]),
      question("cancel_method", "Cancellation method", "select", ["Cancellation method"], {
        options: cancellationMethods,
      }),
      question("return_premium", "Return premium, finance company, or lienholder instructions", "textarea", [
        "Return premium",
        "Finance company",
        "Lienholder instructions",
      ], { required: false }),
    ],
  },
  "36": {
    formNumber: "36",
    title: "ACORD 36 - Agent / Broker of Record Change",
    questions: [
      insuredNameAddress,
      question("current_agent", "Current agent or broker information", "textarea", [
        "Current agent",
        "Current broker",
      ]),
      question("new_agent", "New agent or broker of record information", "textarea", [
        "New agent",
        "New broker of record",
      ]),
      policyTerm,
      question("bor_authorization", "Authorized signer name, title, and requested effective date", "textarea", [
        "Authorized signer",
        "Signer title",
        "Requested effective date",
      ]),
    ],
  },
  "37": {
    formNumber: "37",
    title: "ACORD 37 - Statement of No Loss",
    questions: [
      insuredNameAddress,
      policyTerm,
      question("no_loss_period", "No-loss statement period and affected location or vehicle", "textarea", [
        "No-loss period",
        "Affected location",
        "Affected vehicle",
      ]),
      question("no_loss_confirmation", "Confirm no known losses, claims, or incidents", "select", [
        "No known losses confirmation",
      ], { options: yesNo }),
    ],
  },
  "45": {
    formNumber: "45",
    title: "ACORD 45 - Additional Interest",
    questions: [
      insuredNameAddress,
      question("interest_party", "Additional interest name, address, role, and loan or reference number", "textarea", [
        "Additional interest name",
        "Additional interest address",
        "Interest type",
        "Loan / reference number",
      ]),
      propertyLocation,
      vehicleSchedule,
      scheduleRemarks,
    ],
  },
  "50": {
    formNumber: "50",
    title: "ACORD 50 - Auto ID Card",
    questions: [
      insuredNameAddress,
      vehicleSchedule,
      question("auto_policy", "Auto carrier, policy number, effective date, and expiration date", "textarea", [
        "Auto carrier",
        "Auto policy number",
        "Effective date",
        "Expiration date",
      ]),
      question("naic_code", "NAIC code and agency contact for the ID card", "text", [
        "NAIC code",
        "Agency contact",
      ], { required: false }),
    ],
  },
  "63": {
    formNumber: "63",
    title: "ACORD 63 - Fraud Statement",
    questions: [
      insuredNameAddress,
      question("fraud_state", "State-specific fraud statement jurisdiction", "text", ["Fraud statement state"], {
        assetHints: ["state"],
      }),
      question("acknowledgement", "Applicant acknowledgement, signer name, title, and date", "textarea", [
        "Applicant acknowledgement",
        "Signer name",
        "Signer title",
        "Signature date",
      ]),
      scheduleRemarks,
    ],
  },
  "70": {
    formNumber: "70",
    title: "ACORD 70 - Personal Policy Change Request",
    questions: [
      insuredNameAddress,
      policyTerm,
      question("personal_change", "Personal policy change requested", "select", ["Change type"], {
        options: coverageActions,
      }),
      question("personal_change_details", "Effective date, affected coverage, and change details", "textarea", [
        "Effective date",
        "Affected coverage",
        "Change details",
      ]),
      scheduleRemarks,
    ],
  },
  "71": {
    formNumber: "71",
    title: "ACORD 71 - Personal Auto Policy Change Request",
    questions: [
      insuredNameAddress,
      policyTerm,
      vehicleSchedule,
      question("driver_change", "Driver add, remove, license, date of birth, and usage details", "textarea", [
        "Driver change",
        "License number",
        "Date of birth",
        "Vehicle usage",
      ]),
      question("auto_change", "Coverage, lienholder, or garaging change requested", "textarea", [
        "Coverage change",
        "Lienholder change",
        "Garaging change",
      ]),
    ],
  },
  "75": {
    formNumber: "75",
    title: "ACORD 75 - Insurance Binder",
    questions: [
      insuredNameAddress,
      question("binder_term", "Binder number, carrier, effective date, expiration date, and time", "textarea", [
        "Binder number",
        "Carrier",
        "Effective date",
        "Expiration date",
        "Time",
      ]),
      coverageLimits,
      propertyLocation,
      question("binder_conditions", "Binder conditions, mortgagee, additional interest, and cancellation notice", "textarea", [
        "Binder conditions",
        "Mortgagee",
        "Additional interest",
        "Cancellation notice",
      ]),
    ],
  },
  "80": {
    formNumber: "80",
    title: "ACORD 80 - Homeowner Application",
    questions: [
      insuredNameAddress,
      propertyLocation,
      question("home_construction", "Year built, square footage, construction, roof, protection, and occupancy", "textarea", [
        "Year built",
        "Square footage",
        "Construction type",
        "Roof",
        "Protection class",
        "Occupancy",
      ], {
        publicHints: ["Year built", "Square footage", "Construction type", "Roof material"],
      }),
      propertyValues,
      lossHistory,
    ],
  },
  "83": {
    formNumber: "83",
    title: "ACORD 83 - Personal Umbrella Application",
    questions: [
      insuredNameAddress,
      question("umbrella_limit", "Umbrella limit requested and underlying policy schedule", "textarea", [
        "Umbrella limit",
        "Underlying policy schedule",
      ], { publicHints: ["Underlying policies"] }),
      question("household_exposures", "Household drivers, residences, watercraft, recreational vehicles, and employees", "textarea", [
        "Household drivers",
        "Residences",
        "Watercraft",
        "Recreational vehicles",
        "Employees",
      ]),
      question("personal_liability_exposures", "Boards, public profile, animals, pools, rentals, or other liability exposures", "textarea", [
        "Boards",
        "Public profile",
        "Animals",
        "Pools",
        "Rental exposures",
      ]),
      lossHistory,
    ],
  },
  "84": {
    formNumber: "84",
    title: "ACORD 84 - Dwelling Fire Application",
    questions: [
      insuredNameAddress,
      propertyLocation,
      question("dwelling_details", "Dwelling use, occupancy, protection, construction, roof, and updates", "textarea", [
        "Dwelling use",
        "Occupancy",
        "Protection",
        "Construction",
        "Roof",
        "Updates",
      ], { publicHints: ["Year built", "Construction type", "Roof material"] }),
      propertyValues,
      lossHistory,
    ],
  },
  "101": {
    formNumber: "101",
    title: "ACORD 101 - Additional Remarks Schedule",
    questions: [
      insuredNameAddress,
      question("related_form", "Related ACORD form number, policy, carrier, and page reference", "textarea", [
        "Related ACORD form",
        "Policy number",
        "Carrier",
        "Page reference",
      ]),
      scheduleRemarks,
      question("remark_author", "Remark author, date, and agency contact", "textarea", [
        "Remark author",
        "Remark date",
        "Agency contact",
      ], { required: false }),
    ],
  },
  "125": {
    formNumber: "125",
    title: "ACORD 125 - Commercial Insurance Application",
    questions: [
      businessIdentity,
      insuredNameAddress,
      question("contact_information", "Primary contact, phone, email, and mailing address", "textarea", [
        "Primary contact",
        "Phone",
        "Email",
        "Mailing address",
      ]),
      operations,
      question("commercial_exposures", "Annual revenue, payroll, employee count, locations, and operating states", "textarea", [
        "Annual revenue",
        "Payroll",
        "Employee count",
        "Locations",
        "Operating states",
      ]),
      lossHistory,
    ],
  },
  "126": {
    formNumber: "126",
    title: "ACORD 126 - Commercial General Liability Section",
    questions: [
      businessIdentity,
      question("gl_classification", "Premises operations classification, class code, exposure basis, and rates", "textarea", [
        "GL classification",
        "Class code",
        "Exposure basis",
        "Rates",
      ]),
      question("products_completed_ops", "Products and completed operations description", "textarea", [
        "Products",
        "Completed operations",
      ]),
      question("subcontractor_controls", "Subcontracted work, certificates, additional insureds, and hold harmless controls", "textarea", [
        "Subcontracted work",
        "Certificates",
        "Additional insureds",
        "Hold harmless",
      ]),
      lossHistory,
    ],
  },
  "127": {
    formNumber: "127",
    title: "ACORD 127 - Business Auto Section",
    questions: [
      businessIdentity,
      vehicleSchedule,
      question("driver_schedule", "Driver names, dates of birth, license numbers, and MVR concerns", "textarea", [
        "Driver schedule",
        "Date of birth",
        "License number",
        "MVR concerns",
      ]),
      question("auto_exposures", "Vehicle use, radius, hired auto, non-owned auto, and filings", "textarea", [
        "Vehicle use",
        "Radius",
        "Hired auto",
        "Non-owned auto",
        "Filings",
      ]),
      lossHistory,
    ],
  },
  "128": {
    formNumber: "128",
    title: "ACORD 128 - Garage and Dealers Section",
    questions: [
      businessIdentity,
      question("garage_operations", "Garage, dealer, service, repair, storage, and towing operations", "textarea", [
        "Garage operations",
        "Dealer operations",
        "Service / repair",
        "Storage",
        "Towing",
      ]),
      question("dealer_exposures", "Dealer plates, demos, loaners, non-owned autos, and garagekeepers exposure", "textarea", [
        "Dealer plates",
        "Demos",
        "Loaners",
        "Non-owned autos",
        "Garagekeepers",
      ]),
      propertyLocation,
      lossHistory,
    ],
  },
  "129": {
    formNumber: "129",
    title: "ACORD 129 - Vehicle Schedule",
    questions: [
      businessIdentity,
      vehicleSchedule,
      question("vehicle_use", "Vehicle use, radius, territory, garaging, and ownership or lease status", "textarea", [
        "Vehicle use",
        "Radius",
        "Territory",
        "Garaging",
        "Ownership / lease",
      ]),
      question("vehicle_interest", "Lienholder, lessor, loss payee, and additional interest details", "textarea", [
        "Lienholder",
        "Lessor",
        "Loss payee",
        "Additional interest",
      ], { required: false }),
    ],
  },
  "131": {
    formNumber: "131",
    title: "ACORD 131 - Umbrella / Excess Section",
    questions: [
      businessIdentity,
      question("umbrella_limit_commercial", "Umbrella or excess limit requested, retention, and policy type", "textarea", [
        "Umbrella / excess limit",
        "Retention",
        "Policy type",
      ]),
      question("underlying_schedule", "Underlying general liability, auto, employers liability, and other policies", "textarea", [
        "Underlying general liability",
        "Underlying auto",
        "Employers liability",
        "Other underlying policies",
      ], { publicHints: ["Underlying policies"] }),
      operations,
      lossHistory,
    ],
  },
  "140": {
    formNumber: "140",
    title: "ACORD 140 - Property Section",
    questions: [
      businessIdentity,
      propertyLocation,
      question("building_details", "Building number, year built, construction, occupancy, protection, roof, and updates", "textarea", [
        "Building number",
        "Year built",
        "Construction",
        "Occupancy",
        "Protection",
        "Roof",
        "Updates",
      ], {
        publicHints: ["Year built", "Construction type", "Roof material", "Square footage"],
      }),
      propertyValues,
      question("property_safeguards", "Protective safeguards, alarms, sprinklers, distance to hydrant, and exposure details", "textarea", [
        "Protective safeguards",
        "Alarms",
        "Sprinklers",
        "Distance to hydrant",
        "Exposure details",
      ], { publicHints: ["Distance to coast"] }),
      lossHistory,
    ],
  },
  "140-filled": {
    formNumber: "140 Filled",
    title: "ACORD 140 - Property Section Filled Sample",
    questions: [businessIdentity, propertyLocation, propertyValues, scheduleRemarks],
  },
  "152": {
    formNumber: "152",
    title: "ACORD 152 - Commercial Inland Marine Section",
    questions: [
      businessIdentity,
      question("scheduled_property", "Scheduled property, equipment, tools, fine arts, or installation floater items", "textarea", [
        "Scheduled property",
        "Equipment",
        "Tools",
        "Fine arts",
        "Installation floater",
      ], { publicHints: ["Item type", "Appraised value"] }),
      question("im_values_limits", "Values, limits, deductibles, valuation, and coinsurance", "textarea", [
        "Values",
        "Limits",
        "Deductibles",
        "Valuation",
        "Coinsurance",
      ]),
      question("transit_storage", "Transit, jobsite, storage, and off-premises exposure", "textarea", [
        "Transit exposure",
        "Jobsite exposure",
        "Storage",
        "Off-premises exposure",
      ]),
      lossHistory,
    ],
  },
  "611": {
    formNumber: "611",
    title: "ACORD 611 - Supplemental ACORD Form",
    questions: [businessIdentity, operations, coverageLimits, lossHistory, scheduleRemarks],
  },
  "810": {
    formNumber: "810",
    title: "ACORD 810 - Supplemental ACORD Form",
    questions: [
      businessIdentity,
      question("supplemental_locations", "Supplemental locations, exposures, schedule rows, and payroll or sales basis", "textarea", [
        "Supplemental locations",
        "Exposure schedule",
        "Payroll basis",
        "Sales basis",
      ]),
      coverageLimits,
      lossHistory,
      scheduleRemarks,
    ],
  },
  "823": {
    formNumber: "823",
    title: "ACORD 823 - Supplemental ACORD Form",
    questions: [
      businessIdentity,
      operations,
      question("supplemental_controls", "Risk controls, safeguards, inspections, contracts, and certificates", "textarea", [
        "Risk controls",
        "Safeguards",
        "Inspections",
        "Contracts",
        "Certificates",
      ]),
      lossHistory,
      scheduleRemarks,
    ],
  },
  "1035": {
    formNumber: "1035",
    title: "ACORD 1035 - Supplemental ACORD Form",
    questions: [
      businessIdentity,
      operations,
      question("professional_services", "Professional services, advisory work, revenue split, and contractual requirements", "textarea", [
        "Professional services",
        "Advisory work",
        "Revenue split",
        "Contractual requirements",
      ]),
      lossHistory,
      scheduleRemarks,
    ],
  },
  "packet-1": {
    formNumber: "Packet 1",
    title: "Downloaded ACORD Packet",
    questions: [businessIdentity, operations, coverageLimits, propertyLocation, vehicleSchedule, lossHistory],
  },
  "packet-2": {
    formNumber: "Packet 2",
    title: "Downloaded ACORD Packet Copy",
    questions: [businessIdentity, operations, coverageLimits, propertyLocation, vehicleSchedule, lossHistory],
  },
  "untitled-11": {
    formNumber: "Untitled 11",
    title: "Imported ACORD PDF Packet",
    questions: [businessIdentity, insuredNameAddress, operations, coverageLimits, propertyLocation, lossHistory, scheduleRemarks],
  },
};

const FALLBACK_DEFINITION: AcordQuestionnaireDefinition = {
  formNumber: "Form",
  title: "ACORD Form",
  questions: [insuredNameAddress, operations, coverageLimits, lossHistory, scheduleRemarks],
};

export function getAcordFormNumber(input: {
  fileName?: string;
  documentName?: string;
}): string {
  const text = `${input.fileName ?? ""} ${input.documentName ?? ""}`;
  const lower = text.toLowerCase();
  if (lower.includes("140-filled") || lower.includes("140 - property section - filled")) {
    return "140-filled";
  }
  if (lower.includes("exercise-download-files-1") || lower.includes("packet copy")) {
    return "packet-2";
  }
  if (lower.includes("exercise-download-files") || lower.includes("downloaded acord packet")) {
    return "packet-1";
  }
  if (lower.includes("untitled-document-11") || lower.includes("imported pdf packet")) {
    return "untitled-11";
  }
  const match =
    text.match(/\bACORD[-_\s]?0?(\d{1,4})\b/i) ??
    text.match(/\bacord_?0?(\d{1,4})\b/i);
  if (match) return String(Number(match[1]));
  return "Form";
}

export function acordDefinitionForTemplate(
  template: Pick<AcordTemplateLike, "fileName" | "documentName">
): AcordQuestionnaireDefinition {
  return DEFINITIONS[getAcordFormNumber(template)] ?? FALLBACK_DEFINITION;
}

export function acordQuestionCountForTemplate(
  template: Pick<AcordTemplateLike, "fileName" | "documentName">
): number {
  return acordDefinitionForTemplate(template).questions.length;
}

export function buildAcordQuestionsForTemplate(
  template: AcordTemplateLike,
  context: AcordFillContext
): QuotingQuestion[] {
  const definition = acordDefinitionForTemplate(template);
  return definition.questions
    .filter((spec) => !shouldSuppressAcordQuestion(template, spec, context))
    .map((spec) => ({
      id: questionId(template, spec),
      section: `${definition.title} - ACORD fields`,
      label: `ACORD ${definition.formNumber}: ${spec.label}`,
      kind: spec.kind,
      options: spec.options,
      required: spec.required,
      round: "initial",
      sourceDocumentId: template.templateId,
      sourceDocumentFileName: template.fileName,
      acordFormNumber: definition.formNumber,
      acordFieldKey: spec.key,
      acordFieldLabels: spec.targetFields,
    }));
}

export function buildAcordFilledFieldsForTemplate(
  template: AcordTemplateLike,
  context: AcordFillContext
): { fields: TemplateFieldMap; mappings: AcordMappedField[]; missingFieldLabels: string[] } {
  const definition = acordDefinitionForTemplate(template);
  const fields: TemplateFieldMap = {
    "ACORD form number": `ACORD ${definition.formNumber}`,
    "Form name": definition.title,
  };
  const mappings: AcordMappedField[] = [];
  const missingFieldLabels: string[] = [];

  definition.questions.forEach((spec) => {
    const resolved = resolveAcordValue(template, spec, context);
    if (!resolved) {
      if (spec.required) missingFieldLabels.push(`ACORD ${definition.formNumber}: ${spec.label}`);
      return;
    }
    const targetValues = targetFieldValuesForResolvedValue(spec, resolved.value, resolved.source);
    if (targetValues.length === 0) {
      if (spec.required) missingFieldLabels.push(`ACORD ${definition.formNumber}: ${spec.label}`);
      return;
    }
    targetValues.forEach(({ targetField, value }) => {
      fields[targetField] = value;
      mappings.push({
        sourceQuestionId: resolved.source === "questionnaire" ? questionId(template, spec) : undefined,
        sourceLabel: `ACORD ${definition.formNumber}: ${spec.label}`,
        targetField,
        value,
        source: resolved.source,
      });
    });
  });

  return { fields, mappings, missingFieldLabels };
}

export function countAcordAutoFilledFields(
  template: AcordTemplateLike,
  context: AcordFillContext
): number {
  const definition = acordDefinitionForTemplate(template);
  return definition.questions.filter((spec) => resolveAcordValue(template, spec, context)).length;
}

function questionId(template: AcordTemplateLike, spec: AcordQuestionSpec): string {
  return `acord-${template.templateId}-${fieldSlug(spec.key)}`;
}

function shouldSuppressAcordQuestion(
  template: AcordTemplateLike,
  spec: AcordQuestionSpec,
  context: AcordFillContext
): boolean {
  void template;
  void spec;
  void context;
  // Agents and clients must always be able to review and correct every
  // ACORD-specific questionnaire item. Known data should prefill fields;
  // it should never remove the question from the workflow.
  return false;
/*
  const resolved = resolveAcordValue(template, spec, context);
  if (!resolved) return false;
  if (resolved.source === "questionnaire") return false;
  if (targetFieldsCarrySameValue(spec.targetFields)) return true;
  return compositeAcordQuestionComplete(spec, context);
*/
}

function resolveAcordValue(
  template: AcordTemplateLike,
  spec: AcordQuestionSpec,
  context: AcordFillContext
): { value: string; source: AcordValueSource } | null {
  const fromQuestionnaire = context.responses?.[questionId(template, spec)]?.trim();
  if (fromQuestionnaire) return { value: fromQuestionnaire, source: "questionnaire" };

  const assetEntry = findEntryByHints(context.assetDetails, [
    spec.key,
    spec.label,
    ...(spec.assetHints ?? []),
  ]);
  if (
    assetEntry &&
    sourceEntryCompatibleWithAcordQuestion(spec, assetEntry.key, assetEntry.value) &&
    evidenceAllowsAcordAutofill(context.publicFieldEvidence, assetEntry.key, "asset_detail")
  ) {
    return { value: assetEntry.value, source: "asset_detail" };
  }

  const publicEntry = findEntryByHints(context.publicFields, [
    spec.key,
    spec.label,
    ...(spec.publicHints ?? []),
  ]);
  if (
    publicEntry &&
    sourceEntryCompatibleWithAcordQuestion(spec, publicEntry.key, publicEntry.value) &&
    evidenceAllowsAcordAutofill(context.publicFieldEvidence, publicEntry.key, "public_record")
  ) {
    return { value: publicEntry.value, source: "public_record" };
  }

  const knownValue = findValueByHints(context.knownFields, [
    spec.key,
    spec.label,
    ...spec.targetFields,
    ...(spec.assetHints ?? []),
    ...(spec.publicHints ?? []),
  ]);
  if (knownValue) return { value: knownValue, source: "system" };

  const key = spec.key.toLowerCase();
  if (
    context.contactName &&
    canUseContactNameFallback(spec, key)
  ) {
    return { value: context.contactName, source: "contact" };
  }
  if (context.agencyName && canUseAgencyNameFallback(spec, key)) {
    return { value: context.agencyName, source: "system" };
  }
  if (context.state && (key.includes("state") || key.includes("fraud"))) {
    return { value: context.state, source: "system" };
  }
  if (
    typeof context.estimatedValue === "number" &&
    context.estimatedValue > 0 &&
    (key.includes("value") || key.includes("limit") || key.includes("coverage"))
  ) {
    return {
      value: `$${Math.round(context.estimatedValue).toLocaleString()}`,
      source: "system",
    };
  }
  return null;
}

function targetFieldsForResolvedValue(spec: AcordQuestionSpec): string[] {
  if (spec.key === "property_location") {
    return spec.targetFields.filter((field) => {
      const normalized = normalize(field);
      return targetFieldKind(field) === "property_address" || normalized === "location";
    });
  }
  return targetFieldsCarrySameValue(spec.targetFields) ? spec.targetFields : [];
}

function targetFieldValuesForResolvedValue(
  spec: AcordQuestionSpec,
  resolvedValue: string,
  source: AcordValueSource
): { targetField: string; value: string }[] {
  const sameValueTargets = targetFieldsForResolvedValue(spec);
  if (sameValueTargets.length > 0) {
    const parsedByTarget = sameValueTargets
      .map((targetField) => ({
        targetField,
        value: extractCompositeTargetValue(resolvedValue, targetField),
      }))
      .filter((item): item is { targetField: string; value: string } => !!item.value);
    if (parsedByTarget.length > 0) return parsedByTarget;
    if (source === "questionnaire") {
      return sameValueTargets.length === 1
        ? [{ targetField: sameValueTargets[0], value: resolvedValue }]
        : [];
    }
    return sameValueTargets.map((targetField) => ({ targetField, value: resolvedValue }));
  }

  const mapped = spec.targetFields
    .map((targetField) => ({
      targetField,
      value: extractCompositeTargetValue(resolvedValue, targetField),
    }))
    .filter((item): item is { targetField: string; value: string } => !!item.value);
  if (mapped.length > 0) return mapped;

  // A human may type a single free-form answer into a grouped ACORD
  // question. Put that answer in one field only, never every grouped
  // field, so it remains legible and reviewable without fabricating
  // separate component values.
  if (source === "questionnaire") {
    const targetField = spec.targetFields.find((field) => targetFieldKind(field) !== "generic") ?? spec.targetFields[0];
    return targetField ? [{ targetField, value: resolvedValue }] : [];
  }
  return [];
}

function compositeAcordQuestionComplete(
  spec: AcordQuestionSpec,
  context: AcordFillContext
): boolean {
  const targetFields = spec.targetFields.filter((field) => targetFieldKind(field) !== "generic");
  if (targetFields.length === 0) return false;
  return targetFields.every((targetField) => !!knownValueForTargetField(spec, targetField, context));
}

function knownValueForTargetField(
  spec: AcordQuestionSpec,
  targetField: string,
  context: AcordFillContext
): string | null {
  const hints = targetSpecificHints(targetField);
  const known = findValueByHints(context.knownFields, [targetField]);
  if (known) return known;

  const assetEntry = findEntryByHints(context.assetDetails, hints);
  if (
    assetEntry &&
    sourceEntryCompatibleWithAcordQuestion(spec, assetEntry.key, assetEntry.value) &&
    evidenceAllowsAcordAutofill(context.publicFieldEvidence, assetEntry.key, "asset_detail")
  ) {
    return assetEntry.value;
  }

  const publicEntry = findEntryByHints(context.publicFields, hints);
  if (
    publicEntry &&
    sourceEntryCompatibleWithAcordQuestion(spec, publicEntry.key, publicEntry.value) &&
    evidenceAllowsAcordAutofill(context.publicFieldEvidence, publicEntry.key, "public_record")
  ) {
    return publicEntry.value;
  }

  switch (targetFieldKind(targetField)) {
    case "insured_name":
      return context.contactName ?? null;
    case "agency_name":
      return context.agencyName ?? null;
    case "property_address":
      return (
        findValueByHints(context.assetDetails, [targetField, "Property address", "Risk address", "Premises address"]) ??
        findValueByHints(context.publicFields, [targetField, "Property address", "Risk address", "Premises address"])
      );
    case "coverage":
      return typeof context.estimatedValue === "number" && context.estimatedValue > 0
        ? String(context.estimatedValue)
        : null;
    default:
      return null;
  }
}

function targetSpecificHints(targetField: string): string[] {
  const kind = targetFieldKind(targetField);
  const base = [targetField];
  if (kind === "insured_name") return [...base, "Named insured", "Applicant name", "Legal business name"];
  if (kind === "insured_mailing_address") return [...base, "Mailing address"];
  if (kind === "property_address") return [...base, "Property address", "Risk address", "Premises address", "Location address"];
  if (kind === "agency_name") return [...base, "Producer", "Agency", "Agency name"];
  if (kind === "agency_phone" || kind === "insured_phone") return [...base, "Phone", "Primary phone"];
  if (kind === "agency_email" || kind === "insured_email") return [...base, "Email", "Primary email"];
  if (kind === "fein") return [...base, "FEIN", "EIN", "Federal EIN", "Tax ID"];
  if (kind === "entity_type") return [...base, "Entity type", "Business entity type"];
  if (kind === "website") return [...base, "Website", "Business website"];
  if (kind === "years_in_business") return [...base, "Years in business", "Year established"];
  if (kind === "industry_code") return [...base, "Primary industry", "NAICS", "SIC"];
  if (kind === "operations") return [...base, "Business operations", "Description of operations", "Products / services"];
  if (kind === "revenue") return [...base, "Annual revenue", "Revenue"];
  if (kind === "payroll") return [...base, "Payroll"];
  if (kind === "loss_history") return [...base, "Loss history", "Claims", "Losses"];
  return base;
}

function extractCompositeTargetValue(value: string, targetField: string): string {
  const lines = compositeAnswerLines(value);
  if (lines.length === 0) return "";
  const target = normalize(targetField);
  const exact = lines.find(({ label }) => {
    const key = normalize(label);
    return key === target || target.includes(key) || key.includes(target);
  });
  if (exact) return exact.value;
  const targetKind = targetFieldKind(targetField);
  if (targetKind === "generic") return "";
  const kindMatch = lines.find(({ label }) => targetFieldKind(label) === targetKind);
  return kindMatch?.value ?? "";
}

function compositeAnswerLines(value: string): { label: string; value: string }[] {
  return value
    .split(/\r?\n|;\s+/)
    .map((line) => line.trim())
    .map((line) => line.match(/^([^:]{2,90}):\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => !!match?.[1] && !!match?.[2])
    .map((match) => ({ label: match[1].trim(), value: match[2].trim() }))
    .filter((line) => !!line.label && !!line.value);
}

function targetFieldsCarrySameValue(targetFields: string[]): boolean {
  if (targetFields.length <= 1) return true;
  const kinds = targetFields.map(targetFieldKind);
  if (kinds.includes("generic")) return false;
  return new Set(kinds).size === 1;
}

function canUseContactNameFallback(spec: AcordQuestionSpec, key: string): boolean {
  if (!(key.includes("insured") || key.includes("identity") || key.includes("business"))) return false;
  const kinds = new Set(spec.targetFields.map(targetFieldKind));
  return kinds.size === 1 && kinds.has("insured_name");
}

function canUseAgencyNameFallback(spec: AcordQuestionSpec, key: string): boolean {
  if (!key.includes("producer")) return false;
  const kinds = new Set(spec.targetFields.map(targetFieldKind));
  return kinds.size === 1 && kinds.has("agency_name");
}

function targetFieldKind(label: string): string {
  const normalized = normalize(label);
  if (normalized.includes("fax")) return normalized.includes("agency") || normalized.includes("producer") ? "agency_fax" : "insured_fax";
  if (normalized.includes("email")) return normalized.includes("agency") || normalized.includes("producer") ? "agency_email" : "insured_email";
  if (normalized.includes("phone")) return normalized.includes("agency") || normalized.includes("producer") ? "agency_phone" : "insured_phone";
  if (normalized.includes("website")) return "website";
  if (normalized.includes("address")) {
    if (normalized.includes("agency") || normalized.includes("producer")) return "agency_address";
    if (normalized.includes("property") || normalized.includes("risk") || normalized.includes("premises") || normalized.includes("location")) {
      return "property_address";
    }
    return "insured_mailing_address";
  }
  if (normalized.includes("customer") || normalized.includes("account number")) return "agency_customer_id";
  if (normalized.includes("fein") || normalized.includes("tax") || normalized.includes("ein")) return "fein";
  if (normalized.includes("policy") && (normalized.includes("number") || normalized.includes("no"))) return "policy_number";
  if (normalized.includes("effective")) return "effective_date";
  if (normalized.includes("expiration")) return "expiration_date";
  if (normalized.includes("premium")) return "premium";
  if (normalized.includes("revenue")) return "revenue";
  if (normalized.includes("payroll")) return "payroll";
  if (normalized.includes("deductible")) return "deductible";
  if (normalized.includes("coverage") || normalized.includes("limit")) return "coverage";
  if (normalized.includes("entity")) return "entity_type";
  if (normalized.includes("year") && (normalized.includes("business") || normalized.includes("established"))) {
    return "years_in_business";
  }
  if (normalized.includes("naics") || normalized.includes("sic") || normalized.includes("industry")) {
    return "industry_code";
  }
  if (normalized.includes("loss") || normalized.includes("claim")) return "loss_history";
  if (normalized.includes("operation") || normalized.includes("product") || normalized.includes("service")) return "operations";
  if (normalized.includes("remark") || normalized.includes("instruction")) return "remarks";
  if (normalized.includes("agency") || normalized.includes("producer")) return "agency_name";
  if (
    normalized === "insured" ||
    normalized.includes("insured") ||
    normalized.includes("applicant") ||
    normalized.includes("legal business") ||
    normalized.includes("business legal") ||
    normalized.includes("client name")
  ) {
    return "insured_name";
  }
  return "generic";
}

function sourceEntryCompatibleWithAcordQuestion(
  spec: AcordQuestionSpec,
  sourceKey: string,
  value: string
): boolean {
  const key = normalize(sourceKey);
  const fieldKinds = new Set(spec.targetFields.map(targetFieldKind));
  const looksAddress =
    /\d/.test(value) &&
    /\b(st|street|rd|road|ave|avenue|dr|drive|ln|lane|blvd|boulevard|ct|court|cir|circle|way|pkwy|parkway|hwy|highway|pl|place|terrace|ter|trail|trl|mi|fl|ga|sc|ny|ca|tx|il|oh|pa|zip)\b/i.test(
      value
    );
  if (spec.key === "property_location" || fieldKinds.has("property_address")) {
    if (key.includes("owner") || key.includes("insured") || key.includes("applicant") || key.includes("name")) {
      return false;
    }
    return looksAddress;
  }
  if (fieldKinds.has("insured_name")) {
    return !(key.includes("property address") || key.includes("risk address") || key.includes("premises address"));
  }
  return true;
}

function findValueByHints(
  values: Record<string, unknown> | undefined,
  hints: string[]
): string | null {
  return findEntryByHints(values, hints)?.value ?? null;
}

function findEntryByHints(
  values: Record<string, unknown> | undefined,
  hints: string[]
): { key: string; value: string } | null {
  if (!values) return null;
  const entries = Object.entries(values)
    .map(([key, value]) => [key, stringifyValue(value)] as const)
    .filter(([, value]) => !!value);
  if (entries.length === 0) return null;
  const normalizedHints = hints.map(normalize).filter(Boolean);
  for (const hint of normalizedHints) {
    const exact = entries.find(([key]) => normalize(key) === hint);
    if (exact) return { key: exact[0], value: exact[1] };
  }
  for (const hint of normalizedHints) {
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalize(key);
      return normalizedKey.includes(hint) || hint.includes(normalizedKey);
    });
    if (fuzzy) return { key: fuzzy[0], value: fuzzy[1] };
  }
  return null;
}

function evidenceAllowsAcordAutofill(
  evidence: PublicDataEvidenceMap | undefined,
  fieldKey: string,
  source: "asset_detail" | "public_record"
): boolean {
  const match = findAiPublicEvidence(evidence, fieldKey);
  if (!match) return source !== "public_record";
  return aiEvidenceAllowsDocumentAutofill(match);
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function fieldSlug(value: string): string {
  return normalize(value).replace(/\s+/g, "-") || "field";
}
