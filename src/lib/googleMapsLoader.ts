// =====================================================================
// Google Maps JavaScript SDK loader (singleton)
//
// Injects the script tag exactly once per page load and resolves when
// `window.google.maps.places` is ready. Subsequent callers share the
// same in-flight Promise so two components mounting simultaneously
// don't each trigger a script injection.
//
// Script URL pattern:
//   https://maps.googleapis.com/maps/api/js?key=KEY
//     &libraries=places&v=beta
//
// `v=beta` is required for the new `AutocompleteSuggestion` API and
// `Place.fetchFields()` (both still in beta as of late 2025). The
// `libraries=places` parameter pulls in the Places library that
// exposes those classes; without it `google.maps.places` is undefined.
//
// Failure modes this handles:
//   - SSR / Node / vitest jsdom without a real network → reject
//     immediately so callers fall back to REST.
//   - Script tag fails to load (CSP, network down, ad-blocker) →
//     reject with a remediation hint.
//   - Script loads but the Places library never materializes → reject
//     after a 10-second timeout so we don't hang the UI forever.
// =====================================================================

declare global {
  interface Window {
    // The Maps SDK attaches itself here when the script tag executes.
    google?: {
      maps?: {
        places?: GoogleMapsPlacesNamespace;
      };
    };
    // We hand the SDK a callback name; it invokes it when the bundle
    // has finished loading and `google.maps` is fully populated.
    __quotexGoogleMapsReady?: () => void;
  }
}

// We deliberately type these loosely. The real SDK types live in
// @types/google.maps, which we don't depend on (it adds ~500KB of
// .d.ts to typecheck and only this one module touches the SDK).
export interface GoogleMapsPlacesNamespace {
  AutocompleteSuggestion: GoogleAutocompleteSuggestionClass;
  AutocompleteSessionToken: new () => unknown;
  Place: GooglePlaceClass;
}

export interface GoogleAutocompleteSuggestionClass {
  fetchAutocompleteSuggestions(req: {
    input: string;
    includedPrimaryTypes?: string[];
    includedRegionCodes?: string[];
    sessionToken?: unknown;
    locationBias?: unknown;
  }): Promise<{ suggestions: GoogleSdkSuggestion[] }>;
}

export interface GoogleSdkSuggestion {
  placePrediction?: {
    placeId: string;
    text: { text: string; matches?: unknown };
    toPlace(): GoogleSdkPlaceInstance;
  };
}

export interface GooglePlaceClass {
  new (config: { id: string; requestedLanguage?: string }): GoogleSdkPlaceInstance;
}

export interface GoogleSdkPlaceInstance {
  fetchFields(opts: { fields: string[]; sessionToken?: unknown }): Promise<{ place: GoogleSdkPlaceData }>;
  addressComponents?: GoogleSdkAddressComponent[];
  formattedAddress?: string;
}

export interface GoogleSdkPlaceData {
  addressComponents?: GoogleSdkAddressComponent[];
  formattedAddress?: string;
}

export interface GoogleSdkAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
const CALLBACK_NAME = "__quotexGoogleMapsReady";

let inFlight: Promise<GoogleMapsPlacesNamespace> | null = null;

// Tests can reset the module-level cache between cases.
export function _resetGoogleMapsLoaderForTest() {
  inFlight = null;
  if (typeof window !== "undefined") {
    delete window.__quotexGoogleMapsReady;
    // Don't delete window.google — tests that pre-attach a fake SDK
    // want it to stick around.
  }
}

export function isGoogleMapsLoaded(): boolean {
  return typeof window !== "undefined" && !!window.google?.maps?.places?.AutocompleteSuggestion;
}

// Load (or return the in-flight promise for) the Google Maps JS SDK
// with the Places library. Resolves with the `google.maps.places`
// namespace; rejects with a clear message on any failure.
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsPlacesNamespace> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Maps JS SDK can only load in a browser environment."));
  }

  // Already loaded by a previous mount — short-circuit.
  if (isGoogleMapsLoaded()) {
    return Promise.resolve(window.google!.maps!.places!);
  }

  if (inFlight) return inFlight;

  if (!apiKey) {
    return Promise.reject(new Error("Missing Google Maps API key (VITE_GOOGLE_PLACES_API_KEY)."));
  }

  inFlight = new Promise<GoogleMapsPlacesNamespace>((resolve, reject) => {
    let settled = false;
    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      cb();
    };

    const timeout = window.setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "Google Maps JS SDK loaded but the Places library never became available — confirm Places API (New) is enabled in Google Cloud Console for this project and that billing is active."
          )
        )
      );
    }, SCRIPT_LOAD_TIMEOUT_MS);

    window[CALLBACK_NAME] = () => {
      const places = window.google?.maps?.places;
      if (!places?.AutocompleteSuggestion) {
        finish(() => {
          window.clearTimeout(timeout);
          reject(
            new Error(
              "Google Maps SDK callback fired but `google.maps.places.AutocompleteSuggestion` is undefined — enable Places API (New) in Cloud Console and verify the script URL includes libraries=places&v=beta."
            )
          );
        });
        return;
      }
      finish(() => {
        window.clearTimeout(timeout);
        resolve(places);
      });
    };

    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("libraries", "places");
    // `v=beta` is required for AutocompleteSuggestion + Place.fetchFields.
    url.searchParams.set("v", "beta");
    url.searchParams.set("callback", CALLBACK_NAME);
    url.searchParams.set("loading", "async");
    script.src = url.toString();
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      finish(() => {
        window.clearTimeout(timeout);
        reject(
          new Error(
            "Google Maps SDK script tag failed to load. Likely causes: (a) the deployment domain isn't on the API key's HTTP referrer allowlist, (b) network/CSP blocked maps.googleapis.com, (c) the key was revoked. Open DevTools Network tab to see the underlying error."
          )
        );
      });
    };
    document.head.appendChild(script);
  });

  // If we reject, clear the cache so the next mount can retry (e.g.
  // after the user fixes a Cloud Console setting and refreshes).
  inFlight.catch(() => {
    inFlight = null;
  });

  return inFlight;
}