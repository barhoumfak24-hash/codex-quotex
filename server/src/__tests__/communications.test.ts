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
