// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// =====================================================================
// Email threading + AI subject generation. Replies inherit a thread
// and a "Re:" subject; new chats start a fresh threadId. The AI
// subject helper turns a draft body into a concise subject line.
// =====================================================================

beforeEach(async () => {
  if (typeof window !== "undefined" && window.localStorage) window.localStorage.clear();
  const { db } = await import("../db");
  db.reset();
});
afterEach(() => {
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
    const mirrored = api.communications
      .listByCustomer(customer.id)
      .filter((c) => c.externalThreadId === "gmail_thread_1");
    expect(mirrored).toHaveLength(2);
  });

  it("keeps company marketing on the agency mailbox instead of a staff mailbox", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];

    api.agencies.update(agency.id, {
      contactEmail: "marketing@palmcoastpc.example",
      name: "Palm Coast Private Client",
    });

    const out = api.marketing.composeAiCampaign({
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
    expect(api.mailboxes.agencyMarketing(agency.id)?.lastSendAt).toBeTruthy();
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
    expect(staffMailbox?.scopes).toEqual(expect.arrayContaining(["send", "read", "sync"]));
    expect(agencyMailbox?.ownerType).toBe("agency_marketing");
    expect(agencyMailbox?.scopes).toEqual(["send"]);
    expect(api.mailboxes.productionRequirements(staffMailbox)).toContain(
      "Replace the demo connection with provider OAuth before production send/sync."
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
