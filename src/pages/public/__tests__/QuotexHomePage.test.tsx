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
});
