// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

async function mailboxFixture() {
  const { api } = await import("../api");
  const agency = api.agencies.list()[0];
  const customer = api.customers.list(agency.id)[0];
  const user = api.users
    .list(agency.id)
    .find((row) => row.role === "agent" || row.role === "manager" || row.role === "csr");
  if (!agency || !customer || !user) {
    throw new Error("Seed fixture is missing agency, customer, or staff user.");
  }
  return { api, agency, customer, user };
}

describe("mailbox outbox", () => {
  it("queues outbound app email and links the communication to the outbox job", async () => {
    const { api, agency, customer, user } = await mailboxFixture();

    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Coverage update",
      body: "Hi, I attached the coverage update.",
      createdById: user.id,
    });

    expect(message.deliveryStatus).toBe("queued");
    expect(message.outboxJobId).toBeTruthy();

    const jobs = api.mailboxOutbox.listByTenant(agency.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].communicationId).toBe(message.id);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].to).toEqual([customer.email.toLowerCase()]);
    expect(jobs[0].idempotencyKey).toBe(`communication:${agency.id}:${message.id}`);
  });

  it("marks a queued email sent with provider metadata", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Quote ready",
      body: "Your quote is ready.",
      createdById: user.id,
    });
    const job = api.mailboxOutbox.get(message.outboxJobId!);
    expect(job).toBeTruthy();

    const sent = api.mailboxOutbox.markSent(job!.id, {
      externalMessageId: "gmail-message-1",
      externalThreadId: "gmail-thread-1",
      externalUrl: "https://mail.google.com/mail/u/0/#inbox/gmail-thread-1",
    });

    expect(sent?.status).toBe("sent");
    expect(sent?.providerMessageId).toBe("gmail-message-1");

    const updatedMessage = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === message.id);
    expect(updatedMessage?.deliveryStatus).toBe("sent");
    expect(updatedMessage?.externalMessageId).toBe("gmail-message-1");
    expect(updatedMessage?.externalThreadId).toBe("gmail-thread-1");
    expect(updatedMessage?.externalUrl).toContain("mail.google.com");
  });

  it("mirrors provider email once and classifies inbound delivery status", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const mirrored = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: user.id,
      externalMessageId: "provider-inbound-1",
      externalThreadId: "provider-thread-1",
      externalUrl: "https://mail.google.com/mail/u/0/#inbox/provider-thread-1",
      from: customer.email,
      to: [user.businessEmail ?? user.email],
      subject: "Question about my policy",
      body: "Can you check my deductible?",
      sentAt: "2026-06-20T14:30:00.000Z",
    });

    expect(mirrored?.deliveryStatus).toBe("received");
    expect(mirrored?.customerId).toBe(customer.id);

    const duplicate = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: user.id,
      externalMessageId: "provider-inbound-1",
      externalThreadId: "provider-thread-1",
      from: customer.email,
      to: [user.businessEmail ?? user.email],
      subject: "Question about my policy",
      body: "Updated provider body",
    });

    expect(duplicate?.id).toBe(mirrored?.id);
    const mirroredRows = api.communications
      .listByCustomer(customer.id)
      .filter((row) => row.externalMessageId === "provider-inbound-1");
    expect(mirroredRows).toHaveLength(1);
    expect(mirroredRows[0].body).toBe("Updated provider body");
    expect(api.mailboxOutbox.listByTenant(agency.id)).toHaveLength(0);
  });
});
