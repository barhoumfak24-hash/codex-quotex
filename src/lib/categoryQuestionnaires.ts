import type {
  AssetType,
  CategoryQuestion,
  InsuranceCategory,
  QuotingQuestion,
} from "@/types";

type QuestionPatch = Partial<Omit<CategoryQuestion, "key" | "label" | "inputType">>;

function q(
  key: string,
  label: string,
  inputType: CategoryQuestion["inputType"] = "text",
  patch: QuestionPatch = {}
): CategoryQuestion {
  return { key, label, inputType, ...patch };
}

function norm(text: string): string {
  return text.toLowerCase().replace(/&/g, "and");
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function dedupe(questions: CategoryQuestion[]): CategoryQuestion[] {
  const seen = new Set<string>();
  const out: CategoryQuestion[] = [];
  for (const question of questions) {
    const key = question.key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...question, key });
  }
  return out;
}

function baseAssetQuestions(assetType: AssetType): CategoryQuestion[] {
  switch (assetType) {
    case "coastal_home":
      return [
        q("propertyAddress", "Property address", "address", { required: true }),
        q("occupancy", "Occupancy", "select", {
          options: ["Primary", "Secondary", "Rental", "Vacant", "Mixed use"],
          required: true,
        }),
      ];
    case "luxury_vehicle":
      return [
        q("vin", "VIN", "text", { required: true, placeholder: "17-character VIN" }),
        q("garagingAddressIfDifferent", "Garaging address if different from home", "address"),
        q("annualMileage", "Annual mileage", "number"),
        q("primaryUse", "Primary use", "select", {
          options: ["Pleasure", "Commute", "Business", "Collector", "Seasonal"],
        }),
        q("driverExceptions", "Drivers not already listed in your profile", "textarea"),
      ];
    case "yacht":
      return [
        q("hin", "Hull ID / HIN", "text"),
        q("vesselName", "Vessel name", "text"),
        q("mooringLocation", "Marina or mooring location", "address"),
        q("navigationTerritory", "Navigation territory", "text"),
        q("operatorExperience", "Operator or captain experience", "textarea"),
        q("surveyOrAppraisal", "Survey or appraisal on file?", "boolean"),
      ];
    case "jewelry":
      return [
        q("appraisedValue", "Appraised value", "currency", { required: true }),
        q("appraisalDate", "Most recent appraisal date", "date"),
        q("storageLocation", "Storage when not in use", "select", {
          options: ["Home safe", "Bank vault", "Alarmed residence", "Worn daily", "Other"],
        }),
        q("travelExposure", "Taken outside the home or while traveling?", "boolean"),
      ];
    case "umbrella_liability":
      return [
        q("requestedLimit", "Requested liability limit", "currency", { required: true }),
        q("underlyingPoliciesNotInQuotex", "Underlying policies not already on file", "textarea"),
        q("householdExposureNotes", "Drivers, household staff, boards, pets, pools, or other liability notes", "textarea"),
      ];
    case "full_portfolio":
      return [
        q("primaryResidenceAddress", "Primary residence address", "address", { required: true }),
        q("assetsNotAlreadyListed", "Assets not already listed in your Quotex profile", "textarea"),
        q("entityTrustOwnership", "Trust, LLC, or entity ownership details", "textarea"),
        q("coveragePriorities", "Coverage priorities", "textarea"),
      ];
    case "other":
    default:
      return [
        q("riskDescription", "Risk or asset description", "textarea", { required: true }),
        q("requestedAmount", "Requested amount or limit", "currency"),
      ];
  }
}

