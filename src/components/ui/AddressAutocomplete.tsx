import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import {
  fetchGooglePlaceDetails,
  getActiveProvider,
  searchAddresses,
  type AddressParts,
  type AddressPrediction,
  type AddressSearchMode,
} from "@/lib/addressSearch";
import { AddressFields, parseAddress } from "./AddressFields";

// Per-browser preference: "auto" (default) shows the typeahead;
// "structured" swaps to street / apt / city / state / zip inputs.
type InputMode = "auto" | "structured";
const MODE_STORAGE_KEY = "quotex.address.inputMode.v1";

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastQueryRef = useRef<string>("");
  const justSelectedRef = useRef(false);
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

  // Debounce the query: schedule a search 180ms after the user stops
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
      setPredictions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      lastQueryRef.current = q;
      try {
        const out = await searchAddresses(q, mode, controller.signal, googleSessionToken.current);
        // Drop late responses for stale queries.
        if (lastQueryRef.current !== q) return;
        setPredictions(out);
        setOpen(out.length > 0);
        setActiveIndex(out.length > 0 ? 0 : -1);
        setLoading(false);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") return;
        // Any other failure: clear the dropdown and stop the spinner.
        if (lastQueryRef.current === q) {
          setPredictions([]);
          setOpen(false);
          setLoading(false);
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [value, mode, minQueryLength]);

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
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (predictions.length > 0) setOpen(true);
          }}
          onKeyDown={handleKey}
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-ink-400">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        </span>
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

      {open && predictions.length === 0 && !loading && value.trim().length >= minQueryLength && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-ink-200 bg-white shadow-luxe text-xs text-ink-500 px-3 py-2">
          No matches — keep typing or use the "Type address manually" option.
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