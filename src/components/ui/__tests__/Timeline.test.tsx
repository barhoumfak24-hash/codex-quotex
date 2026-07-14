// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import type { StatusEvent } from "@/types";
import { db } from "@/lib/db";
import { Timeline } from "../Timeline";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
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

  it("opens quote activity remarks to the AI quoting workspace", () => {
    const event: StatusEvent = {
      ...makeEvent(1),
      message: "Activity resolved: 2345 quote options ready.",
      customerId: "customer_2345",
      quoteSessionId: "quote_session_1",
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/employee/clients/customer_2345#client-remarks"]}>
          <Timeline events={[event]} />
        </MemoryRouter>
      );
    });

    const timelineButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Activity resolved: 2345 quote options ready.")
    ) as HTMLButtonElement;
    expect(timelineButton).toBeTruthy();

    act(() => {
      timelineButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link?.textContent).toContain("Open to AI quoting workspace");
    expect(link?.getAttribute("href")).toBe(
      "/employee/clients/customer_2345?quoteWorkspace=expanded"
    );
  });

  it("hides the same-page client fallback so the modal does not show a dead button", () => {
    const event: StatusEvent = {
      ...makeEvent(1),
      message: "Activity resolved: profile reviewed.",
      customerId: "customer_2345",
    };

    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/employee/clients/customer_2345#client-remarks"]}>
          <Timeline events={[event]} />
        </MemoryRouter>
      );
    });

    const timelineButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Activity resolved: profile reviewed.")
    ) as HTMLButtonElement;
    expect(timelineButton).toBeTruthy();

    act(() => {
      timelineButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Open to client");
  });

  it("opens provider-synced inbound email remarks in the real email app", async () => {
    const { api } = await import("@/lib/api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.users.update(manager.id, {
      businessEmail: "advisor@gmail.com",
      mailProvider: "gmail",
    });

    const inbound = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: manager.id,
      externalMessageId: "gmail_timeline_msg_1",
      externalThreadId: "gmail_timeline_thread_1",
      externalUrl: "https://mail.google.com/mail/u/0/#inbox/gmail_timeline_msg_1",
      from: customer.email,
      to: ["advisor@gmail.com"],
      subject: "Updated roof photos",
      body: "I sent the roof photos over.",
      sentAt: "2026-06-05T15:30:00.000Z",
    });
    const event = api.status
      .listFor({ customerId: customer.id })
      .find((row) => row.communicationId === inbound?.id);
    expect(event).toBeTruthy();

    act(() => {
      root.render(
        <MemoryRouter initialEntries={[`/employee/clients/${customer.id}#client-remarks`]}>
          <Timeline events={[event!]} />
        </MemoryRouter>
      );
    });

    const timelineButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Email received: Updated roof photos.")
    ) as HTMLButtonElement;
    expect(timelineButton).toBeTruthy();

    act(() => {
      timelineButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const providerLink = Array.from(container.querySelectorAll("a")).find((anchor) =>
      anchor.textContent?.includes("Open in Gmail")
    ) as HTMLAnchorElement;
    expect(providerLink).toBeTruthy();
    expect(providerLink.getAttribute("href")).toBe(
      "https://mail.google.com/mail/u/0/#inbox/gmail_timeline_msg_1"
    );
  });
});
