import { Router } from "express";
import { readSigningPacket, signingPacketSchema, writeSigningPacket } from "../services/signingPackets.js";

export const signingPacketsRoutes = Router();

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

function normalizePacketId(value: string | undefined) {
  return value?.trim().replace(/[^a-z0-9-]/gi, "").slice(0, 120) ?? "";
}
