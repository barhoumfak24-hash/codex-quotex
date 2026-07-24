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

function sectionQuestion(
  section: string,
  key: string,
  label: string,
  inputType: CategoryQuestion["inputType"] = "text",
  patch: QuestionPatch = {}
): CategoryQuestion {
  return q(key, label, inputType, { required: false, ...patch, section });
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

function homeQuoteSheetQuestions(): CategoryQuestion[] {
  const questions = [
    q("propertyAddress", "Property address", "address", {
      required: true,
      placeholder: "Street, city, state, ZIP",
    }),
    q("occupancy", "Occupancy", "select", {
      options: ["Primary", "Secondary / seasonal", "Tenant occupied", "Vacant", "Condo", "Dwelling fire"],
      required: true,
    }),
    q("ownershipAndLien", "Ownership and lien details", "textarea", {
      placeholder: "Owner, trust/LLC, mortgagee, escrow, loan number, ISAOA/ATIMA if applicable",
    }),
    q("countyTownship", "County and township / municipality", "text"),
    q("priorOrMailingAddress", "Prior or mailing address in the last 3 years", "address"),
    q("yearBuilt", "Year built", "number"),
    q("squareFootageAndUnits", "Square footage, number of units, and wall height", "textarea"),
    q("homeStyle", "Home style", "select", {
      options: [
        "1 story",
        "1.5 story",
        "1.75 story",
        "2 story",
        "Split-level",
        "Condo",
        "Apartment",
        "Manufactured home",
        "Other",
      ],
    }),
    q("foundationDetails", "Foundation details", "textarea", {
      placeholder: "Basement, slab, crawl space, block, concrete, brick, fieldstone, piers, walkout/daylight, percent finished",
    }),
    q("frameAndExterior", "Frame and exterior materials", "textarea", {
      placeholder: "2x4/2x6/log/steel/insulated panels plus siding, brick, stone, stucco, hardiboard, percentages if known",
    }),
    q("roofShapePitchMaterial", "Roof shape, pitch, material, and skylights", "textarea", {
      placeholder: "Gable/hip/flat, simple/elaborate, slight/moderate/steep, asphalt/architectural/metal/wood, skylights",
    }),
    q("attachedStructures", "Attached structures", "textarea", {
      placeholder: "Porches, decks, breezeway, balcony, columns, attached garage, built-in garage, carport",
    }),
    q("detachedStructuresAndRecreation", "Detached structures and recreational features", "textarea", {
      placeholder: "Detached garage, shed, gazebo, pool, hot tub, trampoline, fencing, diving board, slide",
    }),
    q("interiorFinishes", "Interior walls, ceilings, and floors", "textarea"),
    q("kitchenBathQuality", "Kitchen and bathroom quality", "textarea", {
      placeholder: "Kitchen grade, number of full/half/three-quarter baths, custom vanity, jacuzzi",
    }),
    q("interiorFeatures", "Interior features", "textarea", {
      placeholder: "Wet bar, fireplaces, wood stove, spiral staircase, attic access, central vacuum/stereo",
    }),
    q("heatingCoolingSystems", "Heating and cooling systems", "textarea", {
      placeholder: "Fuel, system type, location, central AC, ductwork, high-efficiency units",
    }),
    q("electricalAndSafetySystems", "Electrical and safety systems", "textarea", {
      placeholder: "Amps, fuses, fire/burglar/temp/water leak alarms, sprinklers, surveillance, motion lights",
    }),
    q("homeUpdates", "Updates and remodels", "textarea", {
      placeholder: "Roof receipt, heating, plumbing, electrical, additions, remodels, dates and materials",
    }),
    q("animalsAndLiabilityExposures", "Animals, business, rental, and liability exposures", "textarea", {
      placeholder: "Dogs/bite history/breeds, daycare, business or hobbies, structures rented, vacant land, ponds, rec vehicles",
    }),
    q("scheduledProperty", "Jewelry, watches, guns, furs, art, collections, medical equipment, vault or safe", "textarea"),
    q("priorCarrierAndLosses", "Prior carrier, coverage, policy number, expiration date, deductible, and losses", "textarea"),
    q("requestedHomeEndorsements", "Requested endorsements and special coverages", "textarea", {
      placeholder: "Guaranteed replacement, water backup, personal injury, med pay, ordinance/law, loss assessment, quake/sinkhole, service line, equipment breakdown, ID theft",
    }),
    q("homeDiscountsAndProtection", "Discounts and protection details", "textarea", {
      placeholder: "Full pay, escrow, non-smoker, group, generator, protective devices, hydrant/fire-station distance, mortgage free, multi-policy",
    }),
  ];

  const requiredKeys = new Set([
    "propertyAddress",
    "occupancy",
    "ownershipAndLien",
    "countyTownship",
    "yearBuilt",
    "squareFootageAndUnits",
    "homeStyle",
    "foundationDetails",
    "frameAndExterior",
    "roofShapePitchMaterial",
    "heatingCoolingSystems",
    "electricalAndSafetySystems",
    "priorCarrierAndLosses",
  ]);

  return questions.map((question) => ({
    ...question,
    required: requiredKeys.has(question.key),
  }));
}

function autoQuoteSheetQuestions(): CategoryQuestion[] {
  const applicant = "1. Applicant Information";
  const contact = "2. Contact Information";
  const reports = "3. Third Party Reports";
  const address = "4. Address Information";
  const policy = "5. Policy Information";
  const currentInsurance = "6. Current Insurance";
  const discounts = "7. Discounts";
  const carrier = "8. Carrier Questions";
  const driver = "9. Driver Information (repeat for every licensed driver)";
  const vehicle = "10. Vehicle Information (repeat for every vehicle)";
  const coverage = "11. Coverage Selection";
  const vehicleCoverage = "12. Vehicle Specific Coverages (per vehicle)";
  const incidents = "13. Accident / Incident History (repeat for every incident)";
  const review = "14. Final Review";

  const questions = [
    sectionQuestion(applicant, "primaryFirstName", "Primary applicant first name"),
    sectionQuestion(applicant, "primaryMiddleInitial", "Primary applicant middle initial"),
    sectionQuestion(applicant, "primaryLastName", "Primary applicant last name"),
    sectionQuestion(applicant, "primarySuffix", "Primary applicant suffix"),
    sectionQuestion(applicant, "primaryDateOfBirth", "Primary applicant date of birth", "date"),
    sectionQuestion(applicant, "primarySsnLastFour", "Primary applicant Social Security number (optional / last four)", "text", {
      required: false,
      placeholder: "Last four digits",
    }),
    sectionQuestion(applicant, "primaryGender", "Primary applicant gender", "select", {
      options: ["Female", "Male", "Nonbinary", "Prefer not to answer"],
    }),
    sectionQuestion(applicant, "primaryMaritalStatus", "Primary applicant marital status", "select", {
      options: ["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic partner"],
    }),
    sectionQuestion(applicant, "primaryOccupation", "Primary applicant occupation"),
    sectionQuestion(applicant, "coApplicantFirstName", "Co-applicant first name (if applicable)", "text", { required: false }),
    sectionQuestion(applicant, "coApplicantMiddleInitial", "Co-applicant middle initial (if applicable)", "text", { required: false }),
    sectionQuestion(applicant, "coApplicantLastName", "Co-applicant last name (if applicable)", "text", { required: false }),
    sectionQuestion(applicant, "coApplicantSuffix", "Co-applicant suffix (if applicable)", "text", { required: false }),
    sectionQuestion(applicant, "coApplicantDateOfBirth", "Co-applicant date of birth (if applicable)", "date", { required: false }),
    sectionQuestion(applicant, "coApplicantSsn", "Co-applicant Social Security number (if applicable)", "text", { required: false }),
    sectionQuestion(applicant, "coApplicantGender", "Co-applicant gender (if applicable)", "select", {
      required: false,
      options: ["Female", "Male", "Nonbinary", "Prefer not to answer"],
    }),
    sectionQuestion(applicant, "coApplicantMaritalStatus", "Co-applicant marital status (if applicable)", "select", {
      required: false,
      options: ["Single", "Married", "Divorced", "Separated", "Widowed", "Domestic partner"],
    }),
    sectionQuestion(applicant, "coApplicantOccupation", "Co-applicant occupation (if applicable)", "text", { required: false }),

    sectionQuestion(contact, "cellPhone", "Cell phone"),
    sectionQuestion(contact, "homePhone", "Home phone", "text", { required: false }),
    sectionQuestion(contact, "workPhone", "Work phone", "text", { required: false }),
    sectionQuestion(contact, "emailAddress", "Email address"),
    sectionQuestion(contact, "preferredContactMethod", "Preferred contact method", "select", {
      options: ["Cell", "Home", "Work", "Email"],
    }),

    sectionQuestion(reports, "authorizeMvr", "Authorize Motor Vehicle Reports (MVR)?", "boolean"),
    sectionQuestion(reports, "authorizeClue", "Authorize CLUE claims reports?", "boolean"),
    sectionQuestion(reports, "authorizeCredit", "Authorize credit reports where permitted?", "boolean"),
    sectionQuestion(reports, "thirdPartyReportAuthorization", "Third-party report authorization", "select", {
      options: ["Yes", "No"],
    }),

    sectionQuestion(address, "currentStreetAddress", "Current residence street address", "address"),
    sectionQuestion(address, "currentCity", "Current residence city"),
    sectionQuestion(address, "currentState", "Current residence state"),
    sectionQuestion(address, "currentZipCode", "Current residence ZIP code"),
    sectionQuestion(address, "uspsValidated", "USPS validated?", "boolean"),
    sectionQuestion(address, "yearsAtAddress", "Years at current address", "number"),
    sectionQuestion(address, "monthsAtAddress", "Months at current address", "number"),
    sectionQuestion(address, "residenceType", "Residence type", "select", {
      options: ["Own Home", "Rent", "Condo", "Apartment", "Other"],
    }),
    sectionQuestion(address, "mailingSameAsCurrent", "Mailing address same as current address?", "boolean"),
    sectionQuestion(address, "mailingAddress", "Mailing address (if different)", "address", { required: false }),
    sectionQuestion(address, "previousAddress", "Previous address if at current residence less than 3 years", "address", { required: false }),
    sectionQuestion(address, "previousCity", "Previous city", "text", { required: false }),
    sectionQuestion(address, "previousState", "Previous state", "text", { required: false }),
    sectionQuestion(address, "previousZipCode", "Previous ZIP code", "text", { required: false }),
    sectionQuestion(address, "alternateGarageStreet", "Alternate garage street address (if vehicle kept elsewhere)", "address", { required: false }),
    sectionQuestion(address, "alternateGarageCity", "Alternate garage city", "text", { required: false }),
    sectionQuestion(address, "alternateGarageState", "Alternate garage state", "text", { required: false }),
    sectionQuestion(address, "alternateGarageZip", "Alternate garage ZIP code", "text", { required: false }),

    sectionQuestion(policy, "ratingState", "Rating state"),
    sectionQuestion(policy, "ratingCounty", "County"),
    sectionQuestion(policy, "targetEffectiveDate", "Effective date", "date"),
    sectionQuestion(policy, "policyTerm", "Policy term", "select", {
      options: ["6 Months", "12 Months"],
    }),

    sectionQuestion(currentInsurance, "currentlyInsured", "Are you currently insured?", "boolean"),
    sectionQuestion(currentInsurance, "continuousCoverageYears", "Continuous coverage years", "number", { required: false }),
    sectionQuestion(currentInsurance, "continuousCoverageMonths", "Continuous coverage months", "number", { required: false }),
    sectionQuestion(currentInsurance, "currentPremium", "Current premium", "currency", { required: false }),
    sectionQuestion(currentInsurance, "currentCarrier", "Current carrier", "text", { required: false }),
    sectionQuestion(currentInsurance, "timeWithCurrentCarrier", "Time with current carrier", "text", { required: false }),
    sectionQuestion(currentInsurance, "currentPolicyExpirationDate", "Policy expiration date", "date", { required: false }),
    sectionQuestion(currentInsurance, "currentPolicyNumber", "Current policy number", "text", { required: false }),
    sectionQuestion(currentInsurance, "currentLiabilityLimits", "Current liability limits", "textarea", { required: false }),

    sectionQuestion(discounts, "multiPolicyDiscount", "Do you currently have a multi-policy discount?", "boolean"),
    sectionQuestion(discounts, "homeownersPolicy", "Do you currently have a homeowners policy?", "boolean"),
    sectionQuestion(discounts, "homeownersPolicyType", "Type of homeowners policy", "text", { required: false }),

    sectionQuestion(carrier, "recommendedRepairShops", "Will you use recommended repair shops?", "boolean"),
    sectionQuestion(carrier, "householdResidentCount", "Number of residents in household", "number"),
    sectionQuestion(carrier, "autoOwnersCompanySelection", "Auto-Owners company selection"),
    sectionQuestion(carrier, "autoOwnersGroupProgram", "Auto-Owners group program"),
    sectionQuestion(carrier, "progressiveSpinOffReason", "Progressive spin-off reason", "textarea"),
    sectionQuestion(carrier, "progressivePolicyInForce", "Is another Progressive policy already in force?", "boolean"),
    sectionQuestion(carrier, "paperlessBilling", "Paperless billing?", "boolean"),
    sectionQuestion(carrier, "twoOrMorePipClaims59Months", "Have you had 2 or more PIP claims within the last 59 months?", "boolean"),
    sectionQuestion(carrier, "pipClaimsLastThreeYears", "Number of PIP claims in the last 3 years", "number"),
    sectionQuestion(carrier, "floridaLessThanTenMonths", "Do you reside in Florida less than 10 months per year?", "boolean"),

    sectionQuestion(driver, "driverFirstName", "Driver first name"),
    sectionQuestion(driver, "driverLastName", "Driver last name"),
    sectionQuestion(driver, "driverDateOfBirth", "Driver date of birth", "date"),
    sectionQuestion(driver, "driverSsn", "Driver Social Security number", "text", { required: false }),
    sectionQuestion(driver, "driverGender", "Driver gender", "select", {
      options: ["Female", "Male", "Nonbinary", "Prefer not to answer"],
    }),
    sectionQuestion(driver, "driverRelationshipToApplicant", "Driver relationship to applicant"),
    sectionQuestion(driver, "driverIsCoApplicant", "Is this driver the co-applicant?", "boolean"),
    sectionQuestion(driver, "driverOccupation", "Driver occupation"),
    sectionQuestion(driver, "driverEducationLevel", "Driver education level", "select", {
      options: ["High school", "Some college", "Associate degree", "Bachelor degree", "Graduate degree", "Other"],
    }),
    sectionQuestion(driver, "driverStatus", "Driver status", "select", {
      options: ["Rated", "Excluded", "Permit", "Non-driver", "Other"],
    }),
    sectionQuestion(driver, "driverLicenseState", "Driver license state issued"),
    sectionQuestion(driver, "driverLicenseNumber", "Driver license number"),
    sectionQuestion(driver, "driverLicenseStatus", "Driver license status", "select", {
      options: ["Valid", "Suspended", "Revoked", "Expired", "Permit", "Other"],
    }),
    sectionQuestion(driver, "driverAgeFirstLicensed", "Driver age first licensed", "number"),
    sectionQuestion(driver, "driverGoodStudent", "Good student discount?", "boolean"),
    sectionQuestion(driver, "driverAwayAtSchool", "Away at school?", "boolean"),
    sectionQuestion(driver, "driverTrainingCompleted", "Driver training completed?", "boolean"),
    sectionQuestion(driver, "driverDefensiveDriving", "Defensive driving course completed?", "boolean"),
    sectionQuestion(driver, "driverGoodDriverDiscount", "Good driver discount?", "boolean"),
    sectionQuestion(driver, "driverSr22Required", "SR-22 filing required?", "boolean"),
    sectionQuestion(driver, "driverFr44Required", "FR-44 filing required?", "boolean"),

    sectionQuestion(vehicle, "vin", "VIN", "text", { placeholder: "17-character VIN" }),
    sectionQuestion(vehicle, "vehicleYear", "Vehicle year", "number"),
    sectionQuestion(vehicle, "vehicleMake", "Vehicle make"),
    sectionQuestion(vehicle, "vehicleModel", "Vehicle model"),
    sectionQuestion(vehicle, "vehicleTrim", "Vehicle trim"),
    sectionQuestion(vehicle, "vehicleBodyStyle", "Vehicle body style"),
    sectionQuestion(vehicle, "vehiclePurchaseDate", "Vehicle purchase date", "date"),
    sectionQuestion(vehicle, "vehicleOwnershipStatus", "Vehicle ownership status", "select", {
      options: ["Owned", "Financed", "Leased"],
    }),
    sectionQuestion(vehicle, "vehicleRegisteredState", "Vehicle registered state"),
    sectionQuestion(vehicle, "vehicleOriginalMsrp", "Original MSRP", "currency"),
    sectionQuestion(vehicle, "vehicleEngine", "Engine"),
    sectionQuestion(vehicle, "vehicleCylinders", "Cylinders", "number"),
    sectionQuestion(vehicle, "vehicleDisplacement", "Displacement"),
    sectionQuestion(vehicle, "vehicleFuelType", "Fuel type"),
    sectionQuestion(vehicle, "vehicleDriveType", "Drive type"),
    sectionQuestion(vehicle, "vehicleDoorCount", "Number of doors", "number"),
    sectionQuestion(vehicle, "principalOperator", "Principal operator"),
    sectionQuestion(vehicle, "occasionalOperator", "Occasional operator", "text", { required: false }),
    sectionQuestion(vehicle, "vehicleUsage", "Vehicle usage", "select", {
      options: ["Pleasure", "Commute", "Business", "Farm"],
    }),
    sectionQuestion(vehicle, "oneWayCommuteMiles", "One-way commute miles", "number"),
    sectionQuestion(vehicle, "daysDrivenPerWeek", "Days driven per week", "number"),
    sectionQuestion(vehicle, "annualMileage", "Annual mileage", "number"),
    sectionQuestion(vehicle, "vehicleGaraged", "Vehicle garaged?", "boolean"),
    sectionQuestion(vehicle, "garageLocation", "Garage location", "select", {
      options: ["Residence", "Other"],
    }),
    sectionQuestion(vehicle, "antiLockBrakes", "Anti-lock brakes?", "boolean"),
    sectionQuestion(vehicle, "antiTheftDevice", "Anti-theft device?", "boolean"),
    sectionQuestion(vehicle, "airbags", "Airbags?", "boolean"),

    sectionQuestion(coverage, "bodilyInjuryLimits", "Bodily injury limits"),
    sectionQuestion(coverage, "propertyDamageLimits", "Property damage limits"),
    sectionQuestion(coverage, "pipDeductible", "Personal Injury Protection (PIP) deductible", "currency"),
    sectionQuestion(coverage, "pipAppliesTo", "PIP applies to"),
    sectionQuestion(coverage, "pipWageLoss", "PIP wage loss"),
    sectionQuestion(coverage, "pipType", "PIP type"),
    sectionQuestion(coverage, "umLimits", "Uninsured / underinsured motorist limits"),
    sectionQuestion(coverage, "umStacked", "Uninsured / underinsured motorist stacked?", "boolean"),
    sectionQuestion(coverage, "medicalPayments", "Medical payments", "currency"),
    sectionQuestion(coverage, "accidentalDeathCoverage", "Accidental death coverage", "currency"),
    sectionQuestion(coverage, "usageBasedInsurance", "Enroll in usage-based insurance?", "boolean"),
    sectionQuestion(coverage, "telematicsEnrollmentSettings", "Telematics enrollment settings", "textarea", { required: false }),

    sectionQuestion(vehicleCoverage, "comprehensiveDeductible", "Comprehensive deductible", "currency"),
    sectionQuestion(vehicleCoverage, "collisionDeductible", "Collision deductible", "currency"),
    sectionQuestion(vehicleCoverage, "rentalReimbursement", "Rental reimbursement", "currency"),
    sectionQuestion(vehicleCoverage, "towingCoverage", "Towing coverage", "currency"),
    sectionQuestion(vehicleCoverage, "customEquipmentCoverage", "Custom equipment coverage", "currency"),
    sectionQuestion(vehicleCoverage, "fullGlassCoverage", "Full glass coverage?", "boolean"),
    sectionQuestion(vehicleCoverage, "leaseCoverage", "Lease coverage?", "boolean"),
    sectionQuestion(vehicleCoverage, "excludeLiability", "Exclude liability?", "boolean"),

    sectionQuestion(incidents, "incidentType", "Incident type", "select", {
      required: false,
      options: ["Accident", "Comprehensive", "Theft", "Other"],
    }),
    sectionQuestion(incidents, "incidentDate", "Incident date", "date", { required: false }),
    sectionQuestion(incidents, "incidentDriver", "Driver involved", "text", { required: false }),
    sectionQuestion(incidents, "incidentVehicle", "Vehicle involved", "text", { required: false }),
    sectionQuestion(incidents, "incidentDescription", "Incident description", "textarea", { required: false }),
    sectionQuestion(incidents, "incidentFault", "Incident fault", "select", {
      required: false,
      options: ["At Fault", "Not At Fault"],
    }),
    sectionQuestion(incidents, "incidentPropertyDamageAmount", "Property damage amount", "currency", { required: false }),
    sectionQuestion(incidents, "incidentBodilyInjuryAmount", "Bodily injury amount", "currency", { required: false }),

    sectionQuestion(review, "applicantInformationVerified", "Applicant information verified?", "boolean"),
    sectionQuestion(review, "addressVerified", "Address verified?", "boolean"),
    sectionQuestion(review, "driversVerified", "Drivers verified?", "boolean"),
    sectionQuestion(review, "vehiclesVerified", "Vehicles verified?", "boolean"),
    sectionQuestion(review, "coveragesVerified", "Coverages verified?", "boolean"),
    sectionQuestion(review, "incidentsVerified", "Incidents verified?", "boolean"),
  ];

  const requiredKeys = new Set([
    "primaryFirstName",
    "primaryLastName",
    "primaryDateOfBirth",
    "primaryGender",
    "primaryMaritalStatus",
    "emailAddress",
    "authorizeMvr",
    "authorizeClue",
    "authorizeCredit",
    "currentStreetAddress",
    "currentCity",
    "currentState",
    "currentZipCode",
    "yearsAtAddress",
    "monthsAtAddress",
    "residenceType",
    "mailingSameAsCurrent",
    "ratingState",
    "ratingCounty",
    "targetEffectiveDate",
    "policyTerm",
    "currentlyInsured",
    "driverFirstName",
    "driverLastName",
    "driverDateOfBirth",
    "driverGender",
    "driverRelationshipToApplicant",
    "driverStatus",
    "driverLicenseState",
    "driverLicenseNumber",
    "driverLicenseStatus",
    "driverAgeFirstLicensed",
    "vin",
    "vehicleYear",
    "vehicleMake",
    "vehicleModel",
    "vehicleOwnershipStatus",
    "vehicleRegisteredState",
    "principalOperator",
    "vehicleUsage",
    "oneWayCommuteMiles",
    "daysDrivenPerWeek",
    "annualMileage",
    "vehicleGaraged",
    "garageLocation",
    "bodilyInjuryLimits",
    "propertyDamageLimits",
  ]);

  return questions.map((question) => ({
    ...question,
    required: requiredKeys.has(question.key),
  }));
}

function baseAssetQuestions(assetType: AssetType): CategoryQuestion[] {
  switch (assetType) {
    case "coastal_home":
      return homeQuoteSheetQuestions();
    case "luxury_vehicle":
      return autoQuoteSheetQuestions();
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
  const maxQuestions = category.lineOfBusiness === "commercial"
    ? 9
    : category.assetType === "coastal_home"
    ? 30
    : category.assetType === "luxury_vehicle"
    ? 160
    : 8;
  const closingQuestions =
    category.lineOfBusiness === "personal" && category.assetType === "luxury_vehicle"
      ? []
      : sharedClosingQuestions();

  return dedupe([
    ...categorySpecific,
    ...closingQuestions,
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
    section: question.section ?? `${category.label} intake`,
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
