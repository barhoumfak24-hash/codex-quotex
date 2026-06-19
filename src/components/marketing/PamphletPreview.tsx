import {
  Anchor,
  Bolt,
  Calendar,
  Car,
  Check,
  Clock,
  CloudRain,
  Compass,
  Droplets,
  Flame,
  Gem,
  Globe,
  Heart,
  Home,
  Key,
  Lock,
  Mail,
  MapPin,
  Phone,
  Quote,
  RefreshCw,
  Scale,
  Shield,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  TrendingUp,
  Umbrella,
  Users,
  Wallet,
  Warehouse,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import type {
  ComparisonSection,
  ContactSection,
  CtaSection,
  DisclaimerSection,
  DraftedPamphlet,
  FaqSection,
  HeroSection,
  HighlightsSection,
  PamphletAccent,
  PamphletIconKey,
  PamphletSection,
  RibbonSection,
  StatsSection,
  StepsSection,
  TestimonialSection,
} from "@/lib/ai";
import { heroImageUrl } from "@/lib/pamphletImage";

// =====================================================================
// Branded digital pamphlet preview v3 — picture-driven.
//
// Drives the entire pamphlet from a single hex-color Palette per accent
// (so colors render reliably without Tailwind JIT picking up dynamic
// class names) plus a library of full-color SVG scene illustrations
// that appear as the hero artwork. The same palette + scenes are reused
// by the print export so the on-screen preview and the print/PDF match.
// =====================================================================

interface Palette {
  // Hero
  heroFrom: string;
  heroTo: string;
  heroSky: string; // light tint pulled into scene skies
  // Accent
  accent: string;
  accentDeep: string;
  accentSoft: string;
  accentInk: string;
  // Surfaces
  panel: string;
  panelAlt: string;
  ink: string;
  inkSoft: string;
  // CTA
  ctaFrom: string;
  ctaTo: string;
  ctaButtonBg: string;
  ctaButtonText: string;
  // Footer
  footerBg: string;
  footerText: string;
}

function mkPalette(
  heroFrom: string,
  heroTo: string,
  accent: string,
  options: { ctaButtonText?: string; panelAlt?: string } = {}
): Palette {
  const accentDeep = hexDarken(accent, 0.25);
  const accentSoft = hexLighten(accent, 0.88);
  return {
    heroFrom,
    heroTo,
    heroSky: hexLighten(heroTo, 0.35),
    accent,
    accentDeep,
    accentSoft,
    accentInk: hexDarken(accent, 0.45),
    panel: "#ffffff",
    panelAlt: options.panelAlt ?? hexLighten(accent, 0.94),
    ink: "#1f2430",
    inkSoft: "#4b5563",
    ctaFrom: heroFrom,
    ctaTo: heroTo,
    ctaButtonBg: "#ffffff",
    ctaButtonText: options.ctaButtonText ?? heroFrom,
    footerBg: heroFrom,
    footerText: "#e5e7eb",
  };
}

// Refined editorial palettes — muted, atmospheric, and luxury-tier
// rather than saturated primary colors. Every accent pairs a deep
// "midnight" with a softer mid-tone and a champagne/copper/pearl
// accent so the resulting pamphlets read as designed editorial work
// rather than children's-book illustrations.
const PALETTES: Record<PamphletAccent, Palette> = {
  winter: mkPalette("#0e1d35", "#2c4a6b", "#c9d4dc"),
  spring: mkPalette("#27392b", "#5a6f55", "#d4b8a5"),
  summer: mkPalette("#2a4254", "#76869a", "#d4b876"),
  fall: mkPalette("#3b1f15", "#6e3a23", "#b8814a"),
  storm: mkPalette("#1a212b", "#3a4654", "#a8b3c0"),
  flood: mkPalette("#15263a", "#3a5269", "#a8c1d4"),
  wildfire: mkPalette("#2a1410", "#6b2820", "#c47a52"),
  earthquake: mkPalette("#1f1b17", "#4a4239", "#bfa97a"),
  renewal: mkPalette("#3b2a1f", "#76583e", "#d4b876"),
  newpolicy: mkPalette("#1f3326", "#456a4f", "#c8a96b"),
  home: mkPalette("#2a201a", "#5c4a3a", "#c9a961"),
  newhome: mkPalette("#2a3b2c", "#566b54", "#d4b876"),
  remodel: mkPalette("#2c2c30", "#4a4a52", "#b89b6a"),
  luxury_home: mkPalette("#15161a", "#2e2f36", "#c9a961"),
  auto: mkPalette("#0f1116", "#23262e", "#8a2a36"),
  luxury_auto: mkPalette("#15161a", "#2e2f36", "#c9a961"),
  motorcycle: mkPalette("#0f1116", "#23262e", "#a85c2e"),
  rv: mkPalette("#2a3024", "#4d573e", "#c9a961"),
  boat: mkPalette("#15263a", "#3a5269", "#d4b876"),
  jewelry: mkPalette("#1e1a2e", "#3d3654", "#c9a3d4"),
  valuables: mkPalette("#1c1c2e", "#3a3a52", "#a89cc4"),
  art: mkPalette("#2a1a2e", "#523454", "#c9a3d4"),
  wine: mkPalette("#2a1014", "#5b1f2a", "#c9a961"),
  umbrella: mkPalette("#1a2e2e", "#3d5454", "#c9b876"),
  liability: mkPalette("#1a2e2e", "#3d5454", "#bfa97a"),
  life: mkPalette("#1f3326", "#456a4f", "#d4a5a5"),
  health: mkPalette("#1a2e3a", "#3d5269", "#d4a5a5"),
  wedding: mkPalette("#2a141e", "#5b2a3a", "#d4b876"),
  newbaby: mkPalette("#2e1a26", "#54344a", "#d4b5c4"),
  business: mkPalette("#13161e", "#262b36", "#c9a961"),
  cyber: mkPalette("#13182e", "#2a3354", "#9aaecc"),
  holidays: mkPalette("#2a1014", "#5b1f2a", "#c9a961"),
  newyear: mkPalette("#15161a", "#2e2f36", "#c9a961"),
  generic: mkPalette("#13161e", "#262b36", "#c9a961"),
};

const ICONS: Record<PamphletIconKey, LucideIcon> = {
  snowflake: Snowflake,
  lock: Lock,
  flame: Flame,
  "cloud-rain": CloudRain,
  wheel: RefreshCw,
  home: Home,
  car: Car,
  gem: Gem,
  umbrella: Umbrella,
  "shield-check": ShieldCheck,
  calendar: Calendar,
  refresh: RefreshCw,
  sparkles: Sparkles,
  sun: Sun,
  droplets: Droplets,
  bolt: Bolt,
  compass: Compass,
  scale: Scale,
  phone: Phone,
  mail: Mail,
  "map-pin": MapPin,
  globe: Globe,
  clock: Clock,
  heart: Heart,
  "trending-up": TrendingUp,
  check: Check,
  x: X,
  star: Star,
  users: Users,
  wallet: Wallet,
  key: Key,
  warehouse: Warehouse,
  wave: Waves,
  anchor: Anchor,
};

const ACCENT_HEADER_ICON: Record<PamphletAccent, LucideIcon> = {
  winter: Snowflake,
  spring: Sparkles,
  summer: Sun,
  fall: Sparkles,
  storm: CloudRain,
  flood: Waves,
  wildfire: Flame,
  earthquake: Bolt,
  renewal: RefreshCw,
  newpolicy: ShieldCheck,
  home: Home,
  newhome: Home,
  remodel: Home,
  luxury_home: Home,
  auto: Car,
  luxury_auto: Car,
  motorcycle: Car,
  rv: Car,
  boat: Anchor,
  jewelry: Gem,
  valuables: Sparkles,
  art: Sparkles,
  wine: Sparkles,
  umbrella: Umbrella,
  liability: Shield,
  life: Heart,
  health: Heart,
  wedding: Heart,
  newbaby: Heart,
  business: TrendingUp,
  cyber: Lock,
  holidays: Sparkles,
  newyear: Sparkles,
  generic: Sparkles,
};

// ---------------------------------------------------------------------
// Scenes — themed full-color SVG illustrations used as hero artwork.
// Each scene is ~600x220 viewBox, uses multi-color palettes (not just
// white-on-dark) so the artwork reads as a real picture, and is sized
// to fill the bottom 220px of the hero band.
// ---------------------------------------------------------------------

type Scene =
  | "snowy"
  | "blossom"
  | "sunny"
  | "leaves"
  | "storm"
  | "coastal"
  | "fire"
  | "ground"
  | "house"
  | "car"
  | "bike"
  | "rv"
  | "boat"
  | "gem"
  | "umbrella"
  | "family"
  | "rings"
  | "stroller"
  | "city"
  | "circuit"
  | "fireworks"
  | "shield";

const ACCENT_SCENE: Record<PamphletAccent, Scene> = {
  winter: "snowy",
  spring: "blossom",
  summer: "sunny",
  fall: "leaves",
  storm: "storm",
  flood: "coastal",
  wildfire: "fire",
  earthquake: "ground",
  renewal: "house",
  newpolicy: "house",
  home: "house",
  newhome: "house",
  remodel: "house",
  luxury_home: "house",
  auto: "car",
  luxury_auto: "car",
  motorcycle: "bike",
  rv: "rv",
  boat: "boat",
  jewelry: "gem",
  valuables: "gem",
  art: "gem",
  wine: "gem",
  umbrella: "umbrella",
  liability: "umbrella",
  life: "family",
  health: "family",
  wedding: "rings",
  newbaby: "stroller",
  business: "city",
  cyber: "circuit",
  holidays: "fireworks",
  newyear: "fireworks",
  generic: "city",
};

const SCENE_HEIGHT = 220;

const SCENES: Record<Scene, string> = {
  snowy: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="snSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1525"/><stop offset=".55" stop-color="#1d3551"/><stop offset="1" stop-color="#4a6072"/></linearGradient><radialGradient id="snMoon" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8d4a2" stop-opacity=".55"/><stop offset="1" stop-color="#e8d4a2" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#snSky)"/><circle cx="490" cy="55" r="60" fill="url(#snMoon)"/><circle cx="490" cy="55" r="18" fill="#f0e3c0" opacity=".85"/><polygon points="0,130 110,70 200,120 290,80 380,118 470,85 540,115 600,100 600,180 0,180" fill="#2c3e54" opacity=".7"/><polygon points="0,155 90,115 200,150 300,128 400,155 500,130 600,150 600,200 0,200" fill="#5a6c7d" opacity=".7"/><polygon points="0,180 100,170 220,180 320,170 420,180 540,170 600,180 600,220 0,220" fill="#cdd3da"/><g transform="translate(310,98)"><path d="M-78,52 L78,52 L0,-2 Z" fill="#1f2530"/><path d="M-78,52 L78,52 L0,8 Z" fill="#cdd3da" opacity=".95"/><rect x="-68" y="52" width="136" height="72" fill="#e8d9b6"/><rect x="-68" y="52" width="136" height="3" fill="#2a2018" opacity=".4"/><rect x="-16" y="86" width="32" height="38" fill="#2a1d11"/><rect x="-16" y="86" width="32" height="38" fill="none" stroke="#4a3520" stroke-width="1"/><circle cx="12" cy="106" r="1.5" fill="#b8843c"/><rect x="-50" y="68" width="22" height="22" fill="#74602f"/><rect x="-50" y="68" width="22" height="22" fill="none" stroke="#2a1d11" stroke-width="2"/><line x1="-39" y1="68" x2="-39" y2="90" stroke="#2a1d11" stroke-width="1.2"/><line x1="-50" y1="79" x2="-28" y2="79" stroke="#2a1d11" stroke-width="1.2"/><rect x="28" y="68" width="22" height="22" fill="#74602f"/><rect x="28" y="68" width="22" height="22" fill="none" stroke="#2a1d11" stroke-width="2"/><line x1="39" y1="68" x2="39" y2="90" stroke="#2a1d11" stroke-width="1.2"/><line x1="28" y1="79" x2="50" y2="79" stroke="#2a1d11" stroke-width="1.2"/><rect x="24" y="-12" width="16" height="22" fill="#2a2018"/><rect x="24" y="-12" width="16" height="4" fill="#cdd3da"/></g><g><polygon points="100,180 78,115 122,115" fill="#1f3024"/><polygon points="100,155 84,100 116,100" fill="#28402d"/><polygon points="100,130 88,90 112,90" fill="#324f37"/><rect x="96" y="180" width="8" height="14" fill="#2a1d11"/></g><g><polygon points="500,185 478,120 522,120" fill="#1f3024"/><polygon points="500,160 484,105 516,105" fill="#28402d"/><polygon points="500,135 488,95 512,95" fill="#324f37"/><rect x="496" y="185" width="8" height="14" fill="#2a1d11"/></g><g fill="#e8e4d8" opacity=".55"><circle cx="60" cy="30" r="1.5"/><circle cx="130" cy="50" r="1"/><circle cx="200" cy="25" r="1.2"/><circle cx="270" cy="45" r="1"/><circle cx="360" cy="35" r="1.5"/><circle cx="440" cy="50" r="1"/><circle cx="540" cy="30" r="1.2"/><circle cx="30" cy="75" r="1"/><circle cx="170" cy="80" r="1"/><circle cx="320" cy="75" r="1"/><circle cx="420" cy="90" r="1"/></g></svg>`,
  blossom: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="blSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4a55"/><stop offset=".55" stop-color="#a8a6a0"/><stop offset="1" stop-color="#e3d8c5"/></linearGradient></defs><rect width="600" height="220" fill="url(#blSky)"/><circle cx="100" cy="55" r="22" fill="#d4c89c" opacity=".75"/><circle cx="100" cy="55" r="38" fill="#d4c89c" opacity=".25"/><g fill="#bfb8a9" opacity=".5"><ellipse cx="430" cy="55" rx="48" ry="11"/><ellipse cx="470" cy="62" rx="34" ry="9"/></g><path d="M0,165 Q150,150 300,160 T600,158 L600,220 L0,220 Z" fill="#525e4a"/><path d="M0,180 Q150,170 300,178 T600,175 L600,220 L0,220 Z" fill="#6a7860"/><path d="M0,198 Q150,193 300,200 T600,198 L600,220 L0,220 Z" fill="#8a9882"/><g transform="translate(440,72)"><path d="M-72,56 L72,56 L0,-2 Z" fill="#3a302a"/><path d="M-72,56 L72,56 L0,5 Z" fill="#4a3d35" opacity=".7"/><rect x="-65" y="56" width="130" height="78" fill="#f0e6d2"/><rect x="-65" y="56" width="130" height="3" fill="#3a302a" opacity=".4"/><rect x="-14" y="92" width="28" height="42" fill="#3a302a"/><rect x="-44" y="70" width="22" height="22" fill="#7a8a9a"/><rect x="-44" y="70" width="22" height="22" fill="none" stroke="#3a302a" stroke-width="2"/><line x1="-33" y1="70" x2="-33" y2="92" stroke="#3a302a" stroke-width="1.2"/><line x1="-44" y1="81" x2="-22" y2="81" stroke="#3a302a" stroke-width="1.2"/><rect x="22" y="70" width="22" height="22" fill="#7a8a9a"/><rect x="22" y="70" width="22" height="22" fill="none" stroke="#3a302a" stroke-width="2"/><line x1="33" y1="70" x2="33" y2="92" stroke="#3a302a" stroke-width="1.2"/><line x1="22" y1="81" x2="44" y2="81" stroke="#3a302a" stroke-width="1.2"/></g><g transform="translate(150,110)"><rect x="-5" y="0" width="10" height="80" fill="#3a2a20"/><path d="M0,5 q-10,8 -20,3" stroke="#3a2a20" stroke-width="2" fill="none"/><circle cx="0" cy="-20" r="42" fill="#d4b8a5"/><circle cx="-30" cy="-12" r="30" fill="#c4a896"/><circle cx="28" cy="-15" r="32" fill="#dac4b2"/><circle cx="0" cy="-42" r="24" fill="#bfa28d"/><circle cx="-18" cy="-35" r="16" fill="#d4b8a5"/><circle cx="18" cy="-38" r="18" fill="#cab09a"/><g fill="#f0e6d8" opacity=".75"><circle cx="-10" cy="-25" r="3"/><circle cx="15" cy="-22" r="2.5"/><circle cx="5" cy="-38" r="3"/><circle cx="-22" cy="-15" r="2"/><circle cx="22" cy="-30" r="2.5"/></g></g><g fill="#d4b8a5" opacity=".55"><circle cx="60" cy="125" r="2.5"/><circle cx="220" cy="135" r="2"/><circle cx="280" cy="155" r="2.5"/><circle cx="350" cy="165" r="2"/><circle cx="540" cy="140" r="2.5"/></g></svg>`,
  sunny: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="suSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a4254"/><stop offset=".5" stop-color="#9a8a72"/><stop offset="1" stop-color="#e8d4a2"/></linearGradient><radialGradient id="suGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0e3c0" stop-opacity=".55"/><stop offset="1" stop-color="#f0e3c0" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#suSky)"/><circle cx="300" cy="85" r="140" fill="url(#suGlow)"/><circle cx="300" cy="85" r="40" fill="#f5e9d3" opacity=".95"/><circle cx="300" cy="85" r="32" fill="#e8d4a2"/><path d="M0,180 Q150,170 300,175 T600,172 L600,220 L0,220 Z" fill="#a89684"/><path d="M0,195 Q150,188 300,193 T600,190 L600,220 L0,220 Z" fill="#bfa996"/><path d="M0,205 Q150,200 300,205 T600,202 L600,220 L0,220 Z" fill="#d4c2ad"/><g transform="translate(110,150)"><rect x="-6" y="0" width="12" height="62" fill="#3a2a1d"/><path d="M0,5 Q-30,-50 -55,-15 Q-35,-30 -18,-20 Q-38,-60 0,-65 Q38,-60 18,-20 Q35,-30 55,-15 Q30,-50 0,5" fill="#3d4d32"/><path d="M0,-10 Q-25,-50 -45,-20 Q-25,-32 -12,-22" fill="#4a5d3d" opacity=".75"/></g><g transform="translate(495,150)"><rect x="-6" y="0" width="12" height="62" fill="#3a2a1d"/><path d="M0,5 Q-30,-50 -55,-15 Q-35,-30 -18,-20 Q-38,-60 0,-65 Q38,-60 18,-20 Q35,-30 55,-15 Q30,-50 0,5" fill="#3d4d32"/></g><g transform="translate(310,165)"><ellipse cx="0" cy="0" rx="55" ry="20" fill="#3a2a1d" opacity=".35"/><path d="M-44,0 q44,-32 88,0 l-15,18 l-58,0 z" fill="#e8d4a2"/><path d="M-44,0 q44,-32 88,0" fill="none" stroke="#74602f" stroke-width="2"/></g><g stroke="#f0e6d8" stroke-width="2" fill="none" opacity=".6"><path d="M120,205 q40,-6 80,0 t160,0 t160,0"/><path d="M60,213 q40,-5 80,0 t160,0 t160,0 t140,0"/></g></svg>`,
  leaves: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="leSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1f15"/><stop offset=".5" stop-color="#7a4a2e"/><stop offset="1" stop-color="#c9a370"/></linearGradient></defs><rect width="600" height="220" fill="url(#leSky)"/><circle cx="500" cy="60" r="26" fill="#d4b876" opacity=".8"/><circle cx="500" cy="60" r="46" fill="#d4b876" opacity=".25"/><path d="M0,170 Q150,150 300,165 T600,160 L600,220 L0,220 Z" fill="#4a2a18"/><path d="M0,185 Q150,175 300,182 T600,180 L600,220 L0,220 Z" fill="#6b3e22"/><path d="M0,200 Q150,195 300,202 T600,200 L600,220 L0,220 Z" fill="#8a5a36"/><g transform="translate(170,108)"><rect x="-7" y="0" width="14" height="80" fill="#2a1810"/><path d="M-7,30 q-12,5 -16,0 q5,-3 10,-2" fill="#2a1810"/><circle cx="0" cy="-22" r="48" fill="#8b3a2a"/><circle cx="-32" cy="-12" r="34" fill="#a85c2e"/><circle cx="30" cy="-18" r="38" fill="#6b2820"/><circle cx="0" cy="-45" r="30" fill="#b8814a"/><circle cx="-18" cy="-30" r="22" fill="#8b4a2a"/><circle cx="22" cy="-35" r="24" fill="#a06a3a"/></g><g transform="translate(440,118)"><rect x="-6" y="0" width="12" height="68" fill="#2a1810"/><circle cx="0" cy="-18" r="40" fill="#6b2820"/><circle cx="-28" cy="-12" r="30" fill="#8b3a2a"/><circle cx="26" cy="-10" r="32" fill="#a85c2e"/><circle cx="0" cy="-38" r="22" fill="#b8814a"/></g><g fill="#8b3a2a"><path d="M60,40 q-8,-12 0,-22 q8,10 0,22"/><path d="M260,30 q-8,-12 0,-22 q8,10 0,22" opacity=".75"/><path d="M340,55 q-8,-12 0,-22 q8,10 0,22" fill="#b8814a" opacity=".7"/></g><g fill="#6b2820" opacity=".7"><path d="M80,135 q-10,-8 -5,-18 q5,10 5,18z"/><path d="M280,150 q-10,-8 -5,-18 q5,10 5,18z" fill="#a85c2e"/><path d="M520,160 q-10,-8 -5,-18 q5,10 5,18z" fill="#b8814a"/><path d="M380,160 q-10,-8 -5,-18 q5,10 5,18z" fill="#8b4a2a"/></g></svg>`,
  storm: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="stSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13161e"/><stop offset=".55" stop-color="#2c3441"/><stop offset="1" stop-color="#5a6470"/></linearGradient></defs><rect width="600" height="220" fill="url(#stSky)"/><g fill="#1a212b"><ellipse cx="180" cy="55" rx="110" ry="28"/><ellipse cx="135" cy="65" rx="68" ry="20"/><ellipse cx="245" cy="62" rx="60" ry="22"/><ellipse cx="430" cy="50" rx="115" ry="30"/><ellipse cx="370" cy="68" rx="68" ry="20"/><ellipse cx="495" cy="65" rx="62" ry="20"/></g><g fill="#2c3441"><ellipse cx="180" cy="60" rx="95" ry="22" opacity=".85"/><ellipse cx="430" cy="58" rx="100" ry="24" opacity=".85"/></g><g stroke="#d4c89c" stroke-width="2.5" fill="#d4c89c" stroke-linejoin="round" opacity=".85"><path d="M210,90 l-12,28 l14,3 l-16,38 l36,-44 l-14,-3 l12,-22 z"/><path d="M440,100 l-10,24 l12,3 l-14,32 l30,-38 l-12,-3 l10,-18 z"/></g><g stroke="#a8b3c0" stroke-width="2" stroke-linecap="round" opacity=".65"><line x1="60" y1="100" x2="50" y2="138"/><line x1="100" y1="110" x2="90" y2="148"/><line x1="140" y1="115" x2="130" y2="152"/><line x1="280" y1="100" x2="270" y2="138"/><line x1="320" y1="115" x2="310" y2="152"/><line x1="360" y1="105" x2="350" y2="142"/><line x1="500" y1="100" x2="490" y2="138"/><line x1="540" y1="115" x2="530" y2="152"/><line x1="570" y1="105" x2="560" y2="142"/></g><path d="M0,170 Q150,160 300,170 T600,168 L600,220 L0,220 Z" fill="#0e1118"/><path d="M0,192 Q150,182 300,192 T600,188 L600,220 L0,220 Z" fill="#1a212b"/></svg>`,
  coastal: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="coSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f3445"/><stop offset=".55" stop-color="#7a8a9a"/><stop offset="1" stop-color="#d4b876"/></linearGradient><linearGradient id="coSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a5269"/><stop offset="1" stop-color="#15263a"/></linearGradient></defs><rect width="600" height="220" fill="url(#coSky)"/><circle cx="120" cy="55" r="22" fill="#e8d4a2" opacity=".85"/><circle cx="120" cy="55" r="42" fill="#e8d4a2" opacity=".25"/><g fill="#a8b3c0" opacity=".4"><ellipse cx="350" cy="55" rx="58" ry="11"/><ellipse cx="395" cy="65" rx="40" ry="9"/></g><rect x="0" y="130" width="600" height="90" fill="url(#coSea)"/><g transform="translate(460,40)"><rect x="-7" y="100" width="14" height="55" fill="#e8d9b6"/><polygon points="0,0 -28,100 28,100" fill="#e8d9b6"/><rect x="-22" y="100" width="44" height="14" fill="#5b1a2a"/><polygon points="-22,114 22,114 18,100 -18,100" fill="#2a1014"/><circle cx="0" cy="30" r="5" fill="#d4b876"/><rect x="-2" y="36" width="4" height="20" fill="#d4b876"/><polygon points="0,-12 -8,0 8,0" fill="#2a1014"/></g><g stroke="#a8c1d4" stroke-width="2.5" fill="none" opacity=".75"><path d="M0,140 q40,-12 80,0 t160,0 t160,0 t160,0"/></g><g stroke="#c8d4dc" stroke-width="2.5" fill="none" opacity=".9"><path d="M0,158 q40,-12 80,0 t160,0 t160,0 t160,0"/><path d="M0,178 q40,-12 80,0 t160,0 t160,0 t160,0"/><path d="M0,198 q40,-10 80,0 t160,0 t160,0 t160,0"/></g><g fill="#c8d4dc" opacity=".7"><path d="M180,135 q5,-5 10,0 q-3,2 -5,3 q-2,-1 -5,-3z"/><path d="M320,140 q5,-5 10,0 q-3,2 -5,3 q-2,-1 -5,-3z"/></g></svg>`,
  fire: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="fiSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#13080a"/><stop offset=".55" stop-color="#3a1810"/><stop offset="1" stop-color="#8b3a2a"/></linearGradient></defs><rect width="600" height="220" fill="url(#fiSky)"/><circle cx="500" cy="55" r="20" fill="#c47a52" opacity=".7"/><circle cx="500" cy="55" r="38" fill="#c47a52" opacity=".2"/><g><path d="M0,150 L80,128 L160,142 L240,124 L320,138 L400,120 L480,135 L560,118 L600,128 L600,220 L0,220 Z" fill="#1a0e0a"/><path d="M0,175 L70,162 L140,170 L220,158 L300,165 L380,150 L460,162 L540,150 L600,158 L600,220 L0,220 Z" fill="#2a1410"/></g><g><path d="M180,200 q-50,-15 -55,-60 q-5,15 -10,8 q3,-25 18,-40 q-5,12 2,15 q-2,-25 22,-50 q-3,28 14,40 q-2,-15 8,-20 q12,28 14,55 q3,-15 10,-5 q5,28 -23,57z" fill="#5b1a18"/><path d="M180,198 q-35,-12 -40,-45 q-3,12 -8,5 q3,-18 14,-30 q-3,10 2,12 q-2,-18 16,-38 q-3,20 12,28 q-2,-12 6,-15 q10,20 10,40 q3,-10 8,-3 q3,20 -20,46z" fill="#a85c2e"/><path d="M180,195 q-22,-8 -24,-30 q-2,8 -5,2 q2,-12 10,-20 q-2,8 1,10 q-2,-12 10,-25 q-2,14 8,18 q-2,-8 4,-10 q8,14 8,28 q3,-8 6,-2 q3,14 -18,29z" fill="#d4b876"/></g><g><path d="M400,205 q-40,-12 -45,-50 q-4,12 -8,6 q3,-20 14,-32 q-4,10 2,12 q-2,-20 18,-40 q-2,22 11,32 q-2,-12 6,-16 q10,22 11,44 q3,-10 8,-4 q4,22 -17,48z" fill="#5b1a18"/><path d="M400,203 q-26,-10 -30,-36 q-2,10 -6,4 q2,-14 11,-22 q-2,8 1,10 q-2,-14 12,-28 q-2,16 9,22 q-2,-10 4,-12 q7,16 8,30 q2,-10 6,-4 q3,16 -15,36z" fill="#c47a52"/></g><g fill="#d4b876" opacity=".75"><circle cx="80" cy="55" r="1.5"/><circle cx="160" cy="80" r="1"/><circle cx="240" cy="55" r="1.5"/><circle cx="280" cy="80" r="1"/><circle cx="340" cy="60" r="1.5"/><circle cx="460" cy="95" r="1"/><circle cx="520" cy="60" r="1.5"/><circle cx="60" cy="120" r="1"/><circle cx="270" cy="135" r="1.5"/><circle cx="500" cy="150" r="1"/></g></svg>`,
  ground: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="grSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a322c"/><stop offset="1" stop-color="#a89684"/></linearGradient></defs><rect width="600" height="220" fill="url(#grSky)"/><polygon points="0,135 110,75 220,128 320,90 420,128 510,85 600,118 600,220 0,220" fill="#5c5040" opacity=".7"/><polygon points="0,165 100,128 220,160 320,138 420,162 520,140 600,158 600,220 0,220" fill="#7a6c5a"/><g transform="translate(310,85)"><path d="M-72,52 L72,52 L0,-2 Z" fill="#3a2820"/><rect x="-65" y="52" width="130" height="78" fill="#e3d0a8"/><rect x="-65" y="52" width="130" height="3" fill="#3a2820" opacity=".4"/><rect x="-14" y="88" width="28" height="42" fill="#3a2820"/><rect x="-44" y="68" width="22" height="22" fill="#74602f"/><rect x="22" y="68" width="22" height="22" fill="#74602f"/><rect x="22" y="-12" width="14" height="22" fill="#3a322c"/></g><g stroke="#1f1813" stroke-width="3" fill="none"><path d="M0,200 l40,-8 l30,6 l50,-10 l40,8 l60,-12 l50,10 l60,-8 l50,6 l70,-12 l60,10 l40,-6 l40,8"/><path d="M0,212 l50,-4 l40,4 l60,-6 l50,4 l70,-8 l60,6 l50,-4 l80,6 l40,-4 l50,2 l50,-6"/><line x1="100" y1="180" x2="80" y2="200"/><line x1="290" y1="180" x2="270" y2="200"/><line x1="450" y1="180" x2="430" y2="200"/></g></svg>`,
  house: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="hoSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2a3a"/><stop offset=".5" stop-color="#7a6a5a"/><stop offset="1" stop-color="#d4b876"/></linearGradient><radialGradient id="hoSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8d4a2" stop-opacity=".55"/><stop offset="1" stop-color="#e8d4a2" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#hoSky)"/><circle cx="460" cy="70" r="65" fill="url(#hoSun)"/><circle cx="460" cy="70" r="22" fill="#d4b876" opacity=".75"/><path d="M0,170 Q150,158 300,165 T600,162 L600,220 L0,220 Z" fill="#3d4a36"/><path d="M0,188 Q150,178 300,185 T600,183 L600,220 L0,220 Z" fill="#566b54"/><path d="M0,205 Q150,200 300,208 T600,205 L600,220 L0,220 Z" fill="#728870"/><g transform="translate(180,110)"><path d="M-72,42 L72,42 L0,-15 Z" fill="#2a2018"/><path d="M-72,42 L72,42 L0,-3 Z" fill="#3a2d20" opacity=".75"/><rect x="-65" y="42" width="130" height="78" fill="#e8d9b6"/><rect x="-65" y="42" width="130" height="3" fill="#3a2d20" opacity=".4"/><rect x="-14" y="74" width="28" height="46" fill="#2a2018"/><circle cx="8" cy="96" r="1.5" fill="#b8843c"/><rect x="-46" y="56" width="22" height="22" fill="#c9a961"/><rect x="-46" y="56" width="22" height="22" fill="none" stroke="#2a2018" stroke-width="2"/><line x1="-35" y1="56" x2="-35" y2="78" stroke="#2a2018" stroke-width="1"/><line x1="-46" y1="67" x2="-24" y2="67" stroke="#2a2018" stroke-width="1"/><rect x="24" y="56" width="22" height="22" fill="#c9a961"/><rect x="24" y="56" width="22" height="22" fill="none" stroke="#2a2018" stroke-width="2"/><line x1="35" y1="56" x2="35" y2="78" stroke="#2a2018" stroke-width="1"/><line x1="24" y1="67" x2="46" y2="67" stroke="#2a2018" stroke-width="1"/><rect x="20" y="-22" width="14" height="22" fill="#2a2018"/></g><g transform="translate(430,100)"><path d="M-82,50 L82,50 L0,-22 Z" fill="#2a2018"/><path d="M-82,50 L82,50 L0,-10 Z" fill="#3a2d20" opacity=".75"/><rect x="-72" y="50" width="144" height="80" fill="#d4c2a3"/><rect x="-72" y="50" width="144" height="3" fill="#3a2d20" opacity=".4"/><rect x="-12" y="82" width="24" height="48" fill="#2a2018"/><rect x="-52" y="62" width="22" height="22" fill="#c9a961"/><rect x="-52" y="62" width="22" height="22" fill="none" stroke="#2a2018" stroke-width="2"/><rect x="32" y="62" width="22" height="22" fill="#c9a961"/><rect x="32" y="62" width="22" height="22" fill="none" stroke="#2a2018" stroke-width="2"/><rect x="22" y="-18" width="12" height="22" fill="#2a2018"/></g><g><ellipse cx="60" cy="175" rx="14" ry="6" fill="#000" opacity=".25"/><circle cx="60" cy="170" r="14" fill="#3d4a36"/><circle cx="55" cy="162" r="10" fill="#566b54"/><circle cx="65" cy="160" r="10" fill="#4a5a44"/><rect x="57" y="180" width="6" height="14" fill="#2a2018"/></g><g><ellipse cx="540" cy="185" rx="16" ry="6" fill="#000" opacity=".25"/><circle cx="540" cy="180" r="16" fill="#3d4a36"/><circle cx="534" cy="170" r="11" fill="#566b54"/><circle cx="545" cy="168" r="11" fill="#4a5a44"/><rect x="537" y="192" width="6" height="14" fill="#2a2018"/></g></svg>`,
  car: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="caSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1525"/><stop offset=".55" stop-color="#3a2a3a"/><stop offset="1" stop-color="#a8784a"/></linearGradient><linearGradient id="caBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d44"/><stop offset="1" stop-color="#13161e"/></linearGradient></defs><rect width="600" height="220" fill="url(#caSky)"/><circle cx="500" cy="55" r="22" fill="#d4b876" opacity=".75"/><circle cx="500" cy="55" r="46" fill="#d4b876" opacity=".2"/><polygon points="0,140 90,100 200,135 320,108 420,135 500,105 600,128 600,170 0,170" fill="#1a212b"/><rect x="0" y="165" width="600" height="55" fill="#0e1118"/><rect x="0" y="165" width="600" height="3" fill="#2c3441"/><g stroke="#c9a961" stroke-dasharray="22 12" stroke-width="2" opacity=".5"><line x1="0" y1="192" x2="600" y2="192"/></g><g transform="translate(300,138)"><ellipse cx="0" cy="40" rx="138" ry="6" fill="#000" opacity=".5"/><path d="M-118,18 q5,-34 32,-36 l22,-22 q5,-7 16,-8 l96,0 q11,1 16,8 l22,22 q28,2 32,36 l-5,16 l-22,0 q-3,-13 -16,-15 q-13,-2 -16,15 l-118,0 q-3,-13 -16,-15 q-13,-2 -16,15 l-22,0 z" fill="url(#caBody)"/><path d="M-60,-18 l16,-16 q3,-3 7,-3 l68,0 q4,0 7,3 l16,16 z" fill="#1a212b" opacity=".95"/><path d="M-58,-16 l14,-13 q3,-2 6,-2 l64,0 q3,0 6,2 l14,13 z" fill="#3a4254" opacity=".85"/><line x1="0" y1="-32" x2="0" y2="18" stroke="#a89684" stroke-width="1.2" opacity=".45"/><circle cx="-80" cy="22" r="20" fill="#0a0d12"/><circle cx="-80" cy="22" r="14" fill="#2c3441"/><circle cx="-80" cy="22" r="6" fill="#7a8a9a"/><circle cx="80" cy="22" r="20" fill="#0a0d12"/><circle cx="80" cy="22" r="14" fill="#2c3441"/><circle cx="80" cy="22" r="6" fill="#7a8a9a"/><rect x="100" y="-8" width="14" height="10" rx="2" fill="#5b1a18" opacity=".85"/><rect x="-114" y="-8" width="14" height="10" rx="2" fill="#d4b876"/><path d="M-30,8 l60,0" stroke="#a89684" stroke-width="1" opacity=".55"/></g></svg>`,
  bike: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="bkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1525"/><stop offset=".55" stop-color="#3a2a3a"/><stop offset="1" stop-color="#a8784a"/></linearGradient></defs><rect width="600" height="220" fill="url(#bkSky)"/><circle cx="500" cy="55" r="20" fill="#d4b876" opacity=".75"/><circle cx="500" cy="55" r="38" fill="#d4b876" opacity=".2"/><polygon points="0,150 100,110 200,135 300,115 400,140 500,108 600,130 600,180 0,180" fill="#1a212b"/><rect x="0" y="170" width="600" height="50" fill="#0e1118"/><g stroke="#c9a961" stroke-dasharray="22 12" stroke-width="2" opacity=".5"><line x1="0" y1="195" x2="600" y2="195"/></g><g transform="translate(300,150)"><ellipse cx="0" cy="38" rx="105" ry="6" fill="#000" opacity=".5"/><circle cx="-75" cy="20" r="32" fill="#0a0d12" stroke="#a89684" stroke-width="1.5"/><circle cx="-75" cy="20" r="22" fill="none" stroke="#7a8a9a" stroke-width="1" opacity=".5"/><circle cx="-75" cy="20" r="8" fill="#2c3441"/><circle cx="75" cy="20" r="32" fill="#0a0d12" stroke="#a89684" stroke-width="1.5"/><circle cx="75" cy="20" r="22" fill="none" stroke="#7a8a9a" stroke-width="1" opacity=".5"/><circle cx="75" cy="20" r="8" fill="#2c3441"/><path d="M-75,20 L-30,-15 L30,-15 L75,20" stroke="#5b1a18" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M-30,-15 L-22,-38 L18,-38" stroke="#1a212b" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="-12" y="-20" width="46" height="22" rx="4" fill="#2c3441"/><rect x="-12" y="-20" width="46" height="6" fill="#0e1118"/><polygon points="34,-2 60,5 30,3" fill="#0e1118"/><circle cx="-30" cy="-15" r="3" fill="#d4b876"/><circle cx="22" cy="-38" r="3" fill="#d4b876"/><rect x="60" y="-2" width="14" height="10" rx="2" fill="#d4b876"/></g></svg>`,
  rv: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="rvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a4a"/><stop offset="1" stop-color="#d4b876"/></linearGradient></defs><rect width="600" height="220" fill="url(#rvSky)"/><circle cx="100" cy="50" r="22" fill="#d4b876" opacity=".8"/><polygon points="0,130 100,80 220,120 320,90 440,130 540,100 600,120 600,180 0,180" fill="#2a3a2c" opacity=".75"/><polygon points="0,150 80,120 200,145 320,125 440,150 540,130 600,148 600,180 0,180" fill="#456a4f"/><rect x="0" y="170" width="600" height="50" fill="#7a6c5a"/><g stroke="#e8d4a2" stroke-dasharray="22 12" stroke-width="2" opacity=".6"><line x1="0" y1="195" x2="600" y2="195"/></g><g transform="translate(300,140)"><ellipse cx="0" cy="42" rx="160" ry="6" fill="#000" opacity=".4"/><rect x="-140" y="-30" width="240" height="55" rx="6" fill="#e8d9b6" stroke="#2a2018" stroke-width="1.5"/><rect x="-140" y="-55" width="80" height="25" rx="4" fill="#e8d9b6" stroke="#2a2018" stroke-width="1.5"/><rect x="-140" y="-30" width="240" height="5" fill="#5b1a2a" opacity=".75"/><rect x="100" y="-20" width="44" height="45" fill="#2a2018"/><polygon points="100,-20 144,-20 132,-30 112,-30" fill="#3a302a"/><rect x="-132" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="-100" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="-68" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="-36" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="-4" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="28" y="-22" width="26" height="20" fill="#7a8a9a"/><rect x="60" y="-22" width="32" height="34" fill="#2a2018"/><rect x="60" y="-22" width="32" height="34" fill="none" stroke="#3a302a" stroke-width="2"/><rect x="-135" y="-52" width="14" height="14" fill="#c9a961"/><circle cx="-90" cy="30" r="18" fill="#0e1118"/><circle cx="-90" cy="30" r="9" fill="#3a4254"/><circle cx="70" cy="30" r="18" fill="#0e1118"/><circle cx="70" cy="30" r="9" fill="#3a4254"/></g><g><polygon points="60,165 38,108 82,108" fill="#1f3024"/><polygon points="60,140 42,98 78,98" fill="#28402d"/><rect x="56" y="165" width="8" height="12" fill="#2a1810"/></g></svg>`,
  boat: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="boSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#15263a"/><stop offset=".55" stop-color="#7a6a4a"/><stop offset="1" stop-color="#d4b876"/></linearGradient><linearGradient id="boSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a5269"/><stop offset="1" stop-color="#0e1d35"/></linearGradient></defs><rect width="600" height="220" fill="url(#boSky)"/><circle cx="510" cy="60" r="28" fill="#e8d4a2"/><circle cx="510" cy="60" r="48" fill="#e8d4a2" opacity=".35"/><rect x="0" y="125" width="600" height="95" fill="url(#boSea)"/><g transform="translate(290,115)"><path d="M-120,18 L120,18 L95,48 L-95,48 Z" fill="#1f2530"/><path d="M-120,18 L120,18 L95,48 L-95,48 Z" fill="#5b1a2a" opacity=".25"/><rect x="-60" y="-12" width="120" height="30" fill="#e8d9b6"/><rect x="-60" y="-12" width="120" height="6" fill="#5b1a2a"/><rect x="-50" y="-5" width="22" height="18" fill="#c9a961"/><rect x="-20" y="-5" width="22" height="18" fill="#c9a961"/><rect x="10" y="-5" width="22" height="18" fill="#c9a961"/><rect x="40" y="-5" width="16" height="18" fill="#c9a961"/><line x1="0" y1="-12" x2="0" y2="-95" stroke="#2a2018" stroke-width="3"/><polygon points="-5,-95 -5,-12 -65,-12" fill="#e8d9b6"/><polygon points="-5,-95 -5,-12 -65,-12" fill="none" stroke="#a89684" stroke-width="1"/><polygon points="5,-80 5,-12 50,-12" fill="#e8d9b6"/><polygon points="5,-80 5,-12 50,-12" fill="none" stroke="#a89684" stroke-width="1"/><polygon points="0,-98 -6,-84 6,-84" fill="#5b1a2a"/></g><g stroke="#a8c1d4" stroke-width="3" fill="none" opacity=".7"><path d="M0,148 q40,-10 80,0 t160,0 t160,0 t160,0"/></g><g stroke="#c8d4dc" stroke-width="3" fill="none" opacity=".85"><path d="M0,168 q40,-12 80,0 t160,0 t160,0 t160,0"/><path d="M0,188 q40,-10 80,0 t160,0 t160,0 t160,0"/><path d="M0,205 q40,-8 80,0 t160,0 t160,0 t160,0"/></g><g fill="#e8d4a2" opacity=".75"><path d="M120,150 q5,-5 10,0 q-3,2 -5,3 q-2,-1 -5,-3z"/><path d="M450,158 q5,-5 10,0 q-3,2 -5,3 q-2,-1 -5,-3z"/></g></svg>`,
  gem: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><radialGradient id="gmGlow" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="#d4b876" stop-opacity=".4"/><stop offset="1" stop-color="#d4b876" stop-opacity="0"/></radialGradient><linearGradient id="gmBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1a2e"/><stop offset="1" stop-color="#3d3654"/></linearGradient></defs><rect width="600" height="220" fill="url(#gmBg)"/><circle cx="300" cy="115" r="180" fill="url(#gmGlow)"/><g transform="translate(300,110)"><polygon points="0,-68 70,-22 38,72 -38,72 -70,-22" fill="#5a4a72"/><polygon points="0,-68 70,-22 -70,-22" fill="#a89cc4"/><polygon points="0,-68 -70,-22 -38,72" fill="#3d3654"/><polygon points="0,-68 70,-22 38,72" fill="#4a3d62"/><polygon points="-70,-22 70,-22 38,72 -38,72" fill="#7a6c92" opacity=".35"/><polygon points="0,-68 34,-44 -34,-44" fill="#e8d4a2" opacity=".5"/><line x1="0" y1="-68" x2="0" y2="72" stroke="#fff" stroke-width="1" opacity=".4"/><line x1="-70" y1="-22" x2="70" y2="-22" stroke="#fff" stroke-width="1" opacity=".35"/><line x1="0" y1="-68" x2="-38" y2="72" stroke="#fff" stroke-width=".7" opacity=".25"/><line x1="0" y1="-68" x2="38" y2="72" stroke="#fff" stroke-width=".7" opacity=".25"/></g><g transform="translate(120,125)"><polygon points="0,-30 30,-8 22,42 -22,42 -30,-8" fill="#74602f"/><polygon points="0,-30 30,-8 -30,-8" fill="#c9a961"/><polygon points="0,-30 -30,-8 -22,42" fill="#5a4a22"/><polygon points="0,-30 30,-8 22,42" fill="#8b733a"/></g><g transform="translate(480,125)"><polygon points="0,-30 30,-8 22,42 -22,42 -30,-8" fill="#3d5462"/><polygon points="0,-30 30,-8 -30,-8" fill="#7a8a9a"/><polygon points="0,-30 -30,-8 -22,42" fill="#2c3e4a"/><polygon points="0,-30 30,-8 22,42" fill="#4a6072"/></g><g fill="#e8d4a2"><polygon points="90,45 94,37 98,45 94,53"/><polygon points="510,45 514,37 518,45 514,53"/><polygon points="200,30 204,22 208,30 204,38"/><polygon points="400,30 404,22 408,30 404,38"/><polygon points="80,180 84,172 88,180 84,188"/><polygon points="520,185 524,177 528,185 524,193"/></g><g fill="#e8d4a2" opacity=".65"><circle cx="100" cy="60" r="1.2"/><circle cx="500" cy="60" r="1.2"/><circle cx="160" cy="195" r="1"/><circle cx="440" cy="195" r="1"/></g></svg>`,
  umbrella: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="umSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3441"/><stop offset="1" stop-color="#7a8590"/></linearGradient></defs><rect width="600" height="220" fill="url(#umSky)"/><g fill="#1a212b" opacity=".6"><ellipse cx="120" cy="48" rx="68" ry="14"/><ellipse cx="80" cy="58" rx="46" ry="11"/><ellipse cx="480" cy="48" rx="68" ry="14"/><ellipse cx="520" cy="58" rx="46" ry="11"/></g><g stroke="#a8c1d4" stroke-width="2" stroke-linecap="round" opacity=".65"><line x1="60" y1="75" x2="48" y2="115"/><line x1="120" y1="85" x2="108" y2="125"/><line x1="180" y1="75" x2="168" y2="115"/><line x1="220" y1="90" x2="208" y2="130"/><line x1="380" y1="85" x2="368" y2="125"/><line x1="430" y1="75" x2="418" y2="115"/><line x1="490" y1="90" x2="478" y2="130"/><line x1="540" y1="75" x2="528" y2="115"/></g><g transform="translate(300,115)"><path d="M-110,18 a110,90 0 0 1 220,0 z" fill="#1a212b"/><path d="M-110,18 a110,90 0 0 1 220,0" fill="none" stroke="#0a0d12" stroke-width="2"/><path d="M-110,18 q55,-28 0,0 z" fill="#0a0d12" opacity=".4"/><path d="M-55,18 q55,-70 0,0 z" fill="#0a0d12" opacity=".4"/><path d="M0,18 q55,-86 0,0 z" fill="#0a0d12" opacity=".4"/><path d="M55,18 q55,-70 0,0 z" fill="#0a0d12" opacity=".4"/><circle cx="0" cy="18" r="4" fill="#c9a961"/><rect x="-2" y="22" width="4" height="65" fill="#0e1118"/><path d="M-2,87 q-2,12 -14,12" fill="none" stroke="#0e1118" stroke-width="5" stroke-linecap="round"/></g><path d="M0,170 Q150,160 300,170 T600,168 L600,220 L0,220 Z" fill="#15161a"/><path d="M0,192 Q150,182 300,192 T600,190 L600,220 L0,220 Z" fill="#0a0d12"/></svg>`,
  family: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="faSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2e3a"/><stop offset=".55" stop-color="#a8784a"/><stop offset="1" stop-color="#e8d4a2"/></linearGradient><radialGradient id="faSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8d4a2" stop-opacity=".5"/><stop offset="1" stop-color="#e8d4a2" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#faSky)"/><circle cx="300" cy="85" r="120" fill="url(#faSun)"/><circle cx="300" cy="85" r="30" fill="#f0e3c0" opacity=".85"/><path d="M0,165 Q150,155 300,165 T600,162 L600,220 L0,220 Z" fill="#2a3322"/><path d="M0,185 Q150,175 300,185 T600,182 L600,220 L0,220 Z" fill="#4a5530"/><g transform="translate(220,170)"><circle cx="0" cy="-32" r="11" fill="#1a212b"/><rect x="-12" y="-22" width="24" height="32" rx="3" fill="#1a212b"/><line x1="-12" y1="-10" x2="-18" y2="22" stroke="#1a212b" stroke-width="8" stroke-linecap="round"/><line x1="12" y1="-10" x2="18" y2="22" stroke="#1a212b" stroke-width="8" stroke-linecap="round"/><line x1="-8" y1="14" x2="-14" y2="50" stroke="#1a212b" stroke-width="8" stroke-linecap="round"/><line x1="8" y1="14" x2="14" y2="50" stroke="#1a212b" stroke-width="8" stroke-linecap="round"/></g><g transform="translate(380,170)"><circle cx="0" cy="-34" r="11" fill="#1a212b"/><path d="M-12,-34 q12,-22 24,-2" fill="#1a212b"/><path d="M-14,-22 q14,-4 28,0 l0,32 l-28,0 z" fill="#1a212b"/><line x1="-14" y1="-12" x2="-20" y2="22" stroke="#1a212b" stroke-width="9" stroke-linecap="round"/><line x1="14" y1="-12" x2="20" y2="22" stroke="#1a212b" stroke-width="9" stroke-linecap="round"/><line x1="-8" y1="14" x2="-14" y2="50" stroke="#1a212b" stroke-width="9" stroke-linecap="round"/><line x1="8" y1="14" x2="14" y2="50" stroke="#1a212b" stroke-width="9" stroke-linecap="round"/></g><g transform="translate(300,185)"><circle cx="0" cy="-18" r="7" fill="#1a212b"/><rect x="-7" y="-10" width="14" height="18" rx="2" fill="#1a212b"/><line x1="-7" y1="-3" x2="-12" y2="14" stroke="#1a212b" stroke-width="6" stroke-linecap="round"/><line x1="7" y1="-3" x2="12" y2="14" stroke="#1a212b" stroke-width="6" stroke-linecap="round"/></g><g><polygon points="80,180 60,128 100,128" fill="#1a2818"/><polygon points="80,158 64,118 96,118" fill="#28402d"/><rect x="76" y="180" width="8" height="12" fill="#2a1810"/></g><g><polygon points="520,180 500,128 540,128" fill="#1a2818"/><polygon points="520,158 504,118 536,118" fill="#28402d"/><rect x="516" y="180" width="8" height="12" fill="#2a1810"/></g></svg>`,
  rings: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="riBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a141e"/><stop offset="1" stop-color="#5b2a3a"/></linearGradient><radialGradient id="riGlow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8d4a2" stop-opacity=".6"/><stop offset="1" stop-color="#e8d4a2" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#riBg)"/><circle cx="300" cy="115" r="180" fill="url(#riGlow)"/><g transform="translate(300,115)"><ellipse cx="-40" cy="46" rx="46" ry="6" fill="#000" opacity=".5"/><ellipse cx="40" cy="46" rx="46" ry="6" fill="#000" opacity=".5"/><circle cx="-40" cy="0" r="48" fill="none" stroke="#c9a961" stroke-width="11"/><circle cx="-40" cy="0" r="48" fill="none" stroke="#e8d4a2" stroke-width="2" opacity=".75"/><circle cx="-40" cy="0" r="48" fill="none" stroke="#74602f" stroke-width="1" opacity=".8"/><circle cx="-40" cy="-58" r="7" fill="#a89cc4"/><polygon points="-44,-66 -36,-66 -38,-50 -42,-50" fill="#fff" opacity=".75"/><circle cx="40" cy="0" r="48" fill="none" stroke="#c9a961" stroke-width="11"/><circle cx="40" cy="0" r="48" fill="none" stroke="#e8d4a2" stroke-width="2" opacity=".75"/><circle cx="40" cy="0" r="48" fill="none" stroke="#74602f" stroke-width="1" opacity=".8"/></g><g transform="translate(140,108)" fill="#8b3a4a"><path d="M0,-22 q-18,-22 -32,-4 q-14,18 32,40 q46,-22 32,-40 q-14,-18 -32,4z"/></g><g transform="translate(460,108)" fill="#8b3a4a"><path d="M0,-22 q-18,-22 -32,-4 q-14,18 32,40 q46,-22 32,-40 q-14,-18 -32,4z"/></g><g fill="#e8d4a2"><polygon points="100,50 104,42 108,50 104,58"/><polygon points="490,50 494,42 498,50 494,58"/><polygon points="200,35 204,27 208,35 204,43"/><polygon points="400,35 404,27 408,35 404,43"/></g></svg>`,
  stroller: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="srBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a3a"/><stop offset=".55" stop-color="#a8847a"/><stop offset="1" stop-color="#e8d4c8"/></linearGradient></defs><rect width="600" height="220" fill="url(#srBg)"/><circle cx="490" cy="55" r="22" fill="#e8d4a2" opacity=".75"/><circle cx="490" cy="55" r="42" fill="#e8d4a2" opacity=".25"/><path d="M0,175 Q150,165 300,175 T600,170 L600,220 L0,220 Z" fill="#6a5a4a"/><path d="M0,195 Q150,185 300,195 T600,190 L600,220 L0,220 Z" fill="#8a7a6a"/><g transform="translate(300,135)"><ellipse cx="0" cy="50" rx="85" ry="6" fill="#000" opacity=".3"/><path d="M-60,-12 a60,60 0 0 1 120,0 l-120,0 z" fill="#54344a"/><path d="M-60,-12 a60,60 0 0 1 120,0" fill="none" stroke="#3a1c30" stroke-width="2"/><rect x="-60" y="-12" width="120" height="30" fill="#54344a" rx="4"/><rect x="-60" y="-12" width="120" height="5" fill="#3a1c30"/><path d="M-60,-12 L-80,-58" stroke="#1a212b" stroke-width="5" stroke-linecap="round"/><circle cx="-80" cy="-58" r="4" fill="#1a212b"/><circle cx="-45" cy="35" r="18" fill="#0e1118"/><circle cx="-45" cy="35" r="11" fill="#2c3441"/><circle cx="-45" cy="35" r="5" fill="#a89684"/><circle cx="45" cy="35" r="18" fill="#0e1118"/><circle cx="45" cy="35" r="11" fill="#2c3441"/><circle cx="45" cy="35" r="5" fill="#a89684"/><circle cx="0" cy="-5" r="12" fill="#e8d4c8" stroke="#1a212b" stroke-width="1.2"/></g><g transform="translate(120,155)" fill="#d4a5a5"><path d="M0,-12 q-12,-14 -20,-2 q-8,12 20,24 q28,-12 20,-24 q-8,-12 -20,2z"/></g><g transform="translate(490,160)" fill="#d4a5a5"><path d="M0,-12 q-12,-14 -20,-2 q-8,12 20,24 q28,-12 20,-24 q-8,-12 -20,2z"/></g></svg>`,
  city: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="ciSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1525"/><stop offset=".5" stop-color="#3a2c44"/><stop offset="1" stop-color="#c47a52"/></linearGradient><radialGradient id="ciSun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8d4a2" stop-opacity=".55"/><stop offset="1" stop-color="#e8d4a2" stop-opacity="0"/></radialGradient></defs><rect width="600" height="220" fill="url(#ciSky)"/><circle cx="480" cy="80" r="70" fill="url(#ciSun)"/><circle cx="480" cy="80" r="26" fill="#e8d4a2" opacity=".8"/><g fill="#0a0d12"><polygon points="0,160 50,140 50,220 0,220"/><rect x="40" y="100" width="50" height="120"/><rect x="85" y="80" width="60" height="140"/><rect x="140" y="55" width="65" height="165"/><polygon points="172,55 205,55 188,30"/><rect x="200" y="90" width="55" height="130"/><rect x="248" y="70" width="75" height="150"/><polygon points="248,70 323,70 285,40"/><rect x="318" y="50" width="55" height="170"/><rect x="370" y="80" width="65" height="140"/><rect x="430" y="60" width="50" height="160"/><rect x="475" y="90" width="60" height="130"/><rect x="530" y="70" width="45" height="150"/><polygon points="570,160 600,140 600,220 570,220"/></g><g fill="#13161e"><rect x="0" y="172" width="600" height="48"/></g><g fill="#d4b876"><rect x="52" y="115" width="5" height="7"/><rect x="68" y="135" width="5" height="7"/><rect x="52" y="155" width="5" height="7"/><rect x="100" y="95" width="5" height="7"/><rect x="118" y="115" width="5" height="7"/><rect x="100" y="135" width="5" height="7"/><rect x="125" y="155" width="5" height="7"/><rect x="152" y="75" width="5" height="7"/><rect x="170" y="95" width="5" height="7"/><rect x="152" y="115" width="5" height="7"/><rect x="187" y="135" width="5" height="7"/><rect x="170" y="155" width="5" height="7"/><rect x="215" y="105" width="5" height="7"/><rect x="232" y="125" width="5" height="7"/><rect x="215" y="145" width="5" height="7"/><rect x="262" y="85" width="5" height="7"/><rect x="282" y="105" width="5" height="7"/><rect x="305" y="125" width="5" height="7"/><rect x="262" y="145" width="5" height="7"/><rect x="330" y="65" width="5" height="7"/><rect x="350" y="85" width="5" height="7"/><rect x="332" y="105" width="5" height="7"/><rect x="358" y="125" width="5" height="7"/><rect x="332" y="145" width="5" height="7"/><rect x="382" y="95" width="5" height="7"/><rect x="402" y="115" width="5" height="7"/><rect x="420" y="135" width="5" height="7"/><rect x="385" y="155" width="5" height="7"/><rect x="442" y="75" width="5" height="7"/><rect x="460" y="105" width="5" height="7"/><rect x="442" y="135" width="5" height="7"/><rect x="487" y="105" width="5" height="7"/><rect x="510" y="135" width="5" height="7"/><rect x="487" y="155" width="5" height="7"/><rect x="540" y="85" width="5" height="7"/><rect x="556" y="115" width="5" height="7"/><rect x="540" y="145" width="5" height="7"/></g><g stroke="#c9a961" stroke-dasharray="14 8" stroke-width="2" opacity=".6"><line x1="0" y1="198" x2="600" y2="198"/></g></svg>`,
  circuit: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="cyBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1015"/><stop offset="1" stop-color="#1a2842"/></linearGradient></defs><rect width="600" height="220" fill="url(#cyBg)"/><g stroke="#5a7a8a" stroke-width="1.2" fill="none" opacity=".7"><path d="M40,40 L120,40 L120,80 L200,80"/><path d="M40,180 L160,180 L160,140 L240,140"/><path d="M440,40 L520,40 L520,80 L580,80"/><path d="M460,180 L560,180 L560,140 L580,140"/><path d="M20,110 L80,110 L80,60"/><path d="M580,110 L520,110 L520,160"/><circle cx="40" cy="40" r="3.5" fill="#c9a961"/><circle cx="200" cy="80" r="3.5" fill="#c9a961"/><circle cx="40" cy="180" r="3.5" fill="#c9a961"/><circle cx="240" cy="140" r="3.5" fill="#c9a961"/><circle cx="440" cy="40" r="3.5" fill="#c9a961"/><circle cx="580" cy="80" r="3.5" fill="#c9a961"/><circle cx="460" cy="180" r="3.5" fill="#c9a961"/><circle cx="80" cy="60" r="3.5" fill="#c9a961"/></g><g transform="translate(300,110)"><path d="M0,-72 L72,-46 L72,18 Q72,58 0,82 Q-72,58 -72,18 L-72,-46 Z" fill="#1a2c44" stroke="#c9a961" stroke-width="2.5"/><path d="M0,-72 L72,-46 L72,18 Q72,58 0,82 Q-72,58 -72,18 L-72,-46 Z" fill="#c9a961" opacity=".12"/><path d="M-28,8 l20,20 l40,-40" stroke="#e8d4a2" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="-52" cy="-32" r="2.5" fill="#c9a961"/><circle cx="52" cy="-32" r="2.5" fill="#c9a961"/><circle cx="0" cy="-72" r="3" fill="#c9a961"/></g><g fill="#c9a961" opacity=".55"><rect x="20" y="30" width="3" height="3"/><rect x="120" y="30" width="3" height="3"/><rect x="20" y="170" width="3" height="3"/><rect x="460" y="30" width="3" height="3"/><rect x="560" y="30" width="3" height="3"/><rect x="460" y="170" width="3" height="3"/></g></svg>`,
  fireworks: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="fwSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0a14"/><stop offset="1" stop-color="#2a1c3a"/></linearGradient></defs><rect width="600" height="220" fill="url(#fwSky)"/><g fill="#0a0d12"><polygon points="0,170 60,160 100,168 160,158 220,170 280,160 340,168 400,158 460,170 520,160 580,168 600,165 600,220 0,220"/><rect x="80" y="180" width="14" height="20"/><rect x="170" y="175" width="14" height="25"/><rect x="280" y="180" width="14" height="20"/><rect x="380" y="175" width="14" height="25"/><rect x="490" y="180" width="14" height="20"/></g><g fill="#c9a961"><rect x="82" y="184" width="4" height="4"/><rect x="86" y="190" width="4" height="4"/><rect x="172" y="180" width="4" height="4"/><rect x="178" y="188" width="4" height="4"/><rect x="282" y="184" width="4" height="4"/><rect x="288" y="190" width="4" height="4"/><rect x="382" y="180" width="4" height="4"/><rect x="388" y="188" width="4" height="4"/><rect x="492" y="184" width="4" height="4"/><rect x="498" y="190" width="4" height="4"/></g><g transform="translate(160,80)" stroke="#c9a961" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".85"><line x1="0" y1="0" x2="0" y2="-44"/><line x1="0" y1="0" x2="31" y2="-31"/><line x1="0" y1="0" x2="44" y2="0"/><line x1="0" y1="0" x2="31" y2="31"/><line x1="0" y1="0" x2="0" y2="44"/><line x1="0" y1="0" x2="-31" y2="31"/><line x1="0" y1="0" x2="-44" y2="0"/><line x1="0" y1="0" x2="-31" y2="-31"/><line x1="0" y1="0" x2="40" y2="-18"/><line x1="0" y1="0" x2="-40" y2="-18"/></g><g transform="translate(160,80)" fill="#e8d4a2"><circle cx="0" cy="-48" r="2.5"/><circle cx="34" cy="-34" r="2.5"/><circle cx="48" cy="0" r="2.5"/><circle cx="34" cy="34" r="2.5"/><circle cx="0" cy="48" r="2.5"/><circle cx="-34" cy="34" r="2.5"/><circle cx="-48" cy="0" r="2.5"/><circle cx="-34" cy="-34" r="2.5"/></g><g transform="translate(310,110)" stroke="#d4b8a5" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".85"><line x1="0" y1="0" x2="0" y2="-54"/><line x1="0" y1="0" x2="38" y2="-38"/><line x1="0" y1="0" x2="54" y2="0"/><line x1="0" y1="0" x2="38" y2="38"/><line x1="0" y1="0" x2="0" y2="54"/><line x1="0" y1="0" x2="-38" y2="38"/><line x1="0" y1="0" x2="-54" y2="0"/><line x1="0" y1="0" x2="-38" y2="-38"/></g><g transform="translate(310,110)" fill="#f0e3c0"><circle cx="0" cy="-58" r="2.5"/><circle cx="42" cy="-42" r="2.5"/><circle cx="58" cy="0" r="2.5"/><circle cx="42" cy="42" r="2.5"/><circle cx="0" cy="58" r="2.5"/><circle cx="-42" cy="42" r="2.5"/><circle cx="-58" cy="0" r="2.5"/><circle cx="-42" cy="-42" r="2.5"/></g><g transform="translate(460,70)" stroke="#a8c1d4" stroke-width="2.5" stroke-linecap="round" fill="none" opacity=".75"><line x1="0" y1="0" x2="0" y2="-40"/><line x1="0" y1="0" x2="28" y2="-28"/><line x1="0" y1="0" x2="40" y2="0"/><line x1="0" y1="0" x2="28" y2="28"/><line x1="0" y1="0" x2="0" y2="40"/><line x1="0" y1="0" x2="-28" y2="28"/><line x1="0" y1="0" x2="-40" y2="0"/><line x1="0" y1="0" x2="-28" y2="-28"/></g><g transform="translate(460,70)" fill="#d4dce4"><circle cx="0" cy="-44" r="2.5"/><circle cx="44" cy="0" r="2.5"/><circle cx="0" cy="44" r="2.5"/><circle cx="-44" cy="0" r="2.5"/></g><g fill="#e8d4a2" opacity=".55"><circle cx="60" cy="40" r="1.2"/><circle cx="80" cy="100" r="1"/><circle cx="540" cy="140" r="1.2"/><circle cx="240" cy="50" r="1"/></g></svg>`,
  shield: `<svg viewBox="0 0 600 220" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:220px"><defs><linearGradient id="shBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1525"/><stop offset="1" stop-color="#2a3a55"/></linearGradient><radialGradient id="shGlow" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="#c9a961" stop-opacity=".4"/><stop offset="1" stop-color="#c9a961" stop-opacity="0"/></radialGradient><linearGradient id="shGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8d4a2"/><stop offset=".5" stop-color="#c9a961"/><stop offset="1" stop-color="#74602f"/></linearGradient></defs><rect width="600" height="220" fill="url(#shBg)"/><circle cx="300" cy="115" r="170" fill="url(#shGlow)"/><g transform="translate(300,115)"><path d="M0,-78 L78,-50 L78,18 Q78,62 0,84 Q-78,62 -78,18 L-78,-50 Z" fill="url(#shGold)"/><path d="M0,-78 L78,-50 L78,18 Q78,62 0,84 Q-78,62 -78,18 L-78,-50 Z" fill="none" stroke="#f0e3c0" stroke-width="1" opacity=".75"/><path d="M0,-78 L0,84" stroke="#74602f" stroke-width=".7" opacity=".4"/><path d="M-78,-50 L78,-50" stroke="#74602f" stroke-width=".7" opacity=".4"/><path d="M-34,8 l24,24 l44,-44" stroke="#1a2530" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g><g transform="translate(130,115)"><path d="M0,-42 L42,-27 L42,10 Q42,34 0,46 Q-42,34 -42,10 L-42,-27 Z" fill="#1a2842" stroke="#5a7a8a" stroke-width="1.5"/><path d="M-18,4 l12,12 l22,-22" stroke="#c9a961" stroke-width="3" fill="none" stroke-linecap="round"/></g><g transform="translate(470,115)"><path d="M0,-42 L42,-27 L42,10 Q42,34 0,46 Q-42,34 -42,10 L-42,-27 Z" fill="#1a2842" stroke="#5a7a8a" stroke-width="1.5"/><path d="M-18,4 l12,12 l22,-22" stroke="#c9a961" stroke-width="3" fill="none" stroke-linecap="round"/></g><g fill="#e8d4a2" opacity=".6"><polygon points="100,55 104,47 108,55 104,63"/><polygon points="500,55 504,47 508,55 504,63"/><polygon points="80,170 84,162 88,170 84,178"/><polygon points="520,170 524,162 528,170 524,178"/></g></svg>`,
};

// =====================================================================
// Web preview
// =====================================================================

export function PamphletPreview({
  pamphlet,
}: {
  pamphlet: DraftedPamphlet;
}) {
  const palette = PALETTES[pamphlet.accent] ?? PALETTES.generic;
  const HeaderIcon = ACCENT_HEADER_ICON[pamphlet.accent] ?? Sparkles;
  const maxWidth =
    pamphlet.layout === "postcard" ? 520 : pamphlet.layout === "magazine" ? 880 : 720;

  return (
    <div
      className="mx-auto rounded-2xl overflow-hidden shadow-luxe font-sans"
      style={{ maxWidth, background: palette.footerBg, color: palette.ink }}
    >
      {/* Brand banner — white tile with the agency mark + crested
          shield logo, sitting on the hero gradient. The curved bottom
          edge (clip-path) sweeps into the hero so the banner reads as
          an embedded plaque rather than a separate strip. */}
      <div
        className="relative"
        style={{
          background: `linear-gradient(135deg, ${palette.heroFrom} 0%, ${palette.heroTo} 100%)`,
        }}
      >
        <div
          className="relative px-6 py-5 flex items-center gap-3.5"
          style={{
            background: "#fff",
            clipPath:
              "polygon(0 0, 100% 0, 100% 100%, 70% 100%, 65% calc(100% - 18px), 35% calc(100% - 18px), 30% 100%, 0 100%)",
          }}
        >
          <div className="relative">
            <div
              className="h-12 w-12 rounded-md flex items-center justify-center shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${palette.heroFrom} 0%, ${palette.heroTo} 100%)`,
                color: palette.accent,
                border: `1px solid ${palette.accent}`,
              }}
            >
              <ShieldCheck className="h-6 w-6" />
            </div>
          </div>
          <div className="min-w-0">
            <div
              className="font-display text-[22px] tracking-[0.04em] leading-tight uppercase font-semibold"
              style={{ color: palette.heroFrom }}
            >
              {pamphlet.agency.name}
            </div>
            <div
              className="text-[10px] uppercase tracking-[0.28em] mt-0.5 inline-flex items-center gap-2"
              style={{ color: palette.inkSoft }}
            >
              <span className="h-px w-3" style={{ background: palette.accent }} />
              Insurance Agency
              <span className="h-px w-3" style={{ background: palette.accent }} />
            </div>
          </div>
          <div className="ml-auto" style={{ color: palette.accent }}>
            <HeaderIcon className="h-6 w-6" />
          </div>
        </div>
      </div>

      {pamphlet.sections.map((section, i) => (
        <SectionRender
          key={`${section.kind}-${i}`}
          section={section}
          palette={palette}
          HeaderIcon={HeaderIcon}
          accent={pamphlet.accent}
          altRow={i % 2 === 1}
          pamphlet={pamphlet}
        />
      ))}
    </div>
  );
}

