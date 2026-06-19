import type { TemplateFieldMap } from "@/types";

export type PdfAcroFormField = {
  objectNumber: number;
  generation: number;
  name: string;
  partialName: string;
  fieldType?: string;
  rect?: [number, number, number, number];
  defaultAppearance?: string;
  flags?: number;
  tooltip?: string;
  mappingName?: string;
  onState?: string;
};

export type PdfAcroFormFieldMapping = {
  sourceLabel: string;
  targetField: string;
  value: string;
  source: "questionnaire" | "public_record" | "asset_detail" | "contact" | "system";
  confidence: number;
  reason: string;
};

export type PdfAcroFormFillPlan = {
  values: Record<string, string>;
  mappings: PdfAcroFormFieldMapping[];
  missingFields: string[];
  totalNativeFields: number;
  filledFieldCount: number;
};

type PdfObject = {
  objectNumber: number;
  generation: number;
  body: string;
};

type ParsedPdf = {
  text: string;
  objects: PdfObject[];
  objectMap: Map<number, PdfObject>;
  previousXrefOffset: number;
  rootRef?: string;
  acroFormRef?: { objectNumber: number; generation: number };
  maxObjectNumber: number;
};

type AddressParts = {
  lineOne: string;
  lineTwo: string;
  city: string;
  state: string;
  postalCode: string;
};

type NativeFieldMatch = {
  value: string;
  sourceLabel: string;
  source: PdfAcroFormFieldMapping["source"];
  confidence: number;
  reason: string;
};

const CHECKED_VALUE = "Yes";

