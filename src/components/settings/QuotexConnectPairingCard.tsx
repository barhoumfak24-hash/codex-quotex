import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Monitor, RefreshCw, Unplug } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { apiBaseUrl } from "@/lib/apiBase";
import { serverSessionHeaders } from "@/lib/serverSession";

type PairedDevice = {
  id: string;
  label: string;
  browser: string | null;
  lastSeenAt: string;
  createdAt: string;
};

type PairingCode = {
  code: string;
  expiresAt: string;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  devices?: PairedDevice[];
  code?: string;
  expiresAt?: string;
};

function friendlyError(error?: string) {
  switch (error) {
    case "agency_account_required":
      return "Sign in to an agency staff account before pairing this browser.";
    case "device_not_found":
      return "That paired browser is no longer available.";
    default:
      return "Quotex Connect could not be reached. Please try again.";
  }
}

async function connectRequest(path: string, init?: RequestInit): Promise<ApiResponse> {
  const headers = new Headers(init?.headers);
  Object.entries(serverSessionHeaders()).forEach(([key, value]) => headers.set(key, value));
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `connect_request_failed_${response.status}`);
  }
  return payload;
}

export function QuotexConnectPairingCard() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");

  const pairingExpires = useMemo(() => {
    if (!pairing) return "";
    const expiresAt = new Date(pairing.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return "";
    return expiresAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [pairing]);

  const refreshDevices = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await connectRequest("/connect/devices");
      setDevices(response.devices ?? []);
      setNotice("");
    } catch (error) {
      setNotice(friendlyError(error instanceof Error ? error.message : ""));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => void refreshDevices(true), 4_000);
    return () => window.clearInterval(timer);
  }, [pairing, refreshDevices]);

  async function createPairing() {
    setCreating(true);
    setCopied(false);
    try {
      const response = await connectRequest("/connect/pairings", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.code || !response.expiresAt) throw new Error("invalid_pairing_response");
      setPairing({ code: response.code, expiresAt: response.expiresAt });
      setNotice("");
    } catch (error) {
      setNotice(friendlyError(error instanceof Error ? error.message : ""));
    } finally {
      setCreating(false);
    }
  }

  async function copyPairingCode() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.code);
    setCopied(true);
  }

  async function revokeDevice(deviceId: string) {
    try {
      await connectRequest(`/connect/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      setNotice("");
    } catch (error) {
      setNotice(friendlyError(error instanceof Error ? error.message : ""));
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Monitor className="h-4 w-4 text-gold-600" /> Quotex Connect
          </span>
        }
        subtitle="Pair this staff account with its own browser extension for supervised carrier portal work."
        action={
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => void refreshDevices()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        }
      />

      {notice && (
        <div className="mb-4 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs font-medium text-gold-900">
          {notice}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-md border border-ink-100 bg-ink-50 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-gold-200 bg-white text-gold-700">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-ink-900">Pair a work browser</div>
              <p className="mt-1 text-xs leading-5 text-ink-600">
                Generate a code, open Quotex Connect, and enter it under Connect to Quotex.
              </p>
            </div>
          </div>

          {pairing ? (
            <div className="mt-4">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 rounded-md border border-gold-200 bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.2em] text-ink-900">
                  {pairing.code}
                </code>
                <button
                  type="button"
                  className="btn-outline h-12 w-12 shrink-0 px-0"
                  onClick={() => void copyPairingCode()}
                  aria-label="Copy pairing code"
                  title="Copy pairing code"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-500">This one-time code expires at {pairingExpires}.</p>
            </div>
          ) : (
            <button
              type="button"
              className="btn-gold mt-4 text-xs"
              onClick={() => void createPairing()}
              disabled={creating}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Generate pairing code
            </button>
          )}
        </div>

        <div className="rounded-md border border-ink-100 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink-900">Paired browsers</div>
              <p className="mt-1 text-xs text-ink-500">Only browsers paired to this staff account can receive its jobs.</p>
            </div>
            <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-700">
              {devices.length}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-ink-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking paired browsers...
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-md border border-dashed border-ink-200 px-3 py-4 text-xs text-ink-500">
                No browser is paired to this staff account yet.
              </div>
            ) : (
              devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-ink-100 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-900">{device.label}</div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {device.browser || "Browser"} - last seen {new Date(device.lastSeenAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 text-xs text-rose-700"
                    onClick={() => void revokeDevice(device.id)}
                  >
                    <Unplug className="h-3.5 w-3.5" /> Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
