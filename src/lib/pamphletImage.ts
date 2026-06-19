import type {
  DraftedPamphlet,
  HeroSection,
  PamphletAccent,
} from "./ai";
import { aiImageUrl as serverImageUrl, serverAiEnabled } from "./aiGateway";

// =====================================================================
// AI-generated pamphlet hero imagery.
//
// The server image route triggers generation; subsequent requests can
// be cached by the browser/CDN, so a deterministic
// `seed` per pamphlet means the same picture renders every time until
// the manager bumps the seed via Regenerate image.
//
// No API key is involved — this works in a frontend-only app. The
// provider abstraction is structured so OpenAI image models or any
// additional provider could be slotted in later by adding a new entry
// to `IMAGE_PROVIDERS` and pointing `activeProvider` at it.
// =====================================================================

export type ImageProviderId = "openai" | "local";

interface ImageProvider {
  id: ImageProviderId;
  /**
   * Build the URL the `<img>` tag should point at for a pamphlet's
   * hero scene. The URL is deterministic in (prompt, seed, size) so
   * the browser HTTP cache + the provider CDN will serve identical
   * pixels on re-render.
   */
  heroImageUrl(prompt: string, opts: { seed: number; width: number; height: number }): string;
}

const OPENAI_GATEWAY: ImageProvider = {
  id: "openai",
  heroImageUrl(prompt, { seed, width, height }) {
    if (!serverAiEnabled()) return localHeroImageUrl(prompt, { seed, width, height });
    return serverImageUrl("/ai/pamphlet-image", { prompt, seed, width, height });
  },
};

const LOCAL_PLACEHOLDER: ImageProvider = {
  id: "local",
  heroImageUrl: localHeroImageUrl,
};

const IMAGE_PROVIDERS: Record<ImageProviderId, ImageProvider> = {
  openai: OPENAI_GATEWAY,
  local: LOCAL_PLACEHOLDER,
};

let activeProvider: ImageProviderId = "openai";

export function setImageProvider(id: ImageProviderId): void {
  activeProvider = id;
}