function SectionRender({
  section,
  palette,
  HeaderIcon,
  accent,
  altRow,
  pamphlet,
}: {
  section: PamphletSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  accent: PamphletAccent;
  altRow: boolean;
  pamphlet: DraftedPamphlet;
}) {
  switch (section.kind) {
    case "hero":
      return <HeroRender section={section} palette={palette} HeaderIcon={HeaderIcon} accent={accent} pamphlet={pamphlet} />;
    case "ribbon":
      return <RibbonRender section={section} />;
    case "stats":
      return <StatsRender section={section} palette={palette} HeaderIcon={HeaderIcon} altRow={altRow} />;
    case "highlights":
      return <HighlightsRender section={section} palette={palette} HeaderIcon={HeaderIcon} altRow={altRow} />;
    case "comparison":
      return <ComparisonRender section={section} palette={palette} altRow={altRow} />;
    case "testimonial":
      return <TestimonialRender section={section} palette={palette} />;
    case "steps":
      return <StepsRender section={section} palette={palette} HeaderIcon={HeaderIcon} altRow={altRow} />;
    case "faq":
      return <FaqRender section={section} palette={palette} HeaderIcon={HeaderIcon} altRow={altRow} />;
    case "cta":
      return <CtaRender section={section} palette={palette} HeaderIcon={HeaderIcon} />;
    case "contact":
      return <ContactRender section={section} palette={palette} />;
    case "disclaimer":
      return <DisclaimerRender section={section} palette={palette} />;
  }
}

