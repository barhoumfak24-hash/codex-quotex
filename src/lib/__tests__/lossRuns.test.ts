import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLossRunEmailBody,
  buildLossRunPrintHtml,
  buildLossRunReport,
  lossRunAttachment,
  lossRunPdfFileName,
} from "@/lib/lossRuns";
import { api } from "@/lib/api";
import { db } from "@/lib/db";

beforeEach(() => {
  db.reset();
});

describe("loss run helpers", () => {
  it("builds a previous loss-runs report from recorded claims", () => {
    const claimNumber = `LR-${Date.now()}`;
    api.claims.create({
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      policyId: "policy_home",
      carrierId: "carrier_chubb",
      externalClaimNumber: claimNumber,
      status: "closed",
      closedAt: "2026-05-20T12:00:00.000Z",
    });

    const report = buildLossRunReport("customer_demo");

    expect(report?.customer.name).toContain("Alexandra");
    expect(report?.rows.some((row) => row.claimNumber === claimNumber)).toBe(true);
    expect(report?.closedCount).toBeGreaterThanOrEqual(1);
  });

  it("creates client-ready email and print output with a PDF attachment label", () => {
    const report = buildLossRunReport("customer_demo")!;
    const body = buildLossRunEmailBody(report, "client");
    const html = buildLossRunPrintHtml(report);
    const attachment = lossRunAttachment(report);

    expect(body).toContain("Loss-run detail:");
    expect(body).toContain(report.customer.name);
    expect(html).toContain("Previous loss runs");
    expect(attachment.fileType).toBe("application/pdf");
    expect(lossRunPdfFileName(report)).toMatch(/loss-runs\.pdf$/);
  });

  it("checks carrier portals for claims and imports discovered claim activity", () => {
    expect(api.claims.listByCustomer("customer_demo")).toHaveLength(0);

    const out = api.claims.checkForCarrierClaims({
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      createdById: "user_manager_pc",
    });

    const claims = api.claims.listByCustomer("customer_demo");
    expect(out.checked).toBeGreaterThan(0);
    expect(out.created).toBe(1);
    expect(claims).toHaveLength(1);
    expect(claims[0].externalClaimNumber).toMatch(/^CR-/);
    expect(claims[0].status).toBe("in_review");
    expect(api.carrierRunnerJobs.listByTenant("agency_palmcoast").some((job) => job.trigger === "claim_check")).toBe(
      true
    );
    expect(
      api.status
        .listByTenant("agency_palmcoast")
        .some(
          (event) =>
            event.customerId === "customer_demo" &&
            event.message.includes("reported") &&
            event.claimId === claims[0].id
        )
    ).toBe(true);
  });

  it("moves closed claims into previous loss runs with a close-out remark", () => {
    const claim = api.claims.create({
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      policyId: "policy_home",
      carrierId: "carrier_chubb",
      externalClaimNumber: "CLOSED-LOSS-1",
      status: "opened",
    });

    api.claims.close(claim.id, "user_manager_pc");

    const report = buildLossRunReport("customer_demo")!;
    const row = report.rows.find((lossRow) => lossRow.claim.id === claim.id);
    expect(row?.statusLabel).toBe("Closed");
    expect(row?.closedDate).not.toBe("Open");
    expect(
      api.status
        .listByTenant("agency_palmcoast")
        .some(
          (event) =>
            event.customerId === "customer_demo" &&
            event.claimId === claim.id &&
            event.message.includes("previous loss runs")
        )
    ).toBe(true);
    expect(
      api.notes
        .listByCustomer("customer_demo")
        .some((note) => note.policyId === "policy_home" && note.body.includes("previous loss runs"))
    ).toBe(true);
  });
});
