// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADD_ADDITIONAL_INSURED_QUESTIONNAIRE,
  ADD_REMOVE_COVERAGE_QUESTIONNAIRE,
  CHANGE_COVERAGE_LIMITS_QUESTIONNAIRE,
  UPDATE_ASSET_INFO_QUESTIONNAIRE,
  UPDATE_BENEFICIARY_QUESTIONNAIRE,
  formatQuestionnaireBody,
} from "../policyEditQuestionnaires";

// =====================================================================
// Per-policy change intents — body formatting + headline keywords so
// the api.ts AI classifier can still bucket the auto-reply.
// =====================================================================

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});
afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("policy-change questionnaire bodies", () => {
  it("change_coverage_limits opens with the right headline + bucket keywords", () => {
    const body = formatQuestionnaireBody({
      questionnaire: CHANGE_COVERAGE_LIMITS_QUESTIONNAIRE,
      intent: "change_coverage_limits",
      answers: {
        current_concern: "Bump dwelling coverage limit from $2.4M to $2.6M.",
      },
    });
    expect(body).toMatch(/^I'd like to change a coverage limit/);
    expect(body).toMatch(/coverage limit/i);
  });

  it("add_remove_coverage shows the add/remove selection + the requested change", () => {
    const body = formatQuestionnaireBody({
      questionnaire: ADD_REMOVE_COVERAGE_QUESTIONNAIRE,
      intent: "add_remove_coverage",
      answers: {
        intent: "add",
        what: "Add Equipment Breakdown endorsement.",
      },
    });
    expect(body).toContain("Add a coverage / endorsement / rider");
    expect(body).toContain("Add Equipment Breakdown endorsement.");
  });

  it("update_asset_info captures the changed asset detail", () => {
    const body = formatQuestionnaireBody({
      questionnaire: UPDATE_ASSET_INFO_QUESTIONNAIRE,
      intent: "update_asset_info",
      answers: {
        what_changed: "Sold the 911, replaced with a Taycan.",
        new_details: "2024 Porsche Taycan Turbo, VIN WP0BB2Y19PSA12345",
      },
    });
    expect(body).toMatch(/asset/i);
    expect(body).toContain("Taycan");
  });

  it("add_additional_insured carries person + relationship", () => {
    const body = formatQuestionnaireBody({
      questionnaire: ADD_ADDITIONAL_INSURED_QUESTIONNAIRE,
      intent: "add_additional_insured",
      answers: {
        intent: "add",
        person_name: "Marcus Whitford",
        relationship: "Spouse",
      },
    });
    expect(body).toContain("Marcus Whitford");
    expect(body).toContain("Spouse");
  });

  it("update_beneficiary keeps the beneficiary keyword for the classifier", () => {
    const body = formatQuestionnaireBody({
      questionnaire: UPDATE_BENEFICIARY_QUESTIONNAIRE,
      intent: "update_beneficiary",
      answers: {
        intent: "update",
        person_name: "Marcus Whitford",
        share_percent: "100",
      },
    });
    expect(body).toMatch(/beneficiary/i);
    expect(body).toContain("100");
  });
});

describe("helpers.logDocumentDownload — audit trail", () => {
  it("writes both an internal status event and an audit-log row", async () => {
    const { api } = await import("../api");
    const { db } = await import("../db");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const docs = api.documents.listByTenant(agency.id);
    if (docs.length === 0) return;
    const doc = docs[0];

    const beforeAudit = db.list("audit").length;
    const beforeEvents = api.status.listFor({ customerId: customer.id }).length;

    api.helpers.logDocumentDownload({
      tenantId: agency.id,
      documentId: doc.id,
      actorId: customer.userId,
      actorRole: "customer",
      customerId: customer.id,
      policyId: doc.policyId,
      assetId: doc.assetId,
      fileName: doc.fileName,
    });

    expect(db.list("audit").length).toBe(beforeAudit + 1);
    const events = api.status.listFor({ customerId: customer.id });
    expect(events.length).toBe(beforeEvents + 1);
    const ev = events.find((e) => e.documentId === doc.id)!;
    expect(ev.visibility).toBe("internal");
    expect(ev.message).toMatch(/Document downloaded/);
  });
});