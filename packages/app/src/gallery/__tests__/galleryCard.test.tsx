/**
 * #2488 — a card draws its picture from stored data only: a recorded cover's
 * timeline, else the captured picture, else the generated card (entries from
 * before recording). Nothing is evaluated to draw it.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Card } from "../GalleryCards";
import { forgetGalleryRecordingsForTests } from "../client";
import type { GalleryRecording } from "../recording";
import type { GalleryEntry } from "../types";

const REC: GalleryRecording = {
  v: 1,
  cover: "main.strudel",
  contents: { patterns: 3, visuals: 2, other: 0 },
  files: [
    { path: "main.strudel", span: "arranged", cycles: 8, lanes: [{ name: "bd" }], events: [[0, 0, 0.5, null]], sections: [[0, 8, "intro"]] },
  ],
};

const E = (over: Partial<GalleryEntry>): GalleryEntry => ({
  id: "proj1xxxxxx",
  title: "Dub Techno Starter",
  kind: "project",
  tags: ["dub", "techno"],
  authorName: "mira.k",
  authorId: "mira",
  publishedAt: Date.now() - 2 * 86400_000,
  fileCount: 5,
  hasThumbnail: false,
  ...over,
});

function stubFetch(rec: unknown = REC) {
  const f = vi.fn(async (url: string) =>
    url.endsWith("/recording") ? Response.json(rec) : new Response(null, { status: 404 }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetGalleryRecordingsForTests();
});

const picture = () => document.querySelector("[data-gallery-card-picture]")!.getAttribute("data-gallery-card-picture");

describe("Card", () => {
  it("a recorded project: the cover's timeline, and what it holds", async () => {
    const f = stubFetch();
    render(<Card entry={E({ hasRecording: true })} onOpen={() => {}} />);
    await waitFor(() => expect(picture()).toBe("timeline"));
    expect(document.querySelector('[data-gallery-timeline="main.strudel"]')).not.toBeNull();
    expect(document.querySelector("[data-gallery-card-count]")!.textContent).toBe("3 patterns · 2 visuals");
    expect(f).toHaveBeenCalledWith("/api/gallery/proj1xxxxxx/recording");
  });

  it("an entry from before recording asks for nothing and keeps the generated card", () => {
    const f = stubFetch();
    render(<Card entry={E({})} onOpen={() => {}} />);
    expect(picture()).toBe("generated");
    expect(document.querySelector("[data-gallery-card-count]")!.textContent).toBe("5 files");
    expect(f).not.toHaveBeenCalled();
  });

  it("a visual shows its captured picture even with a record", async () => {
    const f = stubFetch();
    render(<Card entry={E({ kind: "viz", hasThumbnail: true, hasRecording: true })} onOpen={() => {}} />);
    // after the record has arrived, not before
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/gallery/proj1xxxxxx/recording"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("img.sg-thumb")).not.toBeNull();
    expect(picture()).toBe("thumbnail");
    expect(document.querySelector("[data-gallery-card-count]")).toBeNull();
  });

  it("a record of the wrong shape draws nothing from it", async () => {
    stubFetch({ v: 1, cover: "main.strudel", files: "<script>" });
    render(<Card entry={E({ hasRecording: true })} onOpen={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(picture()).toBe("generated");
  });

  it("the meta line: initial, name, how long ago, plain tags", () => {
    stubFetch();
    render(<Card entry={E({})} onOpen={() => {}} />);
    expect(document.querySelector(".sg-gcard-meta")!.textContent).toMatch(/^Mmira\.k·2 days ago$/);
    expect(Array.from(document.querySelectorAll(".sg-gcard-tag")).map((t) => t.textContent)).toEqual(["dub", "techno"]);
    expect(document.querySelector(".sg-gcard-kind")!.textContent).toBe("Project");
  });
});
