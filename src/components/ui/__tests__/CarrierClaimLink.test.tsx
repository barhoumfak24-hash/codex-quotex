// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { CarrierClaimLink } from "../CarrierClaimLink";

// Tell React this is a valid act-environment so the warnings about
// "not configured to support act(...)" stay out of the test output.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Minimal render-to-DOM harness — avoids pulling in @testing-library
// just for a single anchor-element contract check.

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
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

describe("CarrierClaimLink", () => {
  it("renders an <a> with the carrier's claimsUrl + target=_blank + rel=noopener noreferrer", () => {
    act(() => {
      root.render(
        <CarrierClaimLink
          tenantId="agency_palmcoast"
          customerId="customer_demo"
          carrierId="carrier_chubb"
          carrierName="Chubb Masterpiece"
          claimsUrl="https://www.chubb.com/us-en/claims.html"
        />
      );
    });
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://www.chubb.com/us-en/claims.html");
    expect(anchor!.getAttribute("target")).toBe("_blank");
    // rel must contain both noopener AND noreferrer for safe outbound nav.
    const rel = anchor!.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(anchor!.textContent).toContain("File a claim with Chubb Masterpiece");
  });

  it("logs a customer-source status event when the link is clicked, tagged with policy + asset", async () => {
    const { api } = await import("@/lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const asset = api.assets.listByCustomer(customer.id)[0];
    const policy = api.policies.listByCustomer(customer.id)[0];
    if (!asset || !policy) return;
    const before = api.status.listFor({ customerId: customer.id }).length;
    act(() => {
      root.render(
        <CarrierClaimLink
          tenantId={agency.id}
          customerId={customer.id}
          carrierId="carrier_chubb"
          carrierName="Chubb Masterpiece"
          claimsUrl="https://www.chubb.com/us-en/claims.html"
          policyId={policy.id}
          assetId={asset.id}
        />
      );
    });
    const anchor = container.querySelector("a")!;
    // Suppress the actual navigation that happens on real click — we
    // only want the side-effect (the status-event insertion).
    act(() => {
      anchor.addEventListener("click", (e) => e.preventDefault(), { once: true });
      anchor.click();
    });
    const after = api.status.listFor({ customerId: customer.id });
    // Click produces TWO status events: a customer-visible audit
    // crumb + an internal AI-staged follow-up notice for the agent.
    expect(after.length).toBe(before + 2);
    const customerEvent = after.find((e) => e.source === "customer")!;
    expect(customerEvent.visibility).toBe("customer_visible");
    expect(customerEvent.policyId).toBe(policy.id);
    expect(customerEvent.assetId).toBe(asset.id);
    expect(customerEvent.message).toMatch(/Opened Chubb Masterpiece's claim intake/);
    expect(customerEvent.message).toContain("https://www.chubb.com/us-en/claims.html");
    const agentEvent = after.find((e) => e.source === "ai")!;
    expect(agentEvent.visibility).toBe("internal");
    expect(agentEvent.message).toMatch(/AI staged a follow-up email/);
  });

  it("uses the custom label prop when provided", () => {
    act(() => {
      root.render(
        <CarrierClaimLink
          tenantId="t"
          customerId="c"
          carrierId="x"
          carrierName="Whoever"
          claimsUrl="https://example.com/claims"
          label="File"
          variant="compact"
        />
      );
    });
    const anchor = container.querySelector("a")!;
    expect(anchor.textContent).toContain("File");
    expect(anchor.textContent).not.toContain("File a claim with");
  });
});