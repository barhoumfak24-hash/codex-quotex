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

async function seedSecurityContext() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const manager = api.users.list(agency.id).find((user) => user.role === "manager")!;
  const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
  return { api, agency, manager, agent };
}

describe("security controls", () => {
  it("flags suspicious behavior with an audit-backed open incident", async () => {
    const { api, agency, manager, agent } = await seedSecurityContext();

    const incident = api.security.flag({
      tenantId: agency.id,
      reportedById: manager.id,
      subjectUserId: agent.id,
      severity: "high",
      reason: "Repeated failed access attempts from a new location.",
    });

    expect(incident.status).toBe("open");
    expect(incident.subjectLabel).toBe(agent.name);
    expect(api.security.listOpenIncidents(agency.id)).toHaveLength(1);
  });

  it("bans a user account and blocks access checks until the ban is revoked", async () => {
    const { api, agency, manager, agent } = await seedSecurityContext();

    const ban = api.security.banUser({
      tenantId: agency.id,
      userId: agent.id,
      createdById: manager.id,
      reason: "Confirmed compromised account.",
    });

    expect(ban?.active).toBe(true);
    expect(api.users.get(agent.id)?.active).toBe(false);
    expect(api.security.accessBlockFor({ tenantId: agency.id, userId: agent.id })).toBeTruthy();

    api.security.revokeBan(ban!.id, manager.id);

    expect(api.security.accessBlockFor({ tenantId: agency.id, userId: agent.id })).toBeUndefined();
    expect(api.security.listBans(agency.id, true)).toHaveLength(0);
  });

  it("normalizes IP bans before checking access", async () => {
    const { api, agency, manager } = await seedSecurityContext();

    const ban = api.security.banIp({
      tenantId: agency.id,
      ipAddress: " 203.0.113.42 ",
      createdById: manager.id,
      reason: "Credential stuffing attempt.",
    });

    expect(ban?.ipAddress).toBe("203.0.113.42");
    expect(
      api.security.accessBlockFor({
        tenantId: agency.id,
        ipAddress: "203.0.113.42",
      })
    ).toMatchObject(ban!);
  });
});
