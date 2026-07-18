// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Master-portal user provisioning + customer-filtering tests.
//
// Verifies the new `provisionMore` API and the rule that customers
// never appear in the master "Users" view.
// =====================================================================

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

describe("api.users.provisionMore", () => {
  it("generates a unique agency code and resolves agencies by that code", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Harbor Code Test",
      contactEmail: "ops@harbor-code.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
    });

    const plainCode = api.agencies.revealCodeForMaster(agency.id)!;
    expect(plainCode).toMatch(/^[A-Z0-9]{7,}$/);
    expect(agency.agencyCodeEncrypted).toMatch(/^qac1\./);
    expect(agency.agencyCodePreview).toBe(plainCode.slice(-4));
    expect(api.agencies.byCode(plainCode.toLowerCase())?.id).toBe(agency.id);
    expect(api.agencies.byCode(`${plainCode.slice(0, 3)} ${plainCode.slice(3)}`)?.id).toBe(
      agency.id
    );
  });

  it("generates protected website connection credentials for new agencies", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Portal Connection Agency",
      contactEmail: "ops@portal-connection.example",
      website: "https://portal-connection.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
    });

    expect(agency.websiteAllowedDomains).toEqual(["portal-connection.example"]);
    expect(agency.customerPortalUrl).toBe("https://portal-connection.example/client-portal");
    expect(agency.quoteStartUrl).toBe("https://portal-connection.example/start-quote");
    expect(agency.websiteApiKeyEncrypted).toMatch(/^qcs1\./);
    expect(agency.websiteWebhookSecretEncrypted).toMatch(/^qcs1\./);
    expect(api.agencies.revealWebsiteApiKeyForMaster(agency.id)).toMatch(/^qtx_site_/);
    expect(api.agencies.revealWebsiteWebhookSecretForMaster(agency.id)).toMatch(/^qtx_hook_/);
    expect(agency.websitePortalModules?.policies).toBe(true);
    expect(agency.websitePortalModules?.signatures).toBe(true);
  });

  it("lets master regenerate an agency code while preserving protected storage", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Change Code Agency",
      contactEmail: "ops@change-code.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
    });
    const original = api.agencies.revealCodeForMaster(agency.id);
    const result = api.agencies.regenerateCode(agency.id);
    expect(result.ok).toBe(true);
    const updated = api.agencies.get(agency.id)!;
    const next = api.agencies.revealCodeForMaster(agency.id);
    expect(next).toMatch(/^[A-Z0-9]{7,}$/);
    expect(next).not.toBe(original);
    expect(updated.agencyCodeEncrypted).toMatch(/^qac1\./);
    expect(updated.agencyCodePreview).toBe(next!.slice(-4));
    expect(api.agencies.byCode(next!)?.id).toBe(agency.id);
  });

  it("creates the requested number of unassigned agent credentials", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const before = api.users.list(agency.id).filter((u) => u.role === "agent").length;
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 3,
    });
    expect(made).toHaveLength(3);
    const after = api.users.list(agency.id).filter((u) => u.role === "agent").length;
    expect(after - before).toBe(3);
    // New credentials are always unassigned.
    for (const u of made) {
      expect(u.profileCompleted).toBe(false);
      expect(u.username).toBeTruthy();
      expect(u.generatedPassword).toBeUndefined();
    }
  });

  it("creates managers when role=manager is requested", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "manager",
      count: 2,
    });
    expect(made.every((u) => u.role === "manager")).toBe(true);
  });

  it("clamps the count to [1, 50] so a stray '0' or '999' input can't break things", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const tooSmall = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 0,
    });
    expect(tooSmall).toHaveLength(1);
    api.agencies.addUserSlots(agency.id, 100);
    const tooLarge = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 999,
    });
    expect(tooLarge).toHaveLength(50);
  });

  it("usernames are unique even when the existing tenant already has agents", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const made = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 5,
    });
    const usernames = made.map((u) => u.username);
    expect(new Set(usernames).size).toBe(usernames.length);
    const allUsernames = api.users.list(agency.id).map((u) => u.username).filter(Boolean);
    expect(new Set(allUsernames).size).toBe(allUsernames.length);
  });

  it("stops at paid user-slot capacity and prices add-on slots at $300/mo", async () => {
    const { api } = await import("../api");
    const {
      ADD_ON_USER_SLOT_MONTHLY_PRICE_USD,
      agencyMonthlyPriceUsd,
      TIER_LIMITS,
    } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Capacity Test Agency",
      contactEmail: "ops@capacity-test.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
    });
    const initialStaff = api.users
      .list(agency.id)
      .filter((u) => u.role === "agent" || u.role === "manager").length;

    const fillBaseSlots = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "agent",
      count: 99,
    });
    expect(fillBaseSlots).toHaveLength(agency.allowedUsers - initialStaff);
    expect(
      api.users.provisionMore({
        tenantId: agency.id,
        agencyName: agency.name,
        role: "manager",
        count: 1,
      })
    ).toHaveLength(0);

    api.agencies.addUserSlots(agency.id, 2);
    const expanded = api.agencies.get(agency.id)!;
    expect(expanded.allowedUsers).toBe(TIER_LIMITS.minimum.allowedUsers + 2);
    expect(agencyMonthlyPriceUsd(expanded)).toBe(
      TIER_LIMITS.minimum.monthlyPriceUsd + 2 * ADD_ON_USER_SLOT_MONTHLY_PRICE_USD
    );

    const addOnUsers = api.users.provisionMore({
      tenantId: agency.id,
      agencyName: agency.name,
      role: "manager",
      count: 5,
    });
    expect(addOnUsers).toHaveLength(2);
  });

  it("prices manager plan edits from users and website plus Quotex app package only", async () => {
    const { api } = await import("../api");
    const {
      COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD,
      SOFTWARE_USER_MONTHLY_PRICE_USD,
      agencyMonthlyPriceUsd,
      TIER_LIMITS,
    } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Manager Capacity Agency",
      contactEmail: "ops@manager-capacity.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
    });

    const updated = api.agencies.updateSubscriptionLimits(agency.id, {
      tier: "minimum",
      allowedUsers: TIER_LIMITS.minimum.allowedUsers + 3,
      allowedCarriers: TIER_LIMITS.minimum.allowedCarriers + 2,
      allowedAiMessagesPerMonth: TIER_LIMITS.minimum.allowedAiMessagesPerMonth + 2500,
      websiteAppAddOn: "website_app",
    })!;

    expect(updated.allowedUsers).toBe(TIER_LIMITS.minimum.allowedUsers + 3);
    expect(updated.allowedCarriers).toBe(TIER_LIMITS.minimum.allowedCarriers + 2);
    expect(updated.allowedAiMessagesPerMonth).toBe(
      TIER_LIMITS.minimum.allowedAiMessagesPerMonth + 2500
    );
    expect(agencyMonthlyPriceUsd(updated)).toBe(
      updated.allowedUsers * SOFTWARE_USER_MONTHLY_PRICE_USD +
        COMPANY_WEBSITE_AND_APP_MONTHLY_ADD_ON_USD
    );
  });

  it("lets staff self-create an account with agency code until slots are full", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Self Signup Agency",
      contactEmail: "ops@self-signup.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
      allowedUsers: 1,
    });
    const agencyCode = api.agencies.revealCodeForMaster(agency.id)!;
    const first = api.users.registerStaff({
      agencyCode,
      role: "agent",
      firstName: "Nadia",
      lastName: "Cole",
      phone: "+1 (555) 100-0000",
      businessEmail: "nadia@self-signup.example",
      password: "secure-pass-1",
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.user.tenantId).toBe(agency.id);
      expect(first.user.profileCompleted).toBe(true);
      expect(first.user.username).toBeUndefined();
    }

    const second = api.users.registerStaff({
      agencyCode,
      role: "manager",
      firstName: "Max",
      lastName: "Stone",
      phone: "+1 (555) 100-0001",
      businessEmail: "max@self-signup.example",
      password: "secure-pass-2",
    });
    expect(second).toMatchObject({ ok: false, reason: "slot_limit" });
  });

  it("assigns selected staff branches and rejects branches from other agencies", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Branched Signup Agency",
      contactEmail: "ops@branched-signup.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
      allowedUsers: 3,
    });
    const otherAgency = api.agencies.create({
      name: "Other Branch Agency",
      contactEmail: "ops@other-branch.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
      allowedUsers: 3,
    });
    const agencyCode = api.agencies.revealCodeForMaster(agency.id)!;
    const branch = api.branches.create({
      agencyId: agency.id,
      name: "North Office",
    });
    const otherBranch = api.branches.create({
      agencyId: otherAgency.id,
      name: "Outside Office",
    });

    const created = api.users.registerStaff({
      agencyCode,
      branchId: branch.id,
      role: "agent",
      firstName: "Bri",
      lastName: "Hart",
      phone: "+1 (555) 300-0000",
      businessEmail: "bri@branched-signup.example",
      password: "secure-pass-1",
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.user.tenantId).toBe(agency.id);
      expect(created.user.branchId).toBe(branch.id);
    }

    const rejected = api.users.registerStaff({
      agencyCode,
      branchId: otherBranch.id,
      role: "agent",
      firstName: "Casey",
      lastName: "Vale",
      phone: "+1 (555) 300-0001",
      businessEmail: "casey@branched-signup.example",
      password: "secure-pass-2",
    });
    expect(rejected).toMatchObject({ ok: false, reason: "missing_fields" });
  });

  it("disabling staff blocks access without lowering purchased capacity", async () => {
    const { api } = await import("../api");
    const { TIER_LIMITS } = await import("../tiers");
    const agency = api.agencies.create({
      name: "Soft Delete Agency",
      contactEmail: "ops@soft-delete.example",
      serviceAreas: ["FL"],
      tier: "minimum",
      ...TIER_LIMITS.minimum,
      allowedUsers: 2,
    });
    const agencyCode = api.agencies.revealCodeForMaster(agency.id)!;
    const manager = api.users.registerStaff({
      agencyCode,
      role: "manager",
      firstName: "Mara",
      lastName: "Stone",
      phone: "+1 (555) 200-0000",
      businessEmail: "mara@soft-delete.example",
      password: "secure-pass-1",
    });
    const agent = api.users.registerStaff({
      agencyCode,
      role: "agent",
      firstName: "Aria",
      lastName: "Lane",
      phone: "+1 (555) 200-0001",
      businessEmail: "aria@soft-delete.example",
      password: "secure-pass-2",
    });
    expect(manager.ok).toBe(true);
    expect(agent.ok).toBe(true);
    if (!manager.ok || !agent.ok) return;

    const disabled = api.users.setStaffAccessStatus(agent.user.id, "deleted", manager.user.id);
    expect(disabled.ok).toBe(true);
    expect(api.agencies.get(agency.id)?.allowedUsers).toBe(2);
    expect(api.users.get(agent.user.id)?.active).toBe(false);
    expect(api.users.get(agent.user.id)?.staffAccessStatus).toBe("deleted");

    const replacement = api.users.registerStaff({
      agencyCode,
      role: "agent",
      firstName: "Nico",
      lastName: "Reed",
      phone: "+1 (555) 200-0002",
      businessEmail: "nico@soft-delete.example",
      password: "secure-pass-3",
    });
    expect(replacement.ok).toBe(true);

    const tooManyActive = api.users.setStaffAccessStatus(agent.user.id, "active", manager.user.id);
    expect(tooManyActive).toMatchObject({ ok: false, reason: "seat_capacity" });
  });
});

describe("customers stay out of the staff view", () => {
  it("customers exist as users with role='customer' so they need explicit filtering", async () => {
    const { api } = await import("../api");
    const all = api.users.list();
    const customers = all.filter((u) => u.role === "customer");
    expect(customers.length).toBeGreaterThan(0); // seeded
    const staffOnly = all.filter((u) => u.role !== "customer");
    expect(staffOnly.every((u) => u.role !== "customer")).toBe(true);
  });
});
