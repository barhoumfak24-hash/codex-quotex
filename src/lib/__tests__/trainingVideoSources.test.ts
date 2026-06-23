// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTrainingVideoSource,
  isDirectTrainingVideoUrl,
  providerForTrainingVideoUrl,
  providerLabel,
  removeTrainingVideoSource,
  saveTrainingVideoSource,
  timestampToSeconds,
  trainingVideoEmbedUrl,
} from "../trainingVideoSources";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("training video source slots", () => {
  it("stores and removes an external source by video id", () => {
    const source = saveTrainingVideoSource("agent-first-week-workflow", {
      url: "https://cdn.example.com/training/agent-first-week.mp4",
      sourceName: "AI-rendered agent onboarding",
    });

    expect(source.provider).toBe("direct");
    expect(getTrainingVideoSource("agent-first-week-workflow")?.sourceName).toBe(
      "AI-rendered agent onboarding"
    );

    removeTrainingVideoSource("agent-first-week-workflow");
    expect(getTrainingVideoSource("agent-first-week-workflow")).toBeNull();
  });

  it("detects common hosted video providers", () => {
    expect(providerForTrainingVideoUrl("https://youtu.be/abc123")).toBe("youtube");
    expect(providerForTrainingVideoUrl("https://vimeo.com/123456789")).toBe("vimeo");
    expect(providerForTrainingVideoUrl("https://www.loom.com/share/abc123")).toBe("loom");
    expect(providerForTrainingVideoUrl("https://fast.wistia.com/embed/medias/abc123")).toBe("wistia");
    expect(isDirectTrainingVideoUrl("https://cdn.example.com/video.webm")).toBe(true);
    expect(isDirectTrainingVideoUrl("/training/quotex-complete-product-walkthrough.webm")).toBe(true);
    expect(providerLabel("generic")).toBe("External embed");
  });

  it("builds embed URLs with chapter timestamps", () => {
    const source = saveTrainingVideoSource("manager-routing", {
      url: "https://www.youtube.com/watch?v=abc123",
    });

    expect(timestampToSeconds("5:40")).toBe(340);
    expect(trainingVideoEmbedUrl(source, "5:40")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123?rel=0&modestbranding=1&start=340"
    );
  });

  it("ships a bundled complete walkthrough for agent and manager libraries", () => {
    const source = getTrainingVideoSource("agent-complete-product-walkthrough");

    expect(source?.bundled).toBe(true);
    expect(source?.url).toBe("/training/quotex-complete-product-walkthrough.webm");
    expect(trainingVideoEmbedUrl(source!, "1:04")).toBe(
      "/training/quotex-complete-product-walkthrough.webm#t=64"
    );
  });

  it("ships bundled direct videos for category walkthroughs", () => {
    const source = getTrainingVideoSource("manager-category-dashboard");

    expect(source?.bundled).toBe(true);
    expect(source?.provider).toBe("direct");
    expect(source?.url).toBe("/training/categories/dashboard.webm");
    expect(trainingVideoEmbedUrl(source!, "0:20")).toBe("/training/categories/dashboard.webm#t=20");
  });
});
