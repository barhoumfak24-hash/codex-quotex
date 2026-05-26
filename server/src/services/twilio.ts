// Twilio SMS stub. Real impl uses twilio() client with auth token.
// MUST handle STOP/HELP keywords and per-user rate limiting.

export async function sendSms(_args: { to: string; body: string; metadata?: Record<string, string> }) {
  return { sid: "sm_stub", status: "queued" };
}

export function isOptedOut(_phone: string): Promise<boolean> {
  // Real impl: lookup unsubscribe table; honor TCPA opt-outs durably.
  return Promise.resolve(false);
}