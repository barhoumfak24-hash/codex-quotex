import { z } from "zod";
import { readRemoteState, supabaseStateConfigured, writeRemoteState } from "./supabaseState.js";

const softwareProductSchema = z
  .preprocess(
    (value) => (value === "ai_quoting_workspace" ? "full_platform" : value),
    z.enum(["full_platform"])
  )
  .optional();

const signatureSchema = z
  .object({
    signerName: z.string().optional(),
    authorized: z.boolean().optional(),
    viewedAt: z.string().optional(),
    signedAt: z.string().optional(),
    signedByEmail: z.string().optional(),
    signerUserAgent: z.string().optional(),
  })
  .passthrough();

const paymentMethodEntrySchema = z.object({
  method: z.enum(["card", "bank"]),
  accountName: z.string().min(1),
  label: z.string().min(1),
  last4: z.string().regex(/^\d{4}$/),
  enteredAt: z.string().min(1),
});

export const signingPacketSchema = z
  .object({
    id: z.string().min(1),
    saleId: z.string().optional(),
    agencyName: z.string().min(1),
    contactName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional().default(""),
    website: z.string().optional(),
    product: softwareProductSchema,
    tier: z.string().optional(),
    seats: z.number().int().nonnegative(),
    estimatedMonthly: z.number().nonnegative(),
    setupFee: z.number().nonnegative().optional(),
    websiteAppAddOn: z.enum(["none", "website", "app", "website_app"]).optional(),
    websiteAppAddOnMonthly: z.number().nonnegative().optional(),
    termMonths: z.union([z.literal(12), z.literal(24), z.literal(36)]),
    termDiscountPercent: z.number().nonnegative(),
    termDiscountMonthly: z.number().nonnegative().optional(),
    monthlyBeforeTermDiscount: z.number().nonnegative().optional(),
    standardEstimatedMonthly: z.number().nonnegative().optional(),
    customMonthlyPriceUsd: z.number().int().nonnegative().optional(),
    customMonthlyPriceReason: z.string().optional(),
    addOnLabel: z.string().min(1),
    source: z.enum(["transaction_site", "master_portal"]).optional(),
    paymentMode: z.enum(["stripe_checkout", "manual_invoice"]).optional(),
    stripeCheckoutSessionId: z.string().optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    submittedAt: z.string().optional(),
    submittedByName: z.string().optional(),
    submittedByEmail: z.string().email().optional(),
    paymentMethodEntry: paymentMethodEntrySchema.optional(),
    signatures: z.record(z.string(), signatureSchema),
  })
  .passthrough();

export type SigningPacket = z.infer<typeof signingPacketSchema>;

const memoryPackets = new Map<string, SigningPacket>();

export async function readSigningPacket(packetId: string): Promise<SigningPacket | null> {
  if (supabaseStateConfigured()) {
    try {
      const row = await readRemoteState(signingPacketStateId(packetId));
      const parsed = signingPacketSchema.safeParse(row?.snapshot);
      if (parsed.success) return parsed.data;
    } catch (error) {
      console.warn("Signing packet Supabase read failed; using in-memory fallback.", error);
    }
  }
  return memoryPackets.get(packetId) ?? null;
}

export async function writeSigningPacket(packetId: string, packet: SigningPacket): Promise<SigningPacket> {
  memoryPackets.set(packetId, packet);
  if (supabaseStateConfigured()) {
    try {
      const result = await writeRemoteState(signingPacketStateId(packetId), packet);
      const row = result.ok ? result.row : result.current;
      const parsed = signingPacketSchema.safeParse(row?.snapshot);
      if (parsed.success) return parsed.data;
    } catch (error) {
      console.warn("Signing packet Supabase write failed; using in-memory fallback.", error);
    }
  }
  return packet;
}

function signingPacketStateId(packetId: string) {
  return `signing_packet:${packetId}`;
}
