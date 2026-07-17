// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agency, User } from "@/types";
import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { EmployeeQuoteFlowWorkspacePage } from "../EmployeeQuoteFlowWorkspacePage";

const context = vi.hoisted(() => ({
  agency: null as Agency | null,
  user: null as User | null,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: context.user }),
}));

vi.mock("@/lib/tenant", () => ({
  useTenant: () => ({ agency: context.agency }),
}));

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  db.reset();
  context.agency = api.agencies.list()[0];
  context.user = api.users.list(context.agency.id).find((user) => user.role === "agent") ?? null;
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => undefined;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("EmployeeQuoteFlowWorkspacePage", () => {
  it("renders a routed client workspace with profile navigation and an inline step rail", async () => {
    const customer = api.customers.list(context.agency!.id)[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root: Root;

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={[`/employee/clients/${customer.id}/quote-flow`]}>
          <Routes>
            <Route
              path="/employee/clients/:customerId/quote-flow"
              element={<EmployeeQuoteFlowWorkspacePage />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(host.querySelector("h1")?.textContent).toBe("AI Quoting Workspace");
    expect(host.textContent).toContain(customer.name);
    expect(
      host.querySelector('button[aria-label="Back to profile"]')?.textContent
    ).toContain("Back to profile");
    expect(host.querySelector('aside[aria-label^="Quote workflow steps"]')).toBeTruthy();
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      root!.unmount();
    });
    host.remove();
  });

  it("returns to the exact client profile on the first pointer press", async () => {
    const customer = api.customers.list(context.agency!.id)[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root: Root;
    let currentPath = "";

    function ProfileDestination() {
      const location = useLocation();
      currentPath = location.pathname;
      return <div>Client profile destination</div>;
    }

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={[`/employee/clients/${customer.id}/quote-flow`]}>
          <Routes>
            <Route
              path="/employee/clients/:customerId/quote-flow"
              element={<EmployeeQuoteFlowWorkspacePage />}
            />
            <Route
              path="/employee/clients/:customerId"
              element={<ProfileDestination />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    const backButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Back to profile")
    );
    expect(backButton).toBeTruthy();

    await act(async () => {
      backButton!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          cancelable: true,
        })
      );
    });

    expect(currentPath).toBe(`/employee/clients/${customer.id}`);
    expect(host.textContent).toContain("Client profile destination");

    await act(async () => {
      root!.unmount();
    });
    host.remove();
  });

  it("supports keyboard activation without navigating twice", async () => {
    const customer = api.customers.list(context.agency!.id)[0];
    const host = document.createElement("div");
    document.body.appendChild(host);
    let root: Root;
    let profileRenderCount = 0;

    function ProfileDestination() {
      profileRenderCount += 1;
      return <div>Client profile destination</div>;
    }

    await act(async () => {
      root = createRoot(host);
      root.render(
        <MemoryRouter initialEntries={[`/employee/clients/${customer.id}/quote-flow`]}>
          <Routes>
            <Route
              path="/employee/clients/:customerId/quote-flow"
              element={<EmployeeQuoteFlowWorkspacePage />}
            />
            <Route
              path="/employee/clients/:customerId"
              element={<ProfileDestination />}
            />
          </Routes>
        </MemoryRouter>
      );
    });

    const backButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to profile"]'
    );
    expect(backButton).toBeTruthy();

    await act(async () => {
      backButton!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(host.textContent).toContain("Client profile destination");
    expect(profileRenderCount).toBe(1);

    await act(async () => {
      root!.unmount();
    });
    host.remove();
  });
});
