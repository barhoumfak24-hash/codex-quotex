// =====================================================================
// Boot-time diagnostic printout.
//
// Logs, exactly once on app load, which frontend env vars are present
// (Vite inlines all VITE_* at build time, so this tells us whether
// they made it through the deploy) plus the build commit + timestamp
// so we can confirm the latest bundle is actually being served.
//
// Output is structured so it can be screenshotted from DevTools and
// pasted back into a triage ticket without further interpretation.
// =====================================================================

// Provided by vite.config.ts via `define:` — see that file for shape.
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

let printed = false;

export function printBootDiagnostic() {
  if (printed) return;
  printed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env ?? {};
    const summary = {
      // Build provenance — tells us which deploy this is.
      build: {
        sha: typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "unknown",
        time: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "unknown",
      },
      // Frontend env-var presence (never the values).
      env: {
        VITE_GOOGLE_PLACES_API_KEY: !!env.VITE_GOOGLE_PLACES_API_KEY,
        VITE_GOOGLE_MAPS_API_KEY: !!env.VITE_GOOGLE_MAPS_API_KEY,
        VITE_SMARTY_WEBSITE_KEY: !!env.VITE_SMARTY_WEBSITE_KEY,
        VITE_MAPBOX_TOKEN: !!env.VITE_MAPBOX_TOKEN,
      },
      // Where to look for server-side env-var presence.
      serverProbe: "GET /api/__diag",
    };
    // eslint-disable-next-line no-console
    console.info(
      "%c[quotex diagnostic] env + build summary",
      "color:#a07a3b;font-weight:600",
      summary
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[quotex diagnostic] failed", err);
  }
}