// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
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

async function renderClientQuotingCard() {
  const { api } = await import("../../../lib/api");
  const agency = api.agencies.list()[0];
  const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
  const customer = api.customers.list(agency.id)[0];
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;

  await act(async () => {
    root = createRoot(host);
    root.render(
      <MemoryRouter>
        <ClientQuotingCard
          tenantId={agency.id}
          userId={agent.id}
          customer={customer}
        />
      </MemoryRouter>
    );
  });

  return { api, agency, customer, host, root: root! };
}

describe("AiQuotingWorkspace component", () => {
  it("keeps the workspace expanded after Start AI Mapping creates a commercial session", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await click(buttonByText(host, /Commercial lines/i));

    expect(host.textContent).not.toContain("Setup incomplete");
    expect(host.textContent).not.toContain("Setup status");

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    expect(acordButton?.textContent).toMatch(/ACORD/i);
    await click(acordButton as HTMLButtonElement);

    const startButton = buttonByText(host, /Start AI Mapping/i);
    expect(startButton.disabled).toBe(false);
    await click(startButton);

    expect(api.quoting.getForCustomer(customer.id)?.lineOfBusiness).toBe("commercial");
    expect(host.textContent).toContain("Map known data onto the selected ACORD document");
    expect(host.textContent).not.toContain("Expand AI quoting workspace");
    expect(host.textContent).toContain("ACORD application workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("advances commercial steps without collapsing the active workspace", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await click(buttonByText(host, /Commercial lines/i));

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);
    await click(buttonByText(host, /Start AI Mapping/i));

    const remapSpy = vi.spyOn(api.quoting, "runAcordAiMapping");
    await click(buttonByText(host, /^Next$/i));

    expect(remapSpy).toHaveBeenCalledWith(api.quoting.getForCustomer(customer.id)?.id);
    expect(api.quoting.getForCustomer(customer.id)?.commercialQuestionnairePreparedAt).toBeTruthy();
    expect(host.textContent).toContain("Review the ACORD and handle the remaining fields");
    expect(host.textContent).not.toContain("Expand AI quoting workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("leaves ACORD review after sending the commercial application package", async () => {
    const { api, customer, host, root } = await renderClientQuotingCard();

    await click(buttonByText(host, /Commercial lines/i));

    const acordButton = buttons(host).find((button) =>
      /^ACORD\s+\d+/i.test((button.textContent ?? "").trim())
    );
    await click(acordButton as HTMLButtonElement);
    await click(buttonByText(host, /Start AI Mapping/i));
    await click(buttonByText(host, /^Next$/i));
    await click(buttonByText(host, /^Next$/i));
    await click(buttonByText(host, /Proceed anyway/i));

    const carrierSendButton = buttons(host).find((button) =>
      /View email draft|Send selected carriers/i.test(button.textContent ?? "")
    );
    expect(carrierSendButton?.textContent).toBeTruthy();
    await click(carrierSendButton as HTMLButtonElement);
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);

    const draftSendButton = buttons(host).find((button) =>
      /Send to selected carriers/i.test(button.textContent ?? "")
    );
    if (draftSendButton) {
      await click(draftSendButton as HTMLButtonElement);
    }

    const session = api.quoting.getForCustomer(customer.id);
    expect(session?.commercialApplicationSentAt).toBeTruthy();
    expect(host.textContent).not.toContain("Review the ACORD and handle the remaining fields");
    expect(host.textContent).not.toContain("Expand AI quoting workspace");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