export function extractAcroFormFields(pdfBytes: Uint8Array): PdfAcroFormField[] {
  const parsed = parsePdf(pdfBytes);
  const partialNames = new Map<number, string>();
  const parentRefs = new Map<number, number>();
  parsed.objects.forEach((object) => {
    const partial = literalValueForKey(object.body, "T");
    if (partial) partialNames.set(object.objectNumber, partial);
    const parent = refValueForKey(object.body, "Parent");
    if (parent) parentRefs.set(object.objectNumber, parent.objectNumber);
  });

  const fields: PdfAcroFormField[] = [];
  parsed.objects.forEach((object) => {
    const partialName = partialNames.get(object.objectNumber);
    if (!partialName) return;
    const name = fullFieldName(object.objectNumber, partialNames, parentRefs);
    const fieldType = nameValueForKey(object.body, "FT");
    const hasWidget = /\/Subtype\s*\/Widget\b/.test(object.body);
    const hasFieldType = !!fieldType || /\/Kids\s*\[/.test(object.body) || hasWidget;
    if (!name || !hasFieldType) return;
    fields.push({
      objectNumber: object.objectNumber,
      generation: object.generation,
      name,
      partialName,
      fieldType,
      rect: rectValueForKey(object.body, "Rect"),
      defaultAppearance: literalValueForKey(object.body, "DA"),
      flags: numberValueForKey(object.body, "Ff"),
      tooltip: literalValueForKey(object.body, "TU"),
      mappingName: literalValueForKey(object.body, "TM"),
      onState: fieldType === "/Btn" ? checkboxOnStateName(object.body) : undefined,
    });
  });
  return fields;
}

export function buildAcroFormFillPlan(
  fields: TemplateFieldMap,
  acroFields: PdfAcroFormField[]
): PdfAcroFormFillPlan {
  const values: Record<string, string> = {};
  const mappings: PdfAcroFormFieldMapping[] = [];
  const missingFields: string[] = [];
  const splitCache = new Map<string, AddressParts>();
  const set = (field: PdfAcroFormField, match: NativeFieldMatch | undefined) => {
    const clean = String(match?.value ?? "").trim();
    if (!clean) return;
    values[field.name] = fitValueForPdfField(clean, field.name);
    mappings.push({
      sourceLabel: match?.sourceLabel ?? "QuoteX field",
      targetField: field.name,
      value: values[field.name],
      source: match?.source ?? "system",
      confidence: match?.confidence ?? 0.75,
      reason: match?.reason ?? "Matched by ACORD native field name",
    });
  };
  const setCheckbox = (field: PdfAcroFormField, match: NativeFieldMatch | undefined) => {
    if (!match) return;
    values[field.name] = CHECKED_VALUE;
    mappings.push({
      sourceLabel: match.sourceLabel,
      targetField: field.name,
      value: values[field.name],
      source: match.source,
      confidence: match.confidence,
      reason: match.reason,
    });
  };

  acroFields.forEach((field) => {
    const shortName = normalizedAcroName(field.partialName);
    if (field.fieldType === "/Btn" || /indicator\b/.test(shortName)) {
      setCheckbox(field, checkboxMatchForNativeField(field, fields));
      return;
    }

    const match = textMatchForNativeField(field, fields, splitCache);
    if (match) set(field, match);
    else if (isImportantNativeField(field)) missingFields.push(field.name);
  });

  return {
    values,
    mappings,
    missingFields,
    totalNativeFields: acroFields.length,
    filledFieldCount: Object.keys(values).length,
  };
}

export function buildAcroFormValues(
  fields: TemplateFieldMap,
  acroFields: PdfAcroFormField[]
): Record<string, string> {
  return buildAcroFormFillPlan(fields, acroFields).values;
}

function textMatchForNativeField(
  field: PdfAcroFormField,
  fields: TemplateFieldMap,
  splitCache: Map<string, AddressParts>
): NativeFieldMatch | undefined {
  const lookupName = fieldLookupName(field);
  const partialName = normalizedAcroName(field.partialName);
  const addressReason = "Split a QuoteX address into the ACORD native address field";
  const explicit = explicitNativeFieldMatch(field, fields);
  if (explicit) return explicit;

  const sourceSpecific = sourceSpecificNativeFieldMatch(field, fields, splitCache);
  if (sourceSpecific) return sourceSpecific;
  if (isGenericNativeField(field)) return undefined;
  if (isSecondaryRepeatedNativeField(field)) return undefined;

  if (/formcompletiondate|datecompleted|completiondate/.test(lookupName)) {
    return {
      value: new Date().toLocaleDateString("en-US"),
      sourceLabel: "Mapping date",
      source: "system",
      confidence: 0.99,
      reason: "ACORD completion date",
    };
  }

  if (/fax/.test(lookupName)) {
    return pickField(
      fields,
      ["Agency fax", "Producer fax", "Contact fax", "Applicant fax", "Insured fax", "Fax"],
      "Matched explicit fax number",
      0.92,
      "contact"
    );
  }
  if (/(secondary|alternate).*email|email.*(secondary|alternate)/.test(lookupName)) {
    return pickField(fields, ["Secondary email", "Alternate email"], "Matched explicit secondary email", 0.92, "contact");
  }
  if (/(secondary|alternate).*phone|phone.*(secondary|alternate)/.test(lookupName)) {
    return pickField(fields, ["Secondary phone", "Alternate phone"], "Matched explicit secondary phone", 0.92, "contact");
  }

  if (/producermailingaddress|produceraddress/.test(lookupName)) {
    return addressPartMatch(
      fields,
      splitCache,
      "agency",
      field.name,
      ["Agency address", "Producer address"],
      addressReason,
      "Agency address",
      "system"
    );
  }
  if (/producercontactpersonemailaddress|produceremailaddress|producermailaddress/.test(lookupName)) {
    return pickField(fields, ["Agency email", "Producer email"], "Matched producer email", 0.96, "system");
  }
  if (/producercontactpersonphonenumber|producerphonenumber|producerphone/.test(lookupName)) {
    return pickField(fields, ["Agency phone", "Producer phone"], "Matched producer phone", 0.96, "system");
  }
  if (/producercontactpersonfullname|producercontactfullname/.test(lookupName)) {
    return pickField(fields, ["Producer contact", "Producer contact name", "Agency contact"], "Matched producer contact", 0.92, "system");
  }
  if (/producerfullname|producername|produceragency/.test(lookupName)) {
    return pickField(fields, ["Agency", "Producer", "Agency name", "Producer name"], "Matched producer agency", 0.98, "system");
  }
  if (/producercustomeridentifier|customeridentifier|customernumber|accountnumber/.test(lookupName)) {
    return pickField(fields, ["Agency customer ID", "Customer number"], "Matched agency customer identifier", 0.86, "contact");
  }

  if (/insurerfullname|carrierfullname|insurancecompany|companyname|priorcarrier/.test(lookupName)) {
    return pickField(fields, ["Carrier", "Insurance carrier", "Prior carrier", "Company"], "Matched carrier name", 0.82, "system");
  }
  if (/insurernaiccode|naiccode/.test(lookupName)) {
    return pickField(fields, ["NAIC code", "NAIC"], "Matched NAIC code", 0.78, "system");
  }
  if (/policypolicynumberidentifier|policynumber|policyno|policyidentifier/.test(lookupName)) {
    return pickField(fields, ["Policy number", "Policy no", "Policy #", "Current policy number", "Expiring policy number"], "Matched policy number", 0.9, "system");
  }
  if (/policyeffectivedate|policystatuseffectivedate|effectivedate|effdate/.test(lookupName)) {
    return pickField(fields, ["Effective date", "Policy effective date", "Eff date", "Requested effective date"], "Matched policy effective date", 0.86, "system");
  }
  if (/policyexpirationdate|expirationdate|expdate|renewaldate/.test(lookupName)) {
    return pickField(fields, ["Expiration date", "Policy expiration date", "Exp date", "Renewal date"], "Matched policy expiration date", 0.86, "system");
  }

  if (/namedinsuredprimaryphonenumber|insuredphonenumber|applicantphonenumber|contactprimaryphonenumber|primaryphonenumber/.test(lookupName)) {
    return pickField(fields, ["Phone", "Primary phone", "Applicant phone", "Insured phone"], "Matched insured phone", 0.92, "contact");
  }
  if (/namedinsuredcontactprimaryemailaddress|applicantemail|contactemail|insuredemail|emailaddress/.test(lookupName)) {
    return pickField(fields, ["Contact email", "Email", "Applicant email", "Insured email"], "Matched insured email", 0.92, "contact");
  }
  if (/namedinsuredcontactfullname|applicantcontactfullname|contactfullname|primarycontact/.test(lookupName)) {
    return pickField(fields, ["Primary contact", "Applicant name", "Client name", "Named insured"], "Matched insured contact", 0.92, "contact");
  }
  if (/namedinsuredfullname|applicantfullname|insuredfullname|firstnamedinsured|nameinsured|insuredname/.test(lookupName)) {
    return pickField(fields, ["Business legal name", "Legal business name", "Named insured", "Applicant name", "Client name", "Insured"], "Matched named insured", 0.96, "contact");
  }
  if (/namedinsuredmailingaddress|applicantmailingaddress|insuredmailingaddress|mailingaddress/.test(lookupName)) {
    return addressPartMatch(
      fields,
      splitCache,
      "insured",
      field.name,
      ["Mailing address", "Insured mailing address", "Client address", "Named insured and mailing address", "Applicant name and mailing address"],
      addressReason,
      "Mailing address",
      "contact"
    );
  }
  if (/producer.*website|agency.*website/.test(lookupName)) {
    return pickField(fields, ["Agency website", "Producer website"], "Matched agency website", 0.86, "system");
  }
  if (/websiteaddress|website/.test(lookupName)) {
    return pickField(fields, ["Website", "Business website", "Applicant website", "Insured website"], "Matched website", 0.82, "contact");
  }
  if (/siccode/.test(lookupName)) return pickField(fields, ["SIC code", "SIC"], "Matched SIC code", 0.8, "public_record");
  if (/naicscode/.test(lookupName)) return pickField(fields, ["NAICS code", "NAICS"], "Matched NAICS code", 0.8, "public_record");
  if (/taxidentifier|federalemployer|fein|ein/.test(lookupName)) {
    return pickField(fields, ["FEIN", "Federal EIN", "Tax identifier", "Federal employer ID"], "Matched tax identifier", 0.88, "contact");
  }

  if (/commercialstructurephysicaladdress|physicaladdress|risklocation|propertyaddress|locationaddress|premisesaddress|garagingaddress/.test(lookupName)) {
    return addressPartMatch(
      fields,
      splitCache,
      "property",
      field.name,
      ["Property address", "Risk / property address", "Location", "Premises address", "Risk address", "Garaging address"],
      addressReason,
      "Property address",
      "asset_detail"
    );
  }
  if (/builtyear|yearbuilt|constructionyear/.test(lookupName)) {
    return pickField(fields, ["Year built", "Built year", "Construction year"], "Matched property year built", 0.82, "asset_detail");
  }
  if (/buildingarea|squarefootage|squarefeet|area/.test(lookupName)) {
    return pickField(fields, ["Square footage", "Building area", "Area"], "Matched property square footage", 0.8, "asset_detail");
  }
  if (/constructioncode|constructiontype|construction/.test(lookupName)) {
    return pickField(fields, ["Construction type", "Construction", "Building construction"], "Matched construction type", 0.78, "asset_detail");
  }
  if (/roofmaterial|rooftype|roof/.test(lookupName)) {
    return pickField(fields, ["Roof type", "Roof material", "Roof"], "Matched roof detail", 0.78, "asset_detail");
  }
  if (/storeycount|storycount|stories|numberofstories/.test(lookupName)) {
    return pickField(fields, ["Stories", "Number of stories", "Storey count"], "Matched story count", 0.76, "asset_detail");
  }
  if (/protectionclass/.test(lookupName)) {
    return pickField(fields, ["Protection class"], "Matched protection class", 0.76, "public_record");
  }

  if (/annualrevenue|grossreceipts|grosssales|annualgrosssalesamount|salesamount/.test(lookupName)) {
    return pickField(fields, ["Annual revenue", "Revenue", "Gross sales"], "Matched revenue/exposure", 0.84, "questionnaire");
  }
  if (/annualpayroll|payroll|remuneration/.test(lookupName)) {
    return pickField(fields, ["Annual payroll", "Payroll"], "Matched payroll", 0.84, "questionnaire");
  }
  if (/fulltimeemployeecount|fulltimeemployees/.test(lookupName)) {
    return pickField(fields, ["Full-time employee count", "Employee count", "Full-time employees"], "Matched employee count", 0.78, "questionnaire");
  }
  if (/parttimeemployeecount|parttimeemployees/.test(lookupName)) {
    return pickField(fields, ["Part-time employee count", "Part-time employees"], "Matched part-time employee count", 0.76, "questionnaire");
  }
  if (/operationsdescription|operationdescription|productdescription|businessdescription|descriptionofoperations|natureofbusiness/.test(lookupName)) {
    return pickField(fields, ["Description of operations", "Business operations", "Products / services", "Operations"], "Matched operations description", 0.88, "questionnaire");
  }
  if (/remarktext|remarks|remark|explanation/.test(lookupName)) return undefined;

  if (/generalliability.*aggregate.*limitamount|generalaggregatelimit/.test(lookupName)) {
    return pickField(fields, ["General aggregate limit", "General liability limit", "Limits"], "Matched general aggregate limit", 0.82, "questionnaire");
  }
  if (/eachoccurrence.*limitamount|eachoccurrencelimit/.test(lookupName)) {
    return pickField(fields, ["Each occurrence limit", "General liability limit", "Limits"], "Matched each occurrence limit", 0.82, "questionnaire");
  }
  if (/deductibleamount|deductible/.test(lookupName)) {
    return pickField(fields, ["Deductible"], "Matched deductible", 0.8, "questionnaire");
  }
  if (/premiumamount|totalpremium|premium/.test(lookupName)) {
    return pickField(fields, ["Premium", "Estimated exposure value"], "Matched premium/exposure value", 0.76, "system");
  }
  if (/classification/.test(lookupName)) {
    return pickField(fields, ["Classification", "Description of operations", "Business operations"], "Matched class description", 0.76, "questionnaire");
  }
  if (/classcode/.test(lookupName)) {
    return pickField(fields, ["Class code", "General liability class code"], "Matched class code", 0.74, "questionnaire");
  }
  if (/exposure/.test(lookupName)) {
    return pickField(fields, ["Exposure", "Annual revenue", "Payroll", "Estimated exposure value"], "Matched exposure basis", 0.74, "questionnaire");
  }
  if (/commercialproperty.*limitamount|premises.*limitamount|blanketlimitamount|buildinglimit|businesspersonalproperty/.test(lookupName)) {
    return pickField(fields, ["Building value", "Business personal property", "Coverage amount", "Estimated exposure value", "Stated value"], "Matched property limit/value", 0.8, "asset_detail");
  }
  if (/vehicleidentificationnumber|vinnumber|vin/.test(lookupName)) {
    return pickField(fields, ["VIN", "Vehicle identification number"], "Matched vehicle VIN", 0.82, "asset_detail");
  }
  if (/vehiclemodelyear|modelyear/.test(lookupName)) {
    return pickField(fields, ["Vehicle year", "Model year", "Year"], "Matched vehicle year", 0.78, "asset_detail");
  }
  if (/vehiclemanufacturer|vehiclemake|make/.test(lookupName)) {
    return pickField(fields, ["Vehicle make", "Make"], "Matched vehicle make", 0.78, "asset_detail");
  }
  if (/vehiclemodel|model/.test(lookupName)) {
    return pickField(fields, ["Vehicle model", "Model"], "Matched vehicle model", 0.78, "asset_detail");
  }

  return undefined;
}

function checkboxMatchForNativeField(
  field: PdfAcroFormField,
  fields: TemplateFieldMap
): NativeFieldMatch | undefined {
  const lookupName = fieldLookupName(field);
  if (isGenericNativeField(field)) return undefined;
  if (isSecondaryRepeatedNativeField(field)) return undefined;
  const entityType = valueFor(fields, ["Entity type", "Legal entity type", "Business type"]);
  const legalName = valueFor(fields, ["Business legal name", "Legal business name", "Named insured", "Applicant name"]);
  const combinedEntity = `${entityType} ${legalName}`;
  const checked = (
    sourceLabel: string,
    condition: boolean,
    reason: string,
    source: PdfAcroFormFieldMapping["source"] = "system",
    confidence = 0.86
  ): NativeFieldMatch | undefined =>
    condition
      ? { value: CHECKED_VALUE, sourceLabel, source, confidence, reason }
      : undefined;

  if (/limitedliabilitycompany|limitedliabilitycorporation|llc/.test(lookupName)) {
    return checked("Entity type", /\bllc\b|limited liability/i.test(combinedEntity), "Matched LLC entity type");
  }
  if (/subchapterscorporation|scorporation|subchapters/.test(lookupName)) {
    return checked("Entity type", /\bs[\s-]?corp|subchapter s/i.test(combinedEntity), "Matched S corporation entity type");
  }
  if (/corporation|corp/.test(lookupName) && !/limitedliability/.test(lookupName)) {
    return checked("Entity type", /\bcorp|corporation|inc\.?\b/i.test(combinedEntity), "Matched corporation entity type");
  }
  if (/partnership/.test(lookupName)) {
    return checked("Entity type", /partnership|partner/i.test(combinedEntity), "Matched partnership entity type");
  }
  if (/individual|soleproprietor/.test(lookupName)) {
    return checked("Entity type", /individual|sole proprietor/i.test(combinedEntity), "Matched individual/sole proprietor entity type");
  }
  if (/commercialproperty|propertycoverage|buildingcoverage/.test(lookupName)) {
    return checked(
      "Property address",
      !!valueFor(fields, ["Property address", "Risk / property address", "Coverage amount", "Building value", "Stated value"]),
      "Property data exists for this ACORD section",
      "asset_detail"
    );
  }
  if (/commercialgeneralliability|generalliability|occurrenceindicator/.test(lookupName)) {
    return checked(
      "Description of operations",
      !!valueFor(fields, ["General liability limit", "Description of operations", "Business operations"]),
      "General liability data exists for this ACORD section",
      "questionnaire"
    );
  }
  if (/businessauto|commercialvehicle|commercialauto|vehicle/.test(lookupName)) {
    return checked(
      "Vehicle schedule",
      !!valueFor(fields, ["VIN", "Vehicle schedule", "Vehicle make", "Vehicle model", "Automobile liability limit"]),
      "Vehicle data exists for this ACORD section",
      "asset_detail"
    );
  }
  if (/umbrella|excess/.test(lookupName)) {
    return checked(
      "Umbrella limit",
      !!valueFor(fields, ["Umbrella limit", "Excess limit", "Limits"]),
      "Umbrella/excess data exists for this ACORD section",
      "questionnaire"
    );
  }
  if (/nopriorlosses|nolosses|lossfree/.test(lookupName)) {
    return checked(
      "Loss history",
      /no losses|no prior|none/i.test(valueFor(fields, ["Loss history", "Claims history", "Prior losses"])),
      "Loss history indicates no prior losses"
    );
  }
  return undefined;
}

function explicitNativeFieldMatch(field: PdfAcroFormField, fields: TemplateFieldMap): NativeFieldMatch | undefined {
  const exactFull = fields[field.name]?.trim();
  if (exactFull) {
    return {
      value: exactFull,
      sourceLabel: field.name,
      source: "questionnaire",
      confidence: 0.98,
      reason: "Matched exact native full field name",
    };
  }
  const exactPartial = fields[field.partialName]?.trim();
  if (exactPartial) {
    return {
      value: exactPartial,
      sourceLabel: field.partialName,
      source: "questionnaire",
      confidence: 0.96,
      reason: "Matched exact native partial field name",
    };
  }
  return undefined;
}

function sourceSpecificNativeFieldMatch(
  field: PdfAcroFormField,
  fields: TemplateFieldMap,
  splitCache: Map<string, AddressParts>
): NativeFieldMatch | undefined {
  const formNumber = sourceAcordFormNumber(fields);
  if (formNumber === "3") return acord3NativeFieldMatch(field, fields, splitCache);
  return undefined;
}

function acord3NativeFieldMatch(
  field: PdfAcroFormField,
  fields: TemplateFieldMap,
  splitCache: Map<string, AddressParts>
): NativeFieldMatch | undefined {
  const textField = genericTextFieldNumber(field);
  if (!textField) return undefined;
  const source = (sourceLabel: string): PdfAcroFormFieldMapping["source"] =>
    /agency|producer/i.test(sourceLabel)
      ? "system"
      : /carrier|policy|mapping/i.test(sourceLabel)
      ? "system"
      : "contact";
  const fromField = (
    labels: string[],
    reason: string,
    confidence = 0.92
  ): NativeFieldMatch | undefined => {
    const match = pickField(fields, labels, reason, confidence, source(labels[0]));
    return match;
  };
  const addressPart = (
    cacheKey: string,
    labels: string[],
    part: keyof AddressParts,
    sourceLabel: string,
    sourceValue: PdfAcroFormFieldMapping["source"]
  ): NativeFieldMatch | undefined => {
    if (!splitCache.has(cacheKey)) splitCache.set(cacheKey, splitAddress(valueFor(fields, labels)));
    const value = splitCache.get(cacheKey)?.[part]?.trim();
    if (!value) return undefined;
    return {
      value,
      sourceLabel,
      source: sourceValue,
      confidence: 0.92,
      reason: "Mapped ACORD 3 generic field by fixed PDF position",
    };
  };
  const cityStateZip = (
    cacheKey: string,
    labels: string[],
    sourceLabel: string,
    sourceValue: PdfAcroFormFieldMapping["source"]
  ): NativeFieldMatch | undefined => {
    if (!splitCache.has(cacheKey)) splitCache.set(cacheKey, splitAddress(valueFor(fields, labels)));
    const parts = splitCache.get(cacheKey);
    const value = [
      parts?.city,
      [parts?.state, parts?.postalCode].filter(Boolean).join(" "),
    ].filter(Boolean).join(", ");
    if (!value) return undefined;
    return {
      value,
      sourceLabel,
      source: sourceValue,
      confidence: 0.9,
      reason: "Mapped ACORD 3 generic field by fixed PDF position",
    };
  };

  switch (textField) {
    case 1:
      return fromField(["Mapping date"], "Mapped ACORD 3 date field", 0.7) ?? {
        value: new Date().toLocaleDateString("en-US"),
        sourceLabel: "Mapping date",
        source: "system",
        confidence: 0.92,
        reason: "ACORD 3 completion date",
      };
    case 2:
      return fromField(["Agency", "Agency name", "Producer", "Producer name"], "Mapped ACORD 3 agency name");
    case 3:
      return addressPart("agency", ["Agency address", "Producer address"], "lineOne", "Agency address", "system");
    case 4:
      return cityStateZip("agency", ["Agency address", "Producer address"], "Agency address", "system");
    case 5:
      return fromField(["Agency phone", "Producer phone"], "Mapped ACORD 3 agency phone");
    case 7:
    case 10:
      return fromField(["Agency fax", "Producer fax", "Fax"], "Mapped ACORD 3 agency fax");
    case 9:
      return fromField(["Agency phone", "Producer phone"], "Mapped ACORD 3 contact phone");
    case 11:
      return fromField(["Agency email", "Producer email"], "Mapped ACORD 3 agency email");
    case 12:
      return fromField(["Agency customer ID", "Customer number"], "Mapped ACORD 3 agency customer code", 0.82);
    case 15:
      return fromField(["Date of occurrence", "Date of loss", "Loss date"], "Mapped ACORD 3 loss date", 0.86);
    case 18:
      return fromField(["Carrier", "Insurance carrier", "Company"], "Mapped ACORD 3 carrier");
    case 19:
      return fromField(["NAIC code", "NAIC"], "Mapped ACORD 3 NAIC code", 0.78);
    case 20:
      return fromField(["Policy number", "Policy no", "Policy #", "Current policy number"], "Mapped ACORD 3 policy number");
    case 21:
      return fromField(
        ["Business legal name", "Legal business name", "Named insured", "Applicant name", "Client name", "Insured"],
        "Mapped ACORD 3 named insured"
      );
    case 26:
      return addressPart(
        "insured",
        ["Mailing address", "Insured mailing address", "Client address"],
        "lineOne",
        "Mailing address",
        "contact"
      );
    case 27:
      return addressPart(
        "insured",
        ["Mailing address", "Insured mailing address", "Client address"],
        "lineTwo",
        "Mailing address",
        "contact"
      );
    case 28:
      return addressPart(
        "insured",
        ["Mailing address", "Insured mailing address", "Client address"],
        "city",
        "Mailing address",
        "contact"
      );
    case 29:
      return addressPart(
        "insured",
        ["Mailing address", "Insured mailing address", "Client address"],
        "state",
        "Mailing address",
        "contact"
      );
    case 30:
      return addressPart(
        "insured",
        ["Mailing address", "Insured mailing address", "Client address"],
        "postalCode",
        "Mailing address",
        "contact"
      );
    case 31:
      return fromField(["Phone", "Primary phone", "Applicant phone", "Insured phone"], "Mapped ACORD 3 insured phone");
    case 32:
      return fromField(["Contact email", "Email", "Applicant email", "Insured email"], "Mapped ACORD 3 insured email");
    default:
      return undefined;
  }
}

function sourceAcordFormNumber(fields: TemplateFieldMap): string {
  const sourceText = [
    fields["Source ACORD file"],
    fields["Source ACORD template ID"],
    fields["ACORD form number"],
    fields["Source file"],
    fields["Form name"],
  ]
    .filter(Boolean)
    .join(" ");
  const match = sourceText.match(/\bacord[-_\s]?0?(\d{1,4})\b/i);
  return match?.[1]?.replace(/^0+/, "") ?? "";
}

function isImportantNativeField(field: PdfAcroFormField): boolean {
  const lookupName = fieldLookupName(field);
  return /producer|policy|insurer|carrier|namedinsured|applicant|mailingaddress|contact|commercialstructurephysicaladdress|commercialproperty|generalliability|businessinformation|taxidentifier|fein|effective|expiration|premium|limitamount|operationsdescription|descriptionofoperations/.test(lookupName);
}

function isGenericNativeField(field: PdfAcroFormField): boolean {
  const partial = normalizedAcroName(field.partialName);
  return /^(text|check)\d+$/.test(partial);
}

function isSecondaryRepeatedNativeField(field: PdfAcroFormField): boolean {
  const normalizedName = normalizedAcroName(field.name);
  const repeated = repeatedNativeFieldSuffix(field);
  if (!repeated || repeated === "a") return false;
  return /namedinsured|mailingaddress|contact|phone|email|producer|commercialstructure|premises|driver|vehicle|additionalinterest|blanket|location|building/.test(normalizedName);
}

function repeatedNativeFieldSuffix(field: PdfAcroFormField): string | undefined {
  const match = field.name.match(/_([A-Z])(?:\[\d+])?(?:\.|$)/i) ?? field.partialName.match(/_([A-Z])(?:\[\d+])?$/i);
  return match?.[1]?.toLowerCase();
}

function genericTextFieldNumber(field: PdfAcroFormField): number | undefined {
  const match = normalizedAcroName(field.partialName).match(/^text(\d+)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function fieldLookupName(field: PdfAcroFormField): string {
  return [field.name, field.partialName, field.tooltip ?? "", field.mappingName ?? ""]
    .map(normalizedAcroName)
    .filter(Boolean)
    .join(" ");
}

function pickField(
  fields: TemplateFieldMap,
  labels: string[],
  reason: string,
  confidence = 0.9,
  source: PdfAcroFormFieldMapping["source"] = "system"
): NativeFieldMatch | undefined {
  for (const label of labels) {
    const value = valueFor(fields, [label]);
    if (value) {
      return {
        value,
        sourceLabel: label,
        source,
        confidence,
        reason,
      };
    }
  }
  return undefined;
}

function addressPartMatch(
  fields: TemplateFieldMap,
  cache: Map<string, AddressParts>,
  cacheKey: string,
  fieldName: string,
  labels: string[],
  reason: string,
  sourceLabel: string,
  source: PdfAcroFormFieldMapping["source"]
): NativeFieldMatch | undefined {
  const value = addressPart(fields, cache, cacheKey, fieldName, labels);
  if (!value) return undefined;
  return {
    value,
    sourceLabel,
    source,
    confidence: 0.9,
    reason,
  };
}

export function fillPdfAcroForm(
  pdfBytes: Uint8Array,
  valuesByFieldName: Record<string, string>
): Uint8Array {
  const parsed = parsePdf(pdfBytes);
  const fields = extractAcroFormFields(pdfBytes);
  const byFullName = new Map(fields.map((field) => [field.name, field]));
  const byPartialName = new Map(fields.map((field) => [field.partialName, field]));
  const updates = new Map<number, PdfObject>();

  const appearanceObjects: PdfObject[] = [];

  Object.entries(valuesByFieldName).forEach(([name, value]) => {
    const field = byFullName.get(name) ?? byPartialName.get(name);
    if (!field || !value.trim()) return;
    const object = parsed.objectMap.get(field.objectNumber);
    if (!object) return;
    const isButton = field.fieldType === "/Btn";
    let nextBody = isButton
      ? setCheckboxValue(object.body, value)
      : setTextValue(object.body, fitValueForPdfField(value, field.name));
    if (!isButton && field.rect) {
      const appearanceObjectNumber =
        parsed.maxObjectNumber + appearanceObjects.length + 1;
      appearanceObjects.push(
        buildTextAppearanceObject(
          appearanceObjectNumber,
          field,
          fitValueForPdfField(value, field.name)
        )
      );
      nextBody = setDictionaryEntry(nextBody, "AP", `<< /N ${appearanceObjectNumber} 0 R >>`);
    }
    updates.set(field.objectNumber, { ...object, body: nextBody });
  });

  if (parsed.acroFormRef) {
    const object = parsed.objectMap.get(parsed.acroFormRef.objectNumber);
    if (object) {
      updates.set(object.objectNumber, {
        ...object,
        body: setDictionaryEntry(object.body, "NeedAppearances", "true"),
      });
    }
  } else if (parsed.rootRef) {
    const rootObjectNumber = Number(parsed.rootRef.split(/\s+/)[0]);
    const object = Number.isFinite(rootObjectNumber)
      ? parsed.objectMap.get(rootObjectNumber)
      : undefined;
    if (object) {
      const nextBody = setInlineAcroFormNeedAppearances(object.body);
      if (nextBody !== object.body) {
        updates.set(object.objectNumber, { ...object, body: nextBody });
      }
    }
  }

  const updatedObjects = [...Array.from(updates.values()), ...appearanceObjects];
  if (updatedObjects.length === 0) return pdfBytes;
  return appendIncrementalUpdate(pdfBytes, parsed, updatedObjects);
}

export function bytesToPdfBlobUrl(bytes: Uint8Array): string {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

export function bytesToPdfDataUrl(bytes: Uint8Array): string {
  const binary = bytesToBinaryString(bytes);
  const maybeBuffer = (
    globalThis as typeof globalThis & {
      Buffer?: { from(value: string, encoding: "binary"): { toString(encoding: "base64"): string } };
    }
  ).Buffer;
  const base64 = maybeBuffer
    ? maybeBuffer.from(binary, "binary").toString("base64")
    : btoa(binary);
  return `data:application/pdf;base64,${base64}`;
}

function parsePdf(bytes: Uint8Array): ParsedPdf {
  const text = bytesToBinaryString(bytes);
  const objects: PdfObject[] = [];
  const objectMap = new Map<number, PdfObject>();
  const objectRegex = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj/g;
  let match: RegExpExecArray | null;
  let maxObjectNumber = 0;
  while ((match = objectRegex.exec(text))) {
    const objectNumber = Number(match[1]);
    const generation = Number(match[2]);
    const object = { objectNumber, generation, body: match[3].trim() };
    objects.push(object);
    objectMap.set(objectNumber, object);
    maxObjectNumber = Math.max(maxObjectNumber, objectNumber);
  }
  const previousXrefOffset = Number(text.match(/startxref\s+(\d+)\s+%%EOF\s*$/)?.[1] ?? 0);
  const trailer = text.match(/trailer\s*<<(.*?)>>\s*startxref[\s\S]*?%%EOF\s*$/)?.[1] ?? "";
  const rootRef =
    trailer.match(/\/Root\s+(\d+\s+\d+\s+R)/)?.[1] ??
    text.match(/\/Root\s+(\d+\s+\d+\s+R)/)?.[1];
  const catalog = rootRef ? objectMap.get(Number(rootRef.split(/\s+/)[0])) : undefined;
  const acroFormRef = catalog ? refValueForKey(catalog.body, "AcroForm") : undefined;
  return { text, objects, objectMap, previousXrefOffset, rootRef, acroFormRef, maxObjectNumber };
}

function appendIncrementalUpdate(
  originalBytes: Uint8Array,
  parsed: ParsedPdf,
  updates: PdfObject[]
): Uint8Array {
  let appended = "\n";
  const offsets = new Map<number, number>();
  const sorted = [...updates].sort((a, b) => a.objectNumber - b.objectNumber);
  sorted.forEach((object) => {
    offsets.set(object.objectNumber, originalBytes.length + binaryLength(appended));
    appended += `${object.objectNumber} ${object.generation} obj\n${object.body}\nendobj\n`;
  });
  const xrefOffset = originalBytes.length + binaryLength(appended);
  appended += "xref\n";
  buildXrefSections(sorted).forEach((section) => {
    appended += `${section.start} ${section.objects.length}\n`;
    section.objects.forEach((object) => {
      const offset = offsets.get(object.objectNumber) ?? 0;
      appended += `${String(offset).padStart(10, "0")} ${String(object.generation).padStart(5, "0")} n \n`;
    });
  });
  appended += "trailer\n";
  appended += `<< /Size ${Math.max(parsed.maxObjectNumber, ...sorted.map((object) => object.objectNumber)) + 1}`;
  if (parsed.rootRef) appended += ` /Root ${parsed.rootRef}`;
  if (parsed.previousXrefOffset) appended += ` /Prev ${parsed.previousXrefOffset}`;
  appended += " >>\n";
  appended += `startxref\n${xrefOffset}\n%%EOF\n`;

  const appendedBytes = binaryStringToBytes(appended);
  const out = new Uint8Array(originalBytes.length + appendedBytes.length);
  out.set(originalBytes, 0);
  out.set(appendedBytes, originalBytes.length);
  return out;
}

function buildXrefSections(objects: PdfObject[]): { start: number; objects: PdfObject[] }[] {
  const sections: { start: number; objects: PdfObject[] }[] = [];
  objects.forEach((object) => {
    const last = sections[sections.length - 1];
    if (!last || last.start + last.objects.length !== object.objectNumber) {
      sections.push({ start: object.objectNumber, objects: [object] });
    } else {
      last.objects.push(object);
    }
  });
  return sections;
}

function setTextValue(body: string, value: string): string {
  const encoded = pdfLiteralString(value);
  return setDictionaryEntry(setDictionaryEntry(body, "V", encoded), "DV", encoded);
}

function setCheckboxValue(body: string, value: string): string {
  const name = /yes|true|checked|on/i.test(value)
    ? checkboxOnStateName(body)
    : value.replace(/[^A-Za-z0-9_-]/g, "") || checkboxOnStateName(body);
  return setDictionaryEntry(setDictionaryEntry(body, "V", `/${name}`), "AS", `/${name}`);
}

function checkboxOnStateName(body: string): string {
  const normalAppearance = body.match(/\/N\s*<<([\s\S]*?)>>/)?.[1] ?? "";
  const names = Array.from(normalAppearance.matchAll(/\/([A-Za-z0-9_-]+)\s+\d+\s+\d+\s+R/g))
    .map((match) => match[1])
    .filter((name) => name.toLowerCase() !== "off");
  return names[0] ?? CHECKED_VALUE;
}

function buildTextAppearanceObject(
  objectNumber: number,
  field: PdfAcroFormField,
  rawValue: string
): PdfObject {
  const [x1, y1, x2, y2] = field.rect ?? [0, 0, 120, 14];
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);
  const isMultiline = !!(field.flags && (field.flags & 4096));
  const appearance = textAppearanceStream(rawValue, width, height, isMultiline);
  const body = [
    "<<",
    "/Type /XObject",
    "/Subtype /Form",
    `/BBox [0 0 ${formatPdfNumber(width)} ${formatPdfNumber(height)}]`,
    "/Resources <<",
    "/Font << /F0 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>",
    ">>",
    `/Length ${binaryLength(appearance)}`,
    ">>",
    "stream",
    appearance,
    "endstream",
  ].join("\n");
  return { objectNumber, generation: 0, body };
}

function textAppearanceStream(
  rawValue: string,
  width: number,
  height: number,
  multiline: boolean
): string {
  const paddingX = Math.min(2, Math.max(0.75, width * 0.03));
  const paddingY = Math.min(2, Math.max(0.75, height * 0.15));
  const maxFontSize = Math.max(4, Math.min(8, height - paddingY * 1.4));
  const availableWidth = Math.max(1, width - paddingX * 2);
  const availableHeight = Math.max(1, height - paddingY * 2);
  const initialFontSize = fitFontSize(rawValue, availableWidth, maxFontSize);
  const lines = multiline
    ? wrapTextForWidth(rawValue, availableWidth, initialFontSize)
    : [rawValue.replace(/\s+/g, " ").trim()];
  const lineHeightRatio = 1.15;
  const fontSize = Math.max(
    3.5,
    Math.min(initialFontSize, availableHeight / Math.max(1, lines.length) / lineHeightRatio)
  );
  const fittedLines = (multiline ? wrapTextForWidth(rawValue, availableWidth, fontSize) : lines)
    .slice(0, Math.max(1, Math.floor(availableHeight / Math.max(1, fontSize * lineHeightRatio))));
  const lineHeight = fontSize * lineHeightRatio;
  const firstBaseline = Math.max(
    fontSize * 0.25,
    height - paddingY - fontSize
  );
  const content = [
    "q",
    "/Tx BMC",
    "BT",
    `/F0 ${formatPdfNumber(fontSize)} Tf`,
    "0 g",
    `${formatPdfNumber(paddingX)} ${formatPdfNumber(firstBaseline)} Td`,
    ...fittedLines.flatMap((line, index) => {
      const textOperator = `${pdfLiteralString(line)} Tj`;
      return index === 0 ? [textOperator] : [`0 -${formatPdfNumber(lineHeight)} Td`, textOperator];
    }),
    "ET",
    "EMC",
    "Q",
  ];
  return content.join("\n");
}

function fitFontSize(value: string, width: number, maxFontSize: number): number {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return maxFontSize;
  const estimatedUnitWidth = Math.max(1, normalized.length * 0.52);
  return Math.max(3.5, Math.min(maxFontSize, width / estimatedUnitWidth));
}

function wrapTextForWidth(value: string, width: number, fontSize: number): string[] {
  const words = value.replace(/\r?\n/g, " ").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (estimatedTextWidth(next, fontSize) <= width || !current) {
      current = next;
      return;
    }
    lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [value.trim()];
}

function estimatedTextWidth(value: string, fontSize: number): number {
  return value.length * fontSize * 0.52;
}

function formatPdfNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function setInlineAcroFormNeedAppearances(body: string): string {
  const markerIndex = body.indexOf("/AcroForm");
  if (markerIndex === -1) return body;
  const dictStart = body.indexOf("<<", markerIndex);
  if (dictStart === -1) return body;
  const dictEnd = matchingPdfDictionaryEnd(body, dictStart);
  if (dictEnd === -1) return body;
  const dict = body.slice(dictStart, dictEnd + 2);
  const nextDict = setDictionaryEntry(dict, "NeedAppearances", "true");
  return `${body.slice(0, dictStart)}${nextDict}${body.slice(dictEnd + 2)}`;
}

function matchingPdfDictionaryEnd(value: string, start: number): number {
  let depth = 0;
  for (let i = start; i < value.length - 1; i += 1) {
    const pair = value.slice(i, i + 2);
    if (pair === "<<") {
      depth += 1;
      i += 1;
    } else if (pair === ">>") {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
    }
  }
  return -1;
}

function setDictionaryEntry(body: string, key: string, valueToken: string): string {
  const existing = new RegExp(`/${key}\\s+(?:\\([^)]*\\)|/[A-Za-z0-9_-]+|true|false|null|\\d+\\s+\\d+\\s+R|\\[[\\s\\S]*?\\]|<<[\\s\\S]*?>>)`);
  if (existing.test(body)) return body.replace(existing, `/${key} ${valueToken}`);
  const insertAt = body.lastIndexOf(">>");
  if (insertAt === -1) return body;
  return `${body.slice(0, insertAt).trimEnd()}\n/${key} ${valueToken}\n${body.slice(insertAt)}`;
}

function fullFieldName(
  objectNumber: number,
  partialNames: Map<number, string>,
  parentRefs: Map<number, number>
): string {
  const names: string[] = [];
  const seen = new Set<number>();
  let current: number | undefined = objectNumber;
  while (current && !seen.has(current)) {
    seen.add(current);
    const partial = partialNames.get(current);
    if (partial) names.unshift(partial);
    current = parentRefs.get(current);
  }
  return names.join(".");
}

function literalValueForKey(body: string, key: string): string | undefined {
  const match = body.match(new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`));
  return match ? decodePdfLiteral(match[1]) : undefined;
}

function nameValueForKey(body: string, key: string): string | undefined {
  const match = body.match(new RegExp(`/${key}\\s*(/[A-Za-z0-9_-]+)`));
  return match?.[1];
}

function numberValueForKey(body: string, key: string): number | undefined {
  const match = body.match(new RegExp(`/${key}\\s+(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : undefined;
}

function rectValueForKey(body: string, key: string): [number, number, number, number] | undefined {
  const match = body.match(new RegExp(`/${key}\\s*\\[([^\\]]+)\\]`));
  if (!match) return undefined;
  const values = match[1].trim().split(/\s+/).map(Number).filter((value) => Number.isFinite(value));
  return values.length >= 4 ? [values[0], values[1], values[2], values[3]] : undefined;
}

function refValueForKey(body: string, key: string): { objectNumber: number; generation: number } | undefined {
  const match = body.match(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`));
  return match ? { objectNumber: Number(match[1]), generation: Number(match[2]) } : undefined;
}

function pdfLiteralString(value: string): string {
  return `(${value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r?\n/g, "\\r")})`;
}

function decodePdfLiteral(value: string): string {
  const decoded = value
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([\\()nrtbf])/g, (_, char: string) => {
      if (char === "n") return "\n";
      if (char === "r") return "\r";
      if (char === "t") return "\t";
      if (char === "b") return "\b";
      if (char === "f") return "\f";
      return char;
    });
  if (decoded.length >= 2 && decoded.charCodeAt(0) === 0xfe && decoded.charCodeAt(1) === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < decoded.length; i += 2) {
      out += String.fromCharCode((decoded.charCodeAt(i) << 8) | decoded.charCodeAt(i + 1));
    }
    return out;
  }
  return decoded;
}

function valueFor(fields: TemplateFieldMap, labels: string[]): string {
  for (const label of labels) {
    const direct = fields[label]?.trim();
    if (direct) return direct;
  }
  const normalizedLabels = labels.map(normalizeLabel);
  const match = Object.entries(fields).find(
    ([key, value]) => value.trim() && normalizedLabels.includes(normalizeLabel(key))
  );
  return match?.[1].trim() ?? "";
}

function addressPart(
  fields: TemplateFieldMap,
  cache: Map<string, AddressParts>,
  cacheKey: string,
  fieldName: string,
  labels: string[]
): string {
  if (!cache.has(cacheKey)) cache.set(cacheKey, splitAddress(valueFor(fields, labels)));
  const parts = cache.get(cacheKey)!;
  const normalized = normalizedAcroName(fieldName);
  if (/lineone|streetaddress/.test(normalized)) return parts.lineOne;
  if (/linetwo/.test(normalized)) return parts.lineTwo;
  if (/cityname/.test(normalized)) return parts.city;
  if (/stateorprovincecode|statecode/.test(normalized)) return parts.state;
  if (/postalcode|zipcode/.test(normalized)) return parts.postalCode;
  return [parts.lineOne, parts.lineTwo, parts.city, parts.state, parts.postalCode].filter(Boolean).join(", ");
}

function splitAddress(value: string): AddressParts {
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  const lineOne = parts[0] ?? value;
  const city = parts.length >= 3 ? parts[parts.length - 2] : "";
  const stateZip = parts.length >= 2 ? parts[parts.length - 1] : "";
  const stateZipMatch = stateZip.match(/\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i);
  return {
    lineOne,
    lineTwo: parts.length > 3 ? parts.slice(1, -2).join(", ") : "",
    city,
    state: stateZipMatch?.[1]?.toUpperCase() ?? "",
    postalCode: stateZipMatch?.[2] ?? "",
  };
}

function fitValueForPdfField(value: string, fieldName: string): string {
  const normalized = normalizedAcroName(fieldName);
  const max =
    /remark|description|operations|explanation|address/.test(normalized) ? 180 :
    /email/.test(normalized) ? 70 :
    /fullname|name/.test(normalized) ? 64 :
    42;
  if (value.length <= max) return value;
  const safe = value.slice(0, max - 1).replace(/\s+\S*$/, "").trim();
  return safe || value.slice(0, max);
}

function normalizedAcroName(value: string): string {
  return value.toLowerCase().replace(/\[[^\]]*]/g, "").replace(/[^a-z0-9]+/g, "");
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return out;
}

function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

function binaryLength(value: string): number {
  return value.length;
}
