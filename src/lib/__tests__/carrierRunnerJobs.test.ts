// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("carrier runner jobs", () => {
  it("queues a carrier runner job when a policy is put in place", async () => {
    const { api } = await import("../api");

    const policy = api.policies.create({
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      assetId: "asset_home",
      carrierId: "carrier_chubb",
      policyNumber: "CHB-NEW-101",
      status: "bound",
      renewalStatus: "not_due",
      renewalDate: "2026-07-01T12:00:00.000Z",
      agentId: "user_agent_pc",
    });

    const jobs = api.carrierRunnerJobs.listByTenant("agency_palmcoast");
    const job = jobs.find((row) => row.policyId === policy.id && row.trigger === "policy_placed");

    expect(job).toBeTruthy();
    expect(job?.status).toBe("queued");
    expect(job?.reason).toContain("Policy was put in place");
  });

  it("sweeps renewal windows without duplicating jobs", async () => {
    const { api } = await import("../api");

    api.policies.update("policy_home", {
      renewalDate: "2026-06-25T12:00:00.000Z",
      renewalStatus: "upcoming",
    });

    const firstSweep = api.carrierRunnerJobs.sweepRenewals(
      "agency_palmcoast",
      "2026-06-11T12:00:00.000Z"
    );
    const secondSweep = api.carrierRunnerJobs.sweepRenewals(
      "agency_palmcoast",
      "2026-06-11T12:00:00.000Z"
    );

    expect(firstSweep.some((job) => job.policyId === "policy_home" && job.trigger === "renewal_window")).toBe(true);
    expect(secondSweep.filter((job) => job.policyId === "policy_home" && job.trigger === "renewal_window")).toHaveLength(1);
    expect(
      api
        .carrierRunnerJobs
        .listByTenant("agency_palmcoast")
        .filter((job) => job.policyId === "policy_home" && job.trigger === "renewal_window")
    ).toHaveLength(1);
  });

  it("marks the renewal non-renewed when runner evidence detects non-renewal", async () => {
    const { api } = await import("../api");

    const job = api.carrierRunnerJobs.queueForPolicy(
      "policy_home",
      "renewal_status_check",
      "Carrier portal shows a non-renewal notice."
    )!;
    const completed = api.carrierRunnerJobs.complete(job.id, {
      outcome: "non_renewal_detected",
      summary: "Carrier portal posted a non-renewal notice for the upcoming term.",
      sourceReference: "carrier-runner://chubb/non-renewal/CHB-HM-558920",
    })!;

    expect(completed.detectedOutcome).toBe("non_renewal_detected");
    expect(api.policies.get("policy_home")?.renewalStatus).toBe("not_renewed");
    expect(api.renewals.listByPolicy("policy_home").some((renewal) => renewal.status === "not_renewed")).toBe(true);
    expect(
      api
        .tasks
        .listByTenant("agency_palmcoast")
        .some((task) => task.policyId === "policy_home" && task.title.includes("Non-renewal"))
    ).toBe(true);
  });

  it("logs staged carrier results into timeline and client remarks without exposing runner language", async () => {
    const { api } = await import("../api");

    const job = api.carrierRunnerJobs.queueForPolicy(
      "policy_home",
      "renewal_window",
      "Carrier portal has an updated renewal document."
    )!;

    api.carrierRunnerJobs.complete(job.id, {
      outcome: "renewal_update_staged",
      stageDownload: {
        kind: "policy_update",
        summary: "Chubb posted the renewal declaration page for review.",
        documentPayload: {
          fileName: "CHB-HM-558920-renewal-dec-2027.pdf",
          fileType: "application/pdf",
          type: "declarations_page",
          visibility: "customer_visible",
          status: "pending",
        },
      },
    });

    const events = api.status.listFor({ policyId: "policy_home" });
    const notes = api.notes.listByCustomer("customer_demo");

    expect(events.some((event) => event.message.includes("posted updated renewal information"))).toBe(true);
    expect(notes.some((note) => note.body.includes("posted updated renewal information"))).toBe(true);
    expect(events.some((event) => /AI runner|carrier runner/i.test(event.message))).toBe(false);
    expect(notes.some((note) => /AI runner|carrier runner/i.test(note.body))).toBe(false);
  });

  it("retrieves active policy records through the carrier policy runner", async () => {
    const { api } = await import("../api");

    const out = api.policies.retrieveFromCarrier({
      tenantId: "agency_palmcoast",
      customerId: "customer_demo",
      createdById: "user_manager_pc",
    });

    expect(out.checked).toBeGreaterThan(0);
    expect(out.jobIds.length).toBe(out.checked);
    expect(
      api
        .carrierRunnerJobs
        .listByTenant("agency_palmcoast")
        .some((job) => job.trigger === "policy_check" && job.status === "completed")
    ).toBe(true);
    expect(api.policies.get("policy_home")?.billingLastVerifiedAt).toBeTruthy();
    expect(
      api.status
        .listFor({ policyId: "policy_home" })
        .some((event) => event.message.includes("Current policy data is in the system"))
    ).toBe(true);
  });

  it("searches linked carriers when the client has no policy on file", async () => {
    const { api } = await import("../api");

    const customer = api.customers.create({
      tenantId: "agency_palmcoast",
      userId: "user_policy_discovery_test",
      name: "Policy Discovery Client",
      email: "policy.discovery@example.com",
      lineOfBusiness: "personal",
      marketingOptInEmail: false,
      marketingOptInSms: false,
      skipAutoRoute: true,
    });
    const out = api.policies.retrieveFromCarrier({
      tenantId: "agency_palmcoast",
      customerId: customer.id,
      createdById: "user_manager_pc",
    });

    expect(api.policies.listByCustomer(customer.id)).toHaveLength(0);
    expect(out.checked).toBeGreaterThan(0);
    expect(out.updated).toBe(0);
    expect(out.summary).toContain("Started policy retrieval");
    const jobs = api
      .carrierRunnerJobs
      .listByTenant("agency_palmcoast")
      .filter((job) => job.customerId === customer.id && job.trigger === "policy_check");
    expect(jobs).toHaveLength(out.checked);
    expect(jobs.every((job) => job.status === "queued" && !job.policyId)).toBe(true);
  });

  it("moves closed policies into previous policies with timeline and remark records", async () => {
    const { api } = await import("../api");

    const closed = api.policies.close("policy_home", "user_manager_pc")!;

    expect(closed.status).toBe("closed");
    expect(api.policies.listActiveByCustomer("customer_demo").some((policy) => policy.id === "policy_home")).toBe(
      false
    );
    expect(api.policies.listPreviousByCustomer("customer_demo").some((policy) => policy.id === "policy_home")).toBe(
      true
    );
    expect(
      api.status
        .listFor({ policyId: "policy_home" })
        .some((event) => event.message.includes("moved to previous policies"))
    ).toBe(true);
    expect(
      api.notes
        .listByCustomer("customer_demo")
        .some((note) => note.policyId === "policy_home" && note.body.includes("previous policies"))
    ).toBe(true);
  });
});
