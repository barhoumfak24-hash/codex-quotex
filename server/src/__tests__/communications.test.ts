import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { communicationsRoutes } from "../routes/communications.js";
import { issueSessionJwt } from "../routes/auth.js";

const JWT_SECRET = "test-jwt-secret-with-more-than-32-characters";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", JWT_SECRET);
  vi.stubEnv("JWT_ISSUER", "");
  vi.stubEnv("JWT_AUDIENCE", "");
  vi.stubEnv("EMAIL_PROVIDER", "");
  vi.stubEnv("SENDGRID_API_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("communications delivery routes", () => {
  it("rejects anonymous software-sale delivery requests", async () => {
    const response = await postToCommunications({
      path: "/software-sale/signing-email",
      payload: validSigningPayload(),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("allows authenticated platform delivery requests through to the provider layer", async () => {
    const token = issueSessionJwt({
      userId: "master_user",
      role: "master_admin",
      tenantId: null,
    });

    const response = await postToCommunications({
      path: "/software-sale/signing-email",
      token,
      payload: validSigningPayload(),
    });
    const body = (await response.json()) as { ok: boolean; result?: { provider?: string } };

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.result?.provider).toBe("unconfigured");
  });

  it("sends each payment authorization resend as a fresh email conversation", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "sendgrid");
    vi.stubEnv("SENDGRID_API_KEY", "SG.test-key");
    vi.stubEnv("EMAIL_FROM", "Quotex Insurance <contact@quotexinsurance.com>");
    const realFetch = globalThis.fetch.bind(globalThis);
    const sendGridRequests: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.sendgrid.com/v3/mail/send") {
        sendGridRequests.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return new Response(null, {
          status: 202,
          headers: { "x-message-id": `sg-${sendGridRequests.length}` },
        });
      }
      return realFetch(input, init);
    });
    const token = issueSessionJwt({
      userId: "master_user",
      role: "master_admin",
      tenantId: null,
    });

    const firstResponse = await postToCommunications({
      path: "/software-sale/signing-email",
      token,
      payload: validSigningPayload(),
    });
    const secondResponse = await postToCommunications({
      path: "/software-sale/signing-email",
      token,
      payload: validSigningPayload(),
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(sendGridRequests).toHaveLength(2);
    const firstSubject = sendGridRequests[0]?.subject;
    const secondSubject = sendGridRequests[1]?.subject;
    expect(firstSubject).toEqual(expect.stringMatching(/^Quotex payment authorization QTX-PAY-/));
    expect(secondSubject).toEqual(expect.stringMatching(/^Quotex payment authorization QTX-PAY-/));
    expect(secondSubject).not.toBe(firstSubject);
    const firstHeaders = sendGridRequests[0]?.personalizations?.[0]?.headers ?? {};
    const secondHeaders = sendGridRequests[1]?.personalizations?.[0]?.headers ?? {};
    expect(firstHeaders["X-Quotex-Message-Type"]).toBe("payment-authorization");
    expect(secondHeaders["X-Quotex-Message-Type"]).toBe("payment-authorization");
    expect(secondHeaders["X-Quotex-Email-Reference"]).not.toBe(firstHeaders["X-Quotex-Email-Reference"]);
    expect(firstHeaders["In-Reply-To"]).toBeUndefined();
    expect(firstHeaders.References).toBeUndefined();
  });
});

async function postToCommunications(input: {
  path: string;
  payload: unknown;
  token?: string;
}): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use("/", communicationsRoutes);
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind.");
    return await fetch(`http://127.0.0.1:${address.port}${input.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      body: JSON.stringify(input.payload),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function validSigningPayload() {
  return {
    agencyName: "Quotex Test Agency",
    contactName: "Alex Founder",
    email: "alex@example.com",
    phone: "517-294-2671",
    signingLink: "https://quotexinsurance.com/packet/test",
    documents: [{ title: "Service agreement", version: "v1" }],
  };
}
