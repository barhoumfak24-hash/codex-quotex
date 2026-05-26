import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, MessageSquare, Reply, Send, Sparkles, Wand2, X } from "lucide-react";
import { aiEmailSubject, aiEnhanceMessage } from "@/lib/ai";

// =====================================================================
// Shared email/SMS composer for the customer/prospect/carrier message
// threads. Two send modes for email:
//
//   • New chat — exposes a Subject field (with an AI "Suggest" button)
//     and starts a fresh threadId.
//   • Reply    — answers a specific message; subject is locked to
//     "Re: <thread subject>" and the reply inherits that thread.
//
// SMS is always flat (no subject / thread). The parent owns the
// reply target (set from a per-message Reply button in the feed) and
// performs the actual api.communications.create in `onSend`.
// =====================================================================

export interface ReplyTarget {
  threadId: string;
  subject: string; // already normalized to "Re: …"
  replyToId: string;
  toSummary: string; // short label e.g. the original subject
}

export interface ComposedMessage {
  channel: "email" | "sms";
  body: string;
  subject?: string;
  threadId?: string;
  replyToId?: string;
}

export function newThreadId(): string {
  return `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function MessageComposer({
  channel,
  onChannelChange,
  replyTarget,
  onCancelReply,
  onSend,
  busy,
  contactName,
  allowSms = true,
}: {
  channel: "email" | "sms";
  onChannelChange: (c: "email" | "sms") => void;
  replyTarget: ReplyTarget | null;
  onCancelReply: () => void;
  onSend: (msg: ComposedMessage) => void;
  busy?: boolean;
  contactName?: string;
  allowSms?: boolean;
}) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // When a reply target is set the subject is fixed; clear the manual
  // subject draft so it doesn't leak into the next new chat.
  useEffect(() => {
    if (replyTarget) setSubject("");
  }, [replyTarget]);

  // Auto-grow the textarea downward as the draft gets longer (the box
  // stays a fixed width; only its height tracks the content). Capped
  // by a max-height in CSS, after which it scrolls.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const isEmail = channel === "email";
  const replying = isEmail && !!replyTarget;

  async function suggestSubject() {
    setSuggesting(true);
    try {
      const s = await aiEmailSubject({ body, contactName });
      setSubject(s);
    } finally {
      setSuggesting(false);
    }
  }

  async function enhanceMessage() {
    if (!body.trim()) return;
    setEnhancing(true);
    try {
      const improved = await aiEnhanceMessage({ body, channel, contactName });
      setBody(improved);
    } finally {
      setEnhancing(false);
    }
  }

  function handleSend() {
    if (!body.trim()) return;
    if (!isEmail) {
      onSend({ channel: "sms", body: body.trim() });
      setBody("");
      return;
    }
    if (replyTarget) {
      onSend({
        channel: "email",
        body: body.trim(),
        subject: replyTarget.subject,
        threadId: replyTarget.threadId,
        replyToId: replyTarget.replyToId,
      });
    } else {
      onSend({
        channel: "email",
        body: body.trim(),
        subject: subject.trim() || "A message from your agent",
        threadId: newThreadId(),
      });
    }
    setBody("");
    setSubject("");
  }

  return (
    <div className="border-t border-ink-100 p-3 space-y-2 shrink-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {(["email", ...(allowSms ? ["sms"] : [])] as ("email" | "sms")[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChannelChange(c)}
              className={`text-[11px] px-2.5 py-1 rounded border inline-flex items-center gap-1 ${
                channel === c
                  ? "bg-gold-100 border-gold-300 text-gold-800"
                  : "bg-white border-ink-200 text-ink-600 hover:border-ink-300"
              }`}
            >
              {c === "email" ? (
                <Mail className="h-3 w-3" />
              ) : (
                <MessageSquare className="h-3 w-3" />
              )}
              {c.toUpperCase()}
            </button>
          ))}
        </div>
        {/* Email mode: show "New chat" hint here; the active-reply
            indicator gets its own prominent banner below. */}
        {isEmail && !replying && (
          <div className="text-[11px] text-ink-400">New chat</div>
        )}
      </div>

      {/* Prominent "replying to" banner — full width, above the draft so
          it's obvious which message you're answering. */}
      {isEmail && replying && (
        <div className="flex items-center justify-between gap-3 rounded-full border border-blue-300 bg-blue-50 pl-4 pr-2 py-2 text-sm text-blue-800 shadow-sm">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Reply className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="font-semibold shrink-0">Replying to</span>
            <span className="truncate text-blue-700">{replyTarget!.toSummary}</span>
          </span>
          <button
            type="button"
            className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full text-blue-600 hover:bg-blue-100 hover:text-blue-900"
            onClick={onCancelReply}
            title="Cancel reply / start a new chat instead"
            aria-label="Cancel reply"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Subject — only for a new email chat. Replies reuse the thread
          subject; SMS has none. */}
      {isEmail && !replying && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <input
              className="input text-sm"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-outline text-[11px] !px-2.5 !py-2 shrink-0"
            onClick={suggestSubject}
            disabled={suggesting}
            title="Let AI suggest a subject from your draft"
          >
            {suggesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-gold-600" />
            )}
            Suggest
          </button>
        </div>
      )}

      <textarea
        ref={taRef}
        className="input text-sm w-full min-h-[60px] max-h-72 resize-none overflow-y-auto"
        placeholder={
          replying ? "Write your reply…" : `New ${channel.toUpperCase()} message…`
        }
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-outline text-[11px] !py-1 inline-flex items-center gap-1"
          onClick={enhanceMessage}
          disabled={enhancing || !body.trim()}
          title="Let AI rewrite your draft into a clearer, more polished message"
        >
          {enhancing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wand2 className="h-3.5 w-3.5 text-gold-600" />
          )}
          {enhancing ? "Enhancing…" : "Enhance with AI"}
        </button>
        <button
          type="button"
          className="btn-gold text-sm font-semibold shrink-0 !px-6 !py-2.5 shadow-sm"
          onClick={handleSend}
          disabled={busy || !body.trim()}
        >
          <Send className="h-4 w-4" />
          {busy ? "Sending…" : replying ? "Reply" : "Send"}
        </button>
      </div>
    </div>
  );
}