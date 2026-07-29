// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Decrement-by-one contract for the agent / manager sidebar badges.
//
// Every alert category must have a clear UI action that drops the
// count by exactly one when attended to:
//
//   Prospects        → set status away from new/abandoned (or archive)
//   Clients          → close the open claim
//   Policies         → advance the policy out of pending states
//   Renewals         → mark renewed or not_due
//   Document review  → approve or reject the pending doc
//   AI marketing     → approve or discard the draft
//
// These tests exercise the api-level operations the UI buttons call;
// the sidebar layout subscribes to db changes and renders the same
// counts, so passing here means the badge ticks correctly.
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

function alertCounts(api: typeof import("../../../lib/api").api, tenantId: string) {
  const prospects = api.prospects
    .listByTenant(tenantId)
    .filter((p) => p.status === "new" || p.status === "abandoned").length;
  const claimsByCustomer = new Set(
    api.claims.listByTenant(tenantId).filter((c) => c.status !== "closed").map((c) => c.customerId)
  );
  const clients = claimsByCustomer.size;
  const policies = api.policies.listByTenant(tenantId).filter((p) =>
    [
      "submitted_to_agent",
      "under_agent_review",
      "submitted_to_carrier",
      "carrier_reviewing",
      "documents_needed",
    ].includes(p.status)
  ).length;
  const renewals = api.renewals.listByTenant(tenantId).filter((r) => r.status === "upcoming")
    .length;
  const documents = api.documents.listByTenant(tenantId).filter((d) => d.status === "pending")
    .length;
  const marketing = api.marketing
    .listMessages(tenantId)
    .filter((m) => m.deliveryStatus === "draft").length;
  return { prospects, clients, policies, renewals, documents, marketing };
}

// Manager-only badge calc (mirrors EmployeeLayout's
// computeEmployeeBadges for the Clients tile). Pure helper —
// avoids importing the layout component in a node test env.
function clientsBadgeFor(api: typeof import("../../../lib/api").api, tenantId: string, role: "agent" | "manager") {
  // Mirrors EmployeeLayout: every individual item is one alert.
  const openClaims = api.claims.listByTenant(tenantId).filter((c) => c.status !== "closed").length;
  const pending = api.communications.listPendingForTenant(tenantId).length;
  const unassigned =
    role === "manager"
      ? api.customers.list(tenantId).filter((c) => !c.assignedAgentId).length
      : 0;
  return openClaims + pending + unassigned;
}

describe("Tasks badge — AI auto-reply notifications", () => {
  // Policy-edit requests are now AI-auto-replied and resolve the
  // inbound comm immediately. The alert moves to the Tasks badge,
  // which counts unacknowledged AI notifications plus open tasks.
  function tasksBadge(tenantId: string) {
    return (
      api.aiNotifications
        .listUnacked(tenantId)
        .filter((n) => n.kind !== "goal_request" && n.kind !== "inbound_notice").length +
      api.tasks.listOpen(tenantId).length
    );
  }
  let api: typeof import("../../../lib/api").api;

  it("customer policy-edit request bumps the Tasks badge by 1", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const before = tasksBadge(agency.id);
    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Please bump my coverage limit by $100k.",
    });
    expect(tasksBadge(agency.id)).toBe(before + 1);
  });

  it("the AI auto-reply resolves the inbound comm on submission, so the badge doesn't pump", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const before = api.communications.listPendingForTenant(agency.id).length;
    api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Need an update.",
    });
    // AI auto-replies on submission → inbound comm is created
    // already resolved, so the pending-messages count is flat.
    expect(api.communications.listPendingForTenant(agency.id).length).toBe(before);
  });

  it("acknowledging the notification keeps the badge at the same count (notification → open task)", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update please.",
    });
    const before = tasksBadge(agency.id);
    api.aiNotifications.acknowledge(out.notificationId!);
    expect(tasksBadge(agency.id)).toBe(before);
  });

  it("completing the spawned task drops the Tasks badge by 1", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const out = api.policies.requestEdit({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: asset.id,
      body: "Update please.",
    });
    const ack = api.aiNotifications.acknowledge(out.notificationId!)!;
    const before = tasksBadge(agency.id);
    api.tasks.markComplete(ack.task.id);
    expect(tasksBadge(agency.id)).toBe(before - 1);
  });

  it("each policy-edit request creates its own notification (3 requests = 3 notifications)", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    if (!asset) return;
    const before = api.aiNotifications.listUnacked(agency.id).length;
    api.policies.requestEdit({ tenantId: agency.id, customerId: customer.id, assetId: asset.id, body: "A" });
    api.policies.requestEdit({ tenantId: agency.id, customerId: customer.id, assetId: asset.id, body: "B" });
    api.policies.requestEdit({ tenantId: agency.id, customerId: customer.id, assetId: asset.id, body: "C" });
    expect(api.aiNotifications.listUnacked(agency.id).length).toBe(before + 3);
  });

  it("notification-only inbound notices do not pump the Tasks badge", async () => {
    ({ api } = await import("../../../lib/api"));
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const communication = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "inbound",
      body: "I uploaded the signed form.",
    });
    api.communications.sweepInboundForActivities(agency.id);
    expect(
      api.aiNotifications
        .listUnacked(agency.id)
        .some((n) => n.kind === "inbound_notice")
    ).toBe(true);
    expect(
      api.tasks
        .listByTenant(agency.id)
        .some(
          (task) =>
            task.messageId === communication.id ||
            task.originalMessageId === communication.id
        )
    ).toBe(false);
  });
});

