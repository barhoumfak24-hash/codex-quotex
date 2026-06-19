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

describe("QuotexHomePage demo picker", () => {
  it("opens directly to demo choices and marks every demo link as returnable", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/?demoPicker=1"]}>
          <Routes>
            <Route path="/" element={<QuotexHomePage />} />
          </Routes>
        </MemoryRouter>
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Choose a demo to view now.");

    const links = Array.from(container.querySelectorAll("a"));
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/employee?demoBack=1");
    expect(hrefs).toContain("/agency?demoBack=1");
    expect(hrefs).toContain("/agency-app?demoBack=1");
    expect(hrefs).toContain("/checkout?demoBack=1");
  });
});
