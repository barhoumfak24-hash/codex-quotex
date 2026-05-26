import { lazy, Suspense, useEffect, useState } from "react";
import type { AddressParts } from "@/lib/addressSearch";

// AddressAutocomplete is in the same /components/ui folder. Lazy-load
// it to avoid the circular module reference (AddressAutocomplete also
// imports AddressFields for its structured fallback).
const AddressAutocomplete = lazy(() =>
  import("./AddressAutocomplete").then((m) => ({ default: m.AddressAutocomplete }))
);

// =====================================================================
// Structured US address input.
//
// Four fields — Street, Apt/Unit (optional), City, State (US dropdown),
// ZIP — composed into a single canonical string the rest of the app
// already consumes:
//
//   "123 Main Street Apt 4B, Boston, MA 02108"
//
// Use this when autocomplete is unreliable or when a customer prefers
// to type the address out themselves. There's no network dependency.
// =====================================================================

const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
];

interface Parts {
  street: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
}

// Compose: "123 Main Street Apt 4B, Boston, MA 02108"
export function composeAddress(p: Parts): string {
  const street = p.street.trim();
  const apt = p.apt.trim();
  const city = p.city.trim();
  const state = p.state.trim();
  const zip = p.zip.trim();
  const street1 = [street, apt].filter(Boolean).join(" ");
  const stateZip = [state, zip].filter(Boolean).join(" ");
  return [street1, city, stateZip].filter(Boolean).join(", ");
}

// Best-effort parser so when a parent passes a pre-composed string we
// can populate the fields back. Heuristic only — defaults to leaving
// the value in `street` if it doesn't fit the comma-separated shape.
export function parseAddress(value: string): Parts {
  const empty: Parts = { street: "", apt: "", city: "", state: "", zip: "" };
  if (!value.trim()) return empty;
  const segments = value.split(",").map((s) => s.trim());
  // "street [apt]", "city", "state zip"
  const [street1 = "", city = "", stateZip = ""] = segments;
  const stateZipMatch = stateZip.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  const state = stateZipMatch?.[1]?.toUpperCase() ?? "";
  const zip = stateZipMatch?.[2] ?? "";
  // Try to split street1 into street + apt: anything starting with
  // "Apt", "Unit", "Ste", "#", or a fraction-style suffix becomes apt.
  const aptIdx = street1.search(/\b(apt|unit|ste|suite|#)\b/i);
  const street = aptIdx === -1 ? street1 : street1.slice(0, aptIdx).trim();
  const apt = aptIdx === -1 ? "" : street1.slice(aptIdx).trim();
  return { street, apt, city, state, zip };
}

export function AddressFields({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (composed: string) => void;
  required?: boolean;
}) {
  const [parts, setParts] = useState<Parts>(() => parseAddress(value));

  // If the parent re-syncs a different value, mirror it into the
  // fields (rare — usually unidirectional).
  useEffect(() => {
    const next = parseAddress(value);
    setParts((cur) => {
      const same =
        cur.street === next.street &&
        cur.apt === next.apt &&
        cur.city === next.city &&
        cur.state === next.state &&
        cur.zip === next.zip;
      return same ? cur : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function set<K extends keyof Parts>(k: K, v: string) {
    const next = { ...parts, [k]: v };
    setParts(next);
    onChange(composeAddress(next));
  }

  // When the embedded street typeahead returns Google Place Details,
  // splat all five parts into state and recompose the canonical string.
  function applyPickedAddress(picked: AddressParts) {
    const next: Parts = {
      street: picked.street || parts.street,
      apt: picked.apt || parts.apt,
      city: picked.city || parts.city,
      state: picked.state || parts.state,
      zip: picked.zip || parts.zip,
    };
    setParts(next);
    onChange(composeAddress(next));
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
      <div className="sm:col-span-4">
        <label className="label">Street</label>
        <Suspense
          fallback={
            <input
              className="input"
              required={required}
              value={parts.street}
              onChange={(e) => set("street", e.target.value)}
              autoComplete="address-line1"
            />
          }
        >
          <AddressAutocomplete
            value={parts.street}
            onChange={(v) => set("street", v)}
            onSelectParts={applyPickedAddress}
            required={required}
            // Critical: prevents recursive structured-mode rendering
            // and removes the "Type address manually" toggle since
            // we're already in the structured layout.
            disableModeToggle
          />
        </Suspense>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Apt / Unit (optional)</label>
        <input
          className="input"
          value={parts.apt}
          onChange={(e) => set("apt", e.target.value)}
          autoComplete="address-line2"
        />
      </div>

      <div className="sm:col-span-3">
        <label className="label">City</label>
        <input
          className="input"
          required={required}
          value={parts.city}
          onChange={(e) => set("city", e.target.value)}
          autoComplete="address-level2"
        />
      </div>
      <div className="sm:col-span-1">
        <label className="label">State</label>
        <select
          className="input"
          value={parts.state}
          onChange={(e) => set("state", e.target.value)}
          required={required}
          autoComplete="address-level1"
        >
          <option value="">—</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.code}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label">ZIP</label>
        <input
          className="input"
          required={required}
          value={parts.zip}
          onChange={(e) => set("zip", e.target.value.replace(/[^\d-]/g, ""))}
          maxLength={10}
          inputMode="numeric"
          autoComplete="postal-code"
        />
      </div>
    </div>
  );
}