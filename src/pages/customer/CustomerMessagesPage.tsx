import { useEffect, useMemo, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { RichMessageBody } from "@/components/messages/RichMessageBody";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Card";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { markCustomerMessagesSeen } from "@/lib/customerMessages";
import { subscribeToDbChanges } from "@/lib/db";
import { fmt } from "@/lib/format";
import { useCustomer } from "@/lib/useCustomer";

export function CustomerMessagesPage() {
  const customer = useCustomer();
  const { user } = useAuth();
  const [revision, setRevision] = useState(0);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => subscribeToDbChanges(() => setRevision((value) => value + 1)), []);

  const rows = useMemo(
    () =>
      customer
        ? api.communications
            .listByCustomer(customer.id)
            .slice()
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : [],
    [customer, revision]
  );

  useEffect(() => {
    if (customer) markCustomerMessagesSeen(customer.id, rows);
  }, [customer, rows]);

  if (!customer || !user) return null;
  const activeCustomer = customer;
  const currentUser = user;

  function sendMessage() {
    const message = body.trim();
    if (!message) return;
    api.communications.create({
      tenantId: activeCustomer.tenantId,
      customerId: activeCustomer.id,
      channel: "email",
      direction: "inbound",
      subject: subject.trim() || "Message from client portal",
      body: message,
      isRead: false,
      createdById: currentUser.id,
    });
    setSubject("");
    setBody("");
    setNotice("Message sent to your agency.");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-ink-500">Your conversation with the agency.</p>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="max-h-[55vh] min-h-[18rem] space-y-4 overflow-y-auto p-5" aria-live="polite">
          {rows.length === 0 ? (
            <EmptyState
              title="No messages yet"
              description="Send a message below and it will appear for your agency immediately."
              icon={<MessageCircle className="h-6 w-6" />}
            />
          ) : (
            rows.map((row) => {
              const fromCustomer = row.direction === "inbound";
              return (
                <div key={row.id} className={`flex ${fromCustomer ? "justify-end" : "justify-start"}`}>
                  <article
                    className={`max-w-[85%] rounded-lg border px-4 py-3 text-sm shadow-sm ${
                      fromCustomer
                        ? "border-gold-300 bg-gold-50 text-ink-950"
                        : "border-ink-100 bg-white text-ink-950"
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
                      <strong className="text-ink-800">{fromCustomer ? "You" : "Your agency"}</strong>
                      <span>{fmt.relative(row.createdAt)}</span>
                      {row.subject && <span className="font-medium text-ink-600">{row.subject}</span>}
                    </div>
                    <RichMessageBody body={row.body} tenantId={customer.tenantId} message={row} />
                  </article>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-ink-100 bg-ink-50/60 p-5">
          <div className="grid gap-3">
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-600">
              Subject
              <input
                className="input normal-case tracking-normal"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="What can we help with?"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-600">
              Message
              <textarea
                className="input min-h-28 resize-y normal-case tracking-normal"
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setNotice("");
                }}
                placeholder="Write your message..."
              />
            </label>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-emerald-700" role="status">{notice}</span>
              <Button
                variant="primary"
                icon={<Send className="h-4 w-4" />}
                disabled={!body.trim()}
                onClick={sendMessage}
              >
                Send message
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