function HeroRender({
  section,
  palette,
  HeaderIcon,
  accent,
  pamphlet,
}: {
  section: HeroSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  accent: PamphletAccent;
  pamphlet: DraftedPamphlet;
}) {
  const sceneSvg = SCENES[ACCENT_SCENE[accent] ?? "shield"] ?? SCENES.shield;
  const aiImageUrl = heroImageUrl(pamphlet);
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${palette.heroFrom} 0%, ${palette.heroTo} 100%)`,
        color: "#fff",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,0) 60%)" }}
        aria-hidden
      />
      <div className="relative grid grid-cols-1 sm:grid-cols-[1.05fr_minmax(0,1fr)] items-stretch min-h-[420px]">
        <div className="relative z-10 px-7 sm:px-8 pt-10 pb-8 sm:py-12 flex flex-col justify-center">
          {section.eyebrow && (
            <div
              className="text-[11px] uppercase tracking-[0.24em] mb-3 font-semibold inline-flex items-center gap-2"
              style={{ color: palette.accent }}
            >
              <span className="h-px w-4" style={{ background: palette.accent }} />
              {section.eyebrow}
            </div>
          )}
          <h1
            className="font-display text-[34px] sm:text-[44px] leading-[1.04] tracking-tight font-semibold"
            style={{ color: "#fff" }}
          >
            {section.headline}
          </h1>
          <div className="mt-5 flex items-center gap-3" aria-hidden>
            <span
              className="h-9 w-9 rounded-full inline-flex items-center justify-center shadow-sm"
              style={{
                background: palette.accent,
                color: palette.heroFrom,
                border: `1px solid ${palette.accent}`,
              }}
            >
              <HeaderIcon className="h-4 w-4" />
            </span>
            <span className="h-px flex-1 max-w-[120px]" style={{ background: "rgba(255,255,255,.35)" }} />
          </div>
          <p
            className="mt-5 text-[17px] sm:text-[19px] font-medium leading-snug"
            style={{ color: palette.accent }}
          >
            {section.subheadline}
          </p>
          <p
            className="mt-3 text-[13.5px] leading-relaxed"
            style={{ color: "rgba(255,255,255,.9)" }}
          >
            {section.intro}
          </p>
        </div>

        <div className="relative h-[260px] sm:h-auto overflow-hidden bg-black/20">
          {/* SVG scene renders synchronously as the placeholder; the AI
              image fades in on load and falls back to the SVG on error
              (network / API issue). */}
          <div
            className="absolute inset-0 [&_svg]:!w-full [&_svg]:!h-full [&_svg]:!block"
            aria-hidden
            dangerouslySetInnerHTML={{
              __html: sceneSvg.replace(
                'preserveAspectRatio="xMidYMax slice"',
                'preserveAspectRatio="xMidYMid slice"'
              ),
            }}
          />
          <img
            key={aiImageUrl}
            src={aiImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-700"
            onLoad={(e) => {
              (e.currentTarget as HTMLImageElement).style.opacity = "1";
            }}
            onError={(e) => {
              // Keep the SVG fallback visible. Hide the broken image.
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          {/* Soft gradient fade from the navy hero into the scene so
              the seam reads as a luxury image card rather than a hard
              column split. */}
          <div
            className="absolute inset-y-0 left-0 w-24 sm:w-32 pointer-events-none"
            style={{
              background: `linear-gradient(to right, ${palette.heroFrom} 0%, transparent 100%)`,
            }}
            aria-hidden
          />
          <div
            className="absolute inset-x-0 top-0 h-16 pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, rgba(0,0,0,.18), transparent)`,
            }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}

