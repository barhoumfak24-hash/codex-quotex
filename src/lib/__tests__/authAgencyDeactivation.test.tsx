// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth";
import { api } from "../api";
import { db } from "../db";
import { forgetServerSessionToken } from "../serverSession";
import type { Agency, User } from "@/types";

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  forgetServerSessionToken();
  db.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function mockCanonicalAuth(user: User, agency: Agency) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/auth/logout")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const currentAgency = api.agencies.get(agency.id) ?? agency;
    if (!currentAgency.active) {
      return new Response(JSON.stringify({ ok: false, reason: "agency_inactive" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        ok: true,
        token: "server-token",
        user: {
          id: user.id,
          tenantId: agency.id,
          branchId: user.branchId ?? null,
          role: user.role,
          email: user.email,
          name: user.name,
          agency: {
            id: agency.id,
            name: currentAgency.name,
            contactEmail: currentAgency.contactEmail,
            phone: currentAgency.phone,
            address: currentAgency.address,
            website: currentAgency.website,
            websiteSlug: currentAgency.websiteSlug,
            websiteEnabled: currentAgency.websiteEnabled,
            serviceAreas: currentAgency.serviceAreas,
            agencyCodePreview: currentAgency.agencyCodePreview,
            tier: currentAgency.tier,
            active: true,
            allowedUsers: currentAgency.allowedUsers,
            allowedProspectsPerMonth: currentAgency.allowedProspectsPerMonth,
            allowedAiMessagesPerMonth: currentAgency.allowedAiMessagesPerMonth,
            allowedCarriers: currentAgency.allowedCarriers,
            createdAt: currentAgency.createdAt,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
}

describe("agency deactivation auth guard", () => {
  it("does not crash master sign-in when localStorage is full", async () => {
    const master: User = {
      id: "master_quota_safe",
      tenantId: null,
      role: "master_admin",
      email: "founder@quotexinsurance.com",
      name: "Founder",
      generatedPassword: "",
      active: true,
      profileCompleted: true,
      createdAt: new Date().toISOString(),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          token: "server-token",
          user: {
            id: master.id,
            tenantId: null,
            role: "master_admin",
            email: master.email,
            name: master.name,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    const realSetItem = Storage.prototype.setItem;
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (this === window.localStorage) {
        throw new DOMException(`Quota exceeded for ${key}`, "QuotaExceededError");
      }
      return realSetItem.call(this, key, value);
    });

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      const signedIn = await auth!.signInMaster(master.email, "correct horse battery staple");
      expect(signedIn.ok ? signedIn.user.id : null).toBe(master.id);
    });

    expect((auth!.user as User | null)?.id).toBe(master.id);
    const { currentServerSessionToken } = await import("../serverSession");
    expect(window.localStorage.getItem("quotex.authToken")).toBeNull();
    expect(currentServerSessionToken()).toBe("server-token");

    await act(async () => {
      root?.unmount();
    });
    storageSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("keeps the server token but does not trust a cached user during a transient session throttle", async () => {
    const master: User = {
      id: "master_cached_session",
      tenantId: null,
      role: "master_admin",
      email: "founder@quotexinsurance.com",
      name: "Founder",
      generatedPassword: "",
      active: true,
      profileCompleted: true,
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem("quotex.authToken", "cached-server-token");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })
    );

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    expect(auth!.user).toBeNull();
    expect(window.localStorage.getItem("quotex.authToken")).toBe("cached-server-token");

    await act(async () => {
      root?.unmount();
    });
    fetchSpy.mockRestore();
  });

  it("signs out a cached customer session when master deactivates the agency", async () => {
    const agency = api.agencies.create({
      name: "Deactivated Access Agency",
      contactEmail: "owner@deactivated-access.example",
      phone: "517-294-2671",
      address: "",
      website: "",
      serviceAreas: [],
      tier: "minimum",
      allowedUsers: 10,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
    });
    const customer = api.users.create({
      tenantId: agency.id,
      role: "customer",
      email: "client@deactivated-access.example",
      name: "Client",
      generatedPassword: "client-password",
      profileCompleted: true,
    });
    const master = api.users.create({
      tenantId: null,
      role: "master_admin",
      email: "founder@quotexinsurance.com",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });
    const fetchSpy = mockCanonicalAuth(customer, agency);

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      const signedIn = await auth!.signInCustomer(customer.email, "client-password", agency.id);
      expect(signedIn.ok ? signedIn.user.id : null).toBe(customer.id);
    });
    expect((auth!.user as User | null)?.id).toBe(customer.id);

    await act(async () => {
      api.agencies.deactivate(agency.id, { actorId: master.id });
    });

    expect(api.agencies.get(agency.id)?.active).toBe(false);
    expect(api.agencies.list().filter((row) => !row.active).map((row) => row.id)).toContain(agency.id);

    await act(async () => {
      await auth!.signOut();
      const blocked = await auth!.signInCustomer(customer.email, "client-password", agency.id);
      expect(blocked).toEqual({ ok: false, reason: "agency_inactive" });
    });
    expect(auth!.user).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    fetchSpy.mockRestore();
  });

  it("lets original staff credentials sign in again after agency reactivation", async () => {
    const agency = api.agencies.create({
      name: "Reactivated Access Agency",
      contactEmail: "owner@reactivated-access.example",
      phone: "517-294-2671",
      address: "",
      website: "",
      serviceAreas: [],
      tier: "minimum",
      allowedUsers: 10,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
    });
    const manager = api.users.create({
      tenantId: agency.id,
      role: "manager",
      email: "manager@reactivated-access.example",
      businessEmail: "manager@reactivated-access.example",
      name: "Reactivation Manager",
      generatedPassword: "same-password-123",
      profileCompleted: true,
      staffAccessStatus: "active",
    });
    const master = api.users.create({
      tenantId: null,
      role: "master_admin",
      email: "founder@quotexinsurance.com",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });
    const fetchSpy = mockCanonicalAuth(manager, agency);

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      const signedIn = await auth!.signInStaff(manager.businessEmail!, "same-password-123");
      expect(signedIn.ok ? signedIn.user.id : null).toBe(manager.id);
    });
    expect((auth!.user as User | null)?.id).toBe(manager.id);

    await act(async () => {
      api.agencies.deactivate(agency.id, { actorId: master.id });
      await auth!.signOut();
    });
    expect(auth!.user).toBeNull();

    await act(async () => {
      const blocked = await auth!.signInStaff(manager.businessEmail!, "same-password-123");
      expect(blocked.ok).toBe(false);
    });

    await act(async () => {
      api.agencies.reactivate(agency.id, { actorId: master.id });
    });

    await act(async () => {
      const signedInAgain = await auth!.signInStaff(manager.businessEmail!, "same-password-123");
      expect(signedInAgain.ok ? signedInAgain.user.id : null).toBe(manager.id);
    });

    const restored = api.users.get(manager.id);
    expect(api.agencies.get(agency.id)?.active).toBe(true);
    expect(restored?.active).toBe(true);
    expect(restored?.staffAccessStatus).toBe("active");
    expect((auth!.user as User | null)?.id).toBe(manager.id);

    await act(async () => {
      root?.unmount();
    });
    fetchSpy.mockRestore();
  });

  it("trusts an accepted server staff session over stale inactive browser state", async () => {
    const agency = api.agencies.create({
      name: "Server Truth Agency",
      contactEmail: "owner@server-truth.example",
      phone: "517-294-2671",
      address: "",
      website: "",
      serviceAreas: [],
      tier: "minimum",
      allowedUsers: 10,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
    });
    const manager = api.users.create({
      tenantId: agency.id,
      role: "manager",
      email: "manager@server-truth.example",
      businessEmail: "manager@server-truth.example",
      name: "Server Truth Manager",
      generatedPassword: "same-password-123",
      profileCompleted: true,
      staffAccessStatus: "active",
    });
    const master = api.users.create({
      tenantId: null,
      role: "master_admin",
      email: "founder@server-truth.example",
      name: "Founder",
      generatedPassword: "correct horse battery staple",
      profileCompleted: true,
    });
    api.security.banUser({
      tenantId: agency.id,
      userId: manager.id,
      createdById: master.id,
      reason: "stale local browser state from a previous deactivation cycle",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          token: "server-token",
          user: {
            id: manager.id,
            tenantId: agency.id,
            branchId: null,
            role: "manager",
            email: manager.email,
            name: manager.name,
            agency: {
              id: agency.id,
              name: agency.name,
              contactEmail: agency.contactEmail,
              phone: agency.phone,
              address: agency.address,
              website: agency.website,
              websiteSlug: agency.websiteSlug,
              websiteEnabled: agency.websiteEnabled,
              serviceAreas: agency.serviceAreas,
              agencyCodePreview: agency.agencyCodePreview,
              tier: agency.tier,
              active: true,
              allowedUsers: agency.allowedUsers,
              allowedProspectsPerMonth: agency.allowedProspectsPerMonth,
              allowedAiMessagesPerMonth: agency.allowedAiMessagesPerMonth,
              allowedCarriers: agency.allowedCarriers,
              createdAt: agency.createdAt,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      const signedIn = await auth!.signInStaff(manager.email, "same-password-123");
      expect(signedIn.ok ? signedIn.user.id : null).toBe(manager.id);
      expect(signedIn.ok ? signedIn.user.active : false).toBe(true);
      expect(signedIn.ok ? signedIn.user.staffAccessStatus : undefined).toBe("active");
    });
    expect((auth!.user as User | null)?.id).toBe(manager.id);

    await act(async () => {
      root?.unmount();
    });
    fetchSpy.mockRestore();
  });

  it("fails closed instead of using a local plaintext password when the auth server is unreachable", async () => {
    const agency = api.agencies.create({
      name: "Server Required Agency",
      contactEmail: "owner@server-required.example",
      phone: "517-294-2671",
      address: "",
      website: "",
      serviceAreas: [],
      tier: "minimum",
      allowedUsers: 10,
      allowedProspectsPerMonth: 100,
      allowedAiMessagesPerMonth: 500,
      allowedCarriers: 10,
    });
    const manager = api.users.create({
      tenantId: agency.id,
      role: "manager",
      email: "manager@server-required.example",
      businessEmail: "manager@server-required.example",
      name: "Server Required Manager",
      generatedPassword: "local-plaintext-password",
      profileCompleted: true,
      staffAccessStatus: "active",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unavailable"));

    const harness = document.createElement("div");
    document.body.appendChild(harness);
    let root: Root | null = null;
    let auth: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      auth = useAuth();
      return null;
    }

    await act(async () => {
      root = createRoot(harness);
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      const result = await auth!.signInStaff(manager.email, "local-plaintext-password");
      expect(result).toEqual({ ok: false, reason: "server_unreachable" });
    });
    expect(auth!.user).toBeNull();

    await act(async () => {
      root?.unmount();
    });
    fetchSpy.mockRestore();
  });
});
