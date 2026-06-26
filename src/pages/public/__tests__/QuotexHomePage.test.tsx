// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QuotexHomePage } from "../QuotexHomePage";
import { db } from "@/lib/db";

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
  act(() => {
    root.unmount();
  });
  container.remove();
  window.localStorage.clear();
});

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function changeSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("QuotexHomePage walkthrough request", () => {
  it("does not expose demo-return links on the public homepage", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<QuotexHomePage />} />
          </Routes>
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("View demo");

    const links = Array.from(container.querySelectorAll("a"));
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs.every((href) => !href?.includes("?"))).toBe(true);
  });

  it("keeps the walkthrough popup swipe-scrollable while locking the page", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<QuotexHomePage />} />
          </Routes>
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const viewDemoButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View demo")
    );
    expect(viewDemoButton).toBeTruthy();

    await act(async () => {
      viewDemoButton?.click();
      await Promise.resolve();
    });

    const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
    const scrollPane = container.querySelector(".invisible-scroll-pane");

    expect(dialog).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(scrollPane?.className).toContain("overflow-y-auto");
    expect(scrollPane?.className).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(scrollPane?.className).toContain("sm:max-h-[calc(100dvh-3rem)]");
  });

  it("captures lead details before opening the software screenshots immediately", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<QuotexHomePage />} />
          </Routes>
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const viewDemoButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View demo")
    );
    expect(viewDemoButton).toBeTruthy();

    await act(async () => {
      viewDemoButton?.click();
      await Promise.resolve();
    });

    const form = container.querySelector("form");
    expect(form).toBeTruthy();

    const inputs = Array.from(form?.querySelectorAll("input") ?? []);
    const [firstName, lastName, businessEmail, agencyName, role] = inputs;
    const staffSize = form?.querySelector("select");

    await act(async () => {
      changeInput(firstName, "Abe");
      changeInput(lastName, "Fakhoury");
      changeInput(businessEmail, "abe@example.com");
      changeInput(agencyName, "Abe Insurance");
      changeInput(role, "Owner");
      if (staffSize) changeSelect(staffSize, "10-24");
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const leads = db.list("demoLeads");
    expect(leads).toHaveLength(1);
    expect(leads[0].businessEmail).toBe("abe@example.com");
    expect(container.textContent).toContain("Agency operating system");
    expect(container.textContent).toContain("Manager dashboard");
    expect(container.textContent).not.toContain("Request received");
  });

  it("gates the software photo shortcut behind the same lead form", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<QuotexHomePage />} />
          </Routes>
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    const viewPhotosButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("View photos")
    );
    expect(viewPhotosButton).toBeTruthy();

    await act(async () => {
      viewPhotosButton?.click();
      await Promise.resolve();
    });

    expect(container.querySelector("form")).toBeTruthy();
    expect(container.textContent).toContain("View the Quotex demo.");
    expect(container.querySelector("#quotex-photo-album-title")).toBeNull();
  });
});
