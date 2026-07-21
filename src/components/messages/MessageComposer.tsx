import { useEffect, useRef, useState } from "react";
import { Loader2, Mail, Paperclip, Plus, Reply, Send, Sparkles, Wand2, X } from "lucide-react";
import { aiEmailSubject, aiEnhanceMessage } from "@/lib/ai";
import { plainTextToEmailHtml } from "@/lib/emailHtml";
import { fileToCommunicationAttachment, formatAttachmentSize } from "@/lib/messageAttachments";
import type { CommunicationAttachment } from "@/types";

// =====================================================================
// Shared email-only composer for the customer/prospect/holder/carrier
// message threads. Two send modes:
//
//   • New chat — exposes a Subject field (with an AI "Suggest" button)
//     and starts a fresh threadId.
//   • Reply    — answers a specific message; subject is locked to
//     "Re: <thread subject>" and the reply inherits that thread.
//
// The parent owns the reply target (set from a per-message Reply button
// in the feed) and performs the actual api.communications.create in `onSend`.
// =====================================================================

export interface ReplyTarget {
  threadId: string;
  subject: string; // already normalized to "Re: …"
  replyToId: string;
  toSummary: string; // short label e.g. the original subject
  externalThreadId?: string;
  replyToMessageIdHeader?: string;
  references?: string[];
}

export interface ComposedMessage {
  channel: "email";
  body: string;
  bodyHtml?: string;
  subject?: string;
  threadId?: string;
  replyToId?: string;
  externalThreadId?: string;
  replyToMessageIdHeader?: string;
  references?: string[];
  attachments?: CommunicationAttachment[];
}

export interface ComposerDraftSeed {
  id: string;
  body: string;
  subject?: string;
  attachments?: CommunicationAttachment[];
}

export function newThreadId(): string {
  return `thread_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function MessageComposer({
  replyTarget,
  draftSeed,
  onCancelReply,
  onSend,
  busy,
  contactName,
}: {
  replyTarget: ReplyTarget | null;
  draftSeed?: ComposerDraftSeed | null;
  onCancelReply: () => void;
  onSend: (msg: ComposedMessage) => void;
  busy?: boolean;
  contactName?: string;
}) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [attachments, setAttachments] = useState<CommunicationAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);

  // When a reply target is set the subject is fixed; clear the manual
  // subject draft so it doesn't leak into the next new chat.
  useEffect(() => {
    if (replyTarget) setSubject("");
  }, [replyTarget]);

  useEffect(() => {
    if (!draftSeed) {
      if (loadedDraftIdRef.current) {
        loadedDraftIdRef.current = null;
        setBody("");
        setSubject("");
        setAttachments([]);
      }
      return;
    }
    loadedDraftIdRef.current = draftSeed.id;
    setBody(draftSeed.body);
    setSubject(draftSeed.subject ?? "");
    setAttachments(draftSeed.attachments ?? []);
    const frame = window.requestAnimationFrame(() => taRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [draftSeed]);

  // Auto-grow the textarea downward as the draft gets longer (the box
  // stays a fixed width; only its height tracks the content). Capped
  // by a max-height in CSS, after which it scrolls.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const replying = !!replyTarget;

  async function suggestSubject() {
    if (!body.trim()) return;
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
      const improved = await aiEnhanceMessage({ body, channel: "email", contactName });
      setBody(improved);
    } finally {
      setEnhancing(false);
    }
  }

  function handleSend() {
    if (!body.trim() && attachments.length === 0) return;
    const cleanBody = body.trim() || "Please see attached.";
    const bodyHtml = plainTextToEmailHtml(cleanBody);
    if (replyTarget) {
      onSend({
        channel: "email",
        body: cleanBody,
        bodyHtml,
        subject: replyTarget.subject,
        threadId: replyTarget.threadId,
        replyToId: replyTarget.replyToId,
        externalThreadId: replyTarget.externalThreadId,
        replyToMessageIdHeader: replyTarget.replyToMessageIdHeader,
        references: replyTarget.references,
        attachments,
      });
    } else {
      onSend({
        channel: "email",
        body: cleanBody,
        bodyHtml,
        subject: subject.trim() || (attachments.length > 0 ? "Files from your agent" : "A message from your agent"),
        threadId: newThreadId(),
        attachments,
      });
    }
    setBody("");
    setSubject("");
    setAttachments([]);
  }

  async function handleFiles(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setAttaching(true);
    try {
      const next = await Promise.all(picked.map(fileToCommunicationAttachment));
      setAttachments((current) => [...current, ...next]);
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  return (
    <div className="border-t border-ink-100 p-3 space-y-2 shrink-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1.5 rounded border border-gold-300 bg-gold-50 px-2.5 py-1 text-[11px] font-semibold text-gold-800">
          <Mail className="h-3 w-3" />
          EMAIL
        </div>
        {!replying && <div className="text-[11px] text-ink-400">New chat</div>}
      </div>

      {/* Prominent "replying to" banner — full width, above the draft so
          it's obvious which message you're answering. */}
      {replying && (
        <div className="flex items-center justify-between gap-3 rounded-full border border-blue-300 bg-blue-50 pl-4 pr-2 py-2 text-sm text-blue-800 shadow-sm">
          <span className="inline-flex items-center gap-2 min-w-0">
            <Reply className="h-4 w-4 shrink-0 text-blue-600" />
            <span className="font-semibold shrink-0">
              {draftSeed ? "AI draft ready" : "Replying to"}
            </span>
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
          subject. */}
      {!replying && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[160px] flex-1">
              <input
                className="input text-sm"
                placeholder="Subject"
                value={subject}
                spellCheck={true}
                lang="en-US"
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-outline text-[11px] !px-2.5 !py-2 shrink-0"
              onClick={suggestSubject}
              disabled={suggesting || !body.trim()}
              title="AI reads the message body and suggests a subject"
            >
              {suggesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-gold-600" />
              )}
              AI subject
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={taRef}
        className="input text-sm w-full min-h-[60px] max-h-72 resize-none overflow-y-auto"
        placeholder={replying ? "Write your reply..." : "New email message..."}
        value={body}
        spellCheck={true}
        lang="en-US"
        autoCapitalize="sentences"
        onChange={(e) => setBody(e.target.value)}
      />
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-700"
            >
              <Paperclip className="h-3 w-3 shrink-0 text-ink-400" />
              <span className="max-w-[13rem] truncate">{attachment.fileName}</span>
              {attachment.sizeBytes ? (
                <span className="shrink-0 text-ink-400">{formatAttachmentSize(attachment.sizeBytes)}</span>
              ) : null}
              <button
                type="button"
                className="text-ink-400 hover:text-rose-600"
                onClick={() => removeAttachment(attachment.id)}
                title={`Remove ${attachment.fileName}`}
                aria-label={`Remove ${attachment.fileName}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-outline text-[11px] !py-1 inline-flex items-center gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={attaching || busy}
          title="Attach a file from your computer"
          aria-label="Attach a file"
        >
          {attaching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <button
          type="button"
          className="btn-outline text-[11px] !py-1 inline-flex min-w-[150px] flex-1 items-center gap-1"
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
          disabled={busy || attaching || (!body.trim() && attachments.length === 0)}
        >
          <Send className="h-4 w-4" />
          {busy ? "Sending…" : replying ? "Reply" : "Send"}
        </button>
      </div>
    </div>
  );
}
