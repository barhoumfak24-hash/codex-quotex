// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientQuotingCard } from "../ClientQuotingCard";

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../../../lib/db");
  db.reset();
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => undefined;
  }
  vi.spyOn(window.HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

function buttons(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button"));
}

function buttonByText(container: HTMLElement, pattern: RegExp) {
  const match = buttons(container).find((button) => pattern.test(button.textContent ?? ""));
  expect(match?.textContent).toBeTruthy();
  return match as HTMLButtonElement;
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function openAiWorkspace(host: HTMLElement) {
  await click(buttonByText(host, /(Start|Continue) quote flow/i));
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("AI quoting workspace");
}

async function renderClientQuotingCard(
  setup?: (ctx: {
    api: typeof import("../../../lib/api").api;
    agency: ReturnType<typeof import("../../../lib/api").api.agencies.list>[number];
    agent: ReturnType<typeof import("../../../lib/api").api.users.list>[number];
    customer: ReturnType<typeof import("../../../lib/api").api.customers.list>[number];
  }) => Promise<void> | void
) {
  const { api } = await import("../../../lib/api");
  const agency = api.agencies.list()[0];
  const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
  const customer = api.customers.list(agency.id)[0];
  await setup?.({ api, agency, agent, customer });
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  let currentLocation = "";

  function LocationProbe() {
    const location = useLocation();
    currentLocation = `${location.pathname}${location.search}${location.hash}`;
    return null;
  }

  await act(async () => {
    root = createRoot(host);
    root.render(
      <MemoryRouter initialEntries={[`/employee/clients/${customer.id}`]}>
        <LocationProbe />
        <ClientQuotingCard
          tenantId={agency.id}
          userId={agent.id}
          customer={customer}
        />
      </MemoryRouter>
    );
  });

  return { api, agency, customer, host, root: root!, getLocation: () => currentLocation };
}

describe("AiQuotingWorkspace component", () => {
  it("keeps the full-screen quote flow reload-safe by marking the client route while open", async () => {
    const { host, root, getLocation } = await renderClientQuotingCard();

    await openAiWorkspace(host);

    expect(getLocation()).toContain("quoteWorkspace=expanded");

    await click(buttonByText(host, /Back to profile/i));

    expect(getLocation()).not.toContain("quoteWorkspace=expanded");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps the workspace expanded after Start quote flow creates a commercial session", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));

    expect(host.textContent).not.toContain("Setup incomplete");
    expect(host.textContent).not.toContain("Setup status");

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    expect(acordButton?.textContent).toMatch(/ACORD/i);
    await click(acordButton as HTMLButtonElement);

    const startButton = buttonByText(host, /Start quote flow/i);
    expect(startButton.disabled).toBe(false);
    await click(startButton);

    expect(api.quoting.getForCustomer(customer.id)?.lineOfBusiness).toBe("commercial");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("AI quoting workspace");
    expect(host.textContent).toContain("Map known data onto the selected ACORD document");
    expect(host.textContent).toContain("ACORD application workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("shows optional asset creation controls for commercial setup", async () => {
    const { host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));

    const dialogText = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toContain("Asset (optional)");
    expect(dialogText).toContain("Create new asset");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("moves setup into the AI mapping loading page while the start request is still running", async () => {
    const { api, host, root } = await renderClientQuotingCard();
    vi.spyOn(api.quoting, "startSession").mockImplementation(
      () =>
        new Promise<Awaited<ReturnType<typeof api.quoting.startSession>>>(() => {
          /* Keep the request pending so the transition state can be asserted. */
        })
    );

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);
    await click(buttonByText(host, /Start quote flow/i));

    const dialogText = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toContain("AI mapping in progress");
    expect(dialogText).toContain("Map known data for the selected asset");
    expect(dialogText).toContain("Step 2 of");
    expect(dialogText).not.toContain("Researching questionnaire");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("does not expose raw AI gateway timeout diagnostics in the workspace", async () => {
    const { host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("quotex-ai-gateway-failure", {
          detail: {
            path: "/ai/acord-map",
            status: 504,
            message:
              "An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT cle1::9vmpk-1783025119970-cd8433426528",
            error: "FUNCTION_INVOCATION_TIMEOUT",
          },
        })
      );
      await Promise.resolve();
    });

    expect(host.textContent).not.toContain("FUNCTION_INVOCATION_TIMEOUT");
    expect(host.textContent).not.toContain("Status 504");
    expect(host.textContent).not.toContain("AI mapping could not complete");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("advances commercial steps without collapsing the active workspace", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);
    await click(buttonByText(host, /Start quote flow/i));

    const remapSpy = vi.spyOn(api.quoting, "runAcordAiMapping");
    await click(buttonByText(host, /^Next$/i));

    expect(remapSpy).toHaveBeenCalledWith(api.quoting.getForCustomer(customer.id)?.id);
    expect(api.quoting.getForCustomer(customer.id)?.commercialQuestionnairePreparedAt).toBeTruthy();
    expect(host.textContent).toContain("Review the ACORD and handle the remaining fields");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Workflow");
    expect(
      host.querySelector<HTMLIFrameElement>("#commercial-acord-workspace iframe")?.src
    ).toContain("/acord/");
    expect(host.querySelector("#commercial-acord-workspace object")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("advances personal questionnaire review without rerunning AI mapping", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard(
      async ({ api, agency, agent, customer }) => {
        const asset = api.assets.listByCustomer(customer.id).find((item) => item.type === "coastal_home");
        await api.quoting.startSession({
          tenantId: agency.id,
          customerId: customer.id,
          assetId: asset?.id,
          createdById: agent.id,
          assetType: asset?.type ?? "coastal_home",
          contactName: customer.name,
          estimatedValue: asset?.estimatedValue ?? 1_500_000,
          address: customer.mailingAddress,
          lineOfBusiness: "personal",
        });
      }
    );

    await openAiWorkspace(host);

    const remapSpy = vi.spyOn(api.quoting, "runAcordAiMapping");
    await click(buttonByText(host, /^Next$/i));

    expect(remapSpy).not.toHaveBeenCalled();
    expect(api.quoting.getForCustomer(customer.id)?.personalQuestionnairePreparedAt).toBeTruthy();
    expect(host.textContent).toContain("Review and send the personal-lines questionnaire");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps AI questionnaire source evidence hidden from the visible questionnaire", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard(
      async ({ api, agency, agent, customer }) => {
        const asset = api.assets.listByCustomer(customer.id).find((item) => item.type === "coastal_home");
        await api.quoting.startSession({
          tenantId: agency.id,
          customerId: customer.id,
          assetId: asset?.id,
          createdById: agent.id,
          assetType: asset?.type ?? "coastal_home",
          contactName: customer.name,
          estimatedValue: asset?.estimatedValue ?? 1_500_000,
          address: customer.mailingAddress,
          assetDetails: {
            yearBuilt: "2018",
            squareFootage: "4200",
            roofMaterial: "Metal",
          },
          lineOfBusiness: "personal",
        });
      }
    );

    await openAiWorkspace(host);
    await click(buttonByText(host, /^Next$/i));
    await click(buttonByText(host, /Edit manually/i));

    expect(api.quoting.getForCustomer(customer.id)?.questionnaireResponseMeta).toBeTruthy();
    expect(host.textContent).toContain("Last edited by QuoteX AI");
    expect(host.textContent).not.toContain("Source:");
    expect(host.textContent).not.toContain("QuoteX intake");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("leaves ACORD review after sending the commercial application package", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);
    await click(buttonByText(host, /Start quote flow/i));
    await click(buttonByText(host, /^Next$/i));
    await click(buttonByText(host, /^Next$/i));
    await click(buttonByText(host, /Proceed anyway/i));

    const carrierSendButton = buttons(host).find((button) =>
      /View email draft|Send selected carriers/i.test(button.textContent ?? "")
    );
    expect(carrierSendButton?.textContent).toBeTruthy();
    await click(carrierSendButton as HTMLButtonElement);
    expect(host.querySelectorAll('[role="dialog"]').length).toBeGreaterThanOrEqual(1);

    const draftSendButton = buttons(host).find((button) =>
      /Send to selected carriers/i.test(button.textContent ?? "")
    );
    if (draftSendButton) {
      await click(draftSendButton as HTMLButtonElement);
    }

    const session = api.quoting.getForCustomer(customer.id);
    expect(session?.commercialApplicationSentAt).toBeTruthy();
    expect(host.textContent).not.toContain("Review the ACORD and handle the remaining fields");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("AI quoting workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
