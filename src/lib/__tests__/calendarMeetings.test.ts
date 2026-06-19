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

describe("calendar meeting requests", () => {
  it("keeps recipient meetings pending until accepted", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const staff = api.users
      .list(agency.id)
      .filter((user) => user.role === "agent" || user.role === "manager");
    const organizer = staff[0];
    const recipient = staff[1];
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const meeting = api.calendarEvents.requestMeeting({
      tenantId: agency.id,
      userId: organizer.id,
      organizerId: organizer.id,
      attendeeIds: [recipient.id],
      title: "Internal renewal handoff",
      startsAt,
      importance: "warning",
    });

    expect(api.calendarEvents.listPendingRequestsForUser(agency.id, recipient.id)).toHaveLength(1);
    expect(api.calendarEvents.pendingRequestCount(agency.id, recipient.id)).toBe(1);
    expect(api.calendarEvents.listForUser(agency.id, recipient.id).some((event) => event.id === meeting.id)).toBe(false);

    api.calendarEvents.acceptMeeting(meeting.id, recipient.id);

    expect(api.calendarEvents.listPendingRequestsForUser(agency.id, recipient.id)).toHaveLength(0);
    expect(api.calendarEvents.listForUser(agency.id, recipient.id).some((event) => event.id === meeting.id)).toBe(true);
  });

  it("links reminders to calendar events", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const event = api.calendarEvents.create({
      tenantId: agency.id,
      userId: agent.id,
      kind: "event",
      title: "Carrier review",
      startsAt,
      importance: "info",
    });

    api.reminders.create({
      tenantId: agency.id,
      userId: agent.id,
      calendarEventId: event.id,
      title: event.title,
      remindAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    expect(api.reminders.listForCalendarEvent(event.id, agent.id)).toHaveLength(1);
  });

  it("reschedules and completes calendar events without deleting the record", async () => {
    const { api } = await import("../api");
    const agency = api.agencies.list()[0];
    const agent = api.users.list(agency.id).find((user) => user.role === "agent")!;
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const event = api.calendarEvents.create({
      tenantId: agency.id,
      userId: agent.id,
      kind: "event",
      title: "Billing review",
      startsAt,
      importance: "info",
    });
    const rescheduled = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    api.calendarEvents.update(event.id, { startsAt: rescheduled });
    expect(api.calendarEvents.get(event.id)?.startsAt).toBe(rescheduled);

    api.calendarEvents.update(event.id, { completedAt: new Date().toISOString() });
    expect(api.calendarEvents.get(event.id)).toBeTruthy();
    const completedEvent = api.calendarEvents.listForUser(agency.id, agent.id).find((row) => row.id === event.id);
    expect(completedEvent?.completedAt).toBeTruthy();
  });
});