function RibbonRender({ section }: { section: RibbonSection }) {
  const tone = section.tone ?? "info";
  const bg =
    tone === "warning"
      ? "#d97706"
      : tone === "urgent"
      ? "#dc2626"
      : tone === "success"
      ? "#059669"
      : "#2563eb";
  return (
    <div
      className="px-6 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.18em]"
      style={{ background: bg, color: "#fff" }}
    >
      {section.text}
    </div>
  );
}

// Small decorative leaf ornament that flanks panel titles. Matches
// the reference pamphlet's leaf-flourish treatment around "Why
// reinstate your coverage now?". Mirrored via CSS transform on the
// right-hand instance.
const LEAF_SVG = `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" style="display:block;width:22px;height:14px"><path d="M2 14 C6 10, 10 6, 22 2 C20 8, 14 13, 6 14 Z" fill="currentColor" opacity=".55"/><path d="M2 14 C6 10, 10 6, 22 2" fill="none" stroke="currentColor" stroke-width=".8" stroke-linecap="round"/><path d="M12 10 l4 -4 M8 12 l3 -3 M16 8 l3 -3" stroke="currentColor" stroke-width=".7" stroke-linecap="round"/></svg>`;

function PanelHeader({
  title,
  palette,
}: {
  title: string;
  palette: Palette;
  HeaderIcon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center mb-6">
      <div
        className="flex items-center justify-center gap-3 mb-1"
        style={{ color: palette.accent }}
      >
        <span aria-hidden dangerouslySetInnerHTML={{ __html: LEAF_SVG }} />
        <h3
          className="font-display text-[26px] text-center font-semibold leading-tight"
          style={{ color: palette.heroFrom }}
        >
          {title}
        </h3>
        <span
          aria-hidden
          style={{ transform: "scaleX(-1)" }}
          dangerouslySetInnerHTML={{ __html: LEAF_SVG }}
        />
      </div>
      <span
        className="mt-2 h-[2px] w-14 rounded-full"
        style={{ background: palette.accent }}
        aria-hidden
      />
    </div>
  );
}

