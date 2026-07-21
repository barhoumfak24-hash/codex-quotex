// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { ActivityQuickList } from "../EmployeeDashboard";

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

describe("dashboard permanent removal", () => {
  it("removes an activity from storage and from the screen with one click", () => {
    const agency = api.agencies.list()[0]!;
    const user = api.users.list(agency.id)[0]!;
    const task = api.tasks.create({
      tenantId: agency.id,
      title: "Delete me immediately",
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

    expect(container.textContent).toContain("Delete me immediately");
    const removeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete activity"]'
    );
    expect(removeButton).not.toBeNull();

    act(() => removeButton!.click());

    expect(confirm).not.toHaveBeenCalled();
    expect(api.tasks.get(task.id)).toBeUndefined();
    expect(container.textContent).not.toContain("Delete me immediately");
    expect(container.textContent).toContain("All caught up");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps the scrolling panel stationary while removing a row", () => {
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
      'button[aria-label="Delete activity"]'
    );
    expect(removeButton).not.toBeNull();

    act(() => removeButton!.click());

    expect(container.scrollTop).toBe(240);
    expect(container.textContent).not.toContain("Delete without moving the page");
  });
});
