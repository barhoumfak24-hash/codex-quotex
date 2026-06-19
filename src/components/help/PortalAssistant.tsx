import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bot, CheckCircle2, Send, Sparkles, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTenant } from "@/lib/tenant";
import {
  askPortalAssistantSmart,
  assistantStarters,
  executePortalAssistantAction,
  type AssistantAnswer,
  type AssistantContext,
  type AssistantExecutableAction,
  type AssistantHistoryItem,
} from "@/lib/portalAssistant";
import { isStaffRole } from "@/lib/roles";

// =====================================================================
// Floating portal help assistant for agents + managers.
//
// A bubble button bottom-right opens a chat panel. Questions are
// answered by the local knowledge base (src/lib/portalAssistant.ts);
// in production this swaps to a backend RAG endpoint. Answers carry
// tappable follow-up chips so the agent can keep drilling without
// typing. Conversation state lives in component memory — it resets
// when the panel is closed, which is fine for a help widget.
// =====================================================================

interface ChatMessage {
  id: string;
  from: "user" | "assistant";
  text: string;
  related?: string[];
  action?: AssistantAnswer["action"];
  actions?: AssistantAnswer["actions"];
  pendingAction?: AssistantExecutableAction;
  // Set on assistant messages so follow-up questions can be resolved
  // against the previously-discussed topic.
  topicId?: string;
}

let msgSeq = 0;
function nextId() {
  msgSeq += 1;
  return `m${msgSeq}`;
}

export function PortalAssistant() {
  const { user } = useAuth();
  const { agency } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const role = user?.role === "manager" ? "manager" : "agent";

  // Seed the greeting the first time the panel opens.
  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        {
          id: nextId(),
          from: "assistant",
          text: "Hi! I'm your portal assistant. Ask me anything about the portal, ask me to find a record, or tell me to prepare an action. I will show you exactly what I am about to do and ask for confirmation before changing anything.",
          related: assistantStarters(),
        },
      ]);
    }
  }, [open, messages.length]);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function send(raw: string) {
    const text = raw.trim();
    if (!text || thinking) return;
    const userMsg: ChatMessage = { id: nextId(), from: "user", text };
    // Snapshot the conversation BEFORE the new user turn so the
    // assistant sees the prior exchanges (last ~10) as context.
    const historySnapshot: AssistantHistoryItem[] = messages
      .slice(-10)
      .map((m) => ({ from: m.from, text: m.text, topicId: m.topicId }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    // Small delay so the reply feels considered (and mirrors the
    // async shape of the production fetch).
    window.setTimeout(() => {
      void (async () => {
        const ctx: AssistantContext | undefined =
          agency && user
            ? {
                tenantId: agency.id,
                viewer: { id: user.id, role: user.role },
                currentPath: `${location.pathname}${location.search}${location.hash}`,
              }
            : undefined;
        const answer: AssistantAnswer = await askPortalAssistantSmart(
          text,
          role,
          ctx,
          historySnapshot
        );
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            from: "assistant",
            text: answer.text,
            related: answer.related,
            action: answer.action,
            actions: answer.actions,
            pendingAction: answer.pendingAction,
            topicId: answer.topicId,
          },
        ]);
        setThinking(false);
      })();
    }, 400);
  }

  function context(): AssistantContext | null {
    if (!agency || !user) return null;
    return {
      tenantId: agency.id,
      viewer: { id: user.id, role: user.role },
      currentPath: `${location.pathname}${location.search}${location.hash}`,
    };
  }

  function confirmAction(action: AssistantExecutableAction) {
    const ctx = context();
    if (!ctx) return;
    const result = executePortalAssistantAction(action, ctx);
    const resultMessage: ChatMessage = {
      id: nextId(),
      from: "assistant",
      text: result.text,
      action: result.action,
    };
    setMessages((prev) => [
      ...prev.map((m) =>
        m.pendingAction === action ? { ...m, pendingAction: undefined } : m
      ),
      resultMessage,
    ]);
    if (result.success && result.action && action.kind === "navigate") {
      navigate(result.action.to);
      setOpen(false);
    }
  }

  function cancelAction(action: AssistantExecutableAction) {
    setMessages((prev) => [
      ...prev.map((m) =>
        m.pendingAction === action ? { ...m, pendingAction: undefined } : m
      ),
      {
        id: nextId(),
        from: "assistant",
        text: "Canceled. I did not change anything.",
      },
    ]);
  }

  // Only staff get the assistant. Customers/master never render it
  // (the layout decides, but guard here too).
  if (!user || !isStaffRole(user.role)) return null;

  return (
    <>
      {/* Launcher bubble */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-ink-900 text-white pl-3 pr-4 py-3 shadow-luxe hover:bg-ink-700 transition-colors"
          title="Ask the portal assistant"
        >
          <Bot className="h-5 w-5" />
          <span className="text-sm font-medium hidden sm:inline">Ask AI</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2.5rem))] h-[min(560px,calc(100vh-2.5rem))] flex flex-col rounded-xl border border-ink-200 bg-white shadow-luxe overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-ink-100 bg-ink-900 text-white">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/10">
                <Bot className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">Portal assistant</div>
                <div className="text-[11px] text-white/60 leading-tight">
                  Answers, record lookup, and confirmed actions
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white p-1"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Transcript */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-ink-50/40">
            {messages.map((m) => (
              <div key={m.id} className="space-y-2">
                <div
                  className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                      m.from === "user"
                        ? "bg-ink-900 text-white"
                        : "bg-white border border-ink-100 text-ink-800"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
                {m.from === "assistant" &&
                  (m.pendingAction ||
                    m.action ||
                    (m.actions && m.actions.length > 0) ||
                    (m.related && m.related.length > 0)) && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.pendingAction && (
                      <div className="w-full rounded-lg border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-ink-800 shadow-sm">
                        <div className="font-semibold text-ink-900 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-gold-700" />
                          Confirm action
                        </div>
                        <div className="mt-1 text-ink-700">{m.pendingAction.confirmation}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            onClick={() => confirmAction(m.pendingAction!)}
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            className="btn-outline text-xs"
                            onClick={() => cancelAction(m.pendingAction!)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {Array.from(
                      new Map(
                        [
                          ...(m.action ? [m.action] : []),
                          ...(m.actions ?? []),
                        ].map((action) => [action.to, action])
                      ).values()
                    ).map((action) => (
                      <Link
                        key={action.to}
                        to={action.to}
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1 rounded-md border border-ink-900 bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-700 transition-colors"
                      >
                        {action.label}
                      </Link>
                    ))}
                    {(m.related ?? []).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => send(r)}
                        className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] text-ink-700 hover:border-gold-300 hover:bg-gold-50 transition-colors text-left"
                      >
                        <Sparkles className="h-3 w-3 text-gold-600 shrink-0" />
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 bg-white border border-ink-100 text-ink-400 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-300 animate-bounce [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-300 animate-bounce [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-ink-300 animate-bounce" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            className="border-t border-ink-100 p-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={inputRef}
              className="input text-sm"
              placeholder="Ask or tell me what to do..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="btn-primary !px-3 !py-2 shrink-0"
              disabled={!input.trim() || thinking}
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <div className="px-3 pb-2 text-[10px] text-ink-400 text-center">
            Confirmed portal actions only. Not financial, legal, or coverage advice.
          </div>
        </div>
      )}
    </>
  );
}
