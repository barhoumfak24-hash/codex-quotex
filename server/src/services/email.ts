// Email service. Choose SendGrid or Amazon SES via EMAIL_PROVIDER env.
// All marketing emails MUST include an unsubscribe link.

export async function sendEmail(_args: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  categories?: string[];
}) {
  return { id: "msg_stub", status: "queued" };
}

export function unsubscribeUrl(email: string, kind: "marketing" | "all" = "marketing") {
  const base = process.env.FRONTEND_ORIGIN ?? "https://quotex.example";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&kind=${kind}`;
}