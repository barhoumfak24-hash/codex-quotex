import nodemailer from "nodemailer";

// Email service. Uses SendGrid, Resend, or SMTP when configured. Missing
// provider credentials fail loudly so production cannot silently pretend a
// message was delivered.

export type EmailSendResult = {
  id: string;
  status: "sent" | "failed";
  provider: "sendgrid" | "resend" | "smtp" | "unconfigured";
  configured: boolean;
  error?: string;
};

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  categories?: string[];
}): Promise<EmailSendResult> {
  const provider = preferredEmailProvider();
  const from = args.from ?? emailFromAddress();

  if (provider === "sendgrid") return sendWithSendGrid({ ...args, from });
  if (provider === "resend") return sendWithResend({ ...args, from });
  if (provider === "smtp") return sendWithSmtp({ ...args, from });

  return {
    id: `email_not_configured_${Date.now()}`,
    status: "failed",
    provider: "unconfigured",
    configured: false,
    error:
      "No email provider is configured. Add SENDGRID_API_KEY, RESEND_API_KEY, or SMTP credentials before sending.",
  };
}

export function emailDeliveryConfiguration() {
  const provider = preferredEmailProvider();
  return {
    configured: provider !== null,
    provider: provider ?? "unconfigured",
    from: provider ? emailFromAddress() : null,
  };
}

export function unsubscribeUrl(email: string, kind: "marketing" | "all" = "marketing") {
  const base = process.env.FRONTEND_ORIGIN ?? "https://quotexinsurance.com";
  return `${base}/unsubscribe?email=${encodeURIComponent(email)}&kind=${kind}`;
}

function preferredEmailProvider(): "sendgrid" | "resend" | "smtp" | null {
  const explicit = env("EMAIL_PROVIDER").toLowerCase();
  if (explicit === "sendgrid" && env("SENDGRID_API_KEY")) return "sendgrid";
  if (explicit === "resend" && env("RESEND_API_KEY")) return "resend";
  if (explicit === "smtp" && smtpConfigured()) return "smtp";
  if (env("SENDGRID_API_KEY")) return "sendgrid";
  if (env("RESEND_API_KEY")) return "resend";
  if (smtpConfigured()) return "smtp";
  return null;
}

function emailFromAddress() {
  return (
    env("EMAIL_FROM") ||
    env("SENDGRID_FROM_EMAIL") ||
    env("RESEND_FROM_EMAIL") ||
    env("SMTP_FROM_EMAIL") ||
    "Quotex Insurance <no-reply@quotexinsurance.com>"
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
  replyTo?: string;
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
        ...(args.replyTo ? { reply_to: parseEmailAddress(args.replyTo) } : {}),
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
  replyTo?: string;
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
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
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

async function sendWithSmtp(args: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from: string;
  replyTo?: string;
}): Promise<EmailSendResult> {
  try {
    const transporter = nodemailer.createTransport({
      host: env("SMTP_HOST"),
      port: smtpPort(),
      secure: smtpSecure(),
      auth: {
        user: env("SMTP_USER"),
        pass: env("SMTP_PASS"),
      },
      requireTLS: smtpRequireTls(),
    });
    const result = await transporter.sendMail({
      from: args.from,
      to: args.to,
      replyTo: args.replyTo,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    return {
      id: result.messageId || `smtp_${Date.now()}`,
      status: "sent",
      provider: "smtp",
      configured: true,
    };
  } catch (error) {
    return {
      id: `email_failed_${Date.now()}`,
      status: "failed",
      provider: "smtp",
      configured: true,
      error: error instanceof Error ? error.message : "Unknown SMTP error",
    };
  }
}

function smtpConfigured() {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

function smtpPort() {
  const raw = Number.parseInt(env("SMTP_PORT"), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return smtpSecure() ? 465 : 587;
}

function smtpSecure() {
  const raw = env("SMTP_SECURE").toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return env("SMTP_PORT") === "465";
}

function smtpRequireTls() {
  const raw = env("SMTP_REQUIRE_TLS").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
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