describe("Clients badge — manager-only unassigned alert", () => {
  it("unassigned customers count toward the badge for managers", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    // Force unassigned state.
    api.customers.update(customer.id, { assignedAgentId: undefined });
    const managerCount = clientsBadgeFor(api, agency.id, "manager");
    expect(managerCount).toBeGreaterThan(0);
  });

  it("unassigned customers do NOT count toward the badge for agents", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    // Force every customer to be unassigned, close every claim,
    // and resolve every pending inbound request so the badge is
    // driven purely by the unassigned signal.
    api.customers.list(agency.id).forEach((c) =>
      api.customers.update(c.id, { assignedAgentId: undefined })
    );
    api.claims.listByTenant(agency.id).forEach((c) =>
      api.claims.update(c.id, { status: "closed" })
    );
    const anyStaff = api.users
      .list(agency.id)
      .find((u) => u.role === "agent" || u.role === "manager")!;
    api.communications
      .listPendingForTenant(agency.id)
      .forEach((c) => api.communications.markResolved(c.id, anyStaff.id));
    expect(clientsBadgeFor(api, agency.id, "manager")).toBeGreaterThan(0);
    expect(clientsBadgeFor(api, agency.id, "agent")).toBe(0);
  });

  it("assigning an agent drops the manager's Clients badge by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    // Close every claim so the open-claim portion is zeroed out.
    api.claims.listByTenant(agency.id).forEach((c) =>
      api.claims.update(c.id, { status: "closed" })
    );
    const customer = api.customers.list(agency.id)[0];
    api.customers.update(customer.id, { assignedAgentId: undefined });
    const agent = api.users.list(agency.id).find((u) => u.role === "agent")!;
    const before = clientsBadgeFor(api, agency.id, "manager");
    api.customers.update(customer.id, { assignedAgentId: agent.id });
    const after = clientsBadgeFor(api, agency.id, "manager");
    expect(after).toBe(before - 1);
  });
});

describe("Employee layout badge resilience", () => {
  it("does not blank the portal when a cached open task is missing a title", async () => {
    const { api } = await import("../../../lib/api");
    const { db } = await import("../../../lib/db");
    const { computeEmployeeBadges } = await import("../EmployeeLayout");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;

    db.insert("tasks", {
      id: "task_cached_missing_title",
      tenantId: agency.id,
      assignedToId: manager.id,
      title: undefined,
      summary: "Malformed legacy row from an older demo cache.",
      source: "manual",
      status: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);

    expect(() =>
      computeEmployeeBadges(agency.id, { id: manager.id, role: "manager" })
    ).not.toThrow();
  }, 15000);
});

describe("badge decrement-by-one", () => {
  it("setting a 'new' prospect to 'contacted' drops the Prospects count by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const prospect = api.prospects
      .listByTenant(agency.id)
      .find((p) => p.status === "new" || p.status === "abandoned");
    if (!prospect) return;
    const before = alertCounts(api, agency.id);
    api.prospects.setStatus(prospect.id, "contacted");
    const after = alertCounts(api, agency.id);
    expect(after.prospects).toBe(before.prospects - 1);
  });

  it("closing a claim drops the Clients count by 1 (when that was the customer's only open claim)", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    // Make sure there's an open claim attached to a customer who
    // has no other open claims, so closing it definitely drops the
    // count by exactly 1.
    const claim = api.claims.create({
      tenantId: agency.id,
      customerId: customer.id,
      policyId: api.policies.listByCustomer(customer.id)[0]?.id ?? "policy_test",
      carrierId: "carrier_chubb",
      status: "in_review",
    });
    const before = alertCounts(api, agency.id);
    api.claims.close(claim.id);
    const after = alertCounts(api, agency.id);
    expect(after.clients).toBe(before.clients - 1);
  });

  it("advancing a pending policy to 'bound' drops the Policies count by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const policy = api.policies.create({
      tenantId: agency.id,
      customerId: customer.id,
      assetId: api.assets.listByCustomer(customer.id)[0]?.id ?? "asset_test",
      carrierId: "carrier_chubb",
      status: "submitted_to_agent",
      effectiveDate: new Date().toISOString(),
      renewalDate: new Date().toISOString(),
      renewalStatus: "not_due",
    });
    const before = alertCounts(api, agency.id);
    api.policies.setStatus(policy.id, "bound");
    const after = alertCounts(api, agency.id);
    expect(after.policies).toBe(before.policies - 1);
  });

  it("marking a renewal renewed drops the Renewals count by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const upcoming = api.renewals.listByTenant(agency.id).find((r) => r.status === "upcoming");
    if (!upcoming) return;
    const before = alertCounts(api, agency.id);
    api.renewals.markRenewed(upcoming.id);
    const after = alertCounts(api, agency.id);
    expect(after.renewals).toBe(before.renewals - 1);
  });

  it("approving a pending document drops the Document review count by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const pending = api.documents.listByTenant(agency.id).find((d) => d.status === "pending");
    if (!pending) return;
    const before = alertCounts(api, agency.id);
    api.documents.update(pending.id, { status: "approved" });
    const after = alertCounts(api, agency.id);
    expect(after.documents).toBe(before.documents - 1);
  });

  it("approving an AI draft drops the AI marketing count by 1", async () => {
    const { api } = await import("../../../lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const out = api.marketing.draftDocRequest({
      tenantId: agency.id,
      customerId: customer.id,
      missingDocuments: ["X"],
    });
    if (!out) return;
    const before = alertCounts(api, agency.id);
    // Discarding one of the two drafts created above drops the
    // count by exactly 1.
    api.marketing.approveMessage(out.email.id);
    const after = alertCounts(api, agency.id);
    expect(after.marketing).toBe(before.marketing - 1);
  });
});
