// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotingSession } from "../../../types";
import { PublicFields } from "../AiQuotingWorkspace";
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
  vi.unstubAllGlobals();
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

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
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
  }) => Promise<void> | void,
  options: { standalone?: boolean; launcher?: boolean; initialEntry?: string } = {}
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
      <MemoryRouter
        initialEntries={[options.initialEntry ?? `/employee/clients/${customer.id}`]}
      >
        <LocationProbe />
        <ClientQuotingCard
          tenantId={agency.id}
          userId={agent.id}
          customer={customer}
          standalone={options.standalone}
          launcher={options.launcher}
        />
      </MemoryRouter>
    );
  });

  return { api, agency, customer, host, root: root!, getLocation: () => currentLocation };
}

describe("AiQuotingWorkspace component", () => {
  it("renders one independent AI-results box for every selected asset", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const session = {
      publicFields: {},
      selectedAssetMappings: [
        {
          assetId: "asset_home",
          label: "Primary Home",
          assetType: "coastal_home",
          estimatedValue: 0,
          publicFields: { "Year built": "2005" },
          missingFields: [],
          aiSummary: "Mapped home",
        },
        {
          assetId: "asset_auto",
          label: "2023 Test Vehicle",
          assetType: "luxury_vehicle",
          estimatedValue: 0,
          publicFields: {},
          missingFields: [],
          aiSummary: "No reliable values",
        },
      ],
    } as unknown as QuotingSession;

    await act(async () => {
      root.render(<PublicFields session={session} />);
    });

    expect(host.querySelectorAll("section")).toHaveLength(2);
    expect(host.textContent).toContain("AI-sourced values for Primary Home");
    expect(host.textContent).toContain("AI-sourced values for 2023 Test Vehicle");
    expect(host.textContent).toContain("No reliable public values were found.");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("uses a launcher on the profile and keeps the full workflow on its routed page", async () => {
    const { customer, host, root } = await renderClientQuotingCard(undefined, {
      launcher: true,
    });

    expect(host.textContent).toContain("AI Quoting Workspace");
    expect(host.textContent).toContain("Setup pending - Ready to start");
    expect(host.textContent).not.toContain("Workflow setup summary");
    expect(host.querySelector('aside[aria-label^="Quote workflow steps"]')).toBeNull();
    expect(
      host.querySelector(`a[href="/employee/clients/${customer.id}/quote-flow"]`)?.textContent
    ).toContain("Start quote flow");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("shows the live workflow steps and aligned continue action on an active quote launcher", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard(
      async ({ api, agency, agent, customer }) => {
        const asset = api.assets
          .listByCustomer(customer.id)
          .find((item) => item.type === "coastal_home");
        const session = await api.quoting.startSession({
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
        api.quoting.preparePersonalQuestionnaire(session.id);
      },
      { launcher: true }
    );

    expect(host.textContent).toContain("Setup");
    expect(host.textContent).toContain("AI mapping");
    expect(host.textContent).toContain("Questionnaire");
    expect(host.textContent).toContain("Carrier ranking");
    expect(host.textContent).toContain("Step 3 of 4");
    expect(host.querySelector('[aria-label="Questionnaire: current"]')).toBeTruthy();
    expect(
      host.querySelector(`a[href="/employee/clients/${customer.id}/quote-flow"]`)?.textContent
    ).toContain("Continue quote flow");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("renders the routed workspace inline with all commercial and personal steps", async () => {
    const { host, root } = await renderClientQuotingCard(undefined, { standalone: true });

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('aside[aria-label*="step 1 of 4"]')).toBeTruthy();
    expect(host.textContent).toContain("Carrier ranking");

    await click(buttonByText(host, /Commercial lines/i));

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('aside[aria-label*="step 1 of 6"]')).toBeTruthy();
    expect(host.textContent).toContain("Carrier send");
    expect(host.textContent).toContain("Supplementals");
    expect(host.textContent).toContain("Quote ranking");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("uses the detected field overlay for a selected ACORD template", async () => {
    const { host, root } = await renderClientQuotingCard(async ({ api, agency }) => {
      const { db } = await import("../../../lib/db");
      const template = api.documents
        .listTemplates(agency.id)
        .find((document) => /acord/i.test(`${document.fileName} ${document.documentName ?? ""}`));
      expect(template).toBeTruthy();
      db.update("documents", template!.id, {
        templateFieldLayout: [
          {
            label: "Named insured",
            page: 1,
            x: 8,
            y: 12,
            width: 35,
            height: 4,
            kind: "text",
            source: "detected",
          },
        ],
      });
    });

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));
    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);

    expect(host.textContent).toContain("Selected ACORD form");
    expect(host.textContent).not.toContain("The detected field overlay is unavailable");
    expect(host.querySelector('iframe[title^="Selected ACORD"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("links to the source ACORD PDF when no field layout is available", async () => {
    const { host, root } = await renderClientQuotingCard(async ({ api, agency }) => {
      const { db } = await import("../../../lib/db");
      api.documents
        .listTemplates(agency.id)
        .filter((document) => /acord/i.test(`${document.fileName} ${document.documentName ?? ""}`))
        .forEach((document) => db.update("documents", document.id, { templateFieldLayout: [] }));
    });

    await openAiWorkspace(host);
    await click(buttonByText(host, /Commercial lines/i));
    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);

    expect(host.textContent).toContain("The detected field overlay is unavailable");
    const fallbackLink = Array.from(host.querySelectorAll("a")).find((link) =>
      /Open the source PDF/i.test(link.textContent ?? "")
    );
    expect(fallbackLink?.getAttribute("href")).toBeTruthy();

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

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

  it("allows multiple personal-lines categories to stay selected", async () => {
    const { host, root } = await renderClientQuotingCard();

    await openAiWorkspace(host);
    await click(buttonByText(host, /Personal lines/i));
    await click(buttonByText(host, /^Primary Home/));
    await click(buttonByText(host, /^Luxury Vehicle/));

    const workspaceText = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(workspaceText).toContain("Selected: Primary Home + Luxury Vehicle");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("asks for only the asset lookup identifier when creating an asset", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();
    const existingAssetIds = new Set(api.assets.listByCustomer(customer.id).map((asset) => asset.id));
    vi.spyOn(api.assets, "upgradeVehicleLabelFromVin").mockImplementation(async () => undefined);

    await openAiWorkspace(host);
    await click(buttonByText(host, /Personal lines/i));
    await click(buttonByText(host, /^Luxury Vehicle/));
    await click(buttonByText(host, /Create new asset/i));

    const dialogText = host.querySelector('[role="dialog"]')?.textContent ?? "";
    expect(dialogText).toContain("VIN");
    expect(dialogText).not.toContain("Estimated value");
    expect(dialogText).not.toContain("Year, make, model, and stated value");
    expect(dialogText).not.toContain("Primary use");
    expect(buttonByText(host, /^Add asset$/i).disabled).toBe(true);

    const vinInput = host.querySelector<HTMLInputElement>('input[placeholder="17-character VIN"]');
    expect(vinInput).toBeTruthy();
    await typeInto(vinInput!, "1hgcm82633a004352");
    expect(buttonByText(host, /^Add asset$/i).disabled).toBe(false);
    await click(buttonByText(host, /^Add asset$/i));

    const createdAsset = api.assets
      .listByCustomer(customer.id)
      .find((asset) => !existingAssetIds.has(asset.id));
    expect(createdAsset).toMatchObject({
      type: "luxury_vehicle",
      estimatedValue: 0,
      details: { vin: "1HGCM82633A004352" },
    });
    expect(Object.keys(createdAsset?.details ?? {})).toEqual(["vin"]);

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
    const sendFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        ok: true,
        result: {
          provider: "google",
          status: "sent",
          externalMessageId: "provider-message-1",
          externalThreadId: "provider-thread-1",
        },
      }),
    });
    vi.stubGlobal("fetch", sendFetch);
    const { api, agency, customer, host, root } = await renderClientQuotingCard();
    const confirmDeliverySpy = vi.spyOn(api.quoting, "confirmCommercialCarrierDelivery");

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
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const session = api.quoting.getForCustomer(customer.id);
    expect(session?.commercialApplicationSentAt).toBeTruthy();
    expect(sendFetch).toHaveBeenCalled();
    expect(confirmDeliverySpy).toHaveBeenCalledWith(session?.id, "application");
    const messageIds = (session?.commercialCarrierSubmissions ?? []).flatMap(
      (submission) => submission.applicationMessageIds ?? []
    );
    expect(messageIds.length).toBeGreaterThan(0);
    const deliveredMessages = new Map(
      api.communications
        .listByTenant(agency.id)
        .map((communication) => [communication.id, communication])
    );
    expect(
      messageIds.every((messageId) => deliveredMessages.get(messageId)?.deliveryStatus === "sent")
    ).toBe(true);
    expect(host.textContent).not.toContain("Review the ACORD and handle the remaining fields");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("AI quoting workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("keeps ACORD review open when the mailbox provider rejects the carrier email", async () => {
    const sendFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: async () => ({ ok: false, message: "Provider unavailable" }),
    });
    vi.stubGlobal("fetch", sendFetch);
    const { api, agency, customer, host, root } = await renderClientQuotingCard();
    const markDeliveryFailedSpy = vi.spyOn(
      api.quoting,
      "markCommercialCarrierDeliveryFailed"
    );

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
    await click(buttonByText(host, /View email draft|Send selected carriers/i));
    await click(buttonByText(host, /Send to selected carriers/i));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    const session = api.quoting.getForCustomer(customer.id);
    const messageIds = (session?.commercialCarrierSubmissions ?? []).flatMap(
      (submission) => submission.applicationMessageIds ?? []
    );
    const messages = new Map(
      api.communications
        .listByTenant(agency.id)
        .map((communication) => [communication.id, communication])
    );
    expect(sendFetch).toHaveBeenCalled();
    expect(markDeliveryFailedSpy).toHaveBeenCalledWith(
      session?.id,
      "application",
      expect.any(String)
    );
    expect(messageIds.length).toBeGreaterThan(0);
    expect(messageIds.some((messageId) => messages.get(messageId)?.deliveryStatus === "failed")).toBe(
      true
    );
    expect(host.textContent).toContain("Review the ACORD and handle the remaining fields");
    expect(host.textContent).toContain(
      "The carrier email was not delivered. Check the connected mailbox and try again."
    );

    await act(async () => {
      root.unmount();
    });
    host.remove();
  }, 30_000);
});
