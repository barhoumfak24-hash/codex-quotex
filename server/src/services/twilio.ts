// Twilio SMS service. Uses Twilio REST API directly when credentials are
// configured. STOP/HELP webhooks and durable opt-out storage should be added
// before production messaging volume goes live.

export type SmsSendResult = {
  sid: string;
  status: "sent" | "demo_queued" | "opted_out" | "failed";
  provider: "twilio" | "demo";
  configured: boolean;
  error?: string;
};

export async function sendSms(args: {
  to: string;
  body: string;
  metadata?: Record<string, string>;
}): Promise<SmsSendResult> {
  const accountSid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const fromNumber = env("TWILIO_FROM_NUMBER");
  const messagingServiceSid = env("TWILIO_MESSAGING_SERVICE_SID");

  if (await isOptedOut(args.to)) {
    return {
      sid: `sms_opted_out_${Date.now()}`,
      status: "opted_out",
      provider: "twilio",
      configured: !!(accountSid && authToken && (fromNumber || messagingServiceSid)),
    };
  }

  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    return {
      sid: `sms_demo_${Date.now()}`,
      status: "demo_queued",
      provider: "demo",
      configured: false,
    };
  }

  const params = new URLSearchParams();
  params.set("To", normalizePhoneForTwilio(args.to));
  params.set("Body", args.body);
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else params.set("From", fromNumber);

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      }
    );
    const json = (await safeJson(res)) as { sid?: string; status?: string; message?: string } | null;

    if (!res.ok) {
      return {
        sid: `sms_failed_${Date.now()}`,
        status: "failed",
        provider: "twilio",
        configured: true,
        error: json?.message ?? (await safeResponseText(res)),
      };
    }

    return {
      sid: json?.sid ?? `twilio_${Date.now()}`,
      status: "sent",
      provider: "twilio",
      configured: true,
    };
  } catch (error) {
    return {
      sid: `sms_failed_${Date.now()}`,
      status: "failed",
      provider: "twilio",
      configured: true,
      error: error instanceof Error ? error.message : "Unknown Twilio error",
    };
  }
}

export function isOptedOut(_phone: string): Promise<boolean> {
  // Real impl: lookup unsubscribe table; honor TCPA opt-outs durably.
  return Promise.resolve(false);
}

function env(key: string) {
  return process.env[key]?.trim() ?? "";
}

function normalizePhoneForTwilio(phone: string) {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[^\d+]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
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
