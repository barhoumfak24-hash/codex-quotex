import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Plus,
  RotateCcw,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { EmployeeBackButton } from "@/components/layout/EmployeeBackButton";
import { ImportanceIcon, ImportancePicker } from "@/components/tasks/ImportancePicker";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { ExpandableCard } from "@/components/ui/ExpandableCard";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import type { CalendarEvent, Reminder, Task, TaskSeverity } from "@/types";

type CalendarItemSource = "event" | "meeting" | "reminder" | "companyReminder" | "activity";
type CalendarView = "month" | "week" | "day";
type EventModalMode = "event" | "meeting";

type CalendarItem = {
  id: string;
  source: CalendarItemSource;
  title: string;
  detail?: string;
  startsAt: string;
  endsAt?: string;
  importance: TaskSeverity;
  href?: string;
  location?: string;
  completedAt?: string;
};

type CalendarEventForm = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  importance: TaskSeverity;
  location: string;
};

type EventReminderForm = {
  remindAt: string;
  note: string;
  importance: TaskSeverity;
};

type RescheduleForm = {
  startsAt: string;
  endsAt: string;
};

type ActivityDueForm = {
  dueAt: string;
};

const VIEW_OPTIONS: Array<{ id: CalendarView; label: string }> = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_HOURS = Array.from({ length: 12 }, (_, index) => index + 7);

