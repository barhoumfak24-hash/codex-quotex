// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { ActivityQuickList, NotificationsList } from "../EmployeeDashboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.localStorage.clear();
  db.reset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("dashboard activity dismissal", () => {
  it("dismisses an activity notification without deleting the activity", () => {
    const agency = api.agencies.list()[0]!;
    const user = api.users.list(agency.id)[0]!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Keep the underlying activity",
      assignedToId: user.id,
    });
    const onChanged = vi.fn();

    act(() => {
      root.render(
        <MemoryRouter>
          <NotificationsList
            tenantId={agency.id}
            userId={user.id}
            visibleCustomerIds={new Set()}
            onChanged={onChanged}
          />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain("Keep the underlying activity");
    const dismissButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss activity notification"]'
    );
    expect(dismissButton).not.toBeNull();

    act(() => dismissButton!.click());

    expect(api.tasks.get(task.id)).toMatchObject({
      id: task.id,
      dashboardDismissedByUserIds: [user.id],
    });
    expect(api.tasks.listOpen(agency.id).some((item) => item.id === task.id)).toBe(true);
    expect(container.textContent).not.toContain("Keep the underlying activity");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("dismisses an activity from one user's dashboard without deleting it", () => {
    const agency = api.agencies.list()[0]!;
    const user = api.users.list(agency.id)[0]!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Dismiss me from this dashboard",
      assignedToId: user.id,
    });
    const onChanged = vi.fn();
    const confirm = vi.spyOn(window, "confirm");

    act(() => {
      root.render(
        <MemoryRouter>
          <ActivityQuickList
            notifications={[]}
            tasks={[task]}
            routingProspects={[]}
            routingClients={[]}
            routingTasks={[]}
            maxRows={5}
            userId={user.id}
            onChanged={onChanged}
          />
        </MemoryRouter>
      );
    });

    expect(container.textContent).toContain("Dismiss me from this dashboard");
    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss from dashboard"]'
    );
    expect(removeButton).not.toBeNull();

    act(() => removeButton!.click());

    expect(confirm).not.toHaveBeenCalled();
    expect(api.tasks.get(task.id)).toMatchObject({
      id: task.id,
      dashboardDismissedByUserIds: [user.id],
    });
    expect(api.tasks.listOpen(agency.id).some((item) => item.id === task.id)).toBe(true);
    expect(container.textContent).not.toContain("Dismiss me from this dashboard");
    expect(container.textContent).toContain("All caught up");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the scrolling panel stationary while dismissing a row", () => {
    const agency = api.agencies.list()[0]!;
    const user = api.users.list(agency.id)[0]!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Delete without moving the page",
      assignedToId: user.id,
    });
    container.style.overflowY = "auto";
    container.scrollTop = 240;
    const onChanged = vi.fn(() => {
      container.scrollTop = 0;
    });

    act(() => {
      root.render(
        <MemoryRouter>
          <ActivityQuickList
            notifications={[]}
            tasks={[task]}
            routingProspects={[]}
            routingClients={[]}
            routingTasks={[]}
            maxRows={5}
            userId={user.id}
            onChanged={onChanged}
          />
        </MemoryRouter>
      );
    });

    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss from dashboard"]'
    );
    const stableRegion = container.querySelector<HTMLElement>(
      "[data-stable-removal-region]"
    );
    expect(removeButton).not.toBeNull();
    expect(stableRegion).not.toBeNull();
    vi.spyOn(stableRegion!, "getBoundingClientRect").mockReturnValue({
      bottom: 180,
      height: 180,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => removeButton!.click());

    expect(container.scrollTop).toBe(240);
    expect(stableRegion!.style.minHeight).toBe("180px");
    expect(container.textContent).not.toContain("Delete without moving the page");
    expect(api.tasks.get(task.id)).toBeDefined();
  });

  it("keeps a dismissed activity hidden after remounting for the same user", () => {
    const agency = api.agencies.list()[0]!;
    const users = api.users.list(agency.id);
    const user = users[0]!;
    const otherUser = users[1] ?? api.users.create({
      tenantId: agency.id,
      name: "Other Staff",
      firstName: "Other",
      lastName: "Staff",
      email: "other-dashboard-user@example.com",
      role: "agent",
    });
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Still in the Activity Center",
      assignedToId: user.id,
    });

    api.tasks.dismissFromDashboard(task.id, user.id);
    const persistedTask = api.tasks.get(task.id)!;

    act(() => {
      root.render(
        <MemoryRouter>
          <ActivityQuickList
            notifications={[]}
            tasks={[persistedTask]}
            routingProspects={[]}
            routingClients={[]}
            routingTasks={[]}
            maxRows={5}
            userId={user.id}
            onChanged={vi.fn()}
          />
        </MemoryRouter>
      );
    });
    expect(container.textContent).not.toContain("Still in the Activity Center");

    act(() => {
      root.render(
        <MemoryRouter>
          <ActivityQuickList
            notifications={[]}
            tasks={[persistedTask]}
            routingProspects={[]}
            routingClients={[]}
            routingTasks={[]}
            maxRows={5}
            userId={otherUser.id}
            onChanged={vi.fn()}
          />
        </MemoryRouter>
      );
    });
    expect(container.textContent).toContain("Still in the Activity Center");
    expect(api.tasks.get(task.id)).toBeDefined();
  });
});