function StatsRender({
  section,
  palette,
  HeaderIcon,
  altRow,
}: {
  section: StatsSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  altRow: boolean;
}) {
  return (
    <div
      className="px-6 py-10"
      style={{ background: altRow ? palette.panelAlt : palette.panel, color: palette.ink }}
    >
      {section.title && <PanelHeader title={section.title} palette={palette} HeaderIcon={HeaderIcon} />}
      <div
        className={`grid gap-5 ${
          section.items.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : `grid-cols-${Math.max(2, section.items.length)}`
        }`}
      >
        {section.items.map((s, i) => (
          <div
            key={i}
            className="text-center rounded-xl px-3 py-5 border"
            style={{ background: "#fff", borderColor: palette.accentSoft }}
          >
            <div className="font-display text-3xl sm:text-4xl font-bold leading-none" style={{ color: palette.accentDeep }}>
              {s.value}
            </div>
            <div className="text-[12.5px] font-semibold mt-2" style={{ color: palette.ink }}>
              {s.label}
            </div>
            {s.sub && (
              <div className="text-[11px] mt-1" style={{ color: palette.inkSoft }}>
                {s.sub}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function HighlightsRender({
  section,
  palette,
  HeaderIcon,
  altRow,
}: {
  section: HighlightsSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  altRow: boolean;
}) {
  return (
    <div
      className="px-6 py-10"
      style={{ background: altRow ? palette.panelAlt : palette.panel, color: palette.ink }}
    >
      <PanelHeader title={section.title} palette={palette} HeaderIcon={HeaderIcon} />
      <div
        className={`grid gap-6 ${
          section.items.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : `grid-cols-${Math.max(2, section.items.length)}`
        }`}
      >
        {section.items.map((b, i) => {
          const Icon = ICONS[b.icon] ?? Sparkles;
          return (
            <div key={i} className="flex flex-col items-center text-center">
              <div
                className="h-16 w-16 rounded-full flex items-center justify-center mb-3"
                style={{
                  background: palette.accentSoft,
                  color: palette.heroFrom,
                  border: `1px solid ${palette.accent}`,
                }}
              >
                <Icon className="h-7 w-7" />
              </div>
              <div className="text-[13px] font-semibold leading-snug" style={{ color: palette.heroFrom }}>
                {b.label}
              </div>
              {b.detail && (
                <div className="text-[11.5px] mt-1 leading-snug" style={{ color: palette.inkSoft }}>
                  {b.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComparisonRender({
  section,
  palette,
  altRow,
}: {
  section: ComparisonSection;
  palette: Palette;
  altRow: boolean;
}) {
  return (
    <div
      className="px-6 py-10"
      style={{ background: altRow ? palette.panelAlt : palette.panel, color: palette.ink }}
    >
      <h3
        className="font-display text-2xl text-center mb-6 font-semibold"
        style={{ color: palette.accentDeep }}
      >
        {section.title}
      </h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {section.columns.map((col, i) => {
          const tone = col.tone;
          const bg = tone === "positive" ? "#ecfdf5" : tone === "negative" ? "#fef2f2" : "#f8fafc";
          const border = tone === "positive" ? "#a7f3d0" : tone === "negative" ? "#fecaca" : "#e5e7eb";
          const ringColor = tone === "positive" ? "#059669" : tone === "negative" ? "#dc2626" : "#64748b";
          const Icon = tone === "positive" ? Check : tone === "negative" ? X : Sparkles;
          return (
            <div
              key={i}
              className="rounded-xl p-4 border"
              style={{ background: bg, borderColor: border }}
            >
              <div
                className="text-[11.5px] font-bold mb-3 uppercase tracking-[0.1em]"
                style={{ color: ringColor }}
              >
                {col.heading}
              </div>
              <ul className="space-y-2">
                {col.items.map((it, j) => (
                  <li key={j} className="flex items-start gap-2 text-[13px] leading-snug">
                    <span
                      className="h-5 w-5 rounded-full inline-flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: ringColor, color: "#fff" }}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <span style={{ color: palette.ink }}>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TestimonialRender({
  section,
  palette,
}: {
  section: TestimonialSection;
  palette: Palette;
}) {
  return (
    <div
      className="px-6 py-12 relative"
      style={{
        background: `linear-gradient(135deg, ${palette.accentSoft} 0%, ${palette.panel} 100%)`,
        color: palette.ink,
      }}
    >
      <Quote
        className="absolute top-6 left-6 h-10 w-10"
        style={{ color: palette.accent, opacity: 0.3 }}
        aria-hidden
      />
      <div className="max-w-xl mx-auto text-center relative">
        {section.rating && (
          <div className="flex justify-center gap-1 mb-4" style={{ color: palette.accent }}>
            {Array.from({ length: section.rating }).map((_, i) => (
              <Star key={i} className="h-5 w-5 fill-current" />
            ))}
          </div>
        )}
        <blockquote
          className="font-display text-xl sm:text-2xl leading-snug italic font-medium"
          style={{ color: palette.ink }}
        >
          “{section.quote}”
        </blockquote>
        <div
          className="mt-4 text-[11px] uppercase tracking-[0.22em] font-bold"
          style={{ color: palette.accentDeep }}
        >
          {section.attribution}
        </div>
      </div>
    </div>
  );
}

function StepsRender({
  section,
  palette,
  HeaderIcon,
  altRow,
}: {
  section: StepsSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  altRow: boolean;
}) {
  return (
    <div
      className="px-6 py-10"
      style={{ background: altRow ? palette.panelAlt : palette.panel, color: palette.ink }}
    >
      <PanelHeader title={section.title} palette={palette} HeaderIcon={HeaderIcon} />
      <ol className="space-y-4 max-w-xl mx-auto">
        {section.items.map((s, i) => (
          <li key={i} className="flex items-start gap-4">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-base shrink-0 shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${palette.heroFrom} 0%, ${palette.heroTo} 100%)`,
                color: "#fff",
              }}
            >
              {i + 1}
            </div>
            <div className="min-w-0 pt-1">
              <div className="text-sm font-semibold" style={{ color: palette.ink }}>
                {s.label}
              </div>
              {s.detail && (
                <div className="text-[12.5px] mt-1 leading-relaxed" style={{ color: palette.inkSoft }}>
                  {s.detail}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FaqRender({
  section,
  palette,
  HeaderIcon,
  altRow,
}: {
  section: FaqSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
  altRow: boolean;
}) {
  return (
    <div
      className="px-6 py-10"
      style={{ background: altRow ? palette.panelAlt : palette.panel, color: palette.ink }}
    >
      <PanelHeader title={section.title} palette={palette} HeaderIcon={HeaderIcon} />
      <dl className="space-y-5 max-w-xl mx-auto">
        {section.items.map((f, i) => (
          <div key={i} className="border-l-[3px] pl-4" style={{ borderColor: palette.accent }}>
            <dt className="text-[13.5px] font-bold" style={{ color: palette.accentDeep }}>
              {f.q}
            </dt>
            <dd className="text-[13px] mt-1.5 leading-relaxed" style={{ color: palette.inkSoft }}>
              {f.a}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CtaRender({
  section,
  palette,
  HeaderIcon,
}: {
  section: CtaSection;
  palette: Palette;
  HeaderIcon: LucideIcon;
}) {
  // Mountain-silhouette decorative band — etched into the bottom edge
  // of the CTA panel like the example pamphlet. Pure SVG so it prints
  // and exports cleanly.
  const mountains = `<svg viewBox="0 0 800 160" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice" style="display:block;width:100%;height:100%"><defs><linearGradient id="ctaMistA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".08"/></linearGradient></defs><rect width="800" height="160" fill="url(#ctaMistA)"/><polygon points="0,95 90,40 180,80 270,30 360,75 450,30 540,75 630,35 720,75 800,55 800,160 0,160" fill="#000" fill-opacity=".28"/><polygon points="0,115 100,75 200,108 300,80 400,110 500,80 600,110 700,80 800,105 800,160 0,160" fill="#000" fill-opacity=".4"/><polygon points="0,135 110,118 220,132 320,120 430,134 540,120 640,134 760,122 800,128 800,160 0,160" fill="#000" fill-opacity=".55"/></svg>`;
  return (
    <div
      className="px-7 py-12 relative overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${palette.ctaFrom} 0%, ${palette.ctaTo} 100%)`,
        color: "#fff",
      }}
    >
      <div
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none opacity-90"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: mountains }}
      />
      <div
        className="absolute -right-12 -top-12 h-48 w-48 rounded-full pointer-events-none"
        style={{ background: palette.accent, opacity: 0.12 }}
        aria-hidden
      />
      <div className="relative flex items-start gap-5">
        <div
          className="h-14 w-14 rounded-xl flex items-center justify-center shrink-0 shadow-md"
          style={{
            background: `linear-gradient(135deg, ${palette.accentSoft} 0%, ${palette.accent} 100%)`,
            color: palette.heroFrom,
            border: `1px solid ${palette.accent}`,
          }}
        >
          <HeaderIcon className="h-7 w-7" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="font-display text-[24px] sm:text-[28px] leading-[1.22] font-semibold"
            style={{ color: "#fff" }}
          >
            {renderHighlightedTitle(section.title, section.highlight, palette.accent)}
          </p>
          <button
            type="button"
            className="mt-7 w-full sm:w-auto inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl font-bold tracking-[0.1em] uppercase text-[14px] shadow-xl"
            style={{
              background: `linear-gradient(180deg, ${palette.accentSoft} 0%, ${palette.accent} 100%)`,
              color: palette.heroFrom,
              border: `1.5px solid ${palette.accent}`,
            }}
          >
            <span
              className="h-7 w-7 rounded-full inline-flex items-center justify-center shrink-0"
              style={{ background: palette.heroFrom, color: palette.accent }}
            >
              <ShieldCheck className="h-4 w-4" />
            </span>
            {section.button}
          </button>
          {section.subtext && (
            <div className="mt-4 text-[11.5px]" style={{ color: "rgba(255,255,255,.82)" }}>
              {section.subtext}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRender({
  section,
  palette,
}: {
  section: ContactSection;
  palette: Palette;
}) {
  if (!section.phone && !section.email && !section.website && !section.address) return null;
  return (
    <div
      className="px-6 py-5 border-t"
      style={{ background: "#fff", color: palette.ink, borderColor: palette.accentSoft }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px]">
        {section.phone && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" style={{ color: palette.accent }} />
            {section.phone}
          </span>
        )}
        {section.email && (
          <span className="inline-flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" style={{ color: palette.accent }} />
            {section.email}
          </span>
        )}
        {section.website && (
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" style={{ color: palette.accent }} />
            {section.website}
          </span>
        )}
        {section.address && (
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" style={{ color: palette.accent }} />
            {section.address}
          </span>
        )}
      </div>
    </div>
  );
}

function DisclaimerRender({
  section,
  palette,
}: {
  section: DisclaimerSection;
  palette: Palette;
}) {
  return (
    <div
      className="px-6 py-4 text-center text-[10.5px] italic"
      style={{ background: palette.footerBg, color: palette.footerText, opacity: 0.95 }}
    >
      {section.text}
    </div>
  );
}

// =====================================================================
// Print HTML — self-contained styled flyer for the new-window print
// dialog. No Tailwind in the popup; all inline.
// =====================================================================

export function openPamphletPrint(pamphlet: DraftedPamphlet): void {
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
  if (!w) {
    alert("Pop-up blocked — allow pop-ups to print / save the pamphlet.");
    return;
  }
  w.document.open();
  w.document.write(pamphletPrintHtml(pamphlet));
  w.document.close();
  // Wait for the hero image to come back from the provider before
  // firing the print dialog — otherwise the PDF saves the SVG
  // placeholder instead of the AI photograph. We give it up to 12s
  // (image generation can take a few seconds), then print no
  // matter what so a stalled image doesn't block the export.
  const triggerPrint = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* user closed */
    }
  };
  w.onload = () => {
    const img = w.document.querySelector(".hero-scene-img") as
      | HTMLImageElement
      | null;
    if (!img || img.complete) {
      triggerPrint();
      return;
    }
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      triggerPrint();
    };
    img.addEventListener("load", fire);
    img.addEventListener("error", fire);
    setTimeout(fire, 12_000);
  };
  // Belt-and-suspenders fallback if onload never fires (e.g. the
  // popup loaded before we wired the handler).
  setTimeout(() => {
    if (!w.closed) triggerPrint();
  }, 13_000);
}

export function pamphletPrintHtml(pamphlet: DraftedPamphlet): string {
  const palette = PALETTES[pamphlet.accent] ?? PALETTES.generic;
  const sceneSvg = SCENES[ACCENT_SCENE[pamphlet.accent] ?? "shield"] ?? SCENES.shield;
  const aiImageUrl = heroImageUrl(pamphlet);
  const sectionsHtml = pamphlet.sections
    .map((s, i) =>
      sectionPrintHtml(
        s,
        palette,
        i,
        s.kind === "hero" ? { sceneSvg, aiImageUrl } : undefined
      )
    )
    .join("");
  const width =
    pamphlet.layout === "postcard"
      ? "max-width:520px"
      : pamphlet.layout === "magazine"
      ? "max-width:880px"
      : "max-width:720px";

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <title>${esc(getHeroHeadline(pamphlet))} — ${esc(pamphlet.agency.name)}</title>
  <style>
    @page { size: A4; margin: 12mm }
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${palette.ink};line-height:1.55;background:#eef0f3;padding:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{margin:0 auto;${width};border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.18)}
    .banner-wrap{position:relative;background:linear-gradient(135deg,${palette.heroFrom} 0%,${palette.heroTo} 100%)}
    .banner{position:relative;background:#fff;padding:18px 28px;display:flex;align-items:center;gap:14px;clip-path:polygon(0 0, 100% 0, 100% 100%, 70% 100%, 65% calc(100% - 18px), 35% calc(100% - 18px), 30% 100%, 0 100%)}
    .banner .badge{height:46px;width:46px;border-radius:8px;background:linear-gradient(135deg,${palette.heroFrom} 0%,${palette.heroTo} 100%);color:${palette.accent};display:flex;align-items:center;justify-content:center;border:1px solid ${palette.accent};box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .banner .badge svg{width:22px;height:22px}
    .brand{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:23px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:${palette.heroFrom}}
    .brand-sub{font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:${palette.inkSoft};margin-top:3px;display:flex;align-items:center;gap:8px}
    .brand-sub::before,.brand-sub::after{content:"";display:inline-block;width:14px;height:1px;background:${palette.accent}}
    .banner .accent{margin-left:auto;color:${palette.accent}}
    .banner .accent svg{width:22px;height:22px}
    .hero{position:relative;overflow:hidden;color:#fff;background:linear-gradient(135deg,${palette.heroFrom} 0%,${palette.heroTo} 100%);display:grid;grid-template-columns:1.05fr 1fr;min-height:380px}
    .hero::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,0) 60%);pointer-events:none;z-index:1}
    .hero-text{position:relative;padding:44px 30px;display:flex;flex-direction:column;justify-content:center;z-index:2}
    .hero .eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:600;margin-bottom:12px;color:${palette.accent};display:flex;align-items:center;gap:10px}
    .hero .eyebrow::before{content:"";display:inline-block;width:18px;height:1px;background:${palette.accent}}
    .hero h1{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:36px;line-height:1.04;margin:0;font-weight:600}
    .hero .div{display:flex;align-items:center;gap:12px;margin:18px 0 0;max-width:150px}
    .hero .div-icon{width:34px;height:34px;border-radius:50%;background:${palette.accent};color:${palette.heroFrom};display:flex;align-items:center;justify-content:center;border:1px solid ${palette.accent};box-shadow:0 1px 3px rgba(0,0,0,.15)}
    .hero .div-icon svg{width:15px;height:15px}
    .hero .div-line{height:1px;flex:1;background:rgba(255,255,255,.35)}
    .hero .sub{font-size:18px;font-weight:500;margin:18px 0 12px;line-height:1.3;color:${palette.accent}}
    .hero p{font-size:13.5px;color:rgba(255,255,255,.92);margin:0;line-height:1.6}
    .hero-scene{position:relative;overflow:hidden;background:#000}
    .hero-scene-svg{position:absolute;inset:0}
    .hero-scene-svg svg{display:block;width:100%;height:100%}
    .hero-scene-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
    .hero-scene::before{content:"";position:absolute;inset:0 auto 0 0;width:120px;background:linear-gradient(to right,${palette.heroFrom},transparent);z-index:1;pointer-events:none}
    .hero-scene::after{content:"";position:absolute;inset:0 0 auto 0;height:48px;background:linear-gradient(to bottom,rgba(0,0,0,.18),transparent);z-index:1;pointer-events:none}
    .ribbon{padding:10px 26px;text-align:center;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700}
    .ribbon.info{background:#2563eb;color:#fff} .ribbon.warning{background:#d97706;color:#fff} .ribbon.urgent{background:#dc2626;color:#fff} .ribbon.success{background:#059669;color:#fff}
    .panel{padding:34px 28px}
    .panel-leaves{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:6px;color:${palette.accent}}
    .panel-leaves svg{width:22px;height:14px}
    .panel-leaves .right{transform:scaleX(-1)}
    .panel h3{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:22px;text-align:center;margin:0;font-weight:600;color:${palette.ink}}
    .panel-rule{width:56px;height:3px;background:${palette.accent};border-radius:2px;margin:10px auto 22px}
    .stats{display:grid;gap:14px}
    .stats .item{text-align:center;background:#fff;border:1px solid ${palette.accentSoft};border-radius:12px;padding:18px 10px}
    .stats .value{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:32px;font-weight:700;color:${palette.accentDeep};line-height:1}
    .stats .label{font-size:12.5px;font-weight:600;margin-top:8px;color:${palette.ink}}
    .stats .sub{font-size:11px;color:${palette.inkSoft};margin-top:4px}
    .hi-grid{display:grid;gap:22px}
    .hi-item{text-align:center}
    .hi-icon{height:64px;width:64px;border-radius:50%;background:${palette.accentSoft};color:${palette.heroFrom};border:1px solid ${palette.accent};display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
    .hi-icon svg{width:28px;height:28px}
    .hi-label{color:${palette.heroFrom}}
    .hi-label{font-size:13px;font-weight:600;line-height:1.35;color:${palette.ink}}
    .hi-detail{font-size:11.5px;color:${palette.inkSoft};margin-top:4px;line-height:1.4}
    .comparison{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .col{border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#f8fafc}
    .col.positive{border-color:#a7f3d0;background:#ecfdf5}
    .col.negative{border-color:#fecaca;background:#fef2f2}
    .col h4{margin:0 0 10px;font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;font-weight:800}
    .col.positive h4{color:#059669} .col.negative h4{color:#dc2626} .col.neutral h4{color:#475569}
    .col ul{margin:0;padding:0;list-style:none;font-size:13px;line-height:1.55}
    .col li{display:flex;align-items:flex-start;gap:8px;padding:3px 0}
    .col .marker{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;margin-top:2px}
    .col .marker svg{width:11px;height:11px}
    .col.positive .marker{background:#059669} .col.negative .marker{background:#dc2626} .col.neutral .marker{background:#64748b}
    .testimonial-band{background:linear-gradient(135deg,${palette.accentSoft} 0%,#fff 100%);padding:42px 28px;position:relative}
    .testimonial-band .qmark{position:absolute;top:22px;left:28px;font-family:Garamond,serif;font-size:80px;line-height:1;color:${palette.accent};opacity:.3}
    .testimonial{text-align:center;max-width:540px;margin:0 auto;position:relative}
    .testimonial blockquote{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:22px;line-height:1.35;margin:0;quotes:none;font-style:italic;font-weight:500;color:${palette.ink}}
    .testimonial .attr{margin-top:14px;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:${palette.accentDeep};font-weight:700}
    .testimonial .stars{color:${palette.accent};font-size:18px;margin-bottom:12px;letter-spacing:3px}
    .steps{list-style:none;padding:0;margin:0;max-width:540px;margin-inline:auto}
    .steps li{display:flex;gap:14px;padding:8px 0}
    .steps .num{height:38px;width:38px;border-radius:50%;background:linear-gradient(135deg,${palette.heroFrom} 0%,${palette.heroTo} 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0;box-shadow:0 3px 8px rgba(0,0,0,.12)}
    .steps .label{font-size:14px;font-weight:600;margin-top:6px;color:${palette.ink}}
    .steps .detail{font-size:12.5px;color:${palette.inkSoft};margin-top:4px;line-height:1.5}
    .faq{max-width:540px;margin-inline:auto}
    .faq .item{border-left:3px solid ${palette.accent};padding-left:14px;margin-bottom:14px}
    .faq dt{font-size:13.5px;font-weight:700;color:${palette.accentDeep}}
    .faq dd{font-size:13px;margin:5px 0 0;color:${palette.inkSoft};line-height:1.5}
    .cta{position:relative;overflow:hidden;background:linear-gradient(135deg,${palette.ctaFrom} 0%,${palette.ctaTo} 100%);color:#fff;padding:38px 30px 70px}
    .cta::before{content:"";position:absolute;right:-50px;top:-50px;width:200px;height:200px;border-radius:50%;background:${palette.accent};opacity:.12}
    .cta-mountains{position:absolute;inset:auto 0 0 0;height:128px;opacity:.9;pointer-events:none;z-index:1}
    .cta-mountains svg{display:block;width:100%;height:100%}
    .cta-row{position:relative;z-index:2;display:flex;gap:20px;align-items:flex-start}
    .cta-icon{height:56px;width:56px;border-radius:12px;background:linear-gradient(135deg,${palette.accentSoft} 0%,${palette.accent} 100%);color:${palette.heroFrom};border:1px solid ${palette.accent};display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 10px rgba(0,0,0,.15)}
    .cta-icon svg{width:28px;height:28px}
    .cta p{font-family:Garamond,"Times New Roman",Georgia,serif;font-size:24px;font-weight:600;margin:0;line-height:1.22;color:#fff}
    .cta-button{margin-top:22px;display:inline-flex;align-items:center;gap:10px;padding:14px 26px;background:linear-gradient(180deg,#fff 0%,${palette.accentSoft} 100%);color:${palette.heroFrom};border:1px solid ${palette.accent};border-radius:8px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;font-size:13px;box-shadow:0 6px 14px rgba(0,0,0,.15)}
    .cta-button-icon{width:22px;height:22px;border-radius:50%;background:${palette.heroFrom};color:${palette.accent};display:inline-flex;align-items:center;justify-content:center}
    .cta-button-icon svg{width:13px;height:13px}
    .cta-sub{margin-top:12px;font-size:11.5px;color:rgba(255,255,255,.82);position:relative;z-index:2}
    .contact{background:#fff;color:${palette.ink};padding:16px 28px;border-top:1px solid ${palette.accentSoft};text-align:center;font-size:12.5px}
    .contact .item{display:inline-flex;align-items:center;gap:6px;margin:0 10px}
    .contact .item svg{width:14px;height:14px;color:${palette.accent}}
    .footer{background:${palette.footerBg};color:${palette.footerText};text-align:center;padding:14px;font-size:10.5px;font-style:italic;opacity:.95}
    .panel.alt{background:${palette.panelAlt}}
    @media print { body{background:#fff;padding:0} .sheet{box-shadow:none;border-radius:0} }
  </style></head>
  <body>
    <div class="sheet">
      <div class="banner-wrap">
        <div class="banner">
          <div class="badge">${PRINT_ICONS["shield-check"]}</div>
          <div>
            <div class="brand">${esc(pamphlet.agency.name)}</div>
            <div class="brand-sub">Insurance Agency</div>
          </div>
          <div class="accent">${PRINT_ICONS[accentHeaderIconKey(pamphlet.accent)] ?? PRINT_ICONS.sparkles}</div>
        </div>
      </div>
      ${sectionsHtml}
    </div>
  </body></html>`;
}

function accentHeaderIconKey(accent: PamphletAccent): PamphletIconKey {
  const m: Record<PamphletAccent, PamphletIconKey> = {
    winter: "snowflake",
    spring: "sparkles",
    summer: "sun",
    fall: "sparkles",
    storm: "cloud-rain",
    flood: "wave",
    wildfire: "flame",
    earthquake: "bolt",
    renewal: "refresh",
    newpolicy: "shield-check",
    home: "home",
    newhome: "home",
    remodel: "home",
    luxury_home: "home",
    auto: "car",
    luxury_auto: "car",
    motorcycle: "car",
    rv: "car",
    boat: "anchor",
    jewelry: "gem",
    valuables: "sparkles",
    art: "sparkles",
    wine: "sparkles",
    umbrella: "umbrella",
    liability: "shield-check",
    life: "heart",
    health: "heart",
    wedding: "heart",
    newbaby: "heart",
    business: "trending-up",
    cyber: "lock",
    holidays: "sparkles",
    newyear: "sparkles",
    generic: "sparkles",
  };
  return m[accent] ?? "sparkles";
}

function sectionPrintHtml(
  s: PamphletSection,
  palette: Palette,
  index: number,
  heroAssets?: { sceneSvg: string; aiImageUrl: string }
): string {
  const altClass = index % 2 === 1 ? " alt" : "";
  switch (s.kind) {
    case "hero": {
      // SVG scene renders first as a placeholder; the AI image is
      // layered on top via <img> so it fades in on load and falls
      // through to the SVG if the network call fails.
      const sceneForRight = heroAssets?.sceneSvg
        ? heroAssets.sceneSvg.replace(
            'preserveAspectRatio="xMidYMax slice"',
            'preserveAspectRatio="xMidYMid slice"'
          )
        : "";
      const heroScene = heroAssets
        ? `<div class="hero-scene"><div class="hero-scene-svg">${sceneForRight}</div><img class="hero-scene-img" src="${heroAssets.aiImageUrl}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'"/></div>`
        : "";
      return `<div class="hero">
        <div class="hero-text">
          ${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}
          <h1>${esc(s.headline)}</h1>
          <div class="div"><span class="div-icon">${PRINT_ICONS.sparkles}</span><span class="div-line"></span></div>
          <div class="sub">${esc(s.subheadline)}</div>
          <p>${esc(s.intro)}</p>
        </div>
        ${heroScene}
      </div>`;
    }
    case "ribbon":
      return `<div class="ribbon ${s.tone ?? "info"}">${esc(s.text)}</div>`;
    case "stats":
      return `<div class="panel${altClass}">
        ${s.title ? `<div class="panel-leaves">${PRINT_LEAF}<h3 style="margin:0">${esc(s.title)}</h3><span class="right">${PRINT_LEAF}</span></div><div class="panel-rule"></div>` : ""}
        <div class="stats" style="grid-template-columns:repeat(${Math.min(4, Math.max(2, s.items.length))},1fr)">
          ${s.items
            .map(
              (i) =>
                `<div class="item"><div class="value">${esc(i.value)}</div><div class="label">${esc(i.label)}</div>${
                  i.sub ? `<div class="sub">${esc(i.sub)}</div>` : ""
                }</div>`
            )
            .join("")}
        </div>
      </div>`;
    case "highlights":
      return `<div class="panel${altClass}">
        <div class="panel-leaves">${PRINT_LEAF}<h3 style="margin:0">${esc(s.title)}</h3><span class="right">${PRINT_LEAF}</span></div>
        <div class="panel-rule"></div>
        <div class="hi-grid" style="grid-template-columns:repeat(${Math.min(4, Math.max(2, s.items.length))},1fr)">
          ${s.items
            .map(
              (b) =>
                `<div class="hi-item">
                  <div class="hi-icon">${PRINT_ICONS[b.icon] ?? PRINT_ICONS.sparkles}</div>
                  <div class="hi-label">${esc(b.label)}</div>
                  ${b.detail ? `<div class="hi-detail">${esc(b.detail)}</div>` : ""}
                </div>`
            )
            .join("")}
        </div>
      </div>`;
    case "comparison":
      return `<div class="panel${altClass}">
        <h3>${esc(s.title)}</h3>
        <div class="panel-rule"></div>
        <div class="comparison">
          ${s.columns
            .map((c) => {
              const markerIcon =
                c.tone === "positive" ? PRINT_ICONS.check : c.tone === "negative" ? PRINT_ICONS.x : PRINT_ICONS.sparkles;
              return `<div class="col ${c.tone}"><h4>${esc(c.heading)}</h4><ul>${c.items
                .map(
                  (it) => `<li><span class="marker">${markerIcon}</span><span>${esc(it)}</span></li>`
                )
                .join("")}</ul></div>`;
            })
            .join("")}
        </div>
      </div>`;
    case "testimonial":
      return `<div class="testimonial-band">
        <div class="qmark">“</div>
        <div class="testimonial">
          ${s.rating ? `<div class="stars">${"★".repeat(s.rating)}</div>` : ""}
          <blockquote>${esc(s.quote)}</blockquote>
          <div class="attr">— ${esc(s.attribution)}</div>
        </div>
      </div>`;
    case "steps":
      return `<div class="panel${altClass}">
        <div class="panel-leaves">${PRINT_LEAF}<h3 style="margin:0">${esc(s.title)}</h3><span class="right">${PRINT_LEAF}</span></div>
        <div class="panel-rule"></div>
        <ol class="steps">${s.items
          .map(
            (st, i) =>
              `<li><div class="num">${i + 1}</div><div><div class="label">${esc(st.label)}</div>${
                st.detail ? `<div class="detail">${esc(st.detail)}</div>` : ""
              }</div></li>`
          )
          .join("")}</ol>
      </div>`;
    case "faq":
      return `<div class="panel${altClass}">
        <div class="panel-leaves">${PRINT_LEAF}<h3 style="margin:0">${esc(s.title)}</h3><span class="right">${PRINT_LEAF}</span></div>
        <div class="panel-rule"></div>
        <dl class="faq">${s.items
          .map((f) => `<div class="item"><dt>${esc(f.q)}</dt><dd>${esc(f.a)}</dd></div>`)
          .join("")}</dl>
      </div>`;
    case "cta":
      return `<div class="cta">
        <div class="cta-mountains"><svg viewBox="0 0 800 160" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax slice"><polygon points="0,95 90,40 180,80 270,30 360,75 450,30 540,75 630,35 720,75 800,55 800,160 0,160" fill="#000" fill-opacity=".28"/><polygon points="0,115 100,75 200,108 300,80 400,110 500,80 600,110 700,80 800,105 800,160 0,160" fill="#000" fill-opacity=".4"/><polygon points="0,135 110,118 220,132 320,120 430,134 540,120 640,134 760,122 800,128 800,160 0,160" fill="#000" fill-opacity=".55"/></svg></div>
        <div class="cta-row">
          <div class="cta-icon">${PRINT_ICONS["shield-check"]}</div>
          <div>
            <p>${printHighlightedTitle(s.title, s.highlight, palette.accent)}</p>
            <div><span class="cta-button"><span class="cta-button-icon">${PRINT_ICONS["shield-check"]}</span>${esc(s.button)}</span></div>
            ${s.subtext ? `<div class="cta-sub">${esc(s.subtext)}</div>` : ""}
          </div>
        </div>
      </div>`;
    case "contact":
      return `<div class="contact">
        ${s.phone ? `<span class="item">${PRINT_ICONS.phone}${esc(s.phone)}</span>` : ""}
        ${s.email ? `<span class="item">${PRINT_ICONS.mail}${esc(s.email)}</span>` : ""}
        ${s.website ? `<span class="item">${PRINT_ICONS.globe}${esc(s.website)}</span>` : ""}
        ${s.address ? `<span class="item">${PRINT_ICONS["map-pin"]}${esc(s.address)}</span>` : ""}
      </div>`;
    case "disclaimer":
      return `<div class="footer">${esc(s.text)}</div>`;
  }
}

// Render the CTA title with the optional `highlight` substring
// painted in the accent color. Case-sensitive substring match — if
// it doesn't appear in the title we render the title unchanged.
function renderHighlightedTitle(
  title: string,
  highlight: string | undefined,
  accent: string
): import("react").ReactNode {
  if (!highlight) return title;
  const i = title.indexOf(highlight);
  if (i === -1) return title;
  return (
    <>
      {title.slice(0, i)}
      <span style={{ color: accent }}>{highlight}</span>
      {title.slice(i + highlight.length)}
    </>
  );
}

function getHeroHeadline(p: DraftedPamphlet): string {
  for (const s of p.sections) {
    if (s.kind === "hero") return s.headline;
  }
  return p.agency.name;
}

// Same leaf used in the on-screen panel headers, inlined as an SVG
// string so the print export is self-contained.
const PRINT_LEAF = `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg"><path d="M2 14 C6 10, 10 6, 22 2 C20 8, 14 13, 6 14 Z" fill="currentColor" opacity=".55"/><path d="M2 14 C6 10, 10 6, 22 2" fill="none" stroke="currentColor" stroke-width=".8" stroke-linecap="round"/><path d="M12 10 l4 -4 M8 12 l3 -3 M16 8 l3 -3" stroke="currentColor" stroke-width=".7" stroke-linecap="round"/></svg>`;

// Print-time analogue of `renderHighlightedTitle` — wraps the
// `highlight` substring in a span colored with the pamphlet accent.
function printHighlightedTitle(
  title: string,
  highlight: string | undefined,
  accent: string
): string {
  if (!highlight) return esc(title);
  const i = title.indexOf(highlight);
  if (i === -1) return esc(title);
  return (
    esc(title.slice(0, i)) +
    `<span style="color:${accent}">${esc(highlight)}</span>` +
    esc(title.slice(i + highlight.length))
  );
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hexLighten(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (255 - r) * ratio);
  const ng = Math.round(g + (255 - g) * ratio);
  const nb = Math.round(b + (255 - b) * ratio);
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb
    .toString(16)
    .padStart(2, "0")}`;
}

function hexDarken(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r * (1 - ratio));
  const ng = Math.round(g * (1 - ratio));
  const nb = Math.round(b * (1 - ratio));
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb
    .toString(16)
    .padStart(2, "0")}`;
}

const PRINT_ICONS: Record<PamphletIconKey | "shield-check", string> = {
  "shield-check":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  snowflake:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20M12 2v20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  flame:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-1.5-3.5-1.5-5C5 4 4 6 4 9c0 5 4 9 8 9s8-3.5 8-7c0-3-2-5-5-5-1 0-2 .5-3 1.5"/></svg>',
  "cloud-rain":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a4 4 0 0 1 4-4 5 5 0 0 1 9.5-2 4 4 0 0 1 .5 8"/><path d="M16 14v6M12 14v6M8 14v6"/></svg>',
  wheel:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/></svg>',
  home:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  car:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 16H9m10 0h2v-3.2a2 2 0 0 0-.6-1.4L17 8H7l-3.4 3.4A2 2 0 0 0 3 12.8V16h2"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/></svg>',
  gem:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M2 9h20"/><path d="m10 3 2 6 2-6"/></svg>',
  umbrella:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 10 10H2A10 10 0 0 1 12 2z"/><path d="M12 12v8a2 2 0 0 0 4 0"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>',
  sparkles:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v3M9 18v3M3 9h3M18 9h3M5 5l2 2M17 17l2 2M5 17l2-2M17 5l2 2"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  droplets:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M17 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>',
  bolt:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7Z"/></svg>',
  compass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16 8 14 14 8 16 10 10"/></svg>',
  scale:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16 9 8M8 16l7-8M12 2v20M3 10h6l-3 6h-3l3-6Zm15 0h6l-3 6h-3l3-6Z"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.32 1.85.55 2.81.68A2 2 0 0 1 22 16.92z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  "map-pin":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 7-8 12-8 12s-8-5-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  "trending-up":
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  star:
    '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  wallet:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 12h2"/></svg>',
  key:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="17" r="4"/><path d="m21 3-9.5 9.5M16 8l3-3M14 10l3 3"/></svg>',
  warehouse:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v13h18V7L12 3 3 7z"/><path d="M7 20v-7h10v7"/></svg>',
  wave:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s2-3 5-3 5 3 5 3 2-3 5-3 5 3 5 3"/><path d="M2 18s2-3 5-3 5 3 5 3 2-3 5-3 5 3 5 3"/></svg>',
  anchor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 8v13M5 12H2a10 10 0 0 0 20 0h-3"/></svg>',
};