export function EmployeeCalendarPage() {
  const { agency } = useTenant();
  const { user } = useAuth();
  const todayKey = dateKeyFromDate(new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [view, setView] = useState<CalendarView>("week");
  const [rev, setRev] = useState(0);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalMode, setEventModalMode] = useState<EventModalMode>("event");
  const [eventForm, setEventForm] = useState<CalendarEventForm>(newEventForm(todayKey));
  const [meetingRecipientIds, setMeetingRecipientIds] = useState<string[]>([]);
  const [reminderItem, setReminderItem] = useState<CalendarItem | null>(null);
  const [reminderForm, setReminderForm] = useState<EventReminderForm>(newEventReminderForm(newEventForm(todayKey).startsAt));
  const [completeItem, setCompleteItem] = useState<CalendarItem | null>(null);
  const [rescheduleItem, setRescheduleItem] = useState<CalendarItem | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleForm>({
    startsAt: newEventForm(todayKey).startsAt,
    endsAt: newEventForm(todayKey).endsAt,
  });
  const [activityDueItem, setActivityDueItem] = useState<CalendarItem | null>(null);
  const [activityDueForm, setActivityDueForm] = useState<ActivityDueForm>({
    dueAt: newEventForm(todayKey).startsAt,
  });

  const allItems = useMemo(() => {
    if (!agency || !user) return [];
    return buildCalendarItems(agency.id, user.id);
  }, [agency?.id, user?.id, rev]);

  const staffUsers = useMemo(() => {
    if (!agency || !user) return [];
    return api.users
      .list(agency.id)
      .filter((staff) => (staff.role === "agent" || staff.role === "manager") && staff.id !== user.id);
  }, [agency?.id, user?.id, rev]);

  const pendingMeetingRequests = useMemo(() => {
    if (!agency || !user) return [];
    return api.calendarEvents.listPendingRequestsForUser(agency.id, user.id);
  }, [agency?.id, user?.id, rev]);

  useEffect(() => subscribeToDbChanges(() => setRev((value) => value + 1)), []);

  const itemsByDate = useMemo(() => groupItemsByDate(allItems), [allItems]);

  if (!agency || !user) return null;

  const selectedItems = itemsForDate(itemsByDate, selectedDate);
  const upcoming = allItems
    .filter((item) => !item.completedAt && new Date(item.startsAt).getTime() >= startOfDay(new Date()).getTime())
    .slice(0, 12);

  const selectDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setEventForm((current) => moveEventFormToDate(current, dateKey));
  };

  const moveCalendar = (direction: -1 | 1) => {
    const current = parseDateKey(selectedDate);
    const next =
      view === "month"
        ? addMonths(current, direction)
        : addDays(current, direction * (view === "week" ? 7 : 1));
    selectDate(dateKeyFromDate(next));
  };

  const goToday = () => {
    selectDate(todayKey);
  };

  const openNewEvent = () => {
    setEventModalMode("event");
    setMeetingRecipientIds([]);
    setEventForm((current) => moveEventFormToDate(current.title.trim() ? current : newEventForm(selectedDate), selectedDate));
    setEventModalOpen(true);
  };

  const addEvent = () => {
    if (!eventForm.title.trim()) return;
    if (eventModalMode === "meeting" && meetingRecipientIds.length === 0) return;
    const startsAt = fromDateTimeLocalValue(eventForm.startsAt) ?? new Date().toISOString();
    const endsAt = validEndIso(startsAt, eventForm.endsAt);

    if (eventModalMode === "meeting") {
      api.calendarEvents.requestMeeting({
        tenantId: agency.id,
        userId: user.id,
        organizerId: user.id,
        attendeeIds: meetingRecipientIds,
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || undefined,
        startsAt,
        endsAt,
        importance: eventForm.importance,
        location: eventForm.location.trim() || undefined,
      });
    } else {
      api.calendarEvents.create({
        tenantId: agency.id,
        userId: user.id,
        kind: "event",
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || undefined,
        startsAt,
        endsAt,
        importance: eventForm.importance,
        location: eventForm.location.trim() || undefined,
      });
    }

    setEventForm(newEventForm(selectedDate));
    setMeetingRecipientIds([]);
    setEventModalOpen(false);
    setRev((value) => value + 1);
  };

  const requestMarkItemComplete = (item: CalendarItem) => {
    if (item.completedAt) return;
    setCompleteItem(item);
  };

  const confirmMarkItemComplete = () => {
    if (!completeItem) return;
    const item = completeItem;
    if (isCalendarEventItem(item)) {
      api.calendarEvents.update(item.id, { completedAt: new Date().toISOString() });
    } else if (item.source === "activity") {
      api.tasks.markComplete(item.id, user.id);
    } else if (item.source === "reminder" || item.source === "companyReminder") {
      api.reminders.dismiss(item.id);
    }
    setCompleteItem(null);
    setRev((value) => value + 1);
  };

  const openRescheduleModal = (item: CalendarItem) => {
    if (!isCalendarEventItem(item)) return;
    setRescheduleItem(item);
    setRescheduleForm({
      startsAt: dateTimeLocalFromDate(new Date(item.startsAt)),
      endsAt: item.endsAt ? dateTimeLocalFromDate(new Date(item.endsAt)) : dateTimeLocalFromDate(addMinutes(new Date(item.startsAt), 30)),
    });
  };

  const openActivityDueModal = (item: CalendarItem) => {
    if (item.source !== "activity") return;
    setActivityDueItem(item);
    setActivityDueForm({ dueAt: dateTimeLocalFromDate(new Date(item.startsAt)) });
  };

  const saveReschedule = () => {
    if (!rescheduleItem) return;
    const startsAt = fromDateTimeLocalValue(rescheduleForm.startsAt);
    if (!startsAt) return;
    api.calendarEvents.update(rescheduleItem.id, {
      startsAt,
      endsAt: validEndIso(startsAt, rescheduleForm.endsAt),
    });
    setRescheduleItem(null);
    setRev((value) => value + 1);
  };

  const saveActivityDueDate = () => {
    if (!activityDueItem) return;
    const dueAt = fromDateTimeLocalValue(activityDueForm.dueAt);
    if (!dueAt) return;
    api.tasks.setDueAt(activityDueItem.id, dueAt, user.id);
    setActivityDueItem(null);
    setRev((value) => value + 1);
  };

  const clearActivityDueDate = () => {
    if (!activityDueItem) return;
    api.tasks.setDueAt(activityDueItem.id, undefined, user.id);
    setActivityDueItem(null);
    setRev((value) => value + 1);
  };

  const respondToMeeting = (eventId: string, status: "accepted" | "declined") => {
    if (status === "accepted") {
      api.calendarEvents.acceptMeeting(eventId, user.id);
    } else {
      api.calendarEvents.declineMeeting(eventId, user.id);
    }
    setRev((value) => value + 1);
  };

  const openReminderModal = (item: CalendarItem) => {
    setReminderItem(item);
    setReminderForm(newEventReminderForm(item.startsAt));
  };

  const saveEventReminder = () => {
    if (!reminderItem) return;
    const remindAt = fromDateTimeLocalValue(reminderForm.remindAt);
    if (!remindAt) return;
    api.reminders.create({
      tenantId: agency.id,
      userId: user.id,
      calendarEventId: reminderItem.id,
      title: reminderItem.title,
      note: reminderForm.note.trim() || `Calendar reminder for ${timeLabel(reminderItem.startsAt, reminderItem.endsAt)}`,
      remindAt,
      importance: reminderForm.importance,
      scope: "personal",
    });
    setReminderItem(null);
    setRev((value) => value + 1);
  };

  return (
    <div className="space-y-6">
      <EmployeeBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Calendar</h1>
          <p className="mt-1 text-sm text-ink-500">
            Calendar view for reminders, company reminders, activity due dates, and personal events.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={goToday}>
            Today
          </Button>
          <Button size="sm" onClick={() => moveCalendar(-1)} title="Previous">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => moveCalendar(1)} title="Next">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Jump to
            <input
              type="date"
              className="input mt-1 min-h-8 text-sm"
              value={selectedDate}
              onChange={(event) => selectDate(event.target.value)}
            />
          </label>
        </div>
      </div>

      {pendingMeetingRequests.length > 0 && (
        <Card padded={false} className="overflow-hidden border-gold-200 bg-gold-50/40">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gold-100 px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
                <UserPlus className="h-4 w-4 text-gold-700" /> Internal meeting requests
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Accept a request to add it to your calendar, or decline it to clear the notification.
              </p>
            </div>
            <Badge tone="gold">{pendingMeetingRequests.length} pending</Badge>
          </div>
          <div className="divide-y divide-gold-100">
            {pendingMeetingRequests.map((event) => (
              <MeetingRequestRow
                key={event.id}
                event={event}
                onAccept={() => respondToMeeting(event.id, "accepted")}
                onDecline={() => respondToMeeting(event.id, "declined")}
              />
            ))}
          </div>
        </Card>
      )}

      <div className="min-w-[1120px] space-y-4">
        <ExpandableCard
          className="w-full shadow-lg"
          title={calendarTitle(view, selectedDate)}
          subtitle="Click any day to open its agenda. Reminders and due activities appear automatically."
          action={
            <Button
              size="sm"
              variant="gold"
              onClick={openNewEvent}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              New event
            </Button>
          }
        >
          {(expanded) => (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex rounded-md border border-ink-200 bg-white p-1">
                  {VIEW_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      onClick={() => setView(option.id)}
                      className={`min-h-8 rounded px-3 text-xs font-semibold transition ${
                        view === option.id ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <Badge tone={selectedItems.length > 0 ? "gold" : "neutral"}>
                  {fmt.date(selectedDate)} - {selectedItems.length} items
                </Badge>
              </div>
              <div className="overflow-hidden rounded-md border border-ink-100">
                {view === "month" && (
                  <MonthCalendar
                    selectedDate={selectedDate}
                    todayKey={todayKey}
                    itemsByDate={itemsByDate}
                    onSelectDate={selectDate}
                    expanded={expanded}
                  />
                )}
                {view === "week" && (
                  <WeekCalendar
                    selectedDate={selectedDate}
                    todayKey={todayKey}
                    itemsByDate={itemsByDate}
                    onSelectDate={selectDate}
                    expanded={expanded}
                  />
                )}
                {view === "day" && (
                  <DaySchedule
                    selectedDate={selectedDate}
                    items={selectedItems}
                    onSetEventReminder={openReminderModal}
                    onMarkItemComplete={requestMarkItemComplete}
                    onRescheduleEvent={openRescheduleModal}
                    onAdjustActivityDate={openActivityDueModal}
                    expanded={expanded}
                  />
                )}
              </div>
            </div>
          )}
        </ExpandableCard>

        <Card padded={false} className="w-full overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">{fmt.date(selectedDate)} agenda</h2>
              <p className="mt-1 text-sm text-ink-500">Exact schedule for the selected day, lined up under the calendar.</p>
            </div>
            <Badge tone={selectedItems.length > 0 ? "gold" : "neutral"}>{selectedItems.length} items</Badge>
          </div>
          <div className="max-h-[28rem] divide-y divide-ink-100 overflow-y-auto">
            {selectedItems.length > 0 ? (
              selectedItems.map((item) => (
                <CalendarItemRow
                  key={`selected:${item.source}:${item.id}`}
                  item={item}
                  onSetReminder={isCalendarEventItem(item) && !item.completedAt ? () => openReminderModal(item) : undefined}
                  onMarkComplete={!item.completedAt && item.source !== "activity" ? () => requestMarkItemComplete(item) : undefined}
                  onReschedule={isCalendarEventItem(item) && !item.completedAt ? () => openRescheduleModal(item) : undefined}
                  onAdjustDate={item.source === "activity" && !item.completedAt ? () => openActivityDueModal(item) : undefined}
                />
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-ink-400">
                No items scheduled for this day.
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Selected day"
          value={selectedItems.length}
          hint={fmt.date(selectedDate)}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <StatCard
          label="High importance"
          value={selectedItems.filter((item) => item.importance === "urgent").length}
          hint="Reminders, events, and activities"
          icon={<Clock3 className="h-5 w-5" />}
        />
        <StatCard
          label="Activity deadlines"
          value={selectedItems.filter((item) => item.source === "activity").length}
          hint="Due dates from Activity Center"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-ink-900">Upcoming</h2>
          <p className="mt-1 text-sm text-ink-500">Next scheduled items across your personal calendar.</p>
        </div>
        <div className="divide-y divide-ink-100">
          {upcoming.length > 0 ? (
            upcoming.map((item) => (
              <CalendarItemRow
                key={`upcoming:${item.source}:${item.id}`}
                item={item}
                onSetReminder={isCalendarEventItem(item) && !item.completedAt ? () => openReminderModal(item) : undefined}
                onMarkComplete={!item.completedAt && item.source !== "activity" ? () => requestMarkItemComplete(item) : undefined}
                onReschedule={isCalendarEventItem(item) && !item.completedAt ? () => openRescheduleModal(item) : undefined}
                onAdjustDate={item.source === "activity" && !item.completedAt ? () => openActivityDueModal(item) : undefined}
              />
            ))
          ) : (
            <div className="px-5 py-8 text-center text-sm text-ink-400">No upcoming calendar items.</div>
          )}
        </div>
      </Card>

      <Modal
        open={eventModalOpen}
        onClose={() => {
          setEventModalOpen(false);
          setEventForm(newEventForm(selectedDate));
          setEventModalMode("event");
          setMeetingRecipientIds([]);
        }}
        title="New calendar item"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-500">
              Event type
            </div>
            <div className="grid gap-2 rounded-md border border-ink-100 bg-ink-50 p-1 sm:grid-cols-2">
            {[
              {
                id: "event" as const,
                label: "Personal calendar event",
                helper: "Only appears on your calendar.",
              },
              {
                id: "meeting" as const,
                label: "Choose recipients",
                helper: "Send an internal meeting request to selected staff.",
              },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`rounded-md border px-3 py-2 text-left transition ${
                  eventModalMode === mode.id
                    ? "border-gold-300 bg-white shadow-sm"
                    : "border-transparent text-ink-600 hover:bg-white"
                }`}
                onClick={() => setEventModalMode(mode.id)}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  {mode.id === "meeting" ? <UserPlus className="h-4 w-4 text-gold-700" /> : <CalendarDays className="h-4 w-4 text-gold-700" />}
                  {mode.label}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">{mode.helper}</span>
              </button>
            ))}
            </div>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Title
            <input
              className="input mt-1 text-sm"
              value={eventForm.title}
              onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Client review, agency meeting..."
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Starts
              <input
                className="input mt-1 text-sm"
                type="datetime-local"
                value={eventForm.startsAt}
                onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))}
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Ends
              <input
                className="input mt-1 text-sm"
                type="datetime-local"
                value={eventForm.endsAt}
                onChange={(event) => setEventForm((current) => ({ ...current, endsAt: event.target.value }))}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Importance</div>
              <div className="mt-1">
                <ImportancePicker
                  value={eventForm.importance}
                  onChange={(importance) => setEventForm((current) => ({ ...current, importance }))}
                />
              </div>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Location
              <input
                className="input mt-1 text-sm"
                value={eventForm.location}
                onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="Optional"
              />
            </label>
          </div>
          {eventModalMode === "meeting" && (
            <div className="rounded-md border border-ink-100 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Recipients</div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    They receive a Calendar notification and can accept or decline.
                  </p>
                </div>
                <Badge tone={meetingRecipientIds.length > 0 ? "gold" : "neutral"}>
                  {meetingRecipientIds.length} selected
                </Badge>
              </div>
              {staffUsers.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {staffUsers.map((staff) => {
                    const selected = meetingRecipientIds.includes(staff.id);
                    return (
                      <button
                        key={staff.id}
                        type="button"
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          selected
                            ? "border-gold-400 bg-gold-50"
                            : "border-ink-100 bg-white hover:border-gold-200 hover:bg-gold-50/40"
                        }`}
                        onClick={() =>
                          setMeetingRecipientIds((current) =>
                            current.includes(staff.id)
                              ? current.filter((id) => id !== staff.id)
                              : [...current, staff.id]
                          )
                        }
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-ink-900">{staff.name}</span>
                          {selected && <Check className="h-4 w-4 text-gold-700" />}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {fmt.titleCase(staff.role)}{staff.lineOfBusiness ? `, ${fmt.titleCase(staff.lineOfBusiness)} lines` : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-ink-100 px-3 py-4 text-center text-sm text-ink-400">
                  No other staff users are available.
                </div>
              )}
            </div>
          )}
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Notes
            <textarea
              className="input mt-1 min-h-28 text-sm"
              value={eventForm.description}
              onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Context, prep notes, or desired outcome."
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
            <Button
              size="sm"
              onClick={() => {
                setEventModalOpen(false);
                setEventForm(newEventForm(selectedDate));
                setEventModalMode("event");
                setMeetingRecipientIds([]);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="gold"
              onClick={addEvent}
              disabled={!eventForm.title.trim() || (eventModalMode === "meeting" && meetingRecipientIds.length === 0)}
              icon={eventModalMode === "meeting" ? <UserPlus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            >
              {eventModalMode === "meeting" ? "Send meeting request" : "Save personal event"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!completeItem}
        onClose={() => setCompleteItem(null)}
        title="Mark complete"
        size="md"
      >
        {completeItem && (
          <div className="space-y-4">
            <div className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <div className="text-sm font-semibold text-ink-900">{completeItem.title}</div>
              <div className="mt-1 text-xs text-ink-500">
                {fmt.date(dateKeyFromIso(completeItem.startsAt))} at {timeLabel(completeItem.startsAt, completeItem.endsAt)}
              </div>
            </div>
            <p className="text-sm text-ink-600">
              This will mark the item complete and keep it crossed off on the selected day.
            </p>
            <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
              <Button size="sm" onClick={() => setCompleteItem(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={confirmMarkItemComplete}
                icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              >
                Complete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!reminderItem}
        onClose={() => setReminderItem(null)}
        title="Set event reminder"
        size="md"
      >
        {reminderItem && (
          <div className="space-y-4">
            <div className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <div className="text-sm font-semibold text-ink-900">{reminderItem.title}</div>
              <div className="mt-1 text-xs text-ink-500">
                {fmt.date(dateKeyFromIso(reminderItem.startsAt))} at {timeLabel(reminderItem.startsAt, reminderItem.endsAt)}
              </div>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Remind me at
              <input
                className="input mt-1 text-sm"
                type="datetime-local"
                value={reminderForm.remindAt}
                onChange={(event) => setReminderForm((current) => ({ ...current, remindAt: event.target.value }))}
              />
            </label>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Importance</div>
              <div className="mt-1">
                <ImportancePicker
                  value={reminderForm.importance}
                  onChange={(importance) => setReminderForm((current) => ({ ...current, importance }))}
                />
              </div>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Note
              <textarea
                className="input mt-1 min-h-20 text-sm"
                value={reminderForm.note}
                onChange={(event) => setReminderForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Optional prep note."
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
              <Button size="sm" onClick={() => setReminderItem(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={saveEventReminder}
                disabled={!reminderForm.remindAt}
                icon={<Bell className="h-3.5 w-3.5" />}
              >
                Save reminder
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!rescheduleItem}
        onClose={() => setRescheduleItem(null)}
        title="Reschedule calendar event"
        size="md"
      >
        {rescheduleItem && (
          <div className="space-y-4">
            <div className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <div className="text-sm font-semibold text-ink-900">{rescheduleItem.title}</div>
              <div className="mt-1 text-xs text-ink-500">
                Current time: {timeLabel(rescheduleItem.startsAt, rescheduleItem.endsAt)}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
                New start
                <input
                  className="input mt-1 text-sm"
                  type="datetime-local"
                  value={rescheduleForm.startsAt}
                  onChange={(event) => setRescheduleForm((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
                New end
                <input
                  className="input mt-1 text-sm"
                  type="datetime-local"
                  value={rescheduleForm.endsAt}
                  onChange={(event) => setRescheduleForm((current) => ({ ...current, endsAt: event.target.value }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-ink-100 pt-4">
              <Button size="sm" onClick={() => setRescheduleItem(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={saveReschedule}
                disabled={!rescheduleForm.startsAt}
                icon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Save reschedule
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!activityDueItem}
        onClose={() => setActivityDueItem(null)}
        title="Adjust activity date"
        size="md"
      >
        {activityDueItem && (
          <div className="space-y-4">
            <div className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <div className="text-sm font-semibold text-ink-900">{activityDueItem.title}</div>
              <div className="mt-1 text-xs text-ink-500">
                Current due date: {fmt.dateTime(activityDueItem.startsAt)}
              </div>
            </div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
              Due date and time
              <input
                className="input mt-1 text-sm"
                type="datetime-local"
                value={activityDueForm.dueAt}
                onChange={(event) => setActivityDueForm({ dueAt: event.target.value })}
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-ink-100 pt-4">
              <Button size="sm" onClick={() => setActivityDueItem(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={clearActivityDueDate}
                icon={<X className="h-3.5 w-3.5" />}
              >
                Clear date
              </Button>
              <Button
                size="sm"
                variant="gold"
                onClick={saveActivityDueDate}
                disabled={!activityDueForm.dueAt}
                icon={<CalendarDays className="h-3.5 w-3.5" />}
              >
                Save date
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MeetingRequestRow({
  event,
  onAccept,
  onDecline,
}: {
  event: CalendarEvent;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const organizer = api.users.get(event.organizerId ?? event.userId);
  return (
    <div className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
      <div className="font-semibold tabular-nums text-ink-900">{timeLabel(event.startsAt, event.endsAt)}</div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ImportanceIcon importance={event.importance} className="h-4 w-4 shrink-0" />
          <span className="font-semibold text-ink-900">{event.title}</span>
          <Badge tone="gold">Meeting request</Badge>
        </div>
        <div className="mt-1 text-xs text-ink-500">
          From {organizer?.name ?? "Agency teammate"} on {fmt.date(dateKeyFromIso(event.startsAt))}
        </div>
        {event.description && <div className="mt-1 line-clamp-2 text-xs text-ink-600">{event.description}</div>}
        {event.location && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500">
            <MapPin className="h-3 w-3" /> {event.location}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button size="xs" variant="gold" onClick={onAccept} icon={<Check className="h-3 w-3" />}>
          Accept
        </Button>
        <Button size="xs" onClick={onDecline} icon={<X className="h-3 w-3" />}>
          Decline
        </Button>
      </div>
    </div>
  );
}

function MonthCalendar({
  selectedDate,
  todayKey,
  itemsByDate,
  onSelectDate,
  expanded,
}: {
  selectedDate: string;
  todayKey: string;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectDate: (dateKey: string) => void;
  expanded?: boolean;
}) {
  const selected = parseDateKey(selectedDate);
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const cells = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50/70 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {WEEKDAY_LABELS.map((day) => (
          <div key={day} className="px-2 py-3">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const key = dateKeyFromDate(date);
          const dayItems = itemsForDate(itemsByDate, key);
          const inMonth = date.getMonth() === selected.getMonth();
          const active = key === selectedDate;
          const today = key === todayKey;

          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelectDate(key)}
              className={`${expanded ? "min-h-[8.5rem]" : "min-h-[7rem]"} border-b border-r border-ink-100 p-2 text-left transition hover:bg-gold-50/50 ${
                active ? "bg-gold-50" : inMonth ? "bg-white" : "bg-ink-50/50"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-semibold ${
                    today ? "bg-ink-900 text-white" : active ? "bg-gold-600 text-white" : inMonth ? "text-ink-800" : "text-ink-300"
                  }`}
                >
                  {date.getDate()}
                </span>
                {dayItems.length > 0 && (
                  <span className="text-[11px] font-semibold text-ink-400">{dayItems.length}</span>
                )}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, expanded ? 3 : 2).map((item) => (
                  <CalendarChip key={`${item.source}:${item.id}`} item={item} />
                ))}
                {dayItems.length > (expanded ? 3 : 2) && (
                  <div className="text-[11px] font-semibold text-ink-500">
                    +{dayItems.length - (expanded ? 3 : 2)} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekCalendar({
  selectedDate,
  todayKey,
  itemsByDate,
  onSelectDate,
  expanded,
}: {
  selectedDate: string;
  todayKey: string;
  itemsByDate: Map<string, CalendarItem[]>;
  onSelectDate: (dateKey: string) => void;
  expanded?: boolean;
}) {
  const weekStart = startOfWeek(parseDateKey(selectedDate));
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  return (
    <div className="grid grid-cols-7">
      {days.map((date) => {
        const key = dateKeyFromDate(date);
        const dayItems = itemsForDate(itemsByDate, key);
        const active = key === selectedDate;
        const today = key === todayKey;

        return (
          <button
            type="button"
            key={key}
            onClick={() => onSelectDate(key)}
            className={`${expanded ? "min-h-[26rem]" : "min-h-[18rem]"} border-r border-ink-100 p-3 text-left transition hover:bg-gold-50/50 ${
              active ? "bg-gold-50" : "bg-white"
            }`}
          >
            <div className="mb-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                {WEEKDAY_LABELS[date.getDay()]}
              </div>
              <div
                className={`mt-1 inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                  today ? "bg-ink-900 text-white" : active ? "bg-gold-600 text-white" : "text-ink-900"
                }`}
              >
                {date.getDate()}
              </div>
            </div>
            <div className="space-y-2">
              {dayItems.length > 0 ? (
                dayItems
                  .slice(0, expanded ? 8 : 5)
                  .map((item) => <CalendarChip key={`${item.source}:${item.id}`} item={item} showTime />)
              ) : (
                <div className="rounded-md border border-dashed border-ink-100 px-2 py-4 text-center text-xs text-ink-300">
                  Clear
                </div>
              )}
              {dayItems.length > (expanded ? 8 : 5) && (
                <div className="text-[11px] font-semibold text-ink-500">
                  +{dayItems.length - (expanded ? 8 : 5)} more
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function DaySchedule({
  selectedDate,
  items,
  onSetEventReminder,
  onMarkItemComplete,
  onRescheduleEvent,
  onAdjustActivityDate,
  expanded,
}: {
  selectedDate: string;
  items: CalendarItem[];
  onSetEventReminder: (item: CalendarItem) => void;
  onMarkItemComplete: (item: CalendarItem) => void;
  onRescheduleEvent: (item: CalendarItem) => void;
  onAdjustActivityDate: (item: CalendarItem) => void;
  expanded?: boolean;
}) {
  const allDayItems = items.filter((item) => !isWithinDisplayedHours(item.startsAt));
  return (
    <div>
      <div className="border-b border-ink-100 bg-ink-50/60 px-5 py-3">
        <div className="text-sm font-semibold text-ink-900">{fmt.date(selectedDate)}</div>
        {allDayItems.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {allDayItems.map((item) => (
              <CalendarChip key={`${item.source}:${item.id}`} item={item} showTime />
            ))}
          </div>
        )}
      </div>
      <div className="divide-y divide-ink-100">
        {DAY_HOURS.map((hour) => {
          const hourItems = items.filter((item) => new Date(item.startsAt).getHours() === hour);
          return (
            <div key={hour} className={`grid ${expanded ? "min-h-20" : "min-h-16"} grid-cols-[5.5rem_minmax(0,1fr)]`}>
              <div className="border-r border-ink-100 px-4 py-4 text-right text-xs font-semibold tabular-nums text-ink-400">
                {hourLabel(hour)}
              </div>
              <div className="space-y-2 px-4 py-3">
                {hourItems.length > 0 ? (
                  hourItems.map((item) => (
                    <CalendarItemRow
                      key={`day:${item.source}:${item.id}`}
                      item={item}
                      compact
                      onSetReminder={isCalendarEventItem(item) && !item.completedAt ? () => onSetEventReminder(item) : undefined}
                      onMarkComplete={!item.completedAt && item.source !== "activity" ? () => onMarkItemComplete(item) : undefined}
                      onReschedule={isCalendarEventItem(item) && !item.completedAt ? () => onRescheduleEvent(item) : undefined}
                      onAdjustDate={item.source === "activity" && !item.completedAt ? () => onAdjustActivityDate(item) : undefined}
                    />
                  ))
                ) : (
                  <div className="h-full rounded-md border border-dashed border-ink-100" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarChip({ item, showTime = false }: { item: CalendarItem; showTime?: boolean }) {
  const completed = !!item.completedAt;
  return (
    <div
      title={`${sourceLabel(item.source)} - ${timeLabel(item.startsAt, item.endsAt)} - ${item.title}`}
      className={`relative flex min-w-0 items-center gap-1.5 rounded-md border border-l-4 px-2 py-1.5 text-xs font-semibold shadow-sm ${
        completed ? "opacity-70" : ""
      } ${chipClass(item)}`}
    >
      <ImportanceIcon importance={item.importance} className="h-3.5 w-3.5 shrink-0" />
      <span className={`min-w-0 flex-1 truncate ${completed ? "line-through decoration-2" : ""}`}>
        {showTime && <span className="mr-1 font-bold opacity-80">{compactTimeLabel(item.startsAt)}</span>}
        <span>{item.title}</span>
      </span>
      {completed && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-2 right-2 top-1/2 h-px -rotate-3 bg-current opacity-70"
        />
      )}
    </div>
  );
}

function CalendarItemRow({
  item,
  compact = false,
  agenda = false,
  onSetReminder,
  onMarkComplete,
  onReschedule,
  onAdjustDate,
}: {
  item: CalendarItem;
  compact?: boolean;
  agenda?: boolean;
  onSetReminder?: () => void;
  onMarkComplete?: () => void;
  onReschedule?: () => void;
  onAdjustDate?: () => void;
}) {
  const completed = !!item.completedAt;
  return (
    <div
      className={`grid gap-3 text-sm ${
        agenda
          ? "px-5 py-4 sm:grid-cols-[6.5rem_minmax(0,1fr)]"
          : compact
          ? "rounded-md border border-ink-100 bg-white px-3 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto]"
          : "px-5 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto_auto]"
      } ${completed ? "bg-ink-50/70 opacity-80" : ""}`}
    >
      <div className={`font-semibold tabular-nums text-ink-900 ${completed ? "line-through decoration-2" : ""}`}>
        {timeLabel(item.startsAt, item.endsAt)}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ImportanceIcon importance={item.importance} className="h-4 w-4 shrink-0" />
          <span className={`font-semibold text-ink-900 ${completed ? "line-through decoration-2" : ""}`}>{item.title}</span>
          <Badge tone={sourceTone(item.source)}>{sourceLabel(item.source)}</Badge>
          {completed && <Badge tone="neutral">Completed</Badge>}
        </div>
        {item.detail && <div className="mt-1 line-clamp-2 text-xs text-ink-500">{item.detail}</div>}
        {item.location && (
          <div className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500">
            <MapPin className="h-3 w-3" /> {item.location}
          </div>
        )}
      </div>
      {!agenda && (
        <div className="self-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white px-2.5 py-1 text-xs font-semibold text-ink-700 shadow-sm">
            <ImportanceIcon importance={item.importance} className="h-3.5 w-3.5 shrink-0" />
            {importanceLabel(item.importance)}
          </span>
        </div>
      )}
      {(item.href || onSetReminder || onMarkComplete || onReschedule || onAdjustDate) && (
        <div className={`flex items-center gap-2 ${agenda ? "sm:col-start-2 justify-start" : "justify-end"}`}>
          {item.href && (
            <Link to={item.href} className="btn-outline text-[11px] !min-h-7 !px-2.5 !py-1">
              Open
            </Link>
          )}
          {onSetReminder && (
            <button
              type="button"
              className="btn-outline text-[11px] !min-h-7 !px-2.5 !py-1"
              onClick={onSetReminder}
            >
              <Bell className="h-3 w-3" /> Set reminder
            </button>
          )}
          {onMarkComplete && (
            <button
              type="button"
              className="btn-outline text-[11px] !min-h-7 !px-2.5 !py-1"
              onClick={onMarkComplete}
            >
              <CheckCircle2 className="h-3 w-3" /> Complete
            </button>
          )}
          {onReschedule && (
            <button
              type="button"
              className="btn-outline text-[11px] !min-h-7 !px-2.5 !py-1"
              onClick={onReschedule}
            >
              <RotateCcw className="h-3 w-3" /> Reschedule
            </button>
          )}
          {onAdjustDate && (
            <button
              type="button"
              className="btn-outline text-[11px] !min-h-7 !px-2.5 !py-1"
              onClick={onAdjustDate}
            >
              <CalendarDays className="h-3 w-3" /> Adjust date
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function buildCalendarItems(tenantId: string, userId: string): CalendarItem[] {
  const reminders = [
    ...api.reminders.listForUser(tenantId, userId),
    ...api.reminders.listDismissedForUser(tenantId, userId),
  ].map(reminderToItem);
  const tasks = api.tasks
    .listByTenant(tenantId)
    .filter((task) => !!task.dueAt && taskBelongsToUser(task, userId))
    .filter((task) => api.tasks.statusOf(task) !== "snoozed")
    .map(taskToItem);
  const events = api.calendarEvents.listForUser(tenantId, userId).map((event) => eventToItem(event, userId));
  return [...reminders, ...tasks, ...events].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
}

function reminderToItem(reminder: Reminder): CalendarItem {
  const task = reminder.taskId ? api.tasks.listByTenant(reminder.tenantId).find((row) => row.id === reminder.taskId) : undefined;
  const isCompanyReminder = reminder.scope === "company";
  return {
    id: reminder.id,
    source: isCompanyReminder ? "companyReminder" : "reminder",
    title: reminder.title ?? task?.title ?? "Reminder",
    detail: [isCompanyReminder ? "Company reminder" : undefined, reminder.note].filter(Boolean).join(" - "),
    startsAt: reminder.remindAt,
    importance: reminder.importance ?? "info",
    href: reminder.taskId ? `/employee/tasks?focus=${reminder.taskId}` : undefined,
    completedAt: reminder.dismissedAt,
  };
}

function taskToItem(task: Task): CalendarItem {
  const status = api.tasks.statusOf(task);
  return {
    id: task.id,
    source: "activity",
    title: task.title,
    detail: task.aiSummary ?? task.description,
    startsAt: task.dueAt!,
    importance: task.severity ?? "info",
    href: `/employee/tasks?focus=${task.id}`,
    completedAt: task.completedAt ?? (status === "resolved" ? task.createdAt : undefined),
  };
}

function eventToItem(event: CalendarEvent, userId: string): CalendarItem {
  const isMeeting = event.kind === "meeting";
  const organizer = api.users.get(event.organizerId ?? event.userId);
  const eventReminders = api.reminders.listForCalendarEvent(event.id, userId);
  const attendees = (event.attendeeStatuses ?? [])
    .map((attendee) => {
      const staff = api.users.get(attendee.userId);
      return staff ? `${staff.name} ${attendee.status}` : undefined;
    })
    .filter(Boolean)
    .join(", ");
  return {
    id: event.id,
    source: isMeeting ? "meeting" : "event",
    title: event.title,
    detail: [
      isMeeting ? `Organizer: ${organizer?.name ?? "Agency teammate"}` : undefined,
      attendees ? `Attendees: ${attendees}` : undefined,
      eventReminders.length > 0 ? `Reminder set for ${fmt.dateTime(eventReminders[0].remindAt)}` : undefined,
      event.description,
    ]
      .filter(Boolean)
      .join(" - "),
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    importance: event.importance,
    location: event.location,
    completedAt: event.completedAt,
  };
}

function taskBelongsToUser(task: Task, userId: string): boolean {
  return task.assignedToId === userId || (task.additionalAssignedToIds ?? []).includes(userId);
}

function isCalendarEventItem(item: CalendarItem): boolean {
  return item.source === "event" || item.source === "meeting";
}

function calendarTitle(view: CalendarView, selectedDate: string): string {
  const date = parseDateKey(selectedDate);
  if (view === "month") {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (view === "week") {
    const start = startOfWeek(date);
    const end = addDays(start, 6);
    return `${fmt.date(dateKeyFromDate(start))} - ${fmt.date(dateKeyFromDate(end))}`;
  }
  return fmt.date(selectedDate);
}

function groupItemsByDate(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  items.forEach((item) => {
    const key = dateKeyFromIso(item.startsAt);
    const current = grouped.get(key) ?? [];
    current.push(item);
    grouped.set(
      key,
      current.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1))
    );
  });
  return grouped;
}

function itemsForDate(itemsByDate: Map<string, CalendarItem[]>, dateKey: string): CalendarItem[] {
  return itemsByDate.get(dateKey) ?? [];
}

function newEventForm(dateKey: string): CalendarEventForm {
  return {
    title: "",
    description: "",
    startsAt: `${dateKey}T09:00`,
    endsAt: `${dateKey}T09:30`,
    importance: "info",
    location: "",
  };
}

function newEventReminderForm(eventStartsAtLocalOrIso: string): EventReminderForm {
  const eventStartIso = fromDateTimeLocalValue(eventStartsAtLocalOrIso) ?? eventStartsAtLocalOrIso;
  const eventStart = new Date(eventStartIso);
  const reminder = Number.isFinite(eventStart.getTime())
    ? addMinutes(eventStart, -15)
    : new Date();
  return {
    remindAt: dateTimeLocalFromDate(reminder),
    note: "",
    importance: "info",
  };
}

function moveEventFormToDate(form: CalendarEventForm, dateKey: string): CalendarEventForm {
  return {
    ...form,
    startsAt: `${dateKey}T${timePart(form.startsAt, "09:00")}`,
    endsAt: `${dateKey}T${timePart(form.endsAt, "09:30")}`,
  };
}

function timePart(value: string, fallback: string): string {
  return value.includes("T") ? value.split("T")[1] || fallback : fallback;
}

function validEndIso(startsAt: string, endLocalValue: string): string | undefined {
  const endsAt = fromDateTimeLocalValue(endLocalValue);
  if (!endsAt) return undefined;
  return new Date(endsAt).getTime() > new Date(startsAt).getTime() ? endsAt : undefined;
}

function timeLabel(startIso: string, endIso?: string): string {
  const start = new Date(startIso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (!endIso) return start;
  const end = new Date(endIso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${start} - ${end}`;
}

function compactTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
}

function hourLabel(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function sourceLabel(source: CalendarItemSource): string {
  if (source === "activity") return "Activity";
  if (source === "meeting") return "Meeting";
  if (source === "companyReminder") return "Company reminder";
  if (source === "reminder") return "Reminder";
  return "Event";
}

function sourceTone(source: CalendarItemSource): "neutral" | "info" | "success" | "warn" | "gold" {
  if (source === "activity") return "gold";
  if (source === "meeting") return "success";
  if (source === "companyReminder") return "warn";
  if (source === "reminder") return "info";
  return "neutral";
}

function importanceLabel(importance: TaskSeverity): string {
  if (importance === "urgent") return "High";
  if (importance === "warning") return "Medium";
  return "Low";
}

function chipClass(item: CalendarItem): string {
  const urgent = item.importance === "urgent" ? "ring-1 ring-alert/25" : "";
  if (item.source === "activity") return `border-gold-200 border-l-gold-600 bg-gold-50 text-gold-900 ${urgent}`;
  if (item.source === "meeting") return `border-emerald-100 border-l-emerald-600 bg-emerald-50 text-emerald-900 ${urgent}`;
  if (item.source === "companyReminder") return `border-violet-100 border-l-violet-600 bg-violet-50 text-violet-900 ${urgent}`;
  if (item.source === "reminder") return `border-blue-100 border-l-blue-600 bg-blue-50 text-blue-900 ${urgent}`;
  if (item.importance === "urgent") return "border-rose-100 border-l-alert bg-alert-soft text-alert ring-1 ring-alert/25";
  if (item.importance === "warning") return "border-amber-100 border-l-amber-500 bg-amber-50 text-amber-900";
  return "border-emerald-100 border-l-emerald-600 bg-emerald-50 text-emerald-900";
}

function isWithinDisplayedHours(iso: string): boolean {
  const hour = new Date(iso).getHours();
  return hour >= DAY_HOURS[0] && hour <= DAY_HOURS[DAY_HOURS.length - 1];
}

function dateKeyFromIso(value: string): string {
  return dateKeyFromDate(new Date(value));
}

function dateKeyFromDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function fromDateTimeLocalValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function dateTimeLocalFromDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMinutes(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + amount);
  return next;
}

function addMonths(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
}

function startOfWeek(date: Date): Date {
  return addDays(date, -date.getDay());
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}
