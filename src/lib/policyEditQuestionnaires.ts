import type { AssetType } from "@/types";

// =====================================================================
// Base "edit my policy" questionnaires the customer can fill out
// instead of (or alongside) the freeform textbox in the client
// portal. These are the minimum data points carriers typically need
// to bind a new asset to a policy, cancel a policy, or process a
// common change. The freeform note always rides along at the end.
//
// Intentionally concise — ~8–12 fields per intent. Real carrier
// applications go deeper (driver MVR, named-perils riders, etc.)
// but this gives the agent enough to start the carrier ticket.
// =====================================================================

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "select"
  | "yes_no";

export interface QField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  helper?: string;
}

export type EditIntent =
  | "add_asset"
  | "change_coverage_limits"
  | "add_remove_coverage"
  | "update_asset_info"
  | "add_additional_insured"
  | "update_beneficiary"
  | "cancel_policy"
  | "other_change";

export interface Questionnaire {
  id: string;
  // Human-readable label used as the section header inside the
  // formatted body sent to the agent.
  title: string;
  fields: QField[];
}

// Always tacked onto every questionnaire so the customer can drop
// extra context the schema didn't ask for.
const FREEFORM_NOTE: QField = {
  key: "_note",
  label: "Anything else your agent should know? (optional)",
  type: "textarea",
  placeholder: "Effective date preferences, scheduling notes, follow-up questions…",
};

// ---------------------------------------------------------------------
// Add-coverage questionnaires, one per asset type.
// ---------------------------------------------------------------------

