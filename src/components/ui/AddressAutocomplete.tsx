import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import {
  fetchGooglePlaceDetails,
  getActiveProvider,
  reverseGeocodeCurrentLocation,
  searchAddresses,
  type AddressParts,
  type AddressPrediction,
  type AddressSearchMode,
  type LocationBias,
} from "@/lib/addressSearch";
import { AddressFields, parseAddress } from "./AddressFields";

// Per-browser preference: "auto" (default) shows the typeahead;
// "structured" swaps to street / apt / city / state / zip inputs.
type InputMode = "auto" | "structured";
const MODE_STORAGE_KEY = "quotex.address.inputMode.v1";
const LOCATION_BIAS_STORAGE_KEY = "quotex.address.locationBias.v1";
const LOCATION_BIAS_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_LOCATION_BIAS_RADIUS_METERS = 15_000;

function loadModePreference(): InputMode {
  if (typeof window === "undefined") return "auto";
  return (window.localStorage.getItem(MODE_STORAGE_KEY) as InputMode | null) === "structured"
    ? "structured"
    : "auto";
}

function saveModePreference(m: InputMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODE_STORAGE_KEY, m);
}

function isValidLocationBias(value: unknown): value is LocationBias {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocationBias>;
  return (
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180
  );
}

function loadLocationBias(): LocationBias | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LOCATION_BIAS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { bias?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > LOCATION_BIAS_MAX_AGE_MS) {
      window.sessionStorage.removeItem(LOCATION_BIAS_STORAGE_KEY);
      return null;
    }
    return isValidLocationBias(parsed.bias) ? parsed.bias : null;
  } catch {
    return null;
  }
}

