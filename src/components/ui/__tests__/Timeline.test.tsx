// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { StatusEvent } from "@/types";
import { Timeline } from "../Timeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function makeEvent(index: number): StatusEvent {
  return {
    id: `event_${index}`,
    tenantId: "agency_palmcoast",
    source: "agent",
    message: `Timeline update ${index}`,
    visibility: "internal",
    createdAt: new Date(2026, 5, index).toISOString(),
  };
}

describe("Timeline", () => {
  it("shows 10 entries by default and keeps older updates behind an expansion bar", () => {
    const events = Array.from({ length: 12 }, (_, i) => makeEvent(i + 1));

    act(() => {
      root.render(<Timeline events={events} />);
    });

    expect(container.textContent).toContain("Timeline update 12");
    expect(container.textContent).toContain("Timeline update 3");
    expect(container.textContent).not.toContain("Timeline update 2");
    expect(container.textContent).toContain("Show 2 older remarks");

    const toggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Show 2 older remarks")
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Timeline update 1");
    expect(container.textContent).toContain("Timeline update 2");
    expect(container.textContent).toContain("Hide older remarks");
  });
});