export const ADD_ASSET_QUESTIONNAIRES: Record<AssetType, Questionnaire> = {
  luxury_vehicle: {
    id: "add_luxury_vehicle",
    title: "Add a vehicle to my policy",
    fields: [
      { key: "year_make_model", label: "Year, make, model, trim", type: "text", required: true, placeholder: "2024 Porsche 911 Carrera S" },
      { key: "vin", label: "VIN (17 characters)", type: "text", required: true, placeholder: "WP0AB2A91NS123456" },
      { key: "estimated_value", label: "Estimated value (USD)", type: "currency", required: true },
      { key: "current_mileage", label: "Current mileage", type: "number" },
      { key: "garaging_address", label: "Garaging address (street, city, state, ZIP)", type: "textarea", required: true },
      { key: "annual_miles", label: "Annual miles driven", type: "number", helper: "Estimate is fine. Pleasure ≈ 5–8k, commute ≈ 10–15k." },
      { key: "primary_use", label: "Primary use", type: "select", required: true, options: [
        { value: "pleasure", label: "Pleasure" },
        { value: "commute", label: "Commute to work" },
        { value: "business", label: "Business" },
        { value: "show_collector", label: "Show / collector" },
      ] },
      { key: "primary_driver", label: "Primary driver (full name)", type: "text", required: true },
      { key: "other_drivers", label: "Other drivers in household (name + DOB + license #)", type: "textarea", placeholder: "List one per line. Leave blank if none." },
      { key: "modifications", label: "Modifications from factory? Please describe.", type: "textarea", placeholder: "Wheels, tune, exhaust, lift, etc. Write 'none' if stock." },
      { key: "lienholder", label: "Loan or lease holder (lender name + address)", type: "textarea", placeholder: "Write 'owned outright' if no lien." },
      { key: "effective_date", label: "Coverage effective date requested", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  coastal_home: {
    id: "add_coastal_home",
    title: "Add a home to my policy",
    fields: [
      { key: "property_address", label: "Property address (street, city, state, ZIP)", type: "textarea", required: true },
      { key: "occupancy", label: "Occupancy", type: "select", required: true, options: [
        { value: "primary", label: "Primary residence" },
        { value: "secondary", label: "Secondary / seasonal" },
        { value: "rental", label: "Rental property" },
        { value: "vacant", label: "Vacant" },
      ] },
      { key: "year_built", label: "Year built", type: "number", required: true },
      { key: "square_footage", label: "Living area (sq ft)", type: "number", required: true },
      { key: "construction", label: "Construction type", type: "select", options: [
        { value: "frame", label: "Wood frame" },
        { value: "masonry", label: "Masonry / block" },
        { value: "brick", label: "Brick" },
        { value: "mixed", label: "Mixed / other" },
      ] },
      { key: "roof_type_age", label: "Roof type and age (e.g., asphalt shingle, 6 yrs)", type: "text" },
      { key: "reconstruction_cost", label: "Estimated reconstruction cost (USD)", type: "currency", helper: "Carrier may order a Marshall & Swift estimate; your number is fine for a starting point." },
      { key: "wind_mitigation", label: "Wind mitigation features (impact glass, shutters, hip roof, straps)", type: "textarea", placeholder: "Coastal underwriters care about this. Write 'none' if unsure." },
      { key: "pool_trampoline", label: "Pool, trampoline, or other attractive nuisance?", type: "yes_no" },
      { key: "dogs", label: "Dogs in the home? Breed(s) if yes.", type: "text", placeholder: "e.g., 'one Goldendoodle' or 'none'" },
      { key: "mortgagee", label: "Mortgagee (lender name + loan number)", type: "textarea", placeholder: "Write 'owned outright' if no mortgage." },
      { key: "effective_date", label: "Coverage effective date requested", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  yacht: {
    id: "add_yacht",
    title: "Add a yacht / boat to my policy",
    fields: [
      { key: "year_make_model", label: "Year, builder, model, length", type: "text", required: true, placeholder: "2022 Hinckley Picnic Boat 40" },
      { key: "hull_id", label: "Hull Identification Number (HIN)", type: "text", required: true },
      { key: "estimated_value", label: "Estimated value (USD)", type: "currency", required: true },
      { key: "hull_material", label: "Hull material", type: "select", options: [
        { value: "fiberglass", label: "Fiberglass" },
        { value: "aluminum", label: "Aluminum" },
        { value: "wood", label: "Wood" },
        { value: "steel", label: "Steel" },
        { value: "composite", label: "Composite" },
      ] },
      { key: "engine", label: "Engine type and horsepower", type: "text", placeholder: "Twin Volvo IPS 600, 870 hp combined" },
      { key: "mooring", label: "Where is the boat moored or stored? (marina name + slip / address)", type: "textarea", required: true },
      { key: "navigation_area", label: "Primary navigation area", type: "select", required: true, options: [
        { value: "inland", label: "Inland lakes / rivers" },
        { value: "coastal", label: "Coastal (within sight of land)" },
        { value: "offshore", label: "Offshore / blue water" },
      ] },
      { key: "operator_experience", label: "Primary operator + years of experience + safety certifications", type: "textarea", required: true, placeholder: "e.g., 'Owner, 12 yrs, USCG OUPV captain license'" },
      { key: "captain", label: "Paid captain on board?", type: "yes_no" },
      { key: "lienholder", label: "Loan holder (lender name + address)", type: "textarea", placeholder: "Write 'owned outright' if no lien." },
      { key: "effective_date", label: "Coverage effective date requested", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  jewelry: {
    id: "add_jewelry",
    title: "Add jewelry / scheduled item to my policy",
    fields: [
      { key: "item_description", label: "Item description", type: "text", required: true, placeholder: "Engagement ring — 2.1ct round brilliant, platinum solitaire" },
      { key: "designer", label: "Brand or designer (if any)", type: "text", placeholder: "e.g., Cartier, Tiffany & Co., independent jeweler" },
      { key: "appraised_value", label: "Appraised value (USD)", type: "currency", required: true },
      { key: "appraisal_date", label: "Date of last appraisal", type: "date", required: true, helper: "Carriers typically require an appraisal within 3 years for items over $25k." },
      { key: "purchase_year", label: "Year acquired", type: "number" },
      { key: "storage", label: "Where is it normally kept?", type: "select", required: true, options: [
        { value: "worn_daily", label: "Worn daily" },
        { value: "home_safe", label: "Home safe / jewelry box" },
        { value: "bank_vault", label: "Bank safe deposit box" },
        { value: "other", label: "Other" },
      ] },
      { key: "have_appraisal_doc", label: "Do you have a written appraisal you can upload?", type: "yes_no" },
      { key: "have_photos", label: "Do you have photos you can upload?", type: "yes_no" },
      { key: "effective_date", label: "Coverage effective date requested", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  umbrella_liability: {
    id: "add_umbrella",
    title: "Add umbrella / excess liability coverage",
    fields: [
      { key: "limit_requested", label: "Liability limit requested", type: "select", required: true, options: [
        { value: "1m", label: "$1M" },
        { value: "2m", label: "$2M" },
        { value: "5m", label: "$5M" },
        { value: "10m", label: "$10M" },
        { value: "more", label: "More than $10M" },
      ] },
      { key: "underlying_auto", label: "Underlying auto liability limits (per person / per accident / property)", type: "text", placeholder: "e.g., 250/500/100" },
      { key: "underlying_home", label: "Underlying homeowners liability limit", type: "currency", placeholder: "e.g., 500000" },
      { key: "underlying_watercraft", label: "Underlying watercraft liability (if any)", type: "text", placeholder: "Write 'none' if no boat." },
      { key: "rental_properties", label: "Do you own rental properties?", type: "yes_no" },
      { key: "household_drivers", label: "All licensed drivers in household (name + DOB)", type: "textarea", required: true, placeholder: "One per line." },
      { key: "incidents_5yr", label: "Any liability incidents, claims, or moving violations in the past 5 years?", type: "textarea", placeholder: "Describe each, or write 'none'." },
      { key: "high_risk_activities", label: "Anyone in the household engaged in high-profile / high-risk activities? (executive role, public figure, board service, frequent international travel)", type: "textarea", placeholder: "Write 'none' if not applicable." },
      { key: "effective_date", label: "Coverage effective date requested", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  full_portfolio: {
    id: "add_portfolio",
    title: "Add a full-portfolio / package policy",
    fields: [
      { key: "asset_summary", label: "Quick inventory of what you'd like covered", type: "textarea", required: true, placeholder: "e.g., 2 homes, 4 vehicles, 1 yacht, jewelry, $5M umbrella" },
      { key: "current_carriers", label: "Current carrier(s) and policy expiration dates", type: "textarea", required: true, placeholder: "One line per current policy." },
      { key: "consolidation_goal", label: "Why are you exploring a package now?", type: "textarea", placeholder: "Pricing, service, recent claim, life event…" },
      { key: "effective_date", label: "Target effective date", type: "date", required: true },
      FREEFORM_NOTE,
    ],
  },
  other: {
    id: "add_other",
    title: "Add other coverage",
    fields: [
      { key: "what_to_add", label: "What would you like to add to your policy?", type: "textarea", required: true, placeholder: "Describe the asset, coverage, or rider." },
      { key: "estimated_value", label: "Estimated value, if applicable (USD)", type: "currency" },
      { key: "effective_date", label: "Coverage effective date requested", type: "date" },
      FREEFORM_NOTE,
    ],
  },
};

// ---------------------------------------------------------------------
// Cancellation questionnaire — applies to any policy on any asset.
// ---------------------------------------------------------------------

export const CANCEL_POLICY_QUESTIONNAIRE: Questionnaire = {
  id: "cancel_policy",
  title: "Request a policy cancellation",
  fields: [
    { key: "reason", label: "Reason for cancellation", type: "select", required: true, options: [
      { value: "replacing_carrier", label: "Replacing with a new carrier" },
      { value: "sold_asset", label: "Sold / no longer own the asset" },
      { value: "no_longer_needed", label: "No longer need the coverage" },
      { value: "pricing", label: "Pricing — want to shop alternatives first" },
      { value: "service", label: "Service issue with current carrier" },
      { value: "other", label: "Other (explain in notes)" },
    ] },
    { key: "cancellation_date", label: "Cancellation effective date requested", type: "date", required: true, helper: "Most carriers need at least 10 days' notice; we'll confirm." },
    { key: "new_carrier", label: "If replacing, new carrier name + new policy effective date", type: "text", placeholder: "e.g., Chubb Masterpiece, effective 2026-06-01" },
    { key: "proof_of_replacement", label: "Can you upload a binder or declarations page from the new carrier?", type: "yes_no", helper: "Required by most lienholders to avoid lapse." },
    { key: "refund_method", label: "Preferred refund method", type: "select", options: [
      { value: "check", label: "Mailed check" },
      { value: "on_file", label: "Credit back to payment method on file" },
      { value: "skip", label: "Decide later" },
    ] },
    { key: "understands_short_rate", label: "I understand mid-term cancellations may be short-rated and a portion of premium may be retained.", type: "yes_no", required: true },
    FREEFORM_NOTE,
  ],
};

// ---------------------------------------------------------------------
// Per-policy change intents shown when the Edit Policy button is
// pressed from a specific policy card.
// ---------------------------------------------------------------------

export const CHANGE_COVERAGE_LIMITS_QUESTIONNAIRE: Questionnaire = {
  id: "change_coverage_limits",
  title: "Change coverage limits or deductibles",
  fields: [
    { key: "current_concern", label: "Which coverage(s) would you like adjusted?", type: "textarea", required: true, placeholder: "e.g., bump dwelling from $2.4M to $2.6M; raise BI liability to $1M; lower comprehensive deductible to $500…" },
    { key: "reason", label: "What's prompting this change?", type: "textarea", placeholder: "Recent renovation, new appraisal, life event, premium-savings shopping…" },
    { key: "effective_date", label: "When would you like the change to take effect?", type: "date" },
    { key: "willing_to_offset", label: "Open to offsetting premium impact (e.g., raise another deductible)?", type: "yes_no" },
    FREEFORM_NOTE,
  ],
};

export const ADD_REMOVE_COVERAGE_QUESTIONNAIRE: Questionnaire = {
  id: "add_remove_coverage",
  title: "Add or remove a coverage / endorsement / rider",
  fields: [
    { key: "intent", label: "Add or remove?", type: "select", required: true, options: [
      { value: "add", label: "Add a coverage / endorsement / rider" },
      { value: "remove", label: "Remove a coverage / endorsement / rider" },
    ] },
    { key: "what", label: "Which coverage or endorsement?", type: "textarea", required: true, placeholder: "e.g., add Water Backup at $25k; add Scheduled Jewelry rider for a Cartier watch; remove rental reimbursement; add Equipment Breakdown…" },
    { key: "effective_date", label: "Effective date requested", type: "date" },
    FREEFORM_NOTE,
  ],
};

export const UPDATE_ASSET_INFO_QUESTIONNAIRE: Questionnaire = {
  id: "update_asset_info",
  title: "Update the insured asset's information",
  fields: [
    { key: "what_changed", label: "What changed about the asset?", type: "textarea", required: true, placeholder: "New address, new VIN, sold and replaced the vehicle, renovation, new garage / outbuilding, etc." },
    { key: "new_details", label: "New details (address / VIN / make+model / valuation)", type: "textarea", required: true },
    { key: "effective_date", label: "When did / does this change take effect?", type: "date" },
    FREEFORM_NOTE,
  ],
};

export const ADD_ADDITIONAL_INSURED_QUESTIONNAIRE: Questionnaire = {
  id: "add_additional_insured",
  title: "Add or remove a driver / additional insured",
  fields: [
    { key: "intent", label: "Add or remove?", type: "select", required: true, options: [
      { value: "add", label: "Add a driver / additional insured" },
      { value: "remove", label: "Remove a driver / additional insured" },
    ] },
    { key: "person_name", label: "Full legal name", type: "text", required: true },
    { key: "relationship", label: "Relationship to you", type: "text", placeholder: "Spouse, adult child, business partner, lienholder…" },
    { key: "dob", label: "Date of birth (if adding a driver)", type: "date" },
    { key: "license_number", label: "Driver's license # + state (for autos)", type: "text", placeholder: "Last 4 digits is fine — your agent will collect the rest securely." },
    { key: "driving_history", label: "Any moving violations or claims in the past 5 years?", type: "textarea", placeholder: "Describe each, or write 'none'." },
    { key: "effective_date", label: "Effective date requested", type: "date" },
    FREEFORM_NOTE,
  ],
};

export const UPDATE_BENEFICIARY_QUESTIONNAIRE: Questionnaire = {
  id: "update_beneficiary",
  title: "Update a beneficiary",
  fields: [
    { key: "intent", label: "What's the change?", type: "select", required: true, options: [
      { value: "add", label: "Add a beneficiary" },
      { value: "remove", label: "Remove a beneficiary" },
      { value: "update", label: "Update an existing beneficiary's share or details" },
    ] },
    { key: "person_name", label: "Beneficiary's full legal name", type: "text", required: true },
    { key: "relationship", label: "Relationship to you", type: "text" },
    { key: "share_percent", label: "Share percentage (if applicable)", type: "number", placeholder: "0–100" },
    { key: "reason", label: "Reason for the change (optional)", type: "textarea", placeholder: "Marriage, divorce, estate update, beneficiary passed, etc." },
    { key: "effective_date", label: "Effective date requested", type: "date" },
    FREEFORM_NOTE,
  ],
};

// ---------------------------------------------------------------------
// Niche / "other change" — minimal scaffold around the freeform note.
// ---------------------------------------------------------------------

export const OTHER_CHANGE_QUESTIONNAIRE: Questionnaire = {
  id: "other_change",
  title: "Request another change to my policy",
  fields: [
    { key: "change_summary", label: "What would you like to change?", type: "textarea", required: true, placeholder: "e.g., update coverage limit, add a named insured, change deductible, update mortgagee…" },
    { key: "effective_date", label: "When would you like this to take effect?", type: "date" },
    FREEFORM_NOTE,
  ],
};

// =====================================================================
// Format the collected answers + intent into a single readable body
// the agent will see in the inbound communication. The existing
// keyword classifier in api.ts (classifyEditRequest) reads this
// text to bucket the AI auto-reply, so the formatting choices here
// matter — keep keywords like "cancel", "coverage limit", "named
// insured" intact when present in the user's answers.
// =====================================================================

export function formatQuestionnaireBody(input: {
  questionnaire: Questionnaire;
  answers: Record<string, string>;
  intent: EditIntent;
  assetTypeForAdd?: AssetType;
}): string {
  const { questionnaire, answers, intent, assetTypeForAdd } = input;
  const headlines: Record<EditIntent, string> = {
    add_asset: assetTypeForAdd
      ? `I'd like to add a new ${friendlyAsset(assetTypeForAdd)} to my policy.`
      : `I'd like to add coverage to my policy.`,
    change_coverage_limits: `I'd like to change a coverage limit or deductible on my policy.`,
    add_remove_coverage: `I'd like to add or remove a coverage / endorsement on my policy.`,
    update_asset_info: `I'd like to update information about the insured asset on my policy.`,
    add_additional_insured: `I'd like to add or remove a driver / additional insured on my policy.`,
    update_beneficiary: `I'd like to update a beneficiary on my policy.`,
    cancel_policy: `I'd like to cancel my policy.`,
    other_change: `I'd like to make a change to my policy.`,
  };
  const lines: string[] = [headlines[intent], "", `${questionnaire.title}:`];

  for (const f of questionnaire.fields) {
    const raw = answers[f.key];
    if (raw == null || raw === "") continue;
    if (f.key === "_note") continue; // appended at the bottom
    const display = displayValue(f, raw);
    lines.push(`• ${f.label}: ${display}`);
  }
  const note = answers["_note"]?.trim();
  if (note) {
    lines.push("", "Additional notes:", note);
  }
  return lines.join("\n");
}

function displayValue(f: QField, raw: string): string {
  if (f.type === "select" && f.options) {
    return f.options.find((o) => o.value === raw)?.label ?? raw;
  }
  if (f.type === "yes_no") return raw === "yes" ? "Yes" : raw === "no" ? "No" : raw;
  if (f.type === "currency") {
    const n = Number(raw);
    return isFinite(n) ? `$${n.toLocaleString()}` : raw;
  }
  return raw;
}

function friendlyAsset(t: AssetType): string {
  const map: Record<AssetType, string> = {
    luxury_vehicle: "vehicle",
    coastal_home: "home",
    yacht: "yacht",
    jewelry: "scheduled jewelry item",
    umbrella_liability: "umbrella liability layer",
    full_portfolio: "full-portfolio package",
    other: "asset",
  };
  return map[t];
}