function personalRefinements(label: string): CategoryQuestion[] {
  const t = norm(label);
  const out: CategoryQuestion[] = [];

  if (hasAny(t, ["condo", "co-op", "hoa"])) {
    out.push(
      q("hoaMasterPolicyType", "HOA master policy type", "select", {
        options: ["Bare walls", "Single entity", "All-in", "Unknown"],
      }),
      q("lossAssessmentLimit", "Loss assessment limit", "currency")
    );
  }
  if (hasAny(t, ["rental", "investment", "home sharing", "vacation rental", "short-term"])) {
    out.push(
      q("rentalType", "Rental type", "select", {
        options: ["Annual lease", "Seasonal", "Short-term", "Mixed", "Vacant between rentals"],
      }),
      q("annualRentalIncome", "Annual rental income", "currency"),
      q("rentalPlatformOrManager", "Rental platform or manager", "text")
    );
  }
  if (hasAny(t, ["coastal", "beach", "flood", "wind", "hail"])) {
    out.push(
      q("elevationCertificate", "Elevation certificate on file?", "boolean"),
      q("windMitigation", "Wind mitigation report on file?", "boolean")
    );
  }
  if (hasAny(t, ["vacant", "dwelling fire", "mobile", "manufactured", "tiny"])) {
    out.push(
      q("vacancyStatus", "Vacancy or occupancy status", "text"),
      q("renovationPlans", "Renovation, inspection, or anchoring notes", "textarea")
    );
  }
  if (hasAny(t, ["solar", "service line", "water backup", "equipment breakdown"])) {
    out.push(q("systemDetails", "System details", "textarea"), q("installationDate", "Installation date", "date"));
  }
  if (hasAny(t, ["classic", "collector"])) {
    out.push(q("agreedValue", "Agreed value requested", "currency"), q("showOrClubUse", "Shows, clubs, or track use", "textarea"));
  }
  if (hasAny(t, ["motorcycle", "rv", "motorhome", "trailer", "camper", "atv", "utv", "golf cart", "snowmobile", "e-bike", "scooter"])) {
    out.push(
      q("storageLocationIfDifferent", "Storage location if different from garaging address", "address"),
      q("accessoriesValue", "Accessories or custom equipment value", "currency")
    );
  }
  if (hasAny(t, ["non-owned", "mexico"])) {
    out.push(q("tripOrDriverDetails", "Trip or driver details", "textarea"), q("requestedCoverageDates", "Requested coverage dates", "text"));
  }
  if (hasAny(t, ["boat", "pwc", "dock", "marine", "yacht"])) {
    out.push(q("hurricanePlan", "Hurricane or storage plan", "textarea"), q("trailerIncluded", "Trailer or tender included?", "boolean"));
  }
  if (hasAny(t, ["watch", "art", "collectible", "antiques", "wine", "furs", "musical", "firearms", "cameras", "articles"])) {
    out.push(
      q("appraisalFormat", "Appraisal or inventory format", "select", {
        options: ["Single appraisal", "Itemized schedule", "Spreadsheet", "Photos only", "Not available"],
      }),
      q("transitOrExhibition", "Transit, exhibition, lending, or travel exposure", "textarea")
    );
  }
  if (hasAny(t, ["cyber", "identity", "fraud"])) {
    out.push(q("onlineRiskProfile", "Online risk profile", "textarea"), q("financialAccountExposure", "Financial account exposure", "textarea"));
  }
  if (hasAny(t, ["life", "disability", "long-term", "medicare", "dental", "vision", "health"])) {
    out.push(q("dateOfBirth", "Date of birth", "date"), q("householdMembers", "Household members to quote", "textarea"), q("healthNotes", "Health or benefit notes", "textarea"));
  }
  if (hasAny(t, ["pet", "equine", "horse", "livestock"])) {
    out.push(q("animalSchedule", "Animal schedule", "textarea"), q("vetOrRegistration", "Vet, registration, or microchip details", "text"));
  }
  if (hasAny(t, ["farm", "ranch"])) {
    out.push(q("farmSchedule", "Acreage, barns, equipment, or animal schedule", "textarea"));
  }
  if (hasAny(t, ["wedding", "event", "travel", "tuition", "moving", "storage"])) {
    out.push(q("eventOrTripDates", "Event, trip, or move dates", "text"), q("contractedCosts", "Contracted costs", "currency"));
  }
  return out;
}

function commercialBaseQuestions(): CategoryQuestion[] {
  return [
    q("legalBusinessName", "Legal business name", "text", { required: true }),
    q("publicSearchKey", "Website, Google listing, or state registration link", "text"),
  ];
}

function sharedClosingQuestions(): CategoryQuestion[] {
  return [
    q("targetEffectiveDate", "Target effective date", "date"),
    q("currentCoverage", "Current carrier and policy number, if any", "text"),
  ];
}

