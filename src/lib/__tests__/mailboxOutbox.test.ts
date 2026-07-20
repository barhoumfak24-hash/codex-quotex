// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
  const { db } = await import("../db");
  db.reset();
});

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  if (typeof window !== "undefined" && window.sessionStorage) window.sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
  it("treats a configured transactional provider as live email capability", async () => {
    const { capabilityCanSendEmail } = await import("../liveMailbox");

    expect(
      capabilityCanSendEmail({
        mailboxConnected: false,
        transactionalConfigured: true,
        transactionalProvider: "sendgrid",
        missingEnvironmentVariables: [],
        acceptedConfigurations: [],
      })
    ).toBe(true);
  });

  it("records a client portal delivery without creating a false email job", async () => {
    const { api, agency, customer, user } = await mailboxFixture();

    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Portal update",
      body: "Your secure portal has been updated.",
      createdById: user.id,
      emailDeliveryMode: "portal_only",
    });

    expect(message.deliveryStatus).toBe("synced");
    expect(message.outboxJobId).toBeUndefined();
    expect(api.mailboxOutbox.listByTenant(agency.id)).toHaveLength(0);
    expect(api.communications.listByCustomer(customer.id)).toContainEqual(
      expect.objectContaining({ id: message.id, deliveryStatus: "synced" })
    );
  });

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

  it("adds exact carrier reply context to a carrier submission outbox job", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const carrierContact = api.carrierContacts.listForTenant(agency.id)[0];
    if (!carrierContact) throw new Error("Seed fixture is missing a carrier contact.");

    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      carrierContactId: carrierContact.id,
      carrierSubmissionId: "submission-carrier-1",
      threadId: "thread-carrier-1",
      channel: "email",
      direction: "outbound",
      subject: "Commercial application",
      body: "Please review the attached application.",
      createdById: user.id,
    });

    expect(api.mailboxOutbox.get(message.outboxJobId!)).toMatchObject({
      replyContext: {
        communicationId: message.id,
        threadId: "thread-carrier-1",
        customerId: customer.id,
        carrierContactId: carrierContact.id,
        carrierSubmissionId: "submission-carrier-1",
      },
    });
  });

  it("sends with the authenticated server session when the local user row is unavailable", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const { db } = await import("../db");
    vi.stubEnv("NODE_ENV", "development");
    window.localStorage.setItem("quotex.authToken", "server-session-token");
    db.remove("users", user.id);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: {
            provider: "transactional",
            status: "sent",
            externalMessageId: "sendgrid-session-user-1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Server session sender",
      body: "This should send without a browser-local user row.",
      createdById: user.id,
    });

    await vi.waitFor(() => {
      expect(api.mailboxOutbox.get(message.outboxJobId!)?.status).toBe("sent");
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/mailboxes/send"),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer server-session-token",
        }),
      })
    );
    const request = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      senderMode: "staff",
      replyTo: user.businessEmail ?? user.email,
    });
  });

  it("automatically retries a failed mailbox delivery and marks it sent", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const { retryPendingMailboxOutbox, sendCommunicationThroughLiveMailbox } = await import("../liveMailbox");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, message: "Provider temporarily unavailable." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: { provider: "google", status: "sent", externalMessageId: "gmail-retry-1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Automatic retry",
      body: "This delivery should recover automatically.",
      createdById: user.id,
    });

    const first = await sendCommunicationThroughLiveMailbox({
      tenantId: agency.id,
      user,
      communication: message,
    });
    expect(first.ok).toBe(false);
    const failedJob = api.mailboxOutbox.get(message.outboxJobId!);
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.nextAttemptAt).toBeTruthy();

    api.mailboxOutbox.markFailed(
      failedJob!.id,
      failedJob!.lastError ?? "Temporary failure",
      new Date(Date.now() - 1_000).toISOString()
    );
    const retried = await retryPendingMailboxOutbox({ tenantId: agency.id, user });

    expect(retried).toEqual({ attempted: 1, sent: 1 });
    expect(api.mailboxOutbox.get(message.outboxJobId!)?.status).toBe("sent");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("renders a calm automatic-send state instead of a provider failure message", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CommunicationDeliveryStatus } = await import(
      "@/components/messages/CommunicationDeliveryStatus"
    );
    const { api, agency, customer, user } = await mailboxFixture();
    const message = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Pending delivery",
      body: "This message is waiting for its connected mailbox.",
      createdById: user.id,
    });
    api.mailboxOutbox.markFailed(
      message.outboxJobId!,
      "Internal provider code that must not be visible.",
      new Date(Date.now() + 60_000).toISOString()
    );

    const html = renderToStaticMarkup(
      createElement(CommunicationDeliveryStatus, {
        communication: message,
        tenantId: agency.id,
        user,
      })
    );
    expect(html).toContain("Sending automatically");
    expect(html).not.toContain("Email not sent yet");
    expect(html).not.toContain("Internal provider code");
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
      externalUrl: "https://mail.google.com/mail/u/?authuser=advisor%40gmail.com#search/rfc822msgid:gmail-message-1%40example.test",
      rfc822MessageId: "<gmail-message-1@example.test>",
      messageIdHeader: "<gmail-message-1@example.test>",
    });

    expect(sent?.status).toBe("sent");
    expect(sent?.providerMessageId).toBe("gmail-message-1");

    const updatedMessage = api.communications
      .listByCustomer(customer.id)
      .find((row) => row.id === message.id);
    expect(updatedMessage?.deliveryStatus).toBe("sent");
    expect(updatedMessage?.externalMessageId).toBe("gmail-message-1");
    expect(updatedMessage?.externalThreadId).toBe("gmail-thread-1");
    expect(updatedMessage?.externalUrl).toContain("rfc822msgid:gmail-message-1%40example.test");
    expect(updatedMessage?.rfc822MessageId).toBe("<gmail-message-1@example.test>");
    expect(updatedMessage?.messageIdHeader).toBe("<gmail-message-1@example.test>");
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
      bodyHtml: "<table><tr><td><strong>Can you check my deductible?</strong></td></tr></table>",
      messageIdHeader: "<provider-inbound-1@example.test>",
      rfc822MessageId: "<provider-inbound-1@example.test>",
      references: ["<root@example.test>"],
      sentAt: "2026-06-20T14:30:00.000Z",
    });

    expect(mirrored?.deliveryStatus).toBe("received");
    expect(mirrored?.customerId).toBe(customer.id);
    expect(mirrored?.bodyHtml).toContain("<table>");
    expect(mirrored?.messageIdHeader).toBe("<provider-inbound-1@example.test>");
    expect(mirrored?.rfc822MessageId).toBe("<provider-inbound-1@example.test>");

    const duplicate = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: user.id,
      externalMessageId: "provider-inbound-1",
      externalThreadId: "provider-thread-1",
      from: customer.email,
      to: [user.businessEmail ?? user.email],
      subject: "Question about my policy",
      body: "Updated provider body",
      bodyHtml: "<p>Updated provider body</p>",
    });

    expect(duplicate?.id).toBe(mirrored?.id);
    const mirroredRows = api.communications
      .listByCustomer(customer.id)
      .filter((row) => row.externalMessageId === "provider-inbound-1");
    expect(mirroredRows).toHaveLength(1);
    expect(mirroredRows[0].body).toBe("Updated provider body");
    expect(mirroredRows[0].bodyHtml).toBe("<p>Updated provider body</p>");
    expect(api.mailboxOutbox.listByTenant(agency.id)).toHaveLength(0);
  });

  it("threads synced replies by Message-ID references when provider thread ids differ", async () => {
    const { api, agency, customer, user } = await mailboxFixture();
    const original = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: user.id,
      externalMessageId: "provider-thread-root",
      externalThreadId: "provider-thread-a",
      from: customer.email,
      to: [user.businessEmail ?? user.email],
      subject: "Renewal packet",
      body: "Can you send the renewal packet?",
      messageIdHeader: "<renewal-root@example.test>",
    });

    const reply = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: user.id,
      externalMessageId: "provider-thread-reply",
      externalThreadId: "provider-thread-b",
      from: user.businessEmail ?? user.email,
      to: [customer.email],
      subject: "Re: Renewal packet",
      body: "Yes, sending it now.",
      bodyHtml: "<p>Yes, sending it now.</p>",
      messageIdHeader: "<renewal-reply@example.test>",
      inReplyToHeader: "<renewal-root@example.test>",
      references: ["<renewal-root@example.test>"],
      direction: "outbound",
    });

    expect(original?.threadId).toBeTruthy();
    expect(reply?.threadId).toBe(original?.threadId);
    expect(reply?.deliveryStatus).toBe("synced");
    expect(reply?.bodyHtml).toBe("<p>Yes, sending it now.</p>");
  });
});
