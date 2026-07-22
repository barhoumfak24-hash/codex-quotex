// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";

// =====================================================================
// Email threading + AI subject generation. Replies inherit a thread
// and a "Re:" subject; new chats start a fresh threadId. The AI
// subject helper turns a draft body into a concise subject line.
// =====================================================================

beforeEach(() => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  db.reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
});

describe("communications threading", () => {
  it("persists threadId + replyToId + subject on an outbound email", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const root = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Your coastal home quote",
      threadId: "thread_abc",
      body: "Here is your quote.",
      createdById: api.users.list(agency.id)[0].id,
    });
    expect(root.threadId).toBe("thread_abc");
    const reply = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Re: Your coastal home quote",
      threadId: "thread_abc",
      replyToId: root.id,
      body: "Following up.",
      createdById: api.users.list(agency.id)[0].id,
    });
    expect(reply.threadId).toBe("thread_abc");
    expect(reply.replyToId).toBe(root.id);
    // Both messages share the thread.
    const inThread = api.communications
      .listByCustomer(customer.id)
      .filter((c) => c.threadId === "thread_abc");
    expect(inThread.length).toBe(2);
  });

  it("marks app-authored email as mailbox-mirrored outbound", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const customer = api.customers.list(agency.id)[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.users.update(manager.id, {
      businessEmail: "advisor@gmail.com",
      mailProvider: "gmail",
    });

    const row = api.communications.create({
      tenantId: agency.id,
      customerId: customer.id,
      channel: "email",
      direction: "outbound",
      subject: "Documents",
      body: "Please review these.",
      createdById: manager.id,
    });

    expect(row.mailboxOrigin).toBe("app");
    expect(row.mailboxAccount).toBe("advisor@gmail.com");
    expect(row.mailboxProvider).toBe("gmail");
    expect(row.mailboxConnectionId).toBe(`mailbox_staff_${manager.id}`);
    expect(api.mailboxes.staff(manager.id)?.lastSendAt).toBeFalsy();

    api.mailboxOutbox.markSent(row.outboxJobId!, {
      externalMessageId: "gmail-confirmed-send",
      externalThreadId: "gmail-thread",
    });

    expect(api.mailboxes.staff(manager.id)?.lastSendAt).toBeTruthy();
  });

  it("mirrors external inbound and sent-mail provider messages into contact threads", async () => {
    const { api } = await import("../api");
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
      externalMessageId: "gmail_msg_in_1",
      externalThreadId: "gmail_thread_1",
      externalUrl: "https://mail.google.com/mail/u/0/#inbox/gmail_msg_in_1",
      from: customer.email,
      to: ["advisor@gmail.com"],
      subject: "Question about renewal",
      body: "Can you confirm the renewal date?",
      sentAt: "2026-05-31T12:00:00.000Z",
    });
    const sent = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: manager.id,
      externalMessageId: "gmail_msg_out_1",
      externalThreadId: "gmail_thread_1",
      from: "advisor@gmail.com",
      to: [customer.email],
      subject: "Re: Question about renewal",
      body: "Yes, it renews next month.",
      sentAt: "2026-05-31T12:04:00.000Z",
    });

    expect(inbound?.direction).toBe("inbound");
    expect(sent?.direction).toBe("outbound");
    expect(sent?.createdById).toBe(manager.id);
    expect(sent?.mailboxOrigin).toBe("provider_sync");
    expect(sent?.mailboxConnectionId).toBe(`mailbox_staff_${manager.id}`);
    expect(api.mailboxes.staff(manager.id)?.lastSyncAt).toBeTruthy();
    expect(sent?.body).toBe("Yes, it renews next month.");
    const inboundRemark = api.status
      .listFor({ customerId: customer.id })
      .find((event) => event.communicationId === inbound?.id);
    expect(inboundRemark?.message).toBe("Email received: Question about renewal.");
    expect(inboundRemark?.source).toBe("customer");
    expect(inboundRemark?.createdAt).toBe("2026-05-31T12:00:00.000Z");
    const mirrored = api.communications
      .listByCustomer(customer.id)
      .filter((c) => c.externalThreadId === "gmail_thread_1");
    expect(mirrored).toHaveLength(2);
  });

  it("drops provider messages from senders that are not on file", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.users.update(manager.id, {
      businessEmail: "advisor@gmail.com",
      mailProvider: "gmail",
    });

    const inbound = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: manager.id,
      externalMessageId: "gmail_unknown_contact_1",
      externalThreadId: "gmail_unknown_thread_1",
      from: "Taylor Contact <taylor.contact@example.com>",
      to: ["advisor@gmail.com"],
      subject: "Question before I become a client",
      body: "Can you help me quote a coastal property?",
      sentAt: "2026-05-31T13:00:00.000Z",
    });

    expect(inbound).toBeNull();
    expect(api.communications.listByTenant(agency.id)).not.toContainEqual(
      expect.objectContaining({ externalMessageId: "gmail_unknown_contact_1" })
    );
  });

  it("does not let carrier submission metadata bypass the known-sender boundary", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;
    api.users.update(manager.id, {
      businessEmail: "advisor@gmail.com",
      mailProvider: "gmail",
    });

    const inbound = api.mailbox.mirrorExternalEmail({
      tenantId: agency.id,
      mailboxUserId: manager.id,
      externalMessageId: "gmail_unknown_carrier_reply_1",
      externalThreadId: "gmail_unknown_carrier_thread_1",
      from: "Unknown Underwriter <unknown.underwriter@example.com>",
      to: ["advisor@gmail.com"],
      subject: "Re: Commercial application",
      body: "The application is approved.",
      carrierSubmissionId: "submission-legacy-1",
      sentAt: "2026-05-31T13:05:00.000Z",
    });

    expect(inbound).toBeNull();
    expect(api.communications.listByTenant(agency.id)).not.toContainEqual(
      expect.objectContaining({ externalMessageId: "gmail_unknown_carrier_reply_1" })
    );
  });

  it("keeps company marketing on the agency mailbox instead of a staff mailbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              provider: "transactional",
              status: "sent",
              externalMessageId: "campaign_1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];

    api.agencies.update(agency.id, {
      contactEmail: "marketing@palmcoastpc.example",
      name: "Palm Coast Private Client",
    });

    const out = await api.marketing.composeAiCampaign({
      tenantId: agency.id,
      name: "Coastal home review",
      channels: ["email"],
      brief: "Invite high-value clients to review coastal home coverage before hurricane season.",
      includeAllClients: true,
      actorId: api.users.list(agency.id).find((u) => u.role === "manager")!.id,
    });

    const messages = api.marketing
      .listMessages(agency.id)
      .filter((message) => message.campaignId === out.campaign.id);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.fromEmail === "marketing@palmcoastpc.example")).toBe(true);
    expect(messages.every((message) => message.mailboxConnectionId === `mailbox_agency_marketing_${agency.id}`)).toBe(
      true
    );
    expect(api.mailboxes.agencyMarketing(agency.id)?.lastSendAt).toBeUndefined();
  });
});