function commercialRefinements(label: string, assetType: AssetType): CategoryQuestion[] {
  const t = norm(label);
  const out: CategoryQuestion[] = [];

  if (hasAny(t, ["property", "bop", "package", "hotel", "motel", "habitational", "hoa", "real estate", "lessor", "builders risk"]) || assetType === "coastal_home") {
    out.push(
      q("propertyLimits", "Requested building, contents, and business income limits", "textarea")
    );
  }
  if (hasAny(t, ["liability", "umbrella", "excess", "products", "liquor", "pollution", "sports", "fitness", "event"])) {
    out.push(
      q("grossSales", "Gross sales", "currency"),
      q("payroll", "Payroll", "currency"),
      q("subcontractorCost", "Subcontractor cost", "currency")
    );
  }
  if (hasAny(t, ["auto", "fleet", "trucking", "cargo", "garage", "hired", "transportation"])) {
    out.push(
      q("vehicleSchedule", "Vehicle schedule", "textarea", { required: true }),
      q("driverExceptions", "Drivers not already on file", "textarea"),
      q("radiusOfOperations", "Radius of operations", "text"),
      q("commoditiesHauled", "Commodities hauled or vehicle use", "textarea")
    );
  }
  if (hasAny(t, ["workers", "employee", "benefits"])) {
    out.push(
      q("payrollByClass", "Payroll by class code", "textarea", { required: true }),
      q("statesOfOperation", "States of operation", "text"),
      q("ownerOfficerInclusion", "Owner/officer inclusion or exclusion", "textarea")
    );
  }
  if (hasAny(t, ["professional", "e&o", "malpractice", "architect", "engineer", "technology", "accountants", "legal", "medical", "media"])) {
    out.push(
      q("annualProfessionalRevenue", "Professional services revenue", "currency"),
      q("retroactiveDate", "Current retroactive date", "date"),
      q("contractsRequireLimits", "Contract-required limits", "textarea")
    );
  }
  if (hasAny(t, ["cyber", "crime", "fidelity", "social engineering"])) {
    out.push(
      q("recordCount", "Records or identities handled", "number"),
      q("mfaBackupsSecurity", "MFA, backups, EDR, and security controls", "textarea")
    );
  }
  if (hasAny(t, ["d&o", "directors", "epli", "fiduciary", "nonprofit"])) {
    out.push(
      q("employeePractices", "HR policies, handbook, and employee practices", "textarea"),
      q("financialsAvailable", "Financial statements available?", "boolean")
    );
  }
  if (hasAny(t, ["inland", "equipment", "installation", "bailee", "warehouse", "jewelers", "fine art", "museum", "cargo", "stock"])) {
    out.push(
      q("maxValueAnyOneLocation", "Max value at any one location", "currency"),
      q("securityAndInventoryControls", "Security and inventory controls", "textarea")
    );
  }
  if (hasAny(t, ["restaurant", "bar", "food", "liquor"])) {
    out.push(q("alcoholSalesPercent", "Alcohol sales percentage", "number"), q("cookingProtection", "Cooking protection and hood suppression", "textarea"));
  }
  if (hasAny(t, ["contractor", "hvac", "plumbing", "electrical", "landscaping", "wrap-up"])) {
    out.push(q("tradeWorkPerformed", "Trade work performed", "textarea"), q("largestProjectValue", "Largest project value", "currency"), q("licenseNumbers", "License numbers", "text"));
  }
  if (hasAny(t, ["healthcare", "clinic", "home health", "senior", "school", "daycare", "religious"])) {
    out.push(q("clientPatientStudentCount", "Client/patient/student count", "number"), q("abusePreventionControls", "Screening and abuse-prevention controls", "textarea"));
  }
  if (hasAny(t, ["farm", "agri", "crop", "livestock", "equine", "cannabis"])) {
    out.push(q("acreageOrProduction", "Acreage, production, or animal schedule", "textarea"), q("regulatedLicenses", "Licenses, permits, or registrations", "textarea"));
  }
  if (hasAny(t, ["marine", "marina", "ship", "charter", "ocean"]) || assetType === "yacht") {
    out.push(q("marineOperations", "Marine operations", "textarea"), q("vesselOrDockSchedule", "Vessel, dock, or slip schedule", "textarea"), q("crewPassengerExposure", "Crew/passenger exposure", "textarea"));
  }
  if (hasAny(t, ["aviation", "drone"])) {
    out.push(q("aircraftOrDroneSchedule", "Aircraft/drone schedule", "textarea"), q("pilotOperatorDetails", "Pilot/operator details", "textarea"), q("faaOrPart107", "FAA or Part 107 details", "text"));
  }
  if (hasAny(t, ["surety", "bond", "trade credit", "representations", "parametric", "key person"])) {
    out.push(q("bondOrTransactionDetails", "Bond, transaction, or trigger details", "textarea"), q("financialsAndContracts", "Financials, contracts, or obligations", "textarea"));
  }
  return out;
}

export function categoryQuestionnaire(
  category: Pick<InsuranceCategory, "assetType" | "label" | "lineOfBusiness">
): CategoryQuestion[] {
  const categorySpecific = category.lineOfBusiness === "commercial"
    ? [...commercialBaseQuestions(), ...commercialRefinements(category.label, category.assetType)]
    : [...baseAssetQuestions(category.assetType), ...personalRefinements(category.label)];
  const maxQuestions = category.lineOfBusiness === "commercial" ? 9 : 8;

  return dedupe([
    ...categorySpecific,
    ...sharedClosingQuestions(),
  ]).slice(0, maxQuestions);
}

function questionKind(inputType: CategoryQuestion["inputType"]): QuotingQuestion["kind"] {
  if (inputType === "textarea" || inputType === "address") return "textarea";
  if (inputType === "number" || inputType === "currency") return "number";
  if (inputType === "select" || inputType === "boolean") return "select";
  return "text";
}

export function categoryQuotingQuestions(category: InsuranceCategory): QuotingQuestion[] {
  return categoryQuestionnaire(category).map((question) => ({
    id: `category-${category.id}-${question.key}`,
    section: `${category.label} intake`,
    label: question.label,
    kind: questionKind(question.inputType),
    options:
      question.inputType === "boolean"
        ? ["Yes", "No", "Unsure"]
        : question.inputType === "select"
        ? question.options
        : undefined,
    required: !!question.required,
    round: "initial",
    acordFieldKey: question.key,
    acordFieldLabels: [question.label],
  }));
}

export function categoryQuestionPublicDataScore(category: InsuranceCategory): number {
  const questions = categoryQuestionnaire(category);
  const searchKeys = questions.filter((question) =>
    /(address|vin|hin|website|fein|license|registration|policy|schedule|name|year|make|model|location|parcel|entity|driver|vessel|appraisal)/i.test(
      `${question.key} ${question.label}`
    )
  ).length;
  return Math.min(95, Math.max(70, Math.round((searchKeys / Math.max(1, questions.length)) * 100)));
}
