import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Captions,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  GraduationCap,
  Layers,
  MonitorPlay,
  PlayCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { videoChapterPath, videosForRole, type VideoChapter } from "@/lib/trainingVideos";
import {
  getTrainingVideoSource,
  isDirectTrainingVideoUrl,
  providerLabel,
  trainingVideoEmbedUrl,
  type TrainingVideoSource,
} from "@/lib/trainingVideoSources";

interface TrainingScene {
  route: string;
  stepLabel: string;
  title: string;
  subtitle: string;
  primaryPanel: string;
  secondaryPanels: string[];
  callouts: string[];
  cursor: { left: string; top: string };
}

export function EmployeeTrainingPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = user?.role === "manager";
  const modules = useMemo(() => videosForRole(user?.role), [user?.role]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const activeVideo = modules.find((module) => module.id === activeVideoId) ?? null;
  const activeChapter =
    activeVideo?.chapters.find((chapter) => chapter.id === activeChapterId) ??
    activeVideo?.chapters[0] ??
    null;
  const activeChapterIndex = activeVideo && activeChapter
    ? activeVideo.chapters.findIndex((chapter) => chapter.id === activeChapter.id)
    : -1;
  const videoSources = useMemo(
    () => new Map(modules.map((module) => [module.id, getTrainingVideoSource(module.id)])),
    [modules]
  );
  const activeVideoSource = activeVideo ? videoSources.get(activeVideo.id) ?? null : null;
  const chapterScenes = useMemo(
    () => activeVideo && activeChapter ? buildTrainingScenes(activeVideo.id, activeChapter) : [],
    [activeVideo?.id, activeChapter?.id, activeChapter?.transcript]
  );
  const autoStartRef = useRef(false);
  const lastAutoplayLinkRef = useRef("");
  const completionKey = useMemo(
    () => `quotex-training-completed:${user?.id ?? user?.role ?? "staff"}`,
    [user?.id, user?.role]
  );
  const [completedVideoIds, setCompletedVideoIds] = useState<Set<string>>(() =>
    readCompletedVideos(completionKey)
  );
  const [chapterProgress, setChapterProgress] = useState(0);
  const boundedChapterProgress = Math.min(1, Math.max(0, chapterProgress));
  const activeScene = sceneForProgress(chapterScenes, boundedChapterProgress);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const libraryLabel = "How to do it";
  const libraryTitle = isManager ? "Manager training videos" : "Agent training videos";
  const libraryDescription = isManager
    ? "Step-by-step manager training for team oversight, routing, reporting, settings, accounting, HR, and agency-wide operating standards."
    : "Step-by-step agent training for assigned work, client and prospect handling, quoting, documents, messages, reminders, and daily execution.";
  const totalMinutes = modules.reduce((sum, module) => sum + trainingMinutes(module.duration), 0);
  const completedCount = modules.filter((module) => completedVideoIds.has(module.id)).length;

  useEffect(() => {
    const videoId = searchParams.get("video");
    const sectionId = searchParams.get("section");
    const chapterId = sectionId ?? searchParams.get("chapter");
    if (!videoId) {
      setActiveVideoId(null);
      setActiveChapterId(null);
      lastAutoplayLinkRef.current = "";
      return;
    }
    const video = modules.find((module) => module.id === videoId);
    if (!video) return;
    const nextChapterId = chapterId && video.chapters.some((chapter) => chapter.id === chapterId)
      ? chapterId
      : video.chapters[0].id;
    const autoplayKey = `${video.id}:${nextChapterId}:${searchParams.get("autoplay") ?? ""}`;
    if (searchParams.get("autoplay") === "1" && lastAutoplayLinkRef.current !== autoplayKey) {
      autoStartRef.current = true;
      lastAutoplayLinkRef.current = autoplayKey;
    }
    setActiveVideoId(video.id);
    setActiveChapterId(nextChapterId);
  }, [modules, searchParams]);

  useEffect(() => {
    setCompletedVideoIds(readCompletedVideos(completionKey));
  }, [completionKey]);

  useEffect(() => {
    setChapterProgress(0);
    autoStartRef.current = false;
  }, [activeVideoId, activeChapterId]);

  function openVideo(videoId: string, chapterId?: string, autoStart = false) {
    autoStartRef.current = autoStart;
    const params = new URLSearchParams({ video: videoId });
    if (chapterId) {
      params.set("chapter", chapterId);
      params.set("section", chapterId);
    }
    if (autoStart) params.set("autoplay", "1");
    setSearchParams(params);
  }

  function closeVideo() {
    setSearchParams({});
  }

  function markVideoComplete(videoId: string) {
    setCompletedVideoIds((current) => {
      const next = new Set(current);
      next.add(videoId);
      saveCompletedVideos(completionKey, next);
      return next;
    });
  }

  function changeSpeed(nextSpeed: number) {
    setPlaybackSpeed(nextSpeed);
  }

  function openTrainingInNewTab(videoId: string, chapterId?: string) {
    const path = videoChapterPath(videoId, chapterId, { autoplay: true });
    const href = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function finishChapter() {
    if (!activeVideo || !activeChapter) return;
    const currentIndex = activeVideo.chapters.findIndex((chapter) => chapter.id === activeChapter.id);
    const nextChapter = activeVideo.chapters[currentIndex + 1];
    if (nextChapter) {
      autoStartRef.current = true;
      openVideo(activeVideo.id, nextChapter.id, true);
      return;
    }
    setChapterProgress(1);
    markVideoComplete(activeVideo.id);
  }

  return (
    <div className="space-y-6">
      <section className="card !p-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-md border border-gold-200 bg-gold-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-gold-700">
              <GraduationCap className="h-3.5 w-3.5" />
              {libraryLabel}
            </div>
            <h1 className="mt-4 font-display text-4xl">{libraryTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-500">
              {libraryDescription}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Modules", value: modules.length, icon: <MonitorPlay className="h-4 w-4" /> },
              { label: "Time", value: `${totalMinutes} min`, icon: <Clock className="h-4 w-4" /> },
              {
                label: "Done",
                value: `${completedCount}/${modules.length}`,
                icon: isManager ? <Layers className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />,
              },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-ink-100 bg-ink-50 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
                  <span>{item.label}</span>
                  <span className="text-gold-700">{item.icon}</span>
                </div>
                <div className="mt-2 text-xl font-semibold text-ink-950">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card overflow-hidden !p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-ink-950">Training library</h2>
            <p className="mt-1 text-sm text-ink-500">Select a video or jump directly to the exact section you need.</p>
          </div>
          <span className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2 text-sm font-semibold text-ink-600">
            {modules.length} role-specific videos
          </span>
        </div>
        <div className="divide-y divide-ink-100">
          {modules.map((module) => {
            const done = completedVideoIds.has(module.id);
            const source = videoSources.get(module.id) ?? null;
            return (
              <article
                key={module.title}
                className="grid gap-5 px-5 py-5 lg:grid-cols-[180px_minmax(0,1fr)_210px] lg:items-start"
              >
                <button
                  type="button"
                  className="group relative aspect-video overflow-hidden rounded-lg bg-ink-950 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white lg:aspect-[4/3]"
                  onClick={() => openVideo(module.id, module.chapters[0]?.id, true)}
                  aria-label={`Play ${module.title}`}
                >
                  <TrainingThumbnail
                    videoId={module.id}
                    chapter={module.chapters[0]}
                    duration={module.duration}
                    done={done}
                  />
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur transition group-hover:bg-gold-300 group-hover:text-ink-950">
                      <PlayCircle className="h-6 w-6" />
                    </span>
                  </div>
                </button>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-700">
                      {module.eyebrow}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      done ? "bg-emerald-50 text-emerald-700" : "bg-ink-50 text-ink-500"
                    }`}>
                      <CheckCircle2 className="h-3 w-3" />
                      {done ? "Done" : "Not completed"}
                    </span>
                    <span className="rounded-full bg-ink-50 px-2.5 py-1 text-xs font-semibold text-ink-500">
                      {module.duration}
                    </span>
                  </div>
                  <h3 className="mt-3 text-xl font-semibold leading-tight text-ink-950">{module.title}</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-500">{module.body}</p>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                      Sections
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      {module.chapters.map((chapter) => (
                        <button
                          key={chapter.id}
                          type="button"
                          className="min-h-[56px] rounded-lg border border-ink-100 bg-white px-3 py-2 text-left text-sm transition hover:border-gold-200 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300"
                          onClick={() => openVideo(module.id, chapter.id, false)}
                        >
                          <span className="block text-xs font-semibold text-gold-700">{chapter.timestamp}</span>
                          <span className="mt-1 block font-semibold leading-snug text-ink-800">{chapter.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex h-full flex-col gap-3 lg:items-stretch">
                  <TrainingSourceSlot source={source} />
                  <div className="mt-auto grid gap-2">
                    <button
                      type="button"
                      className="btn-primary w-full"
                      onClick={() => openVideo(module.id, module.chapters[0]?.id, true)}
                    >
                      <PlayCircle className="h-4 w-4" />
                      Watch
                    </button>
                    <button
                      type="button"
                      className="btn-outline w-full"
                      onClick={() => openTrainingInNewTab(module.id, module.chapters[0]?.id)}
                    >
                      <ExternalLink className="h-4 w-4" />
                      New tab
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {activeVideo && activeChapter && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 px-5 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="training-video-title"
        >
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-5xl overflow-hidden rounded-xl border border-ink-200 bg-white shadow-luxe">
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3">
              <button type="button" className="btn-outline" onClick={closeVideo}>
                <ArrowLeft className="h-4 w-4" />
                Back to training videos
              </button>
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-md border border-ink-200 bg-white text-ink-600 transition hover:border-gold-300 hover:text-ink-950"
                onClick={closeVideo}
                aria-label="Close training video"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid max-h-[calc(100vh-7rem)] overflow-y-auto lg:grid-cols-[minmax(0,1.2fr)_340px]">
              <div className="min-w-0">
                <div className="relative aspect-video bg-ink-950">
                  {activeVideoSource ? (
                    <ExternalTrainingVideoFrame
                      source={activeVideoSource}
                      chapter={activeChapter}
                      autoplay={searchParams.get("autoplay") === "1"}
                      playbackSpeed={playbackSpeed}
                      onEnded={finishChapter}
                      onProgress={setChapterProgress}
                    />
                  ) : (
                    <GuidedTrainingVideoFrame
                      videoTitle={activeVideo.title}
                      chapter={activeChapter}
                      scenes={chapterScenes}
                      autoplay={searchParams.get("autoplay") === "1"}
                      playbackSpeed={playbackSpeed}
                      subtitlesOn={subtitlesOn}
                      onEnded={finishChapter}
                      onProgress={setChapterProgress}
                    />
                  )}
                </div>
                <div className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                        {activeVideo.title}
                      </div>
                      <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-700">
                        <FileText className="h-3.5 w-3.5" />
                        Exact section: {activeChapter.title}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-ink-600">{activeChapter.summary}</p>
                    </div>
                    {completedVideoIds.has(activeVideo.id) && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Done
                      </span>
                    )}
                  </div>
                  <div className="mt-5 grid gap-3 rounded-lg border border-ink-100 bg-ink-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-ink-400">
                        <span>Section {activeChapterIndex + 1} of {activeVideo.chapters.length}</span>
                        <span>{Math.round(boundedChapterProgress * 100)}% complete</span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-sm text-ink-600">
                        <MonitorPlay className="h-4 w-4 text-gold-600" />
                        Demo route: {activeScene?.route ?? "/employee"}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <>
                        {activeVideoSource && (
                          <a
                            href={activeVideoSource.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-outline"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open source
                          </a>
                        )}
                        {!activeVideoSource && (
                          <span className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                            Built-in guided video
                          </span>
                        )}
                        <button type="button" className="btn-primary" onClick={() => markVideoComplete(activeVideo.id)}>
                          <CheckCircle2 className="h-4 w-4" />
                          Mark done
                        </button>
                      </>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <button
                      type="button"
                      className={subtitlesOn ? "btn-primary" : "btn-outline"}
                      onClick={() => setSubtitlesOn((value) => !value)}
                    >
                      <Captions className="h-4 w-4" />
                      Subtitles {subtitlesOn ? "on" : "off"}
                    </button>
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink-700">
                      Speed
                      <select
                        className="input !h-10 !w-28 !py-1"
                        value={playbackSpeed}
                        onChange={(event) => changeSpeed(Number(event.target.value))}
                        disabled={!!activeVideoSource && !isDirectTrainingVideoUrl(activeVideoSource.url)}
                      >
                        {[0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => (
                          <option key={speed} value={speed}>
                            {speed}x
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-4 rounded-lg border border-ink-100 bg-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                      Instruction script
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-ink-700">
                      {buildSectionScript(activeChapter, chapterScenes)}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <Link to={videoChapterPath(activeVideo.id, activeChapter.id)} className="btn-outline">
                      Copy section link
                    </Link>
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={() => openTrainingInNewTab(activeVideo.id, activeChapter.id)}
                    >
                      Open in new tab
                      <ExternalLink className="h-4 w-4" />
                    </button>
                    <button type="button" className="btn-primary" onClick={closeVideo}>
                      Close
                    </button>
                  </div>
                </div>
              </div>
              <aside className="max-h-[calc(100vh-7rem)] overflow-y-auto border-l border-ink-100 bg-ink-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                  Video sections
                </div>
                <div className="mt-3 space-y-2">
                  {activeVideo.chapters.map((chapter) => {
                    const selected = chapter.id === activeChapter.id;
                    return (
                      <button
                        key={chapter.id}
                        type="button"
                        onClick={() => openVideo(activeVideo.id, chapter.id)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          selected
                            ? "border-gold-300 bg-gold-50 text-ink-950"
                            : "border-ink-100 bg-white text-ink-700 hover:border-gold-200"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold">{chapter.title}</span>
                          <span className="text-xs font-semibold text-gold-700">{chapter.timestamp}</span>
                        </div>
                        {selected && (
                          <div className="mt-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gold-700">
                            Exact section
                          </div>
                        )}
                        <p className="mt-1 text-xs leading-relaxed text-ink-500">{chapter.summary}</p>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function TrainingThumbnail({
  videoId,
  chapter,
  duration,
  done,
}: {
  videoId: string;
  chapter?: VideoChapter;
  duration: string;
  done: boolean;
}) {
  const profile = chapter ? trainingSceneProfile(videoId, chapter) : trainingSceneProfile(videoId, {
    id: "overview",
    title: "Training",
    timestamp: "0:00",
    summary: "Role-specific software training.",
    transcript: "Role-specific software training.",
    keywords: [],
  });
  return (
    <div className="absolute inset-0 bg-[linear-gradient(135deg,#050504_0%,#15130f_100%)] text-white">
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:34px_34px]" />
      <div className="absolute inset-3 overflow-hidden rounded-lg border border-white/12 bg-white/[0.06] shadow-2xl">
        <SoftwareTrainingFrame
          route={profile.route}
          title={profile.primaryPanel}
          subtitle={profile.actionPanel}
          compact
        />
      </div>
      <div className="absolute left-3 top-3 rounded-full bg-black/62 px-2.5 py-1 text-[11px] font-semibold text-white/85">
        {duration}
      </div>
      <div className="absolute bottom-3 left-3 right-3 rounded-md bg-black/62 px-3 py-2 backdrop-blur">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-100">
          {profile.route}
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-white">{chapter?.title ?? profile.primaryPanel}</div>
      </div>
      {done && (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-400 px-2.5 py-1 text-[11px] font-semibold text-emerald-950">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Done
        </div>
      )}
    </div>
  );
}

function TrainingSourceSlot({
  source,
}: {
  source: TrainingVideoSource | null;
}) {
  return (
    <div className="rounded-lg border border-ink-100 bg-ink-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
        <MonitorPlay className="h-3.5 w-3.5" />
        Source
      </div>
      {source ? (
        <div className="mt-2 min-w-0">
          <div className="truncate text-sm font-semibold text-ink-950">{source.sourceName}</div>
          <div className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            {providerLabel(source.provider)} published
          </div>
          <div className="mt-2 truncate text-xs text-ink-400">{source.url}</div>
        </div>
      ) : (
        <div className="mt-2 text-sm leading-snug text-ink-500">
          Built-in guided walkthrough ready. Master portal can replace it with a hosted video later.
        </div>
      )}
    </div>
  );
}

function GuidedTrainingVideoFrame({
  videoTitle,
  chapter,
  scenes,
  autoplay,
  playbackSpeed,
  subtitlesOn,
  onEnded,
  onProgress,
}: {
  videoTitle: string;
  chapter: VideoChapter;
  scenes: TrainingScene[];
  autoplay: boolean;
  playbackSpeed: number;
  subtitlesOn: boolean;
  onEnded: () => void;
  onProgress: (progress: number) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [progress, setProgress] = useState(0);
  const [voiceLabel, setVoiceLabel] = useState("Browser narrator");
  const onEndedRef = useRef(onEnded);
  const onProgressRef = useRef(onProgress);
  const sceneCount = Math.max(scenes.length, 1);
  const sceneIndex = Math.min(sceneCount - 1, Math.floor(Math.max(0, progress) * sceneCount));
  const scene = scenes[sceneIndex] ?? buildTrainingScenes("default", chapter)[0];
  const durationMs = Math.max(22000, sceneCount * 6200);
  const elapsedSeconds = Math.round((progress * durationMs) / 1000);
  const durationSeconds = Math.round(durationMs / 1000);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onProgressRef.current = onProgress;
  }, [onEnded, onProgress]);

  useEffect(() => {
    setProgress(0);
    setIsPlaying(autoplay);
    onProgress(0);
    stopNarration();
  }, [chapter.id, autoplay, onProgress]);

  useEffect(() => {
    if (!isPlaying) return;
    let ended = false;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        const nextProgress = Math.min(1, current + (120 * playbackSpeed) / durationMs);
        onProgressRef.current(nextProgress);
        if (nextProgress >= 1 && !ended) {
          ended = true;
          window.clearInterval(timer);
          setIsPlaying(false);
          stopNarration();
          window.setTimeout(() => onEndedRef.current(), 0);
        }
        return nextProgress;
      });
      if (ended) {
        window.clearInterval(timer);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [durationMs, isPlaying, playbackSpeed]);

  useEffect(() => {
    if (!isPlaying || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synthesis = window.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(`${scene.title}. ${scene.subtitle}`);
    utterance.rate = Math.min(1.08, Math.max(0.82, playbackSpeed));
    utterance.pitch = 0.92;
    const voice = selectTrainingVoice(synthesis.getVoices());
    if (voice) {
      utterance.voice = voice;
      setVoiceLabel(voice.name);
    }
    synthesis.speak(utterance);
    return () => synthesis.cancel();
  }, [isPlaying, playbackSpeed, scene.title, scene.subtitle]);

  function togglePlay() {
    if (progress >= 1) {
      setProgress(0);
      onProgress(0);
    }
    setIsPlaying((value) => !value);
  }

  function restart() {
    stopNarration();
    setProgress(0);
    onProgress(0);
    setIsPlaying(true);
  }

  return (
    <div className="relative h-full overflow-hidden bg-[linear-gradient(135deg,#050504,#17130d)] text-white">
      <div className="absolute inset-0 opacity-18 [background-image:linear-gradient(rgba(255,255,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.18)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_16%,rgba(180,137,49,.2),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,.08),transparent_30%)]" />
      <div className="relative grid h-full grid-rows-[1fr_auto]">
        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_280px] gap-4 p-5 max-md:grid-cols-1">
          <div className="min-h-0 overflow-hidden rounded-xl border border-white/14 bg-white/[0.08] shadow-2xl">
            <SoftwareTrainingFrame
              route={scene.route}
              title={scene.primaryPanel}
              subtitle={scene.subtitle}
            />
          </div>
          <aside className="flex min-h-0 flex-col rounded-xl border border-white/14 bg-black/42 p-4 backdrop-blur max-md:hidden">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-100">
              {scene.stepLabel}
            </div>
            <h2 id="training-video-title" className="mt-2 font-display text-3xl leading-tight text-white">
              {scene.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/72">{scene.subtitle}</p>
            <div className="mt-5 space-y-2">
              {scene.callouts.map((callout) => (
                <div
                  key={callout}
                  className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-medium leading-relaxed text-white/72"
                >
                  {callout}
                </div>
              ))}
            </div>
            <div className="mt-auto rounded-lg border border-gold-200/20 bg-gold-200/10 px-3 py-2 text-xs font-semibold text-gold-100">
              Narrator: {voiceLabel}
            </div>
          </aside>
        </div>

        <div className="relative border-t border-white/12 bg-black/68 px-5 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-100">
                {videoTitle}
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-white">
                {chapter.title}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn border-white/15 bg-white text-ink-950 hover:bg-white/88" onClick={togglePlay}>
                <PlayCircle className="h-4 w-4" />
                {isPlaying ? "Pause" : progress >= 1 ? "Replay" : "Play"}
              </button>
              <button type="button" className="btn border-white/15 bg-white/[0.08] text-white hover:bg-white/[0.14]" onClick={restart}>
                Restart
              </button>
            </div>
          </div>
          {subtitlesOn && (
            <div className="mt-3 rounded-lg border border-white/12 bg-black/56 px-4 py-3 text-center text-sm font-medium leading-relaxed text-white">
              {scene.subtitle}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
            <span className="w-11 text-xs font-semibold text-white/55">{formatClock(elapsedSeconds)}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/16">
              <div
                className="h-full rounded-full bg-gold-300 transition-[width]"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="w-11 text-right text-xs font-semibold text-white/55">{formatClock(durationSeconds)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExternalTrainingVideoFrame({
  source,
  chapter,
  autoplay,
  playbackSpeed,
  onEnded,
  onProgress,
}: {
  source: TrainingVideoSource;
  chapter: VideoChapter;
  autoplay: boolean;
  playbackSpeed: number;
  onEnded: () => void;
  onProgress: (progress: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const src = trainingVideoEmbedUrl(source, chapter.timestamp);
  const direct = isDirectTrainingVideoUrl(source.url);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed, src]);

  if (direct) {
    return (
      <video
        key={`${source.videoId}:${chapter.id}:${src}`}
        ref={videoRef}
        className="h-full w-full bg-black"
        src={src}
        controls
        autoPlay={autoplay}
        playsInline
        onEnded={onEnded}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (!video.duration || Number.isNaN(video.duration)) return;
          onProgress(Math.min(1, video.currentTime / video.duration));
        }}
      />
    );
  }

  return (
    <iframe
      key={`${source.videoId}:${chapter.id}:${src}`}
      className="h-full w-full bg-black"
      src={src}
      title={`${source.sourceName} - ${chapter.title}`}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
    />
  );
}

function SoftwareTrainingFrame({
  route,
  title,
  subtitle,
  compact = false,
}: {
  route: string;
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  const navItems = ["Dashboard", "Activity", "Messages", "Clients", "Policies", "Billing"];
  const active = routeLabel(route);
  return (
    <div className={`h-full w-full bg-[#f7f4ef] text-ink-950 ${compact ? "p-2" : "p-4"}`}>
      <div className="flex h-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <aside className={`${compact ? "w-20 p-2" : "w-32 p-3"} border-r border-stone-200 bg-[#fbfaf8]`}>
          <div className="flex items-center gap-2">
            <span className={`${compact ? "h-6 w-6 text-sm" : "h-8 w-8 text-lg"} grid place-items-center rounded-md bg-black font-display text-white`}>
              Q
            </span>
            {!compact && <span className="text-[10px] font-semibold leading-tight text-stone-700">Quotex<br />Insurance</span>}
          </div>
          <div className={`${compact ? "mt-3 space-y-1" : "mt-5 space-y-1.5"}`}>
            {navItems.map((item) => (
              <div
                key={item}
                className={`truncate rounded-md px-2 py-1.5 text-[9px] font-semibold ${
                  item === active ? "bg-black text-white" : "text-stone-500"
                }`}
              >
                {item}
              </div>
            ))}
          </div>
        </aside>
        <main className={`${compact ? "p-2" : "p-4"} min-w-0 flex-1`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={`${compact ? "text-[8px]" : "text-[10px]"} font-semibold uppercase tracking-[0.16em] text-stone-500`}>
                {route}
              </div>
              <div className={`${compact ? "text-sm" : "text-xl"} truncate font-display text-black`}>
                {title}
              </div>
              {!compact && <div className="mt-1 text-[11px] text-stone-500">{subtitle}</div>}
            </div>
            <span className="shrink-0 rounded-md bg-gold-100 px-2 py-1 text-[9px] font-semibold text-gold-800">
              Demo data
            </span>
          </div>
          <TrainingRouteBody route={route} compact={compact} />
        </main>
      </div>
    </div>
  );
}

function TrainingRouteBody({ route, compact }: { route: string; compact: boolean }) {
  if (route.includes("messages")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Clients, prospects, and holders" rows={["Alexandra Whitford", "Robert Jenkins", "Chubb billing"]} />
        <MockPanel title="Selected thread" rows={["Open in Gmail", "Subject suggested from body", "PDF attachments"]} featured />
      </TrainingGrid>
    );
  }
  if (route.includes("documents")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Template library" rows={["Line: Personal + Commercial", "E-sign: Customer + Agent", "Search templates"]} featured />
        <MockPanel title="Upload template" rows={["Document type", "Required / not required", "Preview before publish"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("billing")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Policy #CHB-HM-558920" rows={["Direct bill", "Quarterly", "Next due: Sep 2"]} featured />
        <MockPanel title="Billing history" rows={["+8.4% premium change", "Card paid", "First payment"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("claims")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Claims" rows={["Chubb Masterpiece", "View on carrier", "Close claim"]} />
        <MockPanel title="Previous loss runs" rows={["Send to client", "Send to holders", "Download PDF"]} featured />
      </TrainingGrid>
    );
  }
  if (route.includes("calendar")) {
    return (
      <div className={`${compact ? "mt-2" : "mt-4"} grid grid-cols-5 gap-1.5`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => (
          <div key={day} className={`${compact ? "min-h-14 p-1" : "min-h-28 p-2"} rounded-md border border-stone-200 bg-stone-50`}>
            <div className="text-[9px] font-semibold text-stone-500">{day}</div>
            {index < 4 && (
              <div className="mt-2 rounded bg-gold-100 px-1.5 py-1 text-[8px] font-semibold text-gold-800">
                {index === 0 ? "Reminder" : index === 1 ? "Meeting" : index === 2 ? "Activity due" : "Goal review"}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (route.includes("marketing")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Campaign prompt" rows={["Audience AI sort", "Generate pamphlet", "Agency setup brand"]} />
        <MockPanel title="Branded pamphlet" rows={["Agency contact", "Get in touch link", "Editable copy"]} featured />
      </TrainingGrid>
    );
  }
  if (route.includes("accounting")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Timesheet configuration" rows={["Due date", "Locked settings", "Frequency"]} />
        <MockPanel title="Agent submissions" rows={["Olivia Marsh", "Timestamped", "Ready review"]} featured />
      </TrainingGrid>
    );
  }
  if (route.includes("hr")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Staff intake" rows={["Anonymous complaint", "Company suggestion", "Named optional"]} featured />
        <MockPanel title="Manager review" rows={["New", "Reviewing", "Closed"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("renewals")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Renewal queue" rows={["Renewal soon", "Non-renewed", "Open policy"]} />
        <MockPanel title="Document publishing" rows={["Update for renewal", "Editable fields", "Publish"]} featured />
      </TrainingGrid>
    );
  }
  if (route.includes("policies")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Policy #CHB-HM-558920" rows={["Overview + coverage", "Documents", "Holders"]} featured />
        <MockPanel title="Timeline" rows={["10 visible", "Expand older", "Search/filter"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("clients")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Alexandra Whitford" rows={["Policies card", "Billing card", "Claims card"]} featured />
        <MockPanel title="Remarks timeline" rows={["Search notes", "Upload images", "Timestamped"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("prospects")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Prospect queue" rows={["All", "Quote in progress", "Nurturing"]} featured />
        <MockPanel title="Row action" rows={["Open", "Managed by", "Status"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("settings")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Tier card" rows={["Locked", "Edit plan", "Add users"]} featured />
        <MockPanel title="Agency controls" rows={["Signatures", "Carriers", "AI allowance"]} />
      </TrainingGrid>
    );
  }
  if (route.includes("tasks")) {
    return (
      <TrainingGrid compact={compact}>
        <MockPanel title="Activity Center" rows={["Routing", "In progress", "Due date"]} featured />
        <MockPanel title="Actions" rows={["Reassign", "Set reminder", "Resolve"]} />
      </TrainingGrid>
    );
  }
  return (
    <TrainingGrid compact={compact}>
      <MockPanel title="Dashboard" rows={["My reminders", "Notifications", "Prospect queue"]} featured />
      <MockPanel title="Recent remarks" rows={["10 visible", "Scroll in card", "Open detail"]} />
    </TrainingGrid>
  );
}

function TrainingGrid({ children, compact }: { children: ReactNode; compact: boolean }) {
  return (
    <div className={`${compact ? "mt-2 gap-1.5" : "mt-4 gap-3"} grid grid-cols-2`}>
      {children}
    </div>
  );
}

function MockPanel({ title, rows, featured = false }: { title: string; rows: string[]; featured?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${
      featured ? "border-gold-200 bg-gold-50" : "border-stone-200 bg-white"
    }`}>
      <div className="truncate text-[11px] font-semibold text-black">{title}</div>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div key={row} className="flex items-center gap-2 text-[10px] text-stone-600">
            <span className={`h-1.5 w-1.5 rounded-full ${featured ? "bg-gold-600" : "bg-stone-400"}`} />
            <span className="truncate">{row}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function routeLabel(route: string): string {
  if (route.includes("tasks")) return "Activity";
  if (route.includes("messages")) return "Messages";
  if (route.includes("clients")) return "Clients";
  if (route.includes("policies")) return "Policies";
  if (route.includes("billing")) return "Billing";
  return "Dashboard";
}

function trainingMinutes(duration: string): number {
  return Number.parseInt(duration, 10) || 0;
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function stopNarration() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

function selectTrainingVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return (
    voices.find((voice) => /natural|aria|jenny|guy|david|zira|samantha/i.test(voice.name)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    voices[0] ??
    null
  );
}

function sceneForProgress(scenes: TrainingScene[], progress: number): TrainingScene | null {
  if (scenes.length === 0) return null;
  const index = Math.min(scenes.length - 1, Math.floor(Math.max(0, progress) * scenes.length));
  return scenes[index];
}

function buildTrainingScenes(videoId: string, chapter: VideoChapter): TrainingScene[] {
  const profile = trainingSceneProfile(videoId, chapter);
  return [
    {
      route: profile.route,
      stepLabel: "Step 1",
      title: chapter.title,
      subtitle: `Open ${profile.route} and start from ${profile.primaryPanel}. ${chapter.summary}`,
      primaryPanel: profile.primaryPanel,
      secondaryPanels: profile.panels,
      callouts: profile.callouts.slice(0, 3),
      cursor: { left: "14%", top: "58%" },
    },
    {
      route: profile.route,
      stepLabel: "Step 2",
      title: profile.actionTitle,
      subtitle: `Use ${profile.actionPanel}. ${profile.callouts[0] ?? chapter.transcript}`,
      primaryPanel: profile.actionPanel,
      secondaryPanels: rotate(profile.panels),
      callouts: rotate(profile.callouts).slice(0, 3),
      cursor: { left: "48%", top: "38%" },
    },
    {
      route: profile.route,
      stepLabel: "Step 3",
      title: "Review before you move on",
      subtitle: `Check ${profile.reviewPanel}. ${profile.callouts[1] ?? chapter.transcript}`,
      primaryPanel: profile.reviewPanel,
      secondaryPanels: rotate(profile.panels, 2),
      callouts: rotate(profile.callouts, 2).slice(0, 3),
      cursor: { left: "72%", top: "56%" },
    },
    {
      route: profile.route,
      stepLabel: "Step 4",
      title: "Apply the workflow",
      subtitle: `${chapter.transcript} When the workflow is clear, open the exact category and repeat the steps on the right record.`,
      primaryPanel: "Workflow application",
      secondaryPanels: rotate(profile.panels, 3),
      callouts: [
        "Open the exact category from the portal navigation",
        "Repeat the action on the correct record",
        "Come back and mark the video complete",
      ],
      cursor: { left: "62%", top: "70%" },
    },
  ];
}

function buildSectionScript(chapter: VideoChapter, scenes: TrainingScene[]): string {
  const steps = scenes
    .map((scene) => `${scene.stepLabel}: ${scene.title}. ${scene.subtitle}`)
    .join(" ");
  return `${chapter.transcript} ${steps}`;
}

function rotate<T>(items: T[], offset = 1): T[] {
  if (items.length === 0) return items;
  const n = offset % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

function trainingSceneProfile(videoId: string, chapter: VideoChapter) {
  const text = `${videoId} ${chapter.id} ${chapter.title} ${chapter.summary} ${chapter.keywords.join(" ")}`.toLowerCase();
  if (hasAny(text, ["client dashboard", "client cards"])) {
    return makeProfile("/employee/clients/customer_demo", "Client dashboard", "Open the right client card", "Policies, billing, claims, remarks, and activities", "Full detail page or timeline", [
      "Start from the client dashboard, not a detached category",
      "Use cards to open full detail pages",
      "Search remarks and timelines before adding new updates",
      "Keep every action attached to the client record",
    ]);
  }
  if (hasAny(text, ["prospect queue"])) {
    return makeProfile("/employee/prospects", "Prospects", "Filter the prospect queue", "Status filters and search", "Open the row before acting", [
      "Use the boxy filters first",
      "Search by name or email",
      "Review last action and managed-by",
      "Open the record before messaging or converting",
    ]);
  }
  if (hasAny(text, ["training adoption", "staff training", "training videos"])) {
    return makeProfile("/employee/training", "Training library", "Open the exact section", "Video sections and section links", "Completion status", [
      "Use role-specific agent or manager training",
      "Ask the assistant for exact section links",
      "Open sections directly from assistant answers",
      "Mark training done after finishing the workflow",
    ]);
  }
  if (hasAny(text, ["message", "email", "sms", "holders"])) {
    return makeProfile("/employee/messages", "Messages", "Open the contact thread", "Composer and recipient controls", "Message record and attachments", [
      "Choose the correct client, prospect, holder, or carrier",
      "Review the mirrored communication thread",
      "Draft, enhance, attach, then send from the right record",
      "Keep every send tied to the client timeline",
    ]);
  }
  if (hasAny(text, ["document", "template", "esign", "signature", "pdf", "publish"])) {
    return makeProfile("/employee/documents", "Document review", "Open the document or template", "Editable fields and signature rules", "Publish, send, or keep as draft", [
      "Confirm line of business and document type",
      "Set customer and agent signature requirements",
      "Preview editable fields before publishing",
      "Attach selected PDFs to the outbound draft",
    ]);
  }
  if (hasAny(text, ["billing", "payment", "premium", "next due"])) {
    return makeProfile("/employee/billing", "Billing", "Open the policy billing row", "Carrier payment path", "Billing history and summary", [
      "Billing is informational only",
      "Verify method, plan, next due date, and premium",
      "Review payment history and premium changes",
      "Send the billing summary when needed",
    ]);
  }
  if (hasAny(text, ["claim", "loss run", "loss runs"])) {
    return makeProfile("/employee/claims", "Claims", "Open the claim or loss-run packet", "Claim status and carrier path", "Send or download the report", [
      "Track open claim status",
      "Use carrier claim links from the detail view",
      "Generate previous loss runs from claim history",
      "Send to client, holder, or carrier when needed",
    ]);
  }
  if (hasAny(text, ["calendar", "meeting", "agenda", "due date", "reschedule"])) {
    return makeProfile("/employee/calendar", "Calendar", "Open week view", "Event details and recipients", "Complete or reschedule", [
      "Start in week view",
      "Review reminders, activity due dates, and meetings",
      "Set reminder timing and importance",
      "Mark complete without deleting history",
    ]);
  }
  if (hasAny(text, ["accounting", "timesheet", "time sheet", "commission"])) {
    return makeProfile("/employee/accounting", "Accounting", "Open the timesheet or commission row", "Schedule and submission details", "Manager review queue", [
      "Check the due date and reporting period",
      "Label time entries clearly",
      "Submit with timestamped confirmation",
      "Managers review individual agent submissions",
    ]);
  }
  if (hasAny(text, ["hr", "complaint", "suggestion", "anonymous"])) {
    return makeProfile("/employee/hr", "HR", "Open HR intake", "Anonymous or named submission", "Manager review status", [
      "Choose complaint or company suggestion",
      "Select anonymous or named",
      "Write the issue clearly",
      "Managers track status through review",
    ]);
  }
  if (hasAny(text, ["marketing", "campaign", "auto-message", "pamphlet", "agency logo"])) {
    return makeProfile("/employee/marketing", "AI marketing", "Open the campaign workspace", "Audience and creative controls", "Review active campaigns", [
      "Define the audience before drafting",
      "Use Agency setup logo and contact info in the pamphlet",
      "Review, pause, view, or delete campaigns",
      "Use simple auto-message rules",
    ]);
  }
  if (hasAny(text, ["renewal", "renewals", "ready for review", "new term", "carrier sync", "carrier records", "policy sync"])) {
    return makeProfile("/employee/renewals", "Renewals", "Open the renewal row", "Review current and new term", "Publish only after review", [
      "Start from the renewal pipeline",
      "Update documents without publishing early",
      "Review carrier-synced updates from the renewal or policy workflow",
      "Review editable fields",
      "Publish when the file is ready",
    ]);
  }
  if (hasAny(text, ["policy", "coverage", "holders", "policy number"])) {
    return makeProfile("/employee/policies", "Policies", "Open the policy row", "Policy overview and coverage", "Documents, holders, and timeline", [
      "Rows are labeled by policy number",
      "Open the full policy page",
      "Review coverage and documents",
      "Send summaries to clients or holders",
    ]);
  }
  if (hasAny(text, ["quoting", "questionnaire", "carrier ranking", "asset detail", "vin"])) {
    return makeProfile("/employee/clients/customer_demo", "AI quoting workspace", "Choose personal or commercial lines", "Asset details and questionnaire", "Carrier ranking review", [
      "Start with the correct line of business",
      "Provide address, VIN, value, or asset identifiers",
      "Send or manually fill missing questions",
      "Review ranked carrier options before acting",
    ]);
  }
  if (hasAny(text, ["prospect", "prospects"])) {
    return makeProfile("/employee/prospects", "Prospects", "Filter the prospect queue", "Open the prospect record", "Update status and next action", [
      "Use status filters and search",
      "Review last action and assigned owner",
      "Open the profile before messaging",
      "Convert only when ready",
    ]);
  }
  if (hasAny(text, ["client", "clients", "profile", "remarks", "timeline"])) {
    return makeProfile("/employee/clients/customer_demo", "Client dashboard", "Open the client dashboard", "Cards, remarks, and timelines", "Policy, billing, and claim details", [
      "Read the dashboard before acting",
      "Use cards to open full detail pages",
      "Search remarks and timelines",
      "Keep every update timestamped",
    ]);
  }
  if (hasAny(text, ["agency settings", "agency setup", "lock", "tier", "plan", "user slots"])) {
    return makeProfile("/employee/settings", "Agency setup", "Unlock only the section being changed", "Tier and configuration controls", "Save and re-lock", [
      "Locked cards prevent accidental edits",
      "Change one configuration area at a time",
      "Save before leaving the card",
      "Plan changes update agency controls",
    ]);
  }
  if (hasAny(text, ["activity", "routing", "reassign", "priority", "queue"])) {
    return makeProfile("/employee/tasks", "Activity Center", "Open the activity card", "Routing, assignment, and due dates", "Resolve after the checklist clears", [
      "Work from assigned activities",
      "Managers route or reassign without duplicating alerts",
      "Set due dates and importance",
      "Resolve only after required work is complete",
    ]);
  }
  return makeProfile("/employee", "Dashboard", "Start from the dashboard", "Open the right card", "Return to the queue when done", [
    "Review reminders and notifications",
    "Open work from the dashboard cards",
    "Follow the record trail before changing status",
    "Keep notes and next steps clear",
  ]);
}

function makeProfile(
  route: string,
  primaryPanel: string,
  actionTitle: string,
  actionPanel: string,
  reviewPanel: string,
  callouts: string[]
) {
  return {
    route,
    primaryPanel,
    actionTitle,
    actionPanel,
    reviewPanel,
    callouts,
    panels: [
      "Search and filters",
      "Record detail",
      "Action buttons",
      "Timeline and audit trail",
    ],
  };
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function readCompletedVideos(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function saveCompletedVideos(key: string, values: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // Local completion tracking is a convenience; playback should keep working if storage is blocked.
  }
}
