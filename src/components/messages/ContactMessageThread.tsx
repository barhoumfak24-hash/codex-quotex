import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Bot, Mail, MessageSquare, Reply, Zap } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import {
  MessageComposer,
  type ComposedMessage,
  type ReplyTarget,
} from "@/components/messages/MessageComposer";
import { api } from "@/lib/api";
import { fmt } from "@/lib/format";
import type { Communication, MarketingMessage } from "@/types";

// Build a reply target from a clicked message — inherit its thread
// (or seed one from the message id) and normalize the subject to
// "Re: …".
function replyTargetFor(row: Communication | MarketingMessage): ReplyTarget {
  const threadId = (row as Communication).threadId ?? `thread_msg_${row.id}`;
  const rawSubject = row.subject?.trim() || "your message";
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  return { threadId, subject, replyToId: row.id, toSummary: rawSubject };
}

// =====================================================================
// Inline iPhone-style message thread between an agent / manager and
// one client or prospect. Merges every channel into one chronological
// feed:
//
//   • Communications (inbound replies, agent outbound notes)
//   • MarketingMessages (AI sends + custom message sends)
//
// Composer at the bottom lets the agent reply via email or SMS in one
// click. Used on the client + prospect detail pages so the user
// doesn't have to leave the record to read or respond.
// =====================================================================

type Row =
  | { kind: "comm"; row: Communication }
  | { kind: "out"; row: MarketingMessage };

