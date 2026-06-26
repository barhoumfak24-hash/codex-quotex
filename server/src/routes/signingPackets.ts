import { Router } from "express";
import { z } from "zod";
import { readRemoteState, supabaseStateConfigured, writeRemoteState } from "../services/supabaseState.js";

export const signingPacketsRoutes = Router();

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

const signingPacketSchema = z
  .object({
    id: z.string().min(1),
    saleId: z.string().optional(),
    agencyName: z.string().min(1),
    contactName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional().default(""),
    seats: z.number().int().nonnegative(),
    estimatedMonthly: z.number().nonnegative(),
    termMonths: z.union([z.literal(12), z.literal(24), z.literal(36)]),
    termDiscountPercent: z.number().nonnegative(),
    addOnLabel: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    submittedAt: z.string().optional(),
    submittedByName: z.string().optional(),
    submittedByEmail: z.string().email().optional(),
    paymentMethodEntry: paymentMethodEntrySchema.optional(),
    signatures: z.record(z.string(), signatureSchema),
  })
  .passthrough();

type SigningPacket = z.infer<typeof signingPacketSchema>;

const memoryPackets = new Map<string, SigningPacket>();

signingPacketsRoutes.get("/:packetId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const packetId = normalizePacketId(req.params.packetId);
    if (!packetId) return res.status(400).json({ error: "invalid_packet_id" });
    const packet = await readSigningPacket(packetId);
    return res.json({ found: Boolean(packet), packet });
  } catch (error) {
    next(error);
  }
});

signingPacketsRoutes.put("/:packetId", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store, max-age=0");
    const packetId = normalizePacketId(req.params.packetId);
    if (!packetId) return res.status(400).json({ error: "invalid_packet_id" });

    const parsed = signingPacketSchema.safeParse(req.body?.packet ?? req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_packet", details: parsed.error.flatten() });
    if (parsed.data.id !== packetId) return res.status(400).json({ error: "packet_id_mismatch" });

    const packet = await writeSigningPacket(packetId, parsed.data);
    return res.json({ ok: true, packet });
  } catch (error) {
    next(error);
  }
});

async function readSigningPacket(packetId: string): Promise<SigningPacket | null> {
  if (supabaseStateConfigured()) {
    try {
      const row = await readRemoteState(stateId(packetId));
      const parsed = signingPacketSchema.safeParse(row?.snapshot);
      if (parsed.success) return parsed.data;
    } catch (error) {
      console.warn("Signing packet Supabase read failed; using in-memory fallback.", error);
    }
  }
  return memoryPackets.get(packetId) ?? null;
}

async function writeSigningPacket(packetId: string, packet: SigningPacket): Promise<SigningPacket> {
  memoryPackets.set(packetId, packet);
  if (supabaseStateConfigured()) {
    try {
      const row = await writeRemoteState(stateId(packetId), packet);
      const parsed = signingPacketSchema.safeParse(row.snapshot);
      if (parsed.success) return parsed.data;
    } catch (error) {
      console.warn("Signing packet Supabase write failed; using in-memory fallback.", error);
    }
  }
  return packet;
}

function stateId(packetId: string) {
  return `signing_packet:${packetId}`;
}

function normalizePacketId(value: string | undefined) {
  return value?.trim().replace(/[^a-z0-9-]/gi, "").slice(0, 120) ?? "";
}
