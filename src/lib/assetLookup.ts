import type { AssetType, CategoryQuestion } from "@/types";

function normalizedQuestionText(question: CategoryQuestion): string {
  return `${question.key} ${question.label}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

function matchingQuestion(
  questions: CategoryQuestion[],
  patterns: RegExp[]
): CategoryQuestion | undefined {
  return questions.find((question) => {
    const text = normalizedQuestionText(question);
    return patterns.some((pattern) => pattern.test(text));
  });
}

function required(question: CategoryQuestion): CategoryQuestion {
  return { ...question, required: true };
}

function syntheticQuestion(
  key: string,
  label: string,
  placeholder: string,
  inputType: CategoryQuestion["inputType"] = "text"
): CategoryQuestion {
  return { key, label, placeholder, inputType, required: true };
}

export function assetLookupQuestion(
  assetType: AssetType,
  questions: CategoryQuestion[]
): CategoryQuestion {
  const vin = matchingQuestion(questions, [/\bvin\b/, /vehicle identification/]);
  const hullId = matchingQuestion(questions, [/\bhin\b/, /hull (id|number)/]);
  const address = questions.find((question) => question.inputType === "address");
  const identifier = matchingQuestion(questions, [
    /\bserial\b/,
    /\basset id\b/,
    /\binventory id\b/,
    /\bregistration\b/,
    /\blicense number\b/,
    /\breference number\b/,
  ]);

  if (assetType === "luxury_vehicle") {
    return required(
      vin ?? syntheticQuestion("vin", "VIN", "Enter the 17-character VIN")
    );
  }

  if (assetType === "yacht") {
    return required(
      hullId ?? syntheticQuestion("hin", "Hull ID / HIN", "Enter the hull identification number")
    );
  }

  if (assetType === "coastal_home" || assetType === "full_portfolio") {
    return required(
      address ??
        syntheticQuestion(
          "propertyAddress",
          "Property address",
          "Start typing the property address",
          "address"
        )
    );
  }

  if (assetType === "jewelry") {
    return required(
      identifier ??
        syntheticQuestion(
          "assetIdentifier",
          "Serial, appraisal, or inventory ID",
          "Enter the asset identification number"
        )
    );
  }

  if (assetType === "umbrella_liability") {
    return required(
      identifier ??
        syntheticQuestion(
          "assetIdentifier",
          "Policy or exposure reference",
          "Enter the policy or exposure reference number"
        )
    );
  }

  return required(
    vin ??
      hullId ??
      identifier ??
      address ??
      syntheticQuestion(
        "assetIdentifier",
        "Asset address or ID number",
        "Enter the address, serial number, registration, or asset ID"
      )
  );
}
