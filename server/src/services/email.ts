// Email service. Uses SendGrid by default when SENDGRID_API_KEY is present,
// or Resend when RESEND_API_KEY is present. Without credentials it returns a
// demo queue result so local demos keep working without pretending a message
// was actually delivered.

export type EmailSendResult = {
  id: string;
  status: "sent" | "demo_queued" | "failed";
  provider: "sendgrid" | "resend" | "demo";
  configured: boolean;
  error?: string;
};

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  categories?: string[];
}): Promise<EmailSendResult> {
  const provider = preferredEmailProvider();
  const from = args.from ?? emailFromAddress();

  if (provider === "sendgrid") return sendWithSendGrid({ ...args, from });
  if (provider === "resend") return sendWithResend({ ...args, from });

  return {
    id: `email_demo_${Date.now()}`,
    status: "demo_queued",
    provider: "demo",
    configured: false,
  };
}

export function unsubscribeUrl(email: string, kind: "marketing" | "all" = "marketing") {
  const base = process.env.FRONTEND_ORIGIN ?? "https://quotex.example";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&kind=${kind}`;
}

function preferredEmailProvider(): "sendgrid" | "resend" | "demo" {
  const explicit = env("EMAIL_PROVIDER").toLowerCase();
  if (explicit === "sendgrid" && env("SENDGRID_API_KEY")) return "sendgrid";
  if (explicit === "resend" && env("RESEND_API_KEY")) return "resend";
  if (env("SENDGRID_API_KEY")) return "sendgrid";
  if (env("RESEND_API_KEY")) return "resend";
  return "demo";
}

function emailFromAddress() {
  return (
    env("EMAIL_FROM") ||
    env("SENDGRID_FROM_EMAIL") ||
    env("RESEND_FROM_EMAIL") ||
    "Quotex Insurance <no-reply@quotex.example>"
  );
}

function env(key: string) {
  return process.env[key]?.trim() ?? "";
}

async function sendWithSendGrid(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
  categories?: string[];
}): Promise<EmailSendResult> {
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env("SENDGRID_API_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.to }] }],
        from: parseEmailAddress(args.from),
        subject: args.subject,
        content: [
          ...(args.text ? [{ type: "text/plain", value: args.text }] : []),
          { type: "text/html", value: args.html },
        ],
        categories: args.categories?.slice(0, 10),
      }),
    });

    if (!res.ok) {
      return {
        id: `email_failed_${Date.now()}`,
        status: "failed",
        provider: "sendgrid",
        configured: true,
        error: await safeResponseText(res),
      };
    }

    return {
      id: res.headers.get("x-message-id") ?? `sendgrid_${Date.now()}`,
      status: "sent",
      provider: "sendgrid",
      configured: true,
    };
  } catch (error) {
    return {
      id: `email_failed_${Date.now()}`,
      status: "failed",
      provider: "sendgrid",
      configured: true,
      error: error instanceof Error ? error.message : "Unknown SendGrid error",
    };
  }
}

async function sendWithResend(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
}): Promise<EmailSendResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    const json = (await safeJson(res)) as { id?: string; message?: string; error?: string } | null;

    if (!res.ok) {
      return {
        id: `email_failed_${Date.now()}`,
        status: "failed",
        provider: "resend",
        configured: true,
        error: json?.message ?? json?.error ?? (await safeResponseText(res)),
      };
    }

    return {
      id: json?.id ?? `resend_${Date.now()}`,
      status: "sent",
      provider: "resend",
      configured: true,
    };
  } catch (error) {
    return {
      id: `email_failed_${Date.now()}`,
      status: "failed",
      provider: "resend",
      configured: true,
      error: error instanceof Error ? error.message : "Unknown Resend error",
    };
  }
}

function parseEmailAddress(from: string): { email: string; name?: string } {
  const match = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return { email: from };
  const [, rawName, email] = match;
  const name = rawName.trim().replace(/^"|"$/g, "");
  return name ? { email: email.trim(), name } : { email: email.trim() };
}

async function safeJson(res: Response): Promise<unknown | null> {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