describe("connected mailbox setup", () => {
  it("seeds staff and agency sender connections and reports production requirements", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const manager = api.users.list(agency.id).find((u) => u.role === "manager")!;

    const staffMailbox = api.mailboxes.staff(manager.id);
    const agencyMailbox = api.mailboxes.agencyMarketing(agency.id);

    expect(staffMailbox?.ownerType).toBe("staff");
    expect(staffMailbox?.status).toBe("needs_auth");
    expect(staffMailbox?.scopes).toEqual([]);
    expect(agencyMailbox?.ownerType).toBe("agency_marketing");
    expect(agencyMailbox?.status).toBe("needs_auth");
    expect(agencyMailbox?.scopes).toEqual([]);
    expect(api.mailboxes.productionRequirements(staffMailbox)).toContain(
      "Complete provider authorization."
    );
  });
});

describe("mail provider deep links", () => {
  it("builds provider search links around the contact and subject", async () => {
    const { mailboxThreadUrl } = await import("../mailProvider");
    const url = mailboxThreadUrl({
      mailbox: "advisor@gmail.com",
      provider: "gmail",
      contactEmail: "client@example.com",
      subject: "Question about renewal",
    });
    expect(url).toContain("mail.google.com");
    expect(decodeURIComponent(url)).toContain("client@example.com");
    expect(decodeURIComponent(url)).toContain("Question about renewal");
  });

  it("builds exact Gmail links from RFC822 Message-ID when available", async () => {
    const { mailboxThreadUrl } = await import("../mailProvider");
    const url = mailboxThreadUrl({
      mailbox: "advisor@gmail.com",
      provider: "gmail",
      contactEmail: "client@example.com",
      subject: "Question about renewal",
      rfc822MessageId: "<abc+123/client@example.test>",
    });
    expect(url).toBe(
      "https://mail.google.com/mail/u/?authuser=advisor%40gmail.com#search/rfc822msgid:abc%2B123%2Fclient%40example.test"
    );
  });
});

describe("aiEmailSubject", () => {
  it("derives a topical subject from the body", async () => {
    const { aiEmailSubject } = await import("../ai");
    expect(await aiEmailSubject({ body: "Your policy is up for renewal next month." })).toMatch(
      /renewal/i
    );
    expect(await aiEmailSubject({ body: "We still need a few documents to upload." })).toMatch(
      /document/i
    );
    expect(await aiEmailSubject({ body: "Here is your premium quote estimate." })).toMatch(
      /quote/i
    );
  });

  it("derives the subject from the body instead of just appending a name", async () => {
    const { aiEmailSubject } = await import("../ai");
    const s = await aiEmailSubject({
      body: "Hi Alexandra,\n\nPlease e-sign the renewal packet so we can keep the policy moving.",
      contactName: "Alexandra Whitford",
    });
    expect(s).toMatch(/e-signature|documents/i);
    expect(s).not.toContain("Alexandra");
  });

  it("prioritizes the recipient's next action over generic follow-up wording", async () => {
    const { aiEmailSubject } = await import("../ai");
    const s = await aiEmailSubject({
      body:
        "Hi Alexandra,\n\nBefore Chubb can continue underwriting the coastal home renewal, we still need the wind mitigation report and updated roof photos uploaded to the portal.\n\nThank you.",
      contactName: "Alexandra Whitford",
    });
    expect(s).toMatch(/document|underwriting|renewal|mitigation|roof/i);
    expect(s).not.toMatch(/follow|checking|message from/i);
    expect(s).not.toContain("Alexandra");
    expect(s.length).toBeLessThanOrEqual(72);
  });

  it("corrects common spelling errors without rewriting the message", async () => {
    const { aiCorrectSpelling } = await import("../ai");
    const corrected = await aiCorrectSpelling({
      body: "teh renwal documets were recieved for teh comercial plicy",
      channel: "email",
    });
    expect(corrected).toBe(
      "the renewal documents were received for the commercial policy"
    );
  });

  it("falls back to the first words of the body when no topic matches", async () => {
    const { aiEmailSubject } = await import("../ai");
    const s = await aiEmailSubject({ body: "Just checking in to say hello there friend" });
    expect(s.length).toBeGreaterThan(0);
  });
});
