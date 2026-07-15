// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "../emailHtml";

describe("email HTML remote resource privacy", () => {
  it("blocks remote images, srcsets, CSS resources, and background attributes until allowed", () => {
    const document = parseFrame(sanitizeEmailHtml(trackingHtml(), { allowRemoteImages: false }));

    const remoteImage = document.querySelector("#remote-image");
    expect(remoteImage?.getAttribute("src")).toBeNull();
    expect(remoteImage?.getAttribute("srcset")).toBeNull();
    expect(remoteImage?.getAttribute("data-quotex-blocked-src")).toBe("https://tracker.example/open.gif");
    expect(document.querySelector("#background-table")?.getAttribute("background")).toBeNull();
    expect(document.querySelector("#styled")?.getAttribute("style")).toBe("color:red");
    expect(document.querySelector("#svg-image")?.getAttribute("href")).toBeNull();
    expect(document.querySelector("#remote-style")).toBeNull();
    expect(document.querySelector("#safe-link")?.getAttribute("href")).toBe("https://example.com/account");
    expect(document.querySelector("#inline-image")?.getAttribute("src")).toBe("cid:logo@example.com");

    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src data: cid:");
    expect(policy).not.toContain("img-src http:");
  });

  it("restores safe remote image and CSS background URLs after explicit allowance", () => {
    const document = parseFrame(sanitizeEmailHtml(trackingHtml(), { allowRemoteImages: true }));

    expect(document.querySelector("#remote-image")?.getAttribute("src")).toBe("https://tracker.example/open.gif");
    expect(document.querySelector("#remote-image")?.getAttribute("srcset")).toContain("https://tracker.example/open@2x.gif");
    expect(document.querySelector("#background-table")?.getAttribute("background")).toBe("/tracking/background.png");
    expect(document.querySelector("#styled")?.getAttribute("style")).toContain("url(https://tracker.example/background.png)");

    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
    expect(policy).toContain("img-src http: https: data: cid:");
  });
});

function trackingHtml() {
  return `
    <style id="remote-style">@import url("https://tracker.example/email.css");</style>
    <div id="styled" style="color:red; background-image:url(https://tracker.example/background.png); list-style-image:url('/tracking/list.png')">Message</div>
    <img id="remote-image" src="https://tracker.example/open.gif" srcset="https://tracker.example/open.gif 1x, https://tracker.example/open@2x.gif 2x" alt="Open" />
    <img id="inline-image" src="cid:logo@example.com" alt="Logo" />
    <table id="background-table" background="/tracking/background.png"><tr><td>Content</td></tr></table>
    <svg><image id="svg-image" href="https://tracker.example/vector.png"></image></svg>
    <a id="safe-link" href="https://example.com/account">Account</a>
  `;
}

function parseFrame(value: string): Document {
  return new DOMParser().parseFromString(value, "text/html");
}