function localHeroImageUrl(
  prompt: string,
  { seed, width, height }: { seed: number; width: number; height: number }
): string {
  const hue = Math.abs(seed % 360);
  const title = prompt
    .replace(/\s+/g, " ")
    .replace(/[<>&"]/g, "")
    .slice(0, 90);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="hsl(${hue},18%,18%)"/>
      <stop offset="0.55" stop-color="hsl(${(hue + 24) % 360},28%,34%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 48) % 360},42%,68%)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="${width * 0.08}" y="${height * 0.08}" width="${width * 0.84}" height="${height * 0.84}" rx="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)"/>
  <text x="${width * 0.12}" y="${height * 0.72}" fill="rgba(255,255,255,0.86)" font-family="Georgia, serif" font-size="${Math.max(22, width * 0.045)}">AI image pending</text>
  <text x="${width * 0.12}" y="${height * 0.78}" fill="rgba(255,255,255,0.64)" font-family="Arial, sans-serif" font-size="${Math.max(13, width * 0.022)}">${title}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------
// Prompt vocabulary. Each accent maps to an editorial-photography
// scene the matches the Hartland reference's aesthetic (luxury magazine
// quality, golden-hour lighting, atmospheric, photoreal). The hero
// headline is concatenated as an additional bias so the picture
// follows the campaign's specific subject matter — e.g. "Stored for
// the Winter?" pulls the covered-vehicle composition tighter.
// ---------------------------------------------------------------------

const ACCENT_VISUAL: Record<PamphletAccent, string> = {
  winter:
    "a luxury vintage sports car covered with a soft fabric car cover, parked inside a pristine heated home garage, snow falling outside the open garage door, snowy pine trees and a stately country home visible in the background, polished concrete floor, warm overhead lighting, organized tool wall",
  spring:
    "a stately white country home at golden hour, a blooming dogwood tree with soft pink blossoms in the foreground, manicured sage hedges, soft warm light",
  summer:
    "a calm Mediterranean villa with an infinity pool at golden hour, palm trees framing the view, warm cream stone walls, soft turquoise water",
  fall:
    "an elegant country estate at autumn dusk, warm amber leaves on a stone driveway, soft golden window light, mature oak trees in muted ochre and burgundy",
  storm:
    "dramatic dark storm clouds gathering over a coastal cape-cod estate at dusk, palm trees bending in strong wind, distant lightning over the ocean, atmospheric cinematic mood",
  flood:
    "an elegant white lighthouse on a rocky coastline at sunset, dramatic crashing waves below, warm amber sky, atmospheric",
  wildfire:
    "the distant amber glow of a wildfire on a mountain ridge at twilight, smoky sky in muted orange and charcoal, silhouetted pine forest in the foreground, atmospheric",
  earthquake:
    "a stately stone country house at dusk with warm window glow, mature trees, dramatic side lighting, atmospheric",
  renewal:
    "an elegant covered front porch of a luxury home at sunrise, autumn leaves on stone steps, warm golden light through pillared columns",
  newpolicy:
    "a luxurious suburban home exterior at golden hour with warm interior lights glowing through the windows, manicured hedges, cinematic atmosphere",
  home:
    "a stately stone country estate at sunset with warm window glow, manicured grounds, mature oak trees, dramatic editorial lighting",
  newhome:
    "a young couple smiling while unpacking moving boxes in a beautiful sunlit new home, warm afternoon light streaming through tall windows",
  remodel:
    "a newly renovated luxury kitchen with marble countertops, warm pendant lighting, soft natural daylight through large windows",
  luxury_home:
    "a luxurious oceanfront modern estate at twilight with an infinity pool and warm interior lights, panoramic ocean view",
  auto:
    "a luxury black sedan parked on a cobblestone driveway in front of a stately country home at golden hour, atmospheric editorial photography",
  luxury_auto:
    "a covered vintage Porsche 911 inside a luxury private garage with soft natural light through large windows, polished concrete floor, atmospheric editorial mood",
  motorcycle:
    "a premium motorcycle parked on a winding country road at sunset, dramatic golden sky, atmospheric",
  rv:
    "a luxury motorhome parked at a scenic mountain overlook at golden hour, cinematic atmosphere",
  boat:
    "an elegant white yacht docked at a marina at sunset, warm reflections on calm water, atmospheric",
  jewelry:
    "a luxury diamond engagement ring on dark velvet with soft directional light and a small bouquet of cream roses in the background, macro editorial photography",
  valuables:
    "a curated collection of luxury watches arranged on dark walnut surface with dramatic side lighting, macro editorial photography",
  art:
    "framed oil paintings on a softly lit gallery wall, warm spotlight, marble floor in the foreground, atmospheric editorial",
  wine:
    "a private wine cellar with backlit bottles in warm amber lighting, stone walls, atmospheric editorial photography",
  umbrella:
    "a stylish dark umbrella held up in soft rain on a cobblestone city street at dusk, atmospheric moody editorial photography",
  liability:
    "a mahogany lawyer's desk with a green-shaded banker's lamp in a warm library, leather chair, atmospheric editorial",
  life:
    "the silhouette of a happy family walking together on a beach at sunset, soft golden hour atmosphere, atmospheric editorial photography",
  health:
    "an elegant modern doctor's private consultation room with soft natural light through large windows, calming neutral palette",
  wedding:
    "two elegant gold wedding bands on dark velvet with a soft golden glow and white peonies in the background, macro editorial photography",
  newbaby:
    "a luxurious nursery in soft cream and dusty pink tones, warm afternoon light through sheer curtains, plush rug, atmospheric editorial",
  business:
    "a sweeping city skyline at dusk with warm window lights glowing across the buildings, dramatic golden sky, cinematic editorial photography",
  cyber:
    "a dark modern workspace with multiple glowing computer screens, subtle blue ambient light, atmospheric editorial photography",
  holidays:
    "a luxurious holiday-decorated fireplace mantle with warm candle glow, pine garland, soft snowfall outside the window, cozy editorial photography",
  newyear:
    "two crystal champagne flutes on a marble surface with golden fireworks bursting in the background, atmospheric editorial photography",
  generic:
    "a luxury insurance advisor's office with warm interior lighting, leather furnishings, wooden bookshelves, atmospheric editorial photography",
};

const STYLE_SUFFIX =
  ", professional editorial photography, cinematic lighting, shallow depth of field, photorealistic, ultra detailed, magazine cover quality, no text, no watermark, no logo";

// Build the actual prompt sent to the image provider. If the LLM
// author wrote an image prompt as part of the same draft pass, we use
// that verbatim — keeps the picture and the copy perfectly in sync
// because both came from the same call. Otherwise we fall back to the
// accent's canonical scene description biased by the hero headline.
// A fixed style suffix is always appended so every image reads as the
// same editorial luxury-magazine aesthetic.
export function buildHeroImagePrompt(pamphlet: DraftedPamphlet): string {
  if (pamphlet.heroImagePrompt && pamphlet.heroImagePrompt.trim()) {
    return pamphlet.heroImagePrompt.trim() + STYLE_SUFFIX;
  }
  const base = ACCENT_VISUAL[pamphlet.accent] ?? ACCENT_VISUAL.generic;
  const hero = pamphlet.sections.find((s) => s.kind === "hero") as
    | HeroSection
    | undefined;
  const headlineHint = hero?.headline
    ? `, evoking the theme "${hero.headline.replace(/[.?!]+$/, "")}"`
    : "";
  return base + headlineHint + STYLE_SUFFIX;
}

// Hero image URL for a given pamphlet. The seed defaults to the
// pamphlet's persisted `heroImageSeed`; pass a different one to force
// a regeneration without mutating the pamphlet.
export function heroImageUrl(
  pamphlet: DraftedPamphlet,
  opts?: { seed?: number; width?: number; height?: number }
): string {
  const provider = IMAGE_PROVIDERS[activeProvider];
  const seed = opts?.seed ?? pamphlet.heroImageSeed ?? 0;
  const width = opts?.width ?? 720;
  const height = opts?.height ?? 900;
  const prompt = buildHeroImagePrompt(pamphlet);
  return provider.heroImageUrl(prompt, { seed, width, height });
}

// Roll the hero image seed forward. Returns a NEW number so the
// caller can persist it onto the pamphlet (mutation happens in the
// caller — this is a pure derive).
export function nextHeroImageSeed(current: number | undefined): number {
  const base = current ?? Math.floor(Math.random() * 2 ** 31);
  // Simple LCG step so consecutive seeds aren't visually correlated.
  return Math.abs(((base * 1103515245 + 12345) | 0) % 2 ** 31);
}
