import { describe, expect, it } from "vitest";
import {
  canAccessAgencyStateForAuth,
  mergeCustomerSnapshotIntoPlatform,
  mergeStateSnapshotForAuth,
  mergeTenantSnapshotIntoPlatform,
  scopeStateSnapshotForAuth,
  scopeSnapshotToTenant,
  stateScopeForAuth,
} from "../services/stateSnapshotScope.js";

describe("state snapshot tenant scoping", () => {
  it("returns only the tenant slice plus global carrier/category catalogs", () => {
    const scoped = scopeSnapshotToTenant(platformSnapshot(), "agency_a") as any;

    expect(scoped.agencies.map((row: any) => row.id)).toEqual(["agency_a"]);
    expect(scoped.users.map((row: any) => row.id)).toEqual(["user_a", "user_a_unreferenced"]);
    expect(scoped.customers.map((row: any) => row.id)).toEqual(["customer_a"]);
    expect(scoped.assets.map((row: any) => row.id)).toEqual(["asset_a"]);
    expect(scoped.policies.map((row: any) => row.id)).toEqual(["policy_a"]);
    expect(scoped.communications.map((row: any) => row.id)).toEqual(["communication_a"]);
    expect(scoped.tasks.map((row: any) => row.id)).toEqual(["task_a"]);
    expect(scoped.carriers.map((row: any) => row.id)).toEqual(["carrier_1"]);
    expect(scoped.categories.map((row: any) => row.id)).toEqual(["category_1"]);
    expect(scoped.softwareSales).toEqual([]);
    expect(scoped.masterAgencyActivities).toEqual([]);
  });

  it("does not traverse shared catalog references into another agency", () => {
    const snapshot = platformSnapshot();

    const scoped = scopeSnapshotToTenant(snapshot, "agency_a") as any;

    expect(scoped.customers.map((row: any) => row.id)).toEqual(["customer_a"]);
    expect(scoped.users.map((row: any) => row.id)).toEqual(["user_a", "user_a_unreferenced"]);
  });

  it("denies customer roles access to agency snapshots", () => {
    const customerAuth = {
      userId: "customer_user_a",
      role: "customer",
      tenantId: "agency_a",
      permissions: [],
    };

    expect(stateScopeForAuth(customerAuth)).toBe("customer");
    expect(canAccessAgencyStateForAuth(customerAuth)).toBe(false);
  });

  it("returns only the authenticated customer's records and safe agency staff projections", () => {
    const scoped = scopeStateSnapshotForAuth(platformSnapshot(), {
      userId: "customer_user_a",
      role: "customer",
      tenantId: "agency_a",
      permissions: [],
    }).snapshot as any;

    expect(scoped.customers.map((row: any) => row.id)).toEqual(["customer_a"]);
    expect(scoped.assets.map((row: any) => row.id)).toEqual(["asset_a"]);
    expect(scoped.communications.map((row: any) => row.id)).toEqual(["communication_a"]);
    expect(scoped.tasks).toEqual([]);
    expect(scoped.users.map((row: any) => row.id)).toEqual(["user_a", "user_a_unreferenced"]);
    expect(scoped.users.every((row: any) => row.email === undefined)).toBe(true);
  });

  it("allows a customer message while preserving staff and other-customer records", () => {
    const merged = mergeCustomerSnapshotIntoPlatform(
      platformSnapshot(),
      {
        communications: [
          {
            id: "communication_customer_reply",
            tenantId: "agency_a",
            customerId: "customer_a",
            body: "Customer reply",
          },
          {
            id: "communication_forged",
            tenantId: "agency_b",
            customerId: "customer_b",
            body: "Must be rejected",
          },
        ],
      },
      "agency_a",
      "customer_a"
    ) as any;

    expect(merged.communications.map((row: any) => row.id)).toEqual([
      "communication_a",
      "communication_b",
      "communication_customer_reply",
    ]);
    expect(merged.communications.find((row: any) => row.id === "communication_customer_reply")).toMatchObject({
      tenantId: "agency_a",
      customerId: "customer_a",
    });
  });

  it("rejects a forged customer tombstone", () => {
    const merged = mergeCustomerSnapshotIntoPlatform(
      platformSnapshot(),
      {
        deletedRows: [
          {
            id: "delete_other_customer_message",
            tenantId: "agency_b",
            table: "communications",
            rowId: "communication_b",
            deletedAt: "2026-07-16T12:00:00.000Z",
          },
        ],
      },
      "agency_a",
      "customer_a"
    ) as any;

    expect(merged.communications).toEqual(platformSnapshot().communications);
  });

  it("preserves omitted tenant rows while upserting authorized rows", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      {
        customers: [
          { id: "customer_a_new", tenantId: "agency_a", name: "New A" },
          { id: "customer_b", tenantId: "agency_b", name: "Malicious overwrite" },
        ],
        assets: [{ id: "asset_a_new", tenantId: "agency_a", customerId: "customer_a_new", label: "New A asset" }],
        categories: [{ id: "category_1", label: "Tenant should not rewrite global catalog" }],
      },
      "agency_a"
    ) as any;

    expect(merged.customers).toEqual([
      { id: "customer_a", userId: "customer_user_a", tenantId: "agency_a", categoryId: "category_1", name: "Customer A" },
      { id: "customer_b", userId: "customer_user_b", tenantId: "agency_b", categoryId: "category_1", name: "Customer B" },
      { id: "customer_a_new", tenantId: "agency_a", name: "New A" },
    ]);
    expect(merged.assets).toEqual([
      { id: "asset_a", tenantId: "agency_a", customerId: "customer_a", label: "A asset" },
      { id: "asset_b", tenantId: "agency_b", customerId: "customer_b", label: "B asset" },
      { id: "asset_a_new", tenantId: "agency_a", customerId: "customer_a_new", label: "New A asset" },
    ]);
    expect(merged.categories).toEqual([{ id: "category_1", label: "Global category" }]);
    expect(merged.softwareSales).toEqual([{ id: "sale_1", agencyName: "Platform-only" }]);
  });

  it("preserves omitted customers and communications", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      { tasks: [{ id: "task_a", tenantId: "agency_a", title: "Updated task" }] },
      "agency_a"
    ) as any;

    expect(merged.customers).toEqual(platformSnapshot().customers);
    expect(merged.communications).toEqual(platformSnapshot().communications);
  });

  it("deletes a tenant row only with an explicit matching tombstone", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      {
        deletedRows: [
          {
            id: "delete_customer_a",
            tenantId: "agency_a",
            table: "customers",
            rowId: "customer_a",
            deletedAt: "2026-07-16T12:00:00.000Z",
          },
        ],
      },
      "agency_a"
    ) as any;

    expect(merged.customers.map((row: any) => row.id)).toEqual(["customer_b"]);
    expect(merged.deletedRows).toContainEqual(
      expect.objectContaining({ tenantId: "agency_a", table: "customers", rowId: "customer_a" })
    );
  });

  it("rejects a tombstone for a different tenant", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      {
        deletedRows: [
          {
            id: "delete_customer_b",
            tenantId: "agency_b",
            table: "customers",
            rowId: "customer_b",
            deletedAt: "2026-07-16T12:00:00.000Z",
          },
        ],
      },
      "agency_a"
    ) as any;

    expect(merged.customers).toEqual(platformSnapshot().customers);
    expect(merged.deletedRows ?? []).toEqual([]);
  });

  it("rejects a cross-tenant id collision", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      {
        customers: [{ id: "customer_b", tenantId: "agency_a", name: "Collision" }],
      },
      "agency_a"
    ) as any;

    expect(merged.customers).toEqual(platformSnapshot().customers);
  });

  it("rejects a tenant communication that references another tenant's customer", () => {
    const merged = mergeTenantSnapshotIntoPlatform(
      platformSnapshot(),
      {
        communications: [
          {
            id: "communication_cross_tenant",
            tenantId: "agency_a",
            customerId: "customer_b",
            body: "Must not cross agency boundaries",
          },
        ],
      },
      "agency_a"
    ) as any;

    expect(merged.communications).toEqual(platformSnapshot().communications);
  });

  it("merges platform writes non-destructively", () => {
    const merged = mergeStateSnapshotForAuth(
      platformSnapshot(),
      {
        customers: [{ id: "customer_a", tenantId: "agency_a", name: "Updated A" }],
      },
      {
        userId: "master",
        role: "platform_admin",
        tenantId: null,
        permissions: [],
      }
    ) as any;

    expect(merged.customers).toEqual([
      { id: "customer_a", userId: "customer_user_a", tenantId: "agency_a", categoryId: "category_1", name: "Updated A" },
      { id: "customer_b", userId: "customer_user_b", tenantId: "agency_b", categoryId: "category_1", name: "Customer B" },
    ]);
    expect(merged.communications).toEqual(platformSnapshot().communications);
  });
});

