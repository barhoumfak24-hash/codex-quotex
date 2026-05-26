// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ADD_ASSET_QUESTIONNAIRES,
  CANCEL_POLICY_QUESTIONNAIRE,
  OTHER_CHANGE_QUESTIONNAIRE,
  formatQuestionnaireBody,
} from "../policyEditQuestionnaires";

// =====================================================================
// The questionnaire body must:
//   - lead with an intent-specific headline
//   - print every answered field as a bullet, skipping empty ones
//   - format select values with their human label (not the value code)
//   - format yes_no as Yes/No, currency as $N
//   - keep keyword-rich phrases ("cancel", "coverage limit", "named
//     insured") intact so the api.ts classifier still buckets the
//     AI auto-reply correctly
// =====================================================================

describe("formatQuestionnaireBody", () => {
  it("add-asset (luxury_vehicle) produces a structured body the classifier can read", () => {
    const q = ADD_ASSET_QUESTIONNAIRES.luxury_vehicle;
    const body = formatQuestionnaireBody({
      questionnaire: q,
      intent: "add_asset",
      assetTypeForAdd: "luxury_vehicle",
      answers: {
        year_make_model: "2024 Porsche 911",
        vin: "WP0AB2A91NS123456",
        estimated_value: "185000",
        primary_use: "pleasure",
        primary_driver: "Jane Doe",
        effective_date: "2026-06-01",
        _note: "Need this on the policy before our trip.",
      },
    });
    expect(body).toMatch(/add a new vehicle/i);
    expect(body).toContain("2024 Porsche 911");
    expect(body).toContain("$185,000");
    expect(body).toContain("Pleasure"); // select label, not raw value
    expect(body).toContain("Additional notes:");
    expect(body).toContain("Need this on the policy before our trip.");
  });

  it("cancel intent keeps the word 'cancel' in the headline so the classifier buckets it", () => {
    const body = formatQuestionnaireBody({
      questionnaire: CANCEL_POLICY_QUESTIONNAIRE,
      intent: "cancel_policy",
      answers: {
        reason: "sold_asset",
        cancellation_date: "2026-07-01",
        understands_short_rate: "yes",
      },
    });
    expect(body).toMatch(/^I'd like to cancel my policy\./);
    expect(body).toContain("Sold / no longer own the asset");
    expect(body).toContain("Yes");
  });

  it("yes_no values render as Yes/No, not raw 'yes'/'no'", () => {
    const q = ADD_ASSET_QUESTIONNAIRES.coastal_home;
    const body = formatQuestionnaireBody({
      questionnaire: q,
      intent: "add_asset",
      assetTypeForAdd: "coastal_home",
      answers: {
        property_address: "1 Beach Rd, Naples, FL 34102",
        occupancy: "primary",
        year_built: "2015",
        square_footage: "4200",
        pool_trampoline: "yes",
        effective_date: "2026-06-01",
      },
    });
    expect(body).toContain("Pool, trampoline, or other attractive nuisance?: Yes");
  });

  it("empty fields are skipped, including the freeform note", () => {
    const q = OTHER_CHANGE_QUESTIONNAIRE;
    const body = formatQuestionnaireBody({
      questionnaire: q,
      intent: "other_change",
      answers: { change_summary: "Bump my umbrella to $5M" },
    });
    expect(body).not.toContain("Additional notes:");
    expect(body).not.toMatch(/effective date.*:/i);
    expect(body).toContain("Bump my umbrella to $5M");
  });
});