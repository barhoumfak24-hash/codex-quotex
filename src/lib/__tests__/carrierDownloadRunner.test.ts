import { describe, expect, it } from "vitest";
import {
  splitRunnerList,
  validateCarrierDownloadRunnerDraft,
  type CarrierDownloadRunnerDraft,
} from "../carrierDownloadRunner";

const completeDraft: CarrierDownloadRunnerDraft = {
  enabled: true,
  mode: "ai_portal_runner",
  credentialVaultRef: "secret://carrier-runner/pcpc",
  mfaMode: "staff_approval",
  authorizedUserIds: ["user_manager_pc"],
  lines: ["personal", "commercial"],
  feeds: ["policy", "renewal", "billing", "edocs"],
  carrierIds: ["carrier_chubb", "carrier_pure"],
  reviewRule: "require_review_for_material_changes",
  schedule: "as_available",
  failureAlertEmails: ["downloads@palmcoastpc.example"],
  contactEmail: "downloads@palmcoastpc.example",
  contactPhone: "+1 (555) 312-0099",
  lastTestAt: "2026-06-11T12:00",
  lastTestStatus: "passed",
  lastTestMessage: "Signed in, downloaded one renewal, matched policy, and staged changes.",
};

describe("carrierDownloadRunner validation", () => {
  it("splits newline, comma, and semicolon lists while removing duplicates", () => {
    expect(splitRunnerList("carrier_chubb, carrier_pure\ncarrier_chubb;carrier_aig")).toEqual([
      "carrier_chubb",
      "carrier_pure",
      "carrier_aig",
    ]);
  });

  it("marks a fully tested supervised runner ready", () => {
    const result = validateCarrierDownloadRunnerDraft(completeDraft);

    expect(result.ready).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.missing).toEqual([]);
  });

  it("requires MFA handling and an agency approver", () => {
    const result = validateCarrierDownloadRunnerDraft({
      ...completeDraft,
      mfaMode: "not_configured",
      authorizedUserIds: [],
    });

    expect(result.ready).toBe(false);
    expect(result.status).toBe("pending_setup");
    expect(result.missing).toContain("MFA handling method");
    expect(result.missing).toContain("Authorized agency approver");
  });

  it("does not block readiness when carriers are inherited from active agency links", () => {
    const result = validateCarrierDownloadRunnerDraft({
      ...completeDraft,
      carrierIds: [],
    });

    expect(result.ready).toBe(true);
    expect(result.status).toBe("ready");
    expect(result.warnings.join(" ")).toContain("active agency carriers");
  });

  it("requires a passed supervised runner test before ready", () => {
    const result = validateCarrierDownloadRunnerDraft({
      ...completeDraft,
      lastTestAt: "",
      lastTestStatus: "not_tested",
    });

    expect(result.ready).toBe(false);
    expect(result.status).toBe("pending_setup");
    expect(result.missing).toContain("Successful supervised runner test");
  });

  it("reports failed supervised tests as error", () => {
    const result = validateCarrierDownloadRunnerDraft({
      ...completeDraft,
      lastTestStatus: "failed",
      lastTestMessage: "Carrier changed login flow.",
    });

    expect(result.ready).toBe(false);
    expect(result.status).toBe("error");
  });
});
