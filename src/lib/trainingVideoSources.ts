export type TrainingVideoSourceProvider =
  | "youtube"
  | "vimeo"
  | "loom"
  | "wistia"
  | "direct"
  | "generic";

export interface TrainingVideoSource {
  videoId: string;
  url: string;
  provider: TrainingVideoSourceProvider;
  sourceName: string;
  notes?: string;
  updatedAt: string;
  bundled?: boolean;
}

const STORAGE_KEY = "quotex.training.video.sources.v1";
const COMPLETE_DEMO_WALKTHROUGH_URL = "/training/quotex-complete-demo-walkthrough.webm";
const CATEGORY_TRAINING_VIDEO_SLUGS = [
  "dashboard",
  "activity-center",
  "messages",
  "prospects",
  "clients",
  "policies",
  "claims",
  "billing",
  "renewals",
  "document-review",
  "ai-marketing",
  "carrier-recommendations",
  "analytics",
  "accounting",
  "hr",
  "calendar",
  "archive",
  "training",
  "agency-settings",
];

const BUNDLED_TRAINING_VIDEO_SOURCES: SourceStore = {
  "agent-complete-demo-walkthrough": bundledSource("agent-complete-demo-walkthrough"),
  "manager-complete-demo-walkthrough": bundledSource("manager-complete-demo-walkthrough"),
  ...Object.fromEntries(
    CATEGORY_TRAINING_VIDEO_SLUGS.flatMap((slug) => [
      [`agent-category-${slug}`, bundledCategorySource(`agent-category-${slug}`, slug)],
      [`manager-category-${slug}`, bundledCategorySource(`manager-category-${slug}`, slug)],
    ])
  ),
};

type SourceStore = Record<string, TrainingVideoSource>;

export function getTrainingVideoSource(videoId: string): TrainingVideoSource | null {
  return readTrainingVideoSourceStore()[videoId] ?? BUNDLED_TRAINING_VIDEO_SOURCES[videoId] ?? null;
}

export function listTrainingVideoSources(): TrainingVideoSource[] {
  const store = readTrainingVideoSourceStore();
  return Object.values({ ...BUNDLED_TRAINING_VIDEO_SOURCES, ...store });
}

export function saveTrainingVideoSource(
  videoId: string,
  input: { url: string; sourceName?: string; notes?: string }
): TrainingVideoSource {
  const url = normalizeSourceUrl(input.url);
  const row: TrainingVideoSource = {
    videoId,
    url,
    provider: providerForTrainingVideoUrl(url),
    sourceName: input.sourceName?.trim() || "External AI video source",
    notes: input.notes?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  const store = readTrainingVideoSourceStore();
  store[videoId] = row;
  writeTrainingVideoSourceStore(store);
  return row;
}

export function removeTrainingVideoSource(videoId: string): void {
  const store = readTrainingVideoSourceStore();
  delete store[videoId];
  writeTrainingVideoSourceStore(store);
}

export function providerForTrainingVideoUrl(url: string): TrainingVideoSourceProvider {
  const value = normalizeSourceUrl(url).toLowerCase();
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/.test(value)) return "direct";
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "youtube";
  if (value.includes("vimeo.com")) return "vimeo";
  if (value.includes("loom.com")) return "loom";
  if (value.includes("wistia.com") || value.includes("wi.st")) return "wistia";
  return "generic";
}

export function providerLabel(provider: TrainingVideoSourceProvider): string {
  if (provider === "youtube") return "YouTube";
  if (provider === "vimeo") return "Vimeo";
  if (provider === "loom") return "Loom";
  if (provider === "wistia") return "Wistia";
  if (provider === "direct") return "Direct video file";
  return "External embed";
}

export function isDirectTrainingVideoUrl(url: string): boolean {
  return providerForTrainingVideoUrl(url) === "direct";
}

export function trainingVideoEmbedUrl(source: TrainingVideoSource, timestamp = "0:00"): string {
  const startSeconds = timestampToSeconds(timestamp);
  const url = parseTrainingVideoUrl(source.url);

  if (source.provider === "youtube") {
    const id = youtubeId(url);
    if (!id) return source.url;
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&start=${startSeconds}`;
  }

  if (source.provider === "vimeo") {
    const id = vimeoId(url);
    if (!id) return source.url;
    return `https://player.vimeo.com/video/${id}#t=${startSeconds}s`;
  }

  if (source.provider === "loom") {
    const id = loomId(url);
    if (!id) return source.url;
    return `https://www.loom.com/embed/${id}`;
  }

  if (source.provider === "wistia") {
    const id = wistiaId(url);
    if (!id) return source.url;
    return `https://fast.wistia.net/embed/iframe/${id}`;
  }

  if (source.provider === "direct") {
    if (source.url.startsWith("/")) return `${source.url}#t=${startSeconds}`;
    const next = new URL(source.url);
    next.hash = `t=${startSeconds}`;
    return next.toString();
  }

  return source.url;
}

export function timestampToSeconds(timestamp: string): number {
  const parts = timestamp
    .split(":")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
  if (parts.length === 0) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function normalizeSourceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Add a hosted video URL first.");
  if (trimmed.startsWith("/")) return trimmed;
  try {
    return new URL(trimmed).toString();
  } catch {
    throw new Error("Enter a valid hosted video URL.");
  }
}

function parseTrainingVideoUrl(value: string): URL {
  const base =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://quotex.local";
  return new URL(value, base);
}

function bundledSource(videoId: string): TrainingVideoSource {
  return {
    videoId,
    url: COMPLETE_DEMO_WALKTHROUGH_URL,
    provider: "direct",
    sourceName: "Bundled complete demo walkthrough",
    notes: "Generated from the live Quotex demo and bundled with the app.",
    updatedAt: "2026-06-06T00:00:00.000Z",
    bundled: true,
  };
}

function bundledCategorySource(videoId: string, slug: string): TrainingVideoSource {
  return {
    videoId,
    url: `/training/categories/${slug}.webm`,
    provider: "direct",
    sourceName: "Bundled live category walkthrough",
    notes: "Recorded from the live Quotex demo with narration.",
    updatedAt: "2026-06-06T00:00:00.000Z",
    bundled: true,
  };
}

function youtubeId(url: URL): string | null {
  if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (url.pathname.includes("/embed/")) return url.pathname.split("/embed/")[1]?.split("/")[0] ?? null;
  if (url.pathname.includes("/shorts/")) return url.pathname.split("/shorts/")[1]?.split("/")[0] ?? null;
  return url.searchParams.get("v");
}

function vimeoId(url: URL): string | null {
  return url.pathname
    .split("/")
    .filter(Boolean)
    .find((part) => /^\d+$/.test(part)) ?? null;
}

function loomId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const shareIndex = parts.indexOf("share");
  const embedIndex = parts.indexOf("embed");
  if (shareIndex >= 0) return parts[shareIndex + 1] ?? null;
  if (embedIndex >= 0) return parts[embedIndex + 1] ?? null;
  return parts[0] ?? null;
}

function wistiaId(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const mediaIndex = parts.indexOf("medias");
  if (mediaIndex >= 0) return parts[mediaIndex + 1] ?? null;
  return parts[parts.length - 1] ?? null;
}

function readTrainingVideoSourceStore(): SourceStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SourceStore) : {};
  } catch {
    return {};
  }
}

function writeTrainingVideoSourceStore(store: SourceStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