export function ContactMessageThread({
  tenantId,
  userId,
  contactKind,
  contactId,
  onChanged,
  defaultChannel = "email",
  fillHeight = false,
}: {
  tenantId: string;
  userId: string;
  contactKind: "client" | "prospect";
  contactId: string;
  onChanged?: () => void;
  defaultChannel?: "email" | "sms";
  // When true the thread fills its parent's height (used inside the
  // expand-to-full-screen card) instead of the default capped height.
  fillHeight?: boolean;
}) {
  const [channel, setChannel] = useState<"email" | "sms">(defaultChannel);
  const [busy, setBusy] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  // Deep-link target: `?msg=<communicationId|marketingMessageId>`
  // from the timeline detail modal. Scrolls the matching bubble
  // into view and applies a short-lived gold ring highlight so the
  // user can spot it.
  const [searchParams, setSearchParams] = useSearchParams();
  const targetMessageId = searchParams.get("msg");
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  useEffect(() => {
    if (!targetMessageId) return;
    const el = messageRefs.current[targetMessageId];
    if (!el) return;
    // Wait a tick so the page settles after any hash-scroll on the
    // parent card, then scroll the message into view + flash it.
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(targetMessageId);
      // Auto-fade the highlight + drop the search param so the
      // ring doesn't return on every re-render.
      window.setTimeout(() => {
        setHighlightedId(null);
        const next = new URLSearchParams(searchParams);
        next.delete("msg");
        setSearchParams(next, { replace: true });
      }, 2400);
    }, 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMessageId, contactId]);

  const comms = api.communications
    .listByTenant(tenantId)
    .filter((c) =>
      contactKind === "client"
        ? c.customerId === contactId
        : c.prospectId === contactId
    );
  const outbound = api.marketing
    .listMessages(tenantId)
    .filter((m) =>
      contactKind === "client"
        ? m.customerId === contactId
        : m.prospectId === contactId
    );
  const merged: Row[] = [
    ...comms.map((c) => ({ kind: "comm" as const, row: c })),
    ...outbound.map((m) => ({ kind: "out" as const, row: m })),
  ].sort((a, b) => {
    const aAt =
      a.kind === "comm" ? a.row.createdAt : a.row.sentAt ?? a.row.createdAt;
    const bAt =
      b.kind === "comm" ? b.row.createdAt : b.row.sentAt ?? b.row.createdAt;
    return aAt < bAt ? -1 : 1;
  });
  // Email and SMS are viewed separately — the channel toggle filters
  // the feed down to one medium at a time (and drives the composer).
  const visibleRows = merged.filter((r) => r.row.channel === channel);

  // Land on the most recent message whenever the thread is opened,
  // the channel changes, the card is expanded, or a new message lands.
  // (Skip when a ?msg= deep-link wants a specific bubble instead.)
  useEffect(() => {
    if (targetMessageId) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [contactId, channel, fillHeight, visibleRows.length, targetMessageId]);

  function send(msg: ComposedMessage) {
    setBusy(true);
    try {
      // Signature is auto-appended inside api.communications.create
      // based on the sender's saved emailSignature + images.
      api.communications.create({
        tenantId,
        customerId: contactKind === "client" ? contactId : undefined,
        prospectId: contactKind === "prospect" ? contactId : undefined,
        channel: msg.channel,
        direction: "outbound",
        subject: msg.subject,
        threadId: msg.threadId,
        replyToId: msg.replyToId,
        body: msg.body,
        createdById: userId,
      });
      setReplyTarget(null);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-md border border-ink-100 flex flex-col ${
        fillHeight ? "h-full" : "max-h-[480px]"
      }`}
    >
      {/* Channel switch — Email and SMS are kept in separate views. */}
      <div className="px-3 pt-2 shrink-0 border-b border-ink-100 pb-2">
        <div className="inline-flex rounded-md border border-ink-200 overflow-hidden text-xs">
          <button
            type="button"
            onClick={() => setChannel("email")}
            className={`inline-flex items-center gap-1 px-3 py-1.5 ${
              channel === "email"
                ? "bg-ink-900 text-white"
                : "bg-white text-ink-700 hover:bg-ink-50"
            }`}
          >
            <Mail className="h-3.5 w-3.5" /> Email
          </button>
          <button
            type="button"
            onClick={() => setChannel("sms")}
            className={`inline-flex items-center gap-1 px-3 py-1.5 border-l border-ink-200 ${
              channel === "sms"
                ? "bg-ink-900 text-white"
                : "bg-white text-ink-700 hover:bg-ink-50"
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" /> SMS
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-[200px]">
        {visibleRows.length === 0 ? (
          <div className="text-sm text-ink-400 text-center py-6">
            No {channel === "email" ? "email" : "SMS"} messages yet — send the first one below.
          </div>
        ) : (
          visibleRows.map((r, i) => {
            const isInbound = r.kind === "comm" && r.row.direction === "inbound";
            const isOutboundComm =
              r.kind === "comm" && r.row.direction === "outbound";
            const isAi = r.kind === "out";
            const at =
              r.kind === "comm"
                ? r.row.createdAt
                : r.row.sentAt ?? r.row.createdAt;
            const text = r.kind === "comm" ? r.row.body : r.row.content;
            const channelChip =
              r.kind === "comm" ? String(r.row.channel) : r.row.channel;
            const messageId = r.row.id;
            const isHighlighted = highlightedId === messageId;
            const aiTaskId = r.kind === "comm" ? r.row.aiActivityTaskId : undefined;
            return (
              <div
                key={i}
                className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
              >
                <div
                  ref={(el) => {
                    messageRefs.current[messageId] = el;
                  }}
                  className={`w-[min(85%,600px)] rounded-lg px-3 py-2 text-sm transition-shadow duration-300 ${
                    isInbound
                      ? "bg-ink-100 text-ink-900"
                      : isOutboundComm
                      ? "bg-gold-100 text-ink-900"
                      : "bg-violet-100 text-violet-900"
                  } ${aiTaskId ? "ring-2 ring-violet-300" : ""} ${
                    isHighlighted
                      ? "ring-4 ring-gold-300 ring-offset-2 ring-offset-white shadow-lg"
                      : ""
                  }`}
                >
                  <div className="text-[10px] text-ink-500 mb-0.5 flex items-center gap-1">
                    {isAi && <Bot className="h-3 w-3 text-violet-600" />}
                    {isInbound ? "Inbound" : isOutboundComm ? "You" : "AI send"}
                    {" · "}
                    {channelChip.toUpperCase()}
                    {" · "}
                    {fmt.dateTime(at)}
                    {r.kind === "out" && (
                      <Badge
                        tone={r.row.deliveryStatus === "opened" ? "success" : "info"}
                      >
                        {fmt.titleCase(r.row.deliveryStatus)}
                      </Badge>
                    )}
                  </div>
                  {r.row.subject && (
                    <div className="font-medium mb-0.5">{r.row.subject}</div>
                  )}
                  <p className="whitespace-pre-wrap leading-snug">{text}</p>
                  {/* Reply to this specific email → threads the
                      response under it. */}
                  {String(channelChip) === "email" && (
                    <button
                      type="button"
                      onClick={() => {
                        setChannel("email");
                        setReplyTarget(replyTargetFor(r.row));
                      }}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] text-ink-500 hover:text-ink-800"
                    >
                      <Reply className="h-3 w-3" /> Reply
                    </button>
                  )}
                  {aiTaskId && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-violet-300 bg-violet-50 px-2 py-1.5 text-[11px] text-violet-800">
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Zap className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                        <span className="truncate">AI opened an activity for this</span>
                      </span>
                      <Link
                        to={`/employee/tasks?focus=${aiTaskId}`}
                        className="shrink-0 inline-flex items-center gap-1 font-medium text-violet-700 hover:text-violet-900"
                      >
                        Go to activity →
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <MessageComposer
        channel={channel}
        onChannelChange={setChannel}
        replyTarget={replyTarget}
        onCancelReply={() => setReplyTarget(null)}
        onSend={send}
        busy={busy}
      />
    </div>
  );
}