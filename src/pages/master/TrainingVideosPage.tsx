import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  MonitorPlay,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { MasterBackButton } from "@/components/layout/MasterBackButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import {
  AGENT_HOW_TO_VIDEOS,
  MANAGER_HOW_TO_VIDEOS,
  PUBLIC_WHAT_IT_DOES_VIDEOS,
  type PortalVideo,
} from "@/lib/trainingVideos";
import {
  getTrainingVideoSource,
  providerLabel,
  removeTrainingVideoSource,
  saveTrainingVideoSource,
  type TrainingVideoSource,
} from "@/lib/trainingVideoSources";
import {
  PHOTO_ALBUM_PRODUCTION_BRIEFS,
  fullVideoProductionBrief,
  productionBriefForVideo,
} from "@/lib/trainingVideoProduction";
import { fmt } from "@/lib/format";

type LibraryFilter = "all" | "public" | "agent" | "manager";

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "public", label: "Public preview" },
  { id: "agent", label: "Agent training" },
  { id: "manager", label: "Manager training" },
];

export function TrainingVideosPage() {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [rev, setRev] = useState(0);
  const [editingVideo, setEditingVideo] = useState<PortalVideo | null>(null);
  const [form, setForm] = useState({ url: "", sourceName: "External AI video source", notes: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const videos = useMemo(
    () => [...PUBLIC_WHAT_IT_DOES_VIDEOS, ...AGENT_HOW_TO_VIDEOS, ...MANAGER_HOW_TO_VIDEOS],
    []
  );
  const visibleVideos = videos.filter((video) => filter === "all" || video.audience === filter);
  const sources = useMemo(
    () => new Map(videos.map((video) => [video.id, getTrainingVideoSource(video.id)])),
    [videos, rev]
  );
  const publishedCount = videos.filter((video) => sources.get(video.id)).length;
  const editingSource = editingVideo ? sources.get(editingVideo.id) ?? null : null;
  const productionPackage = useMemo(() => fullVideoProductionBrief(videos), [videos]);
  const chapterCount = videos.reduce((sum, video) => sum + video.chapters.length, 0);
  const photoCount = PHOTO_ALBUM_PRODUCTION_BRIEFS.reduce((sum, album) => sum + album.frames.length, 0);

  function openEditor(video: PortalVideo) {
    const source = getTrainingVideoSource(video.id);
    setEditingVideo(video);
    setForm({
      url: source?.url ?? "",
      sourceName: source?.sourceName ?? "External AI video source",
      notes: source?.notes ?? "",
    });
    setError("");
  }

  function closeEditor() {
    setEditingVideo(null);
    setError("");
  }

  function saveSource() {
    if (!editingVideo) return;
    try {
      saveTrainingVideoSource(editingVideo.id, form);
      setRev((value) => value + 1);
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this source.");
    }
  }

  function removeSource(videoId: string) {
    removeTrainingVideoSource(videoId);
    setRev((value) => value + 1);
  }

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setNotice("Copy failed. Download the brief and paste it into your production tool.");
    }
  }

  function downloadProductionPackage() {
    const blob = new Blob([productionPackage], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quotex-ai-video-production-brief.md";
    link.click();
    window.URL.revokeObjectURL(url);
    setNotice("Production package downloaded.");
  }

  return (
    <div className="space-y-6">
      <MasterBackButton />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Training videos</h1>
          <p className="mt-1 text-sm text-ink-500">
            Master-only publishing for public previews, agent training, and manager training video sources.
          </p>
        </div>
        <Badge tone={publishedCount === videos.length ? "success" : "warn"}>
          {publishedCount}/{videos.length} external sources
        </Badge>
      </div>

      <Card>
        <CardHeader
          title="AI production package"
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline text-xs"
                onClick={() => copyText(productionPackage, "Full AI production package copied.")}
              >
                <Clipboard className="h-3.5 w-3.5" />
                Copy package
              </button>
              <button type="button" className="btn-primary text-xs" onClick={downloadProductionPackage}>
                <Download className="h-3.5 w-3.5" />
                Download brief
              </button>
            </div>
          }
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-lg border border-gold-100 bg-gold-50/70 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-gold-200 bg-white text-gold-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink-950">Copy this into the outside video system</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">
                  This package gives a professional AI video vendor the exact public review, agent training, manager
                  training, subtitles, chapter structure, and photo-album shot list to create real hosted videos for the
                  source slots below.
                </p>
              </div>
            </div>
            {notice && (
              <div className="mt-4 rounded-md border border-ink-100 bg-white px-3 py-2 text-sm font-semibold text-ink-700">
                {notice}
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-2">
            {[
              { label: "Videos", value: videos.length },
              { label: "Chapters", value: chapterCount },
              { label: "Photo frames", value: photoCount },
              { label: "Audience sets", value: 3 },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-ink-100 bg-ink-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">{item.label}</div>
                <div className="mt-1 text-2xl font-semibold text-ink-950">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Source publishing"
          action={
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={filter === item.id ? "btn-primary text-xs" : "btn-outline text-xs"}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        />
        <div className="grid gap-3">
          {visibleVideos.map((video) => (
            <TrainingVideoSourceRow
              key={video.id}
              video={video}
              source={sources.get(video.id) ?? null}
              onEdit={() => openEditor(video)}
              onRemove={() => removeSource(video.id)}
              onCopyBrief={() => copyText(productionBriefForVideo(video), `Production brief copied for ${video.title}.`)}
            />
          ))}
        </div>
      </Card>

      {editingVideo && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-950/60 px-5 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="master-training-source-title"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-ink-200 bg-white shadow-luxe">
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 id="master-training-source-title" className="font-display text-2xl text-ink-950">
                  Publish training video
                </h2>
                <p className="mt-1 text-sm text-ink-500">{editingVideo.title}</p>
              </div>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-md border border-ink-200 bg-white text-ink-600 transition hover:border-gold-300 hover:text-ink-950"
                onClick={closeEditor}
                aria-label="Close training video source editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-gold-100 bg-gold-50/70 p-4 text-sm leading-relaxed text-gold-900">
                Paste the hosted export URL from the external video system. Supported sources include direct MP4/WebM,
                YouTube, Vimeo, Loom, Wistia, S3, Vercel Blob, or another embeddable video host.
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
                Source name
                <input
                  className="input mt-1"
                  value={form.sourceName}
                  onChange={(event) => setForm((current) => ({ ...current, sourceName: event.target.value }))}
                  placeholder="HeyGen agent onboarding, Runway preview, Synthesia manager lesson..."
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
                Hosted video URL
                <input
                  className="input mt-1"
                  value={form.url}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://.../training-video.mp4 or https://vimeo.com/..."
                />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
                Production notes
                <textarea
                  className="input mt-1 min-h-24 resize-y"
                  value={form.notes}
                  onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Optional voice model, edit version, export date, or QA notes."
                />
              </label>
              {editingSource && (
                <div className="rounded-md border border-ink-100 bg-ink-50 p-3 text-sm text-ink-600">
                  Current source:{" "}
                  <span className="font-semibold text-ink-900">
                    {providerLabel(editingSource.provider)} - {editingSource.sourceName}
                  </span>
                </div>
              )}
              {error && (
                <div className="rounded-md border border-alert-ring bg-alert-soft px-3 py-2 text-sm text-alert">
                  {error}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50 px-5 py-4">
              <div>
                {editingSource && (
                  <button type="button" className="btn-outline text-sm text-rose-700" onClick={() => removeSource(editingVideo.id)}>
                    <Trash2 className="h-4 w-4" />
                    Remove source
                  </button>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-outline" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={saveSource}>
                  <UploadCloud className="h-4 w-4" />
                  Publish source
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingVideoSourceRow({
  video,
  source,
  onEdit,
  onRemove,
  onCopyBrief,
}: {
  video: PortalVideo;
  source: TrainingVideoSource | null;
  onEdit: () => void;
  onRemove: () => void;
  onCopyBrief: () => void;
}) {
  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={video.audience === "public" ? "neutral" : video.audience === "manager" ? "info" : "success"}>
              {video.audience === "public" ? "Public preview" : video.audience === "manager" ? "Manager" : "Agent"}
            </Badge>
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">{video.duration}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-ink-950">{video.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">{video.body}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {video.chapters.map((chapter) => (
              <span
                key={chapter.id}
                className="inline-flex items-center gap-1 rounded-full bg-ink-50 px-2 py-1 text-[11px] font-semibold text-ink-500"
              >
                <FileText className="h-3 w-3" />
                {chapter.timestamp} {chapter.title}
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 rounded-md border border-ink-100 bg-ink-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
            {source ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <MonitorPlay className="h-3.5 w-3.5 text-gold-700" />}
            {source?.bundled ? "Bundled video active" : source ? "Published external source" : "Built-in guided video active"}
          </div>
          {source ? (
            <>
              <div className="mt-1 truncate text-sm font-semibold text-ink-900">
                {source.bundled ? "Bundled video" : providerLabel(source.provider)} - {source.sourceName}
              </div>
              <div className="mt-1 truncate text-xs text-ink-500">{source.url}</div>
              <div className="mt-1 text-[11px] text-ink-400">
                {source.bundled ? "Available by default" : `Updated ${fmt.relative(source.updatedAt)}`}
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-ink-500">
              Playable now. Uploading an external source later replaces the built-in guided walkthrough.
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <a href={trainingPreviewHref(video)} className="btn-outline text-xs">
            <MonitorPlay className="h-3.5 w-3.5" />
            Preview
          </a>
          <button type="button" className="btn-outline text-xs" onClick={onCopyBrief}>
            <Clipboard className="h-3.5 w-3.5" />
            Copy brief
          </button>
          {source && (
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs">
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
          )}
          <button type="button" className="btn-primary text-xs" onClick={onEdit}>
            <UploadCloud className="h-3.5 w-3.5" />
            {source ? "Replace" : "Publish"}
          </button>
          {source && !source.bundled && (
            <button type="button" className="btn-outline text-xs text-rose-700" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function trainingPreviewHref(video: PortalVideo): string {
  if (video.audience === "public") return `/?preview=${encodeURIComponent(video.id)}`;
  const chapterId = video.chapters[0]?.id;
  const params = new URLSearchParams({ video: video.id, autoplay: "1" });
  if (chapterId) {
    params.set("chapter", chapterId);
    params.set("section", chapterId);
  }
  return `/employee/training?${params.toString()}`;
}
