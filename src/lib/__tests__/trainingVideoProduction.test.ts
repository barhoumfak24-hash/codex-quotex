import { describe, expect, it } from "vitest";
import {
  PHOTO_ALBUM_PRODUCTION_BRIEFS,
  allTrainingProductionVideos,
  fullVideoProductionBrief,
  productionBriefForPhotoAlbums,
  productionBriefForVideo,
} from "../trainingVideoProduction";

describe("training video production package", () => {
  it("builds a complete vendor handoff for every training audience", () => {
    const brief = fullVideoProductionBrief();

    expect(brief).toContain("Public Review Videos");
    expect(brief).toContain("Agent Training Videos");
    expect(brief).toContain("Manager Training Videos");
    expect(brief).toContain("Quotex Public Photo Album Production Brief");
    expect(brief).toContain("Narration must be realistic");
  });

  it("keeps each video brief tied to chapters and deliverables", () => {
    const video = allTrainingProductionVideos()[0];
    const brief = productionBriefForVideo(video);

    expect(brief).toContain(video.title);
    expect(brief).toContain(video.chapters[0].title);
    expect(brief).toContain(`${video.id}.mp4`);
    expect(brief).toContain("Final hosted URL");
  });

  it("includes software, website, and app photo album shot lists", () => {
    const albumBrief = productionBriefForPhotoAlbums();

    expect(PHOTO_ALBUM_PRODUCTION_BRIEFS).toHaveLength(3);
    expect(albumBrief).toContain("Software photo album");
    expect(albumBrief).toContain("Website photo album");
    expect(albumBrief).toContain("App photo album");
  });
});