function saveLocationBias(bias: LocationBias) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      LOCATION_BIAS_STORAGE_KEY,
      JSON.stringify({ bias, at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

// =====================================================================
// Address autocomplete input.
//
// Debounced typeahead that calls searchAddresses() on each non-trivial
// keystroke and renders predictions in a dropdown. Selecting a row
// commits the full string to `value` and fires `onSelect(description)`.
//
// When the active provider is Google Places (New) and the prediction
// carries a `googlePlaceId`, we also call Place Details on commit to
// resolve the structured address components and pass them through the
// optional `onSelectParts` callback so callers (e.g. AddressFields)
// can populate Street / Apt / City / State / ZIP atomically.
// =====================================================================

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (description: string) => void;
  // Called when the user picks a suggestion. Always populated; uses
  // Google Place Details when available, falls back to a heuristic
  // parser on the description string otherwise.
  onSelectParts?: (parts: AddressParts) => void;
  mode?: AddressSearchMode;
  placeholder?: string;
  required?: boolean;
  name?: string;
  className?: string;
  // Suppress the dropdown until the input has at least this many chars
  // (default 2 — single keystrokes return too much noise).
  minQueryLength?: number;
  // When true, do NOT render the "Type address manually" toggle and
  // never switch into structured mode. AddressFields uses this so
  // its embedded street-field typeahead doesn't recursively render
  // AddressFields again.
  disableModeToggle?: boolean;
  // Turn this off for production intake so failed real providers do
  // not generate demo suggestions that look like real addresses.
  allowMockFallback?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onSelectParts,
  mode = "address",
  placeholder,
  required,
  name,
  className,
  minQueryLength = 2,
  disableModeToggle = false,
  allowMockFallback = false,
}: Props) {
  // Per-browser persisted preference. When the user clicks "Type
  // address manually" they're switched to the structured form for
  // every address field on the platform.
  const [inputMode, setInputMode] = useState<InputMode>(() =>
    disableModeToggle ? "auto" : loadModePreference()
  );
  const [predictions, setPredictions] = useState<AddressPrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationBias, setLocationBias] = useState<LocationBias | null>(() => loadLocationBias());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [statusMessage, setStatusMessage] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastQueryRef = useRef<string>("");
  const requestSeqRef = useRef(0);
  const justSelectedRef = useRef(false);
  const locationPromptedRef = useRef(false);
  // Google Places (New) session token. The same token MUST be passed
  // through every autocomplete request in one user session and the
  // matching Place Details call — that's how Google groups keystroke
  // billing. We rotate the token after every commit so the next
  // address starts a fresh session.
  const googleSessionToken = useRef<string>(newSessionToken());
  const activeProvider = useMemo(() => getActiveProvider(), []);

  function newSessionTokenInline() {
    googleSessionToken.current = newSessionToken();
  }

  async function ensureLocationBias({ forcePrompt = false } = {}): Promise<LocationBias | null> {
    if (mode !== "address" || typeof navigator === "undefined" || !navigator.geolocation) {
      return null;
    }
    if (locationBias) return locationBias;

    let permissionState: PermissionState | null = null;
    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({
          name: "geolocation" as PermissionName,
        });
        permissionState = permission.state;
      }
    } catch {
      permissionState = null;
    }

    if (permissionState === "denied") return null;
    if (!forcePrompt && permissionState !== "granted") return null;

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: LOCATION_BIAS_MAX_AGE_MS,
        });
      });
      const bias: LocationBias = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        radiusMeters: DEFAULT_LOCATION_BIAS_RADIUS_METERS,
      };
      saveLocationBias(bias);
      setLocationBias(bias);
      return bias;
    } catch {
      return null;
    }
  }

  // Debounce the query: schedule a search shortly after the user stops
  // typing. Skip when the latest char came from a selection commit.
  // Each render's effect creates an AbortController so the previous
  // in-flight request is cancelled when the user types another key.
  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < minQueryLength) {
      requestSeqRef.current += 1;
      lastQueryRef.current = "";
      setPredictions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      lastQueryRef.current = q;
      try {
        const effectiveLocationBias = locationBias;
        if (!effectiveLocationBias && !locationPromptedRef.current && mode === "address") {
          locationPromptedRef.current = true;
          void ensureLocationBias({ forcePrompt: true });
        }
        const out = await searchAddresses(q, mode, controller.signal, googleSessionToken.current, {
          allowMockFallback,
          locationBias: effectiveLocationBias,
        });
        // Drop late responses for stale queries or older location-bias searches.
        if (requestSeqRef.current !== requestSeq || lastQueryRef.current !== q) return;
        setPredictions(out);
        if (out.length > 0) {
          setStatusMessage("");
          setOpen(true);
        } else {
          setStatusMessage("");
          setOpen(false);
        }
        setActiveIndex(out.length > 0 ? 0 : -1);
        setLoading(false);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") return;
        // Any other failure: clear the dropdown and stop the spinner.
        if (requestSeqRef.current === requestSeq && lastQueryRef.current === q) {
          setPredictions([]);
          setStatusMessage("");
          setOpen(false);
          setLoading(false);
        }
      }
    }, 140);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [value, mode, minQueryLength, allowMockFallback, locationBias]);

  function warmLocationBias() {
    if (mode !== "address" || locationBias || locationPromptedRef.current) return;
    locationPromptedRef.current = true;
    void ensureLocationBias({ forcePrompt: true });
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function commitSelection(p: AddressPrediction) {
    justSelectedRef.current = true;
    onChange(p.description);
    onSelect?.(p.description);
    setStatusMessage("");
    setOpen(false);
    setPredictions([]);

    if (onSelectParts) {
      // Prefer Google Place Details for accurate component split;
      // otherwise heuristically parse the description string.
      let parts: AddressParts | null = null;
      if (p.googlePlaceId) {
        parts = await fetchGooglePlaceDetails(p.googlePlaceId, googleSessionToken.current);
      }
      if (!parts) parts = parseAddress(p.description);
      onSelectParts(parts);
    }
    // Rotate the Google session token for the next address.
    newSessionTokenInline();
  }

  async function useCurrentLocation() {
    if (mode !== "address" || typeof navigator === "undefined" || !navigator.geolocation) {
      setStatusMessage("Current location is not available in this browser.");
      setPredictions([]);
      setOpen(true);
      return;
    }
    setStatusMessage("");
    setLocating(true);
    const controller = new AbortController();
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 60_000,
        });
      });
      const bias: LocationBias = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        radiusMeters: DEFAULT_LOCATION_BIAS_RADIUS_METERS,
      };
      saveLocationBias(bias);
      setLocationBias(bias);
      const match = await reverseGeocodeCurrentLocation(position.coords, controller.signal);
      if (!match) {
        setStatusMessage("Current location could not be resolved to a street address.");
        setPredictions([]);
        setOpen(true);
        return;
      }
      await commitSelection(match);
    } catch {
      setStatusMessage("Location access was not approved or could not be read.");
      setPredictions([]);
      setOpen(true);
    } finally {
      controller.abort();
      setLocating(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || predictions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const p = predictions[activeIndex] ?? predictions[0];
      if (p) {
        e.preventDefault();
        commitSelection(p);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function switchMode(next: InputMode) {
    setInputMode(next);
    saveModePreference(next);
    setOpen(false);
  }

  // Structured-fields mode: bypass the typeahead entirely. Marina
  // mode keeps autocomplete because the curated marina list works
  // fine.
  if (!disableModeToggle && inputMode === "structured" && mode === "address") {
    return (
      <div>
        <AddressFields value={value} onChange={onChange} required={required} />
        <button
          type="button"
          className="mt-1.5 text-[11px] text-gold-700 hover:text-gold-600"
          onClick={() => switchMode("auto")}
        >
          Use autocomplete instead
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* Inner wrapper isolates the input so the absolute-positioned
          map-pin icon centers against the input's height only, not
          the full outer wrapper which also contains the toggle
          button and the predictions dropdown below. */}
      <div className="relative">
        <input
          className={`input pr-9 ${className ?? ""}`}
          value={value}
          name={name}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => {
            const nextValue = e.target.value;
            setStatusMessage("");
            onChange(nextValue);
          }}
          onFocus={() => {
            warmLocationBias();
            if (predictions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKey}
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-ink-400 hover:text-gold-700 focus:outline-none focus:text-gold-700 disabled:cursor-wait"
          onClick={useCurrentLocation}
          aria-label="Use current location"
          title="Use current location"
          disabled={loading || locating || mode !== "address"}
        >
          {loading || locating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MapPin className="h-4 w-4" />
          )}
        </button>
      </div>
      {!disableModeToggle && mode === "address" && (
        <button
          type="button"
          className="mt-1.5 text-[11px] text-ink-500 hover:text-ink-800 underline-offset-2 hover:underline"
          onClick={() => switchMode("structured")}
        >
          Type address manually
        </button>
      )}

      {open && predictions.length > 0 && (
        <ul
          className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-ink-200 bg-white shadow-luxe text-sm"
          role="listbox"
        >
          {predictions.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  commitSelection(p);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left px-3 py-2 flex items-start gap-2 ${
                  i === activeIndex ? "bg-ink-50" : "hover:bg-ink-50"
                }`}
              >
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-ink-400" />
                <span className="min-w-0 truncate">{p.description}</span>
              </button>
            </li>
          ))}
          {activeProvider === "google" && (
            // Google Places ToS requires attribution when their data
            // is rendered. https://developers.google.com/maps/documentation/places/web-service/policies
            <li className="px-3 py-1.5 text-[10px] text-ink-400 border-t border-ink-100">
              Powered by Google
            </li>
          )}
        </ul>
      )}

      {open && statusMessage && predictions.length === 0 && !loading && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-ink-200 bg-white shadow-luxe text-xs text-ink-500 px-3 py-2">
          {statusMessage}
        </div>
      )}

    </div>
  );
}

// crypto.randomUUID isn't always present (older Safari, JSDOM); fall
// back to a timestamp+random string.
function newSessionToken(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
