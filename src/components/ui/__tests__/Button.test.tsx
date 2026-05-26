// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { Button } from "../Button";

// =====================================================================
// Anchors the unified button presets. If any (variant, size) pair
// drifts, downstream cards (Assets / Policies / Documents …) start
// rendering different-looking buttons again — exactly what this
// component exists to prevent.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function classOf(jsx: React.ReactNode): string {
  act(() => {
    root.render(<MemoryRouter>{jsx}</MemoryRouter>);
  });
  const el = container.firstElementChild as HTMLElement;
  return el.className;
}

describe("Button", () => {
  it("size=xs adds the compact text + padding overrides", () => {
    const cls = classOf(<Button size="xs">View</Button>);
    expect(cls).toContain("!text-[11px]");
    expect(cls).toContain("!px-2.5");
    expect(cls).toContain("!py-1");
  });

  it("size=sm uses text-xs + tighter padding", () => {
    const cls = classOf(<Button size="sm">View</Button>);
    expect(cls).toContain("!text-xs");
    expect(cls).toContain("!px-3");
    expect(cls).toContain("!py-1.5");
  });

  it("size=md leaves the .btn base sizing untouched", () => {
    const cls = classOf(<Button size="md">Save</Button>);
    expect(cls).not.toContain("!text-");
    expect(cls).not.toContain("!px-");
  });

  it("each variant maps to the matching .btn-* class", () => {
    expect(classOf(<Button variant="outline">x</Button>)).toContain("btn-outline");
    expect(classOf(<Button variant="primary">x</Button>)).toContain("btn-primary");
    expect(classOf(<Button variant="gold">x</Button>)).toContain("btn-gold");
    expect(classOf(<Button variant="ghost">x</Button>)).toContain("btn-ghost");
  });

  it("renders a <button> when no `to` or `href` is given", () => {
    act(() => {
      root.render(<Button>Click</Button>);
    });
    expect(container.firstElementChild?.tagName).toBe("BUTTON");
  });

  it("renders a react-router <a> when `to` is provided", () => {
    act(() => {
      root.render(
        <MemoryRouter>
          <Button to="/foo">x</Button>
        </MemoryRouter>
      );
    });
    const el = container.firstElementChild as HTMLAnchorElement;
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/foo");
  });

  it("renders a plain <a> when `href` is provided", () => {
    act(() => {
      root.render(<Button href="https://example.com">x</Button>);
    });
    const el = container.firstElementChild as HTMLAnchorElement;
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("https://example.com");
  });

  it("Assets-card and Policies-card View buttons resolve to the same class string", () => {
    // The exact inconsistency the standardization fixes. Both call
    // sites used to render slightly-different sizing — now they
    // share one source of truth.
    const aCls = classOf(
      <Button size="xs" to="/employee/clients/c/assets/a">
        View
      </Button>
    );
    const pCls = classOf(
      <Button size="xs" to="/employee/policies/p">
        View
      </Button>
    );
    expect(aCls).toBe(pCls);
  });
});