function platformSnapshot() {
  return {
    agencies: [
      { id: "agency_a", name: "Agency A" },
      { id: "agency_b", name: "Agency B" },
    ],
    users: [
      { id: "user_a", tenantId: "agency_a", email: "a@example.test", name: "Agent A" },
      { id: "user_a_unreferenced", tenantId: "agency_a", email: "a2@example.test", name: "CSR A" },
      { id: "user_b", tenantId: "agency_b", email: "b@example.test" },
      { id: "master", tenantId: null, email: "master@example.test" },
    ],
    customers: [
      { id: "customer_a", userId: "customer_user_a", tenantId: "agency_a", categoryId: "category_1", name: "Customer A" },
      { id: "customer_b", userId: "customer_user_b", tenantId: "agency_b", categoryId: "category_1", name: "Customer B" },
    ],
    assets: [
      { id: "asset_a", tenantId: "agency_a", customerId: "customer_a", label: "A asset" },
      { id: "asset_b", tenantId: "agency_b", customerId: "customer_b", label: "B asset" },
    ],
    policies: [
      { id: "policy_a", tenantId: "agency_a", customerId: "customer_a", assetId: "asset_a" },
      { id: "policy_b", tenantId: "agency_b", customerId: "customer_b", assetId: "asset_b" },
    ],
    communications: [
      { id: "communication_a", tenantId: "agency_a", customerId: "customer_a", body: "A" },
      { id: "communication_b", tenantId: "agency_b", customerId: "customer_b", body: "B" },
    ],
    tasks: [
      { id: "task_a", tenantId: "agency_a", customerId: "customer_a", title: "A" },
      { id: "task_b", tenantId: "agency_b", customerId: "customer_b", title: "B" },
    ],
    carriers: [{ id: "carrier_1", name: "Carrier" }],
    categories: [{ id: "category_1", label: "Global category" }],
    softwareSales: [{ id: "sale_1", agencyName: "Platform-only" }],
    masterAgencyActivities: [{ id: "activity_1", agencyId: "agency_a", title: "Master only" }],
  };
}
