import { describe, expect, it } from "vitest";
import {
  AGENT_HOW_TO_VIDEOS,
  MANAGER_HOW_TO_VIDEOS,
  PUBLIC_WHAT_IT_DOES_VIDEOS,
  findVideoChapter,
  videoChapterPath,
} from "../trainingVideos";

describe("training video content", () => {
  it("keeps public preview videos chaptered with usable transcripts", () => {
    expect(PUBLIC_WHAT_IT_DOES_VIDEOS).toHaveLength(3);

    for (const video of PUBLIC_WHAT_IT_DOES_VIDEOS) {
      expect(video.chapters.length).toBeGreaterThanOrEqual(3);
      for (const chapter of video.chapters) {
        expect(chapter.title.length).toBeGreaterThan(4);
        expect(chapter.summary.length).toBeGreaterThan(20);
        expect(chapter.transcript.length).toBeGreaterThan(50);
        expect(chapter.keywords.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("keeps agent and manager training ids unique and routeable", () => {
    const ids = new Set<string>();
    const chapterIds = new Set<string>();

    for (const video of [...AGENT_HOW_TO_VIDEOS, ...MANAGER_HOW_TO_VIDEOS]) {
      expect(ids.has(video.id)).toBe(false);
      ids.add(video.id);
      expect(video.chapters.length).toBeGreaterThanOrEqual(3);

      for (const chapter of video.chapters) {
        const key = `${video.id}:${chapter.id}`;
        expect(chapterIds.has(key)).toBe(false);
        chapterIds.add(key);
        expect(videoChapterPath(video.id, chapter.id, { autoplay: true })).toContain(
          `video=${video.id}`
        );
        expect(chapter.transcript.length).toBeGreaterThan(90);
      }
    }
  });

  it("finds exact training sections for niche workflow questions", () => {
    expect(findVideoChapter("send selected pdfs to policy holders", "agent")?.chapter.id).toBe(
      "send-selected-pdfs"
    );
    expect(findVideoChapter("review carrier sync before updating policy", "manager")?.chapter.id).toBe(
      "carrier-sync-governance"
    );
    expect(findVideoChapter("complete a calendar event without deleting it", "agent")?.chapter.id).toBe(
      "complete-or-reschedule"
    );
  });
});
