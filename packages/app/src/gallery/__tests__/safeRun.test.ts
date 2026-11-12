/**
 * #2304 — a gallery file is held from quiet evaluation until it is played.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  beginGalleryImport,
  endGalleryImport,
  holdGalleryFiles,
  isGalleryHeld,
  releaseGalleryHold,
  resetGalleryHoldsForTest,
} from "../safeRun";

beforeEach(() => resetGalleryHoldsForTest());

describe("gallery safe-run holds", () => {
  it("holds exactly the files given, per project, until released", () => {
    holdGalleryFiles("proj-a", ["f1", "f2"]);
    expect(isGalleryHeld("proj-a", "f1")).toBe(true);
    expect(isGalleryHeld("proj-a", "f2")).toBe(true);
    expect(isGalleryHeld("proj-a", "f3")).toBe(false);
    expect(isGalleryHeld("proj-b", "f1")).toBe(false);
    releaseGalleryHold("proj-a", "f1");
    expect(isGalleryHeld("proj-a", "f1")).toBe(false);
    expect(isGalleryHeld("proj-a", "f2")).toBe(true);
  });

  it("survives a reload (kept in localStorage)", () => {
    holdGalleryFiles("proj-a", ["f1"]);
    expect(JSON.parse(window.localStorage.getItem("stave.gallery.unplayed")!)).toEqual(["proj-a/f1"]);
  });

  it("holds everything while an import is in flight", () => {
    expect(isGalleryHeld("any", "file")).toBe(false);
    beginGalleryImport();
    expect(isGalleryHeld("any", "file")).toBe(true);
    endGalleryImport();
    expect(isGalleryHeld("any", "file")).toBe(false);
  });

  it("a corrupt store reads as nothing held rather than throwing", () => {
    window.localStorage.setItem("stave.gallery.unplayed", "{not json");
    expect(isGalleryHeld("p", "f")).toBe(false);
    holdGalleryFiles("p", ["f"]);
    expect(isGalleryHeld("p", "f")).toBe(true);
  });
});
